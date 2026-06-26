import Parallel from "parallel-web";

async function main() {
  if (!process.env.PARALLEL_API_KEY || !process.env.TRIGGER_WEBHOOK_URL) {
    console.error("Missing PARALLEL_API_KEY or TRIGGER_WEBHOOK_URL in environment.");
    process.exit(1);
  }

  const client = new Parallel({ apiKey: process.env.PARALLEL_API_KEY });

  console.log("Creating X (Twitter) Monitor...");
  const xMonitor = await client.monitor.create({
    type: "event_stream",
    frequency: "1h",
    processor: "base",
    settings: {
      query: `Technical founder or CEO announcing pre-seed funding raise under $5M, 
              or launching new AI product or infrastructure tool, or building in stealth, 
              posted on X (Twitter). Must be from account with founder/CEO/CTO in bio. 
              Exclude retweets, job postings, and accounts with over 100k followers. 
              Focus on AI infrastructure, developer tools, fintech tooling, 
              not consumer apps or no-code tools.`,
    },
    webhook: {
      url: process.env.TRIGGER_WEBHOOK_URL + "/x-monitor",
      event_types: ["monitor.event.detected"],
    },
  });
  console.log("X Monitor ID:", xMonitor.monitor_id);

  console.log("Creating LinkedIn Monitor...");
  const linkedinMonitor = await client.monitor.create({
    type: "event_stream",
    frequency: "2h",
    processor: "base",
    settings: {
      query: `Founder or CEO of an early-stage AI startup (under 20 employees) 
              announcing a pre-seed funding close, product launch, or going from 
              stealth to public on LinkedIn. Must reference a company they founded. 
              Exclude Series A and later. Exclude hiring posts. 
              Focus on AI infrastructure, developer tools, B2B AI, fintech AI.`,
    },
    webhook: {
      url: process.env.TRIGGER_WEBHOOK_URL + "/linkedin-monitor",
      event_types: ["monitor.event.detected"],
    },
  });
  console.log("LinkedIn Monitor ID:", linkedinMonitor.monitor_id);

  console.log("\\nDone! Save these to your .env file:");
  console.log(`PARALLEL_X_MONITOR_ID=${xMonitor.monitor_id}`);
  console.log(`PARALLEL_LINKEDIN_MONITOR_ID=${linkedinMonitor.monitor_id}`);
}

main().catch(console.error);
