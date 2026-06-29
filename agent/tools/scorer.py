from models import ScoreBreakdown

def calculate_score(breakdown: dict, num_sources: int) -> ScoreBreakdown:
    """
    Calculate the final score based on the V5 scoring model.
    Applies triangulation bonus deterministically and caps the total at 100.
    """
    # Triangulation bonus: +10 per additional source beyond first (max +20)
    triangulation = 0
    if num_sources > 1:
        triangulation = min((num_sources - 1) * 10, 20)
        
    breakdown['triangulation_bonus'] = triangulation
    
    # Calculate base points
    base = (
        breakdown.get('founder_pedigree', 0) +
        breakdown.get('ai_native', 0) +
        breakdown.get('early_traction', 0) +
        breakdown.get('obscurity_bonus', 0) +
        breakdown.get('recency', 0) +
        breakdown.get('warm_intro_potential', 0)
    )
    
    # Apply bonuses and penalties
    total = base + triangulation
    total -= breakdown.get('recent_press_penalty', 0)
    total -= breakdown.get('crunchbase_news_penalty', 0)
    total -= breakdown.get('high_google_rank_penalty', 0)
    total -= breakdown.get('large_round_signal_penalty', 0)
    
    # Ensure total is between 0 and 100
    total = max(0, min(100, total))
    breakdown['total'] = total
    
    return ScoreBreakdown(**breakdown)

def apply_hard_filters(features: dict) -> bool:
    """
    Returns True if the startup passes hard filters, False if disqualified.
    `features` should be evaluated by the LLM.
    """
    if features.get('has_recent_press', False):
        return False
    if features.get('raised_over_10M', False):
        return False
    if features.get('team_over_20', False):
        return False
    if features.get('founded_over_18mo_ago', False):
        return False
    if features.get('no_traction_signal', False):
        return False
        
    return True
