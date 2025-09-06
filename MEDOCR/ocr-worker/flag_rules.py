#!/usr/bin/env python3
"""
Flag Rules Module for MedOCR Sleep Studies
Provides intelligent flagging and routing for medical document processing
"""

import json
import re
from datetime import datetime, date
from typing import Dict, List, Optional, Any
import os, json
from difflib import SequenceMatcher


def load_flags_catalog(path: str = "config/flags_catalog.json") -> Dict:
    """Load the flags catalog from JSON file"""
    with open(path, 'r') as f:
        return json.load(f)


def severity(flag_id: str) -> str:
    """Return severity level for a flag"""
    core_flags = {
        'WRONG_TEST_ORDERED', 'TITRATION_REQUIRES_CLINICAL_REVIEW', 
        'MISSING_CHART_NOTES', 'MISSING_PATIENT_INFO', 
        'NOT_REFERRAL_DOCUMENT', 'NO_TEST_ORDER_FOUND'
    }
    insurance_flags = {
        'INSURANCE_NOT_ACCEPTED', 'PROMINENCE_CONTRACT_ENDED', 
        'INSURANCE_EXPIRED', 'AUTHORIZATION_REQUIRED'
    }
    
    if flag_id in core_flags or flag_id in insurance_flags:
        return 'high'
    elif flag_id in {'DME_MENTIONED', 'CPAP_COMPLIANCE_ISSUE', 'PEDIATRIC_SPECIAL_HANDLING', 
                     'MOBILITY_ALERT', 'SAFETY_ALERT', 'LOW_OCR_CONFIDENCE', 
                     'CONTRADICTORY_INFO', 'MANUAL_REVIEW_REQUIRED', 'FUTURE_REFERRAL_DATE'}:
        return 'medium'
    else:
        return 'low'


def flags_to_actions(flags: List[str], catalog: Dict) -> List[str]:
    """Map flags to routing actions, de-duplicate and maintain stable order"""
    actions = []
    seen = set()
    
    flag_lookup = {f['id']: f['route'] for f in catalog['flags']}
    
    for flag_id in flags:
        if flag_id in flag_lookup:
            route = flag_lookup[flag_id]
            if route not in seen:
                actions.append(route)
                seen.add(route)
    
    return actions


def _parse_date(date_str: str) -> Optional[date]:
    """Parse date string in MM/DD/YYYY format"""
    if not date_str:
        return None
    try:
        # Handle various date formats
        for fmt in ['%m/%d/%Y', '%m-%d-%Y', '%Y-%m-%d', '%m/%d/%y']:
            try:
                return datetime.strptime(date_str.strip(), fmt).date()
            except ValueError:
                continue
        return None
    except:
        return None


def _fuzzy_match(text: str, patterns: List[str], threshold: float = 0.6) -> bool:
    """Check if any pattern matches text with fuzzy matching"""
    text_lower = text.lower()
    for pattern in patterns:
        pattern_lower = pattern.lower()
        if pattern_lower in text_lower:
            return True
        # Fuzzy matching for typos
        ratio = SequenceMatcher(None, pattern_lower, text_lower).ratio()
        if ratio >= threshold:
            return True
    return False


def _has_negation_context(text: str, term: str, window: int = 10) -> bool:
    """Check if term appears in negation context within window"""
    negations = ['denies', 'no', 'not', 'negative', 'absent', 'wnl', 'normal', 'unremarkable']
    
    text_lower = text.lower()
    term_lower = term.lower()
    
    # Find all occurrences of the term
    for match in re.finditer(re.escape(term_lower), text_lower):
        start = max(0, match.start() - window * 6)  # ~6 chars per word
        end = min(len(text_lower), match.end() + window * 6)
        context = text_lower[start:end]
        
        # Check for negation words in context
        for neg in negations:
            if neg in context:
                return True
    
    return False


