# export/patient_pdf.py
import os, json
from typing import Dict, Any, List, Optional

# ---- PDF backend (ReportLab) ----
try:
    from reportlab.lib.pagesizes import LETTER
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import inch
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.lib import colors
    _PDF_BACKEND = "reportlab"
except Exception:
    _PDF_BACKEND = None

# --------- helpers ----------
def _get(obj: Dict[str, Any], path: str, default=None):
    cur = obj
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return default
        cur = cur[part]
    return cur

def load_json(path: str) -> Optional[Dict[str, Any]]:
    try:
        with open(path, "r") as f:
            return json.load(f)
    except Exception:
        return None

def derive_authorization_notes(insurance_cfg: Dict[str, Any], carrier: str) -> List[str]:
    if not insurance_cfg or not carrier:
        return []
    notes = insurance_cfg.get("planNotes", {})
    # normalize keys loosely
    # try exact, then casefold matches
    if carrier in notes:
        return notes[carrier]
    for k, v in notes.items():
        if k.lower() == carrier.lower():
            return v
    return []

def _kv_row(label: str, value: str) -> List[str]:
    v = "" if value is None else str(value)
    return [label, v]

def _safe_join(values: List[str], sep=", "):
    return sep.join([v for v in values if v])

# ---------- schema-driven normalization ----------
def normalize_with_schema(form: Dict[str, Any], schema_path: str) -> Dict[str, Any]:
    """Best-effort normalization using your patient_form.schema.json (optional)."""
    schema = load_json(schema_path) or {}
    # For now, we won’t hard-validate—just ensure keys exist so PDF never explodes.
    # You can plug in jsonschema.validate(form, schema) later if you want strict checks.
    form.setdefault("patient", {})
    form.setdefault("insurance", {}).setdefault("primary", {})
    form.setdefault("physician", {})
    form.setdefault("procedure", {})
    form.setdefault("clinical", {})
    form.setdefault("flags", [])
    form.setdefault("actions", [])
    form.setdefault("confidence_label", form.get("confidence") or "Medium")
    return form

