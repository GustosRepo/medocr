# rules/icd_extractor.py
import json, os, re


BASE = os.path.dirname(__file__)

# Optional external NLP rules (proximity/subject/temporal)
NLP_BASE = os.path.join(BASE, "nlp")
RULE_PATH = os.path.join(NLP_BASE, "nlp_rules.json")
try:
    with open(RULE_PATH, "r") as f:
        _NLP_RULES = json.load(f)
except Exception:
    _NLP_RULES = {
        "proximityWindow": 8,
        "subjectHints": ["patient", "pt", "he", "she", "they", "i"],
        "thirdPartyHints": [
            "father","mother","spouse","wife","husband","partner",
            "son","daughter","child","kids","brother","sister",
            "coworker","roommate","grandfather","grandmother","grandparent"
        ],
        "temporalCues": {
            "history": ["hx of","history of","previously","prior","years ago","past medical history","pmh"],
            "resolved": ["resolved","no longer","discontinued","stopped","quit","off cpap"]
        }
    }

# Convert proximity (words) to an approximate char window for legacy char-scanning
WINDOW = int((_NLP_RULES.get("proximityWindow", 8) or 8) * 8)

ICD_PATH = os.path.join(BASE, "icd10.json")
NEG_PATH = os.path.join(BASE, "negations.json")


# Load ICD and negations
try:
    with open(ICD_PATH, "r") as f:
        ICD = json.load(f)
except Exception:
    ICD = {}

try:
    with open(NEG_PATH, "r") as f:
        NEG = set(json.load(f).get("negations", ["denies","no","not","negative","wnl","within normal limits"]))
except Exception:
    NEG = {"denies","no","not","negative","wnl","within normal limits"}


def _negated(ctx: str) -> bool:
    """Detect negation tokens while staying within the local clause."""
    if not ctx:
        return False

    lc = ctx.lower()
    # Only consider the clause immediately preceding the match to avoid
    # negations from unrelated earlier sentences (e.g., "not rested" in HPI
    # should not invalidate a subsequent "Diagnosis" line).
    tail = re.split(r"[\n\r\.\;]", lc)[-1]
    tail = tail[-80:]  # limit to nearby context

    for token in NEG:
        if not token:
            continue
        if ' ' in token:
            if token in tail:
                return True
        else:
            if re.search(rf"\b{re.escape(token)}\b", tail):
                return True
    return False


def extract_icd(text: str, patient_age: int = None):
    """Negation/subject/temporal‑aware keyword → ICD matching.
    Returns {"primary": {code,label}|None, "supporting": [{code,label}, ...]}
    Ranking pref: G-codes > R-codes > others; then by weighted frequency.
    """
    tl = (text or "").lower()
    if not tl or not ICD:
        return {"primary": None, "supporting": []}

    hits = []  # (code, label, weight)
    for code, spec in ICD.items():
        lbl = spec.get("label", code)
        kws = [k.lower() for k in spec.get("keywords", [])]
        if not kws:
            continue
        for kw in kws:
            # Use word boundaries to avoid partial hits (e.g., 'osa' inside 'mimosa')
            pattern = re.compile(r"(?<![A-Za-z0-9])" + re.escape(kw) + r"(?![A-Za-z0-9])")
            for m in pattern.finditer(tl):
                s, e = m.span()
                ctx = tl[max(0, s-WINDOW):min(len(tl), e+WINDOW)]
                if _negated(ctx):
                    continue
                if _is_third_party(ctx):
                    # skip third‑party mentions like 'father snores'
                    continue
                weight = 1.0
                if _has_history(ctx):
                    weight *= 0.6  # de‑prioritize historical mentions
                if _is_resolved(ctx):
                    weight *= 0.4  # strongly de‑prioritize resolved mentions
                hits.append((code, lbl, weight))
                break  # one hit per kw is enough

    if not hits:
        return {"primary": None, "supporting": []}

    # Accumulate weighted scores per code
    scores = {}
    for code, label, w in hits:
        meta = scores.setdefault(code, {"label": label, "score": 0.0})
        meta["score"] += w

    def rank_key(item):
        c, meta = item
        lead = c[0].upper()
        lead_rank = 0 if lead == 'G' else (1 if lead == 'R' else 2)
        return (lead_rank, -meta["score"])  # lower is better

    ranked = sorted(scores.items(), key=rank_key)
    primary_code, meta = ranked[0]
    supporting = [{"code": c, "label": v["label"]} for c, v in ranked[1:4]]

    return {"primary": {"code": primary_code, "label": meta["label"]}, "supporting": supporting}


# Heuristics for subject/temporal context (rule-driven)

def _is_third_party(ctx: str) -> bool:
    lc = (ctx or "").lower()
    return any(tp in lc for tp in _NLP_RULES.get("thirdPartyHints", []))


def _has_history(ctx: str) -> bool:
    lc = (ctx or "").lower()
    return any(h in lc for h in _NLP_RULES.get("temporalCues", {}).get("history", []))


def _is_resolved(ctx: str) -> bool:
    lc = (ctx or "").lower()
    return any(r in lc for r in _NLP_RULES.get("temporalCues", {}).get("resolved", []))


# ---- Place this JSON at rules/icd10.json ----
# {
#   "G47.33": {"label": "Obstructive Sleep Apnea (Adult)", "keywords": ["osa","obstructive sleep apnea","apnea (obstructive)"]},
#   "G47.30": {"label": "Sleep Apnea, Unspecified", "keywords": ["sleep apnea","apnea unspecified"]},
#   "G47.10": {"label": "Hypersomnia, Unspecified", "keywords": ["hypersomnia","excessive daytime sleepiness","eds"]},
#   "R06.83": {"label": "Snoring", "keywords": ["snoring","loud snoring"]},
#   "G25.81": {"label": "Restless Legs Syndrome", "keywords": ["restless legs","rls"]},
#   "G47.00": {"label": "Insomnia, Unspecified", "keywords": ["insomnia"]},
#   "G47.21": {"label": "CRSD, Delayed Sleep Phase", "keywords": ["delayed sleep phase","dsps"]},
#   "G47.26": {"label": "CRSD, Shift Work Type", "keywords": ["shift work disorder","shift-work"]},
#   "G47.52": {"label": "REM Sleep Behavior Disorder", "keywords": ["rem behavior disorder","rbd"]},
#   "Z99.81": {"label": "Dependence on Supplemental Oxygen", "keywords": ["on oxygen","supplemental oxygen","oxygen dependent"]},
#   "I10": {"label": "Essential Hypertension", "keywords": ["hypertension","htn"]},
#   "E66.9": {"label": "Obesity, Unspecified", "keywords": ["obesity","obese","bmi >","morbid obesity"]},
#   "G47.411": {"label": "Narcolepsy with Cataplexy", "keywords": ["narcolepsy with cataplexy"]},
#   "G47.419": {"label": "Narcolepsy without Cataplexy", "keywords": ["narcolepsy"]},
#   "G47.62": {"label": "Sleep Related Leg Cramps", "keywords": ["leg cramps at night","nocturnal leg cramps"]},
#   "F90.9": {"label": "ADHD, Unspecified Type (Peds)", "keywords": ["adhd","attention deficit"]},
#   "F98.0": {"label": "Enuresis", "keywords": ["bedwetting","enuresis"]}
# }