def derive_flags(ocr_text: str, parsed: Dict, today: date, rules: Dict, conf: Optional[float] = None) -> List[str]:
    """
    Derive flags from OCR text and parsed data
    
    Args:
        ocr_text: Raw OCR text
        parsed: Pre-parsed document structure
        today: Current date for date comparisons
        rules: Rules from normalizers.json
        conf: OCR confidence (0-1)
    
    Returns:
        List of flag IDs
    """
    flags = []
    # Load external insurance rules if not provided
    try:
        if not rules or not rules.get('denied_carriers'):
            rules_dir = os.path.join(os.path.dirname(__file__), 'rules')
            ins_path = os.path.join(rules_dir, 'insurance.json')
            if os.path.exists(ins_path):
                data = json.load(open(ins_path,'r'))
                rules = { **(rules or {}), **data }
    except Exception:
        pass
    text_lower = ocr_text.lower()
    
    # === CORE FLAGS ===
    
    # NOT_REFERRAL_DOCUMENT
    consult_indicators = [
        'consultation note', 'history of present illness', 'assessment and plan',
        'subjective', 'objective', 'hpi:', 'plan:', 'impression:'
    ]
    order_indicators = [
        'sleep study', 'polysomnography', 'psg', 'home sleep test', 'hsat',
        'order', 'requested', 'schedule', 'referral for'
    ]
    
    has_consult_format = any(ind in text_lower for ind in consult_indicators)
    has_order = any(ind in text_lower for ind in order_indicators)
    
    if has_consult_format and not has_order:
        flags.append('NOT_REFERRAL_DOCUMENT')
    
    # NO_TEST_ORDER_FOUND
    doc_type = parsed.get('doc_type', 'unknown')
    procedure = parsed.get('procedure', {})
    if doc_type == 'referral' and not procedure.get('cpt') and not has_order:
        flags.append('NO_TEST_ORDER_FOUND')
    
    # WRONG_TEST_ORDERED
    cpt_val = procedure.get('cpt', '')
    # Normalize CPT to a single primary code for gating checks (list -> first)
    if isinstance(cpt_val, list):
        cpt = cpt_val[0] if cpt_val else ''
    else:
        cpt = cpt_val
    symptoms = parsed.get('clinical', {}).get('symptoms', [])
    
    if cpt == '95811':  # Titration study
        titration_indicators = [
            'titration', 'cpap pressure', 'mask fitting', 'pressure adjustment',
            'not tolerating cpap', 'cpap compliance'
        ]
        has_titration_indication = any(ind in text_lower for ind in titration_indicators)
        if not has_titration_indication:
            flags.append('WRONG_TEST_ORDERED')
    
    # TITRATION_REQUIRES_CLINICAL_REVIEW
    if cpt == '95811':
        auto_criteria = bool(procedure.get('titration_auto_criteria', False))
        if not auto_criteria:
            flags.append('TITRATION_REQUIRES_CLINICAL_REVIEW')
    
    # MISSING_CHART_NOTES
    clinical = parsed.get('clinical', {})
    icd10_codes = clinical.get('icd10_all', [])
    if not icd10_codes and not symptoms:
        flags.append('MISSING_CHART_NOTES')
    
    # MISSING_PATIENT_INFO
    patient = parsed.get('patient', {})
    has_phone = bool(patient.get('phones')) or bool(patient.get('phone_home')) or bool(patient.get('phone'))
    if not patient.get('dob') or not patient.get('mrn') or not has_phone:
        flags.append('MISSING_PATIENT_INFO')
    
    # === INSURANCE FLAGS ===
    
    insurance = parsed.get('insurance', {}).get('primary', {})
    carrier = insurance.get('carrier', '').lower()
    
    # INSURANCE_NOT_ACCEPTED (config-driven)
    denied_defaults = ['culinary','intermountain','p3 health','select health','wellcare']
    denied_carriers = [d.lower() for d in rules.get('denied_carriers', [])] or denied_defaults
    if any(dc in carrier for dc in denied_carriers):
        flags.append('INSURANCE_NOT_ACCEPTED')
    
    # PROMINENCE_CONTRACT_ENDED
    prominence_end = rules.get('prominence_contract_end')
    if prominence_end and 'prominence' in carrier:
        referral_date = _parse_date(parsed.get('referral', {}).get('date', ''))
        end_date = _parse_date(prominence_end)
        if referral_date and end_date and referral_date > end_date:
            flags.append('PROMINENCE_CONTRACT_ENDED')
    
    # INSURANCE_EXPIRED
    # Look for coverage dates in text
    coverage_patterns = re.findall(r'coverage.*?(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})', text_lower)
    for coverage_date_str in coverage_patterns:
        coverage_date = _parse_date(coverage_date_str)
        if coverage_date and coverage_date < today:
            flags.append('INSURANCE_EXPIRED')
            break
    
    # AUTHORIZATION_REQUIRED
    auth_keywords = ['prior authorization', 'pre-auth', 'authorization required', 'needs approval']
    if any(keyword in text_lower for keyword in auth_keywords):
        flags.append('AUTHORIZATION_REQUIRED')
    
    # === CLINICAL/DME FLAGS ===
    
    # DME_MENTIONED
    dme_data = parsed.get('dme', {})
    hcpcs_codes = dme_data.get('hcpcs', [])
    dme_providers = dme_data.get('providers', [])
    
    rule_hcpcs = rules.get('hcpcs', [])
    rule_dme_providers = rules.get('dme_providers', [])
    
    if (any(hcpcs in rule_hcpcs for hcpcs in hcpcs_codes) or 
        any(provider.lower() in [p.lower() for p in rule_dme_providers] for provider in dme_providers)):
        flags.append('DME_MENTIONED')
    
    # CPAP_COMPLIANCE_ISSUE
    cpap_issues = [
        'not tolerating cpap', 'pressure too high', 'pressure too low',
        'mask leaking', 'cpap intolerance', 'cannot use cpap'
    ]
    if any(issue in text_lower for issue in cpap_issues):
        flags.append('CPAP_COMPLIANCE_ISSUE')
    
    # PEDIATRIC_SPECIAL_HANDLING
    pediatric_cpts = ['95782', '95783']
    patient_dob = _parse_date(patient.get('dob', ''))
    age = None
    if patient_dob:
        age = (today - patient_dob).days // 365
    
    if cpt in pediatric_cpts or (age and age < 18):
        flags.append('PEDIATRIC_SPECIAL_HANDLING')
    # Pediatric wrong code if adult CPT used for <18
    if age is not None and age < 18 and cpt in {'95810','95811'}:
        flags.append('WRONG_TEST_ORDERED')
    
    # MOBILITY_ALERT
    vitals = clinical.get('vitals', {})
    bmi = vitals.get('bmi')
    mobility_keywords = ['wheelchair', 'walker', 'mobility aid']
    
    if (bmi and bmi > 40) or any(keyword in text_lower for keyword in mobility_keywords):
        flags.append('MOBILITY_ALERT')
    
    # SAFETY_ALERT
    safety_keywords = ['seizure', 'pacemaker', 'icd', 'oxygen', 'claustrophobia', 'fall risk']
    if any(keyword in text_lower for keyword in safety_keywords):
        flags.append('SAFETY_ALERT')
    
    # === PROCESSING FLAGS ===
    
    # LOW_OCR_CONFIDENCE
    if conf is not None and conf < 0.8:
        flags.append('LOW_OCR_CONFIDENCE')
    
    # CONTRADICTORY_INFO
    contradictions = [
        ('denies snoring', 'witnessed apneas'),
        ('no sleep issues', 'excessive daytime sleepiness'),
        ('sleeping well', 'insomnia')
    ]
    for deny_term, positive_term in contradictions:
        if deny_term in text_lower and positive_term in text_lower:
            flags.append('CONTRADICTORY_INFO')
            break
    
    # FUTURE_REFERRAL_DATE
    referral_date = _parse_date(parsed.get('referral', {}).get('date', ''))
    if referral_date and referral_date > today:
        flags.append('FUTURE_REFERRAL_DATE')
    
    # === INFO FLAGS ===
    
    # PPE_REQUIRED
    infection_keywords = ['covid', 'tuberculosis', 'mrsa', 'c diff', 'infectious']
    if any(keyword in text_lower for keyword in infection_keywords):
        flags.append('PPE_REQUIRED')
    
    # COMMUNICATION_NEEDS
    communication_keywords = ['interpreter', 'hearing aid', 'deaf', 'language barrier', 'spanish speaking']
    if any(keyword in text_lower for keyword in communication_keywords):
        flags.append('COMMUNICATION_NEEDS')
    
    # SPECIAL_ACCOMMODATIONS
    accommodation_keywords = ['wheelchair accessible', 'caregiver', 'assistance needed', 'special needs']
    if any(keyword in text_lower for keyword in accommodation_keywords):
        flags.append('SPECIAL_ACCOMMODATIONS')
    
    # MEDICATION_ALERT
    medication_keywords = ['opioid', 'benzodiazepine', 'sedative', 'narcotic', 'oxycodone', 'alprazolam']
    if any(keyword in text_lower for keyword in medication_keywords):
        flags.append('MEDICATION_ALERT')
    
    # HISTORY_ALERT
    history_keywords = ['previous sleep study', 'hx of osa', 'prior psg', 'sleep study showed']
    if any(keyword in text_lower for keyword in history_keywords):
        flags.append('HISTORY_ALERT')
    
    # MANUAL_REVIEW_REQUIRED (if 2+ high-severity flags)
    high_severity_flags = [f for f in flags if severity(f) == 'high']
    if len(high_severity_flags) >= 2:
        flags.append('MANUAL_REVIEW_REQUIRED')
    
    return flags


