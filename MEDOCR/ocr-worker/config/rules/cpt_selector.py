# rules/cpt_selector.py
import json
import os

# Load JSON rule files
BASE_DIR = os.path.dirname(__file__)
with open(os.path.join(BASE_DIR, "cpt_selector.json")) as f:
    CPT_SELECTOR = json.load(f)
with open(os.path.join(BASE_DIR, "cpt_keywords.json")) as f:
    CPT_KEYWORDS = json.load(f)

def select_cpt(extracted_text: str, patient_age: int = None, prior_positive_test: bool = False, cpap_issues: list = None):
    """
    Decide the final CPT code based on referral text, age, and context.
    Returns dict: { "code": ..., "reason": ... }
    """

    text_lower = extracted_text.lower()
    cpap_issues = cpap_issues or []

    # 1. Pediatric override
    if patient_age is not None and patient_age < CPT_SELECTOR["pediatricRouting"]["ageUnder"]:
        return {
            "code": CPT_SELECTOR["pediatricRouting"]["codes"][0],
            "reason": f"Pediatric patient (age {patient_age})"
        }

    # 2. Split-night safeguard
    if "split night" in text_lower:
        return {
            "code": CPT_SELECTOR["splitNight"]["preferred"],
            "reason": "Split-night mentioned → mapped to preferred code"
        }

    # 3. Titration auto-approval (95811)
    if "95811" in text_lower or "titration" in text_lower:
        if prior_positive_test or any(issue in cpap_issues for issue in CPT_SELECTOR["titrationAutoApproval"]["requiresAny"]):
            return {
                "code": "95811",
                "reason": "Titration requested + criteria met"
            }
        else:
            return {
                "code": "95811",
                "reason": "Titration requested but criteria NOT fully met → flag for review"
            }

    # 4. Diagnostic routing
    for kw in CPT_SELECTOR["diagnosticRouting"]["home_keywords"]:
        if kw in text_lower:
            return {
                "code": "G0399",
                "reason": f"Home-study keyword matched: {kw}"
            }
    for kw in CPT_SELECTOR["diagnosticRouting"]["lab_keywords"]:
        if kw in text_lower:
            return {
                "code": "95810",
                "reason": f"Lab-study keyword matched: {kw}"
            }

    # 5. CPT keyword fallback
    for kw, cpt in CPT_KEYWORDS.items():
        if kw.lower() in text_lower:
            return {
                "code": cpt,
                "reason": f"Matched keyword '{kw}' → {cpt}"
            }

    # 6. Default fallback
    return {
        "code": CPT_SELECTOR["fallback"]["code"],
        "reason": "No matches → fallback to default"
    }

# Example quick test
if __name__ == "__main__":
    sample = "Referral for sleep evaluation, in-lab overnight polysomnography."
    print(select_cpt(sample, patient_age=45))