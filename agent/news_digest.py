"""Weekly VC market-intel digest — research, reflect, learn (no thesis edits)."""

# Explicit source buckets the digest targets (Linkup searches use includeDomains).
MONITORED_SOURCES = {
    "vc_news": [
        "TechCrunch (techcrunch.com)",
        "Axios (axios.com)",
        "VentureBeat (venturebeat.com)",
        "General pre-seed / seed / AI funding news (past ~7 days)",
    ],
    "fund_blogs": [
        "a16z (a16z.com)",
        "Sequoia (sequoiacap.com)",
        "Benchmark (benchmark.com)",
        "First Round Review (firstround.com)",
        "NFX (nfx.com)",
        "Founders Fund (foundersfund.com)",
        "Greylock (greylock.com)",
        "Lightspeed (lsvp.com)",
        "Bessemer (bvp.com)",
        "Index Ventures (indexventures.com)",
        "Accel (accel.com)",
        "Y Combinator (ycombinator.com)",
    ],
    "individual_investors": [
        "Paul Graham (paulgraham.com)",
        "Sam Altman (blog.samaltman.com)",
        "Benedict Evans (ben-evans.com)",
        "Lenny Rachitsky (lennysnewsletter.com)",
        "Packy McCormick (notboring.co)",
        "Prominent VC / operator substacks on pre-seed & AI",
    ],
}

VC_NEWS_DOMAINS = [
    "techcrunch.com",
    "axios.com",
    "venturebeat.com",
    "theinformation.com",
]

FUND_BLOG_DOMAINS = [
    "a16z.com",
    "sequoiacap.com",
    "benchmark.com",
    "firstround.com",
    "nfx.com",
    "foundersfund.com",
    "greylock.com",
    "lsvp.com",
    "bvp.com",
    "indexventures.com",
    "accel.com",
    "lightspeedvp.com",
    "ycombinator.com",
]

INVESTOR_DOMAINS = [
    "paulgraham.com",
    "blog.samaltman.com",
    "ben-evans.com",
    "lennysnewsletter.com",
    "notboring.co",
    "substack.com",
]

# Parallel Linkup standard searches for turn 1 (fromDate = last 7 days applied in run_news_digest).
DIGEST_LINKUP_SEARCHES = [
    {
        "q": "latest venture capital startup funding and AI deals",
        "include_domains": VC_NEWS_DOMAINS,
        "depth": "standard",
    },
    {
        "q": "pre-seed and seed AI startup funding announcements",
        "include_domains": None,
        "depth": "standard",
    },
    {
        "q": "latest venture capital blog posts on AI and early-stage investing",
        "include_domains": FUND_BLOG_DOMAINS,
        "depth": "standard",
    },
    {
        "q": "latest essays and newsletter posts on startups and venture investing",
        "include_domains": INVESTOR_DOMAINS,
        "depth": "standard",
    },
    {
        "q": "Paul Graham recent essay startup",
        "include_domains": ["paulgraham.com"],
        "depth": "standard",
    },
    {
        "q": "Not Boring Packy McCormick venture recent",
        "include_domains": ["notboring.co", "substack.com"],
        "depth": "standard",
    },
]


def monitored_sources_text() -> str:
    lines = []
    for bucket, sources in MONITORED_SOURCES.items():
        label = bucket.replace("_", " ").title()
        lines.append(f"{label}:")
        for s in sources:
            lines.append(f"  - {s}")
    return "\n".join(lines)


def digest_searches_prompt() -> str:
    lines = []
    for spec in DIGEST_LINKUP_SEARCHES:
        domains = spec.get("include_domains") or "any"
        lines.append(f"- q: {spec['q']} | domains: {domains}")
    return "\n".join(lines)


NEWS_DIGEST_RULES = """You run a weekly market-intel brief for a pre-seed AI scout.

Your job:
1. Read the latest VC/industry news, top fund blogs, and prominent individual investor writing from the past week.
2. Reflect on what it means for sourcing sharper picks and refining SOFT scoring instincts.
3. Save a structured weekly brief and any useful seek/avoid patterns.

Search tools:
- Use linkup_search_many for news, fund blogs, and investor writing (NOT exa_deep_search).
- Use linkup_fetch only when you need the full markdown body of a specific URL from your results.
- Use exa only if Linkup returns nothing useful for a topic (rare).

Output rules for links (required):
- Every important item in write_market_brief MUST include the source URL from your Linkup results (format: title — https://...).
- Group links under three sections: VC news, Fund blogs, Individual investors.
- Your final SMS-style reply must include the top 5-8 links inline (one per line, full URL). Do not omit URLs for items you mention.
- If you cannot find a URL for a claim, do not include that claim.

Hard rules (non-negotiable):
- NEVER call update_thesis. The boss's hard filters in the thesis are fixed (stage, raised, team size, founded date, traction requirements, no-press rule). You may reference them but must not change, weaken, or overwrite them.
- Only update soft learnings via write_preferences (seek/avoid patterns) and write_reflection.
- Save the full brief with write_market_brief before you finish.
- Finish all tool calls before your final reply."""
