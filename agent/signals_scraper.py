"""
Signal scraper pipeline — crawls multiple sources for early-stage AI startup signals,
deduplicates / scores / filters with regex heuristics, then runs a final Gemma 4
(Cerebras-hosted, gemma-4-31b) structured-output pass to approve only genuine
opportunities.

Writes approved signals to the Supabase `signals` table.
"""

import asyncio
import random
import re
import json
import time
import os
import urllib.parse
from datetime import datetime, timezone, timedelta

import httpx
from supabase import create_client

import cache
import social_classifier

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

AI_KEYWORDS = {
    "agentic": r"\bagent(?:s|ic|ic\s+frameworks?)?\b",
    "llm": r"\bllm(?:s)?\b",
    "gpt": r"\bgpt(?:s|-4|-3|4o)?\b",
    "rag": r"\brag\b",
    "copilot": r"\bcopilot(?:s)?\b",
    "vector": r"\bvector\s+(?:db|database|index|search)\b",
    "ai_general": r"\b(?:ai|artificial\s+intelligence|generative\s+ai|genai)\b",
    "openai_models": r"\b(?:openai|anthropic|claude|llama|gemini)\b",
    "models": r"\b(?:model\s+training|fine-tun(?:ing|ed)|embeddings?|custom\s+models?)\b",
    "infra": r"\b(?:gpu|gpus|cluster|compute|infrastructure|data\s+center)\b",
}

SELF_REFERENTIAL = [r"\b(?:we|i|our|my|us)\b"]

NEWS_INDICATORS = [
    r"\b(?:reportedly|unveils|unveiled|announces|announced|released|releases)\s+(?:openai|google|meta|microsoft|apple|anthropic|gemini|chatgpt|claude)\b",
    r"\b(?:government|regulation|washington|white\s+house|congress|bill|regulatory|politics|policymaker|lawmakers?)\b",
    r"\b(?:exclusive:|just\s+in:|breaking:)\b",
]

NON_US_CURRENCIES = r"\b(?:₹|rs\.?|lakhs?|crores?|£|€|¥|inr|eur|gbp|rupees?)\b"
NON_US_GEOGRAPHY = r"\b(?:india|indian|uk|united\s+kingdom|london|germany|german|berlin|france|french|paris|china|chinese|beijing|europe|european|australia|australian|canada|canadian|singapore|italy|italian|bocconi|mumbai|bangalore)\b"

LATE_STAGE_OR_BIG_TECH = [
    r"\bseries\s+[a-fA-F]\b",
    r"\bseries-[a-fA-F]\b",
    r"\bseries\s+funding\b",
    r"\b(?:ipo|acquisition|acquired|buyout|merger|merged)\b",
    r"\b(?:microsoft|google|meta|facebook|apple|amazon|nvidia|netflix|tesla|rippling|notion|salesforce|zoom|uber|airbnb|openai|anthropic|claude|gemini|chatgpt|bing|coingabbar|fabric)\b",
]

LAUNCH_TRIGGERS = [
    r"\b(?:we|i)(?:\s+have|\s+'ve)?\s+(?:launched|released|shipped|built)\b",
    r"\bjust\s+(?:launched|shipped|released|built)\b",
    r"\bnow\s+live\b", r"\bwe\s+are\s+live\b",
    r"\btry\s+(?:it|our\s+beta|our\s+mvp|our\s+demo)\s+at\b",
    r"\bbeta\s+launch\b", r"\bwe\s+built\s+a\s+tool\b",
    r"\bi\s+built\s+a\s+tool\b", r"\bour\s+new\s+product\b",
    r"\bjust\s+created\b", r"\bbuilding\s+a\s+new\b",
]

RAISE_TRIGGERS = [
    r"\b(?:we|i)(?:\s+have|\s+'ve)?\s+(?:raised|secured|closed)\b",
    r"\braising\s+our\s+(?:pre-seed|seed|round)\b",
    r"\bannouncing\s+our\s+(?:pre-seed|seed|funding|round)\b",
    r"\bour\s+pre-seed\s+round\b", r"\bour\s+seed\s+round\b",
    r"\braised\s+(?:\$\d+|[\d\.]+m|[\d\.]+k)\b",
]

SHOWCASE_TRIGGERS = [
    r"\bstealth\s+mode\b", r"\bpre-launch\b", r"\bfirst\s+check\b",
    r"\bhere\s+is\s+what\s+i\s+(?:built|am\s+building)\b",
    r"\bhere\s+is\s+what\s+we\s+(?:built|are\s+building)\b",
    r"\bdemo\s+of\s+our\b",
]

ADVISORY_NOISE = [
    r"\bcomment\s+[\"']?\w+[\"']?\s+below\b", r"\bnewsletter\b",
    r"\bdealmakers\s+podcast\b", r"\bmost\s+founders\b",
    r"\bwhy\s+founders\b", r"\btips\s+for\b", r"\blessons\s+from\b",
    r"\bhow\s+to\s+write\b", r"\bmistakes\s+founders\b",
    r"\bchecklists?\b", r"\badvising\s+founders\b", r"\bconsultant\b",
]

