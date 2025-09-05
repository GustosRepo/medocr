#!/usr/bin/env python3
"""Generate a synthetic referral form image (or PDF) from structured JSON-like data.

Usage:
  python generate_referral_image.py --out test_referral.png
  python generate_referral_image.py --out test_referral.pdf --pdf

Dependencies: pillow, reportlab (for PDF). Image generation uses Pillow drawing.
"""
import argparse
import json
from datetime import datetime
from pathlib import Path
from typing import Dict, Any

from PIL import Image, ImageDraw, ImageFont

FAKE_DATA: Dict[str, Any] = {
    "referral_date": "2025-08-28",
    "referral_id": "REF-2025-0828-0012",
    "patient": {
        "name": "Alex Rivers",
        "dob": "03/14/1978",
        "age": 47,
        "sex": "M",
        "mrn": "MRN-784210",
        "phone": "(555) 312-8890"
    },
    "vitals": {"height": "5'10\"", "weight": "212 lbs", "bmi": 30.4, "blood_pressure": "132/84", "neck_circumference_in": 17.5, "mallampati_score": "III"},
    "insurance": {"primary": {"carrier": "Prominence Health", "member_id": "PHX9022331", "group_id": "GRP4451A", "plan_type": "PPO"}},
    "physician": {"referring": {"name": "Dr. Sarah Thompson, MD", "specialty": "Primary Care", "npi": "1992456789"}},
    "procedure": {"study_type": "In-Lab Polysomnography", "cpt_codes": ["95810"], "priority": "routine", "authorization_required": True, "authorization_number": "AUTH-77821Q"},
    "clinical": {"chief_complaint": "Excessive daytime sleepiness, loud snoring, witnessed apneas", "epworth_score": 16, "symptoms": ["loud snoring", "witnessed apneas", "morning headaches"], "primary_diagnosis": "Suspected Obstructive Sleep Apnea"}
}

# Basic fallback font
try:
    DEFAULT_FONT = ImageFont.truetype("Arial.ttf", 18)
except Exception:
    DEFAULT_FONT = ImageFont.load_default()

def layout_lines(data: Dict[str, Any]) -> list:
    lines = []
    lines.append("SLEEP MEDICINE REFERRAL FORM")
    lines.append("")
    lines.append(f"Referral Date: {data['referral_date']}    Referral ID: {data['referral_id']}")
    p = data['patient']
    lines.append(f"Patient: {p['name']}    DOB: {p['dob']}  Age: {p['age']}  Sex: {p['sex']}  MRN: {p['mrn']}")
    lines.append(f"Phone: {p['phone']}")
    v = data['vitals']
    lines.append(f"Vitals: Ht {v['height']}  Wt {v['weight']}  BMI {v['bmi']}  BP {v['blood_pressure']}  Neck {v['neck_circumference_in']} in  Mallampati {v['mallampati_score']}")
    ins = data['insurance']['primary']
    lines.append(f"Insurance: {ins['carrier']}  Member: {ins['member_id']}  Group: {ins['group_id']}  Plan: {ins['plan_type']}")
    ref = data['physician']['referring']
    lines.append(f"Referring Provider: {ref['name']}  Specialty: {ref['specialty']}  NPI: {ref['npi']}")
    proc = data['procedure']
    auth = f" Auth#: {proc['authorization_number']}" if proc.get('authorization_required') else ""
    lines.append(f"Study Requested: {proc['study_type']}  CPT: {', '.join(proc['cpt_codes'])}  Priority: {proc['priority']}{auth}")
    clin = data['clinical']
    lines.append(f"Chief Complaint: {clin['chief_complaint']}")
    lines.append(f"Symptoms: {', '.join(clin['symptoms'])}")
    lines.append(f"Epworth Score: {clin['epworth_score']}  Primary Dx: {clin['primary_diagnosis']}")
    lines.append("")
    lines.append("Ref Provider Signature: ______________________    Date: __________")
    lines.append("Patient Signature (if needed): ________________  Date: __________")
    return lines

def render_image(data: Dict[str, Any], out_path: Path, page_width=1700, margin=60):
    lines = layout_lines(data)
    # Estimate height
    line_height = 30
    page_height = margin * 2 + line_height * (len(lines) + 2)
    img = Image.new("RGB", (page_width, page_height), "white")
    draw = ImageDraw.Draw(img)

    # Header rectangle
    draw.rectangle([margin - 10, margin - 10, page_width - margin + 10, margin + 70], outline="black", width=2)
    y = margin
    for idx, line in enumerate(lines):
        draw.text((margin, y), line, fill="black", font=DEFAULT_FONT)
        y += line_height
        if idx == 0:  # underline title
            draw.line([margin, y - 5, page_width - margin, y - 5], fill="black", width=2)
    img.save(out_path)
    return out_path


def main():
    parser = argparse.ArgumentParser(description="Generate synthetic referral form image from sample data JSON")
    parser.add_argument('--data-json', help='Path to JSON file with referral data (overrides default)')
    parser.add_argument('--out', required=True, help='Output image or pdf path (.png/.jpg/.pdf)')
    args = parser.parse_args()

    data = FAKE_DATA
    if args.data_json:
        with open(args.data_json, 'r') as f:
            data = json.load(f)

    out_path = Path(args.out)
    if out_path.suffix.lower() == '.pdf':
        try:
            from reportlab.lib.pagesizes import letter
            from reportlab.pdfgen import canvas
        except ImportError:
            raise SystemExit('reportlab not installed (check requirements).')
        lines = layout_lines(data)
        c = canvas.Canvas(str(out_path), pagesize=letter)
        width, height = letter
        x = 50
        y = height - 50
        c.setFont('Helvetica-Bold', 16)
        c.drawString(x, y, lines[0])
        y -= 25
        c.setFont('Helvetica', 10)
        for line in lines[1:]:
            if y < 60:
                c.showPage(); y = height - 50; c.setFont('Helvetica', 10)
            c.drawString(x, y, line)
            y -= 16
        c.showPage()
        c.save()
        print(f"Generated PDF referral: {out_path}")
    else:
        render_image(data, out_path)
        print(f"Generated image referral: {out_path}")

if __name__ == '__main__':
    main()
