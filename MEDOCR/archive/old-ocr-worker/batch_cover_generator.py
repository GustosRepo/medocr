#!/usr/bin/env python3
"""
Batch Cover Sheet Generator for Sleep Medicine Referrals
Generates batch processing summary according to client specifications
"""

import json
from datetime import datetime
from typing import List, Dict, Any


def generate_batch_cover_sheet(batch_results: List[Dict[str, Any]], intake_date: str = None) -> str:
    """
    Generate batch cover sheet according to client specifications
    
    Args:
        batch_results: List of processed patient forms with flags and actions
        intake_date: Date of intake (defaults to today)
    
    Returns:
        Formatted batch cover sheet as HTML
    """
    
    if not intake_date:
        intake_date = datetime.now().strftime('%m/%d/%Y')
    
    # Count statistics
    total_referrals = len(batch_results)
    ready_to_schedule = len([r for r in batch_results if not r.get('flags', [])])
    additional_actions_required = total_referrals - ready_to_schedule
    
    # Count forms to generate
    form_counts = count_forms_needed(batch_results)
    
    # Generate patient checklist
    patient_checklist = generate_patient_checklist(batch_results)
    
    # Generate HTML content
    html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Referral Processing Summary - {intake_date}</title>
    <style>
        body {{ font-family: Arial, sans-serif; margin: 20px; line-height: 1.6; }}
        .header {{ text-align: center; border-bottom: 3px solid #2c3e50; padding-bottom: 15px; margin-bottom: 25px; }}
        .checklist {{ margin: 20px 0; }}
        .patient-item {{ margin: 8px 0; padding: 8px; border-left: 4px solid #3498db; background-color: #f8f9fa; }}
        .patient-item.action-required {{ border-left-color: #e74c3c; background-color: #ffeaa7; }}
        .patient-item.ready {{ border-left-color: #27ae60; background-color: #d5f4e6; }}
        .patient-name {{ font-weight: bold; color: #2c3e50; }}
        .patient-details {{ color: #7f8c8d; font-size: 0.9em; }}
        .actions {{ margin-top: 5px; color: #e74c3c; font-weight: bold; }}
        .actions.none {{ color: #27ae60; }}
        .section {{ margin: 25px 0; }}
        .section-title {{ font-size: 1.2em; font-weight: bold; color: #2c3e50; border-bottom: 2px solid #bdc3c7; padding-bottom: 5px; }}
        .common-actions {{ background-color: #ecf0f1; padding: 15px; margin: 15px 0; border-radius: 5px; }}
        .forms-section {{ background-color: #e8f6f3; padding: 15px; margin: 15px 0; border-radius: 5px; }}
        .summary-stats {{ background-color: #d5e8d4; padding: 15px; margin: 15px 0; border-radius: 5px; text-align: center; }}
        .stat-item {{ display: inline-block; margin: 0 20px; }}
        .stat-number {{ font-size: 1.5em; font-weight: bold; color: #2c3e50; }}
        .checkbox {{ margin-right: 8px; }}
        .action-list {{ margin-left: 20px; }}
    </style>
</head>
<body>
    <div class="header">
        <h1>REFERRAL PROCESSING SUMMARY - INTAKE DATE: {intake_date}</h1>
    </div>
    
    <div class="section">
        <div class="section-title">PATIENT CHECKLIST:</div>
        <div class="checklist">
            {patient_checklist}
        </div>
    </div>
    
    <div class="section">
        <div class="section-title">COMMON ADDITIONAL ACTIONS:</div>
        <div class="common-actions">
            <div class="action-list">
                <div>• <strong>"No chart notes/insurance verification required"</strong> → Generate insurance verification form</div>
                <div>• <strong>"Insufficient information - sleep questionnaire required, call patient"</strong></div>
                <div>• <strong>"Wrong test ordered - need order for complete sleep study due to no testing in last 5 years"</strong></div>
                <div>• <strong>"Out of network - fax UTS"</strong> → Generate UTS referral form</div>
                <div>• <strong>"Authorization required - submit/fax request"</strong> → Generate authorization form</div>
                <div>• <strong>"Missing demographics - call provider for complete patient information"</strong></div>
                <div>• <strong>"Provider follow-up required - obtain additional clinical documentation"</strong></div>
                <div>• <strong>"Insurance expired/terminated - verify current coverage"</strong></div>
                <div>• <strong>"Pediatric specialist referral required"</strong></div>
                <div>• <strong>"DME evaluation needed before testing"</strong></div>
            </div>
        </div>
    </div>
    
    <div class="section">
        <div class="section-title">FORMS GENERATED:</div>
        <div class="forms-section">
            <div><span class="checkbox">☐</span> Insurance verification forms: <strong>{form_counts['insurance_verification']}</strong></div>
            <div><span class="checkbox">☐</span> Authorization request forms: <strong>{form_counts['authorization_requests']}</strong></div>
            <div><span class="checkbox">☐</span> UTS referral forms: <strong>{form_counts['uts_referrals']}</strong></div>
            <div><span class="checkbox">☐</span> Provider follow-up requests: <strong>{form_counts['provider_followup']}</strong></div>
            <div><span class="checkbox">☐</span> Patient contact forms: <strong>{form_counts['patient_contact']}</strong></div>
        </div>
    </div>
    
    <div class="section">
        <div class="section-title">PROCESSING SUMMARY:</div>
        <div class="summary-stats">
            <div class="stat-item">
                <div class="stat-number">{total_referrals}</div>
                <div>TOTAL REFERRALS PROCESSED</div>
            </div>
            <div class="stat-item">
                <div class="stat-number">{ready_to_schedule}</div>
                <div>READY TO SCHEDULE</div>
            </div>
            <div class="stat-item">
                <div class="stat-number">{additional_actions_required}</div>
                <div>ADDITIONAL ACTIONS REQUIRED</div>
            </div>
        </div>
    </div>
    
    <div style="margin-top: 40px; text-align: center; font-size: 0.9em; color: #7f8c8d;">
        Generated: {datetime.now().strftime('%m/%d/%Y %H:%M')} | 
        Batch ID: {generate_batch_id(intake_date)} | 
        Processing System: Enhanced Sleep OCR v2.0
    </div>
</body>
</html>
    """
    
    return html_content


def generate_patient_checklist(batch_results: List[Dict[str, Any]]) -> str:
    """Generate the patient checklist section"""
    checklist_html = ""
    
    for result in batch_results:
        patient = result.get('patient', {})
        insurance = result.get('insurance', {}).get('primary', {})
        flags = result.get('flags', [])
        actions = result.get('actions', [])
        
        # Format patient name
        last_name = patient.get('last_name', 'UNKNOWN')
        first_name = patient.get('first_name', 'UNKNOWN')
        dob = patient.get('dob', 'Unknown DOB')
        
        # Format insurance
        carrier = insurance.get('carrier', 'Unknown Carrier')
        member_id = insurance.get('member_id', 'Unknown ID')
        
        # Determine additional actions
        additional_actions = format_additional_actions(flags, actions)
        
        # Determine CSS class
        css_class = "ready" if not flags else "action-required"
        
        checklist_html += f"""
        <div class="patient-item {css_class}">
            <div class="checkbox">☐</div>
            <span class="patient-name">{last_name}, {first_name}</span>
            <div class="patient-details">DOB: {dob} | Insurance: {carrier} | ID: {member_id}</div>
            <div class="actions {'none' if not additional_actions else ''}">
                Additional Actions Required: {additional_actions if additional_actions else 'None'}
            </div>
        </div>
        """
    
    return checklist_html


def format_additional_actions(flags: List[str], actions: List[str]) -> str:
    """Format additional actions based on flags and actions"""
    if not flags:
        return ""
    
    # Map flags to specific action descriptions
    action_mapping = {
        'MISSING_CHART_NOTES': 'No chart notes/insurance verification required',
        'MISSING_PATIENT_INFO': 'Missing demographics - call provider for complete patient information',
        'WRONG_TEST_ORDERED': 'Wrong test ordered - need order for complete sleep study due to no testing in last 5 years',
        'INSURANCE_NOT_ACCEPTED': 'Out of network - fax UTS',
        'PROMINENCE_CONTRACT_ENDED': 'Out of network - fax UTS',
        'AUTHORIZATION_REQUIRED': 'Authorization required - submit/fax request',
        'TITRATION_REQUIRES_CLINICAL_REVIEW': 'Provider follow-up required - obtain additional clinical documentation',
        'DME_MENTIONED': 'DME evaluation needed before testing',
        'PEDIATRIC_SPECIAL_HANDLING': 'Pediatric specialist referral required',
        'LOW_OCR_CONFIDENCE': 'Manual review required - verify OCR accuracy',
        'MANUAL_REVIEW_REQUIRED': 'Manual review required',
        'CONTRADICTORY_INFO': 'Provider follow-up required - clarify contradictory information'
    }
    
    mapped_actions = []
    for flag in flags:
        if flag in action_mapping:
            mapped_actions.append(action_mapping[flag])
    
    # Remove duplicates while preserving order
    unique_actions = []
    for action in mapped_actions:
        if action not in unique_actions:
            unique_actions.append(action)
    
    return '; '.join(unique_actions) if unique_actions else 'Manual review required'


def count_forms_needed(batch_results: List[Dict[str, Any]]) -> Dict[str, int]:
    """Count the different types of forms needed"""
    counts = {
        'insurance_verification': 0,
        'authorization_requests': 0,
        'uts_referrals': 0,
        'provider_followup': 0,
        'patient_contact': 0
    }
    
    for result in batch_results:
        flags = result.get('flags', [])
        
        # Count based on flags
        if 'MISSING_CHART_NOTES' in flags:
            counts['insurance_verification'] += 1
        
        if 'AUTHORIZATION_REQUIRED' in flags:
            counts['authorization_requests'] += 1
        
        if any(flag in flags for flag in ['INSURANCE_NOT_ACCEPTED', 'PROMINENCE_CONTRACT_ENDED']):
            counts['uts_referrals'] += 1
        
        if any(flag in flags for flag in ['TITRATION_REQUIRES_CLINICAL_REVIEW', 'CONTRADICTORY_INFO', 'WRONG_TEST_ORDERED']):
            counts['provider_followup'] += 1
        
        if 'MISSING_PATIENT_INFO' in flags:
            counts['patient_contact'] += 1
    
    return counts


def generate_batch_id(intake_date: str) -> str:
    """Generate a unique batch ID"""
    # Convert date to MMDDYYYY format
    try:
        date_obj = datetime.strptime(intake_date, '%m/%d/%Y')
        date_str = date_obj.strftime('%m%d%Y')
    except:
        date_str = datetime.now().strftime('%m%d%Y')
    
    # Add time component for uniqueness
    time_str = datetime.now().strftime('%H%M')
    
    return f"BATCH_{date_str}_{time_str}"


def generate_filename_suggestions(batch_results: List[Dict[str, Any]], intake_date: str) -> Dict[str, str]:
    """Generate filename suggestions according to client specifications"""
    try:
        date_obj = datetime.strptime(intake_date, '%m/%d/%Y')
        date_str = date_obj.strftime('%m%d%Y')
    except:
        date_str = datetime.now().strftime('%m%d%Y')
    
    # Individual patient PDF filenames
    patient_filenames = []
    for result in batch_results:
        patient = result.get('patient', {})
        referral = result.get('referral', {})
        
        last_name = patient.get('last_name', 'Unknown').replace(' ', '_')
        first_name = patient.get('first_name', 'Unknown').replace(' ', '_')
        dob = patient.get('dob', '01/01/2000').replace('/', '')
        ref_date = referral.get('date', intake_date).replace('/', '')
        
        filename = f"{last_name}_{first_name}_{dob}_{ref_date}.pdf"
        patient_filenames.append(filename)
    
    return {
        'batch_cover_sheet': f"Batch_Summary_{date_str}.pdf",
        'manual_review_log': f"Manual_Review_{date_str}.pdf",
        'patient_pdfs': patient_filenames
    }


def main():
    """Test the batch cover sheet generator"""
    # Sample batch results
    sample_batch = [
        {
            'patient': {'first_name': 'Robert', 'last_name': 'Thompson', 'dob': '08/12/1975'},
            'insurance': {'primary': {'carrier': 'Aetna', 'member_id': 'A123456789'}},
            'referral': {'date': '03/15/2025'},
            'flags': [],
            'actions': []
        },
        {
            'patient': {'first_name': 'Jane', 'last_name': 'Smith', 'dob': '05/20/1980'},
            'insurance': {'primary': {'carrier': 'Prominence', 'member_id': 'P987654321'}},
            'referral': {'date': '03/15/2025'},
            'flags': ['PROMINENCE_CONTRACT_ENDED', 'MISSING_CHART_NOTES'],
            'actions': ['Out of network — Prominence cutoff', 'Request chart notes']
        },
        {
            'patient': {'first_name': 'John', 'last_name': 'Doe', 'dob': '03/10/1990'},
            'insurance': {'primary': {'carrier': 'BCBS', 'member_id': 'B555666777'}},
            'referral': {'date': '03/15/2025'},
            'flags': ['AUTHORIZATION_REQUIRED'],
            'actions': ['Submit prior auth']
        }
    ]
    
    # Generate cover sheet
    cover_sheet = generate_batch_cover_sheet(sample_batch, '03/15/2025')
    
    # Save to file
    with open('sample_batch_cover_sheet.html', 'w') as f:
        f.write(cover_sheet)
    
    # Generate filename suggestions
    filenames = generate_filename_suggestions(sample_batch, '03/15/2025')
    
    print("Sample batch cover sheet generated: sample_batch_cover_sheet.html")
    print("\\nSuggested filenames:")
    print(f"- Batch cover: {filenames['batch_cover_sheet']}")
    print(f"- Manual review: {filenames['manual_review_log']}")
    print("- Patient PDFs:")
    for filename in filenames['patient_pdfs']:
        print(f"  • {filename}")


if __name__ == "__main__":
    main()
