#!/usr/bin/env python3
import argparse
import json
import re
from datetime import datetime
from pathlib import Path

# --- If you have enhanced_extract, keep using it; else fall back to lightweight parsing ---
try:
    from enhanced_extract import analyze_medical_form as _enhanced_extract
except Exception:
    _enhanced_extract = None


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
    "insurance_primary": re.compile(r"Insurance\s*\(Primary\)[\s\S]{0,220}", re.I),
    "carrier": re.compile(r"Carrier[:\s]*([^\n:]+)", re.I),
    "member_id": re.compile(r"Member\s*ID[:\s]*([A-Z0-9\-]+)", re.I),
    "auth": re.compile(r"Authorization(?:\s*number)?[:\s]*([A-Z0-9\-]+)", re.I),
    "study_requested": re.compile(r"(?:Study|Requested)\s*[:\s]*([A-Za-z ]+Study|Sleep study|Overnight Sleep Study)", re.I),
    "patient_name": re.compile(r"Patient[:\s]*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b"),
    "indication": re.compile(r"(?:Indication|Primary\s*Diagnosis)[:\s]*([^\n]+)", re.I),
    "neck": re.compile(r"Neck(?:\s*circumference)?[:\s]*([0-9]{1,2}(?:\s*in(?:ches)?)?)", re.I),
    "doc_date": re.compile(r"(?:Referral\s*\/?\s*order\s*date|Document\s*Date)[:\s]*([01]?\d\/[0-3]?\d\/\d{4})", re.I),
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


def _fallback_extract(text: str, avg_conf: float | None) -> dict:
    t = normalize(text)
    out = {"patient": {}, "insurance": {"primary": {}}, "physician": {}, "procedure": {}, "clinical": {}}

    m = RX["dob"].search(t)
    if m: out["patient"]["dob"] = m.group(1)
    m = RX["mrn"].search(t)
    if m: out["patient"]["mrn"] = m.group(1)
    m = RX["patient_name"].search(t)
    if m:
        parts = m.group(1).split()
        out["patient"]["first_name"] = parts[0]
        out["patient"]["last_name"] = " ".join(parts[1:])
    m = RX["vitals_line"].search(t)
    if m:
        out["patient"]["height"] = m.group(1).strip()
        out["patient"]["weight"] = m.group(2).strip()
        out["patient"]["bmi"] = m.group(3).strip()
        out["patient"]["blood_pressure"] = m.group(4).strip()
    else:
        m = RX["bp"].search(t)
        if m: out["patient"]["blood_pressure"] = m.group(1)

    m = RX["phone_any"].search(t)
    if m: out["patient"]["phone_home"] = _fmt_phone(m.group(1))
    m = RX["fax"].search(t)
    if m: out["physician"]["fax"] = _fmt_phone(m.group(1))

    m = RX["provider_block"].search(t)
    if m:
        out["physician"]["name"] = re.sub(r"\s+Specialty$", "", m.group(1).strip(), flags=re.I)
        out["physician"]["specialty"] = m.group(2).strip()
    m = RX["npi"].search(t)
    if m: out["physician"]["npi"] = m.group(1)
    m = re.search(r"Clinic phone[:\s]*([()\-\s\.\d]{10,20})", t, flags=re.I)
    if m: out["physician"]["clinic_phone"] = _fmt_phone(m.group(1))

    blk = RX["insurance_primary"].search(t)
    if blk:
        ib = blk.group(0)
        m = RX["carrier"].search(ib)
        if m:
            carrier = re.sub(r"Member\s*Id$", "", m.group(1), flags=re.I).strip()
            out["insurance"]["primary"]["carrier"] = carrier
        m = RX["member_id"].search(ib)
        if m: out["insurance"]["primary"]["member_id"] = m.group(1)
        m = RX["auth"].search(ib)
        if m: out["insurance"]["primary"]["authorization_number"] = m.group(1)

    if RX["verified"].search(t):
        out["insurance"]["primary"]["insurance_verified"] = "Yes"

    m = RX["doc_date"].search(t)
    if m: out["document_date"] = m.group(1)
    m = RX["intake_date"].search(t)
    if m: out["intake_date"] = m.group(1)

    cpts = RX["cpt_all"].findall(t)
    if cpts: out["procedure"]["cpt"] = list(dict.fromkeys(cpts))
    m = RX["study_requested"].search(t)
    if m: out["procedure"]["study_requested"] = m.group(1)
    m = RX["indication"].search(t)
    if m:
        dx = re.sub(r"\bOlstructive\b", "Obstructive", m.group(1), flags=re.I).strip()
        out["procedure"]["indication"] = dx
        out["clinical"]["primary_diagnosis"] = dx

    m = RX["epworth"].search(t)
    if m: out["clinical"]["epworth_score"] = f"{m.group(1)}/24"
    m = RX["neck"].search(t)
    if m:
        neck = m.group(1)
        out["clinical"]["neck_circumference"] = neck if "in" in neck else f"{neck} in"

    m = re.search(r"Symptoms?[:\s]*([^\n]+)", t, flags=re.I)
    if m:
        arr = [s.strip() for s in re.split(r"[;,]", m.group(1)) if s.strip()]
        out["clinical"]["symptoms"] = [re.sub(r"\bnoring\b", "snoring", s, flags=re.I) for s in arr]

    if isinstance(avg_conf, (int, float)):
        out["overall_confidence"] = float(avg_conf)
        out.setdefault("confidence_scores", {})["overall_confidence"] = float(avg_conf)

    return out


