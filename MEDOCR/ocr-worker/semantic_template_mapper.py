"""
Advanced Template Matching and Inference System
Uses semantic analysis and contextual pattern matching for better extraction.
"""

import re
import json
import os
from typing import Dict, List, Any, Optional, Tuple
from difflib import SequenceMatcher
from collections import defaultdict
from typing import TYPE_CHECKING

import importlib, importlib.util

# --- Optional rule helpers (kept minimal and safe) ---
try:
    from config.rules import cpt_selector as _cpt_rules  # backed by cpt_selector.json, cpt_keywords.json, negations.json, insurance.json
except Exception:
    _cpt_rules = None

# --- Fallback line-by-line mappers (robust, non-destructive) ---
_WS = r"[ \t]*"
_SEP = r"[:#\-–\|]"
_LINE = r"[^\n\r]*"

DOB_RE       = re.compile(rf"(?i)\bD\s*O\s*B\b{_WS}{_SEP}?{_WS}([0-9]{{1,2}}[\/-][0-9]{{1,2}}[\/-][0-9]{{2,4}})")
CARRIER_RE   = re.compile(rf"(?i)\b(?:Insurance|Carrier|Payer)\b{_WS}{_SEP}?{_WS}({_LINE})")
MEMBER_RE    = re.compile(rf"(?i)\b(?:Member|Subscriber)\s*(?:ID|#)?{_WS}{_SEP}?{_WS}([A-Za-z0-9\-]{{4,24}})")
GROUP_RE     = re.compile(rf"(?i)\b(?:Group|Grp)\s*(?:ID|#)?{_WS}{_SEP}?{_WS}([A-Za-z0-9\-]{{2,24}})")
MDNAME_RE    = re.compile(rf"(?i)\bReferr(?:ing)?\s*Physician\b{_WS}{_SEP}?{_WS}({_LINE})")
MDNAME2_RE   = re.compile(rf"(?i)\bProvider\b{_WS}{_SEP}?{_WS}({_LINE})")
NPI_RE       = re.compile(rf"(?i)\bNPI\b{_WS}{_SEP}?{_WS}([0-9]{{10}})")

CPT_LINE_RE  = re.compile(rf"(?i)^({_LINE}?(?:CPT|Procedure){_LINE})$")
CPT_TOKEN_RE = re.compile(r"[0-9OolISBG]{4,5}")

# --- Extended fallback patterns ---
DOB_ALT_RE    = re.compile(rf"(?i)\b(?:date\s*of\s*birth|d\.\s*o\.\s*b\.|d\.o\.b\.){_WS}{_SEP}?{_WS}([0-9]{{1,2}}[\/-][0-9]{{1,2}}[\/-][0-9]{{2,4}})")
DOB_ISO_RE    = re.compile(r"(?i)\b(\d{4}[\/-](?:0?[1-9]|1[0-2])[\/-](?:0?[1-9]|[12][0-9]|3[01]))\b")
NPI_FUZZY_RE  = re.compile(rf"(?i)\bNP[Il1]\b{_WS}{_SEP}?{_WS}([0-9\-\s]{{10,20}})")
CPT_KNOWN_RE  = re.compile(r"\b(95806|95810|95811|95782|95783|G0399)\b", re.IGNORECASE)

ICD_TOKEN_RE  = re.compile(r"\b([A-TV-Z][0-9][0-9A-Z](?:\.[0-9A-Z]{1,4})?)\b")

# Multiline label → value (value appears on next line)
CARRIER_NL_RE = re.compile(rf"(?is)\b(?:Insurance|Carrier|Payer|Plan)(?:\s*Name)?\b{_WS}{_SEP}?{_WS}\n{_WS}({_LINE})")
MEMBER_NL_RE  = re.compile(rf"(?is)\b(?:Member|Subscriber)\s*(?:ID|#)?\b{_WS}{_SEP}?{_WS}\n{_WS}([A-Za-z0-9\-]{4,24})")
GROUP_NL_RE   = re.compile(rf"(?is)\b(?:Group|Grp)\s*(?:ID|#)?\b{_WS}{_SEP}?{_WS}\n{_WS}([A-Za-z0-9\-]{2,24})")

# NPI multiline / fuzzy next-line
NPI_NL_RE     = re.compile(rf"(?is)\bNP[Il1]\b{_WS}{_SEP}?{_WS}\n{_WS}([0-9\-\s]{10,20})")

# Collapsing spaced digits (e.g., 9 5 8 1 0 in tables)
# Collapsing spaced digits (e.g., 9 5 8 1 0 in tables)
# Broader ID token: allow slash and longer lengths (common in payer IDs)
ID_TOKEN_RE = re.compile(r"([A-Za-z0-9][A-Za-z0-9\-/\s]{3,40}[A-Za-z0-9])")

# CPT header line (then codes appear in following lines/cells)
CPT_HEADER_RE = re.compile(r"(?im)^\s*(?:CPT|CPT\s*Codes?|Procedure\s*Codes?|Procedure)\b.*$")

DIGIT5_RE = re.compile(r"(?<!\d)(\d{5})(?!\d)")

# Phone patterns to avoid mis-classifying as IDs


PHONE_RE = re.compile(r"\b(?:\(\d{3}\)\s*\d{3}[-\s]?\d{4}|\d{3}[-\s]?\d{3}[-\s]?\d{4})\b")
# Date-like fragments and common glued label tokens (used to deglue bad "group" captures)
DATE_LIKE_RE = re.compile(r"\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2})\b")
# DOB word detector for glued forms and label guards
DOB_WORD_RE = re.compile(r"(?i)\b(?:dob|date\s*of\s*birth|dateofbirth)\b")
LABEL_GLUE_RE = re.compile(r"(?i)(subscriber|member|policy|group|grp)\s*(?:no|number|id|id#)?")

_BAD_ID_LABELS = {
    "name","dob","date","d.o.b","id","member","subscriber","policy","group","grp",
    "phone","fax","provider","npi",
    # explicit "No"/"Number" label forms that often bleed in OCR
    "no","number","subscriberno","memberno","policyno","groupno","idno"
}
def _looks_like_label_token(token: str) -> bool:
    t = (token or "").strip().lower().strip(":#-–—")
    t = re.sub(r"\s+", "", t)
    # treat tokens like 'SubscriberNo', 'GroupNo', 'PolicyNo' (with no digits) as labels
    if (t.endswith("no") or t.endswith("number")) and not re.search(r"\d", t):
        if any(prefix in t for prefix in ("subscriber","member","policy","group","grp","id")):
            return True
    # treat any token containing 'name' (incl. 'subscribername') as a label
    if "name" in t:
        return True
    return t in _BAD_ID_LABELS or t.startswith("name")

_BAD_ID_VALUES = {
    "address", "subscriber address", "patient address", "no", "none",
    # common phone label bleed-throughs
    "phone", "cell", "cell phone", "patient phone", "patientphone", "cellphone",
    "subscriber phone", "phone number", "patient cell", "patient cell phone",
    # ssn / social-security bleed-throughs
    "ssn", "patient ssn", "subscriber ssn", "social", "social security",
    # name label bleed-throughs frequently mis-captured as IDs/groups
    "subscriber name", "subscribername", "patient name", "patientname",
    "member name", "membername", "policy name", "policyname",
    # Expanded explicit No/Number label forms
    "subscriber no", "subscriberno", "member no", "memberno",
    "policy no", "policyno", "group no", "groupno",
    "id no", "idno", "number", "no"
}

def _is_bad_id_value(token: str) -> bool:
    t = (token or "").strip().lower()
    if not t:
        return True
    if t in _BAD_ID_VALUES:
        return True
    if DOB_WORD_RE.search(t):
        return True
    # aggressively skip any token that looks like a label bleed
    if ("phone" in t) or ("ssn" in t) or ("social security" in t) or ("name" in t):
        return True
    # Reject pure label tokens like 'SubscriberNo' / 'Group No' without digits
    tt = re.sub(r"\s+", "", t)
    if (tt.endswith("no") or tt.endswith("number")) and not re.search(r"\d", tt):
        if any(prefix in tt for prefix in ("subscriber","member","policy","group","grp","id")):
            return True
    return False

# Reject tokens that look like a person's name (e.g., last names) to avoid mis-filling IDs/Groups
def _is_personal_name_like(token: str, patient: Optional[dict] = None) -> bool:
    if not token:
        return False
    t = token.strip()
    low_t = t.lower()

    # Build patient name tokens
    ptoks = set()
    try:
        if isinstance(patient, dict):
            for key in ("first_name", "last_name", "name"):
                val = (patient.get(key) or "")
                for p in re.split(r"[\s,]+", str(val)):
                    p = p.strip()
                    if p:
                        ptoks.add(p.lower())
    except Exception:
        pass

    # If the token contains the patient name as a substring (handles glued forms like 'MiguelDOB')
    if any(p and p in low_t for p in ptoks):
        return True

    # Quick reject: if it has digits, treat as not name-like (IDs), unless it also embeds DOB words with name
    if re.search(r"\d", t):
        if ptoks and any(p and p in low_t for p in ptoks) and DOB_WORD_RE.search(low_t):
            return True
        return False

    # Exact match to patient tokens
    if low_t in ptoks:
        return True
    # Titlecase single-word like 'Abecendario'
    if re.match(r"^[A-Z][a-z]{2,}$", t):
        return True
    # Two-word proper-looking name (Titlecase Titlecase)
    if re.match(r"^[A-Z][a-z]{1,}\s+[A-Z][a-z]{1,}$", t):
        return True
    return False

def _strip_leading_name_label(value: Any) -> str:
    txt = (value or "") if isinstance(value, str) else str(value or "")
    return re.sub(r'^(?:\s*Name:\s*)+', '', txt, flags=re.IGNORECASE).strip()

# Flexible ICD-in-text (allows spaces/typos) for CPT clinical fallback
ICD_OSA_FLEX_RE = re.compile(r"(?i)\bG\s*4\s*7\s*[\.-]?\s*3\s*3\b|\bG\s*4\s*7\s*[\.-]?\s*3\s*0\b|\bG\s*4\s*7\s*[\.-]?\s*3\s*9\b")

# Generic sleep study intent (when codes/labels are missing)
SLEEP_STUDY_INTENT_RE = re.compile(r"(?i)\b(sleep\s+study|sleep\s+evaluation|complete\s+sleep\s+study|overnight\s+(?:testing|study))\b")

SPACED5_RE    = re.compile(r"(?<!\d)(?:\d\s+){4}\d(?!\d)")

def _collapse_spaced_digits(s: str) -> str:
    return re.sub(r"\s+", "", s)

# Generic/alternate insurance ID & group patterns (line or next-line)
SUBSCR_ID_ANY_RE   = re.compile(rf"(?is)\b(?:Member|Subscriber|Subscr\.?|Policy)\s*(?:ID|No\.?|#|Number)?\b{_WS}{_SEP}?{_WS}(?:\n{_WS})?([A-Za-z0-9\-]{{4,24}})")
GROUP_ANY_RE       = re.compile(rf"(?is)\b(?:Group|Grp|Group\s*No\.?|Grp\s*No\.?)\s*(?:ID|No\.?|#|Number)?\b{_WS}{_SEP}?{_WS}(?:\n{_WS})?([A-Za-z0-9\-]{{2,24}})")

# Broad inline label patterns (label and value on same line with arbitrary junk between)
INLINE_MEMBER_RE = re.compile(r"(?is)\b(?:Member|Subscriber|Policy)\s*(?:ID|No\.?|#|Number)?\b.{0,40}?([A-Za-z0-9][A-Za-z0-9\-\/]{3,40})")
INLINE_GROUP_RE  = re.compile(r"(?is)\b(?:Group|Grp|Group\s*No\.?|Grp\s*No\.?)\b.{0,40}?([A-Za-z0-9][A-Za-z0-9\-\/]{1,24})")

 # Window search around Insurance header for downstream Member/Group
INSURANCE_HEADER_RE = re.compile(r"(?im)^(?:\s*(?:Primary\s*)?(?:Insurance|Carrier|Payer|Plan)\b.*)$")

