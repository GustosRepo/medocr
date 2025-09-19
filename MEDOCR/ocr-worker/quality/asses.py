# quality/assess.py
import json, os
from typing import Dict, Any, List, Optional, Union

BASE = os.path.dirname(__file__)
RULES_PATH = os.path.join(os.path.dirname(BASE), "config", "rules", "confidence_rules.json")

def _get(d: Dict[str, Any], path: str):
    cur = d
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur

def load_rules():
    try:
        with open(RULES_PATH, "r") as f:
            return json.load(f)
    except Exception:
        # sensible defaults if file missing
        return {
            "thresholds": {"high": 90, "medium": 80, "low": 70},
            "criticalFields": ["patient.name","patient.dob","insurance.primary.carrier","procedure.cpt"],
            "manualTriggers": ["contradictions","handwriting_blocked","missing_required"]
        }

def compute_confidence(parsed: Dict[str, Any], ocr_percent: Optional[Union[float, int]] = None,
                       manual_signals: Optional[List[str]] = None):
    """
    Returns: {
      "label": "High|Medium|Low|Manual Review",
      "score": <ocr_percent or inferred>,
      "reasons": [ ... ],
      "missingCritical": [ ... ]
    }
    """
    rules = load_rules()
    thresholds = rules.get("thresholds", {})
    manual_triggers = set(rules.get("manualTriggers", []))
    criticals = rules.get("criticalFields", [])

    reasons = []
    missing = []

    # OCR score normalization
    score = None
    if isinstance(ocr_percent, (int, float)):
        try:
            score = float(ocr_percent)
        except Exception:
            score = None

    # Critical field completeness
    for path in criticals:
        if _get(parsed, path) in (None, "", [], {}):
            missing.append(path)

    # Manual triggers
    manual = False
    for sig in (manual_signals or []):
        if sig in manual_triggers:
            manual = True
            reasons.append(f"manual:{sig}")

    if missing:
        reasons.append(f"missing_critical:{','.join(missing)}")

    # Label logic (strict)
    if manual:
        return {"label": "Manual Review", "score": score, "reasons": reasons, "missingCritical": missing}

    # If no score provided, infer Low when criticals missing; else Medium as default
    if score is None:
        lbl = "Low" if missing else "Medium"
        return {"label": lbl, "score": score, "reasons": reasons, "missingCritical": missing}

    # Thresholding by OCR score with missing criticals bias
    high = thresholds.get("high", 90)
    med  = thresholds.get("medium", 80)
    low  = thresholds.get("low", 70)

    if missing:
        # bias down one band if criticals missing
        if score >= high:   label = "Medium"
        elif score >= med:  label = "Low"
        else:               label = "Manual Review"
    else:
        if score >= high:   label = "High"
        elif score >= med:  label = "Medium"
        elif score >= low:  label = "Low"
        else:               label = "Manual Review"

    return {"label": label, "score": score, "reasons": reasons, "missingCritical": missing}
