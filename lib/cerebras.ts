import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'https://api.cerebras.ai/v1',
  apiKey: process.env.CEREBRAS_API_KEY,
});

const PRIMARY_MODEL = 'gemini 3.1-flash-lite';
const FALLBACK_MODEL = 'gemma 4 31b';

const SCORING_SYSTEM_PROMPT = `
You are a startup scout for an early-stage investor with a very specific thesis.

INVESTOR THESIS:
Back technical founders from elite institutions or top-tier companies (Goldman Sachs, 
Google, FAANG, quant funds, top-10 CS programs) building hard technical infrastructure 
or tooling in AI, fintech, or adjacent spaces. Enterprise or developer buyer. 
Not consumer, not no-code, not LLM wrappers.

COMPANIES THIS INVESTOR HAS LOVED:
- Unsiloed AI: ex-Goldman credit risk analyst, institutional-grade trading tools via AI. 
  Deep domain pedigree, clear enterprise GTM.
- Thesis Labs: ex-Google, foundational LLM patents, AI research as combinatorial search. 
  Extreme founder-market fit.
- Laminar: open-source observability/tracing for AI agents. Infrastructure layer, 
  strong CS background, early engineer pedigree.
- Tensormesh: serverless caching to cut AI inference cost 10x. Hard infra problem, 
  massive cost savings.
- Elastics: AI trading infrastructure for prediction markets. Niche, defensible, 
  automation-heavy.
- Blue: voice-first AI hardware dongle for hands-free smartphone control. 
  Novel form factor, real product.

WHAT TO DEPRIORITISE:
- Generic LLM chatbots or wrappers with no model/data advantage
- Consumer social apps
- No-code/low-code tools for non-technical users  
- Vague "AI-powered" products with no clear technical substance
- Founders with no domain expertise or elite pedigree
- YC-backed companies (acceptable only if exceptional — apply -2 penalty to thesis_fit)

HARD LIMITS (drop before scoring if any are true):
- Over 20 employees
- Over $10M total funding raised
- Series A or later stage
- Founded before 2022

ALWAYS respond with valid JSON only. No preamble. No markdown fences.
`;

export async function triage(payload: string, seenUrlsMd: string) {
  const prompt = `
Analyze this startup announcement webhook payload:
${payload}

SEEN URLS (do not pursue if matched here):
${seenUrlsMd}

Return JSON ONLY:
{
  "worth_pursuing": boolean,
  "reason": string,
  "company_name": string | null,
  "company_url": string | null,
  "already_seen": boolean
}
`;
  return await callJson<any>(prompt, SCORING_SYSTEM_PROMPT);
}

export async function qualify(payload: string, research: string, shortlistMd: string) {
  const prompt = `
PAYLOAD:
${payload}

RESEARCH:
${research}

SHORTLIST (For pattern recognition):
${shortlistMd}

Decide if we should enrich this via Exa. Return JSON ONLY:
{
  "qualifies": boolean,
  "confidence": "high" | "medium" | "low",
  "reason": string,
  "worth_exa_enrichment": boolean
}
`;
  return await callJson<any>(prompt, SCORING_SYSTEM_PROMPT);
}