GIANT_CREATORS = [
    "openai", "google", "meta", "anthropic", "mistral",
    "microsoft", "deepseek", "qwen", "cohere", "databricks",
]

GITHUB_AI_KEYWORDS = [
    r"\bai\b", r"\bagent(?:s|ic)?\b", r"\bllm(?:s)?\b", r"\bgpt(?:s)?\b",
    r"\brag\b", r"\bcopilot(?:s)?\b", r"\bvector\b", r"\bmodel(?:s)?\b",
    r"\bembeddings?\b", r"\bneural\b", r"\bmachine\s+learning\b", r"\bdeep\s+learning\b",
]

CATEGORY_MAP = {
    "LinkedIn": "social",
    "X (Twitter)": "social",
    "GitHub": "developer",
    "Show HN": "developer",
    "Hugging Face": "developer",
    "Product Hunt": "developer",
    "YC Launches": "accelerator",
    "South Park Commons": "accelerator",
    "Founders Inc": "accelerator",
    "Neo": "accelerator",
    "Work at a Startup": "traction",
}

# Minimum HN points for a Show HN submission to count as real traction (soft boost, not a hard cutoff).
MIN_HN_POINTS_STRONG = 20
MIN_HN_POINTS_WEAK = 8

HN_NOISE_PATTERNS = [
    r"\bside\s+project\b", r"\bweekend\s+project\b", r"\bfor\s+fun\b",
    r"\bmy\s+first\b", r"\btoy\b", r"\blearning\s+project\b",
    r"\bjust\s+for\s+practice\b", r"\bpractice\s+project\b", r"\bhobby\s+project\b",
]

# YC batch codes considered "2025+" (Winter/Summer 25 onward).
MIN_YC_BATCH_YEAR = 25

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def favicon_url(source_url: str) -> str:
    try:
        domain = urllib.parse.urlparse(source_url).netloc or source_url
        return f"https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://{domain}&size=32"
    except Exception:
        return ""


def is_us_linkedin_url(url: str) -> bool:
    try:
        subdomain = urllib.parse.urlparse(url).netloc.split(".")[0]
        if len(subdomain) == 2 and subdomain != "us":
            return False
        return True
    except Exception:
        return True


def parse_snippet_date(body: str):
    m = re.match(r"^([A-Za-z]{3,9})\s+(\d+),\s+(202\d)", body)
    if not m:
        return None
    month_map = {
        "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
        "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
    }
    try:
        mn = month_map.get(m.group(1).lower()[:3])
        if mn:
            return datetime(int(m.group(3)), mn, int(m.group(2)))
    except Exception:
        pass
    return None


MAX_RECENCY_DAYS = 3


def is_recent_time(t: str | None) -> bool:
    """Only used for LinkedIn/X candidates. Fails open (True) when no time signal
    could be extracted at all, since we'd rather over-include than silently drop a
    post — the 3-day cutoff still applies wherever a real age is known."""
    if not t:
        return True
    t = t.strip().lower()
    if re.match(r"^\d+h$", t):
        return True
    dm = re.match(r"^(\d+)d$", t)
    if dm:
        return int(dm.group(1)) <= MAX_RECENCY_DAYS
    if re.match(r"^\d+w$", t) or "month" in t:
        return False
    return True

# ---------------------------------------------------------------------------
# Extractors
# ---------------------------------------------------------------------------

def extract_linkedin_urls(md: str) -> list[str]:
    pattern = r"https?://(?:www\.)?linkedin\.com/posts/[a-zA-Z0-9_\-]+"
    urls = []
    for u in re.findall(pattern, md):
        clean = u.split("?")[0]
        if len(clean.split("/posts/")[-1]) > 5 and is_us_linkedin_url(clean):
            urls.append(clean)
    return sorted(set(urls))


def extract_x_posts(md: str) -> list[dict]:
    posts = []
    pattern = r"https?://(?:www\.)?(?:x|twitter)\.com/([a-zA-Z0-9_]+)/status/(\d+)"
    matches = list(re.finditer(pattern, md))
    for idx, match in enumerate(matches):
        url = match.group(0).split("?")[0]
        username = match.group(1)
        start = match.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(md)
        snippet = md[start:end].strip()
        snippet = re.sub(r"^[\]\)\s\.\·\-\,\:]+", "", snippet)
        snippet = re.split(r"\s+\d+\.\s+\[", snippet)[0]
        snippet = snippet.split("\n\n")[0].strip()
        snippet = re.sub(r"\s+", " ", snippet)
        if len(snippet) < 15:
            continue
        author = f"@{username}"
        body = snippet
        post_time = None
        am = re.search(r"([^\(]+)\s*\((@[A-Za-z0-9_]+)\)", snippet)
        if am:
            name_field = am.group(1).strip()
            tm = re.match(r"^(\d+)\s+(hours?|days?|weeks?)\s+ago\s+·\s*", name_field)
            if tm:
                unit_letter = tm.group(2)[0]
                post_time = f"{tm.group(1)}{unit_letter}"
                name_field = name_field[tm.end():]
            author = f"{name_field} ({am.group(2).strip()})"
            body = snippet[am.end():].strip().lstrip(". ")
        if not is_recent_time(post_time):
            continue
        posts.append({"author": author, "url": url, "body": body, "platform": "X (Twitter)", "time": post_time})
    return posts


