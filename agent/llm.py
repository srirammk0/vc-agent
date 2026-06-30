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

CACHE_SETTINGS = AnthropicModelSettings(
    anthropic_cache_tool_definitions="1h",
    anthropic_cache_instructions=True,
    anthropic_cache=True,
)


def _is_rate_limit_error(exc: BaseException) -> bool:
    if isinstance(exc, ModelHTTPError) and exc.status_code == 429:
        return True
    cause = exc.__cause__
    if cause is not None and cause is not exc:
        return _is_rate_limit_error(cause)
    return False


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


def build_model() -> FallbackModel:
    """Sonnet — SMS, scout, and news digest agents."""
    return _build_fallback(SONNET_MODEL)


def build_fast_model() -> FallbackModel:
    """Haiku — enrichment, dashboard feedback, and other light tasks."""
    return _build_fallback(HAIKU_MODEL)


model = build_model()
fast_model = build_fast_model()


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
