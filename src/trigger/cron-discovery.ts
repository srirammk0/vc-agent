import { schedules } from "@trigger.dev/sdk/v3";
import { reasonCronPlan, batchQualify, scoreCompany } from "../../lib/cerebras.js";
import { getSeenUrls, getShortlistContext, getSignals, addSeenUrls, addPassedCompany, addRejectedCompany, logRun, updateSignal } from "../../lib/brain.js";
import { passesHardFilters } from "../../lib/filters.js";
import { linkup } from "../../lib/linkup.js";
import { runExaCompanySearch, runExaPeopleSearch } from "../../lib/exa.js";
import { sendBatchAlert } from "../../lib/email.js";
import { ScoredStartup } from "../../lib/types.js";

export const cronDiscoverySweep = schedules.task({
  id: "cron-discovery-sweep",
  cron: "0 6,9,12,15,18 * * 1-5", // 6am, 9am, 12pm, 3pm, 6pm weekdays
  maxDuration: 300,
  run: async () => {
    const timeContext = new Date().toISOString();
    const shortlist = await getShortlistContext();
    const signals = await getSignals();
    const seenUrlsSet = await getSeenUrls();
    const seenUrlsArr = Array.from(seenUrlsSet);

    // Step 1: Reason
    const plan = await reasonCronPlan(shortlist, signals, seenUrlsArr.join('\n'), timeContext);
    
    // Step 2: Discover
    const candidates = [];
    
    // A) Linkup searches
    for (const query of (plan.linkup_queries || [])) {
      const res = await linkup.search({ query, depth: "standard", outputType: "searchResults" });
      if (res.results) {
        for (const item of res.results) {
          if (item.url) candidates.push({ url: item.url, snippet: item.content, source: "linkup_search" });
        }
      }
    }

    // B) VC Directories
    for (const vc of (plan.vc_directories_to_check || [])) {
      // Very basic fetch via Linkup to extract URLs
      const res = await linkup.fetch({ url: vc, renderJS: true });
      candidates.push({ url: vc, snippet: res.content?.slice(0, 1000) || "", source: "vc_directory" });
    }

    // C) Direct Exa Search
    if (plan.exa_query) {
       const exaCandidates = await runExaCompanySearch(plan.exa_query);
       for (const c of exaCandidates) {
         if (c.url) candidates.push({ url: c.url, snippet: c.name, source: "exa_direct" });
       }
    }

    // Step 3: Dedup
    const uniqueCandidates = [];
    const localSeen = new Set<string>();
    for (const c of candidates) {
      if (!c.url || seenUrlsSet.has(c.url) || localSeen.has(c.url)) continue;
      localSeen.add(c.url);
      uniqueCandidates.push(c);
    }

    if (uniqueCandidates.length === 0) {
      await logRun("cron", 0, "no new candidates");
      await updateSignal("cron", `Checked ${plan.vc_directories_to_check?.join(', ')}. 0 new.`);
      return;
    }

    // Step 4: Hard Filter
    const hardFiltered = uniqueCandidates.filter(c => passesHardFilters(c.snippet));

    if (hardFiltered.length === 0) {
      await addSeenUrls(uniqueCandidates.map(c => c.url));
      await logRun("cron", 0, "all failed hard filters");
      await updateSignal("cron", "Found candidates but all failed hard filters.");
      return;
    }

    // Step 5: Batch Qualify
    const qualifyRes = await batchQualify(hardFiltered.slice(0, 10), shortlist); // Check top 10 max
    const qualifiedUrls = qualifyRes.filter(q => q.qualifies).map(q => q.url).slice(0, 3); // Take top 3

    // Record rejected ones
    const rejectedUrls = qualifyRes.filter(q => !q.qualifies).map(q => q.url);
    await addSeenUrls(rejectedUrls);
    for (const q of qualifyRes.filter(q => !q.qualifies)) {
       await addRejectedCompany(q.url, 0, `failed batch qualify: ${q.reason}`);
    }

    if (qualifiedUrls.length === 0) {
      await logRun("cron", 0, "all failed batch qualify");
      await updateSignal("cron", "Candidates found but none qualified.");
      return;
    }

    // Step 6 & 7: Exa Enrichment & Score
    const passingStartups: ScoredStartup[] = [];
    
    for (const qUrl of qualifiedUrls) {
      const companyRes = await runExaCompanySearch(`site:${qUrl}`);
      let metadata: any = { url: qUrl };
      let foundersList: any[] = [];
      let companyName = "Unknown Startup";

      if (companyRes.length > 0) {
        metadata = companyRes[0];
        companyName = metadata.name || companyName;
        foundersList = await runExaPeopleSearch(companyName);
      }

      const snippet = hardFiltered.find(h => h.url === qUrl)?.snippet || "";

      if (!passesHardFilters(snippet, metadata)) {
         await addSeenUrls([qUrl]);
         continue;
      }

      const scoreInput = {
        companyName: companyName,
        websiteUrl: metadata.url,
        foundedYear: metadata.foundedYear,
        fundingStage: metadata.fundingStage,
        fundingTotal: metadata.fundingTotal,
        workforce: metadata.workforce,
        headquarters: metadata.headquarters,
        isYC: snippet.toLowerCase().includes("y combinator"),
        productSummary: snippet,
        foundersList: JSON.stringify(foundersList),
        negativeSignals: ""
      };
      
      const scoreRes = await scoreCompany(scoreInput, shortlist, "Cron Discovery Sweep");

      if (scoreRes.pass) {
        const fullCompany = {
          ...scoreRes,
          url: scoreInput.websiteUrl,
          foundedYear: scoreInput.foundedYear,
          fundingStage: scoreInput.fundingStage,
          fundingTotal: scoreInput.fundingTotal,
          workforce: scoreInput.workforce,
          headquarters: scoreInput.headquarters,
          founders: foundersList
        };
        passingStartups.push(fullCompany);
        await addPassedCompany(fullCompany);
      } else {
        await addRejectedCompany(scoreInput.websiteUrl, scoreRes.overall_score, "failed scoring");
      }
    }

    // Step 8: Write to Brain
    await logRun("cron", passingStartups.length, `processed ${qualifiedUrls.length}, passed ${passingStartups.length}`);
    await updateSignal("cron", `Checked ${plan.vc_directories_to_check?.join(', ')}. Found ${uniqueCandidates.length}, qualified ${qualifiedUrls.length}, passed ${passingStartups.length}.`);

    // Step 9: Email
    if (passingStartups.length > 0) {
      const timeStr = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      await sendBatchAlert(passingStartups, timeStr);
    }
  }
});
