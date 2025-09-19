#!/usr/bin/env python3
import argparse
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Optional, List
import os
import json as _json

# --- If you have enhanced_extract, keep using it; else fall back to lightweight parsing ---
try:
    from enhanced_extract import analyze_medical_form as _enhanced_extract
except Exception:
    _enhanced_extract = None
try:
    from quality_control import run_qc
except Exception:
    run_qc = None
try:
    from batch_cover_generator import render_cover_sheet
except Exception:
    render_cover_sheet = None


# ----------------------
# Helpers
# ----------------------
def read_text(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""


def normalize(text: str) -> str:
    if not text:
        return ""
    t = text.replace("\r", "\n")
    t = re.sub(r"[ \t]+\n", "\n", t)
    t = re.sub(r"[ \t]{2,}", " ", t)
    t = t.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    t = re.sub(r"\bIbs\b", "lbs", t, flags=re.I)
    t = re.sub(r"\bPuimonary\b", "Pulmonary", t, flags=re.I)
    t = re.sub(r"\bSpeciallst\b", "Specialist", t, flags=re.I)
    t = re.sub(r"\bDeseription\b", "Description", t, flags=re.I)
    t = re.sub(r"\bOlstructive\b", "Obstructive", t, flags=re.I)
    t = re.sub(r"circumferance", "circumference", t, flags=re.I)
    # Fix glued date like 00402/002024 -> 04/02/2024 (backend also normalizes; keep defensive)
    t = re.sub(
        r"(Referral\/?\s*order\s*date:\s*)0?(\d{2})(\d{2})\/0{1,2}(\d{4})",
        lambda m: f"{m.group(1)}{m.group(2)}/{m.group(3)}/{m.group(4)}",
        t,
        flags=re.I,
    )
    # General fix for dates with a 5-digit year like mm/dd/0yyyy -> mm/dd/yyyy (covers DOB etc.)
    t = re.sub(r"\b([01]?\d\/[0-3]?\d\/)0(\d{4}\b)", r"\1\2", t)
    # Join digits split by newline
    t = re.sub(r"(\d)[ \t]*\n[ \t]*(\d)", r"\1\2", t)
    return t.strip()


# ----------------------
# Lightweight extractor (fallback if enhanced_extract not available)
# ----------------------
RX = {
    "dob": re.compile(r"\b(?:DOB|Date of Birth)[:\s]*([01]?\d\/[0-3]?\d\/\d{4})\b", re.I),
    "bp": re.compile(r"\b(?:Blood Pressure|BP)[:\s]*([0-2]?\d{2}\/[0-2]?\d{2})\b", re.I),
    "mrn": re.compile(r"\bMRN[:\s]*([A-Z0-9\-]{3,})\b", re.I),
    "phone_any": re.compile(r"\b(?:Phone|Phone \(Home\)|Clinic phone)[:\s]*([()\-\s\.\d]{10,20})", re.I),
    "fax": re.compile(r"\bFax[:\s]*([()\-\s\.\d]{10,20})", re.I),
    "provider_block": re.compile(r"Provider:\s*([^\n]+?)\s+Specialty:\s*([^\n]+?)(?:\s+NPI:|\n|$)", re.I),
    "npi": re.compile(r"\bNPI[:\s]*([0-9]{8,15})\b", re.I),
    "vitals_line": re.compile(
        r"Height[:\s]*([^B\n]+?)\s+(\d+\s?lbs)[^\n]*?BMI[:\s]*([\d.]+)[^\n]*?(?:Blood Pressure|BP)[:\s]*([0-2]?\d{2}\/[0-2]?\d{2})",
        re.I,
    ),
    "cpt_all": re.compile(r"\b(9\d{4})\b"),
    "epworth": re.compile(r"\bEpworth(?:\s*score(?:s)?)?[:\s]*([0-2]?\d)(?:\s*\/\s*24)?\b", re.I),
    # Expand block length to capture carrier + member id lines reliably
    "insurance_primary": re.compile(r"Insurance\s*\(Primary\)[\s\S]{0,500}", re.I),
    "carrier": re.compile(r"Carrier[:\s]*([^\n:]+)", re.I),
    # stop at end-of-line; do not span newlines
    # Member ID up to boundary; avoid capturing following words like Coverage/Authorization/etc.
    "member_id": re.compile(r"Member\s*ID[:\s]*([A-Z0-9\- ]{2,})(?=\s*(?:\r?\n|$|Coverage|Authorization|Auth|Carrier|Group|Plan|Policy))", re.I),
    "auth": re.compile(r"Authorization(?:\s*number)?[:\s]*([A-Z0-9\-]+)", re.I),
    "study_requested": re.compile(r"(?:Study|Requested)\s*[:\s]*([A-Za-z ]+Study|Sleep study|Overnight Sleep Study)", re.I),
    "patient_name": re.compile(r"Patient[:\s]*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)(?=\s*(?:[-–]\s*DOB|DOB|$))", re.I),
    "indication": re.compile(r"(?:Indication|Primary\s*Diagnosis)[:\s]*([^\n]+)", re.I),
    "neck": re.compile(r"Neck(?:\s*circumference)?[:\s]*([0-9]{1,2}(?:\s*in(?:ches)?)?)", re.I),
    "referring_provider": re.compile(r"Referring\s+Provider\s*:\s*([^\n]+)", re.I),
    "doc_date": re.compile(r"(?:Referral\s*\/?\s*order\s*date|Referral\s*Date|Document\s*Date)[:\s]*([01]?\d\/[0-3]?\d\/\d{4})", re.I),
    "intake_date": re.compile(r"(?:Intake\s*\/?\s*processing|Intake\s*Date)[:\s]*([01]?\d\/[0-3]?\d\/\d{4})", re.I),
    "verified": re.compile(r"\bVerified\b|\bConfirmed\b", re.I),
}

def _fmt_phone(raw: str) -> str:
    d = re.sub(r"\D", "", raw or "")
    if not d:
        return ""
    def ok(ten: str) -> bool:
        return bool(re.match(r"^[2-9][0-8]\d[2-9]\d{2}\d{4}$", ten))
    def fmt(ten: str) -> str:
        return re.sub(r"(\d{3})(\d{3})(\d{4})", r"(\1) \2-\3", ten)
    if len(d) >= 10 and ok(d[:10]): return fmt(d[:10])
    if len(d) == 11 and d[0] == "1" and ok(d[1:]): return fmt(d[1:])
    for i in range(0, max(0, len(d) - 9)):
        w = d[i:i+10]
        if ok(w): return fmt(w)
    return fmt(d[-10:]) if len(d) >= 10 else ""


def _fallback_extract(text: str, avg_conf: Optional[float]) -> dict:
    t = normalize(text)
    out = {"patient": {}, "insurance": {"primary": {}}, "physician": {}, "procedure": {}, "clinical": {}}

    def _clean_text(value: str) -> str:
        if value is None:
            return ""
        s = str(value)
        s = s.replace('\r', ' ')
        s = s.replace('\n', ' ')
        s = s.replace('\f', ' ')
        s = s.replace('\t', ' ')
        s = s.replace('\\N', ' ')
        s = re.sub(r"\\[nNrRt]", " ", s)
        s = re.sub(r"\s+", " ", s)
        return s.strip()

    def _trim_subscriber(value: str) -> str:
        s = _clean_text(value)
        s = re.split(r"\b(?:Subscriber|Member|Address|Phone)\b", s, 1)[0]
        return s.strip(' ,;:')

    def _trim_physician_block(value: str) -> str:
        s = _clean_text(value)
        s = re.split(r"\bProvider\s+(?:Facility|Speciality|NPI|UPIN|1D Number)\b", s, 1)[0]
        s = re.split(r"\bAddress\b", s, 1)[0]
        return s.strip(' ,;:')

    def _normalize_patient_names(first: str, last: str) -> tuple[str, str]:
        first = _clean_text(first)
        last = _clean_text(last)
        if last.lower().endswith(' patient'):
            last = last[:-7].strip()
        if first.lower().endswith(' patient') and not last:
            first = first[:-7].strip()
        return first, last

    def _split_name(raw: str):
        if not raw:
            return "", ""
        cleaned = _clean_text(raw)
        if "," in cleaned:
            last, first = [p.strip() for p in cleaned.split(",", 1)]
        else:
            parts = cleaned.split()
            if len(parts) == 1:
                return cleaned.title(), ""
            first, last = parts[0], " ".join(parts[1:])
        return first.title(), last.title()

    def _section(start_pattern: str, end_patterns: List[str]) -> str:
        start = re.search(start_pattern, t, flags=re.I)
        if not start:
            return ""
        start_idx = start.start()
        end_idx = len(t)
        for pat in end_patterns:
            mloc = re.search(pat, t[start_idx:], flags=re.I)
            if mloc:
                candidate = start_idx + mloc.start()
                if candidate > start_idx:
                    end_idx = min(end_idx, candidate)
        return t[start_idx:end_idx]

    patient_section = _section(r"Patient Information", [r"Insurance Information", r"Secondary Insurance", r"Referral From Information"])
    insurance_section = _section(r"Insurance Information", [r"Secondary Insurance", r"Referral From Information"])
    secondary_ins_section = _section(r"Secondary Insurance", [r"Referral From Information"])
    referring_section = _section(r"Referral From Information", [r"Referral To Information"])

    search_space = patient_section or t

    m = RX["dob"].search(search_space)
    if m: out["patient"]["dob"] = m.group(1)
    m = RX["mrn"].search(search_space)
    if m: out["patient"]["mrn"] = m.group(1)
    m = re.search(r"Patient Name[:\s]*([^\n]+?)(?=\s*(?:Patient\s+)?(?:DOB|Date of Birth)[:\s]|\bDOB\b|$)", search_space, flags=re.I)
    if m:
        first, last = _split_name(m.group(1))
        if first:
            out["patient"]["first_name"] = first
        if last:
            out["patient"]["last_name"] = last
    else:
        m = re.search(r"\bPATIENT\s*[:\-]\s*([^\n]+)", search_space, flags=re.I)
        if m:
            first, last = _split_name(m.group(1))
            if first:
                out["patient"]["first_name"] = first
            if last:
                out["patient"]["last_name"] = last

    if out["patient"].get("first_name") or out["patient"].get("last_name"):
        first, last = _normalize_patient_names(
            out["patient"].get("first_name", ""),
            out["patient"].get("last_name", "")
        )
        out["patient"]["first_name"] = first
        out["patient"]["last_name"] = last
        out["patient"]["name"] = _clean_text(f"{first} {last}")
    m = RX["vitals_line"].search(search_space)
    if m:
        out["patient"]["height"] = m.group(1).strip()
        out["patient"]["weight"] = m.group(2).strip()
        out["patient"]["bmi"] = m.group(3).strip()
        out["patient"]["blood_pressure"] = m.group(4).strip()
    else:
        m = RX["bp"].search(t)
        if m: out["patient"]["blood_pressure"] = m.group(1)

    m = re.search(r"Patient Phone[:\s]*([()\-\s\.\d]{10,20})", search_space, flags=re.I)
    if m:
        out["patient"]["phone_home"] = _fmt_phone(m.group(1))
    else:
        m = RX["phone_any"].search(search_space)
        if m:
            out["patient"]["phone_home"] = _fmt_phone(m.group(1))
    m = RX["fax"].search(referring_section or t)
    if m:
        out["physician"]["fax"] = _fmt_phone(m.group(1))

    m = RX["provider_block"].search(referring_section or t)
    if m:
        out["physician"]["name"] = _trim_physician_block(m.group(1))
        out["physician"]["specialty"] = _clean_text(m.group(2))
    m = RX["npi"].search(referring_section or t)
    if m: out["physician"]["npi"] = m.group(1)
    m = re.search(r"Phone[:\s]*([()\-\s\.\d]{10,20})", referring_section or t, flags=re.I)
    if m: out["physician"]["clinic_phone"] = _fmt_phone(m.group(1))
    if referring_section and not out["physician"].get("name"):
        m = re.search(r"Provider Name[:\s]*([^\n]+)", referring_section, flags=re.I)
        if m:
            out["physician"]["name"] = _trim_physician_block(m.group(1))
    if referring_section and not out["physician"].get("practice"):
        m = re.search(r"Provider Facility[:\s]*([^\n]+)", referring_section, flags=re.I)
        if m:
            out["physician"]["practice"] = _trim_physician_block(m.group(1))
    if out["physician"].get("practice"):
        out["physician"]["practice"] = _trim_physician_block(out["physician"]["practice"])

    blk = RX["insurance_primary"].search(insurance_section or t)
    ib = blk.group(0) if blk else (insurance_section or "")
    # Primary carrier
    m = RX["carrier"].search(ib)
    if m:
        carrier = re.sub(r"Member\s*Id$", "", m.group(1), flags=re.I).strip()
        carrier = re.split(r"\bSubscriber\b", carrier, 1)[0].strip(" ,")
        out["insurance"]["primary"]["carrier"] = _trim_subscriber(carrier)
    else:
        # Fallback 1: line right after header like: \nProminence: Prominence
        m2 = re.search(r"Insurance\s*\(Primary\)[^\n]*\n\s*([A-Za-z][A-Za-z0-9 &\-]{2,})(?::\s*([A-Za-z][A-Za-z0-9 &\-]{2,}))?", t, flags=re.I)
        if m2:
            name = (m2.group(2) or m2.group(1)).strip()
            # If name has duplicate like "Prominence Prominence" collapse
            parts = [p.strip() for p in re.split(r"[:\s]+", name) if p.strip()]
            if len(parts) >= 2 and parts[0].lower() == parts[1].lower():
                name = parts[0]
            out["insurance"]["primary"]["carrier"] = _trim_subscriber(name)
        else:
            # Fallback 2: any uppercase-first token before Member ID within block
            m3 = re.search(r"\b([A-Z][A-Za-z0-9 &\-]{2,})\b(?=[\s\S]{0,120}Member\s*ID)" , ib, flags=re.I)
            if m3:
                out["insurance"]["primary"]["carrier"] = _trim_subscriber(m3.group(1))
            elif not out["insurance"]["primary"].get("carrier"):
                inline_carrier = re.search(r"Primary\s+Insurance\s*[:\-]\s*([^\n]+)", insurance_section or t, flags=re.I)
                if inline_carrier:
                    carrier = inline_carrier.group(1).strip()
                    carrier = re.split(r"\bSubscriber\b", carrier, 1)[0].strip(" ,")
                    out["insurance"]["primary"]["carrier"] = _trim_subscriber(carrier)
    if not out["insurance"]["primary"].get("carrier"):
        carrier_source = insurance_section or patient_section or t
        m = re.search(r"Insurance Name[:\s]*([^\n]+)", carrier_source, flags=re.I)
        if m:
            carrier = re.split(r"\bSubscriber\b", m.group(1).strip(), 1)[0].strip(" ,")
            out["insurance"]["primary"]["carrier"] = _trim_subscriber(carrier)
        else:
            m = re.search(r"Patient Insurance[:\s]*([^\n]+)", carrier_source, flags=re.I)
            if m:
                carrier = re.split(r"\bSubscriber\b", m.group(1).strip(), 1)[0].strip(" ,")
                out["insurance"]["primary"]["carrier"] = _trim_subscriber(carrier)
    # Member ID
    m = RX["member_id"].search(ib)
    if m: out["insurance"]["primary"]["member_id"] = re.sub(r"\s+", "", m.group(1))
    elif not out["insurance"]["primary"].get("member_id"):
        member_source = insurance_section or patient_section or t
        m = re.search(r"(?:Subscriber|Patient) (?:No|Number)[:\s]*([A-Z0-9]{4,})", member_source, flags=re.I)
        if m:
            out["insurance"]["primary"]["member_id"] = re.sub(r"\s+", "", m.group(1))
    m = RX["auth"].search(ib)
    if m: out["insurance"]["primary"]["authorization_number"] = m.group(1)

    if RX["verified"].search(t):
        out["insurance"]["primary"]["insurance_verified"] = "Yes"

    if secondary_ins_section:
        sec = out["insurance"].setdefault("secondary", {})
        m = re.search(r"Insurance Name[:\s]*([^\n]+)", secondary_ins_section, flags=re.I)
        if m:
            sec.setdefault("carrier", _trim_subscriber(m.group(1)))
        m = re.search(r"Subscriber No[:\s]*([A-Z0-9]{4,})", secondary_ins_section, flags=re.I)
        if m:
            sec.setdefault("member_id", re.sub(r"\s+", "", m.group(1)))

    m = RX["doc_date"].search(t)
    if m: out["document_date"] = m.group(1)
    m = RX["intake_date"].search(t)
    if m: out["intake_date"] = m.group(1)

    cpts = RX["cpt_all"].findall(t)
    if cpts: out["procedure"]["cpt"] = list(dict.fromkeys(cpts))
    else:
        inline_cpt = re.search(r"\b(?:CPT|Procedure(?:\s*Codes?)?)\b[:\s]*([^\n]+)", t, flags=re.I)
        if inline_cpt:
            tokens = re.findall(r"\b(?:[A-Z]\d{4}|9\d{4})\b", inline_cpt.group(1))
            if tokens:
                out["procedure"]["cpt"] = tokens
    m = RX["study_requested"].search(t)
    if m: out["procedure"]["study_requested"] = m.group(1)
    m = RX["indication"].search(t)
    if m:
        dx = re.sub(r"\bOlstructive\b", "Obstructive", m.group(1), flags=re.I).strip()
        out["procedure"]["indication"] = dx
        out["clinical"]["primary_diagnosis"] = dx

    # Provider fallback: Referring Provider line
    if not out["physician"].get("name"):
        m = RX["referring_provider"].search(t)
        if m:
            out["physician"]["name"] = m.group(1).strip()

    m = RX["epworth"].search(t)
    if m: out["clinical"]["epworth_score"] = f"{m.group(1)}/24"
    m = RX["neck"].search(t)
    if m:
        neck = m.group(1)
        out["clinical"]["neck_circumference"] = neck if "in" in neck else f"{neck} in"

    m = re.search(r"Symptoms?[:\s]*([^\n]+)", t, flags=re.I)
    if m:
        raw = m.group(1)
        arr = [s.strip() for s in re.split(r"[;,]", raw) if s.strip()]
        # Drop negated tokens ("Denies X", "No Y"), fix common OCR slip, dedupe preserving order
        cleaned = []
        seen = set()
        for s in arr:
            if re.match(r"^(denies|no)\b", s, flags=re.I):
                continue
            s2 = re.sub(r"\bnoring\b", "snoring", s, flags=re.I)
            key = s2.lower()
            if key not in seen:
                seen.add(key)
                cleaned.append(s2)
        if cleaned:
            out["clinical"]["symptoms"] = cleaned

    if isinstance(avg_conf, (int, float)):
        out["overall_confidence"] = float(avg_conf)
        out.setdefault("confidence_scores", {})["overall_confidence"] = float(avg_conf)

    return out


def _merge_prefer_server(server: dict, client: dict):
    def is_empty(v):
        return v is None or (isinstance(v, str) and v.strip() == "")
    if isinstance(server, list) or isinstance(client, list):
        sa = server if isinstance(server, list) else []
        ca = client if isinstance(client, list) else []
        return sa if sa else ca
    if isinstance(server, dict) or isinstance(client, dict):
        out = {}
        keys = set()
        if isinstance(server, dict): keys.update(server.keys())
        if isinstance(client, dict): keys.update(client.keys())
        for k in keys:
            sv = server.get(k) if isinstance(server, dict) else None
            cv = client.get(k) if isinstance(client, dict) else None
            if isinstance(sv, dict) and isinstance(cv, dict):
                out[k] = _merge_prefer_server(sv, cv)
            elif isinstance(sv, list) or isinstance(cv, list):
                sa = sv if isinstance(sv, list) else []
                ca = cv if isinstance(cv, list) else []
                out[k] = sa if sa else ca
            else:
                out[k] = sv if not is_empty(sv) else cv
        return out
    return server if not is_empty(server) else client


# ----------------------
# User rules (regex) loader + applier
# ----------------------
_USER_RULES_PATH = os.path.join(os.path.dirname(__file__), 'rules', 'user_rules.json')

def _load_user_rules():
    try:
        with open(_USER_RULES_PATH, 'r', encoding='utf-8') as f:
            data = _json.load(f)
        rules = data.get('rules', []) if isinstance(data, dict) else []
        out = []
        for r in rules:
            # skip disabled rules
            if r.get('disabled'):
                continue
            field = r.get('field')
            pattern = r.get('pattern')
            if not field or not pattern:
                continue
            try:
                flags = re.I if str(r.get('flags', '')).lower().find('i') >= 0 else 0
                rx = re.compile(pattern, flags)
            except Exception:
                continue
            out.append({
                'id': r.get('id'),
                'field': field,
                'rx': rx,
                'section': r.get('section'),
                'window': int(r.get('window', 500)),
                'postprocess': r.get('postprocess') or [],
                'priority': int(r.get('priority', 100))
            })
        # sort by priority asc
        out.sort(key=lambda x: x['priority'])
        return out
    except Exception:
        return []

def _pp_value(val: str, pps: List[str]) -> str:
    v = val or ''
    for name in pps or []:
        n = (name or '').lower()
        if n == 'trim':
            v = v.strip()
        elif n == 'upper':
            v = v.upper()
        elif n == 'collapse_spaces':
            v = re.sub(r"\s+", " ", v).strip()
        elif n == 'digits_only':
            v = re.sub(r"\D+", "", v)
        elif n == 'strip_spaces':
            v = re.sub(r"\s+", "", v)
        elif n == 'nanp_phone':
            try:
                v = _fmt_phone(v)
            except Exception:
                pass
        elif n == 'collapse_duplicate_tokens':
            toks = [t for t in re.split(r"[\s:]+", v) if t]
            out = []
            for t in toks:
                if not out or out[-1].lower() != t.lower():
                    out.append(t)
            v = ' '.join(out)
    return v

def _is_empty_value(x):
    return x is None or (isinstance(x, str) and x.strip() == '')

def _assign_field(obj: dict, path: str, value):
    parts = path.split('.')
    cur = obj
    for i, p in enumerate(parts):
        if i == len(parts) - 1:
            cur[p] = value
        else:
            if p not in cur or not isinstance(cur[p], dict):
                cur[p] = {}
            cur = cur[p]

def _apply_user_rules(text: str, data: dict):
    rules = _load_user_rules()
    if not rules:
        return
    t = text or ''
    for r in rules:
        # Skip if already present (only fill missing)
        # Traverse to existing value if any
        try:
            cur = data
            for idx, key in enumerate(r['field'].split('.')):
                if idx == len(r['field'].split('.')) - 1:
                    existing = cur.get(key) if isinstance(cur, dict) else None
                else:
                    cur = cur.get(key, {}) if isinstance(cur, dict) else {}
            if not _is_empty_value(existing):
                continue
        except Exception:
            pass

        subject = t
        if r.get('section'):
            try:
                m = re.search(r.get('section'), t, flags=re.I)
                if m:
                    start = m.start()
                    end = min(len(t), start + max(100, r.get('window', 500)))
                    subject = t[start:end]
            except Exception:
                subject = t
        m = r['rx'].search(subject)
        if m:
            val = m.group(1)
            val = _pp_value(val, r.get('postprocess'))
            if not _is_empty_value(val):
                _assign_field(data, r['field'], val)

def extract(text: str, avg_conf: Optional[float]) -> dict:
    # Always compute fallback on normalized text
    fb = _fallback_extract(text, avg_conf)
    if _enhanced_extract:
        try:
            data = _enhanced_extract(text, avg_conf if avg_conf is not None else 0.85)
            overall = (
                data.get("overall_confidence")
                or data.get("semantic_confidence")
                or data.get("confidence_scores", {}).get("overall_confidence")
                or (avg_conf if isinstance(avg_conf, (int, float)) else 0.85)
            )
            data.setdefault("overall_confidence", overall)
            data.setdefault("confidence_scores", {}).setdefault("overall_confidence", overall)
            # Merge: prefer server, fill from fallback
            merged = _merge_prefer_server(data, fb or {})
            _apply_user_rules(text, merged)
            return merged
        except Exception:
            pass
    _apply_user_rules(text, fb)
    return fb


# ----------------------
# Client-format PDF HTML (unified block)
# ----------------------
def _val(x, fb="Not found"):
    return x if (x is not None and x != "") else fb


def make_client_pdf_html(data: dict, flags: Optional[List[str]] = None) -> str:
    p = data.get("patient", {})
    ins = data.get("insurance", {}).get("primary", {})
    phy = data.get("physician", {})
    proc = data.get("procedure", {})
    clin = data.get("clinical", {})

    last = p.get("last_name", "")
    first = p.get("first_name", "")
    dob = p.get("dob", "Not found")
    ref_date = data.get("document_date", "Not found")

    # CPT: accept list or string
    cpt_raw = proc.get("cpt")
    if isinstance(cpt_raw, list):
        cpt_text = ", ".join([str(x) for x in cpt_raw if str(x).strip()]) or "Not found"
    else:
        cpt_text = str(cpt_raw).strip() if cpt_raw else "Not found"

    # Description: prefer flat description_text, then fall back to description; accept list or string
    desc_raw = proc.get("description_text") or proc.get("description")
    if isinstance(desc_raw, list):
        desc_text = ", ".join([str(x) for x in desc_raw if str(x).strip()]) or "Not found"
    else:
        desc_text = str(desc_raw).strip() if desc_raw else "Not found"
    symptoms = ", ".join(clin.get("symptoms", []) or []) or "Not found"
    # Diagnosis: prefer explicit primary; then procedure indication; then first ICD token
    diag = clin.get("primary_diagnosis") or proc.get("indication")
    if not diag:
        icds = clin.get("icd10_codes") or []
        if isinstance(icds, list) and icds:
            first = icds[0]
            if isinstance(first, dict):
                code = first.get("code")
                label = first.get("label")
                diag = f"{code} — {label}" if code and label else (code or "")
            elif isinstance(first, str):
                diag = first
    if not diag:
        diag = "Not found"
    # Show BMI if present on patient or clinical; otherwise show height/weight if available
    bmi_bp = (
        p.get("bmi")
        or clin.get("bmi")
        or (f"{p.get('height','—')} // {p.get('weight','—')}" if p.get("height") or p.get("weight") else "Not found")
    )
    # Prefer patient BP; fall back to clinical aliases
    bp = p.get("blood_pressure") or clin.get("blood_pressure") or clin.get("bp") or "Not found"

    flags_list = [] if flags is None else [f for f in flags if f]
    flags_html = "None" if len(flags_list) == 0 else ", ".join(flags_list)

    # Build Authorization Notes
    auth_notes = []
    if proc.get('authorization_required') or ins.get('authorization_number'):
        if ins.get('authorization_number'):
            auth_notes.append(f"Authorization #: {ins.get('authorization_number')}")
        else:
            auth_notes.append("Authorization required")
    carrier_lower = (ins.get('carrier') or '').lower()
    if 'prominence' in carrier_lower:
        auth_notes.append('Out of network — Prominence cutoff')
    if '95811' in (proc.get('cpt') or []) and not proc.get('titration_auto_criteria'):
        auth_notes.append('Clinical review for 95811 (prior positive study or CPAP issues)')

    html = f"""
<div class="document-template">
  <div class="document-header">
    <div class="header-info"><strong>PATIENT:</strong> {f"{last}, {first}" if last and first else 'Not found'} | <strong>DOB:</strong> {dob} | <strong>REFERRAL DATE:</strong> {ref_date}</div>
  </div>
  <section>
    <h3>DEMOGRAPHICS:</h3>
    <ul>
      <li>Phone: {_val(p.get('phone_home'))}</li>
      <li>Email: {_val(p.get('email'))}</li>
      <li>Emergency Contact: {_val(p.get('emergency_contact'))}</li>
    </ul>
  </section>
  <section>
    <h3>INSURANCE:</h3>
    <ul>
      <li>Primary: {_val(ins.get('carrier'))} | ID: {_val(ins.get('member_id'))} | Group: {_val(ins.get('group'))}</li>
      <li>Secondary: {_val(data.get('insurance',{}).get('secondary',{}).get('carrier'))} | ID: {_val(data.get('insurance',{}).get('secondary',{}).get('member_id'))} | Group: {_val(data.get('insurance',{}).get('secondary',{}).get('group'))}</li>
    </ul>
  </section>
  <section>
    <h3>PROCEDURE ORDERED:</h3>
    <ul>
      <li>CPT Code: {cpt_text}</li>
      <li>Description: {desc_text}</li>
      <li>Provider Notes: {_val(proc.get('notes'))}</li>
    </ul>
  </section>
  <section>
    <h3>REFERRING PHYSICIAN:</h3>
    <ul>
      <li>Name: {_val(phy.get('name'))}</li>
      <li>NPI: {_val(phy.get('npi'))}</li>
      <li>Practice: {_val(phy.get('practice'))}</li>
      <li>Phone/Fax: {_val(phy.get('clinic_phone'))} / {_val(phy.get('fax'))}</li>
      <li>Supervising Physician if Listed: {_val(phy.get('supervising'))}</li>
    </ul>
  </section>
  <section>
    <h3>CLINICAL INFORMATION:</h3>
    <ul>
      <li>Primary Diagnosis: {diag}</li>
      <li>Symptoms Present: {symptoms}</li>
      <li>BMI: {bmi_bp} | BP: {bp}</li>
    </ul>
  </section>
  <section>
    <h3>INFORMATION ALERTS:</h3>
    <ul>
      <li>PPE Requirements: {_val(data.get('alerts',{}).get('ppe_required'))}</li>
      <li>Safety Precautions: {_val(data.get('alerts',{}).get('safety_precautions'))}</li>
      <li>Communication Needs: {_val(data.get('alerts',{}).get('communication_needs'))}</li>
      <li>Special Accommodations: {_val(data.get('alerts',{}).get('accommodations'))}</li>
    </ul>
  </section>
  <section>
    <h3>PROBLEM FLAGS:</h3>
    <div>{flags_html}</div>
  </section>
  <section>
    <h3>AUTHORIZATION NOTES:</h3>
    <div>{_val(' — '.join(auth_notes))}</div>
  </section>
  <section>
    <h3>CONFIDENCE LEVEL:</h3>
    <div>{'High' if float(data.get('overall_confidence', 0.85)) >= 0.8 else 'Medium'}</div>
  </section>
</div>
"""
    return html


# ----------------------
# Filename suggestion
# ----------------------
def _safe(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]", "_", s or "")


def suggest_filename(data: dict) -> str:
    p = data.get("patient", {})
    ins = data.get("insurance", {}).get("primary", {})
    last = p.get("last_name", "Unknown")
    first = p.get("first_name", "Unknown")
    dob = (p.get("dob") or "NA").replace("/", "-")
    ref_date = (data.get("document_date") or datetime.today().strftime("%Y-%m-%d")).replace("/", "-")
    carrier = ins.get("carrier") or "UnknownIns"
    # Prefix with insurance for easy grouping
    return f"{_safe(carrier)}_{_safe(last)}_{_safe(first)}_{dob}_{ref_date}.pdf"


# ----------------------
# Single & Batch modes
# ----------------------
def _compute_status_from_flags(flags: list) -> str:
    flags = flags or []
    high_review = {
        'WRONG_TEST_ORDERED', 'TITRATION_REQUIRES_CLINICAL_REVIEW', 'INSURANCE_NOT_ACCEPTED',
        'PROMINENCE_CONTRACT_ENDED', 'NOT_REFERRAL_DOCUMENT', 'DME_MENTIONED', 'PEDIATRIC_SPECIAL_HANDLING'
    }
    action_flags = {
        'MISSING_PATIENT_INFO', 'INSURANCE_EXPIRED', 'AUTHORIZATION_REQUIRED', 'MISSING_CHART_NOTES',
        'NO_TEST_ORDER_FOUND', 'LOW_OCR_CONFIDENCE', 'CONTRADICTORY_INFO'
    }
    if any(f in flags for f in high_review):
        return 'additional_review_required'
    if any(f in flags for f in action_flags):
        return 'additional_actions_required'
    return 'ready_to_schedule'


def run_single(text_file: Path, confidence: Optional[float]) -> dict:
    text = read_text(text_file)
    data = extract(text, confidence)
    # Collect flags if extractor produced any; default empty
    flags = data.get("flags", []) if isinstance(data, dict) else []
    pdf_html = make_client_pdf_html(data, flags=flags)
    qc = run_qc(data) if run_qc else {"errors": [], "warnings": []}
    suggested = suggest_filename(data)
    status = _compute_status_from_flags(flags)
    if (qc.get('errors')) and status == 'ready_to_schedule':
        status = 'additional_actions_required'
    # Compatibility aliases so the frontend can read either key
    enhanced = data  # prefer this name in Node/Next responses
    return {
        "success": True,
        "extracted_data": data,
        # Aliases for various frontends
        "enhanced_data": enhanced,
        "normalized": enhanced,
        # Canonical names preferred going forward
        "structured": enhanced,
        "record": enhanced,
        "ready_to_schedule": (status == 'ready_to_schedule'),
        # Client features summary
        "client_features": {
            "individual_pdf_ready": True,
            "quality_checked": True,
            "flags_applied": len(flags) if isinstance(flags, list) else 0,
            "actions_required": 0 if status == 'ready_to_schedule' else 1,
        },
        # Keep naming consistent with batch results and older frontend checks
        "filename": suggested,
        "suggested_filename": suggested,
        # Unified key used by frontend to render the PDF block
        "individual_pdf_ready": True,
        "individual_pdf_content": pdf_html,
        # Back-compat alias (some UIs looked for `pdf_content`)
        "pdf_content": pdf_html,
        # Bubble flags/actions to top-level for UI badges
        "flags": flags,
        "actions": data.get("actions", []),
        # QC + status
        "qc_results": qc,
        "status": status,
    }


def run_batch(files: List[Path], intake_date: Optional[str]) -> dict:
    individuals = []
    filename_suggestions = []
    ready = 0

    for fp in files:
        text = read_text(Path(fp))
        data = extract(text, None)
        flags = data.get("flags", []) if isinstance(data, dict) else []
        pdf_html = make_client_pdf_html(data, flags=flags)
        suggested = suggest_filename(data)
        filename_suggestions.append(suggested)
        qc = run_qc(data) if run_qc else {"errors": [], "warnings": []}
        status = _compute_status_from_flags(flags)
        if (qc.get('errors')) and status == 'ready_to_schedule':
            status = 'additional_actions_required'
        individuals.append({
            "source_file": Path(fp).name,
            "success": True,
            "status": status,
            "filename": suggested,
            "confidence_score": float(data.get("overall_confidence", 0.85)),
            "flags": flags,
            "actions": data.get("actions", []),
            "qc_issues": len((qc.get('errors') or [])) + len((qc.get('warnings') or [])),
            "qc_results": qc,
            "individual_pdf_ready": True,
            "individual_pdf_content": pdf_html,
            "extracted_data": data,
            # Aliases for various frontends
            "enhanced_data": data,
            "normalized": data,
            "structured": data,
            "record": data,
            "ready_to_schedule": (status == 'ready_to_schedule'),
        })
        if status == 'ready_to_schedule':
            ready += 1

    cover_html = None
    if render_cover_sheet:
        try:
            cover_html = render_cover_sheet(individuals, intake_date).get('html')
        except Exception:
            cover_html = None

    return {
        "success": True,
        "batch_summary": {
            "total_documents": len(files),
            "ready_to_schedule": ready,
            "additional_actions_required": max(0, len(files) - ready),
            "statistics": {"avg_confidence": sum([ind.get("confidence_score", 0.0) for ind in individuals]) / max(1, len(individuals))},
        },
        "individual_results": individuals,
        "cover_sheet_content": cover_html,
        "filename_suggestions": filename_suggestions,
        "client_features": {
            "batch_cover_sheet_ready": True,
            "individual_pdfs_ready": len(individuals),
            "quality_control_applied": True,
            "file_naming_standardized": True,
        },
    }


# ----------------------
# CLI
# ----------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["single", "batch"], required=True)
    ap.add_argument("--text-file")
    ap.add_argument("--files", nargs="*")
    ap.add_argument("--files-manifest")
    ap.add_argument("--confidence", type=float)
    ap.add_argument("--intake-date")
    args = ap.parse_args()

    if args.mode == "single":
        if not args.text_file:
            print(json.dumps({"success": False, "error": "text-file required"}))
            return
        out = run_single(Path(args.text_file), args.confidence)
        print(json.dumps(out))
        return

    if args.mode == "batch":
        # Support large batches via manifest file to avoid OS arg limits
        file_list: list[str] = []
        if args.files_manifest:
            try:
                with open(args.files_manifest, 'r', encoding='utf-8') as mf:
                    for line in mf:
                        p = line.strip()
                        if p:
                            file_list.append(p)
            except Exception as e:
                print(json.dumps({"success": False, "error": f"failed to read files-manifest: {e}"}))
                return
        if args.files:
            file_list.extend(args.files)
        if not file_list:
            print(json.dumps({"success": False, "error": "files required"}))
            return
        out = run_batch([Path(f) for f in file_list], args.intake_date)
        print(json.dumps(out))
        return


if __name__ == "__main__":
    main()
