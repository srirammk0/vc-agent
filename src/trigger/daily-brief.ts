import { schedules } from "@trigger.dev/sdk/v3";
import { synthesizeDailyBrief } from "../../lib/cerebras.js";
import { getRecentLogs, getShortlistContext } from "../../lib/brain.js";
import { sendDailyBrief } from "../../lib/email.js";
import { ScoredStartup } from "../../lib/types.js";
import fs from 'fs/promises';
import path from 'path';

export const dailyBrief = schedules.task({
  id: "daily-brief",
  cron: "30 18 * * 1-5", // 6:30pm weekdays
  maxDuration: 60,
  run: async () => {
    // Step 1: Read Brain
    const recentLogs = await getRecentLogs();
    if (!recentLogs) {
      console.log("No runs today, skipping daily brief.");
      return;
    }
    const shortlist = await getShortlistContext();

    // Step 2: Synthesize
    const synthesis = await synthesizeDailyBrief(recentLogs, shortlist);

    // Parse today's shortlist additions to include in the email
    // This is a naive extraction for demonstration purposes.
    // In production, you might store full JSON objects or parse the markdown.
    const todayStr = new Date().toISOString().split('T')[0];
    const topPicks: ScoredStartup[] = [];
    
    // Calculate total in registry (approximate by counting '---' dividers)
    const registryCount = (shortlist.match(/---/g)?.length || 0) / 2;

    // Step 3: Email
    const dateStr = new Date().toLocaleDateString("en-US", { weekday: 'long', month: 'short', day: 'numeric' });
    
    await sendDailyBrief(
      dateStr,
      synthesis.runs_today || 0,
      synthesis.triggers_fired || 0,
      synthesis.companies_passed || 0,
      topPicks, // We skip deep parsing the markdown for now, relies on synthesis text
      synthesis.patterns_noticed || "None",
      synthesis.suggested_focus || "None",
      registryCount
    );
  }
});