# Label-only lines where value appears 1-3 lines below
LABEL_MEMBER_LINE = re.compile(r"(?im)^\s*(?:Member|Subscriber|Policy)\s*(?:ID|No\.?|#|Number)?\s*(?::|#|\-|–)?\s*$")
LABEL_GROUP_LINE  = re.compile(r"(?im)^\s*(?:Group|Grp|Group\s*No\.?|Grp\s*No\.?)\s*(?:ID|No\.?|#|Number)?\s*(?::|#|\-|–)?\s*$")

# Two-line labels like "Member" (line 1) and "ID:" (line 2)
LABEL_MEMBER_WORD = re.compile(r"(?im)^\s*(?:Member|Subscriber|Policy)\s*$")
LABEL_ID_WORD     = re.compile(r"(?im)^\s*(?:ID|ID#|ID\s*No\.?|Number|No\.?|#)\s*:?$")
LABEL_GROUP_WORD  = re.compile(r"(?im)^\s*(?:Group|Grp|Group\s*No\.?|Grp\s*No\.?)\s*$")

# Accept Unicode dashes in split-night detection
UNICODE_DASH = "\u2013\u2014"  # en dash, em dash

# Compact tokens like 'AB 12 - 345 678' -> 'AB12-345678'
def _compact_id_token(s: str) -> str:
    s = s.strip()
    # preserve hyphens, drop spaces around them; compress internal spaces
    s = re.sub(r"\s+\-\s+", "-", s)
    s = re.sub(r"\s+", "", s)
    return s

def _deglue_token(s: str) -> str:
    """
    Remove leading date-like prefixes and glued label fragments such as
    '09/29/1959SubscriberNo' or 'SubscriberNo' to prevent polluting IDs/groups.
    """
    if not s:
        return ""
    t = str(s)
    # Strip leading date-like prefix if present
    t = re.sub(r"^\s*(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2})", "", t)
    # Remove common glued labels anywhere inside token
    t = LABEL_GLUE_RE.sub("", t)
    return t.strip(" :#-–—")

_UNICODE_LITERAL_RE = re.compile(r"\\[uU]([0-9a-fA-F]{1,8})")
_NAME_STRIP_RE = re.compile(r"[^A-Za-z0-9'.,\- ]+")

def _decode_unicode_literals(value: Any) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        value = str(value)

    def _norm(match: re.Match) -> str:
        hex_part = match.group(1)
        if not hex_part:
            return ""
        if len(hex_part) > 4:
            hex_part = hex_part[-4:]
        hex_part = hex_part.zfill(4)
        return "\\u" + hex_part.lower()

    normalized = _UNICODE_LITERAL_RE.sub(_norm, value)
    try:
        decoded = normalized.encode("utf-8").decode("unicode_escape")
    except UnicodeDecodeError:
        decoded = normalized
    return decoded

def _sanitize_name_component(value: Any) -> str:
    txt = _decode_unicode_literals(value)
    if not txt:
        return ""
    txt = txt.replace("\u00a7", " ")  # explicit section sign guard
    txt = txt.replace("§", " ")
    txt = re.sub(r"[|•·¤©™®]", " ", txt)
    txt = txt.replace("\\", " ")
    txt = _NAME_STRIP_RE.sub(" ", txt)
    txt = re.sub(r"\s+", " ", txt)
    cleaned = txt.strip(" ,;:-")
    # Drop a trailing 'Patient' token sometimes glued by OCR
    cleaned = re.sub(r"\bPatient\b$", "", cleaned, flags=re.IGNORECASE).strip()
    return cleaned

# Soft carrier list if insurance.json not available

_SOFT_CARRIERS = [
    'Anthem', 'Anthem BCBS', 'Blue Cross', 'Blue Cross Blue Shield', 'BCBS',
    'Aetna', 'Cigna', 'UnitedHealthcare', 'United Health', 'UHC', 'Humana',
    'Medicare', 'Medicaid', 'Kaiser', 'Kaiser Permanente', 'Prominence', 'Molina', 'HPN'
]

def _load_insurance_names_from_json() -> Dict[str, Any]:
    """
    Load carrier names and optional synonym map from JSON. Supports multiple locations:
    - /mnt/data/insurance.json  (runtime-uploaded file)
    - ./insurance.json, ../insurance.json, ../../insurance.json  (repo/local)
    Returns a dict with keys:
      - carriers: set[str] of canonical carrier names
      - synonyms: dict[str, str] mapping lowercased synonym -> canonical name
    """
    carriers: set = set()
    synonyms: Dict[str, str] = {}
    paths = [
        "/mnt/data/insurance.json",
        "insurance.json",
        "../insurance.json",
        "../../insurance.json",
    ]
    for pth in paths:
        try:
            with open(pth, "r") as fh:
                data = json.load(fh)
        except FileNotFoundError:
            continue
        except Exception:
            # If file exists but is malformed, skip silently
            continue
        # Accept common list buckets
        for bucket in ("accepted", "specialty", "doNotAccept", "selfPay", "carriers"):
            vals = data.get(bucket) or []
            for v in vals:
                if isinstance(v, str) and v.strip():
                    carriers.add(v.strip())
        # Optional synonyms map { "aarp optum": "UnitedHealthcare", ... }
        syn_map = data.get("synonyms")
        if isinstance(syn_map, dict):
            for k, v in syn_map.items():
                if isinstance(k, str) and isinstance(v, str) and k.strip() and v.strip():
                    synonyms[k.strip().lower()] = v.strip()
    return {"carriers": carriers, "synonyms": synonyms}

_INS_DATA = _load_insurance_names_from_json()

# Built-in fallbacks for synonym canonicalization
_CARRIER_SYNONYMS_FALLBACK = {
    "uhc": "UnitedHealthcare",
    "united health": "UnitedHealthcare",
    "unitedhealthcare": "UnitedHealthcare",
    "united healthcare": "UnitedHealthcare",
    "aarp": "UnitedHealthcare",
    "optum": "UnitedHealthcare",
    "aarp optum medicare complete": "UnitedHealthcare",
    "medicare complete": "UnitedHealthcare",
    "anthem bcbs": "Anthem",
    "blue cross": "Blue Cross Blue Shield",
    "blue cross blue shield": "Blue Cross Blue Shield",
    "bcbs": "Blue Cross Blue Shield",
    "kaiser": "Kaiser Permanente",
}

def _canonicalize_carrier(name: str) -> str:
    """
    Return a canonical carrier string using the uploaded JSON synonyms if present,
    otherwise fallback to a small internal synonym map. Returns the input trimmed
    if no mapping applies.
    """
    name = (name or "").strip()
    if not name:
        return ""
    low = name.lower()
    # JSON-provided synonyms take precedence
    syn_map = _INS_DATA.get("synonyms") or {}
    if low in syn_map:
        return syn_map[low]
    # Built-in fallback synonyms
    if low in _CARRIER_SYNONYMS_FALLBACK:
        return _CARRIER_SYNONYMS_FALLBACK[low]
    return name

def _clean_digits(s: str) -> str:
    return re.sub(r"\D", "", s or "")

def _guess_carrier_from_text(text: str) -> str:
    # Try to use uploaded/checked-in insurance.json if present
    possible = set()
    try:
        data = _INS_DATA
        carriers_from_json = data.get("carriers") or set()
        if carriers_from_json:
            possible.update(carriers_from_json)
    except Exception:
        pass
    if not possible:
        possible.update(_SOFT_CARRIERS)
    low = (text or "").lower()
    best = None
    best_len = 0
    for name in possible:
        if not name:
            continue
        nlow = str(name).lower()
        if nlow in low and len(nlow) > best_len:
            best = str(name)
            best_len = len(nlow)
    return _canonicalize_carrier(best or "")

def _clean_fallback(s: str) -> str:
    return (s or "").strip(" •:*–-").strip()

_REASON_LINE_RE = re.compile(r"(?im)^\s*Reason(?:\s*For\s*Referral)?\s*(?:[:\-]|=)\s*(.*)$")
_DIAG_LABEL_RE = re.compile(r"(?im)^\s*(?:Diagnosis|Dx)\s*(?:[:\-]|=)?\s*(.*)$")
_ICD_WITH_DESC_RE = re.compile(r"([A-TV-Z][0-9][0-9A-Z](?:\.[0-9A-Z]{1,4})?)\s*(?:[-–:/]\s*(.*?))?(?=\s{2,}|[,;]|$)")
_ICD_SINGLE_LINE_RE = re.compile(r"^\s*([A-TV-Z][0-9][0-9A-Z](?:\.[0-9A-Z]{1,4})?)\s*(?:[-–:/]\s*(.*))?$")

def _extract_reason_and_diagnoses(text: str) -> Tuple[str, List[Tuple[str, str]]]:
    lines = (text or "").splitlines()
    reason = ""
    diagnoses: List[Tuple[str, str]] = []
    n = len(lines)

    def _append_diag(code: str, desc: str) -> None:
        code = (code or "").upper().strip()
        desc = _clean_fallback(desc)
        if not code:
            return
        for existing_code, _ in diagnoses:
            if existing_code == code:
                return
        diagnoses.append((code, desc))

    idx = 0
    while idx < n:
        raw = lines[idx]
        stripped = raw.strip()
        if stripped:
            if not reason:
                m_reason = _REASON_LINE_RE.match(stripped)
                if m_reason:
                    candidate = _clean_fallback(m_reason.group(1))
                    if not candidate and idx + 1 < n:
                        look = idx + 1
                        while look < n:
                            nxt_line = lines[look].strip()
                            if not nxt_line:
                                look += 1
                                continue
                            # Skip obvious section labels like "Diagnosis:" or "Procedures:"
                            if re.match(r"^[A-Za-z0-9 /()#'&.,_-]{1,40}:$", nxt_line):
                                look += 1
                                continue
                            candidate = _clean_fallback(nxt_line)
                            break
                    if candidate:
                        reason = candidate

            m_diag = _DIAG_LABEL_RE.match(stripped)
            if m_diag:
                tail = m_diag.group(1).strip()
                if tail:
                    for match in _ICD_WITH_DESC_RE.finditer(tail):
                        _append_diag(match.group(1), match.group(2))
                look = idx + 1
                while look < n:
                    nxt = lines[look].strip()
                    if not nxt:
                        break
                    m_line = _ICD_SINGLE_LINE_RE.match(nxt)
                    if m_line:
                        _append_diag(m_line.group(1), m_line.group(2))
                        look += 1
                        continue
                    if ':' in nxt and not _ICD_SINGLE_LINE_RE.match(nxt):
                        break
                    if diagnoses:
                        last_code, last_desc = diagnoses[-1]
                        updated_desc = (last_desc + " " + nxt).strip() if last_desc else nxt
                        diagnoses[-1] = (last_code, _clean_fallback(updated_desc))
                        look += 1
                        continue
                    break
                idx = look - 1
            else:
                m_plain = _ICD_SINGLE_LINE_RE.match(stripped)
                if m_plain:
                    _append_diag(m_plain.group(1), m_plain.group(2))
        idx += 1

    return reason, diagnoses

def _normalize_cpt_token(tok: str) -> str:
    table = str.maketrans({"O":"0","o":"0","I":"1","l":"1","i":"1","S":"5","s":"5","B":"8","G":"6"})
    return tok.translate(table)