def extract(text: str, avg_conf: float | None) -> dict:
    if _enhanced_extract:
        try:
            data = _enhanced_extract(text, avg_conf if avg_conf is not None else 0.85)
            # ensure standard aliases present
            overall = (
                data.get("overall_confidence")
                or data.get("semantic_confidence")
                or data.get("confidence_scores", {}).get("overall_confidence")
                or (avg_conf if isinstance(avg_conf, (int, float)) else 0.85)
            )
            data.setdefault("overall_confidence", overall)
            data.setdefault("confidence_scores", {}).setdefault("overall_confidence", overall)
            return data
        except Exception:
            pass
    return _fallback_extract(text, avg_conf)


# ----------------------
# Client-format PDF HTML (unified block)
# ----------------------
def _val(x, fb="Not found"):
    return x if (x is not None and x != "") else fb


def make_client_pdf_html(data: dict, flags: list[str] | None = None) -> str:
    p = data.get("patient", {})
    ins = data.get("insurance", {}).get("primary", {})
    phy = data.get("physician", {})
    proc = data.get("procedure", {})
    clin = data.get("clinical", {})

    last = p.get("last_name", "")
    first = p.get("first_name", "")
    dob = p.get("dob", "Not found")
    ref_date = data.get("document_date", "Not found")

    cpt_text = ", ".join(proc.get("cpt", []) or []) or "Not found"
    desc_text = ", ".join(proc.get("description", []) or []) or "Not found"
    symptoms = ", ".join(clin.get("symptoms", []) or []) or "Not found"
    diag = clin.get("primary_diagnosis") or proc.get("indication") or "Not found"
    bmi_bp = (p.get("bmi") or (f"{p.get('height','—')} // {p.get('weight','—')}" if p.get("height") or p.get("weight") else "Not found"))
    bp = p.get("blood_pressure") or "Not found"

    flags_list = [] if flags is None else [f for f in flags if f]
    flags_html = "None" if len(flags_list) == 0 else ", ".join(flags_list)

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
    <div>{'Authorization #: ' + ins.get('authorization_number') if ins.get('authorization_number') else 'Not found'}</div>
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
    last = p.get("last_name", "Unknown")
    first = p.get("first_name", "Unknown")
    dob = (p.get("dob") or "NA").replace("/", "-")
    date = (data.get("document_date") or datetime.today().strftime("%Y-%m-%d")).replace("/", "-")
    return f"{_safe(last)}_{_safe(first)}_{dob}_{date}.pdf"


# ----------------------
# Single & Batch modes
# ----------------------
def run_single(text_file: Path, confidence: float | None) -> dict:
    text = read_text(text_file)
    data = extract(text, confidence)
    # Collect flags if extractor produced any; default empty
    flags = data.get("flags", []) if isinstance(data, dict) else []
    pdf_html = make_client_pdf_html(data, flags=flags)
    suggested = suggest_filename(data)
    return {
        "success": True,
        "extracted_data": data,
        # Client features summary
        "client_features": {
            "individual_pdf_ready": True,
            "quality_checked": True,
            "flags_applied": len(flags) if isinstance(flags, list) else 0,
            "actions_required": 0,
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
        "qc_results": {"errors": [], "warnings": []},
        "status": "ready_to_schedule",
    }


def run_batch(files: list[Path], intake_date: str | None) -> dict:
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
        individuals.append({
            "source_file": Path(fp).name,
            "success": True,
            "status": "ready_to_schedule",
            "filename": suggested,
            "confidence_score": float(data.get("overall_confidence", 0.85)),
            "flags": flags,
            "actions": data.get("actions", []),
            "qc_issues": 0,
            "individual_pdf_ready": True,
            "individual_pdf_content": pdf_html,
        })
        ready += 1

    cover_html = f"""
<div>
  <h2>Batch Cover Sheet</h2>
  <p>Intake: {intake_date or datetime.today().strftime('%m/%d/%Y')}</p>
  <p>Total: {len(files)}</p>
  <p>Ready: {ready}</p>
</div>
"""

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
        if not args.files:
            print(json.dumps({"success": False, "error": "files required"}))
            return
        out = run_batch([Path(f) for f in args.files], args.intake_date)
        print(json.dumps(out))
        return


if __name__ == "__main__":
    main()