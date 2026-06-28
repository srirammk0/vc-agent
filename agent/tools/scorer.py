async def score_startup(startup_data: dict) -> dict:
    """
    Score a startup 0-100 against VC criteria.
    Returns score breakdown and whether it passes the threshold.
    """
    s = startup_data

    # Founder pedigree /25
    founder_score = 0
    bg = s.get("founder_background", "").lower()
    if any(x in bg for x in ["yc", "y combinator"]):
        founder_score += 15
    if any(x in bg for x in ["stripe", "openai", "google", "meta", "apple"]):
        founder_score += 10
    if "phd" in bg or "stanford" in bg or "mit" in bg:
        founder_score += 8
    if "repeat founder" in bg or "second time" in bg:
        founder_score += 7
    founder_score = min(founder_score, 25)

    # AI-native /20
    ai_score = 20 if s.get("ai_native", False) else 5

    # Stage fit /20
    stage = s.get("stage", "").lower()
    raised = s.get("raised_usd", 999_999_999)
    stage_score = 20 if (stage in ["pre-seed", "seed"] and raised < 10_000_000) else 0

    # Recency /15 — agent should downgrade if founded > 18 months ago
    recency_score = 15

    # Traction /10
    traction = s.get("traction_signals", [])
    traction_score = min(len(traction) * 3, 10)

    # Geo /10
    geo = s.get("location", "").lower()
    geo_score = 10 if any(x in geo for x in ["san francisco", "sf", "new york", "nyc", "remote"]) else 5

    total = founder_score + ai_score + stage_score + recency_score + traction_score + geo_score

    return {
        "founder_pedigree": founder_score,
        "ai_native": ai_score,
        "stage_fit": stage_score,
        "recency": recency_score,
        "traction": traction_score,
        "geo_fit": geo_score,
        "total": total,
        "passes_threshold": total >= 50,
        "high_signal": total >= 75,
    }
