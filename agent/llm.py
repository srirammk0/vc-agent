import os
import asyncio

from openai import AsyncOpenAI, RateLimitError
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.models.fallback import FallbackModel
from pydantic_ai.models.google import GoogleModel
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.google import GoogleProvider
from pydantic_ai.providers.openai import OpenAIProvider

CEREBRAS_MODEL = "gpt-oss-120b"
GEMINI_FALLBACK_MODEL = "gemini-3.1-flash-lite"


def _is_rate_limit_error(exc: BaseException) -> bool:
    if isinstance(exc, RateLimitError):
        return True
    if isinstance(exc, ModelHTTPError) and exc.status_code == 429:
        return True
    cause = exc.__cause__
    if cause is not None and cause is not exc:
        return _is_rate_limit_error(cause)
    return False


def _cerebras_model() -> OpenAIChatModel:
    client = AsyncOpenAI(
        base_url="https://api.cerebras.ai/v1",
        api_key=os.environ.get("CEREBRAS_API_KEY", ""),
        max_retries=0,
    )
    return OpenAIChatModel(
        CEREBRAS_MODEL,
        provider=OpenAIProvider(openai_client=client),
    )


def _gemini_model() -> GoogleModel:
    return GoogleModel(
        GEMINI_FALLBACK_MODEL,
        provider=GoogleProvider(api_key=os.environ.get("GOOGLE_API_KEY")),
    )


def build_model() -> FallbackModel:
    """Cerebras primary; gemini-3.1-flash-lite when Cerebras returns 429."""
    return FallbackModel(
        _cerebras_model(),
        _gemini_model(),
        fallback_on=_is_rate_limit_error,
    )


model = build_model()


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