def apply_fallback_mappings(ocr_text: str, patient: dict, insurance: dict, physician: dict, procedure: dict) -> None:
    lines = (ocr_text or "").splitlines()

    if isinstance(patient, dict):
        for field in ("name", "first_name", "last_name"):
            value = patient.get(field)
            if value:
                cleaned_val = _sanitize_name_component(value)
                if cleaned_val:
                    patient[field] = cleaned_val
                else:
                    patient.pop(field, None)
        if patient.get("first_name") and patient.get("last_name"):
            combined = f"{patient['first_name']} {patient['last_name']}".strip()
            if combined:
                patient.setdefault("name", combined)

    def _apply_patient_name(raw: str) -> bool:
        cleaned = _sanitize_name_component(raw)
        if not cleaned:
            return False
        # Exclude insurance carrier-like names
        if any(tok in cleaned.lower() for tok in ('insurance', 'carrier', 'payer', 'optum', 'uhc', 'plan')):
            return False  # skip names that look like insurance carriers

        patient.setdefault("name", cleaned)
        if not patient.get("first_name") or not patient.get("last_name"):
            first = patient.get("first_name")
            last = patient.get("last_name")
            if not first or not last:
                if "," in cleaned:
                    last_part, first_part = [p.strip() for p in cleaned.split(",", 1)]
                    first_tokens = first_part.split()
                    if not first and first_tokens:
                        first = first_tokens[0]
                    if not last and last_part:
                        last = last_part
                else:
                    parts = cleaned.split()
                    if not first and parts:
                        first = parts[0]
                    if not last and len(parts) > 1:
                        last = parts[-1]
            if first:
                patient.setdefault("first_name", first)
            if last:
                patient.setdefault("last_name", last)
        return True

    # DOB
    if not patient.get("dob"):
        for ln in lines:
            m = DOB_RE.search(ln)
            if m:
                patient["dob"] = _clean_fallback(m.group(1))
                break
    if not patient.get("dob"):
        for ln in lines:
            m = DOB_ALT_RE.search(ln)
            if m:
                patient["dob"] = _clean_fallback(m.group(1))
                break
    if not patient.get("dob"):
        m2 = DOB_ISO_RE.search(ocr_text or "")
        if m2:
            patient["dob"] = _clean_fallback(m2.group(1))

    # Reset suspicious patient names that look like carriers/insurance terms
    current_name = (patient.get("name") or "").lower()
    if current_name and any(token in current_name for token in ("insurance", "optum", "uhc", "plan")):
        patient.pop("name", None)
        patient.pop("first_name", None)
        patient.pop("last_name", None)

    # Patient name
    if not patient.get("name"):
        for ln in lines:
            if "patient name" in ln.lower():
                parts = ln.split(":", 1)
                if len(parts) == 2 and _apply_patient_name(parts[1]):
                    break
    if not patient.get("name"):
        for ln in lines:
            if "patient:" in ln.lower() and "dob" in ln.lower():
                before = ln.split("DOB", 1)[0]
                parts = before.split(":", 1)
                if len(parts) == 2 and _apply_patient_name(parts[1]):
                    break
    if not patient.get("name"):
        for ln in lines:
            if "DOB" in ln and "," in ln:
                seg = ln.split("DOB", 1)[0]
                if _apply_patient_name(seg):
                    break

    # Insurance
    insurance.setdefault("primary", {})
    pri = insurance["primary"]
    if not pri.get("carrier"):
        for ln in lines:
            m = CARRIER_RE.search(ln)
            if m:
                pri["carrier"] = _canonicalize_carrier(_clean_fallback(m.group(1)))
                break
    if not pri.get("carrier"):
        guess = _guess_carrier_from_text(ocr_text or "")
        if guess:
            pri["carrier"] = _canonicalize_carrier(guess)
    # Carrier on next line
    if not pri.get("carrier"):
        m = CARRIER_NL_RE.search(ocr_text or "")
        if m:
            pri["carrier"] = _canonicalize_carrier(_clean_fallback(m.group(1)))

    # Capture plan/insurance plan text explicitly (e.g., "AARP-Optum MEDICARE COMPLETE")
    if not pri.get("plan"):
        # Look for explicit Insurance Name or Patient Insurance lines
        m_plan = re.search(r"(?im)^\s*(?:Patient\s*Insurance|Insurance\s*Name)\s*[:\-]?\s*(.+)$", ocr_text or "")
        if m_plan:
            pri["plan"] = _clean_fallback(m_plan.group(1))

    # --- Normalize carrier/program from plan text (Medicare Advantage heuristics) ---
    plan_txt = (pri.get("plan") or "")
    carrier_txt = (pri.get("carrier") or "")
    low_plan = plan_txt.lower()

    def _maybe_set_carrier(_pri: dict, desired: str) -> None:
        cur = (_pri.get("carrier") or "").strip().lower()
        # only override if missing or clearly generic
        if not cur or cur in {"medicare", "medicare advantage", "medicare complete", "insurance"}:
            _pri["carrier"] = _canonicalize_carrier(desired)

    def _maybe_set_program(_pri: dict, program: str) -> None:
        if not _pri.get("program"):
            _pri["program"] = program

    if low_plan:
        # UnitedHealthcare (AARP / Optum Medicare Complete / UHC Medicare Advantage)
        if ("medicare complete" in low_plan and ("aarp" in low_plan or "optum" in low_plan)) \
           or ("aarp" in low_plan and "medicare" in low_plan) \
           or ("united" in low_plan and "medicare" in low_plan) \
           or ("uhc" in low_plan and "medicare" in low_plan):
            _maybe_set_carrier(pri, "UnitedHealthcare")
            _maybe_set_program(pri, "Medicare Advantage")

        # Humana Medicare Advantage
        elif "humana" in low_plan and "medicare" in low_plan:
            _maybe_set_carrier(pri, "Humana")
            _maybe_set_program(pri, "Medicare Advantage")

        # Aetna Medicare Advantage
        elif "aetna" in low_plan and "medicare" in low_plan:
            _maybe_set_carrier(pri, "Aetna")
            _maybe_set_program(pri, "Medicare Advantage")

        # Cigna Medicare Advantage
        elif "cigna" in low_plan and "medicare" in low_plan:
            _maybe_set_carrier(pri, "Cigna")
            _maybe_set_program(pri, "Medicare Advantage")

        # Anthem / Blue Cross / Blue Shield Medicare Advantage (default to Anthem if mentioned, else BCBS)
        elif ("medicare" in low_plan) and ("anthem" in low_plan or "blue cross" in low_plan or "blue shield" in low_plan or "bcbs" in low_plan):
            if "anthem" in low_plan:
                _maybe_set_carrier(pri, "Anthem")
            else:
                _maybe_set_carrier(pri, "Blue Cross Blue Shield")
            _maybe_set_program(pri, "Medicare Advantage")

        # Kaiser Senior Advantage / Medicare Advantage
        elif ("kaiser" in low_plan or "senior advantage" in low_plan) and "medicare" in low_plan:
            _maybe_set_carrier(pri, "Kaiser Permanente")
            _maybe_set_program(pri, "Medicare Advantage")

        # Molina / Prominence / HPN MA variants
        elif "molina" in low_plan and "medicare" in low_plan:
            _maybe_set_carrier(pri, "Molina")
            _maybe_set_program(pri, "Medicare Advantage")
        elif "prominence" in low_plan and "medicare" in low_plan:
            _maybe_set_carrier(pri, "Prominence")
            _maybe_set_program(pri, "Medicare Advantage")
        elif ("health plan of nevada" in low_plan or "hpn" in low_plan) and "medicare" in low_plan:
            _maybe_set_carrier(pri, "HPN")
            _maybe_set_program(pri, "Medicare Advantage")

        # Generic catch: if the plan literally says Medicare Advantage but carrier is generic, keep carrier if it looks specific
        elif "medicare advantage" in low_plan:
            _maybe_set_program(pri, "Medicare Advantage")
            # don't force a specific carrier here; rely on existing pri["carrier"] if it looks non-generic

    def _accept_member_token(tok: str) -> bool:
        return bool(tok) and not PHONE_RE.search(tok) and not _looks_like_label_token(tok) and not _is_bad_id_value(tok) and not _is_personal_name_like(tok, patient)

    def _accept_group_token(tok: str) -> bool:
        """
        Strict acceptance for insurance 'group' to avoid filling with names/labels/member IDs:
          - must not be a phone/date/label/name-like
          - if all digits: allow realistic plan lengths (≤10)
          - if alphabetic only: allow short tokens (≤8) to avoid glued labels/names
          - if alphanumeric: disallow extreme length or member-like digit runs
        """
        if not tok:
            return False
        raw = _deglue_token(str(tok).strip())
        if not raw:
            return False
        # quick rejections
        if PHONE_RE.search(raw) or DATE_LIKE_RE.search(raw) or DOB_WORD_RE.search(raw):
            return False
        if _looks_like_label_token(raw) or _is_bad_id_value(raw):
            return False
        # reject if it still contains explicit label words
        if re.search(r"(?i)\b(subscriber|member|policy|group|grp)\b", raw):
            return False
        # reject obvious personal names using patient context
        if _is_personal_name_like(raw, patient):
            return False
        compact = _compact_id_token(raw)
        if not compact:
            return False
        digits_only = re.sub(r"\D", "", compact)
        has_letter = bool(re.search(r"[A-Za-z]", compact))
        has_digit = bool(digits_only)

        # pure numeric → accept if reasonably short (≤10)
        if not has_letter:
            return 0 < len(digits_only) <= 10

        # alphabetic-only → allow only if short (≤8) to avoid glued labels/names like 'MiguelDOB'
        if has_letter and not has_digit:
            return 2 <= len(compact) <= 8

        # alphanumeric guards
        if len(compact) > 24:
            return False
        if len(digits_only) >= 13:
            return False
        return True

    if not pri.get("member_id"):
        for ln in lines:
            m = MEMBER_RE.search(ln)
            if m:
                _tok = _clean_fallback(m.group(1))
                if _accept_member_token(_tok):
                    pri["member_id"] = _tok
                    break
    # Member ID on next line
    if not pri.get("member_id"):
        m = MEMBER_NL_RE.search(ocr_text or "")
        if m:
            _tok = _clean_fallback(m.group(1))
            if _accept_member_token(_tok):
                pri["member_id"] = _tok
    # Broader catch-all for Member/Subscriber/Policy IDs (same line or next line)
    if not pri.get("member_id"):
        m = SUBSCR_ID_ANY_RE.search(ocr_text or "")
        if m:
            _tok = _clean_fallback(m.group(1))
            if _accept_member_token(_tok):
                pri["member_id"] = _tok
    if not pri.get("group"):
        for ln in lines:
            m = GROUP_RE.search(ln)
            if m:
                _tok = _clean_fallback(_deglue_token(m.group(1)))
                if _accept_group_token(_tok):
                    pri["group"] = _tok
                    break
    # Group on next line
    if not pri.get("group"):
        m = GROUP_NL_RE.search(ocr_text or "")
        if m:
            _tok = _clean_fallback(_deglue_token(m.group(1)))
            if _accept_group_token(_tok):
                pri["group"] = _tok
    # Broader catch-all for Group IDs (same line or next line)
    if not pri.get("group"):
        m = GROUP_ANY_RE.search(ocr_text or "")
        if m:
            _tok = _clean_fallback(_deglue_token(m.group(1)))
            if _accept_group_token(_tok):
                pri["group"] = _tok

    # Inline label with noise between label and value (same-line sweep)
    if not pri.get("member_id"):
        m = INLINE_MEMBER_RE.search(ocr_text or "")
        if m:
            _tok = _clean_fallback(_compact_id_token(m.group(1)))
            if _accept_member_token(_tok):
                pri["member_id"] = _tok
    if not pri.get("group"):
        m = INLINE_GROUP_RE.search(ocr_text or "")
        if m:
            _tok = _clean_fallback(_deglue_token(m.group(1)))
            if _accept_group_token(_tok):
                pri["group"] = _tok

    # Windowed scan: if either member_id or group is still missing, look for Insurance/Carrier header and scan next 10 lines
    if (not pri.get("member_id") or not pri.get("group")) and (ocr_text):
        lines_enum = (ocr_text or "").splitlines()
        for idx, ln in enumerate(lines_enum):
            if INSURANCE_HEADER_RE.match(ln):
                window = "\n".join(lines_enum[idx+1: idx+11])
                if not pri.get("member_id"):
                    m1 = SUBSCR_ID_ANY_RE.search(window)
                    if m1:
                        _tok = _clean_fallback(m1.group(1))
                        if _accept_member_token(_tok):
                            pri["member_id"] = _tok
                if not pri.get("group"):
                    m2 = GROUP_ANY_RE.search(window)
                    if m2:
                        _tok = _clean_fallback(m2.group(1))
                        if _accept_group_token(_tok):
                            pri["group"] = _tok
                if pri.get("member_id") and pri.get("group"):
                    break

    # Final multi-line lookahead: label on its own line, value 1-3 lines below
    if (not pri.get("member_id") or not pri.get("group")) and (ocr_text):
        lines_enum = (ocr_text or "").splitlines()
        n = len(lines_enum)
        for idx, ln in enumerate(lines_enum):
            # Member ID
            if not pri.get("member_id") and LABEL_MEMBER_LINE.match(ln):
                for j in range(1, 4):
                    if idx + j >= n: break
                    cand = lines_enum[idx + j].strip()
                    if 'address' in cand.lower():
                        continue
                    m = ID_TOKEN_RE.search(cand)
                    if m:
                        token = _clean_fallback(_compact_id_token(m.group(1)))
                        if _accept_member_token(token):
                            pri["member_id"] = token
                            break
            # Group
            if not pri.get("group") and LABEL_GROUP_LINE.match(ln):
                for j in range(1, 4):
                    if idx + j >= n: break
                    cand = lines_enum[idx + j].strip()
                    if 'address' in cand.lower():
                        continue
                    m = ID_TOKEN_RE.search(cand)
                    if m:
                        token = _clean_fallback(_compact_id_token(m.group(1)))
                        if _accept_group_token(token):
                            pri["group"] = token
                            break

            # Member / ID on consecutive lines (label split across two lines)
            if not pri.get("member_id") and LABEL_MEMBER_WORD.match(ln):
                # Look ahead for an ID line, then the value line
                for j in range(1, 4):
                    if idx + j >= n: break
                    if LABEL_ID_WORD.match(lines_enum[idx + j]):
                        # value is 1-3 lines after the ID line
                        for k in range(j + 1, j + 4):
                            if idx + k >= n: break
                            cand = lines_enum[idx + k].strip()
                            if 'address' in cand.lower():
                                continue
                            m = ID_TOKEN_RE.search(cand)
                            if m:
                                token = _clean_fallback(_compact_id_token(m.group(1)))
                                if _accept_member_token(token):
                                    pri["member_id" if LABEL_MEMBER_WORD.match(ln) else "group"] = token
                                    break
                        break

            # Group / ID on consecutive lines (label split across two lines)
            if not pri.get("group") and LABEL_GROUP_WORD.match(ln):
                for j in range(1, 4):
                    if idx + j >= n: break
                    if LABEL_ID_WORD.match(lines_enum[idx + j]):
                        for k in range(j + 1, j + 4):
                            if idx + k >= n: break
                            cand = lines_enum[idx + k].strip()
                            if 'address' in cand.lower():
                                continue
                            m = ID_TOKEN_RE.search(cand)
                            if m:
                                token = _clean_fallback(_compact_id_token(m.group(1)))
                                if _accept_group_token(token):
                                    pri["member_id" if LABEL_MEMBER_WORD.match(ln) else "group"] = token
                                    break
                        break

            if pri.get("member_id") and pri.get("group"):
                break

    # Minimal unlabeled heuristic: if we see two ID-like tokens on adjacent lines under an insurance cluster, assign first=member, second=group
    if (not pri.get("member_id") or not pri.get("group")) and (ocr_text):
        lines_enum = (ocr_text or "").splitlines()
        n = len(lines_enum)
        for idx, ln in enumerate(lines_enum):
            if INSURANCE_HEADER_RE.match(ln) or re.search(r"(?i)insurance|carrier|payer|plan", ln):
                # look at the next few lines for two tokens
                pool = []
                for j in range(1, 7):
                    if idx + j >= n: break
                    cand = lines_enum[idx + j].strip()
                    if 'address' in cand.lower():
                        continue
                    t = ID_TOKEN_RE.search(cand)
                    if t:
                        token = _compact_id_token(t.group(1))
                        if token:
                            normtok = token.lower()
                            if _is_bad_id_value(token):
                                continue
                            if token not in pool and _accept_member_token(token):
                                pool.append(token)
                if pool:
                    if not pri.get("member_id"):
                        pri["member_id"] = pool[0]
                    if len(pool) > 1 and not pri.get("group"):
                        if _accept_group_token(pool[1]):
                            pri["group"] = pool[1]
                if pri.get("member_id") and pri.get("group"):
                    break

    # Last-resort: if still missing, look for strong hints then grab nearest ID-like token
    if (not pri.get("member_id") or not pri.get("group")) and (ocr_text):
        lines_enum = (ocr_text or "").splitlines()
        n = len(lines_enum)
        for idx, ln in enumerate(lines_enum):
            low = ln.lower()
            if any(k in low for k in ("member", "subscriber", "policy", "group", "grp")):
                window_lines = [ln]
                if idx + 1 < n: window_lines.append(lines_enum[idx+1])
                if idx + 2 < n: window_lines.append(lines_enum[idx+2])
                window = "\n".join(window_lines)
                window_low = window.lower()
                if not pri.get("member_id"):
                    m = ID_TOKEN_RE.search(window)
                    if m:
                        token = _clean_fallback(_compact_id_token(m.group(1)))
                        if 'address' in window_low or _is_bad_id_value(token):
                            continue
                        if _accept_member_token(token):
                            pri["member_id"] = token
                if not pri.get("group"):
                    # prefer a shortest token for group, with preference for tokens containing digits
                    m_all = list(ID_TOKEN_RE.finditer(window))
                    if m_all:
                        candidates = [
                            _clean_fallback(_compact_id_token(t.group(1))) for t in m_all
                        ]
                        # prefer candidates with digits; otherwise any that passes group acceptance
                        with_digits = [c for c in candidates if re.search(r"\d", c) and _accept_group_token(c)]
                        without_digits = [c for c in candidates if not re.search(r"\d", c) and _accept_group_token(c)]
                        pick = None
                        if with_digits:
                            pick = sorted(with_digits, key=len)[0]
                        elif without_digits:
                            pick = sorted(without_digits, key=len)[0]
                        if pick and 'address' not in window_low:
                            pri["group"] = pick
                if pri.get("member_id") and pri.get("group"):
                    break
    # ------- FINAL SANITY GATE for Insurance IDs -------
    # Ensure 'group' is not just a duplicate/label/name/member, and normalize
    if pri.get("group"):
        g = _compact_id_token(_deglue_token(str(pri.get("group") or "")))
        m = _compact_id_token(str(pri.get("member_id") or ""))
        if not g:
            pri.pop("group", None)
        else:
            digits_g = re.sub(r"\D", "", g)
            # disqualifiers: equals member, label-ish, phone, personal name, absurd length, date-like, explicit label words
            if (
                g == m
                or _is_bad_id_value(g)
                or PHONE_RE.search(g)
                or _is_personal_name_like(g, patient)
                or DATE_LIKE_RE.search(g)
                or DOB_WORD_RE.search(g)
                or (re.search(r"^[A-Za-z]+$", g) and len(g) > 8)
                or len(g) > 24
                or len(digits_g) >= 13  # overly long numeric sequence
                or (not re.search(r"[A-Za-z]", g) and len(digits_g) > 10)  # long pure numeric
                or re.search(r"(?i)\b(subscriber|member|policy|group|grp)\b", g)
            ):
                pri.pop("group", None)
            else:
                pri["group"] = g  # keep compacted, valid token

    # Medicare / Medicare Advantage often has no group number → set a benign placeholder to avoid "missing"
    if not pri.get("group"):
        carrier_txt = (pri.get("carrier") or "")
        # Also peek into the OCR text in case "Medicare Complete" appears outside the structured carrier field
        context_txt = f"{carrier_txt} {(ocr_text or '')}"
        if re.search(r"(?i)\bmedicare\b", context_txt) or re.search(r"(?i)\boptum\b.*\bmedicare\b", context_txt) or re.search(r"(?i)\bmedicare\s*complete\b", context_txt):
            pri["group"] = "N/A"

    # Physician
    if not physician.get("name"):
        for ln in lines:
            m = MDNAME_RE.search(ln) or MDNAME2_RE.search(ln)
            if m:
                physician["name"] = _strip_leading_name_label(_clean_fallback(m.group(1)))
                break
    if not physician.get("npi"):
        for ln in lines:
            m = NPI_RE.search(ln)
            if m:
                physician["npi"] = _clean_fallback(m.group(1))
                break
    if not physician.get("npi"):
        for ln in lines:
            m = NPI_FUZZY_RE.search(ln)
            if m:
                digits = _clean_digits(m.group(1))
                if len(digits) >= 10:
                    physician["npi"] = digits[-10:]
                    break

    # NPI appearing on the next line after label
    if not physician.get("npi"):
        m = NPI_NL_RE.search(ocr_text or "")
        if m:
            digits = _clean_digits(m.group(1))
            if len(digits) >= 10:
                physician["npi"] = digits[-10:]

    # Paragraph-based NPI fallback (unlabeled but in provider paragraph)
    if not physician.get("npi"):
        paragraphs = re.split(r"\n\s*\n", ocr_text or "")
        for p in paragraphs:
            if re.search(r"(?i)provider|physician|doctor|dr\.", p):
                digits = _clean_digits(p)
                if len(digits) >= 10:
                    physician["npi"] = digits[-10:]
                    break

    # CPT codes
    if not procedure.get("cpt"):
        candidates = []
        for ln in lines:
            if CPT_LINE_RE.match(ln) or ("cpt" in ln.lower()) or ("procedure" in ln.lower()):
                for tok in CPT_TOKEN_RE.findall(ln):
                    norm = _normalize_cpt_token(tok)
                    digits = re.sub(r"\D", "", norm)
                    if len(digits) in (4,5):
                        if len(digits) == 4:
                            digits = "0" + digits
                        candidates.append(digits)
        seen = set(); codes = []
        for c in candidates:
            if c not in seen:
                seen.add(c); codes.append(c)
        if codes:
            procedure["cpt"] = codes if len(codes) > 1 else codes[0]
    # CPT header line → scan next lines for 5-digit codes and spaced digits
    if not procedure.get("cpt") and (ocr_text):
        lines_enum = (ocr_text or "").splitlines()
        n = len(lines_enum)
        collected = []
        for idx, ln in enumerate(lines_enum):
            if CPT_HEADER_RE.match(ln) or ("cpt" in ln.lower() and ":" in ln.lower()):
                # scan next 8 lines for codes
                look = "\n".join(lines_enum[idx+1: idx+9])
                for m in DIGIT5_RE.finditer(look):
                    code = m.group(1)
                    if code not in collected:
                        collected.append(code)
                for m in SPACED5_RE.finditer(look):
                    packed = _collapse_spaced_digits(m.group(0))
                    if packed == "03999": packed = "G0399"
                    if packed in ("95806","95810","95811","95782","95783","G0398","G0399") and packed not in collected:
                        collected.append(packed)
                if collected:
                    procedure["cpt"] = collected if len(collected) > 1 else collected[0]
                    break
    # Spaced CPT digits anywhere (tables often space digits out)
    if not procedure.get("cpt"):
        spaced = []
        for m in SPACED5_RE.finditer(ocr_text or ""):
            packed = _collapse_spaced_digits(m.group(0))
            if packed in ("95806","95810","95811","95782","95783","03999"):
                spaced.append("G0399" if packed == "03999" else packed)
        if spaced:
            uniq = []
            for c in spaced:
                if c not in uniq:
                    uniq.append(c)
            procedure["cpt"] = uniq if len(uniq) > 1 else uniq[0]
    if not procedure.get("cpt"):
        found = []
        for m in CPT_KNOWN_RE.finditer(ocr_text or ""):
            code = m.group(1).upper()
            if code not in found:
                found.append(code)
        if found:
            procedure["cpt"] = found if len(found) > 1 else found[0]
    # Contextual inference: if not found, infer from context
    if not procedure.get("cpt"):
        tl = (ocr_text or "").lower()
        inferred = []
        # split-night and titration are strongest signals
        if re.search(r"\bsplit[\-\s" + UNICODE_DASH + "]*night\b", tl):
            inferred.append("95811")
        if re.search(r"\btitration\b|cpap\s*[/|]?\s*bi\s*p\s*ap|cpap\s*bi\s*pap|cpapbipap", tl):
            if "95811" not in inferred:
                inferred.append("95811")
        # in-lab PSG or explicit polysomnography/PSG
        if re.search(r"in[-\s]?lab.*?(polysom|psg)|\bpolysomnograph|\bpsg\b|\bpolysom\b", tl):
            if "95810" not in inferred:
                inferred.append("95810")
        # home study / HSAT variants
        if re.search(r"home\s+sleep\s+(apnea\s+)?(test|study)|\bhsat\b|h\s*s\s*a\s*t|home\s+sleep\s+apnea\s+test", tl):
            if "G0399" not in inferred and "95806" not in inferred:
                inferred.append("95806")
        # type codes common on HST forms
        if re.search(r"type\s*iii|type\s*3\b", tl) and "G0399" not in inferred:
            inferred.append("G0399")
        if re.search(r"type\s*ii|type\s*2\b", tl) and "G0398" not in inferred:
            inferred.append("G0398")
        # handle split CPT like '95 811' or '958 11' missed earlier
        if not inferred:
            glued = re.sub(r"\s+", " ", (ocr_text or ""))
            m = re.search(r"(?<!\d)(9\s*5\s*8\s*1\s*1)(?!\d)", glued)
            if m and "95811" not in inferred:
                inferred.append("95811")
        # choose single best based on priority
        priority = ["95811", "95810", "G0399", "95806", "G0398"]
        for p in priority:
            if p in inferred:
                procedure["cpt"] = p
                break

    # Clinical fallback: if ICD indicates OSA and no explicit study type is present, default to diagnostic in-lab PSG (95810)
    if not procedure.get("cpt"):
        text_blob = ocr_text or ""
        has_osa_icd = bool(ICD_OSA_FLEX_RE.search(text_blob))
        has_generic_sleep_intent = bool(SLEEP_STUDY_INTENT_RE.search(text_blob))
        hsat_cues = bool(re.search(r"home\s+sleep|hsat|type\s*ii|type\s*iii|type\s*2|type\s*3", text_blob, re.IGNORECASE))
        if (has_osa_icd or has_generic_sleep_intent) and not hsat_cues:
            procedure["cpt"] = "95810"


