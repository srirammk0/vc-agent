"""
Signal scraper pipeline — crawls multiple sources for early-stage AI startup signals,
deduplicates / scores / filters with regex heuristics, then runs a final Gemma 4
(self-hosted on Modal) structured-output pass to approve only genuine opportunities.

Writes approved signals to the Supabase `signals` table.
"""

import asyncio
import re
import json
import time
import os
import urllib.parse
from datetime import datetime, timezone, timedelta

import httpx
from supabase import create_client

import cache

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


def is_recent_time(t: str | None) -> bool:
    if not t:
        return True
    t = t.strip().lower()
    if re.match(r"^\d+[hd]$", t):
        return True
    wm = re.match(r"^(\d+)w$", t)
    if wm:
        return int(wm.group(1)) <= 4
    if "months" in t:
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
        am = re.search(r"([^\(]+)\s*\((@[A-Za-z0-9_]+)\)", snippet)
        if am:
            raw = re.sub(r"^\d+\s+(?:days?|hours?|weeks?)\s+ago\s+·\s*", "", am.group(1).strip())
            author = f"{raw} ({am.group(2).strip()})"
            body = snippet[am.end():].strip().lstrip(". ")
        posts.append({"author": author, "url": url, "body": body, "platform": "X (Twitter)", "time": None})
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
# Source crawlers
# ---------------------------------------------------------------------------

async def crawl_social(crawler, run_config) -> list[dict]:
    queries = []
    li_terms = [
        '"pre-seed"', '"seed round"', '"stealth mode"', '"we launched"',
        '"just shipped"', '"we built"', '"introducing our"', '"announcing our"',
        '"pre-seed" "ai"', '"seed round" "ai"', '"stealth" "ai"',
        '"first check"', '"pre-seed round"', '"we raised a seed"',
        '"stealth mode AI"', '"just launched our beta"', '"mvp launch"', '"new startup"',
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

    sem = asyncio.Semaphore(15)
    crawl_sem = asyncio.Semaphore(45)
    li_urls: list[str] = []
    x_posts: list[dict] = []

    async def search(q, plat, url):
        async with sem:
            res = await crawler.arun(url=url, config=run_config)
            if not res.success:
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
            res = await crawler.arun(url=url, config=run_config)
            if res.success:
                return parse_linkedin_post(res.markdown or "", url)
            return []

    if unique_li:
        results = await asyncio.gather(*(crawl_li(u) for u in unique_li))
        for r in results:
            x_posts.extend(r)

    seen = {}
    for p in x_posts:
        key = (p["author"], p["body"][:50])
        if key not in seen:
            seen[key] = p
    return list(seen.values())


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


async def crawl_yc(crawler, run_config) -> list[dict]:
    from crawl4ai import CrawlerRunConfig, CacheMode
    yc_cfg = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        js_code="window.scrollTo(0, document.body.scrollHeight);",
        delay_before_return_html=3.0,
    )
    res = await crawler.arun(url="https://www.ycombinator.com/launches", config=yc_cfg)
    signals = []
    if not res.success:
        return signals
    md = res.markdown or ""
    pat = r"\[\s*([^\]]+)\s*\]\(https://www\.ycombinator\.com/launches/([a-zA-Z0-9_\-]+)\)"
    skip = {"launch yc", "companies", "apply", "interviews", "founder directory"}
    seen = {}
    for m in re.finditer(pat, md):
        name = m.group(1).strip()
        if name.lower() in skip:
            continue
        url = f"https://www.ycombinator.com/launches/{m.group(2)}"
        seen[url] = name
    for url, name in seen.items():
        signals.append({
            "author": name, "platform": "YC Launches", "url": url,
            "body": f"YC Launch: {name}", "time": "Past Month", "score_boost": 3,
        })
    return signals


