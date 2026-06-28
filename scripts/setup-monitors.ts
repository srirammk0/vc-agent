/**
 * setup-monitors.ts
 *
 * Creates Firecrawl monitors for startup signal detection.
 * Run once to register monitors, then store the returned IDs in FIRECRAWL_MONITOR_IDS.
 *
 * Usage:
 *   npx tsx scripts/setup-monitors.ts
 *
 * After running, add the printed JSON to .env as FIRECRAWL_MONITOR_IDS=<json>
 * and set FIRECRAWL_WEBHOOK_URL to your deployed webhook endpoint.
 */

import "dotenv/config";

const FIRECRAWL_API = "https://api.firecrawl.dev/v1";
const WEBHOOK_URL = process.env.FIRECRAWL_WEBHOOK_URL;
const API_KEY = process.env.FIRECRAWL_API_KEY;

if (!API_KEY) {
  console.error("FIRECRAWL_API_KEY not set");
  process.exit(1);
}
if (!WEBHOOK_URL) {
  console.error("FIRECRAWL_WEBHOOK_URL not set (e.g. https://your-app.com/api/webhooks/firecrawl)");
  process.exit(1);
}

// Monitors to create — each watches a publicly accessible page for new startup signals
const MONITORS = [
  {
    name: "yc-companies",
    url: "https://www.ycombinator.com/companies",
    goal: "New AI-native startups added to the YC company directory, especially pre-seed and seed stage",
  },
  {
    name: "south-park-commons",
    url: "https://www.southparkcommons.com/",
    goal: "New member companies or announcements from South Park Commons",
  },
  {
    name: "producthunt-ai",
    url: "https://www.producthunt.com/topics/artificial-intelligence",
    goal: "New AI product launches on Product Hunt, especially from early-stage startups",
  },
  {
    name: "techcrunch-seed",
    url: "https://techcrunch.com/tag/seed-funding/",
    goal: "New seed funding announcements for AI-native startups under $10M",
  },
  {
    name: "ai-grant",
    url: "https://aigrant.com/",
    goal: "New AI Grant recipients or batch announcements",
  },
];

async function createMonitor(monitor: (typeof MONITORS)[0]): Promise<{ id: string; name: string }> {
  const res = await fetch(`${FIRECRAWL_API}/monitor`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: monitor.name,
      schedule: { text: "every 4 hours", timezone: "America/Los_Angeles" },
      goal: monitor.goal,
      targets: [
        {
          type: "scrape",
          urls: [monitor.url],
          scrapeOptions: { formats: ["markdown"] },
        },
      ],
      notification: {
        webhook: {
          url: WEBHOOK_URL,
          headers: {
            "x-firecrawl-secret": process.env.FIRECRAWL_WEBHOOK_SECRET ?? "",
          },
        },
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to create monitor "${monitor.name}": ${err}`);
  }

  const data = await res.json() as { id: string };
  return { id: data.id, name: monitor.name };
}

async function main() {
  console.log(`Creating ${MONITORS.length} Firecrawl monitors...\n`);

  const created: Record<string, string> = {};

  for (const monitor of MONITORS) {
    try {
      const result = await createMonitor(monitor);
      created[result.id] = result.name;
      console.log(`Created: ${result.name} → ${result.id}`);
    } catch (err) {
      console.error(`Error: ${err}`);
    }
  }

  console.log("\n--- Add to .env ---");
  console.log(`FIRECRAWL_MONITOR_IDS='${JSON.stringify(created)}'`);
  console.log("-------------------\n");
  console.log("Monitor IDs (map of id → name):");
  console.log(JSON.stringify(created, null, 2));
}

main();