def parse_linkedin_post(md: str, source_url: str) -> list[dict]:
    posts = []
    if not is_us_linkedin_url(source_url):
        return posts
    am = re.search(r"\[\s*([^\]]+)\s*\]\(https?://[a-z]+\.linkedin\.com/(?:in|company)/[^\s\)]+\?trk=public_post_feed-actor-name\)", md)
    author = am.group(1).strip() if am else None
    if not author:
        tm = re.search(r"#\s+([A-Za-z\s'\.\-]+)'\s+Post", md)
        author = tm.group(1).strip() if tm else None
    time_m = re.search(r"\?trk=public_post_feed-actor-name\)\s*\n\s*([^%\n\*]+)\n", md)
    post_time = time_m.group(1).strip() if time_m else None
    report_pat = r"\* \[ Report this post \]\(https?://[a-zA-Z0-9_\-\.\:\/\?\&\=\%]+\)"
    report_m = re.search(report_pat, md)
    stop_pats = [
        r"\n\s*\[\s*(?:Like|1)\s*\]\(https://www\.linkedin\.com/signup",
        r"\n\s*To view or add a comment",
        r"\n\s*Agree \& Join LinkedIn",
        r"\n\s*More Relevant Posts",
        r"\n\s*Share\n", r"\n\s*\* Copy\n",
    ]
    body = None
    if report_m:
        si = report_m.end()
        ei = len(md)
        for sp in stop_pats:
            sm = re.search(sp, md[si:])
            if sm and si + sm.start() < ei:
                ei = si + sm.start()
        body = md[si:ei].strip().strip("`").strip()
    if author and body and is_recent_time(post_time):
        posts.append({"author": author, "url": source_url, "body": body, "platform": "LinkedIn", "time": post_time})
    return posts

# ---------------------------------------------------------------------------
# Cross-run dedup (LinkedIn/X only)
# ---------------------------------------------------------------------------

_SEEN_TTL_SECONDS = MAX_RECENCY_DAYS * 86400


async def dedup_across_runs(posts: list[dict]) -> list[dict]:
    """Drops any post URL already processed in a prior run within the recency
    window, then marks the survivors as seen. Stores only a hash of the URL plus
    a timestamp via the existing Supabase-backed cache — never the post content —
    so a LinkedIn/X post never gets re-scored/re-embedded/re-Gemma'd twice."""
    fresh = []
    for p in posts:
        key = cache.make_key("signal:seen", p["url"])
        if await cache.cache_get(key, _SEEN_TTL_SECONDS) is not None:
            continue
        fresh.append(p)
    await asyncio.gather(*(
        cache.cache_set(cache.make_key("signal:seen", p["url"]), True) for p in fresh
    ))
    return fresh

# ---------------------------------------------------------------------------
# Source crawlers
# ---------------------------------------------------------------------------

async def _crawl_with_retry(crawler, url, run_config, attempts=3, base_delay=2.0):
    """Yahoo (and to a lesser extent LinkedIn) intermittently antibot-blocks or times
    out under concurrent load. Retry with backoff + jitter before giving up, instead
    of silently dropping the query."""
    for attempt in range(attempts):
        try:
            res = await crawler.arun(url=url, config=run_config)
            if res.success:
                return res
        except Exception:
            pass
        if attempt < attempts - 1:
            await asyncio.sleep(base_delay * (attempt + 1) + random.uniform(0, 1))
    return None


