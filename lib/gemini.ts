/**
 * lib/gemini.ts
 *
 * Scores a startup using Google Gemini 3.1 Flash Lite via OpenAI-compatible API.
 *
 * Base URL: https://generativelanguage.googleapis.com/v1beta/openai/
 * Model: gemini-3.1-flash-lite
 */

import OpenAI from "openai";
import type { EnrichedCandidate, ScoredStartup } from "./types.js";

const gemini = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY || "dummy-key",
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});

const SYSTEM_PROMPT = `You are a startup scout for an early-stage investor. Your job is to evaluate startups against a very specific investment thesis and score them accordingly.

THE INVESTOR'S THESIS:
The investor backs technical founders from elite institutions or top-tier companies (Goldman Sachs, Google, FAANG, quant funds, top-10 CS programs) who are building hard technical infrastructure or tooling in AI, fintech, or adjacent spaces. They are NOT interested in LLM wrappers, consumer apps, no-code tools, or companies with no defensible technical moat.

WHAT THIS INVESTOR HAS LOVED IN THE PAST:
- Unsiloed AI: ex-Goldman Sachs credit risk analyst democratizing institutional-grade trading tools via AI. Deep domain pedigree, clear enterprise GTM.
- Thesis Labs: ex-Google, early foundational LLM patents, automating AI research discovery as a combinatorial search problem. Extreme founder-market fit.
- Laminar: open-source observability and tracing for AI agents and LLM pipelines. Infrastructure layer, strong CS background, early engineer pedigree.
- Tensormesh: serverless caching to reduce AI inference latency and cost up to 10x. Hard infrastructure problem with massive cost savings.
- Elastics: AI-driven trading infrastructure for prediction markets. Niche vertical, automation-heavy, defensible.
- Blue: voice-first AI hardware dongle for hands-free smartphone automation. Novel form factor, real product, not just software.

WHAT THIS INVESTOR DOES NOT LIKE:
- Generic LLM chatbots or wrappers with no unique model or data advantage
- Consumer social apps
- No-code or low-code tools aimed at non-technical users
- ANY startup based outside the United States (auto-fail thesis_fit)
- Companies with vague or marketing-heavy websites and no clear technical substance
- Founders with no relevant domain expertise or elite pedigree

SCORING RUBRIC:
Score each dimension 1–10. Be strict. A 7 should feel like a genuinely strong company. Reserve 9–10 for exceptional cases only.

ALWAYS respond with valid JSON only. No preamble. No markdown fences. No explanation outside the JSON.`;

function buildUserPrompt(candidate: EnrichedCandidate, registry: string): string {
  const foundersList = candidate.founders.length > 0
    ? candidate.founders
        .map((f) => `${f.name} (${f.title}) — ${f.linkedInUrl}`)
        .join(";\n")
    : "No founders found";
    
  const isYC = (candidate.name.toLowerCase().includes("y combinator") || 
                candidate.url.toLowerCase().includes("ycombinator") || 
                candidate.websiteSummary.toLowerCase().includes("y combinator") ||
                /\byc\b/i.test(candidate.name) || /\byc\b/i.test(candidate.websiteSummary)) 
                ? "Yes" : "No";

  return `SEEN STARTUPS REGISTRY (do not re-surface any company whose URL appears here):
---
${registry}
---

STARTUP TO EVALUATE:

Name: ${candidate.name}
Website: ${candidate.url}
Founded: ${candidate.foundedYear ?? "Unknown"}
Funding Stage: ${candidate.fundingStage ?? "Unknown"}
Total Funding Raised: ${candidate.fundingTotal ?? "Unknown"}
Latest Round: ${candidate.latestRound ?? "Unknown"} (${candidate.latestRoundDate ?? "Unknown"})
Headcount: ${candidate.workforce ?? "Unknown"}
Monthly Web Traffic: ${candidate.webTraffic ?? "Unknown"}
Headquarters: ${candidate.headquarters ?? "Unknown"}
YC-Backed: ${isYC}

WEBSITE SUMMARY:
${candidate.websiteSummary || "No summary available"}

FOUNDERS:
${foundersList}
(Include: name, current title, LinkedIn URL, work history — especially prior employers and roles)

SIGNAL RESEARCH:
Headcount / Hiring signals: ${candidate.signalResearch.headcount}
Team stability signals: ${candidate.signalResearch.stability}
Customer / Traction signals: ${candidate.signalResearch.traction}

---

Score this startup across the following dimensions:

1. founder_pedigree (1–10)
   Does the founder come from an elite institution or top-tier company (Goldman, Google, FAANG, top quant fund, top-10 CS program)? Is their prior role directly relevant to what they are building now? High score = clear domain expert with traceable elite background. Low score = no identifiable pedigree or irrelevant background.

2. technical_moat (1–10)
   Is there genuine hard technology here — novel infrastructure, proprietary models, unique data, or deep systems work? Or is it a thin wrapper on top of OpenAI? High score = defensible, hard to replicate. Low score = prompt engineering dressed up as a product.

3. thesis_fit (1–10)
   How well does this company match the investor's thesis: technical infra or tooling in AI, fintech, or adjacent spaces, targeting enterprise or developer buyers, with a clear B2B or infrastructure angle? Penalise to 0 automatically if outside the United States. Penalise -3 for consumer apps. Penalise -3 for no-code/low-code aimed at non-technical users.

4. traction_signals (1–10)
   Evidence of real-world momentum: paying customers, published partnerships, meaningful web traffic growth, open-source adoption, waitlist size, press coverage of product launches. Not fundraising announcements alone.

5. market_timing (1–10)
   Is this the right moment for this company to exist? Is the underlying infrastructure or market shift happening right now in a way that makes this defensible and timely?

Also identify any RED FLAGS from the signal research. A red flag is something negative that the investor should know but that does not automatically disqualify the company. Examples: dropping headcount, founder departure, pivot away from original thesis, very slow web traffic growth, no public product or customers visible.

Respond with EXACTLY this JSON schema and nothing else:

{
  "company_name": string,
  "overall_score": number (1–10, weighted average: founder_pedigree ×0.25 + technical_moat ×0.25 + thesis_fit ×0.25 + traction_signals ×0.15 + market_timing ×0.10),
  "scores": {
    "founder_pedigree": number,
    "technical_moat": number,
    "thesis_fit": number,
    "traction_signals": number,
    "market_timing": number
  },
  "one_liner": string (max 20 words — what the company actually does, no marketing fluff),
  "why_interesting": string (max 50 words — the investment thesis for this specific company, grounded in founder background and technical angle),
  "red_flags": string[] (array of short strings, each a specific observed signal — empty array [] if none),
  "yc_backed": boolean,
  "pass": boolean (true if overall_score >= 6.5 AND thesis_fit >= 6),
  "already_seen": boolean (true if this company's URL appears in the registry above)
}`;
}

