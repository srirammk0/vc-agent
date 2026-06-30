"""LLM routing and cost controls.

All agents use claude-sonnet-5.

Extended thinking: NOT enabled. We never set `anthropic_thinking` on any request.

Batch API: not used — scout, SMS, and digest jobs need synchronous replies.
"""

import os
import asyncio

from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.models.anthropic import AnthropicModel, AnthropicModelSettings
# from pydantic_ai.models.fallback import FallbackModel
from pydantic_ai.providers.anthropic import AnthropicProvider

SONNET_MODEL = "claude-sonnet-5"
# HAIKU_MODEL = "claude-haiku-4-5"


def _cache_base() -> dict:
    return {
        "anthropic_cache_tool_definitions": "1h",
        "anthropic_cache_instructions": True,
        "anthropic_cache": True,
    }


def _settings(max_tokens: int) -> AnthropicModelSettings:
    return AnthropicModelSettings(max_tokens=max_tokens, **_cache_base())


# Research settings (used by research agents, mapped to Sonnet 5)
RESEARCH_SETTINGS = _settings(1400)

# Sonnet 5 — all agents
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


def _anthropic_model(model_name: str) -> AnthropicModel:
    return AnthropicModel(
        model_name,
        provider=AnthropicProvider(api_key=os.environ.get("ANTHROPIC_API_KEY")),
    )


def build_finalize_model() -> AnthropicModel:
    """Sonnet 5 — all agents."""
    return _anthropic_model(SONNET_MODEL)


# def build_research_model() -> AnthropicModel:
#     """Haiku — search, diligence, research turns."""
#     return _anthropic_model(HAIKU_MODEL)


finalize_model = build_finalize_model()
research_model = finalize_model

# Back-compat
model = finalize_model
fast_model = finalize_model


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