async def crawl_social(crawler, run_config) -> list[dict]:
    queries = []
    li_terms = [
        '"pre-seed"', '"seed round"', '"stealth mode"', '"we launched"',
        '"just shipped"', '"we built"', '"introducing our"', '"announcing our"',
        '"pre-seed" "ai"', '"seed round" "ai"', '"stealth" "ai"',
        '"first check"', '"pre-seed round"', '"we raised a seed"',
        '"stealth mode AI"', '"just launched our beta"', '"mvp launch"', '"new startup"',
        '"raising our pre-seed"', '"pre-launch"', '"beta access"', '"waitlist" "ai"',
        '"we are live"', '"early access"', '"soft launch"', '"currently building"',
        '"solo founder" "ai"', '"building in public" "ai"',
    ]
    for term in li_terms:
        queries.append((f'site:linkedin.com/posts/ {term}', "LinkedIn"))
        queries.append((f'site:x.com {term}', "X"))

    targets = []
    for q, plat in queries:
        for page in range(8):
            offset = 1 + page * 10
            url = f"https://search.yahoo.com/search?p={urllib.parse.quote_plus(q)}&btf=m&b={offset}"
            targets.append((q, plat, url))

    sem = asyncio.Semaphore(6)
    crawl_sem = asyncio.Semaphore(20)
    li_urls: list[str] = []
    x_posts: list[dict] = []

    async def search(q, plat, url):
        async with sem:
            res = await _crawl_with_retry(crawler, url, run_config)
            if res is None:
                return
            md = res.markdown or ""
            if plat == "LinkedIn":
                li_urls.extend(extract_linkedin_urls(md))
            else:
                x_posts.extend(extract_x_posts(md))

    await asyncio.gather(*(search(q, p, u) for q, p, u in targets))

    unique_li = sorted(set(li_urls))[:400]

    async def crawl_li(url):
        async with crawl_sem:
            res = await _crawl_with_retry(crawler, url, run_config)
            if res is not None:
                return parse_linkedin_post(res.markdown or "", url)
            return []

    if unique_li:
        results = await asyncio.gather(*(crawl_li(u) for u in unique_li))
        for r in results:
            x_posts.extend(r)

    dedup_within_run = {}
    for p in x_posts:
        key = (p["author"], p["body"][:50])
        if key not in dedup_within_run:
            dedup_within_run[key] = p
    return await dedup_across_runs(list(dedup_within_run.values()))


async def crawl_github(crawler, run_config) -> list[dict]:
    res = await crawler.arun(url="https://github.com/trending", config=run_config)
    signals = []
    if not res.success:
        return signals
    md = res.markdown or ""
    heading_re = r"^##\s+\[\s*([a-zA-Z0-9_\-\.]+)\s*/\s*([a-zA-Z0-9_\-\.]+)\s*\]\((https?://github\.com/[^\)]+)\)"
    lines = md.split("\n")
    for idx, line in enumerate(lines):
        m = re.match(heading_re, line.strip())
        if not m:
            continue
        owner, name, repo_url = m.groups()
        desc = ""
        daily_stars = 0
        for si in range(idx + 1, min(idx + 6, len(lines))):
            sl = lines[si].strip()
            if "stars today" in sl:
                sm = re.search(r"([0-9,]+)\s+stars\s+today", sl)
                if sm:
                    daily_stars = int(sm.group(1).replace(",", ""))
                break
            if not desc and not sl.startswith("[") and not sl.startswith("*") and sl:
                desc = sl
        combined = f"{name} {desc}".lower()
        if any(re.search(p, combined) for p in GITHUB_AI_KEYWORDS):
            signals.append({
                "author": f"{owner}/{name}", "platform": "GitHub",
                "url": repo_url, "body": f"Trending: {owner}/{name} — {desc} ({daily_stars} stars today)",
                "time": "Today", "score_boost": 3,
            })
    return signals


async def crawl_show_hn(crawler, run_config) -> list[dict]:
    res = await crawler.arun(url="https://news.ycombinator.com/show", config=run_config)
    signals = []
    if not res.success:
        return signals
    md = res.markdown or ""
    lines = md.split("\n")
    for idx, line in enumerate(lines):
        for m in re.finditer(r"\[([^\]]+)\]\((https?://[^\)]+)\)", line):
            title = m.group(1).strip()
            url = m.group(2)
            combined = title.lower()
            if not any(re.search(p, combined) for p in GITHUB_AI_KEYWORDS):
                continue
            if "github.com" in url.lower():
                continue
            if any(re.search(p, combined) for p in HN_NOISE_PATTERNS):
                continue

            points = 0
            for si in range(idx, min(idx + 4, len(lines))):
                pm = re.search(r"(\d+)\s+points?\b", lines[si])
                if pm:
                    points = int(pm.group(1))
                    break

            boost = 3 if points >= MIN_HN_POINTS_STRONG else 1 if points >= MIN_HN_POINTS_WEAK else 0
            signals.append({
                "author": "Show HN", "platform": "Show HN", "url": url,
                "body": f"Show HN: {title} ({points} points)", "time": "Today",
                "score_boost": boost,
            })
    return signals


async def crawl_huggingface(crawler, run_config) -> list[dict]:
    res = await crawler.arun(url="https://huggingface.co/spaces?sort=trending", config=run_config)
    signals = []
    if not res.success:
        return signals
    md = res.markdown or ""
    for m in re.finditer(r"\[([^\]]{3,80})\]\((/spaces/[^\)]+)\)", md):
        name = m.group(1).strip()
        slug = m.group(2)
        signals.append({
            "author": name, "platform": "Hugging Face",
            "url": f"https://huggingface.co{slug}",
            "body": f"Trending HF Space: {name}", "time": "Today", "score_boost": 0,
        })
    return signals[:30]