export async function scoreCompany(data: any, shortlistMd: string, triggerContext: string) {
  const prompt = `
SHORTLIST (companies this investor has already approved — use for pattern recognition):
---
${shortlistMd}
---

STARTUP TO EVALUATE:
Name: ${data.companyName}
Website: ${data.websiteUrl}
Founded: ${data.foundedYear}
Funding Stage: ${data.fundingStage}
Total Funding: ${data.fundingTotal}
Headcount: ${data.workforce}
Monthly Web Traffic: ${data.webTraffic}
Headquarters: ${data.headquarters}
YC-Backed: ${data.isYC}

PRODUCT SUMMARY (from web research):
${data.productSummary}

FOUNDERS:
${data.foundersList}

NEGATIVE SIGNALS FOUND:
${data.negativeSignals}

SOURCE CONTEXT:
${triggerContext}

---
Score across these 5 dimensions (1–10 each):
founder_pedigree (weight: 25%)
technical_moat (weight: 25%)
thesis_fit (weight: 25%)
traction_signals (weight: 15%)
market_timing (weight: 10%)

Compute overall_score as:
(founder_pedigree × 0.25) + (technical_moat × 0.25) + (thesis_fit × 0.25) + 
(traction_signals × 0.15) + (market_timing × 0.10)
Round to 1 decimal place.

Pass if: overall_score >= 6.5 AND thesis_fit >= 6

Return EXACTLY this JSON:
{
  "company_name": string,
  "overall_score": number,
  "scores": {
    "founder_pedigree": number,
    "technical_moat": number,
    "thesis_fit": number,
    "traction_signals": number,
    "market_timing": number
  },
  "one_liner": string,
  "why_interesting": string,
  "red_flags": string[],
  "yc_backed": boolean,
  "pass": boolean,
  "already_seen": boolean
}
`;
  return await callJson<any>(prompt, SCORING_SYSTEM_PROMPT);
}

export async function reasonCronPlan(shortlistMd: string, signalsMd: string, seenUrlsMd: string, timeContext: string) {
  const prompt = `
Create a search plan for the proactive scout run. Rotate through general AI startup search, VC directory browsing, technical founder search, specific niche searches based on thesis gaps.
Don't check the same VC directory twice in a row.

SHORTLIST:
${shortlistMd}

SIGNALS:
${signalsMd}

TIME CONTEXT:
${timeContext}

Return JSON ONLY:
{
  "search_intent": string,
  "linkup_queries": string[],
  "vc_directories_to_check": string[],
  "exa_query": string | null,
  "reasoning": string
}
`;
  return await callJson<any>(prompt, SCORING_SYSTEM_PROMPT);
}

export async function batchQualify(candidates: any[], shortlistMd: string) {
  const prompt = `
Evaluate these candidates to see which top 3 to enrich with Exa.
CANDIDATES:
${JSON.stringify(candidates, null, 2)}

SHORTLIST:
${shortlistMd}

Return JSON ONLY (array of objects):
[
  { "url": string, "qualifies": boolean, "reason": string }
]
`;
  return await callJson<any[]>(prompt, SCORING_SYSTEM_PROMPT);
}

export async function synthesizeDailyBrief(runLogs: string, shortlistMd: string) {
  const prompt = `
Generate a daily brief synthesis based on today's runs.
RUN LOGS TODAY:
${runLogs}

SHORTLIST:
${shortlistMd}

Return JSON ONLY:
{
  "runs_today": number,
  "triggers_fired": number,
  "companies_passed": number,
  "patterns_noticed": string,
  "suggested_focus": string
}
`;
  return await callJson<any>(prompt, SCORING_SYSTEM_PROMPT);
}

async function callJson<T>(prompt: string, system: string = ''): Promise<T> {
  let res;
  try {
    res = await openai.chat.completions.create({
      model: PRIMARY_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      response_format: { type: "json_object" }
    });
  } catch (err: any) {
    if (err?.status === 429 || err?.code === 'rate_limit_exceeded') {
      console.warn(`[LLM] Rate limit hit for ${PRIMARY_MODEL}. Falling back to ${FALLBACK_MODEL}...`);
      res = await openai.chat.completions.create({
        model: FALLBACK_MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        response_format: { type: "json_object" }
      });
    } else {
      throw err;
    }
  }

  const content = res.choices[0].message.content || '{}';
  try {
    return JSON.parse(content);
  } catch (e) {
    // Attempt to strip markdown fences if the model misbehaves
    const match = content.match(/```(?:json)?\s*(\{[\s\S]*\}|\[[\s\S]*\])\s*```/);
    if (match) {
      return JSON.parse(match[1]);
    }
    console.error('[LLM] Failed to parse JSON', content);
    throw new Error('Failed to parse JSON response');
  }
}