let useFallbackUntil = 0;

export async function scoreStartup(
  candidate: EnrichedCandidate,
  registry: string
): Promise<ScoredStartup> {
  const fallback: ScoredStartup = {
    ...candidate,
    overall_score: 0,
    scores: {
      founder_pedigree: 0,
      technical_moat: 0,
      thesis_fit: 0,
      traction_signals: 0,
      market_timing: 0,
    },
    one_liner: candidate.name,
    why_interesting: "",
    red_flags: [],
    yc_backed: false,
    pass: false,
    already_seen: false,
  };

  const now = Date.now();
  let modelToUse = "gemini-3.1-flash-lite";
  if (now < useFallbackUntil) {
    modelToUse = "gemma-4-31b-it";
    console.log(`[gemini] Circuit breaker active. Routing "${candidate.name}" to fallback model "${modelToUse}".`);
  }

  const executeCompletion = async (model: string): Promise<ScoredStartup> => {
    const response = await gemini.chat.completions.create({
      model: model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(candidate, registry) },
      ],
      temperature: 0.2,
      max_tokens: 1024,
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "";
    if (!raw) {
      console.warn(`[gemini] Empty response from model "${model}" for "${candidate.name}"`);
      return fallback;
    }

    const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(jsonStr);

    if (
      typeof parsed.overall_score !== "number" ||
      typeof parsed.pass !== "boolean" ||
      !parsed.scores
    ) {
      console.warn(`[gemini] Unexpected JSON shape from model "${model}" for "${candidate.name}":`, parsed);
      return fallback;
    }
    
    // Explicitly recalculate overall score to ensure math is right
    const s = parsed.scores;
    const computedScore = (
      (s.founder_pedigree ?? 0) * 0.25 +
      (s.technical_moat ?? 0) * 0.25 +
      (s.thesis_fit ?? 0) * 0.25 +
      (s.traction_signals ?? 0) * 0.15 +
      (s.market_timing ?? 0) * 0.10
    );
    
    // Parse thresholds from env, fallback to defaults
    const scoreThreshold = parseFloat(process.env.PASS_SCORE_THRESHOLD || "6.5");
    const thesisThreshold = parseFloat(process.env.PASS_THESIS_THRESHOLD || "6");
    
    const truePass = computedScore >= scoreThreshold && (s.thesis_fit ?? 0) >= thesisThreshold;

    return {
      ...candidate,
      overall_score: parseFloat(computedScore.toFixed(1)),
      scores: {
        founder_pedigree: s.founder_pedigree ?? 0,
        technical_moat: s.technical_moat ?? 0,
        thesis_fit: s.thesis_fit ?? 0,
        traction_signals: s.traction_signals ?? 0,
        market_timing: s.market_timing ?? 0,
      },
      one_liner: parsed.one_liner ?? candidate.name,
      why_interesting: parsed.why_interesting ?? "",
      red_flags: Array.isArray(parsed.red_flags) ? parsed.red_flags : [],
      yc_backed: parsed.yc_backed ?? false,
      pass: truePass,
      already_seen: parsed.already_seen ?? false,
    };
  };

  try {
    return await executeCompletion(modelToUse);
  } catch (err: any) {
    const isRateLimit = 
      err?.status === 429 || 
      err?.statusCode === 429 || 
      err?.message?.includes("429") || 
      err?.code === "rate_limit_exceeded";

    if (isRateLimit && modelToUse === "gemini-3.1-flash-lite") {
      console.warn(`[gemini] Rate limit hit (429) for "${candidate.name}". Activating fallback to "gemma-4-31b-it" for 60 seconds.`);
      useFallbackUntil = Date.now() + 60000;
      
      try {
        console.log(`[gemini] Retrying scoring for "${candidate.name}" using fallback model "gemma-4-31b-it"`);
        return await executeCompletion("gemma-4-31b-it");
      } catch (retryErr) {
        console.error(`[gemini fallback] Retry scoring with fallback model failed for "${candidate.name}":`, retryErr);
        return fallback;
      }
    }

    console.error(`[gemini] Scoring failed for "${candidate.name}" using model "${modelToUse}":`, err);
    return fallback;
  }
}
