#!/usr/bin/env python3
"""
Generate a batch cover sheet HTML matching the client's checklist-oriented spec.
"""
from typing import List, Dict
from datetime import datetime
import html

ACTION_KEYWORDS = {
    'auth': ['Submit prior auth', 'Authorization required'],
    'uts': ['Out of network — fax UTS', 'UTS referral'],
    'provider_followup': ['Request chart notes', 'Call provider for demographics', 'Provider follow-up'],
    'patient_contact': ['Contact patient', 'Patient contact']
}

def _fmt_patient_line(d: Dict) -> str:
    p = d.get('extracted_data', {}).get('patient', {}) if 'extracted_data' in d else d.get('patient', {})
    ins = d.get('extracted_data', {}).get('insurance', {}).get('primary', {}) if 'extracted_data' in d else d.get('insurance', {}).get('primary', {})
    last = p.get('last_name') or 'Unknown'
    first = p.get('first_name') or 'Unknown'
    dob = p.get('dob') or 'Unknown'
    carrier = ins.get('carrier') or 'Unknown'
    member = ins.get('member_id') or 'Unknown'
    return f"{html.escape(last)}, {html.escape(first)} | DOB: {html.escape(dob)} | Insurance: {html.escape(carrier)} | ID: {html.escape(member)}"

def _classify_counts(actions: List[str]) -> Dict[str, int]:
    counts = {k: 0 for k in ACTION_KEYWORDS}
    for a in actions or []:
        for key, phrases in ACTION_KEYWORDS.items():
            if any(phrase.lower() in a.lower() for phrase in phrases):
                counts[key] += 1
    return counts

def render_cover_sheet(individuals: List[Dict], intake_date: str) -> Dict[str, str]:
    # Build checklist lines and collect counts for forms
    lines_html = []
    form_counts = {k: 0 for k in ACTION_KEYWORDS}
    total_ready = 0
    for item in individuals:
        status = item.get('status') or 'unknown'
        actions = item.get('actions') or []
        qc = item.get('qc_results', {})
        addl_text = 'None'
        issues = []
        if actions:
            issues.extend(actions)
        if qc:
            issues.extend(qc.get('errors', []) + qc.get('warnings', []))
        if issues:
            addl_text = '; '.join(sorted(set(issues)))
        counts = _classify_counts(actions)
        for k, v in counts.items():
            form_counts[k] += v
        if status == 'ready_to_schedule':
            total_ready += 1
        lines_html.append(
            f"<div>\n"
            f"  <div>□ {_fmt_patient_line(item)}</div>\n"
            f"  <div style='padding-left:18px'>Additional Actions Required: {html.escape(addl_text)}</div>\n"
            f"</div>"
        )

    total_docs = len(individuals)
    total_actions = total_docs - total_ready
    intake_disp = intake_date or datetime.today().strftime('%m/%d/%Y')

    forms_html = (
        f"<div>□ Insurance verification forms: {form_counts['auth']}</div>\n"
        f"<div>□ Authorization request forms: {form_counts['auth']}</div>\n"
        f"<div>□ UTS referral forms: {form_counts['uts']}</div>\n"
        f"<div>□ Provider follow-up requests: {form_counts['provider_followup']}</div>\n"
        f"<div>□ Patient contact forms: {form_counts['patient_contact']}</div>\n"
    )

    html_out = f"""
<div>
  <h2>REFERRAL PROCESSING SUMMARY - INTAKE DATE: {html.escape(intake_disp)}</h2>
  <div style="margin:6px 0 12px">
    <div><b>TOTAL REFERRALS PROCESSED:</b> {total_docs}</div>
    <div><b>READY TO SCHEDULE:</b> {total_ready}</div>
    <div><b>ADDITIONAL ACTIONS REQUIRED:</b> {total_actions}</div>
  </div>
  <div style="margin:8px 0">{''.join(lines_html)}</div>
  <div style="margin-top:12px">
    <h3>FORMS GENERATED:</h3>
    {forms_html}
  </div>
</div>
"""
    return { 'html': html_out }

