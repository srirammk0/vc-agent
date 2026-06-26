import { schedules } from "@trigger.dev/sdk/v3";
import { runExaCompanySearch, runExaFastSearch, runExaPeopleSearch, runExaSignalResearch } from "../../lib/exa.js";
import { scoreStartup } from "../../lib/gemini.js";
import { readRegistry, isAlreadySeen, appendToRegistry, countRegistryEntries, extractDomainsFromRegistry, appendToCache, readCache, clearCache } from "../../lib/dedup.js";
import { sendDebrief, sendDailyRecap } from "../../lib/email.js";
import { pickQueriesForRun } from "../../lib/queries.js";
import type { Candidate, EnrichedCandidate, ScoredStartup } from "../../lib/types.js";

/**
 * Startup Scout
 * 
 * 1. Read Deduplication Registry (local seen-startups.md)
 * 2. Query Rotation (pick 5 queries for this 30 min window)
 * 3. Discover Candidates (Exa Company Search)
 * 4. Deduplicate & Hard Filters (Synchronous drop)
 * 5. Enrich (Fast Search + People Search + Signal Research)
 * 6. Score & Summarize (Gemini 3.1 Flash Lite)
 * 7. Append to Registry
 * 8. Email Debrief (Composio Gmail)
 */
export const startupScout = schedules.task({
  id: "startup-scout",
  // Runs every hour from 6am to 6pm Pacific Time
  cron: {
    pattern: "0 6-18 * * *",
    timezone: "America/Los_Angeles",
  },
  // Allow up to 5 minutes for Exa searches and Gemini inference
  maxDuration: 300,
  retry: {
    maxAttempts: 1,
  },
  run: async (payload, { ctx }) => {
    console.log(`[scout] Starting run for timestamp: ${payload.timestamp}`);
    
    // 1. Read deduplication registry
    const registryStr = await readRegistry();
    const registryCount = countRegistryEntries(registryStr);
    const excludedDomains = extractDomainsFromRegistry(registryStr);
    console.log(`[dedup] Loaded registry (${registryCount} entries). Extracted ${excludedDomains.length} domains to exclude.`);

    // 2. Pick queries for this 1-hour window
    const runIndex = Math.floor(Date.now() / 3_600_000);
    const queries = pickQueriesForRun(runIndex);
    console.log(`[exa] Running ${queries.length} queries...`);

    // 3. Discover candidates
    const rawCandidates: Candidate[] = [];
    for (const q of queries) {
      const results = await runExaCompanySearch(q, excludedDomains);
      rawCandidates.push(...results);
    }
    console.log(`[exa] Discovered ${rawCandidates.length} raw candidates across ${queries.length} queries`);

    // 4. Deduplicate & Hard Filters
    const newCandidates = rawCandidates.filter(c => {
      // Must have a URL to be tracked in the registry
      if (!c.url) return false;
      if (isAlreadySeen(c.url, c.name, registryStr)) return false;

      // Hard Filters
      if (c.workforce) {
        // workforce format usually like "1-10" or "50". Try to parse max number.
        const matches = String(c.workforce).match(/\\d+/g);
        if (matches) {
          const maxNum = Math.max(...matches.map(Number));
          if (maxNum > 20) return false;
        }
      }

      if (c.fundingTotal) {
        const fundingRaw = c.fundingTotal.replace(/[^0-9.]/g, '');
        let numeric = parseFloat(fundingRaw);
        if (c.fundingTotal.toLowerCase().includes('m') || c.fundingTotal.toLowerCase().includes('million')) {
          numeric *= 1_000_000;
        } else if (c.fundingTotal.toLowerCase().includes('k') || c.fundingTotal.toLowerCase().includes('thousand')) {
          numeric *= 1_000;
        }
        if (numeric > 10_000_000) return false;
      }

      if (c.fundingStage && /Series [A-Z]/i.test(c.fundingStage)) {
        return false;
      }

      if (c.foundedYear && c.foundedYear < 2022) {
        return false;
      }

      // Aggressive YC filter: drop if name or URL mentions Y Combinator, YC (as word), or workatastartup
      const nameLower = c.name.toLowerCase();
      const urlLower = c.url.toLowerCase();
      const isYCDomain = urlLower.includes("ycombinator.com") || urlLower.includes("workatastartup.com");
      const mentionsYC = /\\by\\s?combinator\\b/.test(nameLower) || /\\byc\\b/.test(nameLower) || /\\byc\\s?[a-z]\\d{2}\\b/.test(nameLower); // e.g. YC W23
      
      if (isYCDomain || mentionsYC) return false;

      // US only filter (from thesis)
      if (c.headquarters) {
        const hq = c.headquarters.toLowerCase();
        const isUS = hq.includes("united states") || hq.includes("usa") || hq.includes(", us") || hq.endsWith(" us");
        if (!isUS) return false;
      }

      return true;
    });
    
    if (newCandidates.length === 0) {
      console.log(`[dedup] All ${rawCandidates.length} candidates failed filters/dedup. Ending run.`);
      return { success: true, message: "No new candidates" };
    }
    console.log(`[dedup] ${newCandidates.length} new candidates remaining after dedup and hard filters`);

    // Limit to 20 candidates per run to avoid timeout/exceeding compute time limits
    const candidatesToProcess = newCandidates.slice(0, 20);
    console.log(`[dedup] Capped candidates to process at ${candidatesToProcess.length} (out of ${newCandidates.length} filtered candidates)`);

    // 5. Enrich with website summaries, founder data, and signal research (capped at 20)
    const enriched: EnrichedCandidate[] = [];
    for (let i = 0; i < candidatesToProcess.length; i++) {
      const c = candidatesToProcess[i];
      console.log(`[exa] Enriching ${i + 1}/${candidatesToProcess.length}: ${c.name}...`);
      
      try {
        const [websiteSummary, founders, signalResearch] = await Promise.all([
          runExaFastSearch(c.url),
          runExaPeopleSearch(c.name),
          runExaSignalResearch(c.name)
        ]);
        
        enriched.push({
          ...c,
          websiteSummary,
          founders,
          signalResearch
        });
      } catch (err) {
        console.error(`[exa] Failed to enrich ${c.name}, skipping.`, err);
      }
    }

    // 6. Score via Gemini 3.1 Flash Lite
    const scored: ScoredStartup[] = [];
    for (let i = 0; i < enriched.length; i++) {
      const c = enriched[i];
      
      // Delay 3 seconds between requests (except the first) to respect Gemini RPM rate limits (429)
      if (i > 0) {
        await new Promise(r => setTimeout(r, 3000));
      }
      
      console.log(`[gemini] Scoring ${i + 1}/${enriched.length}: ${c.name}...`);
      const result = await scoreStartup(c, registryStr);
      scored.push(result);
    }

    // 7. Filter passing and failing startups
    const passed = scored.filter(s => s.pass && !s.already_seen);
    const failed = scored.filter(s => !s.pass && !s.already_seen);
    const newScored = [...passed, ...failed];
    
    // 8. Append all newly evaluated startups to registry and cache so we don't scan them again
    if (newScored.length > 0) {
      await appendToRegistry(newScored);
      await appendToCache(newScored);
    }
    const newRegistryCount = registryCount + newScored.length;

    // Sort passed startups by score descending
    passed.sort((a, b) => b.overall_score - a.overall_score);
    console.log(`[scout] ${passed.length} startups passed scoring.`);

    // 9. Send Email Debrief (even if passed.length is 0, we still want to show what failed)
    if (scored.length > 0) {
      try {
        await sendDebrief(scored, newRegistryCount);
      } catch (err) {
        console.error(`[email] Failed to send debrief:`, err);
      }
    } else {
      console.log(`[scout] No candidates were evaluated during this run. Skipping debrief email.`);
    }

    console.log(`[scout] Run complete. Surfaced ${passed.length} startups.`);
    return {
      success: true,
      surfaced: passed.length,
      top_startup: passed[0]?.name
    };
  }
});

