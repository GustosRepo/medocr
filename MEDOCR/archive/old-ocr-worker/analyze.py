#!/usr/bin/env python3
import json
import re
import datetime
from pathlib import Path
from typing import Any, List, Dict, Optional
from json import JSONDecodeError
import logging

RULES_DIR = Path(__file__).resolve().parent / "rules"

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def load_rules(filename: str, default=None) -> Any:
    if default is None:
        default = {}
    path = RULES_DIR / filename
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        logger.warning("Rules file not found: %s - using default", path)
        return default
    except JSONDecodeError:
        logger.warning("Rules file invalid JSON: %s - using default", path)
        return default


# load rules
cpt_keywords = load_rules("cpt_keywords.json", default={})
dme_rules = load_rules("dme.json", default=[])
insurance_rules = load_rules("insurance.json", default={})
negations = load_rules("negations.json", default=[])
symptoms_rules = load_rules("symptoms.json", default={})


def normalize_text(text: Any) -> str:
    if not isinstance(text, str):
        text = str(text or "")
    text = re.sub(r"[^\w\s]", " ", text, flags=re.UNICODE)
    return re.sub(r"\s+", " ", text).strip().lower()


def tokenize(text: Any) -> List[str]:
    if not isinstance(text, str):
        text = str(text or "")
    return re.findall(r"\w+", text.lower())


def detect_insurance(text: str) -> Dict[str, Any]:
    text_norm = normalize_text(text)
    accepted = insurance_rules.get("accepted", [])
    auto_flag = insurance_rules.get("auto_flag", [])
    contract_end = insurance_rules.get("contract_end", {})
    detected = {"accepted": [], "auto_flag": [], "contract_end": None}
    for ins in accepted:
        if isinstance(ins, str) and re.search(rf"\b{re.escape(ins.lower())}\b", text_norm):
            detected["accepted"].append(ins)
    for ins in auto_flag:
        if isinstance(ins, str) and re.search(rf"\b{re.escape(ins.lower())}\b", text_norm):
            detected["auto_flag"].append(ins)
    for ins, end_date_str in contract_end.items():
        if isinstance(ins, str) and re.search(rf"\b{re.escape(ins.lower())}\b", text_norm):
            try:
                detected["contract_end"] = datetime.datetime.strptime(end_date_str, "%Y-%m-%d").date()
            except Exception:
                logger.debug("Invalid contract_end date for %s: %s", ins, end_date_str)
    return detected


def detect_dme(text: str) -> List[Dict[str, str]]:
    detected = []
    text_norm = normalize_text(text)
    for item in dme_rules:
        if not isinstance(item, dict):
            continue
        hcpcs = item.get("hcpcs", "")
        provider = item.get("provider", "")
        hcpcs_list = []
        if isinstance(hcpcs, str):
            hcpcs_list = [hcpcs]
        elif isinstance(hcpcs, list):
            hcpcs_list = hcpcs
        for code in hcpcs_list:
            if code and re.search(rf"\b{re.escape(str(code).lower())}\b", text_norm):
                detected.append(item)
                break
        else:
            if provider and re.search(rf"\b{re.escape(str(provider).lower())}\b", text_norm):
                detected.append(item)
    return detected


def detect_symptoms(text: str) -> Dict[str, Any]:
    priority_keywords = symptoms_rules.get("priority_keywords", [])
    window_size = symptoms_rules.get("window_size", 5)
    tokens = tokenize(text)
    results = []
    negation_set = set([n.lower() for n in negations if isinstance(n, str)])
    groups: List[List[str]] = []
    if isinstance(priority_keywords, list):
        for item in priority_keywords:
            if isinstance(item, list):
                groups.append([str(x).lower() for x in item])
            else:
                groups.append([str(item).lower()])
    for group in groups:
        for i, token in enumerate(tokens):
            if token in group:
                window_start = max(0, i - window_size)
                window_end = min(len(tokens), i + window_size + 1)
                window_tokens = tokens[window_start:window_end]
                if not any(neg in window_tokens for neg in negation_set):
                    results.append(token)
    return {"detected_symptoms": list(dict.fromkeys(results))}


def choose_cpt(text: str) -> str:
    text_norm = normalize_text(text)
    
    # First priority: Look for explicit CPT codes in the text (e.g., "64483", "CPT: 64483")
    for cpt_code in cpt_keywords.keys():
        cpt_pattern = rf"\b{re.escape(str(cpt_code))}\b"
        if re.search(cpt_pattern, text_norm):
            return cpt_code
    
    # Second priority: Look for keyword matches
    for cpt_code, keywords in cpt_keywords.items():
        kws = keywords or []
        if isinstance(kws, str):
            kws = [kws]
        for kw in kws:
            if not kw:
                continue
            if re.search(rf"\b{re.escape(str(kw).lower())}\b", text_norm):
                return cpt_code
    return "UNKNOWN"


def confidence_bucket(conf) -> str:
    try:
        conf_val = float(conf)
    except Exception:
        return "unknown"
    if conf_val < 0:
        return "unknown"
    if conf_val < 50:
        return "low"
    if conf_val < 80:
        return "medium"
    return "high"


def analyze(text: str, avg_conf: Optional[float] = None, referral_date: Optional[datetime.date] = None) -> Dict[str, Any]:
    if referral_date is None:
        referral_date = datetime.date.today()
    elif isinstance(referral_date, str):
        try:
            referral_date = datetime.datetime.strptime(referral_date, "%Y-%m-%d").date()
        except Exception:
            referral_date = datetime.date.today()
    insurance = detect_insurance(text)
    dme = detect_dme(text)
    symptoms = detect_symptoms(text)
    cpt = choose_cpt(text)
    conf_bucket = confidence_bucket(avg_conf)
    contract_end = insurance.get("contract_end")
    contract_valid = None
    if isinstance(contract_end, datetime.date):
        contract_valid = contract_end >= referral_date
    contract_end_out = contract_end.isoformat() if isinstance(contract_end, datetime.date) else None
    return {
        "insurance": {
            **{k: v for k, v in insurance.items() if k != "contract_end"},
            "contract_end": contract_end_out,
        },
        "dme": dme,
        "symptoms": symptoms,
        "cpt_code": cpt,
        "confidence_bucket": conf_bucket,
        "contract_valid": contract_valid,
    }


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("input_file", help="Path to text file to analyze")
    ap.add_argument("--referral_date", default=None)
    ap.add_argument("--avg_conf", default=None)
    args = ap.parse_args()
    try:
        txt = Path(args.input_file).read_text(encoding='utf-8')
    except Exception:
        txt = ''
    avg_conf = None
    if args.avg_conf is not None:
        try:
            avg_conf = float(args.avg_conf)
        except Exception:
            avg_conf = None
    result = analyze(txt, avg_conf=avg_conf, referral_date=args.referral_date)
    print(json.dumps(result))


if __name__ == '__main__':
    main()