async def crawl_product_hunt(crawler, run_config) -> list[dict]:
    """Newest/unranked launches — deliberately not the trending page, since anything
    already popular there has visibility we don't need help finding."""
    from crawl4ai import CrawlerRunConfig, CacheMode
    cfg = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        js_code="window.scrollTo(0, document.body.scrollHeight);",
        delay_before_return_html=3.0,
    )
    res = await crawler.arun(url="https://www.producthunt.com/newest", config=cfg)
    signals = []
    if not res.success:
        return signals
    md = res.markdown or ""
    lines = md.split("\n")
    seen_urls = set()
    link_re = re.compile(r"\[([^\]]{3,80})\]\((https://www\.producthunt\.com/posts/[^\)\s]+)\)")
    for idx, line in enumerate(lines):
        m = link_re.search(line)
        if not m:
            continue
        name = m.group(1).strip()
        url = m.group(2).split("?")[0]
        if url in seen_urls or not name:
            continue

        tagline = ""
        for si in range(idx + 1, min(idx + 4, len(lines))):
            sl = lines[si].strip()
            if sl and not sl.startswith("[") and not sl.startswith("!"):
                tagline = sl
                break

        combined = f"{name} {tagline}".lower()
        if not any(re.search(p, combined) for p in GITHUB_AI_KEYWORDS):
            continue

        seen_urls.add(url)
        signals.append({
            "author": name, "platform": "Product Hunt", "url": url,
            "body": f"New Product Hunt launch: {name} — {tagline}" if tagline else f"New Product Hunt launch: {name}",
            "time": "Today", "score_boost": 2,
        })
    return signals[:40]


async def crawl_hiring(crawler, run_config) -> list[dict]:
    from crawl4ai import CrawlerRunConfig, CacheMode
    cfg = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        js_code="window.scrollTo(0, document.body.scrollHeight);",
        delay_before_return_html=3.0,
    )
    res = await crawler.arun(url="https://www.workatastartup.com/companies?demographic=top-companies&industry=B2B&industry=Consumer&industry=Education&industry=Financial+Technology+and+Services&industry=Healthcare&industry=Industrials&tab=any&topic=AI", config=cfg)
    signals = []
    if not res.success:
        return signals
    md = res.markdown or ""
    lines = md.split("\n")
    for idx, line in enumerate(lines):
        for m in re.finditer(r"\[([^\]]{3,60})\]\((https://www\.workatastartup\.com/companies/[^\)]+)\)", line):
            name = m.group(1).strip()
            url = m.group(2)

            # Best-effort: keep only W25/S25+ batches. If no batch code is found nearby
            # (unverified whether this page renders one per card), fail open and keep it.
            batch_year = None
            for si in range(max(0, idx - 2), min(idx + 3, len(lines))):
                bm = re.search(r"\b[WS](\d{2})\b", lines[si])
                if bm:
                    batch_year = int(bm.group(1))
                    break
            if batch_year is not None and batch_year < MIN_YC_BATCH_YEAR:
                continue

            signals.append({
                "author": name, "platform": "Work at a Startup", "url": url,
                "body": f"Hiring AI talent: {name} (YC-backed startup actively hiring)",
                "time": "Current", "score_boost": 2,
            })
    return signals[:40]

# ---------------------------------------------------------------------------
# Score + Filter
# ---------------------------------------------------------------------------

def score_and_filter(posts: list[dict], today: datetime) -> list[dict]:
    results = []
    for post in posts:
        body_lower = post["body"].lower()
        platform = post.get("platform", "")
        boost = post.get("score_boost", 0)

        if any(re.search(p, body_lower) for p in LATE_STAGE_OR_BIG_TECH):
            continue
        dt = parse_snippet_date(post["body"])
        recency_limit_days = MAX_RECENCY_DAYS if platform in social_classifier.SOCIAL_PLATFORMS else 30
        if dt and (today - dt).days > recency_limit_days:
            continue
        if re.search(NON_US_CURRENCIES, body_lower) or re.search(NON_US_GEOGRAPHY, body_lower):
            continue
        if any(re.search(p, body_lower) for p in NEWS_INDICATORS):
            continue

        launches = any(re.search(p, body_lower) for p in LAUNCH_TRIGGERS)
        raises = any(re.search(p, body_lower) for p in RAISE_TRIGGERS)
        showcases = any(re.search(p, body_lower) for p in SHOWCASE_TRIGGERS)
        self_ref = any(re.search(p, body_lower) for p in SELF_REFERENTIAL)

        score = boost
        if launches: score += 3
        if raises: score += 3
        if showcases: score += 2
        if self_ref: score += 2
        if any(t in body_lower for t in ["investor", "vc", "safe", "fundraise", "pre-seed", "seed", "valuation"]):
            score += 2

        matched_ai = [k for k, p in AI_KEYWORDS.items() if re.search(p, body_lower)]
        is_directory = platform in ["YC Launches", "GitHub",
                                    "South Park Commons", "Founders Inc", "Neo",
                                    "Show HN", "Hugging Face", "Work at a Startup"]
        if not matched_ai and not is_directory:
            continue
        if matched_ai:
            score += 2
            if len(matched_ai) >= 3: score += 2

        noise = sum(1 for p in ADVISORY_NOISE if re.search(p, body_lower))
        if noise >= 2: score -= 5
        if score < 1: continue

        sig_type = "AI Showcase"
        if raises: sig_type = "AI Fundraising"
        elif launches: sig_type = "AI Product Launch"
        elif is_directory: sig_type = f"{platform} Signal"

        category = CATEGORY_MAP.get(platform, "social")
        results.append({
            "source_url": post["url"].split("?")[0],
            "title": post.get("author", "Unknown"),
            "snippet": post["body"][:300].replace("\n", " "),
            "platform": platform,
            "category": category,
            "signal_type": sig_type,
            "score": score,
            "ai_features": matched_ai or ["ai_general"],
            "favicon_url": favicon_url(post["url"]),
        })
    results.sort(key=lambda x: x["score"], reverse=True)
    return results