# spaCy optional import (satisfies type-checkers without requiring dependency)
if TYPE_CHECKING:
    import spacy as _spacy  # type: ignore[reportMissingImports]

spacy = None  # runtime name
SPACY_AVAILABLE = False
_spec = importlib.util.find_spec("spacy")
if _spec is not None:
    spacy = importlib.import_module("spacy")  # type: ignore[reportMissingImports]
    SPACY_AVAILABLE = True


class SemanticTemplateMapper:
    """
    Advanced template mapping using semantic analysis and contextual understanding
    """

    def __init__(self):
        # Try to load spaCy model, fallback to simple patterns if not available
        if SPACY_AVAILABLE:
            try:
                self.nlp = spacy.load("en_core_web_sm")
                self.use_spacy = True
            except OSError:
                print("spaCy model not found, using pattern-based approach")
                self.nlp = None
                self.use_spacy = False
        else:
            print("spaCy not available, using pattern-based approach")
            self.nlp = None
            self.use_spacy = False

        # Comprehensive medical form patterns with context
        self.field_patterns = {
            'patient_name': {
                'patterns': [
                    r"^([A-Z][a-zA-Z'\-]+\s+[A-Z][a-zA-Z'\-]+(?:\s+[A-Z][a-zA-Z'\-]+)?)\s+(?:DOB|D\.O\.B)",
                    r"(?:patient|name)\s*:(?!\s*(insurance|subscriber|policy))\s*([A-Z][a-zA-Z'\-]+\s+[A-Z][a-zA-Z'\-]+(?:\s+[A-Z][a-zA-Z'\-]+)?)\b",
                    r"PATIENT\s+INFORMATION.*?Name:?\s*([A-Z][a-zA-Z'\-]+\s+[A-Z][a-zA-Z'\-]+)",
                    r"PATIENT\s+NAME:?\s*([A-Z][a-zA-Z'\-]+\s+[A-Z][a-zA-Z'\-]+(?:\s+[A-Z][a-zA-Z'\-]+)?)",
                    r"Patient:\s*([A-Z][a-zA-Z'\-]+\s+[A-Z][a-zA-Z'\-]+)\s+DOB"
                ],
                'context_words': ['patient', 'name', 'individual'],
                'required': True
            },
            'date_of_birth': {
                'patterns': [
                    r'(?:dob|d\.o\.b|date.*?birth|birth.*?date):\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})',
                    r'born:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})',
                    r'DOB:\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})',
                    r'DOB\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})',
                    r'DOB\s*[:\-]?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})'
                ],
                'context_words': ['birth', 'born', 'dob'],
                'required': True
            },
            'insurance_carrier': {
                'patterns': [
                    r'insurance:\s*([A-Za-z\s]+?)(?:\s+member|\s+id|\s+policy|$)',
                    r'carrier:\s*([A-Za-z\s]+)',
                    r'(blue\s+cross\s+blue\s+shield|bcbs|aetna|cigna|united\s*health|medicare|medicaid|humana|kaiser)',
                    r'primary.*?insurance:?\s*([A-Za-z\s]+)'
                ],
                'context_words': ['insurance', 'carrier', 'policy', 'coverage'],
                'fuzzy_targets': ['Blue Cross Blue Shield', 'BCBS', 'Aetna', 'Cigna', 'UnitedHealthcare', 'Medicare', 'Medicaid'],
                'required': False
            },
            'member_id': {
                'patterns': [
                    r'(?:member|policy).*?id.*?([A-Z]{2,4}[-\s]?\d{6,12})',
                    r'\b(?:subscriber|policy)\s*id[:\s]*([A-Z0-9\-]{4,20})',
                    r'\b(?:member|subscriber)\s*#?[:\s]*([0-9]{6,20})',
                    r'\b(?:member|subscriber|policy)\s*id\s*#?[:\s]*([A-Za-z0-9\-]{4,24})'
                ],
                'context_words': ['member', 'policy', 'identification'],
                'required': False
            },
            'mrn': {
                'patterns': [
                    r'\b[MI]RN[:\-\s]*([A-Z0-9\-]{3,20})',  # tolerate OCR M/I confusion & hyphen
                    r'medical\s*record\s*number[:\s]*([A-Z0-9\-]{3,20})',
                    r'\bMRN-([A-Z0-9\-]{3,20})'
                ],
                'context_words': ['mrn', 'record'],
                'required': False
            },
            'height': {
                'patterns': [
                    r'height[:\s]*([5-7]\'?\d{1,2}\"?)',
                    r'height[:\s]*(\d+\s*(?:cm|in|inch|inches))'
                ],
                'context_words': ['height'],
                'required': False
            },
            'weight': {
                'patterns': [
                    r'weight[:\s]*(\d{2,3})\s*(?:lbs|pounds|kg)',
                    r'wt[:\s]*(\d{2,3})\s*(?:lbs|pounds|kg)'
                ],
                'context_words': ['weight', 'wt'],
                'required': False
            },
            'bmi': {
                'patterns': [
                    r'\bBMI[:\s]*([0-9]{1,2}\.?[0-9]?)'
                ],
                'context_words': ['bmi'],
                'required': False
            },
            'blood_pressure': {
                'patterns': [
                    r'(?:blood\s*pressure|bp)[:\s]*(\d{2,3})\s*[/\\]\s*(\d{2,3})'
                ],
                'context_words': ['blood pressure', 'bp'],
                'required': False
            },
            'study_requested': {
                'patterns': [
                    r'(in-?lab\s+polysomnography\s*\(\s*psg\s*\))',
                    r'(home\s+sleep\s+apnea\s+test\s*\(\s*h[5s]at\s*\))',   # HSAT/H5AT
                    r'\b(?:hsat|h5at)\b',
                    r'\b(mslt|multiple\s+sleep\s+latency\s+test)\b',
                    r"\b(mw['’]?t|maintenance\s+of\s+wakefulness\s+test)\b",
                    r'cpap\s*[/|]?\s*bi\s*p\s*ap',
                    r'cpap\s*bi\s*pap',
                    r'cpapbipap',
                    r'\bsleep\s+evaluation\b',
                    r'\bovernight\s+(?:testing|study)\b',
                    r'\bcomplete\s+sleep\s+study\b'
                ],
                'context_words': ['psg', 'hsat', 'mslt', 'mwt', 'study', 'requested'],
                'required': False
            },
            'cpt_codes': {
                'patterns': [
                    r'cpt:?\s*(\d{5})',
                    r'code:?\s*(\d{5})',
                    r'\b(95800|95801|95805|95806|95807|95808|95810|95811|95782|95783|G0398|G0399)\b',
                    r'diagnostic.*?(\d{5})',
                    r'titration.*?(\d{5})',
                    r'polysomnography.*?(\d{5})',
                    r'sleep.*?study.*?(\d{5})'
                ],
                'context_words': ['cpt', 'code', 'procedure', 'study', 'diagnostic'],
                # Keep required True if you want to push for explicit codes; set False if you want higher overall confidence without codes present.
                'required': False
            },
            'provider_name': {
                'patterns': [
                    r'provider:\s*(dr\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)(?=\s+Patient|\s+[A-Z][a-z]+\s+presents|\s*$)',
                    r'provider:\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),?\s*MD',
                    r'(dr\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),?\s*MD',
                    r'referring.*?(?:physician|doctor):?\s*(dr\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)',
                    r'ordered\s+by:?\s*(dr\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)',
                    r'Provider:\s*(Dr\.?\s+[A-Za-z]+(?:\s+[A-Za-z]+)*)',
                    r'Provider:\s*([A-Za-z]+(?:\s+[A-Za-z]+)*),?\s*MD',
                    r'Dr\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*'  # loose fallback
                ],
                'context_words': ['provider', 'doctor', 'physician', 'referring'],
                'required': True
            },
            'provider_specialty': {
                'patterns': [
                    r'Specialty[:\s]*([A-Za-z ]+)',
                    r'Provider\s*Specialty[:\s]*([A-Za-z ]+)',
                    r'Pulmonary|Sleep\s*Medicine|Pulmonology'
                ],
                'context_words': ['specialty', 'provider'],
                'required': False
            },
            'provider_npi': {
                'patterns': [
                    r'\bNPI[:\s]*([0-9]{8,15})\b'
                ],
                'context_words': ['npi', 'provider'],
                'required': False
            },
            'clinic_phone': {
                'patterns': [
                    r'Clinic\s*phone[:\s]*\((\d{3})\)\s*(\d{3})[-\s]?(\d{4})',
                    r'Clinic\s*Phone[:\s]*(\d{3})[-\s]?(\d{3})[-\s]?(\d{4})'
                ],
                'context_words': ['clinic', 'phone'],
                'required': False
            },
            'fax': {
                'patterns': [
                    r'Fax[:\s]*\((\d{3})\)\s*(\d{3})[-\s]?(\d{4})',
                    r'Fax[:\s]*(\d{3})[-\s]?(\d{3})[-\s]?(\d{4})'
                ],
                'context_words': ['fax'],
                'required': False
            },
            'authorization_number': {
                'patterns': [
                    r'Authorization(?:\s*(?:number|#))?[:\s]*([A-Z0-9][A-Z0-9\-]{4,}[0-9])'
                ],
                'context_words': ['authorization', 'auth'],
                'required': False
            },
            'document_date': {
                'patterns': [
                    r'(?:Referral\s*\/\s*order\s*date|Referral\s*order\s*date|Document\s*Date)[:\s]*([01]?\d\/[0-3]?\d\/\d{4})',
                    r'\bDate[:\s]*([01]?\d\/[0-3]?\d\/\d{4})\b'
                ],
                'context_words': ['referral', 'document', 'date'],
                'required': False
            },
            'intake_date': {
                'patterns': [
                    r'(?:Intake\s*\/\s*processing|Intake\s*Date)[:\s]*([01]?\d\/[0-3]?\d\/\d{4})'
                ],
                'context_words': ['intake', 'processing', 'date'],
                'required': False
            },
            'indication': {
                'patterns': [
                    r'(?is)(?:Indication|Primary\s*Diagnosis)\s*[:\-]\s*([^\n]+(?:\n(?!\s*[A-Z][A-Za-z ]{0,30}\s*:).+)*)'
                ],
                'context_words': ['indication', 'diagnosis'],
                'required': False
            },
            'patient_phone': {
                'patterns': [
                    r'Patient\s*(?:Phone|Cell\s*Phone|Mobile)[:\s]*\(?([0-9]{3})\)?[-\s]?([0-9]{3})[-\s]?([0-9]{4})',
                    r'\bCell\s*Phone[:\s]*\(?([0-9]{3})\)?[-\s]?([0-9]{3})[-\s]?([0-9]{4})',
                    r'\bPatient\s*Cell[:\s]*\(?([0-9]{3})\)?[-\s]?([0-9]{3})[-\s]?([0-9]{4})'
                ],
                'context_words': ['patient', 'phone', 'cell', 'mobile'],
                'required': False
            },
            'phone_number': {
                'patterns': [
                    r'(?:phone|tel|telephone):\s*\((\d{3})\)\s*(\d{3})[-\s]?(\d{4})',
                    r'phone:\s*\((\d{3})\)\s*(\d{3})-(\d{4})',
                    r'phone\s+\((\d{3})\)\s*(\d{3})[-\s]?(\d{4})',
                    r'Phone:\s*\((\d{3})\)\s*(\d{3})[-\s]?(\d{4})',
                    r'(?:phone|tel|telephone)[:\s]*?(\d{3})[-\s]?(\d{3})[-\s]?(\d{4})'
                ],
                'context_words': ['phone', 'telephone', 'contact'],
                'required': False
            },
            'epworth_score': {
                'patterns': [
                    r'epworth.*?scale.*?(\d{1,2})',
                    r'sleepiness.*?scale.*?(\d{1,2})',
                    r'ess.*?(\d{1,2})'
                ],
                'context_words': ['epworth', 'sleepiness', 'scale'],
                'required': False
            }
        }

    def extract_with_context(self, text: str) -> Dict[str, Any]:
        """
        Extract information using contextual analysis and semantic understanding
        """
        extracted: Dict[str, Any] = {}
        confidence_scores: Dict[str, float] = {}

        # Preprocess text for better matching
        text = self._preprocess_text(text)

        for field_name, field_config in self.field_patterns.items():
            result = self._extract_field_contextual(text, field_name, field_config)
            if result:
                extracted[field_name] = result['value']
                confidence_scores[field_name] = result['confidence']

        # Post-process and validate extracted data
        extracted = self._post_process_extracted_data(extracted, text)

        # Calculate overall confidence
        overall_confidence = 0.0
        if confidence_scores:
            overall_confidence = sum(confidence_scores.values()) / len(confidence_scores)

        return {
            'extracted_data': extracted,
            'confidence_scores': confidence_scores,
            'overall_confidence': overall_confidence,
            'extraction_method': 'contextual_semantic'
        }

    def _preprocess_text(self, text: str) -> str:
        """Clean and normalize text for better pattern matching while preserving newlines."""
        if not text:
            return ''

        # Normalize newlines first
        text = text.replace('\r', '\n')

        # Fix camel-case run-ons without removing newlines
        def _split_camel(m):
            return f"{m.group(1)} {m.group(2)}"
        text = re.sub(r'([a-z])([A-Z])', _split_camel, text)

        # Conservative corrections
        corrections = {
            r"\bIbs\b": 'lbs',
            r"\boln-lab\b": 'in-lab',
            r"5°(\d+)": r"5'\1",
            r"(\d)°(\d+)\"": r"\1'\2\"",
            r"’": "'",
            r"“|”": '"',
            r"\bH4SAT\b": 'HSAT',
            r"\bH5AT\b": 'HSAT',
            r"\bMW['’]?T\b": 'MWT',
            r"CPAP\s*B\s*I\s*B\s*I\s*PAP": 'CPAP/BiPAP',
            r"CPAPBIBIPAP": 'CPAP/BiPAP',
            r"\bUnirefrshing\b": 'Unrefreshing',
            r"sleepin-": 'sleepiness',
            r"\bPR[rt]\.": 'PRN'
        }
        for pattern, replacement in corrections.items():
            text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)

        # Strip stray glyph noise without nuking line structure
        text = re.sub(r"[\[\]<>•·¤©™®]", " ", text)

        # Normalize horizontal whitespace but keep line boundaries
        text = re.sub(r"[ \t]+", " ", text)
        text = re.sub(r" +\n", "\n", text)
        text = re.sub(r"\n{3,}", "\n\n", text)

        return text.strip()

    def _extract_field_contextual(self, text: str, field_name: str, config: Dict) -> Optional[Dict]:
        """Extract a specific field using contextual patterns"""
        # Try direct pattern matching first
        for pattern in config['patterns']:
            matches = re.finditer(pattern, text, re.IGNORECASE | re.MULTILINE)
            for match in matches:
                # Special handling for blood_pressure
                if field_name == 'blood_pressure' and len(match.groups()) >= 2:
                    value = f"{match.group(1)}/{match.group(2)}"
                # Handle phone numbers with multiple groups specially
                elif field_name in ('phone_number', 'patient_phone') and len(match.groups()) >= 3:
                    value = f"({match.group(1)}) {match.group(2)}-{match.group(3)}"
                else:
                    value = match.group(1) if match.groups() else match.group()
                # Guard: when extracting patient_phone, skip hits whose local context looks like clinic/provider/fax
                if field_name == 'patient_phone':
                    ms = max(0, match.start() - 60)
                    me = min(len(text), match.end() + 60)
                    context_window = text[ms:me].lower()
                    if any(bad in context_window for bad in ("fax", "clinic", "provider")) and "patient" not in context_window:
                        continue
                confidence = self._calculate_pattern_confidence(match, text, config)
                if confidence > 0.5:  # Minimum confidence threshold
                    cleaned = self._clean_extracted_value(value, field_name)
                    if not cleaned:
                        continue
                    return {
                        'value': cleaned,
                        'confidence': confidence,
                        'method': 'pattern_match'
                    }
        # Try fuzzy matching for specific fields
        if 'fuzzy_targets' in config:
            fuzzy_result = self._fuzzy_match_field(text, config['fuzzy_targets'], config['context_words'])
            if fuzzy_result:
                return fuzzy_result
        # Try semantic extraction if spaCy is available
        if self.use_spacy:
            semantic_result = self._semantic_extract_field(text, field_name, config)
            if semantic_result:
                return semantic_result
        return None

    def _calculate_pattern_confidence(self, match: re.Match, text: str, config: Dict) -> float:
        """Calculate confidence score for a pattern match"""
        base_confidence = 0.7
        # Boost confidence if context words are nearby
        context_boost = 0.0
        match_start = max(0, match.start() - 80)
        match_end = min(len(text), match.end() + 80)
        context = text[match_start:match_end].lower()
        for context_word in config.get('context_words', []):
            if context_word.lower() in context:
                context_boost += 0.1
        # Reduce confidence for very short matches
        length_penalty = 0.0
        if len(match.group()) < 3:
            length_penalty = 0.2
        return min(1.0, base_confidence + context_boost - length_penalty)

    def _fuzzy_match_field(self, text: str, targets: List[str], context_words: List[str]) -> Optional[Dict]:
        """Perform fuzzy matching for field values"""
        words = text.split()
        best_match = None
        best_ratio = 0.0

        for target in targets:
            for i in range(len(words)):
                for j in range(i + 1, min(i + len(target.split()) + 2, len(words) + 1)):
                    phrase = ' '.join(words[i:j])
                    ratio = SequenceMatcher(None, target.lower(), phrase.lower()).ratio()

                    if ratio > best_ratio and ratio > 0.6:
                        # Check if context words are nearby
                        context_score = self._get_context_score(words, i, j, context_words)
                        total_score = ratio * 0.7 + context_score * 0.3

                        if total_score > best_ratio:
                            best_ratio = total_score
                            best_match = phrase

        if best_match and best_ratio > 0.6:
            return {
                'value': best_match,
                'confidence': best_ratio,
                'method': 'fuzzy_match'
            }

        return None

    def _get_context_score(self, words: List[str], start: int, end: int, context_words: List[str]) -> float:
        """Calculate context score based on nearby words"""
        context_window = 5
        context_start = max(0, start - context_window)
        context_end = min(len(words), end + context_window)
        context_text = ' '.join(words[context_start:context_end]).lower()

        score = 0.0
        for context_word in context_words:
            if context_word.lower() in context_text:
                score += 1.0 / len(context_words)

        return score

    def _semantic_extract_field(self, text: str, field_name: str, config: Dict) -> Optional[Dict]:
        """Use spaCy for semantic extraction (if available)"""
        if not self.use_spacy:
            return None
        # Placeholder for advanced NLP-based extraction
        return None

    def _clean_extracted_value(self, value: Any, field_name: str) -> str:
        """Clean and format extracted values"""
        if value is None:
            return ""
        if not isinstance(value, str):
            value = str(value)
        value = value.strip()
        if not value:
            return ""
        if field_name == 'patient_name':
            # Ensure proper capitalization
            return ' '.join(word.capitalize() for word in value.split())
        elif field_name in ('phone_number', 'patient_phone', 'clinic_phone', 'fax'):
            digits = re.sub(r'\D', '', value)
            if len(digits) == 10:
                return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
            # If it's too short to be a valid US number, discard it
            if len(digits) < 10:
                return ""
        elif field_name == 'insurance_carrier':
            # Prefer JSON-provided synonyms; fallback to built-in canonicalizer
            canon = _canonicalize_carrier(value)
            # Title-case only if it didn't map to a known canonical form
            return canon if canon else value.title()
        elif field_name == 'blood_pressure':
            # already formatted by extractor; no-op here
            return value
        elif field_name == 'height':
            # Ensure format like 5'10"
            v = value.replace(' ', '')
            v = v.replace("°", "'")
            return v
        elif field_name in ('indication', 'primary_diagnosis'):
            # Join wrapped lines, strip stray quotes/colons/dashes, squeeze spaces
            val = re.sub(r'\s*\n\s*', ' ', value)
            val = val.strip(" \"'—–-:|")
            val = re.sub(r'\s{2,}', ' ', val)
            return val
        return value

    def _post_process_extracted_data(self, extracted: Dict, text: str) -> Dict:
        """Post-process and validate extracted data"""

        # Infer missing CPT codes from study type mentions
        if 'cpt_codes' not in extracted or not extracted['cpt_codes']:
            inferred_cpt = self._infer_cpt_from_context(text)
            if inferred_cpt:
                extracted['cpt_codes'] = inferred_cpt

        # Try to recover missing insurance from context
        if 'insurance_carrier' not in extracted:
            inferred_insurance = self._infer_insurance_from_context(text)
            if inferred_insurance:
                extracted['insurance_carrier'] = inferred_insurance

        # Normalize Epworth Sleepiness Scale if present in text (e.g., 16/24)
        ep = re.search(r"epworth\s+sleepiness\s+scale\s*[:\-]?\s*(\d{1,2})\s*/\s*(\d{1,2})", text, re.IGNORECASE)
        if ep:
            extracted['epworth_structured'] = {
                'score': int(ep.group(1)),
                'total': int(ep.group(2))
            }

        # Detect common OSA-related symptoms from keywords
        symptom_map = {
            'loud snoring': r'\bloud\s+snor',
            'witnessed apneas': r'\bwitnessed\s+apnea',
            'gasping/choking during sleep': r'gasping|choking\s+during\s+sleep',
            'excessive daytime sleepiness': r'excessive\s+daytime\s+sleep',
            'morning headaches': r'morning\s+headache',
            'difficulty concentrating': r'difficulty\s+concentrat',
            'restless sleep': r'restless\s+sleep'
        }
        detected = []
        for label, patt in symptom_map.items():
            if re.search(patt, text, re.IGNORECASE):
                detected.append(label)
        if detected:
            extracted['symptoms_list'] = detected

        if 'provider_name' in extracted and extracted['provider_name']:
            extracted['provider_name'] = _strip_leading_name_label(extracted['provider_name'])

        return extracted

    def _infer_cpt_from_context(self, text: str) -> Optional[List[str]]:
        """Infer CPT codes from study type context and return a list (unique, ordered)."""
        mapping = [
            (r'\bcomplete\s+sleep\s+study\b', '95810'),
            (r'in-?lab.*?(polysomnography|psg)', '95810'),
            (r'cpap\s*.*?titration|titration.*?cpap', '95811'),
            (r'cpap\s*[/|]?\s*bi\s*p\s*ap|cpap\s*bi\s*pap|cpapbipap', '95811'),
            (r'home.*sleep.*(apnea)?\s*test|\bhsat\b|\bh5at\b', '95806'),
            (r'\bmslt\b|multiple\s+sleep\s+latency', '95805'),
            (r"\bmw['’]?t\b|maintenance\s+of\s+wakefulness", '95805')
        ]
        text_lower = text.lower()
        codes: List[str] = []
        for pattern, code in mapping:
            if re.search(pattern, text_lower):
                if code not in codes:
                    codes.append(code)
        return codes or None

    def _infer_insurance_from_context(self, text: str) -> Optional[str]:
        """Try to infer insurance from partial mentions or context"""
        partial_patterns = [
            r'blue\s+cross',
            r'bcbs',
            r'medicare',
            r'medicaid',
            r'aetna',
            r'cigna',
            r'united',
            r'humana',
            r'kaiser'
        ]

        for pattern in partial_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                matched_text = match.group().lower()
                if 'blue' in matched_text or 'bcbs' in matched_text:
                    return _canonicalize_carrier('Blue Cross Blue Shield')
                elif 'medicare' in matched_text:
                    return _canonicalize_carrier('Medicare')
                elif 'medicaid' in matched_text:
                    return _canonicalize_carrier('Medicaid')
                elif 'aetna' in matched_text:
                    return _canonicalize_carrier('Aetna')
                elif 'cigna' in matched_text:
                    return _canonicalize_carrier('Cigna')
                elif 'united' in matched_text:
                    return _canonicalize_carrier('UnitedHealthcare')
                elif 'humana' in matched_text:
                    return _canonicalize_carrier('Humana')
                elif 'kaiser' in matched_text:
                    return _canonicalize_carrier('Kaiser Permanente')

        return None


