# rules/icd_extractor.py
import json, os, re

BASE = os.path.dirname(__file__)

ICD_PATH = os.path.join(BASE, "icd10.json")
NEG_PATH = os.path.join(BASE, "negations.json")

WINDOW = 48  # chars of context around a match to check negation

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
    lc = ctx.lower()
    return any(n in lc for n in NEG)


def extract_icd(text: str):
    """Negation-aware keyword → ICD matching.
    Returns {"primary": {code,label}|None, "supporting": [{code,label}, ...]}
    Ranking pref: G-codes > R-codes > others; then by frequency.
    """
    tl = (text or "").lower()
    if not tl or not ICD:
        return {"primary": None, "supporting": []}

    hits = []
    for code, spec in ICD.items():
        lbl = spec.get("label", code)
        kws = [k.lower() for k in spec.get("keywords", [])]
        if not kws:
            continue
        for kw in kws:
            for m in re.finditer(re.escape(kw), tl):
                s, e = m.span()
                ctx = tl[max(0, s-WINDOW):min(len(tl), e+WINDOW)]
                if _negated(ctx):
                    continue
                hits.append((code, lbl))
                break  # one hit per kw is enough

    if not hits:
        return {"primary": None, "supporting": []}

    # Count & rank
    counts = {}
    for c, lbl in hits:
        counts.setdefault(c, {"label": lbl, "count": 0})
        counts[c]["count"] += 1

    def rank_key(item):
        c, meta = item
        lead = c[0].upper()
        lead_rank = 0 if lead == 'G' else (1 if lead == 'R' else 2)
        return (lead_rank, -meta["count"])  # lower is better

    ranked = sorted(counts.items(), key=rank_key)
    primary_code, meta = ranked[0]
    supporting = [{"code": c, "label": v["label"]} for c, v in ranked[1:4]]

    return {"primary": {"code": primary_code, "label": meta["label"]}, "supporting": supporting}


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