/**
 * Daily Recap Task
 * Runs every day at 6:30 PM Pacific Time.
 * Reads the daily evaluated cache, emails a consolidated report, and clears the cache.
 */
export const dailyRecap = schedules.task({
  id: "daily-recap",
  cron: {
    pattern: "30 18 * * *",
    timezone: "America/Los_Angeles",
  },
  maxDuration: 120,
  retry: {
    maxAttempts: 1,
  },
  run: async (payload, { ctx }) => {
    console.log(`[daily-recap] Starting daily recap run...`);

    const startups = await readCache();
    if (startups.length === 0) {
      console.log(`[daily-recap] No startups evaluated today. Skipping recap email.`);
      return { success: true, message: "No startups evaluated today" };
    }

    console.log(`[daily-recap] Found ${startups.length} startups in cache. Sending daily recap email...`);

    try {
      const registryStr = await readRegistry();
      const registryCount = countRegistryEntries(registryStr);

      await sendDailyRecap(startups, registryCount);

      // Clear the cache for the next day's run
      await clearCache();
      console.log(`[daily-recap] Daily cache cleared successfully.`);
    } catch (err) {
      console.error(`[daily-recap] Failed to process daily recap:`, err);
      throw err;
    }

    return {
      success: true,
      recapCount: startups.length,
    };
  }
});