# ---------------------------------------------------------------------------
# Gemma Filter (Cerebras-hosted)
# ---------------------------------------------------------------------------

CEREBRAS_URL = "https://api.cerebras.ai/v1/chat/completions"
GEMMA_MODEL_ID = "gemma-4-31b"

# Enforced via response_format json_schema below — the model is constrained to emit
# exactly this shape, not just asked nicely to produce JSON in the prompt. Always
# requires company_name (cross-checked against startups we already track / signals
# we've already surfaced) and conviction (drives review-order ranking downstream).
_DECISIONS_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "decisions",
        "schema": {
            "type": "object",
            "properties": {
                "decisions": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "index": {"type": "integer"},
                            "approved": {"type": "boolean"},
                            "reasoning": {"type": "string"},
                            "company_name": {"type": "string"},
                            "conviction": {"type": "integer"},
                        },
                        "required": ["index", "approved", "reasoning", "company_name", "conviction"],
                    },
                }
            },
            "required": ["decisions"],
        },
    },
}

_SOCIAL_HARD_FILTERS = """
This batch is LinkedIn/X posts specifically. On top of everything above, ALL of these hard filters must pass:
- US-based only (reject if non-US or unclear-but-hinting-non-US).
- Must be an AI startup — AI/ML is a core enabling technology, not a bolt-on feature.
- If the post discloses a funding amount, total raised must be UNDER $10M — reject anything at or above $10M
  (e.g. "$66M seed", "$20M seed", "$10.5M seed" are all OVER the cap, reject those).
- If the post discloses team/employee size, it must be UNDER 20 people — reject anything at or above 20.
- If funding or team size isn't mentioned at all, don't reject solely for missing that information — judge
  on the other criteria instead."""


