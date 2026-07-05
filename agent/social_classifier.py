"""Cheap embedding pre-filter for LinkedIn/X signal candidates, ahead of the Gemma
(Cerebras) strict pass in signals_scraper.py.

Self-hosted via fastembed (ONNX, CPU, no per-call API cost) so screening every raw
social post doesn't mean an LLM call per post. Scored against a small set of
hand-written exemplar posts (not real scraped content) that encode the same
good/bad criteria already used by the regex filters and the Gemma prompt.

Deliberately lenient: this only rejects the clearly-bad tail (news, thought
leadership, late-stage/big-tech, advice/consultancy content). Anything ambiguous
or promising still falls through to the Gemma pass, which remains the final gate.
Only applied to LinkedIn/X candidates for now — other source categories
(GitHub, Show HN, Hugging Face, Work at a Startup) are untouched.
"""

import math
from typing import Optional

EMBED_MODEL_NAME = "BAAI/bge-small-en-v1.5"

SOCIAL_PLATFORMS = {"LinkedIn", "X (Twitter)"}

# Genuine early-stage AI startup signals: launches, raises, stealth reveals, build-in-public.
GOOD_EXAMPLES = [
    "Excited to finally launch Parsely — an AI copilot that helps sales teams draft follow-up emails in seconds. We've been building this in stealth for 4 months, try the beta at getparsely.ai",
    "We just raised a $1.2M pre-seed to build the AI layer for freight logistics. Huge thanks to our angels for believing in us this early. More to come soon.",
    "3 months ago I quit my job to build an AI agent that automates expense reports. Today we're live! Would love your feedback on the MVP.",
    "Announcing our seed round: $2M to build an AI-native CRM for solo founders. We're a team of 2 and we're just getting started.",
    "Stealth mode is over — introducing our AI tool that turns customer calls into structured insights automatically. Try the demo, we're pre-seed and hungry for feedback.",
    "Just shipped v1 of our AI agent framework for support teams. Built this over the last 6 weeks nights and weekends. Would mean a lot if you tried it out.",
    "We're raising our pre-seed round to build an AI underwriting engine for small business loans. If you know early-stage fintech investors, send them our way.",
    "Here's what we've been building in stealth: an AI note-taker that actually understands engineering standups. Beta is live today.",
    "One year ago it was just an idea. Today we closed our seed round and shipped our AI recruiting assistant to our first 50 customers.",
    "Building in public update: our AI-powered legal doc reviewer just crossed 100 signups in its first week. Bootstrapped, pre-seed, and looking for our first check.",
    "We built a tool that uses AI to auto-generate onboarding docs straight from your codebase. Just launched on our own domain, would love beta testers.",
    "Excited to announce our seed round backed by a few great angels — building an AI agent that negotiates vendor contracts for procurement teams.",
]

# News, thought leadership, big tech, late-stage, advice/consultancy — the noise we want to skip early.
BAD_EXAMPLES = [
    "OpenAI unveils GPT-5 with major upgrades to reasoning capabilities, according to sources familiar with the matter.",
    "5 lessons I learned advising 50+ AI startups on their go-to-market strategy — thread",
    "Google announces $10B investment in AI infrastructure as competition with Microsoft heats up.",
    "Why most founders get fundraising wrong: a checklist for your pre-seed deck (comment 'DECK' below and I'll send mine)",
    "Breaking: Anthropic raises Series F at a $60B valuation, reports Bloomberg.",
    "The biggest mistake AI founders make when hiring their first engineer — newsletter edition.",
    "Microsoft and Meta both announced new AI chip partnerships this week, signaling the arms race is far from over.",
    "How to write a cold email that actually gets VCs to respond — tips from a career operator.",
    "We're a consultancy helping enterprises adopt generative AI — reach out if your team needs an AI strategy audit.",
    "Congress advances new AI regulation bill amid growing concerns over model safety, per White House officials.",
    "Just published my thoughts on why every SaaS company needs an AI strategy in 2026 (long read, link in bio).",
    "Rippling announces new AI-powered HR features rolling out to enterprise customers next quarter.",
]

# bge-small-en-v1.5 produces a compressed cosine range on short informal text (~0.6-0.85
# even between unrelated posts), so there's no meaningful absolute floor — only the
# good-vs-bad margin is informative. Small positive margin so ties/near-ties lean
# toward being kept (an extra Gemma call is cheap; losing a real signal isn't).
REJECT_MARGIN = 0.02

_model = None
_good_embeddings: Optional[list] = None
_bad_embeddings: Optional[list] = None


def _get_model():
    global _model
    if _model is None:
        from fastembed import TextEmbedding
        _model = TextEmbedding(model_name=EMBED_MODEL_NAME)
    return _model


def _embed(texts: list[str]) -> list[list[float]]:
    return [list(v) for v in _get_model().embed(texts)]


def _ensure_exemplars() -> None:
    global _good_embeddings, _bad_embeddings
    if _good_embeddings is None:
        _good_embeddings = _embed(GOOD_EXAMPLES)
    if _bad_embeddings is None:
        _bad_embeddings = _embed(BAD_EXAMPLES)


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def passes_embedding_filter(text: str) -> tuple[bool, float, float]:
    """Returns (passes, sim_good, sim_bad). passes=False only for the clearly-bad tail."""
    _ensure_exemplars()
    vec = _embed([text])[0]
    sim_good = max(_cosine(vec, g) for g in _good_embeddings)
    sim_bad = max(_cosine(vec, b) for b in _bad_embeddings)
    passes = (sim_bad - sim_good) <= REJECT_MARGIN
    return passes, sim_good, sim_bad


def filter_social_candidates(candidates: list[dict]) -> list[dict]:
    """Applies the embedding pre-filter only to LinkedIn/X candidates. Every other
    platform passes through untouched — out of scope for now."""
    kept = []
    rejected = 0
    for c in candidates:
        if c.get("platform") not in SOCIAL_PLATFORMS:
            kept.append(c)
            continue
        ok, sim_good, sim_bad = passes_embedding_filter(c.get("snippet", ""))
        if ok:
            kept.append(c)
        else:
            rejected += 1
    if rejected:
        print(f"  Embedding pre-filter: rejected {rejected} clearly-noise LinkedIn/X candidates")
    return kept