def compute_confidence_bucket(ocr_conf: Optional[float], flags: List[str]) -> str:
    """Compute confidence bucket based on OCR confidence and flags"""
    if 'MANUAL_REVIEW_REQUIRED' in flags:
        return 'Manual Review Required'
    
    if 'LOW_OCR_CONFIDENCE' in flags or ocr_conf is None:
        return 'Low'
    
    high_severity_count = len([f for f in flags if severity(f) == 'high'])
    
    if high_severity_count >= 2:
        return 'Low'
    elif high_severity_count == 1 or ocr_conf < 0.85:
        return 'Medium'
    else:
        return 'High'


if __name__ == '__main__':
    # Example usage
    catalog = load_flags_catalog('config/flags_catalog.json')
    
    # Test data
    sample_parsed = {
        'doc_type': 'referral',
        'patient': {'dob': '01/15/1980', 'mrn': 'MRN123', 'phones': ['555-1234']},
        'referral': {'date': '12/01/2025'},
        'procedure': {'cpt': '95811'},
        'insurance': {'primary': {'carrier': 'Prominence'}},
        'clinical': {'symptoms': ['snoring'], 'vitals': {'bmi': 32}},
        'dme': {'hcpcs': ['E0601'], 'providers': ['Apria']}
    }
    
    sample_rules = {
        'carrier_autoflag': ['BadInsurance'],
        'prominence_contract_end': '10/31/2025',
        'hcpcs': ['E0601', 'E0470'],
        'dme_providers': ['Apria', 'Lincare']
    }
    
    sample_text = "Patient has snoring and needs CPAP titration study. Apria DME mentioned."
    
    flags = derive_flags(sample_text, sample_parsed, date.today(), sample_rules, 0.92)
    actions = flags_to_actions(flags, catalog)
    confidence = compute_confidence_bucket(0.92, flags)
    
    print(f"Flags: {flags}")
    print(f"Actions: {actions}")
    print(f"Confidence: {confidence}")