async def gemma_filter(
    candidates: list[dict],
    strict_hard_filters: bool = False,
    blocked_names: set[str] | None = None,
) -> list[dict]:
    """Runs the strict VC-signal filter against Cerebras-hosted Gemma (gemma-4-31b).
    Replaces the earlier self-hosted Modal SGLang server — same OpenAI-compatible
    /v1/chat/completions shape and json_schema structured output, just a plain
    bearer token instead of Modal's tunnel proxy auth.

    strict_hard_filters=True adds the LinkedIn/X-only hard filters (US-only, AI
    startup, <$10M raised, <20 employees). Every call extracts company_name (for
    dedup) and conviction (for review-order ranking). blocked_names is the set of
    companies already tracked or surfaced recently — Gemma is told to reject any
    candidate about one of them even from a different post/source."""
    api_key = os.environ.get("CEREBRAS_API_KEY", "")
    if not api_key or not candidates:
        return candidates

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }

    approved = []
    batch_size = 25
    max_batches = 5

    total_batches = (len(candidates) + batch_size - 1) // batch_size
    if total_batches > max_batches:
        skipped = len(candidates) - max_batches * batch_size
        print(f"  Gemma filter: capping at {max_batches} batches ({skipped} candidates skipped this run)")

    blocked_text = ""
    if blocked_names:
        names_list = ", ".join(sorted(blocked_names)[:300])
        blocked_text = f"""

Companies already tracked or surfaced as a signal in the last 14 days — REJECT any candidate about
one of these even if the post, angle, or source platform is different: {names_list}"""

    for i in range(0, min(len(candidates), max_batches * batch_size), batch_size):
        batch = candidates[i:i + batch_size]
        items_text = "\n".join(
            f"[{j}] Platform: {c['platform']} | Title: {c['title']} | "
            f"Type: {c['signal_type']} | Score: {c['score']} | "
            f"Snippet: {c['snippet'][:200]}"
            for j, c in enumerate(batch)
        )

        prompt = f"""You are an EXTREMELY STRICT VC signal filter for a pre-seed/seed AI startup fund. Your job is to filter out the noise and ONLY pass through high-conviction, early-stage AI startup opportunities. The fund specifically wants niche, underground, pre-attention startups — not things already getting mainstream visibility.

Review each signal below and decide whether it represents a GENUINE, MEANINGFUL early-stage AI startup or a tangible opportunity that leads to one.

APPROVE ONLY if ALL of the following are true:
- A specific, NAMED startup or product is launching, raising pre-seed/seed, or showcasing a real MVP (not just a weekend project).
- The startup is building a commercial business with AI/ML as a core enabling technology (it must fit the thesis of an AI startup).
- It is undeniably early-stage (pre-seed, seed, stealth, or just launched).

REJECT if ANY of the following apply (BE RUTHLESS):
- It is a news article, thought leadership, blog post, or advice.
- It is an established or large company (Series A+, well-known brands, big tech).
- It is just a generic open-source AI model release, research paper, or tool without a real startup/commercial entity behind it.
- It is a dev tool, GitHub repo, or project without clear intent to become a venture-backed startup.
- It is an agency, consultancy, or dev shop.
- It is vague with no specific product or company name.
- It is not US-based or geography is unclear but hints at non-US.

When in doubt, REJECT. We only want highly qualified signals.
{_SOCIAL_HARD_FILTERS if strict_hard_filters else ""}
{blocked_text}

For every APPROVED item, also assign "conviction" (integer 1-10) — how strong an underground, pre-attention
early-stage signal this is:
- Score HIGHER (8-10) for genuinely low-visibility signals: solo or 2-3 person team, self-posted (not written
  by a journalist), no press pickup, not yet reposted/quoted by anyone else, no recognizable investor/accelerator
  name attached.
- Score LOWER (1-4), even though still approved, for anything already showing outside attention: high
  upvotes/points, "featured in" a publication, backed by a named fund or accelerator, or clearly already
  making the rounds. Don't reject these — just rank them below the truly underground finds.
- Also extract the specific startup/product name into "company_name" (not the poster's personal name unless
  they ARE the company) — e.g. "Arcturus", "Taste Labs", "PivotBridge.AI".

Decide on every item below and return one decision object per item, with "index" matching the item's bracketed number. Keep "reasoning" under 15 words — you must cover every item in the budget you have.

Items to review:
{items_text}"""

        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    CEREBRAS_URL,
                    json={
                        "model": GEMMA_MODEL_ID,
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.1,
                        "max_tokens": 8192,
                        "response_format": _DECISIONS_SCHEMA,
                    },
                    headers=headers,
                    timeout=60.0,
                )
                if resp.status_code != 200:
                    print(f"  Gemma API error: {resp.status_code}")
                    approved.extend(batch)
                    continue

                content = resp.json()["choices"][0]["message"]["content"]
                decisions = json.loads(content).get("decisions", [])

                for dec in decisions:
                    idx = dec.get("index", -1)
                    if 0 <= idx < len(batch) and dec.get("approved"):
                        batch[idx]["gemini_reasoning"] = dec.get("reasoning", "")
                        batch[idx]["company_name"] = dec.get("company_name", "")
                        conviction = dec.get("conviction")
                        if isinstance(conviction, int) and 1 <= conviction <= 10:
                            batch[idx]["score"] = conviction
                        approved.append(batch[idx])

                approve_count = sum(1 for d in decisions if d.get("approved"))
                print(f"  Gemma batch {i // batch_size + 1}: {approve_count}/{len(batch)} approved")

        except Exception as e:
            print(f"  Gemma filter error: {e}")
            approved.extend(batch)

    return approved

# ---------------------------------------------------------------------------
# Known-startups cross-check (LinkedIn/X only)
# ---------------------------------------------------------------------------

def _normalize_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def load_known_startup_names() -> set[str]:
    """Normalized names of every startup already in the dealflow list (any status).
    Used to stop LinkedIn/X signals from resurfacing a startup we already track."""
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        return set()
    try:
        sb = create_client(url, key)
        res = sb.table("startups").select("name").execute()
        return {_normalize_name(row["name"]) for row in (res.data or []) if row.get("name")}
    except Exception as e:
        print(f"  Failed to load known startups: {e}")
        return set()


def load_recent_signal_company_names(days: int = 14) -> set[str]:
    """Normalized company_name of every signal scraped in the last `days`, across all
    statuses (new/sent/dismissed). Stops a startup from resurfacing as a fresh signal
    from a different post/platform after it's already been shown and passed on."""
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        return set()
    try:
        sb = create_client(url, key)
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        res = (
            sb.table("signals")
            .select("company_name")
            .gte("scraped_at", cutoff)
            .execute()
        )
        return {_normalize_name(row["company_name"]) for row in (res.data or []) if row.get("company_name")}
    except Exception as e:
        print(f"  Failed to load recent signal company names: {e}")
        return set()