async def crawl_directory(crawler, run_config, url: str, platform: str) -> list[dict]:
    from crawl4ai import CrawlerRunConfig, CacheMode
    cfg = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        js_code="window.scrollTo(0, document.body.scrollHeight);",
        delay_before_return_html=3.0,
    )
    res = await crawler.arun(url=url, config=cfg)
    signals = []
    if not res.success:
        return signals
    md = res.markdown or ""
    for m in re.finditer(r"\[([^\]]{2,60})\]\((https?://[^\)]+)\)", md):
        name = m.group(1).strip()
        link = m.group(2)
        if any(s in name.lower() for s in ["home", "about", "blog", "contact", "team", "press", "login", "sign"]):
            continue
        if any(s in link for s in ["twitter.com", "linkedin.com", "github.com", "mailto:", "#"]):
            continue
        signals.append({
            "author": name, "platform": platform, "url": link,
            "body": f"{platform} portfolio company: {name}", "time": "Current", "score_boost": 3,
        })
    return signals


MIN_FOUNDED_YEAR = 2025
_FINC_YEAR_TTL_SECONDS = 7 * 24 * 3600  # only runs weekly, cache just avoids same-day re-fetches


async def _finc_company_founded_year(client: "httpx.AsyncClient", slug: str) -> int | None:
    cache_key = cache.make_key("finc:founded", slug)
    cached = await cache.cache_get(cache_key, _FINC_YEAR_TTL_SECONDS)
    if cached is not None:
        return cached.get("year")
    year = None
    try:
        r = await client.get(f"https://www.f.inc/portfolio/{slug}/", timeout=15.0)
        if r.status_code == 200:
            m = re.search(r">FOUNDED</h3>.{0,300}?<p[^>]*>(\d{4})</p>", r.text, re.DOTALL)
            if m:
                year = int(m.group(1))
    except Exception:
        pass
    await cache.cache_set(cache_key, {"year": year})
    return year


async def crawl_founders_inc(crawler, run_config) -> list[dict]:
    """F.inc portfolio is a client-rendered Framer site — the listing needs the headless
    browser for slugs, but each company's own sub-page is static and has a FOUNDED year."""
    from crawl4ai import CrawlerRunConfig, CacheMode
    cfg = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        js_code="window.scrollTo(0, document.body.scrollHeight);",
        delay_before_return_html=3.0,
    )
    res = await crawler.arun(url="https://www.f.inc/portfolio", config=cfg)
    if not res.success:
        return []
    html = res.html or ""
    companies = {}
    pat = r'href="\./portfolio/([a-zA-Z0-9_\-]+)/"(?:(?!</a>).)*?<h2[^>]*>([^<]{1,60})</h2>'
    for m in re.finditer(pat, html, re.DOTALL):
        slug, name = m.group(1).strip(), m.group(2).strip()
        if slug and name:
            companies.setdefault(slug, name)

    if not companies:
        return []

    signals = []
    sem = asyncio.Semaphore(10)

    async with httpx.AsyncClient() as client:
        async def check(slug: str, name: str):
            async with sem:
                year = await _finc_company_founded_year(client, slug)
            # Fail open: keep if founded 2025+ or the year couldn't be parsed.
            if year is not None and year < MIN_FOUNDED_YEAR:
                return None
            return {
                "author": name, "platform": "Founders Inc",
                "url": f"https://www.f.inc/portfolio/{slug}/",
                "body": f"Founders Inc portfolio company: {name}"
                        + (f" (founded {year})" if year else ""),
                "time": "Current", "score_boost": 3,
            }

        results = await asyncio.gather(*(check(s, n) for s, n in companies.items()))
        signals = [r for r in results if r]
    return signals


async def crawl_south_park_commons() -> list[dict]:
    """SPC's company listing is server-rendered — name/slug/founded year are embedded
    as inline JSON in the plain HTML, no headless browser needed."""
    signals = []
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                "https://www.southparkcommons.com/companies/",
                timeout=20.0,
                headers={"User-Agent": "Mozilla/5.0"},
            )
        if r.status_code != 200:
            return signals
        pat = r'"name":"([^"]+)","slug":"([^"]+)".{0,300}?"founded":"(\d{4})"'
        for m in re.finditer(pat, r.text, re.DOTALL):
            name, slug, founded = m.group(1), m.group(2), int(m.group(3))
            if founded < MIN_FOUNDED_YEAR:
                continue
            signals.append({
                "author": name, "platform": "South Park Commons",
                "url": f"https://www.southparkcommons.com/companies/{slug}",
                "body": f"South Park Commons portfolio company: {name} (founded {founded})",
                "time": "Current", "score_boost": 3,
            })
    except Exception:
        pass
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
        if dt and (today - dt).days > 30:
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
# Gemma Filter (self-hosted SGLang server on Modal)
# ---------------------------------------------------------------------------