def enhanced_template_extraction(ocr_text: str, ocr_confidence: float = 0.0) -> Dict[str, Any]:
    """
    Enhanced template extraction using semantic mapping (canonical schema).
    """
    mapper = SemanticTemplateMapper()
    result = mapper.extract_with_context(ocr_text)

    extracted = result['extracted_data']
    confidences = result['confidence_scores']

    patient_data: Dict[str, Any] = {}
    insurance_data: Dict[str, Any] = {"primary": {}}
    procedure_data: Dict[str, Any] = {}
    physician_data: Dict[str, Any] = {}
    clinical_data: Dict[str, Any] = {}

    # Patient
    if 'patient_name' in extracted:
        full = ' '.join(extracted['patient_name'].split())
        parts = full.split()
        if len(parts) >= 2:
            patient_data['first_name'] = parts[0]
            patient_data['last_name'] = ' '.join(parts[1:])
        patient_data['name'] = full
    if 'date_of_birth' in extracted:
        patient_data['dob'] = extracted['date_of_birth']
    if 'mrn' in extracted:
        patient_data['mrn'] = extracted['mrn']
    # Patient phone handling with guard against clinic/provider/fax numbers
    if 'patient_phone' in extracted:
        patient_data['phone_home'] = extracted['patient_phone']
    elif 'phone_number' in extracted:
        fallback_phone = extracted['phone_number']
        clinic_phone = extracted.get('clinic_phone')
        fax_number = extracted.get('fax')

        # Only accept generic phone_number if it doesn’t match clinic/fax and the nearby label isn't clinic/provider/fax
        if fallback_phone and fallback_phone not in {clinic_phone, fax_number}:
            # Simple label heuristic on the raw token
            if not any(bad in str(fallback_phone).lower() for bad in ("fax", "clinic", "provider")):
                patient_data['phone_home'] = fallback_phone

    # Vitals
    for k in ('height', 'weight', 'bmi', 'blood_pressure'):
        if k in extracted:
            patient_data[k] = extracted[k]

    # Insurance Primary
    if 'insurance_carrier' in extracted:
        insurance_data['primary']['carrier'] = extracted['insurance_carrier']
        insurance_data['primary']['confidence'] = confidences.get('insurance_carrier', 0.7)
    if 'member_id' in extracted:
        insurance_data['primary']['member_id'] = extracted['member_id']
    if 'authorization_number' in extracted:
        insurance_data['primary']['authorization_number'] = extracted['authorization_number']

    # Procedure
    if 'study_requested' in extracted:
        procedure_data['study_requested'] = extracted['study_requested']
    if 'cpt_codes' in extracted:
        codes = extracted['cpt_codes'] if isinstance(extracted['cpt_codes'], list) else [extracted['cpt_codes']]
        procedure_data['cpt'] = codes
        cpt_descriptions = {
            '95810': 'In-lab polysomnography (diagnostic, 6+ hours)',
            '95811': 'In-lab CPAP/BiPAP titration or split-night',
            '95808': 'Polysomnography; 1-3 parameters',
            '95807': 'PSG; 4 or more parameters',
            '95806': 'Home sleep apnea test (HSAT)',
            '95805': 'MSLT/MWT (sleepiness/wakefulness testing)',
            '95782': 'PSG pediatric under 6',
            '95783': 'PSG pediatric with titration',
            'G0398': 'Home sleep study type II',
            'G0399': 'Home sleep study type III'
        }
        desc_list = [cpt_descriptions.get(c, 'Sleep Study') for c in codes]
        procedure_data['description'] = desc_list[0] if len(desc_list) == 1 else desc_list
        if isinstance(procedure_data['description'], list):
            procedure_data['description_text'] = procedure_data['description'][0]
        else:
            procedure_data['description_text'] = procedure_data['description']
    if 'indication' in extracted:
        _ind = re.sub(r'\s*\n\s*', ' ', extracted['indication']).strip()
        _ind = re.sub(r'\s{2,}', ' ', _ind)
        procedure_data['indication'] = _ind

    # Physician (flattened)
    if 'provider_name' in extracted:
        physician_data['name'] = _strip_leading_name_label(extracted['provider_name'])
    if 'provider_specialty' in extracted:
        physician_data['specialty'] = extracted['provider_specialty']
    if 'provider_npi' in extracted:
        physician_data['npi'] = extracted['provider_npi']
    if 'clinic_phone' in extracted:
        physician_data['clinic_phone'] = extracted['clinic_phone']
    if 'fax' in extracted:
        physician_data['fax'] = extracted['fax']

    # Clinical
    if 'epworth_structured' in extracted:
        score = extracted['epworth_structured'].get('score')
        total = extracted['epworth_structured'].get('total', 24)
        if isinstance(score, int):
            clinical_data['epworth_score'] = f"{score}/{total}"
        else:
            clinical_data['epworth_score'] = extracted['epworth_structured']
    elif 'epworth_score' in extracted:
        try:
            clinical_data['epworth_score'] = f"{int(extracted['epworth_score'])}/24"
        except Exception:
            clinical_data['epworth_score'] = str(extracted['epworth_score'])
    if 'symptoms_list' in extracted:
        clinical_data['symptoms'] = extracted['symptoms_list']

    # Document / Metadata
    doc = extracted.get('document_date', '')
    intake = extracted.get('intake_date', '')

    # Overall confidence
    overall_conf = result['overall_confidence'] if result['overall_confidence'] else (ocr_confidence or 0.0)

    # Fallback fill for missing core fields (non-destructive)
    try:
        apply_fallback_mappings(ocr_text, patient_data, insurance_data, physician_data, procedure_data)
    except Exception:
        pass

    # --- Optional CPT selection via external rules (safe/no-op if unavailable) ---
    try:
        if _cpt_rules and hasattr(_cpt_rules, "select_cpt"):
            rec = None
            try:
                rec = _cpt_rules.select_cpt(
                    extracted_text=ocr_text or "",
                    patient_age=patient_data.get("age"),
                    prior_positive_test=bool(clinical_data.get("prior_positive_test", False)),
                    cpap_issues=clinical_data.get("cpap_issues") or [],
                    insurance=insurance_data.get("primary") or {},
                )
            except TypeError:
                # Fallback to legacy signature
                rec = _cpt_rules.select_cpt(ocr_text or "")

            # Normalize outputs from selector
            codes = None
            description = None
            if isinstance(rec, dict):
                codes = rec.get("codes") or rec.get("code")
                description = rec.get("description") or rec.get("label")
            elif isinstance(rec, (list, tuple)):
                codes = list(rec)
            elif isinstance(rec, str):
                codes = rec

            if codes:
                # Merge with any existing CPTs non-destructively
                existing = procedure_data.get("cpt")
                new_list = codes if isinstance(codes, list) else [codes]
                if not existing:
                    procedure_data["cpt"] = new_list if len(new_list) > 1 else new_list[0]
                else:
                    existing_list = existing if isinstance(existing, list) else [existing]
                    union = []
                    for c in existing_list + new_list:
                        if c and c not in union:
                            union.append(c)
                    procedure_data["cpt"] = union if len(union) > 1 else union[0]

                if description:
                    procedure_data["description"] = description
                    procedure_data["description_text"] = description

                # Optional debug trace
                if os.environ.get("MEDOCR_DEBUG"):
                    try:
                        print("=== MEDOCR TRACE HOOK === cpt_rules applied:", procedure_data.get("cpt"))
                    except Exception:
                        pass
    except Exception:
        # Never break extraction if rules import/signature changes
        pass

    reason_text, diag_entries = _extract_reason_and_diagnoses(ocr_text or "")
    if reason_text:
        if not procedure_data.get('indication'):
            procedure_data['indication'] = reason_text
        clinical_data.setdefault('reason_for_referral', reason_text)

    if diag_entries:
        existing_codes_raw = clinical_data.get('icd10_codes') or []
        normalized_codes: List[str] = []
        for item in existing_codes_raw:
            if isinstance(item, dict) and item.get('code'):
                code_val = str(item['code']).upper()
                if code_val not in normalized_codes:
                    normalized_codes.append(code_val)
            elif isinstance(item, str):
                code_val = item.upper()
                if code_val not in normalized_codes:
                    normalized_codes.append(code_val)

        diag_struct = []
        existing_struct_codes = set()
        existing_struct = clinical_data.get('diagnoses')
        if isinstance(existing_struct, list):
            for entry in existing_struct:
                if isinstance(entry, dict) and entry.get('code'):
                    code_val = str(entry['code']).upper()
                    existing_struct_codes.add(code_val)
                    diag_struct.append(entry)

        for code, desc in diag_entries:
            if code not in normalized_codes:
                normalized_codes.append(code)
            if code not in existing_struct_codes:
                entry = {'code': code}
                if desc:
                    entry['description'] = desc
                diag_struct.append(entry)
                existing_struct_codes.add(code)

        if normalized_codes:
            clinical_data['icd10_codes'] = normalized_codes
        if diag_struct:
            clinical_data['diagnoses'] = diag_struct
        if not clinical_data.get('primary_diagnosis'):
            first_code, first_desc = diag_entries[0]
            clinical_data['primary_diagnosis'] = f"{first_code} — {first_desc}".strip(" —") if first_desc else first_code

    # ---- Centralized CPT selection (JSON-driven) — try first ----
    if not procedure_data.get('cpt'):
        select_cpt = None
        try:
            # Prefer project layout: rules/cpt_selector.py
            from rules.cpt_selector import select_cpt  # type: ignore
        except Exception:
            select_cpt = None
        if select_cpt:
            try:
                cpt_choice = select_cpt(
                    extracted_text=ocr_text or "",
                    patient_age=patient_data.get("age"),
                    prior_positive_test=bool(clinical_data.get("prior_positive_test", False)),
                    cpap_issues=clinical_data.get("cpap_issues", []),
                    study_requested=procedure_data.get("study_requested", ""),
                    icd_codes=clinical_data.get("icd10_codes", []),
                )
                if cpt_choice:
                    procedure_data["cpt"] = cpt_choice
            except Exception:
                # If selector raises, we silently fall back to heuristics below
                pass

    # If CPT still missing, map from study_requested text (conservative mapping)
    if not procedure_data.get('cpt'):
        sr = (procedure_data.get('study_requested') or '').lower()
        if sr:
            if re.search(r'\bcomplete\s+sleep\s+study\b', sr):
                procedure_data['cpt'] = '95810'
            elif re.search(r"split[\-\s\u2013\u2014]*night|titration|cpap\s*[/|]?\s*bi\s*p\s*ap|cpap\s*bi\s*pap|bipap", sr):
                procedure_data['cpt'] = '95811'
            # in-lab polysomnography / PSG → 95810
            elif re.search(r"in[-\s]?lab.*?(polysom|psg)|\bpsg\b|polysomnograph", sr):
                procedure_data['cpt'] = '95810'
            # home study / HSAT / type II/III → 95806 (or G0399 if you prefer Type III)
            elif re.search(r"home\s+sleep|\bhsat\b|type\s*ii|type\s*iii|type\s*2|type\s*3", sr):
                procedure_data['cpt'] = '95806'
            # MSLT / MWT → 95805
            elif re.search(r"\bmslt\b|multiple\s+sleep\s+latency|\bmw['’]?t\b|maintenance\s+of\s+wakefulness", sr):
                procedure_data['cpt'] = '95805'

    # If multiple CPT codes exist, collapse to a single best by priority
    if isinstance(procedure_data.get('cpt'), list) and procedure_data['cpt']:
        priority = ['95811', '95810', 'G0399', '95806', 'G0398', '95805']
        for p in priority:
            if p in procedure_data['cpt']:
                procedure_data['cpt'] = p
                break

    # ICD-driven CPT fallback: if structured ICDs indicate OSA and CPT is still empty,
    # choose a conservative study type based on text cues (prefers in-lab unless HSAT cues present)
    if not procedure_data.get('cpt'):
        icds_list = clinical_data.get('icd10_codes') or []
        # normalize to a list of strings
        icd_codes = []
        for it in icds_list:
            if isinstance(it, dict) and it.get('code'):
                icd_codes.append(str(it['code']).upper())
            elif isinstance(it, str):
                icd_codes.append(it.upper())
        def _has_osa_icd(codes):
            for c in codes:
                # G47.33 (OSA), G47.30 (unspecified sleep apnea), G47.39 (other)
                if c.startswith('G47.33') or c.startswith('G47.30') or c.startswith('G47.39'):
                    return True
            return False
        if _has_osa_icd(icd_codes):
            text_blob = ocr_text or ''
            hsat_cues = bool(re.search(r"home\s+sleep|\bhsat\b|type\s*ii|type\s*iii|type\s*2|type\s*3", text_blob, re.IGNORECASE))
            titration_cues = bool(re.search(r"\btitration\b|cpap\s*[/|]?\s*bi\s*p\s*ap|cpap\s*bi\s*pap|\bbipap\b", text_blob, re.IGNORECASE))
            splitnight_cues = bool(re.search(r"\bsplit[\-\s\u2013\u2014]*night\b", text_blob, re.IGNORECASE))
            if titration_cues or splitnight_cues:
                procedure_data['cpt'] = '95811'
            elif hsat_cues:
                # If payer uses G0399 for Type III, you can flip this.
                procedure_data['cpt'] = '95806'
            else:
                procedure_data['cpt'] = '95810'

    # Promote ICD primary from list if present but primary_diagnosis missing
    if not clinical_data.get("primary_diagnosis"):
        icds = clinical_data.get("icd10_codes") or []
        if icds and isinstance(icds, list):
            first = icds[0]
            if isinstance(first, dict) and first.get("code"):
                clinical_data["primary_diagnosis"] = f"{first.get('code')} — {first.get('label') or ''}".strip(" —")
            elif isinstance(first, str):
                clinical_data["primary_diagnosis"] = first

    # ICD fallback: harvest tokens from text if none found
    if not clinical_data.get('icd10_codes'):
        tokens = []
        seen = set()
        for m in ICD_TOKEN_RE.finditer(ocr_text or ""):
            code = m.group(1)
            # Prefer sleep/respiratory-related groups, but keep all unique
            if code not in seen:
                seen.add(code)
                tokens.append(code)
        if tokens:
            clinical_data['icd10_codes'] = tokens
            if not clinical_data.get('primary_diagnosis'):
                clinical_data['primary_diagnosis'] = tokens[0]

    # Post-ICD harvest CPT fallback (runs after ICD tokens are populated)
    if not procedure_data.get('cpt'):
        icds_list2 = clinical_data.get('icd10_codes') or []
        icd_codes2 = []
        for it in icds_list2:
            if isinstance(it, dict) and it.get('code'):
                icd_codes2.append(str(it['code']).upper())
            elif isinstance(it, str):
                icd_codes2.append(it.upper())
        def _has_osa_icd2(codes):
            for c in codes:
                if c.startswith('G47.33') or c.startswith('G47.30') or c.startswith('G47.39'):
                    return True
            return False
        if _has_osa_icd2(icd_codes2):
            text_blob2 = ocr_text or ''
            hsat_cues2 = bool(re.search(r"home\s+sleep|\bhsat\b|type\s*ii|type\s*iii|type\s*2|type\s*3", text_blob2, re.IGNORECASE))
            titration_cues2 = bool(re.search(r"\btitration\b|cpap\s*[/|]?\s*bi\s*p\s*ap|cpap\s*bi\s*pap|\bbipap\b", text_blob2, re.IGNORECASE))
            splitnight_cues2 = bool(re.search(r"\bsplit[\-\s\u2013\u2014]*night\b", text_blob2, re.IGNORECASE))
            if titration_cues2 or splitnight_cues2:
                procedure_data['cpt'] = '95811'
            elif hsat_cues2:
                procedure_data['cpt'] = '95806'
            else:
                procedure_data['cpt'] = '95810'

    # Ensure description after any late CPT assignment (e.g., clinical fallback)
    if procedure_data.get('cpt') and not procedure_data.get('description'):
        cpt_map = {
            '95810': 'In-lab polysomnography (diagnostic, 6+ hours)',
            '95811': 'In-lab CPAP/BiPAP titration or split-night',
            '95808': 'Polysomnography; 1-3 parameters',
            '95807': 'PSG; 4 or more parameters',
            '95806': 'Home sleep apnea test (HSAT)',
            '95805': 'MSLT/MWT (sleepiness/wakefulness testing)',
            '95782': 'PSG pediatric under 6',
            '95783': 'PSG pediatric with titration',
            'G0398': 'Home sleep study type II',
            'G0399': 'Home sleep study type III'
        }
        codes = procedure_data['cpt'] if isinstance(procedure_data['cpt'], list) else [procedure_data['cpt']]
        desc_list = [cpt_map.get(c, 'Sleep Study') for c in codes]
        procedure_data['description'] = desc_list[0] if len(desc_list) == 1 else desc_list
        if isinstance(procedure_data['description'], list):
            procedure_data['description_text'] = procedure_data['description'][0]
        else:
            procedure_data['description_text'] = procedure_data['description']

    # Sanitize/split mixed primary diagnosis lines:
    # - Keep ICD (with optional description) in primary_diagnosis
    # - Move any residual "sleep study" instruction-like text to indication
    pd_raw = clinical_data.get('primary_diagnosis')
    pd = (pd_raw or '').strip().strip('"').strip("'")
    if pd:
        icd_match = re.search(r'\b([A-TV-Z][0-9][0-9A-Z](?:\.[0-9A-Z]{1,4})?)\b(?:\s*[—\-:]\s*(.*))?$', pd)
        if icd_match:
            icd_code = icd_match.group(1)
            icd_desc = (icd_match.group(2) or '').strip()
            kept_pd = f"{icd_code} — {icd_desc}".strip(" —") if icd_desc else icd_code
            # Set/normalize primary diagnosis to the ICD portion
            clinical_data['primary_diagnosis'] = kept_pd
            # Remove the ICD portion from the raw text to see if residual instruction-like text remains
            # Only remove the first occurrence to avoid nuking similar substrings elsewhere
            pd_residual = pd
            try:
                pd_residual = pd_residual.replace(icd_match.group(0), '', 1).strip(" .,-:;|\"'")
            except Exception:
                pd_residual = ''
            if pd_residual:
                # If the residual looks like a sleep-study instruction, append to indication
                if re.search(r'\bsleep\s+study\b|\bhsat\b|\bhome\s+sleep\b|\btitration\b|\bsplit[\-\s\u2013\u2014]*night\b', pd_residual, re.IGNORECASE):
                    existing_ind = procedure_data.get('indication', '')
                    joiner = ' | ' if existing_ind else ''
                    procedure_data['indication'] = f"{existing_ind}{joiner}{pd_residual}".strip()
        else:
            # No ICD token in the PD field: if it looks like instruction, move to indication and clear PD
            if re.search(r'\bsleep\s+study\b|\bhsat\b|\bhome\s+sleep\b|\btitration\b|\bsplit[\-\s\u2013\u2014]*night\b', pd, re.IGNORECASE):
                if not procedure_data.get('indication'):
                    procedure_data['indication'] = pd
                else:
                    procedure_data['indication'] = f"{procedure_data['indication']} | {pd}"
                clinical_data.pop('primary_diagnosis', None)

    # --- BEGIN: HIPAA-safe debug trace ---
    if os.getenv("MEDOCR_DEBUG", "0") == "1":
        def _has(d, path):
            cur = d
            for part in path.split("."):
                if isinstance(cur, list):
                    return len(cur) > 0
                if not isinstance(cur, dict) or part not in cur:
                    return False
                cur = cur[part]
            return cur not in (None, "", [], {})

        record = {
            'patient': patient_data,
            'insurance': insurance_data,
            'procedure': procedure_data,
            'physician': physician_data,
            'clinical': clinical_data,
        }
        want = [
            "patient.name","patient.first_name","patient.last_name","patient.dob",
            "insurance.primary.carrier","insurance.primary.member_id","insurance.primary.group",
            "procedure.cpt","procedure.description",
            "procedure.description_text",
            "physician.name","physician.npi",
            "clinical.primary_diagnosis","clinical.icd10_codes"
        ]
        present = [k for k in want if _has(record, k)]
        missing = [k for k in want if not _has(record, k)]
        print("=== MEDOCR TRACE ===")
        print("present:", ", ".join(present) if present else "(none)")
        print("missing:", ", ".join(missing) if missing else "(none)")
        print("method:", result.get("extraction_method"), "| overall_conf:", f"{overall_conf:.1f}")
    # --- END: HIPAA-safe debug trace ---

    # Final contact cleanup: drop invalid fax if shorter than 10 digits
    if physician_data.get('fax'):
        _digits = re.sub(r'\D', '', str(physician_data['fax']))
        if len(_digits) < 10:
            physician_data.pop('fax', None)

    # Ensure flat description_text is set for preview consumers
    if procedure_data.get('description') and not procedure_data.get('description_text'):
        if isinstance(procedure_data['description'], list):
            procedure_data['description_text'] = procedure_data['description'][0]
        else:
            procedure_data['description_text'] = procedure_data['description']

    return {
        'patient': patient_data,
        'insurance': insurance_data,
        'procedure': procedure_data,
        'physician': physician_data,
        'clinical': clinical_data,
        'document_date': doc,
        'intake_date': intake,
        'confidence_scores': confidences,
        'extraction_method': result['extraction_method'],
        'overall_confidence': overall_conf
    }
