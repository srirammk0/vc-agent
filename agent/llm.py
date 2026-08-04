"""LLM routing and cost controls.

All agents use claude-sonnet-5.

Extended thinking: NOT enabled. We never set `anthropic_thinking` on any request.

Batch API: not used — dashboard chat, feedback, and scheduled runs all need
synchronous (or streamed) replies, not a batched turnaround.
"""

import os
import asyncio

import httpx

import observability
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.models.anthropic import AnthropicModel, AnthropicModelSettings
from pydantic_ai.providers.anthropic import AnthropicProvider

SONNET_MODEL = "claude-sonnet-5"
HAIKU_MODEL = "claude-haiku-4-5-20251001"


def _cache_base() -> dict:
    return {
        "anthropic_cache_tool_definitions": "1h",
        "anthropic_cache_instructions": True,
        "anthropic_cache": True,
    }


def _settings(max_tokens: int) -> AnthropicModelSettings:
    return AnthropicModelSettings(max_tokens=max_tokens, **_cache_base())


# Sonnet 5 — assistant_agent's default (mode="assistant": dashboard chat,
# scheduled runs). 8000 was too tight: a batch save_startups call (many candidates
# at once, each with founders/positions/credibility_note for stealth ones) could
# need well more output tokens than that to finish in one turn, hitting "Model
# token limit exceeded before any response was generated" with nothing saved at
# all. Doubled — NOT raised further than this: the Anthropic SDK hard-requires
# streaming for any non-streaming call whose max_tokens implies more than 10
# minutes of generation, computed as 3600 * max_tokens / 128_000 (see
# anthropic._base_client._calculate_nonstreaming_timeout). Scheduled-run calls go
# through pydantic-ai's non-streaming agent.run(), so max_tokens above ~21_333
# raises a ValueError outright on every one of those calls ("Streaming is required
# for operations that may take longer than 10 minutes") — 16000 (450s estimated)
# keeps a comfortable margin under that hard ceiling while still doubling the room
# for a large batch save. (Web chat streams instead, via agent.iter(), so this
# ceiling doesn't bind there the same way — kept the same value regardless for one
# less thing to reason about between the two.)
FINALIZE_SETTINGS = _settings(16000)
# mode="feedback"'s per-call override (run_feedback passes this as model_settings=)
# — narrower than FINALIZE_SETTINGS since distilling one preference from one
# reason never needs anywhere near 16000 tokens.
FINALIZE_FEEDBACK_SETTINGS = _settings(4000)

ENRICH_SETTINGS = _settings(6000)


def _is_rate_limit_error(exc: BaseException) -> bool:
    if isinstance(exc, ModelHTTPError) and exc.status_code == 429:
        return True
    cause = exc.__cause__
    if cause is not None and cause is not exc:
        return _is_rate_limit_error(cause)
    return False


_TRANSIENT_HTTP_STATUSES = {429, 500, 502, 503, 529}


def _is_transient_error(exc: BaseException) -> bool:
    """Broader than _is_rate_limit_error — also covers other 5xx/529 upstream errors
    and network-level timeouts, which are just as retryable as a 429 but weren't
    being retried before. This is an infra-level retry, distinct from the
    prompt-level "[tool error]" self-healing rule in CORE_RULES that governs how the
    *model* reacts to a tool call failing — that's the model recovering from a bad
    tool result, this is recovering from the transport/API layer itself misbehaving."""
    if isinstance(exc, ModelHTTPError) and exc.status_code in _TRANSIENT_HTTP_STATUSES:
        return True
    if isinstance(exc, (httpx.TimeoutException, httpx.TransportError)):
        return True
    cause = exc.__cause__
    if cause is not None and cause is not exc:
        return _is_transient_error(cause)
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


# Sonnet 5 — assistant_agent's default model for research/decision-critical work
# (dashboard chat, scheduled runs; mode="feedback" overrides to fast_model per-call
# instead — see AgentDeps.mode).
finalize_model = _anthropic_model(SONNET_MODEL)

# Haiku 4.5 — narrow, mechanical tasks that don't need Sonnet's judgment. Currently just
# feedback distillation (agent.run_feedback passes this as a per-call model= override
# on the shared assistant_agent — see AgentDeps.mode) — real effort-tiering instead of
# the previous fast_model = finalize_model alias, which had no actual tiering despite
# the name.
fast_model = _anthropic_model(HAIKU_MODEL)


def _resolved_model_name(agent, kwargs: dict) -> str:
    """Best-effort model name for cost labeling, or 'unknown'.

    Handles both pydantic-ai model objects (which may expose the id via a
    ``name`` attribute/method or a ``model_name`` attribute) and plain strings.
    """
    model_obj = kwargs.get("model") or getattr(agent, "model", None)
    if model_obj is None:
        return "unknown"
    if isinstance(model_obj, str):
        return model_obj
    # 1) name attribute (plain or callable)
    name = getattr(model_obj, "name", None)
    if callable(name):
        try:
            return str(name())
        except Exception:
            pass
    elif name:
        return str(name)
    # 2) model_name attribute (AnthropicModel etc.)
    model_name = getattr(model_obj, "model_name", None)
    if model_name:
        return str(model_name)
    return "unknown"


async def run_with_retry(agent, prompt: str, *, max_attempts: int = 8, purpose: str = "general", **kwargs):
    """Run an agent with transient-error retries, recording token + USD cost to
    Logfire on every successful run (observability.record_llm_usage). ``purpose``
    becomes a metric attribute so spend can be split by enrichment / feedback /
    scheduled_run / general / web_chat.
    """
    model_name = _resolved_model_name(agent, kwargs)
    for attempt in range(max_attempts):
        try:
            res = await agent.run(prompt, **kwargs)
        except Exception as e:
            if not _is_transient_error(e) or attempt == max_attempts - 1:
                raise
            delay = 3 * (2 ** attempt)
            print(
                f"transient error ({type(e).__name__}), retrying in {delay}s "
                f"(attempt {attempt + 1}/{max_attempts})"
            )
            await asyncio.sleep(delay)
        else:
            try:
                usage = res.usage()
                observability.record_llm_usage(
                    model_name,
                    getattr(usage, "request_tokens", 0) or 0,
                    getattr(usage, "response_tokens", 0) or 0,
                    purpose=purpose,
                )
            except Exception:
                # Cost logging must never break the run.
                pass
            return res