def filter_known_startups(signals: list[dict], known_names: set[str]) -> list[dict]:
    if not known_names:
        return signals
    kept = []
    dropped = 0
    for sig in signals:
        company = _normalize_name(sig.get("company_name", ""))
        if company and company in known_names:
            dropped += 1
            continue
        kept.append(sig)
    if dropped:
        print(f"  Known-startup cross-check: dropped {dropped} signals for startups already tracked")
    return kept

# ---------------------------------------------------------------------------
# Supabase writer
# ---------------------------------------------------------------------------

def write_to_supabase(signals: list[dict]):
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        print("  Supabase not configured, skipping write.")
        return
    sb = create_client(url, key)

    try:
        three_days_ago = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
        res = sb.table("signals").update({"status": "dismissed"}).eq("status", "new").lt("scraped_at", three_days_ago).execute()
        print(f"  Auto-archived {len(res.data) if res.data else 0} signals older than 3 days.")
    except Exception as e:
        print(f"  Failed to auto-archive old signals: {e}")

    existing_status = {}
    try:
        res = sb.table("signals").select("source_url, status").execute()
        existing_status = {row["source_url"]: row["status"] for row in (res.data or [])}
    except Exception as e:
        print(f"  Failed to fetch existing signals status: {e}")

    for sig in signals:
        try:
            sb.table("signals").upsert(
                {
                    "source_url": sig["source_url"],
                    "title": sig["title"][:200],
                    "snippet": sig.get("snippet", "")[:500],
                    "platform": sig["platform"],
                    "category": sig["category"],
                    "signal_type": sig.get("signal_type", ""),
                    "score": sig.get("score", 0),
                    "favicon_url": sig.get("favicon_url", ""),
                    "ai_features": sig.get("ai_features", []),
                    "gemini_reasoning": sig.get("gemini_reasoning", ""),
                    "company_name": sig.get("company_name", ""),
                    "status": existing_status.get(sig["source_url"], "new"),
                },
                on_conflict="source_url",
            ).execute()
        except Exception as e:
            print(f"  Supabase upsert error for {sig['source_url']}: {e}")
    print(f"  Wrote {len(signals)} signals to Supabase.")

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def _score_filter_and_write(all_raw: list[dict]) -> list[dict]:
    print(f"Total raw signals: {len(all_raw)}")
    today = datetime.now()
    scored = score_and_filter(all_raw, today)
    print(f"After regex filter: {len(scored)} candidates")
    scored = social_classifier.filter_social_candidates(scored)
    print(f"After embedding pre-filter: {len(scored)} candidates")

    social = [c for c in scored if c["platform"] in social_classifier.SOCIAL_PLATFORMS]
    other = [c for c in scored if c["platform"] not in social_classifier.SOCIAL_PLATFORMS]

    blocked_names = load_known_startup_names() | load_recent_signal_company_names()
    approved_social = await gemma_filter(social, strict_hard_filters=True, blocked_names=blocked_names)
    approved_other = await gemma_filter(other, blocked_names=blocked_names)

    approved = filter_known_startups(approved_social + approved_other, blocked_names)
    approved.sort(key=lambda x: x.get("score", 0), reverse=True)
    print(f"After Gemma filter: {len(approved)} approved signals")
    write_to_supabase(approved)
    return approved


async def scrape_and_filter_frequent():
    """Fast-moving sources — social posts, trending repos, launches, hiring. Runs every 30 min."""
    from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode

    start = time.time()
    print("Signal scraper (frequent) starting...")

    browser_config = BrowserConfig(headless=True, verbose=False)
    run_config = CrawlerRunConfig(cache_mode=CacheMode.BYPASS, word_count_threshold=5)
    all_raw: list[dict] = []

    async with AsyncWebCrawler(config=browser_config) as crawler:
        social_task = crawl_social(crawler, run_config)
        github_task = crawl_github(crawler, run_config)
        show_hn_task = crawl_show_hn(crawler, run_config)
        hf_task = crawl_huggingface(crawler, run_config)
        hiring_task = crawl_hiring(crawler, run_config)
        ph_task = crawl_product_hunt(crawler, run_config)

        social = await social_task
        all_raw.extend(social)
        print(f"  Social: {len(social)} posts")

        rest = await asyncio.gather(
            github_task, show_hn_task, hf_task, hiring_task, ph_task,
            return_exceptions=True,
        )
        labels = ["GitHub", "Show HN", "HuggingFace", "Hiring", "Product Hunt"]
        for label, result in zip(labels, rest):
            if isinstance(result, Exception):
                print(f"  {label}: ERROR - {result}")
            else:
                print(f"  {label}: {len(result)} signals")
                all_raw.extend(result)

    approved = await _score_filter_and_write(all_raw)
    elapsed = time.time() - start
    print(f"Frequent pipeline completed in {elapsed:.1f}s")
    return approved
