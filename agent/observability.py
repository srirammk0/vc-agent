"""Centralized Logfire observability helpers (spans + cost + enrichment metrics).

Everything here is a safe no-op when Logfire isn't configured
(``logfire.configure(send_to_logfire="if-token-present")`` means local/dev runs
without a write token produce no spans or metrics but never crash), so the agent
keeps behaving identically with or without a token.

What this wires up for the user:
  * ``record_llm_usage`` — token + USD cost for every AI call, emitted as Logfire
    counters (``llm.cost``, ``llm.tokens``) so spend shows up in Logfire's
    metrics/dashboard and can be broken down by ``model``/``purpose``.
  * ``span`` — a context manager wrapping a unit of work (e.g. one enrichment run)
    in a Logfire span that gets status/duration attributes written on it, so each
    startup's enrichment is traceable (per-slug) rather than invisible.
  * ``record_enrichment`` — outcome counter + duration histogram per enrichment run.

Pricing is the per-1M-token USD input/output rate for each model, kept as a
small table below. These mirror current Anthropic list prices; bump them if the
account's billed rate changes. Prices are used only to *display* cost in Logfire —
they never gate or alter any code path.
"""

from __future__ import annotations

import time
from contextlib import contextmanager
from typing import Any, Optional

# USD per 1M tokens, keyed by the exact model strings used in llm.py.
_MODEL_PRICES_PER_MTK: dict[str, tuple[float, float]] = {
    # input, output ($ per 1M tokens)
    "claude-sonnet-5": (3.0, 15.0),
    "claude-haiku-4-5-20251001": (1.0, 5.0),
}
_DEFAULT_PRICE = _MODEL_PRICES_PER_MTK["claude-sonnet-5"]

_cost_meter = None
_token_meter = None
_enrich_meter = None
_enrich_histogram = None


class _NullSpan:
    """Stand-in when Logfire isn't available — accepts every call, records nothing."""

    def set_attribute(self, key: str, value: Any) -> None:  # noqa: D401
        pass

    def set_attributes(self, attributes: dict[str, Any]) -> None:
        pass


def _lf():
    try:
        import logfire  # type: ignore

        return logfire
    except Exception:
        return None


def _meters():
    global _cost_meter, _token_meter, _enrich_meter, _enrich_histogram
    lf = _lf()
    if lf is None:
        return None, None, None
    if _cost_meter is None:
        _cost_meter = lf.metric_counter("llm.cost", unit="$", description="Total LLM spend in USD")
        _token_meter = lf.metric_counter("llm.tokens", unit="token", description="Total LLM tokens consumed")
        _enrich_meter = lf.metric_counter("enrichment.runs", unit="1", description="Enrichment runs by outcome")
        _enrich_histogram = lf.metric_histogram("enrichment.duration", unit="s", description="Enrichment run duration")
    return _cost_meter, _token_meter, _enrich_meter


def _price_for(model: str) -> tuple[float, float]:
    return _MODEL_PRICES_PER_MTK.get(model, _DEFAULT_PRICE)


def record_llm_usage(
    model: str,
    request_tokens: int,
    response_tokens: int,
    purpose: str = "general",
    **extra: Any,
) -> None:
    """Record token + USD cost for one AI call as Logfire counters.

    ``purpose``/extra become metric attributes so Logfire can break spend down by
    model, enrichment-vs-chat-vs-scheduled, slug, etc.
    """
    cost_meter, token_meter, _ = _meters()
    if cost_meter is None:
        return
    inp, outp = _price_for(model)
    req = request_tokens or 0
    resp = response_tokens or 0
    cost = (req / 1_000_000) * inp + (resp / 1_000_000) * outp
    base: dict[str, Any] = {"model": model, "purpose": purpose}
    if extra:
        base.update({str(k): (str(v) if v is not None else "") for k, v in extra.items()})
    if cost > 0:
        cost_meter.add(cost, dict(base))
    token_meter.add(req + resp, dict(base))


def record_enrichment(
    slug: str,
    status: str,
    source: str = "",
    filled: str = "",
    error: str = "",
    duration_s: float = 0.0,
) -> None:
    """Emit one enrichment outcome metric + duration histogram for a startup."""
    _, _, enrich_meter = _meters()
    if enrich_meter is None:
        return
    attrs = {
        "slug": (slug or "")[:200],
        "status": status or "unknown",
        "source": (source or "")[:40],
        "filled": (filled or "")[:200],
    }
    if error:
        attrs["error"] = (error or "")[:300]
    enrich_meter.add(1, dict(attrs))
    if duration_s > 0:
        _enrich_histogram.record(duration_s, {"slug": (slug or "")[:200], "status": status})


@contextmanager
def span(name: str, **attributes: Any):
    """A Logfire span that is a no-op when Logfire isn't configured.

    Usage::

        with observability.span("enrich.startup", slug=slug) as s:
            ...  # on success/failure
            s.set_attribute("status", "enriched")

    The yielded object always has ``set_attribute``/``set_attributes``, so callers
    don't need to branch on whether Logfire is present.
    """
    lf = _lf()
    if lf is None:
        yield _NullSpan()
        return
    with lf.span(name, **attributes) as s:
        yield s
