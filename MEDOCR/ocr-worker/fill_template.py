#!/usr/bin/env python3
"""Generate a lightweight client summary document from OCR output.

The script is invoked by the Node backend as:
    python fill_template.py <ocr_text_file> <output_file> [analysis_json]

It keeps the contract of older versions (reads a template.txt living next to
this script) but understands the richer data model produced by the current
pipeline. If structured data is available via the analysis JSON it will reuse
that; otherwise it falls back to the backend_integration extractor or some
minimal regex heuristics so that the resulting summary still shows key fields.
"""
from __future__ import annotations

import argparse
import copy
import html
import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from semantic_template_mapper import apply_fallback_mappings

DEFAULT_TEMPLATE = """<!DOCTYPE html>
<html lang=\"en\">
<head>
  <meta charset=\"utf-8\" />
  <title>MEDOCR Client Summary</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 24px; color: #0f172a; }
    h1, h2 { color: #1e293b; }
    header { margin-bottom: 24px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .card { border: 1px solid #cbd5f5; border-radius: 10px; padding: 16px; background: #f8fafc; }
    .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; }
    .value { font-size: 15px; font-weight: 600; margin-top: 4px; color: #0f172a; }
    .pill { display: inline-block; padding: 4px 9px; border-radius: 999px; background: #e0f2fe; color: #0c4a6e; margin-right: 8px; margin-bottom: 6px; font-size: 12px; }
    pre { background: #0f172a; color: #e2e8f0; padding: 16px; border-radius: 12px; overflow-x: auto; white-space: pre-wrap; }
    .muted { color: #64748b; font-size: 13px; }
  </style>
</head>
<body>
  <header>
    <h1>Client Summary</h1>
    <div class=\"muted\">Generated {{generated_at}} • Confidence {{confidence_label}} ({{confidence_score}})</div>
  </header>

  <section class=\"grid\">
    <div class=\"card\">
      <div class=\"label\">Patient</div>
      <div class=\"value\">{{patient_name}}</div>
      <div class=\"muted\">DOB: {{patient_dob}} • MRN: {{patient_mrn}}</div>
      <div class=\"muted\">Phone: {{patient_phone}} • BMI: {{patient_bmi}} • BP: {{patient_bp}}</div>
    </div>
    <div class=\"card\">
      <div class=\"label\">Insurance</div>
      <div class=\"value\">{{insurance_carrier}}</div>
      <div class=\"muted\">Member: {{insurance_member_id}} • Group: {{insurance_group}}</div>
      <div class=\"muted\">Authorization: {{insurance_authorization}} • Verified: {{insurance_verified}}</div>
    </div>
    <div class=\"card\">
      <div class=\"label\">Physician</div>
      <div class=\"value\">{{physician_name}}</div>
      <div class=\"muted\">NPI: {{physician_npi}} • Phone: {{physician_phone}} • Fax: {{physician_fax}}</div>
      <div class=\"muted\">Practice: {{physician_practice}}</div>
    </div>
    <div class=\"card\">
      <div class=\"label\">Procedure</div>
      <div class=\"value\">{{procedure_cpt}}</div>
      <div class=\"muted\">{{procedure_description}}</div>
      <div class=\"muted\">Indication: {{procedure_indication}}</div>
    </div>
  </section>

  <section class=\"card\">
    <div class=\"label\">Clinical Snapshot</div>
    <div class=\"value\">Diagnosis: {{clinical_diagnosis}}</div>
    <div class=\"muted\">Symptoms: {{clinical_symptoms}}</div>
  </section>

  <section class=\"card\">
    <div class=\"label\">Flags</div>
    {{flags}}
  </section>

  <section class=\"card\">
    <div class=\"label\">Actions</div>
    {{actions}}
  </section>

  <section class=\"card\">
    <div class=\"label\">Dates</div>
    <div class=\"muted\">Referral Date: {{document_date}} • Intake Date: {{intake_date}}</div>
  </section>

  <section>
    <h2>OCR Preview</h2>
    <pre>{{raw_text}}</pre>
  </section>
</body>
</html>
"""