# ------------- main renderer -------------
def render_patient_pdf(
    form: Dict[str, Any],
    out_path: str,
    schema_path: str = "config/patient_form.schema.json",
    insurance_cfg_path: str = "config/rules/insurance.json"
) -> str:
    """
    Creates the Individual Patient PDF per your OUTPUT REQUIREMENTS.
    Returns the output file path.
    """
    if not _PDF_BACKEND:
        raise RuntimeError("reportlab not available. Install reportlab or switch to your alternate PDF engine.")

    form = normalize_with_schema(form, schema_path)
    insurance_cfg = load_json(insurance_cfg_path) or {}

    # Pull top-line fields
    p_name   = _get(form, "patient.name", "")
    p_dob    = _get(form, "patient.dob", "")
    in_date  = form.get("intake_date") or _get(form, "referral.date", "")
    cpt_list = _get(form, "procedure.cpt", []) or []
    cpt_code = cpt_list[0] if isinstance(cpt_list, list) and cpt_list else (cpt_list if isinstance(cpt_list, str) else "")
    doc_date = form.get("document_date", "")

    carrier  = _get(form, "insurance.primary.carrier", "")
    member   = _get(form, "insurance.primary.member_id", "")
    group    = _get(form, "insurance.primary.group", "") or _get(form, "insurance.primary.group_id", "")

    provider = _get(form, "physician.name", "")
    practice = _get(form, "physician.practice", "")
    npi      = _get(form, "physician.npi", "")

    primary_dx = _get(form, "clinical.primary_diagnosis", "")
    icd_codes  = _get(form, "clinical.icd10_codes", []) or []
    symptoms   = _get(form, "clinical.symptoms", []) or []

    flags      = form.get("flags", [])
    actions    = form.get("actions", [])
    confidence = form.get("confidence_label") or form.get("confidence")

    # Authorization notes from insurance.json.planNotes
    auth_notes = derive_authorization_notes(insurance_cfg, carrier)

    # ---- Build PDF ----
    doc = SimpleDocTemplate(out_path, pagesize=LETTER, leftMargin=48, rightMargin=48, topMargin=48, bottomMargin=48)
    styles = getSampleStyleSheet()
    elems = []

    # Title line: PATIENT + DOB + REFERRAL DATE
    title = f"PATIENT: {p_name or '[Unknown]'}  |  DOB: {p_dob or '[Unknown]'}  |  REFERRAL DATE: {doc_date or in_date or '[Unknown]'}"
    elems.append(Paragraph(title, styles["Heading2"]))
    elems.append(Spacer(1, 0.2*inch))

    # DEMOGRAPHICS
    demo_tbl = [
        _kv_row("Phone", _get(form, "patient.phone_home", _get(form, "patient.phone", ""))),
        _kv_row("Email", _get(form, "patient.email", "")),
        _kv_row("Emergency Contact", _get(form, "patient.emergency_contact", "")),
    ]
    elems.append(Paragraph("DEMOGRAPHICS", styles["Heading4"]))
    elems.append(Table(demo_tbl, colWidths=[1.8*inch, 4.7*inch], style=TableStyle([("GRID",(0,0),(-1,-1),0.25,colors.grey)])))
    elems.append(Spacer(1, 0.15*inch))

    # INSURANCE
    ins_tbl = [
        _kv_row("Primary", carrier),
        _kv_row("ID", member),
        _kv_row("Group", group),
    ]
    elems.append(Paragraph("INSURANCE", styles["Heading4"]))
    elems.append(Table(ins_tbl, colWidths=[1.8*inch, 4.7*inch], style=TableStyle([("GRID",(0,0),(-1,-1),0.25,colors.grey)])))
    elems.append(Spacer(1, 0.15*inch))

    # PROCEDURE ORDERED
    proc_tbl = [
        _kv_row("CPT Code", cpt_code),
        _kv_row("Description", _get(form, "procedure.description", "")),
        _kv_row("Study", _get(form, "procedure.study_requested", _get(form, "procedure.study_type", ""))),
        _kv_row("Provider Notes", _get(form, "procedure.indication", "")),
    ]
    elems.append(Paragraph("PROCEDURE ORDERED", styles["Heading4"]))
    elems.append(Table(proc_tbl, colWidths=[1.8*inch, 4.7*inch], style=TableStyle([("GRID",(0,0),(-1,-1),0.25,colors.grey)])))
    elems.append(Spacer(1, 0.15*inch))

    # REFERRING PHYSICIAN
    phy_tbl = [
        _kv_row("Name", provider),
        _kv_row("NPI", npi),
        _kv_row("Practice", practice),
        _kv_row("Phone/Fax", _safe_join([_get(form, "physician.clinic_phone", ""), _get(form, "physician.fax", "")]))
    ]
    elems.append(Paragraph("REFERRING PHYSICIAN", styles["Heading4"]))
    elems.append(Table(phy_tbl, colWidths=[1.8*inch, 4.7*inch], style=TableStyle([("GRID",(0,0),(-1,-1),0.25,colors.grey)])))
    elems.append(Spacer(1, 0.15*inch))

    # CLINICAL INFORMATION
    icd_str = ", ".join([f"{c.get('code','')} {c.get('label','')}".strip() for c in icd_codes if isinstance(c, dict)])
    clin_tbl = [
        _kv_row("Primary Diagnosis", primary_dx or ""),
        _kv_row("ICD-10 (Supporting)", icd_str),
        _kv_row("Symptoms Present", ", ".join(symptoms)),
        _kv_row("BMI / BP", _safe_join([str(_get(form,"patient.bmi","")), _get(form,"patient.blood_pressure","")], sep=" | ")),
    ]
    elems.append(Paragraph("CLINICAL INFORMATION", styles["Heading4"]))
    elems.append(Table(clin_tbl, colWidths=[1.8*inch, 4.7*inch], style=TableStyle([("GRID",(0,0),(-1,-1),0.25,colors.grey)])))
    elems.append(Spacer(1, 0.15*inch))

    # INFORMATION ALERTS (from flags/actions that imply PPE/safety/etc. if you collect them)
    # For now show flags plainly; you can split PPE/Safety/Comms if you tag flags.
    elems.append(Paragraph("INFORMATION ALERTS", styles["Heading4"]))
    elems.append(Paragraph(", ".join(flags) or "None", styles["BodyText"]))
    elems.append(Spacer(1, 0.15*inch))

    # AUTHORIZATION NOTES (planNotes)
    elems.append(Paragraph("AUTHORIZATION NOTES", styles["Heading4"]))
    if auth_notes:
        for n in auth_notes:
            elems.append(Paragraph(f"• {n}", styles["BodyText"]))
    else:
        elems.append(Paragraph("None", styles["BodyText"]))
    elems.append(Spacer(1, 0.15*inch))

    # CONFIDENCE
    conf_tbl = [
        _kv_row("Confidence", confidence or "Medium"),
        _kv_row("OCR %", str(_get(form, "confidence_detail.score", _get(form, "confidence_scores.ocr_confidence", "")))),
        _kv_row("Reasons", ", ".join(_get(form, "confidence_detail.reasons", [])))
    ]
    elems.append(Paragraph("CONFIDENCE", styles["Heading4"]))
    elems.append(Table(conf_tbl, colWidths=[1.8*inch, 4.7*inch], style=TableStyle([("GRID",(0,0),(-1,-1),0.25,colors.grey)])))

    doc.build(elems)
    return out_path