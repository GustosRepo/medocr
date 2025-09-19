# rules/cpt_selector.py
import json
import os
from typing import Dict, List, Optional

# ------------------------------------------------------------
# Helpers to load JSON rule files safely
# ------------------------------------------------------------
BASE_DIR = os.path.dirname(__file__)


def _safe_load_json(filename: str, default):
    path = os.path.join(BASE_DIR, filename)
    try:
        with open(path, "r") as f:
            return json.load(f)
    except FileNotFoundError:
        return default
    except Exception:
        # If a rule file is malformed, fail soft and continue
        return default


# Core rule files
CPT_SELECTOR: Dict = _safe_load_json(
    "cpt_selector.json",
    {
        "pediatricRouting": {"ageUnder": 13, "codes": ["95782"]},
        "splitNight": {"preferred": "95811"},
        "titrationAutoApproval": {"requiresAny": ["intolerant", "noncompliant", "mask", "pressure", "side effects"]},
        "diagnosticRouting": {
            "home_keywords": ["home sleep", "hstas", "hsat", "at home", "watchpat", "g0399"],
            "lab_keywords": ["in-lab", "lab study", "polysomnography", "psg", "95810"]
        },
        "fallback": {"code": "95810"}
    },
)

# Simple keyword → CPT fallback map
CPT_KEYWORDS: Dict[str, str] = _safe_load_json("cpt_keywords.json", {})

# Optional rule files (used if present)
NEGATIONS: List[str] = _safe_load_json("negations.json", [])
INSURANCE_RULES: Dict = _safe_load_json("insurance.json", {})


# ------------------------------------------------------------
# Normalization helpers
# ------------------------------------------------------------

def _normalize_payer(insurance: Optional[Dict]) -> str:
    """Return a normalized payer bucket: 'medicare', 'medicare_advantage', 'commercial', or ''"""
    if not insurance:
        return ""

    # Try a few fields commonly present in the project
    carrier = (insurance.get("carrier") or insurance.get("name") or "").lower()
    plan = (insurance.get("plan") or insurance.get("program") or "").lower()

    text = f"{carrier} {plan}".strip()

    if any(k in text for k in ["medicare advantage", "maa", "mapd", "advantage"]):
        return "medicare_advantage"
    if "medicare" in text:
        return "medicare"
    return "commercial"


def _contains(text: str, keywords: List[str]) -> Optional[str]:
    for kw in keywords:
        if kw and kw.lower() in text:
            return kw
    return None


def _negated(text: str, phrase: str) -> bool:
    # Very light-weight negation check: if a negation term appears within a short window before the phrase
    idx = text.find(phrase.lower())
    if idx == -1 or not NEGATIONS:
        return False
    window_start = max(0, idx - 30)
    window = text[window_start:idx]
    return any(neg in window for neg in NEGATIONS)


# ------------------------------------------------------------
# Main selector
# ------------------------------------------------------------

def select_cpt(
    extracted_text: str,
    patient_age: Optional[int] = None,
    prior_positive_test: bool = False,
    cpap_issues: Optional[List[str]] = None,
    insurance: Optional[Dict] = None,
):
    """
    Decide the final CPT code based on referral text + small bit of context.
    Returns dict: { "code": str, "reason": str }

    Backwards compatible with the previous signature: the new 'insurance' param
    is optional. If provided, we use payer-specific routing for home-vs-lab.
    """

    text_lower = (extracted_text or "").lower()
    cpap_issues = cpap_issues or []
    payer_bucket = _normalize_payer(insurance)

    # 1) Pediatric override
    if patient_age is not None and patient_age < CPT_SELECTOR.get("pediatricRouting", {}).get("ageUnder", -1):
        return {
            "code": CPT_SELECTOR["pediatricRouting"]["codes"][0],
            "reason": f"Pediatric patient (age {patient_age})"
        }

    # 2) Split-night safeguard (explicit mention wins)
    if "split night" in text_lower and not _negated(text_lower, "split night"):
        return {
            "code": CPT_SELECTOR.get("splitNight", {}).get("preferred", "95811"),
            "reason": "Split-night mentioned → mapped to preferred code"
        }

    # 3) Titration request (95811)
    if any(tok in text_lower for tok in ["95811", "titration", "cpap titration", "bipap titration"]):
        if prior_positive_test or any(issue.lower() in text_lower for issue in CPT_SELECTOR.get("titrationAutoApproval", {}).get("requiresAny", [])):
            return {"code": "95811", "reason": "Titration requested + criteria met"}
        else:
            return {"code": "95811", "reason": "Titration requested but criteria NOT fully met → flag for review"}

    # 4) Diagnostic routing (home vs lab)
    diag = CPT_SELECTOR.get("diagnosticRouting", {})
    home_hit = _contains(text_lower, diag.get("home_keywords", []))
    lab_hit = _contains(text_lower, diag.get("lab_keywords", []))

    if home_hit and not _negated(text_lower, home_hit):
        # Payer-specific: Medicare/MA usually use G-codes for unattended HSAT (G0399 by default)
        if payer_bucket in {"medicare", "medicare_advantage"}:
            return {"code": "G0399", "reason": f"Home-study ('{home_hit}') + {payer_bucket.replace('_', ' ')}"}
        # Otherwise most commercial plans: 95806
        return {"code": "95806", "reason": f"Home-study ('{home_hit}') + commercial"}

    if lab_hit and not _negated(text_lower, lab_hit):
        return {"code": "95810", "reason": f"Lab-study keyword matched: {lab_hit}"}

    # 5) Direct CPT keyword fallback (configurable)
    for kw, cpt in CPT_KEYWORDS.items():
        if kw and kw.lower() in text_lower and not _negated(text_lower, kw):
            return {"code": str(cpt), "reason": f"Matched keyword '{kw}' → {cpt}"}

    # 6) Fallback
    return {
        "code": CPT_SELECTOR.get("fallback", {}).get("code", "95810"),
        "reason": "No rule hit → fallback to default",
    }


# Example quick test
if __name__ == "__main__":
    sample = "Referral for home sleep study (HSAT) per Medicare Advantage plan."
    print(select_cpt(sample, patient_age=45, insurance={"carrier": "UnitedHealthcare", "plan": "AARP Optum Medicare Complete"}))