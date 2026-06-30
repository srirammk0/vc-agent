"""LLM routing and cost controls.

Two-tier agent architecture:
- Haiku 4.5 (research_model): web search, press checks, discovery, reflection drafts
- Sonnet 4.6 (finalize_model): save to memory, write reflections, final user reply

Gemini 3.1 Flash Lite: rate-limit fallback only (not default).

Extended thinking: NOT enabled. We never set `anthropic_thinking` on any request, so
Sonnet/Haiku run in standard mode with no hidden thinking-token budget.

Batch API: not used — scout, SMS, and digest jobs need synchronous replies.
"""

import os
import asyncio

from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.models.anthropic import AnthropicModel, AnthropicModelSettings
from pydantic_ai.models.fallback import FallbackModel
from pydantic_ai.models.google import GoogleModel
from pydantic_ai.providers.anthropic import AnthropicProvider
from pydantic_ai.providers.google import GoogleProvider

GEMINI_MODEL = "gemini-3.1-flash-lite"
SONNET_MODEL = "claude-sonnet-4-6"
HAIKU_MODEL = "claude-haiku-4-5"


def _cache_base() -> dict:
    return {
        "anthropic_cache_tool_definitions": "1h",
        "anthropic_cache_instructions": True,
        "anthropic_cache": True,
    }


def _settings(max_tokens: int) -> AnthropicModelSettings:
    return AnthropicModelSettings(max_tokens=max_tokens, **_cache_base())


# Haiku — research / tool-heavy turns
RESEARCH_SETTINGS = _settings(1400)

# Sonnet — finalize saves + final replies (cushioned vs prior caps)
FINALIZE_SMS_SETTINGS = _settings(800)
FINALIZE_SCOUT_SETTINGS = _settings(2200)
FINALIZE_NEWS_SETTINGS = _settings(1800)
FINALIZE_FEEDBACK_SETTINGS = _settings(450)

ENRICH_SETTINGS = _settings(1100)
SUMMARY_SETTINGS = _settings(350)

# Back-compat aliases
SMS_SETTINGS = FINALIZE_SMS_SETTINGS
SCOUT_SETTINGS = FINALIZE_SCOUT_SETTINGS
NEWS_SETTINGS = FINALIZE_NEWS_SETTINGS
FAST_SETTINGS = FINALIZE_FEEDBACK_SETTINGS
CACHE_SETTINGS = FINALIZE_SMS_SETTINGS


def _is_rate_limit_error(exc: BaseException) -> bool:
    if isinstance(exc, ModelHTTPError) and exc.status_code == 429:
        return True
    cause = exc.__cause__
    if cause is not None and cause is not exc:
        return _is_rate_limit_error(cause)
    return False


def is_broken_history_error(exc: BaseException) -> bool:
    """True when cached message_history is malformed for the model API."""
    if isinstance(exc, ModelHTTPError) and exc.status_code == 400:
        body = str(getattr(exc, "body", "") or "").lower()
        if "tool_use" in body or "tool_result" in body:
            return True
    msg = str(exc).lower()
    return "tool_use_id" in msg or "tool_result" in msg


def _gemini_model() -> GoogleModel:
    return GoogleModel(
        GEMINI_MODEL,
        provider=GoogleProvider(api_key=os.environ.get("GOOGLE_API_KEY")),
    )


def _anthropic_model(model_name: str) -> AnthropicModel:
    return AnthropicModel(
        model_name,
        provider=AnthropicProvider(api_key=os.environ.get("ANTHROPIC_API_KEY")),
    )


def _build_fallback(anthropic_model: str) -> FallbackModel:
    """Anthropic primary with Gemini Flash Lite on 429."""
    return FallbackModel(
        _anthropic_model(anthropic_model),
        _gemini_model(),
        fallback_on=_is_rate_limit_error,
    )


def build_finalize_model() -> FallbackModel:
    """Sonnet — saves, reflections, final replies."""
    return _build_fallback(SONNET_MODEL)


def build_research_model() -> FallbackModel:
    """Haiku — search, diligence, research turns."""
    return _build_fallback(HAIKU_MODEL)


finalize_model = build_finalize_model()
research_model = build_research_model()

# Back-compat
model = finalize_model
fast_model = research_model


async def run_with_retry(agent, prompt: str, *, max_attempts: int = 6, **kwargs):
    for attempt in range(max_attempts):
        try:
            return await agent.run(prompt, **kwargs)
        except Exception as e:
            if not _is_rate_limit_error(e) or attempt == max_attempts - 1:
                raise
            delay = 3 * (2 ** attempt)
            print(
                f"rate limited, retrying in {delay}s "
                f"(attempt {attempt + 1}/{max_attempts})"
            )
            await asyncio.sleep(delay)
