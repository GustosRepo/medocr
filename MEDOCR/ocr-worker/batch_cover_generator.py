#!/usr/bin/env python3
"""
Generate a batch cover sheet HTML matching the client's checklist-oriented spec.
"""
from typing import List, Dict
from datetime import datetime
import html
import json, os

# --- resolve the structured record regardless of wrapper shape ---
from typing import Any

def _resolve_struct(item: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(item, dict):
        return {}
    # Peel common batch wrappers (defensive; upstream should pass the item dict already)
    if isinstance(item.get('result'), dict):
        item = item['result']
    # Preferred keys in order
    for key in ('enhanced_data', 'normalized', 'normalised', 'extracted_data'):
        val = item.get(key)
        if isinstance(val, dict):
            return val
    return item

# --- helpers to load insurance plan notes ---
def _load_json(path: str):
    try:
        with open(path, 'r') as f:
            return json.load(f)
    except Exception:
        return None

_INS_PATH = os.path.join(os.path.dirname(__file__), 'config', 'rules', 'insurance.json')
_INS_CACHE = _load_json(_INS_PATH) or {}
_PLAN_NOTES = _INS_CACHE.get('planNotes', {})


def _auth_notes_for(carrier: str):
    if not carrier:
        return []
    if carrier in _PLAN_NOTES:
        return _PLAN_NOTES[carrier]
    lc = carrier.lower()
    for k, v in _PLAN_NOTES.items():
        if k.lower() == lc:
            return v
    return []

ACTION_KEYWORDS = {
    'ins_verify': ['Insurance verification', 'Verify insurance'],
    'auth': ['Submit prior auth', 'Authorization required', 'Precert required'],
    'uts': ['Out of network — fax UTS', 'UTS referral', 'OON'],
    'provider_followup': ['Request chart notes', 'Call provider for demographics', 'Provider follow-up'],
    'patient_contact': ['Contact patient', 'Patient contact', 'Call patient'],
    'self_pay': ['Self-pay workflow'],
    'sunset': ['Plan sunset approaching', 'Sunset warning'],
    'manual_review': ['Manual review required']
}

def _fmt_patient_line(d: Dict) -> str:
    s = _resolve_struct(d)
    p = s.get('patient', {}) if isinstance(s.get('patient'), dict) else {}
    ins_all = s.get('insurance', {}) if isinstance(s.get('insurance'), dict) else {}
    ins = ins_all.get('primary', {}) if isinstance(ins_all.get('primary'), dict) else ins_all

    last = (
        p.get('last_name') or p.get('lastname') or p.get('family_name') or p.get('last') or p.get('family')
        or (p.get('full_name') or p.get('name') or '').split(',')[0].strip() if (p.get('full_name') or p.get('name')) else ''
        or 'Unknown'
    )
    first = (
        p.get('first_name') or p.get('firstname') or p.get('given_name') or p.get('first') or p.get('given')
        or (p.get('full_name') or p.get('name') or '').split(',')[1].strip() if (p.get('full_name') or p.get('name')) and ',' in (p.get('full_name') or p.get('name')) else ''
        or 'Unknown'
    )
    dob = p.get('dob') or 'Unknown'

    carrier = (
        ins.get('carrier') or ins.get('carrier_name') or ins.get('plan') or ins.get('payer') or 'Unknown'
    )
    member = (
        ins.get('member_id') or ins.get('subscriber_id') or ins.get('policy_id') or 'Unknown'
    )

    return f"{html.escape(str(last))}, {html.escape(str(first))} | DOB: {html.escape(str(dob))} | Insurance: {html.escape(str(carrier))} | ID: {html.escape(str(member))}"

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
        s = _resolve_struct(item)
        status = item.get('status') or s.get('status') or 'unknown'
        actions = item.get('actions') or []
        qc = item.get('qc_results', {})
        addl_text = 'None'
        issues = []
        if actions:
            issues.extend(actions)
        if qc:
            issues.extend(qc.get('errors', []) + qc.get('warnings', []))
        flags = item.get('flags', []) or []
        if flags:
            issues.extend(flags)
        if issues:
            addl_text = '; '.join(sorted(set(issues)))

        # Tally forms by actions
        counts = _classify_counts(actions)
        for k, v in counts.items():
            form_counts[k] += v

        # Ready status: consider both provided status and blocking flags
        blocking = {'MANUAL_REVIEW_REQUIRED','MISSING_CHART_NOTES','INSURANCE_NOT_ACCEPTED','SELF_PAY_WORKFLOW','INSURANCE_SUNSET_WARNING'}
        explicit_ready = bool(item.get('ready_to_schedule')) if 'ready_to_schedule' in item else None
        is_ready = (explicit_ready if explicit_ready is not None else (status == 'ready_to_schedule')) and not (set(flags) & blocking)
        if is_ready:
            total_ready += 1

        # Authorization notes from planNotes
        ins_all = s.get('insurance', {}) if isinstance(s.get('insurance'), dict) else {}
        ins_p = ins_all.get('primary', {}) if isinstance(ins_all.get('primary'), dict) else ins_all
        carrier = (ins_p.get('carrier') or ins_p.get('carrier_name') or ins_p.get('plan') or ins_p.get('payer') or '')
        notes = _auth_notes_for(carrier)

        notes_html = ""
        if notes:
            safe = '; '.join([html.escape(str(n)) for n in notes])
            notes_html = f"\n  <div style='padding-left:18px'><i>Authorization Notes:</i> {safe}</div>\n"

        lines_html.append(
            f"<div>\n"
            f"  <div>□ {_fmt_patient_line(item)}</div>\n"
            f"  <div style='padding-left:18px'>Additional Actions Required: {html.escape(addl_text)}</div>" +
            notes_html +
            f"</div>"
        )

    total_docs = len(individuals)
    total_actions = total_docs - total_ready
    intake_disp = intake_date or datetime.today().strftime('%m/%d/%Y')

    forms_html = (
        f"<div>□ Insurance verification forms: {form_counts['ins_verify']}</div>\n"
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
