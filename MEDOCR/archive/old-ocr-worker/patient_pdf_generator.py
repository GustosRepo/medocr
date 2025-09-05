#!/usr/bin/env python3
"""
Patient PDF Generator for Sleep Medicine Referrals
Generates individual patient PDFs according to client specifications
"""

import json
import re
from datetime import datetime
from typing import Dict, Any, List
from enhanced_extract import extract_patient_form


def generate_patient_pdf_content(form_data: Dict[str, Any], ocr_text: str, ocr_confidence: float) -> str:
    """
    Generate patient PDF content according to client specifications
    
    Args:
        form_data: Extracted patient form data
        ocr_text: Original OCR text
        ocr_confidence: OCR confidence score
    
    Returns:
        Formatted PDF content as HTML
    """
    
    patient = form_data.get("patient", {})
    referral = form_data.get("referral", {})
    insurance = form_data.get("insurance", {}).get("primary", {})
    physician = form_data.get("physician", {})
    procedure = form_data.get("procedure", {})
    clinical = form_data.get("clinical", {})
    flags = form_data.get("flags", [])
    confidence = form_data.get("confidence", "Medium")
    actions = form_data.get("actions", [])
    
    # Format patient name
    patient_name = f"{patient.get('last_name', 'UNKNOWN')}, {patient.get('first_name', 'UNKNOWN')}"
    
    # Format phone numbers
    phones = patient.get("phones", [])
    primary_phone = phones[0] if phones else "Not provided"
    secondary_phone = phones[1] if len(phones) > 1 else ""
    
    # Calculate age for emergency contact determination
    age = calculate_age(patient.get("dob", ""))
    needs_emergency_contact = age and (age < 18 or has_caretaker_indicators(ocr_text))
    
    # Format CPT code and description
    cpt_code = procedure.get("cpt", "Not specified")
    cpt_description = get_cpt_description(cpt_code)
    
    # Extract provider notes
    provider_notes = extract_provider_notes(ocr_text)
    
    # Format clinical information
    vitals = clinical.get("vitals", {})
    symptoms = clinical.get("symptoms", [])
    
    # Format BMI/Height/Weight
    bmi_info = format_bmi_info(vitals, ocr_text)
    bp_info = vitals.get("bp", extract_bp_from_text(ocr_text))
    
    # Extract ICD-10 codes
    primary_diagnosis = get_primary_diagnosis(clinical, ocr_text)
    
    # Format alerts
    alerts = format_information_alerts(ocr_text, flags)
    
    # Format problem flags
    problem_flags = [flag for flag in flags if get_flag_severity(flag) in ['high', 'medium']]
    
    # Authorization notes
    auth_notes = extract_authorization_notes(ocr_text, insurance, flags)
    
    # Generate HTML content
    html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Sleep Medicine Referral - {patient_name}</title>
    <style>
        body {{ font-family: Arial, sans-serif; margin: 20px; line-height: 1.4; }}
        .header {{ border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 20px; }}
        .section {{ margin-bottom: 15px; }}
        .section-title {{ font-weight: bold; color: #2c3e50; border-bottom: 1px solid #bdc3c7; padding-bottom: 2px; }}
        .field {{ margin: 5px 0; }}
        .alert {{ background-color: #fff3cd; border: 1px solid #ffeaa7; padding: 5px; margin: 5px 0; }}
        .flag {{ background-color: #f8d7da; border: 1px solid #f5c6cb; padding: 5px; margin: 2px 0; }}
        .confidence-high {{ color: #27ae60; font-weight: bold; }}
        .confidence-medium {{ color: #f39c12; font-weight: bold; }}
        .confidence-low {{ color: #e74c3c; font-weight: bold; }}
        .confidence-manual {{ color: #8e44ad; font-weight: bold; }}
    </style>
</head>
<body>
    <div class="header">
        <h2>PATIENT: {patient_name} | DOB: {patient.get('dob', 'Not provided')} | REFERRAL DATE: {referral.get('date', 'Not provided')}</h2>
    </div>
    
    <div class="section">
        <div class="section-title">DEMOGRAPHICS:</div>
        <div class="field">- Phone: {primary_phone}{f' / {secondary_phone}' if secondary_phone else ''}</div>
        <div class="field">- Email: {patient.get('email', 'Not provided')}</div>
        {f'<div class="field">- Emergency Contact: {extract_emergency_contact(ocr_text)}</div>' if needs_emergency_contact else ''}
    </div>
    
    <div class="section">
        <div class="section-title">INSURANCE:</div>
        <div class="field">- Primary: {insurance.get('carrier', 'Not provided')} | ID: {insurance.get('member_id', 'Not provided')} | Group: {insurance.get('group', 'Not provided')}</div>
        {f'<div class="field">- Secondary: {format_secondary_insurance(form_data)}</div>' if form_data.get('insurance', {}).get('secondary') else ''}
    </div>
    
    <div class="section">
        <div class="section-title">PROCEDURE ORDERED:</div>
        <div class="field">- CPT Code: {cpt_code}</div>
        <div class="field">- Description: {cpt_description}</div>
        {f'<div class="field">- Provider Notes: {provider_notes}</div>' if provider_notes else ''}
    </div>
    
    <div class="section">
        <div class="section-title">REFERRING PHYSICIAN:</div>
        <div class="field">- Name: {physician.get('name', 'Not provided')}</div>
        <div class="field">- NPI: {physician.get('npi', 'Not provided')}</div>
        <div class="field">- Practice: {physician.get('practice', 'Not provided')}</div>
        <div class="field">- Phone/Fax: {physician.get('phone', 'Not provided')}{f' / {physician.get("fax", "")}' if physician.get('fax') else ''}</div>
        {extract_supervising_physician(ocr_text)}
    </div>
    
    <div class="section">
        <div class="section-title">CLINICAL INFORMATION:</div>
        <div class="field">- Primary Diagnosis: {primary_diagnosis}</div>
        <div class="field">- Symptoms Present: {', '.join(symptoms) if symptoms else 'Not documented'}</div>
        <div class="field">- {bmi_info}</div>
        {f'<div class="field">- BP: {bp_info}</div>' if bp_info else ''}
    </div>
    
    <div class="section">
        <div class="section-title">INFORMATION ALERTS:</div>
        {alerts}
    </div>
    
    <div class="section">
        <div class="section-title">PROBLEM FLAGS:</div>
        {format_problem_flags(problem_flags) if problem_flags else '<div class="field">None detected</div>'}
    </div>
    
    <div class="section">
        <div class="section-title">AUTHORIZATION NOTES:</div>
        <div class="field">{auth_notes if auth_notes else 'No special authorization requirements'}</div>
    </div>
    
    <div class="section">
        <div class="section-title">CONFIDENCE LEVEL:</div>
        <div class="field confidence-{confidence.lower().replace(' ', '-').replace('manual-review-required', 'manual')}">{confidence}</div>
    </div>
    
    <div style="margin-top: 30px; font-size: 11px; color: #7f8c8d;">
        Generated: {datetime.now().strftime('%m/%d/%Y %H:%M')} | OCR Confidence: {ocr_confidence:.1%} | Processing ID: {generate_processing_id(form_data)}
    </div>
</body>
</html>
    """
    
    return html_content


def calculate_age(dob_str: str) -> int:
    """Calculate age from DOB string"""
    try:
        dob = datetime.strptime(dob_str, '%m/%d/%Y')
        today = datetime.now()
        return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
    except:
        return None


def has_caretaker_indicators(text: str) -> bool:
    """Check for caretaker/disability indicators in text"""
    indicators = ['caretaker', 'guardian', 'disabled', 'wheelchair', 'assistance required', 'special needs']
    return any(indicator in text.lower() for indicator in indicators)


def get_cpt_description(cpt_code: str) -> str:
    """Get description for CPT code"""
    cpt_descriptions = {
        '95806': 'Home Sleep Apnea Test (Unattended)',
        '95810': 'Polysomnography (PSG) - Diagnostic',
        '95811': 'Polysomnography with CPAP Titration',
        'G0399': 'Home Sleep Test (Medicare)',
        '95782': 'Pediatric PSG (Under 6 years)',
        '95783': 'Pediatric PSG (6 years and older)',
        '95800': 'Multiple Sleep Latency Test (MSLT)',
        '95801': 'Maintenance of Wakefulness Test (MWT)'
    }
    return cpt_descriptions.get(cpt_code, 'Sleep Study (Unspecified)')


def extract_provider_notes(text: str) -> str:
    """Extract provider-specific notes from text"""
    notes_patterns = [
        r'provider notes?:\s*([^\n]+)',
        r'notes?:\s*([^\n]+)',
        r'urgent',
        r'eval\s*(?:and|&)\s*treat',
        r'complete study',
        r'repeat study',
        r'titration\s*(?:if|when)\s*indicated'
    ]
    
    notes = []
    text_lower = text.lower()
    
    for pattern in notes_patterns:
        matches = re.findall(pattern, text_lower, re.IGNORECASE)
        notes.extend(matches)
    
    # Look for urgency indicators
    if any(word in text_lower for word in ['urgent', 'stat', 'asap', 'priority']):
        notes.append('URGENT')
    
    return '; '.join(set(notes)) if notes else ''


def format_bmi_info(vitals: Dict, text: str) -> str:
    """Format BMI, height, weight information"""
    bmi = vitals.get("bmi")
    height = vitals.get("height_cm") or extract_height_from_text(text)
    weight = vitals.get("weight_kg") or extract_weight_from_text(text)
    
    if bmi:
        return f"BMI: {bmi}"
    elif height and weight:
        return f"Height: {height} // Weight: {weight}"
    else:
        return "BMI: Not documented"


def extract_height_from_text(text: str) -> str:
    """Extract height from text"""
    height_match = re.search(r"height:\s*([^\n]+)", text, re.IGNORECASE)
    if height_match:
        return height_match.group(1).strip()
    
    # Look for feet/inches format
    ft_in_match = re.search(r"(\d+)'?\s*(\d+)\"?", text)
    if ft_in_match:
        return f"{ft_in_match.group(1)}'{ft_in_match.group(2)}\""
    
    return ""


def extract_weight_from_text(text: str) -> str:
    """Extract weight from text"""
    weight_match = re.search(r"weight:\s*([^\n]+)", text, re.IGNORECASE)
    if weight_match:
        return weight_match.group(1).strip()
    
    # Look for lbs format
    lbs_match = re.search(r"(\d+)\s*(?:lbs?|pounds?)", text, re.IGNORECASE)
    if lbs_match:
        return f"{lbs_match.group(1)} lbs"
    
    return ""


def extract_bp_from_text(text: str) -> str:
    """Extract blood pressure from text"""
    bp_match = re.search(r"(?:bp|blood pressure):\s*(\d+/\d+)", text, re.IGNORECASE)
    if bp_match:
        return bp_match.group(1)
    
    # Look for BP format anywhere
    bp_pattern = re.search(r"\b(\d{2,3}/\d{2,3})\b", text)
    if bp_pattern:
        return bp_pattern.group(1)
    
    return ""


def get_primary_diagnosis(clinical: Dict, text: str) -> str:
    """Get primary diagnosis with ICD-10 code"""
    icd10_codes = clinical.get("icd10_all", [])
    
    # Common sleep medicine ICD-10 codes
    sleep_icd10 = {
        'G47.33': 'Obstructive Sleep Apnea',
        'G47.30': 'Sleep Apnea, Unspecified',
        'G47.9': 'Sleep Disorder, Unspecified',
        'G47.00': 'Insomnia, Unspecified',
        'G47.10': 'Hypersomnia, Unspecified',
        'Z87.891': 'Personal History of Sleep Disorders'
    }
    
    if icd10_codes:
        primary_code = icd10_codes[0]
        description = sleep_icd10.get(primary_code, 'Sleep Disorder')
        return f"{primary_code} - {description}"
    
    # Try to infer from symptoms
    text_lower = text.lower()
    if 'sleep apnea' in text_lower or 'apnea' in text_lower:
        return "G47.33 - Obstructive Sleep Apnea (Inferred)"
    elif 'insomnia' in text_lower:
        return "G47.00 - Insomnia, Unspecified (Inferred)"
    elif 'hypersomnia' in text_lower or 'daytime sleepiness' in text_lower:
        return "G47.10 - Hypersomnia, Unspecified (Inferred)"
    
    return "Not specified"


def format_information_alerts(text: str, flags: List[str]) -> str:
    """Format information alerts section"""
    alerts_html = ""
    
    # PPE Requirements
    ppe_required = 'PPE_REQUIRED' in flags
    alerts_html += f'<div class="field">- PPE Requirements: {"Yes" if ppe_required else "No"}</div>\n'
    
    # Safety Precautions
    safety_precautions = extract_safety_precautions(text)
    alerts_html += f'<div class="field">- Safety Precautions: {safety_precautions if safety_precautions else "None documented"}</div>\n'
    
    # Communication Needs
    comm_needs = extract_communication_needs(text, flags)
    alerts_html += f'<div class="field">- Communication Needs: {comm_needs if comm_needs else "None documented"}</div>\n'
    
    # Special Accommodations
    accommodations = extract_special_accommodations(text, flags)
    alerts_html += f'<div class="field">- Special Accommodations: {accommodations if accommodations else "None documented"}</div>\n'
    
    return alerts_html


def extract_safety_precautions(text: str) -> str:
    """Extract safety precautions from text"""
    safety_indicators = {
        'seizure': 'Seizure disorder',
        'pacemaker': 'Cardiac pacemaker',
        'icd': 'Implantable cardioverter defibrillator',
        'defibrillator': 'Cardiac defibrillator',
        'mobility': 'Mobility issues',
        'wheelchair': 'Wheelchair dependent',
        'oxygen': 'Oxygen dependent'
    }
    
    found_precautions = []
    text_lower = text.lower()
    
    for indicator, description in safety_indicators.items():
        if indicator in text_lower:
            found_precautions.append(description)
    
    return ', '.join(found_precautions)


def extract_communication_needs(text: str, flags: List[str]) -> str:
    """Extract communication needs from text and flags"""
    needs = []
    text_lower = text.lower()
    
    if 'COMMUNICATION_NEEDS' in flags or any(word in text_lower for word in ['interpreter', 'hearing', 'deaf', 'non-english']):
        if 'interpreter' in text_lower or 'non-english' in text_lower:
            needs.append('Interpreter needed')
        if 'hearing' in text_lower or 'deaf' in text_lower:
            needs.append('Hearing impaired')
    
    return ', '.join(needs)


def extract_special_accommodations(text: str, flags: List[str]) -> str:
    """Extract special accommodations from text and flags"""
    accommodations = []
    text_lower = text.lower()
    
    if 'SPECIAL_ACCOMMODATIONS' in flags or any(word in text_lower for word in ['wheelchair', 'oxygen', 'caretaker']):
        if 'wheelchair' in text_lower:
            accommodations.append('Wheelchair access required')
        if 'oxygen' in text_lower:
            accommodations.append('Oxygen dependent')
        if 'caretaker' in text_lower:
            accommodations.append('Caretaker present')
    
    return ', '.join(accommodations)


def format_problem_flags(flags: List[str]) -> str:
    """Format problem flags as HTML"""
    if not flags:
        return '<div class="field">None detected</div>'
    
    flag_descriptions = {
        'WRONG_TEST_ORDERED': 'Wrong test ordered - verify CPT vs indication',
        'TITRATION_REQUIRES_CLINICAL_REVIEW': 'CPAP titration requires clinical review',
        'MISSING_CHART_NOTES': 'Missing chart notes or clinical documentation',
        'MISSING_PATIENT_INFO': 'Missing patient demographics',
        'INSURANCE_NOT_ACCEPTED': 'Insurance not accepted',
        'PROMINENCE_CONTRACT_ENDED': 'Prominence contract expired',
        'DME_MENTIONED': 'DME evaluation needed before testing',
        'LOW_OCR_CONFIDENCE': 'Low OCR confidence - manual verification needed',
        'CONTRADICTORY_INFO': 'Contradictory information detected',
        'MANUAL_REVIEW_REQUIRED': 'Manual review required'
    }
    
    flags_html = ""
    for flag in flags:
        description = flag_descriptions.get(flag, flag.replace('_', ' ').title())
        flags_html += f'<div class="flag">• {description}</div>\n'
    
    return flags_html


def extract_authorization_notes(text: str, insurance: Dict, flags: List[str]) -> str:
    """Extract authorization-related notes"""
    notes = []
    
    if 'AUTHORIZATION_REQUIRED' in flags:
        notes.append('Prior authorization required')
    
    if 'INSURANCE_NOT_ACCEPTED' in flags:
        notes.append('Out of network - requires UTS referral')
    
    carrier = insurance.get('carrier', '').lower()
    if 'medicare' in carrier:
        notes.append('Medicare patient - verify coverage for sleep studies')
    elif 'medicaid' in carrier:
        notes.append('Medicaid patient - verify authorization requirements')
    
    # Look for auth-related text
    if any(word in text.lower() for word in ['prior auth', 'authorization', 'precert']):
        notes.append('Authorization mentioned in referral')
    
    return '; '.join(notes)


def extract_emergency_contact(text: str) -> str:
    """Extract emergency contact information for pediatric/disabled patients"""
    # Look for emergency contact patterns
    contact_match = re.search(r'emergency contact:\s*([^\n]+)', text, re.IGNORECASE)
    if contact_match:
        return contact_match.group(1).strip()
    
    # Look for parent/guardian information
    guardian_match = re.search(r'(?:parent|guardian|caretaker):\s*([^\n]+)', text, re.IGNORECASE)
    if guardian_match:
        return guardian_match.group(1).strip()
    
    return "Not provided"


def format_secondary_insurance(form_data: Dict) -> str:
    """Format secondary insurance information"""
    secondary = form_data.get('insurance', {}).get('secondary', {})
    if not secondary:
        return ""
    
    return f"{secondary.get('carrier', 'Unknown')} | ID: {secondary.get('member_id', 'Unknown')} | Group: {secondary.get('group', 'Unknown')}"


def extract_supervising_physician(text: str) -> str:
    """Extract supervising physician information if present"""
    supervising_match = re.search(r'supervising\s+(?:physician|doctor|md):\s*([^\n]+)', text, re.IGNORECASE)
    if supervising_match:
        return f'<div class="field">- Supervising Physician: {supervising_match.group(1).strip()}</div>'
    return ""


def get_flag_severity(flag: str) -> str:
    """Get severity level for a flag"""
    high_severity = ['WRONG_TEST_ORDERED', 'TITRATION_REQUIRES_CLINICAL_REVIEW', 
                    'MISSING_CHART_NOTES', 'MISSING_PATIENT_INFO', 'INSURANCE_NOT_ACCEPTED',
                    'PROMINENCE_CONTRACT_ENDED', 'NOT_REFERRAL_DOCUMENT', 'NO_TEST_ORDER_FOUND']
    
    if flag in high_severity:
        return 'high'
    elif flag in ['DME_MENTIONED', 'LOW_OCR_CONFIDENCE', 'MANUAL_REVIEW_REQUIRED']:
        return 'medium'
    else:
        return 'low'


def generate_processing_id(form_data: Dict) -> str:
    """Generate a unique processing ID"""
    patient = form_data.get("patient", {})
    referral_date = form_data.get("referral", {}).get("date", "")
    
    # Create ID from last name + DOB + date
    last_name = patient.get('last_name', 'UNK')[:3].upper()
    dob_parts = patient.get('dob', '01/01/2000').split('/')
    date_parts = referral_date.split('/') if referral_date else ['01', '01', '2025']
    
    return f"{last_name}{dob_parts[0]}{dob_parts[2][-2:]}{date_parts[0]}{date_parts[2][-2:]}"


def main():
    """Test the patient PDF generator"""
    # Example usage
    sample_text = """
    SLEEP MEDICINE REFERRAL FORM Date: 03/15/2025 Provider: Dr. Sarah Chen, MD Sleep Medicine 
    PATIENT INFORMATION Name: Robert Thompson DOB: 08/12/1975 MRN: SM-789456 Phone: (555) 234-9876 
    STUDY REQUESTED Home Sleep Apnea Test (HSAT) BMI: 32.3 Neck circumference: 18 inches
    Epworth Score: 16 Symptoms: loud snoring, witnessed apneas, daytime sleepiness
    """
    
    form_data = extract_patient_form(sample_text, 0.94)
    pdf_content = generate_patient_pdf_content(form_data, sample_text, 0.94)
    
    # Save to file
    with open('sample_patient_pdf.html', 'w') as f:
        f.write(pdf_content)
    
    print("Sample patient PDF generated: sample_patient_pdf.html")


if __name__ == "__main__":
    main()