GEMMA_MODEL_ID = "google/gemma-4-E4B-it"

# Enforced via response_format json_schema below — the model is constrained to emit
# exactly this shape, not just asked nicely to produce JSON in the prompt.
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
                        },
                        "required": ["index", "approved", "reasoning"],
                    },
                }
            },
            "required": ["decisions"],
        },
    },
}


async def gemma_filter(candidates: list[dict]) -> list[dict]:
    """Runs the strict VC-signal filter against a self-hosted Gemma 4 SGLang server
    on Modal, behind Modal's tunnel proxy auth (Modal-Key/Modal-Secret headers —
    distinct from any app-level auth)."""
    url = os.environ.get("MODAL_GEMMA_URL", "")
    proxy_key = os.environ.get("MODAL_PROXY_KEY", "")
    proxy_secret = os.environ.get("MODAL_PROXY_SECRET", "")
    if not url or not candidates:
        return candidates

    headers = {"Content-Type": "application/json"}
    if proxy_key and proxy_secret:
        headers["Modal-Key"] = proxy_key
        headers["Modal-Secret"] = proxy_secret

    approved = []
    batch_size = 25

    for i in range(0, len(candidates), batch_size):
        batch = candidates[i:i + batch_size]
        items_text = "\n".join(
            f"[{j}] Platform: {c['platform']} | Title: {c['title']} | "
            f"Type: {c['signal_type']} | Score: {c['score']} | "
            f"Snippet: {c['snippet'][:200]}"
            for j, c in enumerate(batch)
        )

        prompt = f"""You are an EXTREMELY STRICT VC signal filter for a pre-seed/seed AI startup fund. Your job is to filter out the noise and ONLY pass through high-conviction, early-stage AI startup opportunities.

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

Decide on every item below and return one decision object per item, with "index" matching the item's bracketed number. Keep "reasoning" under 15 words — you must cover every item in the budget you have.

Items to review:
{items_text}"""

        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{url}/v1/chat/completions",
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
                        approved.append(batch[idx])

                approve_count = sum(1 for d in decisions if d.get("approved"))
                print(f"  Gemma batch {i // batch_size + 1}: {approve_count}/{len(batch)} approved")

        except Exception as e:
            print(f"  Gemma filter error: {e}")
            approved.extend(batch)

    return approved

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
    approved = await gemma_filter(scored)
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

        social = await social_task
        all_raw.extend(social)
        print(f"  Social: {len(social)} posts")

        rest = await asyncio.gather(
            github_task, show_hn_task, hf_task, hiring_task,
            return_exceptions=True,
        )
        labels = ["GitHub", "Show HN", "HuggingFace", "Hiring"]
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


async def scrape_and_filter_directories():
    """Slow-moving accelerator/portfolio directories. Runs weekly."""
    from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode

    start = time.time()
    print("Signal scraper (directories) starting...")

    browser_config = BrowserConfig(headless=True, verbose=False)
    run_config = CrawlerRunConfig(cache_mode=CacheMode.BYPASS, word_count_threshold=5)
    all_raw: list[dict] = []

    async with AsyncWebCrawler(config=browser_config) as crawler:
        yc_task = crawl_yc(crawler, run_config)
        spc_task = crawl_south_park_commons()
        finc_task = crawl_founders_inc(crawler, run_config)
        neo_task = crawl_directory(crawler, run_config, "https://neo.com/startups", "Neo")

        rest = await asyncio.gather(
            yc_task, spc_task, finc_task, neo_task,
            return_exceptions=True,
        )
        labels = ["YC Launches", "SPC", "F.inc", "Neo"]
        for label, result in zip(labels, rest):
            if isinstance(result, Exception):
                print(f"  {label}: ERROR - {result}")
            else:
                print(f"  {label}: {len(result)} signals")
                all_raw.extend(result)

    approved = await _score_filter_and_write(all_raw)
    elapsed = time.time() - start
    print(f"Directories pipeline completed in {elapsed:.1f}s")
    return approved
