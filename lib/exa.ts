/**
 * lib/exa.ts
 *
 * Exa.ai API helpers for company discovery, website verification, and founder lookup.
 *
 * Three search modes:
 *  1. runExaCompanySearch  — category:"company", discovers new startups
 *  2. runExaFastSearch     — type:"fast" on a URL, extracts site summary
 *  3. runExaPeopleSearch   — category:"people", finds founders/CEOs
 */

import _Exa from "exa-js";
import type { Candidate, Founder } from "./types.js";

const Exa = _Exa as unknown as new (apiKey: string) => any;
const exa = new Exa(process.env.EXA_API_KEY!);

// ---------------------------------------------------------------------------
// 1. Company Discovery
// ---------------------------------------------------------------------------

/**
 * Searches Exa for companies matching the given query.
 * Returns up to 10 normalized Candidate objects per call.
 */
export async function runExaCompanySearch(query: string, excludedDomains?: string[]): Promise<Candidate[]> {
  try {
    const searchOptions: any = {
      category: "company",
      type: "auto",
      numResults: 10,
      contents: {
        highlights: {
          numSentences: 3,
          highlightsPerUrl: 2,
        },
      },
    };

    const defaultExcludes = ["ycombinator.com", "workatastartup.com"];
    const allExcludes = excludedDomains
      ? [...new Set([...excludedDomains, ...defaultExcludes])]
      : defaultExcludes;

    if (allExcludes.length > 0) {
      searchOptions.excludeDomains = allExcludes;
    }

    const result = await exa.search(query, searchOptions);

    return (result.results ?? []).map((r: any) => normalizeCompanyResult(r));
  } catch (err) {
    console.error(`[exa] Company search failed for query "${query}":`, err);
    return [];
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeCompanyResult(r: any): Candidate {
  const props = r.entity?.properties ?? {};
  const financials = props.financials ?? {};
  const latestRound = financials.fundingLatestRound ?? {};

  return {
    name: r.title ?? r.entity?.properties?.name ?? "Unknown",
    url: r.url ?? "",
    foundedYear: props.foundedYear ?? undefined,
    fundingStage: latestRound.type ?? financials.fundingStage ?? undefined,
    fundingTotal: financials.fundingTotal != null
      ? formatCurrency(financials.fundingTotal)
      : undefined,
    latestRound: latestRound.type ?? undefined,
    latestRoundDate: latestRound.date ?? undefined,
    workforce: props.workforce?.total ?? undefined,
    webTraffic: props.webTraffic?.visitsMonthly ?? undefined,
    headquarters: formatHeadquarters(props.headquarters),
  };
}

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount}`;
}

function formatHeadquarters(hq: unknown): string | undefined {
  if (!hq || typeof hq !== "object") return undefined;
  const h = hq as Record<string, string>;
  return [h.city, h.state, h.country].filter(Boolean).join(", ") || undefined;
}

// ---------------------------------------------------------------------------
// 2. Website Verification (Fast Search)
// ---------------------------------------------------------------------------

/**
 * Runs a fast Exa search on a specific company URL.
 * Returns a single string of joined highlights, or empty string on failure.
 */
export async function runExaFastSearch(url: string): Promise<string> {
  try {
    const result = await exa.search(`site:${url}`, {
      type: "fast",
      numResults: 1,
      contents: {
        highlights: {
          numSentences: 5,
          highlightsPerUrl: 3,
        },
      },
    } as Parameters<typeof exa.search>[1]);

    const firstResult = result.results?.[0];
    if (!firstResult) return "";

    const highlights = (firstResult as unknown as { highlights?: string[] }).highlights ?? [];
    return highlights.join(" ").trim();
  } catch (err) {
    console.error(`[exa] Fast search failed for URL "${url}":`, err);
    return "";
  }
}

// ---------------------------------------------------------------------------
// 3. Founder LinkedIn Lookup
// ---------------------------------------------------------------------------

/**
 * Searches Exa for founders/CEOs at the given company.
 * Filters results to only include people whose most recent role matches
 * the company name (fuzzy, case-insensitive).
 * Returns up to 2 matching Founder objects.
 */
export async function runExaPeopleSearch(companyName: string): Promise<Founder[]> {
  try {
    const result = await exa.search(
      `founder CEO co-founder at ${companyName}`,
      {
        category: "people",
        type: "auto",
        numResults: 3,
        contents: {
          highlights: {
            numSentences: 2,
            highlightsPerUrl: 1,
          },
        },
      } as Parameters<typeof exa.search>[1]
    );

    const companyLower = companyName.toLowerCase();

    const founders: Founder[] = [];
    for (const r of result.results ?? []) {
      const props = (r as unknown as { entity?: { properties?: Record<string, unknown> } })
        .entity?.properties ?? {};
      const workHistory = (props.workHistory as Array<{ title?: string; company?: { name?: string } }>) ?? [];
      const latestRole = workHistory[0];

      // Fuzzy match: current company contains or is contained by the search name
      const roleCompany = (latestRole?.company?.name ?? "").toLowerCase();
      const isMatch =
        roleCompany.includes(companyLower) ||
        companyLower.includes(roleCompany) ||
        roleCompany === "";

      if (!isMatch) continue;

      const name =
        `${props.firstName ?? ""} ${props.lastName ?? ""}`.trim() ||
        (r.title ?? "Unknown");

      const title = latestRole?.title ?? "Founder";
      
      // Extract prior employers for pedigree checking
      const priorRoles = workHistory.slice(1).map(w => `${w.company?.name ?? "Unknown"} (${w.title ?? "Unknown"})`);
      const fullTitle = priorRoles.length > 0 ? `${title} | Prior: ${priorRoles.join(", ")}` : title;

      founders.push({
        name,
        title: fullTitle,
        linkedInUrl: r.url ?? "",
      });

      if (founders.length >= 2) break;
    }

    return founders;
  } catch (err) {
    console.error(`[exa] People search failed for "${companyName}":`, err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// 4. Signal Research (Parallel Fast Searches)
// ---------------------------------------------------------------------------

/**
 * Runs 3 parallel Exa fast searches to gather thesis signals on the company.
 */
export async function runExaSignalResearch(companyName: string): Promise<{ headcount: string; stability: string; traction: string }> {
  try {
    const result = await exa.search(
      `"${companyName}" (layoffs OR hiring OR headcount OR "founder left" OR pivot OR customer OR revenue OR partnership OR waitlist)`,
      {
        type: "auto",
        numResults: 3,
        contents: {
          highlights: {
            numSentences: 3,
            highlightsPerUrl: 2,
          },
        },
      } as Parameters<typeof exa.search>[1]
    );

    const highlightsList = (result.results ?? []).map((r: any) => {
      const h = r.highlights ?? [];
      return h.join(" ").trim();
    }).filter(Boolean);

    const allSignals = highlightsList.join("\n\n") || "No clear signals found.";

    return {
      headcount: allSignals,
      stability: allSignals,
      traction: allSignals,
    };
  } catch (err) {
    console.error(`[exa] Signal research failed for "${companyName}":`, err);
    return {
      headcount: "Search failed.",
      stability: "Search failed.",
      traction: "Search failed.",
    };
  }
}