@dataclass
class StructuredRecord:
    patient: Dict[str, Any]
    insurance: Dict[str, Any]
    physician: Dict[str, Any]
    procedure: Dict[str, Any]
    clinical: Dict[str, Any]
    flags: List[str]
    actions: List[str]
    confidence_label: str
    confidence_score: str
    document_date: str
    intake_date: str


def load_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""


def load_json(path: Optional[Path]) -> Optional[Dict[str, Any]]:
    if not path or not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8", errors="ignore"))
    except Exception:
        return None


# Helper to auto-discover analysis JSON if not provided
def _autodiscover_analysis_path(text_path: Path) -> Optional[Path]:
    """Try to locate a companion analysis JSON file if the caller didn't pass one."""
    if not isinstance(text_path, Path):
        return None
    candidates = [
        text_path.with_suffix(".json"),
        text_path.with_name(text_path.stem + ".analysis.json"),
        text_path.with_name("analysis.json"),
    ]
    for p in candidates:
        try:
            if p.exists() and p.is_file():
                return p
        except Exception:
            continue
    return None


def _discover_structured_from_analysis(analysis: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not isinstance(analysis, dict):
        return None
    for key in ("record", "structured", "enhanced_data", "extracted_data", "normalized", "data"):
        candidate = analysis.get(key)
        if isinstance(candidate, dict):
            return copy.deepcopy(candidate)
    # analysis payload might already be in canonical shape
    if any(k in analysis for k in ("patient", "insurance", "procedure")):
        return copy.deepcopy(analysis)
    return None


def _fallback_extract(text: str) -> Dict[str, Any]:
    """Heuristic extraction to guarantee the template has meaningful content."""
    simple_text = text or ""
    lines = [ln.strip() for ln in simple_text.splitlines()]

    def value_after(label_regex: str, max_lookahead: int = 3) -> str:
        pattern = re.compile(label_regex, re.I)
        for idx, raw in enumerate(lines):
            if not raw:
                continue
            if pattern.search(raw):
                parts = re.split(r"[:\-]\s*", raw, maxsplit=1)
                if len(parts) == 2 and parts[1].strip():
                    return parts[1].strip()
                for j in range(1, max_lookahead + 1):
                    if idx + j < len(lines) and lines[idx + j]:
                        return lines[idx + j]
        return ""

    patient_name = ""
    dob = ""
    mrn = ""
    carrier = ""
    member_id = ""
    physician = ""
    cpt_codes: List[str] = []
    diagnosis = ""
    symptoms: List[str] = []

    name_match = re.search(r"Patient Name[:\s]*([A-Za-z,.'-]+(?:\s+[A-Za-z.'-]+)*)", simple_text, re.I)
    if name_match:
        patient_name = name_match.group(1).strip()
    else:
        name_match = re.search(r"PATIENT[:\s]*([A-Za-z,.'-]+(?:\s+[A-Za-z.'-]+)*)", simple_text, re.I)
        if name_match:
            patient_name = name_match.group(1).strip()
        else:
            patient_name = value_after(r"^patient\b") or value_after(r"^pat(?:ient)?\b")

    dob_match = re.search(r"\b(?:DOB|Date of Birth)[:\s]*([01]?\d[\/-][0-3]?\d[\/-]\d{2,4})", simple_text, re.I)
    if dob_match:
        dob = dob_match.group(1)
    else:
        dob = value_after(r"date\s+of\s+birth")

    mrn_match = re.search(r"\bMRN[:\s]*([A-Z0-9-]{3,})", simple_text, re.I)
    if mrn_match:
        mrn = mrn_match.group(1)
    else:
        mrn = value_after(r"\bmrn\b")

    carrier_match = re.search(r"Insurance(?:\s*\(Primary\))?[:\s]*([A-Za-z0-9 &-]{3,})", simple_text, re.I)
    if carrier_match:
        carrier = carrier_match.group(1).strip()
    else:
        carrier_match = re.search(r"Primary Insurance[:\s]*([A-Za-z0-9 &-]{3,})", simple_text, re.I)
        if carrier_match:
            carrier = carrier_match.group(1).strip()
        else:
            carrier = value_after(r"^primary\s+insurance")

    member_match = re.search(r"Member\s*(?:ID|#)[:\s]*([A-Za-z0-9-]{3,})", simple_text, re.I)
    if member_match:
        member_id = member_match.group(1)
    else:
        member_id = value_after(r"member\s*(?:id|#)")

    physician_match = re.search(r"Referring\s+Physician[:\s]*([A-Za-z.'-]+(?:\s+[A-Za-z.'-]+)*)", simple_text, re.I)
    if physician_match:
        physician = physician_match.group(1)
    else:
        physician = value_after(r"referring\s+physician") or value_after(r"physician")

    cpt_codes = re.findall(r"\b9\d{4}\b", simple_text)
    if not cpt_codes:
        inline_cpt = value_after(r"(?:cpt|procedure)\b")
        if inline_cpt:
            cpt_codes = re.findall(r"\b(?:[A-Z]\d{4}|9\d{4})\b", inline_cpt)

    diag_match = re.search(r"Diagnosis[:\s]*([^\n]+)", simple_text, re.I)
    if diag_match:
        diagnosis = diag_match.group(1).strip()
    else:
        diagnosis = value_after(r"diagnosis")

    symptom_matches = re.findall(r"\b(snoring|apnea|insomnia|fatigue|sleepiness)\b", simple_text, re.I)
    if symptom_matches:
        symptoms = sorted({s.strip().lower() for s in symptom_matches})

    return {
        "patient": {
            "name": patient_name,
            "dob": dob,
            "mrn": mrn,
        },
        "insurance": {
            "primary": {
                "carrier": carrier,
                "member_id": member_id,
            }
        },
        "physician": {
            "name": physician,
        },
        "procedure": {
            "cpt": cpt_codes,
        },
        "clinical": {
            "primary_diagnosis": diagnosis,
            "symptoms": symptoms,
        },
        "flags": [],
        "actions": [],
    }


def _merge_prefer_primary(primary: Optional[Dict[str, Any]], secondary: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not primary and not secondary:
        return None
    if not primary:
        return copy.deepcopy(secondary)
    if not secondary:
        return copy.deepcopy(primary)

    def _merge(a: Any, b: Any) -> Any:
        if isinstance(a, dict) and isinstance(b, dict):
            merged = {}
            keys = set(a.keys()) | set(b.keys())
            for key in keys:
                merged[key] = _merge(a.get(key), b.get(key))
            return merged
        if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
            merged_list = list(a) if isinstance(a, list) else list(a or [])
            seen = {json.dumps(item, sort_keys=True) if isinstance(item, (dict, list)) else str(item): True for item in merged_list}
            for item in b:
                sig = json.dumps(item, sort_keys=True) if isinstance(item, (dict, list)) else str(item)
                if sig not in seen:
                    merged_list.append(item)
                    seen[sig] = True
            return merged_list
        # Prefer primary when it is meaningful, otherwise fall back
        if a in (None, "", [], {}, ()):  # empty primary → use secondary
            return copy.deepcopy(b)
        return copy.deepcopy(a)

    return _merge(primary, secondary)


def build_structured(text: str, analysis: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    structured = _discover_structured_from_analysis(analysis) or {}

    # Many pipelines expose a richer "normalized" payload alongside the
    # legacy structured blob. Prefer fields from the primary discovery but
    # backfill any gaps with the normalized view before touching heuristics.
    if isinstance(analysis, dict):
        normalized = analysis.get("normalized")
        if isinstance(normalized, dict):
            # Normalized payload tends to have the cleanest values, so treat it
            # as the preferred source while still keeping any legacy-only keys
            # from the original structured dictionary.
            structured = _merge_prefer_primary(normalized, structured) or {}

    # Try using the full backend integration extractor to enrich missing fields.
    backend_data = None
    try:
        from backend_integration import extract as backend_extract

        avg_conf = None
        if isinstance(analysis, dict):
            avg_conf = analysis.get("avg_conf") or analysis.get("confidence")
        backend_data = backend_extract(text, avg_conf)
        if not isinstance(backend_data, dict):
            backend_data = None
    except Exception:
        backend_data = None

    merged = _merge_prefer_primary(structured, backend_data)
    if merged:
        structured = merged

    if not isinstance(structured, dict):
        structured = {}

    patient = structured.get("patient")
    if not isinstance(patient, dict):
        patient = {}
    insurance = structured.get("insurance")
    if not isinstance(insurance, dict):
        insurance = {}
    physician = structured.get("physician")
    if not isinstance(physician, dict):
        physician = {}
    procedure = structured.get("procedure")
    if not isinstance(procedure, dict):
        procedure = {}

    structured["patient"] = patient
    structured["insurance"] = insurance
    structured["physician"] = physician
    structured["procedure"] = procedure

    try:
        apply_fallback_mappings(text, patient, insurance, physician, procedure)
    except Exception:
        pass

    if isinstance(patient, dict):
        first = (patient.get("first_name") or "").strip()
        last = (patient.get("last_name") or "").strip()
        full = f"{first} {last}".strip()
        if full and any([first, last]):
            patient["name"] = full
        elif not patient.get("name") and isinstance(structured.get("patient_name"), str):
            fallback_name = structured.get("patient_name", "")
            if fallback_name.strip():
                patient["name"] = fallback_name.strip()
        structured["patient"] = patient

    if structured:
        return structured

    return _fallback_extract(text)


def _first_non_empty(*values: Any) -> str:
    for val in values:
        if isinstance(val, str) and val.strip():
            return val.strip()
        if isinstance(val, (list, tuple)) and val:
            return ", ".join(str(v) for v in val if v)
        if val not in (None, ""):
            return str(val)
    return "Not found"


def _format_list(values: Any, default: str = "Not found") -> str:
    if isinstance(values, (list, tuple, set)):
        cleaned = [str(v) for v in values if str(v).strip()]
        if cleaned:
            return "".join(f"<span class=\"pill\">{html.escape(v)}</span>" for v in cleaned)
    if isinstance(values, str) and values.strip():
        return "<span class=\"pill\">{}</span>".format(html.escape(values.strip()))
    return f"<span class=\"muted\">{default}</span>"


def _safe(value: Any, default: str = "Not found") -> str:
    if value is None:
        return default
    if isinstance(value, (list, tuple, set)):
        joined = ", ".join(str(v) for v in value if v)
        return html.escape(joined) if joined else default
    text = str(value).strip()
    return html.escape(text) if text else default


def _clean_group(val: Any) -> str:
    """Normalize insurance group for display; filter placeholders and junk tokens."""
    s = (str(val) or "").strip()
    if not s:
        return "N/A"
    bad = {"engine", "subscriberno", "migueldob", "n/a", "none", "null"}
    if s.lower() in bad:
        return "N/A"
    # Typical plan/group formats are alnum with optional dashes, 3–20 chars, no spaces
    if re.fullmatch(r"[A-Za-z0-9\-]{3,20}", s):
        return s
    return "N/A"

def _find_patient_phone_from_text(text: str) -> Optional[str]:
    """Prefer a patient-specific phone from OCR text when structured is missing."""
    if not text:
        return None
    # Look for explicit Patient Phone labels first
    m = re.search(r"(?:Patient\s*(?:Cell|Home)?\s*Phone|Patient Phone)\s*[:\-]?\s*(\(?\d{3}\)?[^\d]?\d{3}[^\d]?\d{4})", text, re.I)
    if m:
        return m.group(1)
    # Secondary heuristic: a line mentioning Patient followed by a phone number
    m = re.search(r"^.*Patient.*?(\(?\d{3}\)?[^\d]?\d{3}[^\d]?\d{4}).*$", text, re.I | re.M)
    if m:
        return m.group(1)
    return None

def build_context(structured: Dict[str, Any], text: str, analysis: Optional[Dict[str, Any]]) -> Dict[str, str]:
    patient = structured.get("patient") or {}
    insurance = (structured.get("insurance") or {}).get("primary", {})
    physician = structured.get("physician") or {}
    procedure = structured.get("procedure") or {}
    clinical = structured.get("clinical") or {}

    if isinstance(analysis, dict):
        normalized = analysis.get("normalized")
        if isinstance(normalized, dict):
            # Prefer normalized payload (backend canonical) and backfill with any legacy values
            patient = _merge_prefer_primary(normalized.get("patient"), patient) or patient
            insurance = _merge_prefer_primary(
                (normalized.get("insurance") or {}).get("primary"),
                insurance,
            ) or insurance
            physician = _merge_prefer_primary(normalized.get("physician"), physician) or physician
            procedure = _merge_prefer_primary(normalized.get("procedure"), procedure) or procedure
            clinical = _merge_prefer_primary(normalized.get("clinical"), clinical) or clinical

    flags = structured.get("flags") or (analysis.get("flags") if isinstance(analysis, dict) else None) or []
    actions = structured.get("actions") or (analysis.get("actions") if isinstance(analysis, dict) else None) or []

    def _clean_str(value):
        if value is None:
            return ""
        s = str(value)
        s = s.replace('\r', ' ').replace('\n', ' ').replace('\t', ' ').replace('\f', ' ')
        s = re.sub(r"\\[Nn]", " ", s)
        s = re.sub(r"\s+", " ", s)
        return s.strip()

    def _collapse_carrier(value):
        s = _clean_str(value)
        if not s:
            return s
        s = re.split(r"\b(?:Subscriber|Member|Address|Phone)\b", s, 1)[0]
        return s.strip(' ,;:')

    def _collapse_physician(value):
        s = _clean_str(value)
        if not s:
            return s
        s = re.split(r"\bProvider\s+(?:Facility|Speciality|NPI|UPIN|1D Number)\b", s, 1)[0]
        s = re.split(r"\bAddress\b", s, 1)[0]
        return s.strip(' ,;:')

    confidence_label = _first_non_empty(
        structured.get("confidence_label"),
        clinical.get("confidence_label"),
        (analysis or {}).get("confidence_label") if isinstance(analysis, dict) else None,
        "High",
    )
    confidence_score_raw = _first_non_empty(
        structured.get("overall_confidence"),
        (structured.get("confidence_scores") or {}).get("overall_confidence") if isinstance(structured.get("confidence_scores"), dict) else None,
        (analysis or {}).get("avg_conf") if isinstance(analysis, dict) else None,
        0.85,
    )
    try:
        confidence_score = float(confidence_score_raw)
        confidence_score_str = f"{confidence_score*100:.1f}%" if confidence_score <= 1.5 else f"{confidence_score:.1f}"
    except Exception:
        confidence_score_str = str(confidence_score_raw)

    document_date = _first_non_empty(
        structured.get("document_date"),
        procedure.get("document_date"),
        (analysis or {}).get("document_date") if isinstance(analysis, dict) else None,
        "Not provided",
    )
    intake_date = _first_non_empty(
        structured.get("intake_date"),
        (analysis or {}).get("intake_date") if isinstance(analysis, dict) else None,
        "Not provided",
    )

    patient_name = _first_non_empty(
        "{} {}".format(patient.get("first_name", "").strip(), patient.get("last_name", "").strip()).strip(),
        patient.get("full_name"),
        patient.get("name"),
        structured.get("patient_name"),
        "Not found",
    )
    patient_name = _clean_str(patient_name)

    patient_phone = _first_non_empty(
        patient.get("phone_home"),
        patient.get("phone"),
        patient.get("phone_number"),
        _find_patient_phone_from_text(text) or "",
        "Not provided",
    )
    patient_phone = _clean_str(patient_phone)

    bmi = _first_non_empty(
        patient.get("bmi"),
        clinical.get("bmi"),
        "Not provided",
    )
    bp = _first_non_empty(
        patient.get("blood_pressure"),
        clinical.get("blood_pressure"),
        clinical.get("bp"),
        "Not provided",
    )

    cpt_codes = procedure.get("cpt")
    if isinstance(cpt_codes, (list, tuple, set)):
        cpt_display = ", ".join(str(c) for c in cpt_codes if c)
    else:
        cpt_display = str(cpt_codes or "")

    carrier_display = _collapse_carrier(insurance.get("carrier")) or insurance.get("carrier")
    plan = (insurance.get("plan") or "").strip()
    insurance_display = f"{carrier_display} ({plan})" if carrier_display and plan else (carrier_display or plan or "")
    physician_name_display = _collapse_physician(physician.get("name")) or physician.get("name")
    physician_practice_display = _collapse_physician(physician.get("practice")) or physician.get("practice")
    verified_val = insurance.get("insurance_verified")
    if isinstance(verified_val, bool):
        verified_str = "Yes" if verified_val else "No"
    else:
        verified_str = verified_val or "Unknown"

    context = {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "confidence_label": html.escape(confidence_label),
        "confidence_score": html.escape(confidence_score_str),
        "patient_name": html.escape(patient_name),
        "patient_dob": _safe(patient.get("dob")),
        "patient_mrn": _safe(patient.get("mrn")),
        "patient_phone": html.escape(patient_phone),
        "patient_bmi": html.escape(bmi),
        "patient_bp": html.escape(bp),
        "insurance_carrier": _safe(insurance_display),
        "insurance_member_id": _safe(insurance.get("member_id")),
        "insurance_group": html.escape(_clean_group(insurance.get("group"))),
        "insurance_authorization": _safe(insurance.get("authorization_number"), "None"),
        "insurance_verified": html.escape(str(verified_str)),
        "physician_name": _safe(physician_name_display),
        "physician_npi": _safe(physician.get("npi")),
        "physician_phone": _safe(physician.get("clinic_phone") or physician.get("phone")),
        "physician_fax": _safe(physician.get("fax")),
        "procedure_cpt": _safe(cpt_display, "Not provided"),
        "procedure_description": _safe(
            procedure.get("description_text")
            or procedure.get("description")
            or procedure.get("study_requested")
            or procedure.get("study"),
            "No description detected",
        ),
        "procedure_indication": _safe(
            procedure.get("indication") or clinical.get("primary_diagnosis") or structured.get("primary_diagnosis"),
            "Not specified",
        ),
        "clinical_diagnosis": _safe(
            clinical.get("primary_diagnosis") or structured.get("diagnosis") or "Not specified"
        ),
        "clinical_symptoms": _format_list(clinical.get("symptoms") or [], "Not documented"),
        "physician_practice": _safe(physician_practice_display),
        "insurance_secondary_carrier": _safe(_collapse_carrier((structured.get("insurance") or {}).get("secondary", {}).get("carrier")), "Not found"),
        "insurance_secondary_member_id": _safe((structured.get("insurance") or {}).get("secondary", {}).get("member_id"), "Not found"),
        "insurance_secondary_group": _safe((structured.get("insurance") or {}).get("secondary", {}).get("group"), "Not found"),
        "flags": _format_list(flags, "No flags applied"),
        "actions": _format_list(actions, "No follow-up actions"),
        "document_date": html.escape(document_date),
        "intake_date": html.escape(intake_date),
        "raw_text": html.escape(text.strip() or "No OCR text provided").replace("\n", "\n"),
    }
    return context


def render_template(template: str, context: Dict[str, str]) -> str:
    pattern = re.compile(r"{{\s*([\w\.]+)\s*}}")

    def lookup(match: re.Match[str]) -> str:
        key = match.group(1)
        if key in context:
            return context[key]
        # support dotted keys if needed
        parts = key.split('.')
        value: Any = context
        for part in parts:
            if isinstance(value, dict) and part in value:
                value = value[part]
            else:
                value = ""
                break
        return str(value)

    return pattern.sub(lookup, template)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Fill MEDOCR template")
    parser.add_argument("ocr_text_file")
    parser.add_argument("output_file")
    parser.add_argument("analysis_json", nargs="?")
    args = parser.parse_args(argv)

    text_path = Path(args.ocr_text_file)
    output_path = Path(args.output_file)
    analysis_path = Path(args.analysis_json) if args.analysis_json else _autodiscover_analysis_path(text_path)

    text = load_text(text_path)
    analysis = load_json(analysis_path)

    try:
        structured = build_structured(text, analysis)
        context = build_context(structured, text, analysis)

        template_path = Path(__file__).with_name("template.txt")
        if template_path.exists():
            template_str = template_path.read_text(encoding="utf-8", errors="ignore")
            if not template_str.strip():
                template_str = DEFAULT_TEMPLATE
        else:
            template_str = DEFAULT_TEMPLATE

        rendered = render_template(template_str, context)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(rendered, encoding="utf-8")
        return 0
    except Exception as exc:  # pragma: no cover - best effort fallback
        fallback = (
            "Template generation failed: {}\n\n=== OCR TEXT ===\n{}".format(exc, text)
        )
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(fallback, encoding="utf-8")
        return 0


if __name__ == "__main__":
    sys.exit(main())
