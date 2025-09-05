#!/usr/bin/env python3
"""
Enhanced medical form extraction with fuzzy pattern matching and error correction
Specialized for sleep medicine and general medical referrals
"""

import re
import json
from datetime import date, datetime
from typing import Dict, List, Any, Optional, Tuple
from ocr_preprocessing import OCRPreprocessor, FuzzyPatternMatcher, enhance_extraction_confidence
from semantic_template_mapper import SemanticTemplateMapper

def analyze_medical_form(ocr_text: str, ocr_confidence: float = 0.0) -> Dict[str, Any]:
    """
    Enhanced medical form analysis using semantic template mapping.
    This version standardizes field names to match backend_integration.py
    and ensures enrichment + flags/actions are executed before returning.
    """
    # Initialize semantic mapper and preprocessor
    semantic_mapper = SemanticTemplateMapper()
    preprocessor = OCRPreprocessor()

    # Apply OCR error correction
    corrected_text = preprocessor.correct_ocr_text(ocr_text)

    # Primary extraction via semantic template
    semantic_result = semantic_mapper.extract_with_context(corrected_text)
    extracted_fields = semantic_result.get('extracted_data', {}) or {}
    confidence_scores = semantic_result.get('confidence_scores', {}) or {}
    semantic_overall = semantic_result.get('overall_confidence', 0.0)

    # Normalize common key variants produced by semantic mapper (spaces vs underscores)
    key_aliases = [
        ("patient name", "patient_name"),
        ("date of birth", "date_of_birth"),
        ("dob", "date_of_birth"),
        ("mrn", "mrn"),
        ("phone number", "phone_number"),
        ("insurance carrier", "insurance_carrier"),
        ("member id", "member_id"),
        ("cpt codes", "cpt_codes"),
    ]
    for src, dest in key_aliases:
        if src in extracted_fields and dest not in extracted_fields:
            extracted_fields[dest] = extracted_fields[src]

    # --- Build canonical form (schema expected by backend_integration.py) ---
    form: Dict[str, Any] = {
        "doc_type": "referral",
        "original_text": ocr_text,
        "corrected_text": corrected_text,
        "processing_timestamp": datetime.now().isoformat(),
        "extraction_method": "semantic_template_mapping",
        "semantic_confidence": semantic_overall,
        "patient": {},
        "insurance": {"primary": {}},
        "physician": {},
        "procedure": {},
        "clinical": {},
    }

    # ---- Patient ----
    full_name = (extracted_fields.get('patient_name') or '').strip()
    if full_name.lower().endswith(' dob'):
        full_name = full_name[:-4].strip()
    first_name, last_name = '', ''
    if full_name:
        parts = full_name.split()
        if len(parts) >= 2:
            first_name = parts[0]
            last_name = ' '.join(parts[1:])
    dob = extracted_fields.get('date_of_birth', '')
    form["patient"] = {
        "name": full_name,
        "first_name": first_name,
        "last_name": last_name,
        "dob": dob,
        "mrn": extracted_fields.get('mrn', ''),
        # Standardize to phone_home for UI; keep alias phone for compatibility
        "phone_home": extracted_fields.get('phone_number', ''),
        "phone": extracted_fields.get('phone_number', ''),
        "age": calculate_age_from_dob(dob) if dob else None
    }

    # ---- Insurance (Primary) ----
    form["insurance"]["primary"] = {
        "carrier": extracted_fields.get('insurance_carrier', ''),
        "member_id": extracted_fields.get('member_id', ''),
        "policy_id": extracted_fields.get('member_id', '') or '',
        "authorization_number": extracted_fields.get('authorization_number', ''),
        "insurance_verified": 'Yes' if re.search(r'\b(verified|confirmed)\b', corrected_text, re.I) else ''
    }

    # ---- Physician (flattened) ----
    form["physician"] = {
        "name": extracted_fields.get('provider_name', ''),
        "specialty": extracted_fields.get('provider_specialty', '') or "Sleep Medicine",
        "npi": extracted_fields.get('provider_npi', ''),
        "clinic_phone": extracted_fields.get('clinic_phone', ''),
        "fax": extracted_fields.get('fax', ''),
        # keep nested 'referring' for back-compat if someone expects it
        "referring": {
            "name": extracted_fields.get('provider_name', ''),
            "specialty": extracted_fields.get('provider_specialty', '') or "Sleep Medicine"
        }
    }

    # ---- Procedure ----
    # Accept both cpt_codes (str or list) and map to canonical list form["procedure"]["cpt"]
    cpt_codes = extracted_fields.get('cpt_codes')
    if isinstance(cpt_codes, str) and cpt_codes:
        cpt_list = [cpt_codes]
    elif isinstance(cpt_codes, list):
        cpt_list = [c for c in cpt_codes if c]
    else:
        cpt_list = []
    # Also capture any CPTs visible in the corrected text if semantic missed
    cpt_list_fallback = re.findall(r'\b(9580[0-6]|9581[01]|9578[23]|G0399|G0398|95800|95801)\b', corrected_text)
    for c in cpt_list_fallback:
        if c not in cpt_list:
            cpt_list.append(c)

    study_type = determine_study_type(cpt_list or extracted_fields.get('cpt_codes', ''))
    form["procedure"] = {
        "cpt": cpt_list,
        "study_requested": extracted_fields.get('study_requested') or extracted_fields.get('study_type') or study_type,
        "description": extracted_fields.get('cpt_descriptions', []),
        "priority": extracted_fields.get('priority', '') or "routine",
        "indication": extracted_fields.get('indication', '') or extracted_fields.get('primary_diagnosis', '')
    }
    if form["procedure"]["indication"]:
        form["clinical"]["primary_diagnosis"] = form["procedure"]["indication"]

    # ---- Clinical ----
    form["clinical"].update({
        "epworth_score": extracted_fields.get('epworth_score', ''),
        "symptoms": [],
        "neck_circumference": extracted_fields.get('neck_circumference', ''),
        "mallampati": extracted_fields.get('mallampati', ''),
        "tonsil_size": extracted_fields.get('tonsil_size', ''),
        "impression": extracted_fields.get('clinical_impression', ''),
        "medications": extracted_fields.get('medications', []),
        "icd10_codes": extracted_fields.get('icd10_codes', [])
    })
    # Pull common symptoms line if present in free text
    m = re.search(r'Symptoms?:\s*([^\n\r]+)', corrected_text, re.I)
    if m and not form["clinical"]["symptoms"]:
        form["clinical"]["symptoms"] = [s.strip() for s in re.split(r'[;,]', m.group(1)) if s.strip()]

    # ---- Document / Metadata ----
    # Referral/order date
    doc_date = ''
    for pat in (r'(?:Referral\s*\/?\s*order\s*date|Document\s*Date)\s*:\s*([01]?\d\/[0-3]?\d\/\d{4})',
                r'\bDate:\s*([01]?\d\/[0-3]?\d\/\d{4})'):
        m = re.search(pat, corrected_text, re.I)
        if m:
            doc_date = m.group(1)
            break
    form["document_date"] = doc_date
    # Intake date
    in_date = ''
    for pat in (r'(?:Intake\s*\/?\s*processing|Intake\s*Date)\s*:\s*([01]?\d\/[0-3]?\d\/\d{4})',):
        m = re.search(pat, corrected_text, re.I)
        if m:
            in_date = m.group(1)
            break
    form["intake_date"] = in_date

    # ---- Confidence Aliases ----
    overall_conf = float(semantic_overall or 0.0)
    if not overall_conf and isinstance(ocr_confidence, (int, float)):
        overall_conf = float(ocr_confidence)
    form["confidence_scores"] = {
        "overall_confidence": overall_conf,
        "field_confidence": confidence_scores,
        "ocr_confidence": ocr_confidence
    }
    form["overall_confidence"] = overall_conf  # alias for UI

    # ---- Enrichment: clinical & DME (ensure they run BEFORE return) ----
    try:
        # Merge enhanced clinical (will not overwrite already set keys unless empty)
        enhanced = extract_clinical_info_enhanced(corrected_text)
        # Flatten vitals if present
        vitals = enhanced.get("vitals", {})
        if vitals:
            # map flattened vitals into patient block for UI parity where applicable
            if "blood_pressure" in vitals and not form["patient"].get("blood_pressure"):
                # many UIs expect patient.blood_pressure
                form["patient"]["blood_pressure"] = vitals.get("blood_pressure")
            if "height" in vitals and not form["patient"].get("height"):
                form["patient"]["height"] = vitals.get("height")
            if "weight" in vitals and not form["patient"].get("weight"):
                w = vitals.get("weight")
                form["patient"]["weight"] = w if isinstance(w, str) else f"{w} lbs"
            if "bmi" in vitals and not form["patient"].get("bmi"):
                form["patient"]["bmi"] = vitals.get("bmi")

        # Merge symptoms/meds without duplication
        if enhanced.get("symptoms"):
            base = set([s.lower() for s in form["clinical"].get("symptoms", []) if s])
            for s in enhanced["symptoms"]:
                if s and s.lower() not in base:
                    form["clinical"].setdefault("symptoms", []).append(s)

        if enhanced.get("medications"):
            base_meds = set([m.lower() if isinstance(m, str) else json.dumps(m).lower()
                             for m in form["clinical"].get("medications", [])])
            for mval in enhanced["medications"]:
                key = mval.lower() if isinstance(mval, str) else json.dumps(mval).lower()
                if key not in base_meds:
                    form["clinical"].setdefault("medications", []).append(mval)

        # DME information
        form["dme"] = extract_dme_info(corrected_text)
    except Exception as e:
        print(f"Clinical/DME enrichment failed: {e}")

    # ---- Flags & Routing ----
    try:
        catalog = load_flags_catalog('config/flags_catalog.json')
    except Exception:
        catalog = {"flags": []}
    try:
        # Minimal rule-set for now; could be expanded or passed in
        rules = {
            'carrier_autoflag': ['Kaiser', 'Medicaid', 'Medicare'],
            'hcpcs': ['E0601', 'E0470', 'E0471', 'E0561'],
        }
        from flag_rules import compute_confidence_bucket  # ensure imported
        flags = derive_flags(corrected_text, form, date.today(), rules, ocr_confidence or overall_conf)
        actions = flags_to_actions(flags, catalog)
        conf_bucket = compute_confidence_bucket(overall_conf, flags)
    except Exception as e:
        print(f"Flag analysis failed: {e}")
        flags, actions, conf_bucket = [], [], "Medium"

    form["flags"] = flags
    form["actions"] = actions
    form["confidence"] = conf_bucket
    form.setdefault("missing_critical_fields", [])

    return form

import re
import json
from datetime import datetime, date
from typing import Dict, Any, Optional
from flag_rules import load_flags_catalog, derive_flags, flags_to_actions, compute_confidence_bucket


def extract_patient_form(ocr_text: str, ocr_confidence: Optional[float] = None, 
                        analysis: Optional[Dict] = None) -> Dict[str, Any]:
    """
    Extract comprehensive patient form data with intelligent flagging
    
    Args:
        ocr_text: Raw OCR text
        ocr_confidence: OCR confidence score (0-1)
        analysis: Analysis results from analyze.py
    
    Returns:
        Complete patient form following patient_form.schema.json
    """
    
    # Initialize form structure
    form = {
        "doc_type": "unknown",
        "patient": {},
        "referral": {},
        "insurance": {"primary": {}},
        "physician": {},
        "procedure": {},
        "clinical": {"vitals": {}, "alerts": {}},
        "dme": {},
        "flags": [],
        "confidence": "Medium"
    }
    
    text = ocr_text.lower()
    
    # Determine document type
    if any(phrase in text for phrase in ['referral', 'refer to', 'request']):
        form["doc_type"] = "referral"
    elif any(phrase in text for phrase in ['consultation', 'consult note', 'history of present illness']):
        form["doc_type"] = "consult_note"
    
    # Extract patient information (basic legacy helper not defined here -> use enhanced basic variant)
    try:
        form["patient"] = extract_patient_info_basic(ocr_text)
    except NameError:
        form["patient"] = {}
    
    # Extract referral information
    form["referral"] = extract_referral_info(ocr_text)
    
    # Extract insurance information
    form["insurance"] = extract_insurance_info(ocr_text)
    
    # Extract physician information
    form["physician"] = extract_physician_info(ocr_text)
    
    # Extract procedure information
    form["procedure"] = extract_procedure_info(ocr_text)
    
    # Extract clinical information
    form["clinical"] = extract_clinical_info(ocr_text)
    
    # Extract DME information
    form["dme"] = extract_dme_info(ocr_text)
    
    # Load business rules (simplified version)
    rules = {
        'carrier_autoflag': ['Kaiser', 'Medicaid', 'Medicare'],
        'prominence_contract_end': '2025-10-31',
        'hcpcs': ['E0601', 'E0470', 'E0471', 'E0561'],
        'dme_providers': ['Apria', 'Lincare', 'ResMed', 'Philips'],
        'negations': ['denies', 'no', 'not', 'negative', 'wnl', 'within normal limits'],
        'symptoms': ['snoring', 'apnea', 'daytime sleepiness', 'insomnia', 'restless sleep']
    }
    
    # Load flags catalog and derive flags
    try:
        catalog = load_flags_catalog('config/flags_catalog.json')
        form["flags"] = derive_flags(ocr_text, form, date.today(), rules, ocr_confidence)
        form["confidence"] = compute_confidence_bucket(ocr_confidence, form["flags"])
        
        # Add routing actions
        form["actions"] = flags_to_actions(form["flags"], catalog)
    except Exception as e:
        print(f"Warning: Flag analysis failed: {e}")
        form["flags"] = []
        form["actions"] = []
        form["confidence"] = "Medium"
    
    return form


def extract_patient_info_enhanced(text: str, fuzzy_matcher: FuzzyPatternMatcher) -> Dict[str, Any]:
    """Extract patient demographic information with enhanced pattern matching"""
    patient = {}
    
    # Enhanced name extraction with better patterns
    name_patterns = [
        r'(?:patient|name):\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)',
        r'name\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)',
        r'^([A-Z][a-z]+\s+[A-Z][a-z]+)',  # First line names
        r'PATIENT.*?([A-Z][a-z]+\s+[A-Z][a-z]+)'
    ]
    
    for pattern in name_patterns:
        match = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
        if match:
            full_name = match.group(1).strip()
            name_parts = full_name.split()
            if len(name_parts) >= 2:
                patient["first_name"] = name_parts[0]
                patient["last_name"] = " ".join(name_parts[1:])
                break
    
    # Enhanced DOB extraction with multiple formats
    dob_patterns = [
        r'(?:dob|date.*birth|birth.*date):\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})',
        r'(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})',
        r'born:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})'
    ]
    
    for pattern in dob_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            patient["dob"] = match.group(1)
            break
    
    # Enhanced MRN/ID extraction
    mrn_patterns = [
        r'(?:mrn|medical.*record|patient.*id):\s*([A-Z0-9\-]{4,15})',
        r'id:\s*([A-Z0-9\-]{4,15})',
        r'#\s*([A-Z0-9\-]{4,15})'
    ]
    
    for pattern in mrn_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            patient["mrn"] = match.group(1)
            break
    
    # Enhanced phone extraction with better formatting
    phone_patterns = [
        r'(?:phone|tel|telephone):\s*\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})',
        r'\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})'
    ]
    
    for pattern in phone_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            patient["phone_home"] = f"({match.group(1)}) {match.group(2)}-{match.group(3)}"
            break
    
    # Height and weight extraction
    height_match = re.search(r'height:\s*(\d+[\'\"]\s*\d*[\"\']*|\d+\s*(?:ft|feet).*?\d*\s*(?:in|inches)?)', text, re.IGNORECASE)
    if height_match:
        patient["height"] = height_match.group(1)
    
    weight_match = re.search(r'weight:\s*(\d+)\s*(?:lbs?|pounds?)', text, re.IGNORECASE)
    if weight_match:
        patient["weight"] = f"{weight_match.group(1)} lbs"
    
    # BMI extraction
    bmi_match = re.search(r'bmi:\s*(\d+\.?\d*)', text, re.IGNORECASE)
    if bmi_match:
        patient["bmi"] = bmi_match.group(1)
    
    return patient


def extract_insurance_info_enhanced(text: str, fuzzy_matcher: FuzzyPatternMatcher) -> Dict[str, Any]:
    """Extract insurance information with fuzzy matching"""
    insurance = {"primary": {}}
    
    # Use fuzzy matcher for insurance carrier
    fuzzy_insurance = fuzzy_matcher.extract_insurance_fuzzy(text)
    if fuzzy_insurance:
        insurance["primary"].update(fuzzy_insurance)
    
    # Direct pattern matching as backup
    insurance_patterns = [
        r'insurance:\s*([A-Za-z\s]+)(?:member|id)',
        r'carrier:\s*([A-Za-z\s]+)',
        r'(?:blue cross|bcbs|aetna|cigna|united|medicare|medicaid)'
    ]
    
    for pattern in insurance_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match and not insurance["primary"].get("carrier"):
            insurance["primary"]["carrier"] = match.group(1).strip()
            break
    
    return insurance


def extract_procedure_info_enhanced(text: str, preprocessor: OCRPreprocessor) -> Dict[str, Any]:
    """Extract procedure information with enhanced CPT code detection"""
    procedure = {}
    
    # Use enhanced CPT extraction
    cpt_codes = preprocessor.extract_cpt_codes_fuzzy(text)
    
    if cpt_codes:
        procedure["cpt"] = cpt_codes[0]  # Primary CPT code
        procedure["additional_cpts"] = cpt_codes[1:] if len(cpt_codes) > 1 else []
        
        # Map CPT codes to descriptions
        cpt_descriptions = {
            '95810': 'Polysomnography (6+ hours)',
            '95811': 'CPAP Titration Study',
            '95806': 'Sleep Study (unattended)',
            '95782': 'Positive Airway Pressure Titration',
            '95783': 'Positive Airway Pressure Treatment'
        }
        
        procedure["description"] = cpt_descriptions.get(procedure["cpt"], "Sleep Study")
    
    # Study type inference
    study_patterns = {
        'In-Lab Polysomnography': ['in-lab', 'polysomnography', 'psg', 'attended'],
        'Home Sleep Apnea Test': ['home', 'hsat', 'unattended', 'portable'],
        'MSLT': ['mslt', 'multiple sleep latency'],
        'MWT': ['mwt', 'maintenance of wakefulness'],
        'CPAP Titration': ['cpap', 'titration', 'pressure']
    }
    
    for study_type, keywords in study_patterns.items():
        if any(keyword in text.lower() for keyword in keywords):
            procedure["study_type"] = study_type
            break
    
    # Priority and authorization detection
    if re.search(r'urgent|stat|priority|emergent', text, re.IGNORECASE):
        procedure["priority"] = "High"
    elif re.search(r'routine|standard', text, re.IGNORECASE):
        procedure["priority"] = "Standard"
    else:
        procedure["priority"] = "Standard"
    
    if re.search(r'auth|authorization|pre-?auth', text, re.IGNORECASE):
        procedure["authorization_required"] = True
        auth_match = re.search(r'auth.*?#?\s*([A-Z0-9\-]{6,20})', text, re.IGNORECASE)
        if auth_match:
            procedure["authorization_number"] = auth_match.group(1)
    
    return procedure


def extract_physician_info_enhanced(text: str, fuzzy_matcher: FuzzyPatternMatcher) -> Dict[str, Any]:
    """Extract physician information with fuzzy matching"""
    physician = {}
    
    # Use fuzzy matcher
    fuzzy_provider = fuzzy_matcher.extract_provider_fuzzy(text)
    if fuzzy_provider:
        physician.update(fuzzy_provider)
    
    # Enhanced provider pattern matching
    provider_patterns = [
        r'provider:\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),?\s*(MD|DO|NP|PA)?',
        r'referring.*?(?:physician|doctor|provider):\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)',
        r'ordered by:\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)'
    ]
    
    for pattern in provider_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match and not physician.get("name"):
            name = match.group(1).strip()
            title = match.group(2) if len(match.groups()) > 1 else None
            physician["name"] = f"Dr. {name}"
            if title:
                physician["name"] += f", {title.upper()}"
            break
    
    return physician


def extract_clinical_info_enhanced(text: str) -> Dict[str, Any]:
    """Extract clinical information with enhanced pattern matching"""
    clinical = {
        "vitals": {},
        "alerts": {},
        "symptoms": [],
        "medications": [],
        "assessments": [],
        "requested_studies": []
    }
    
    # Enhanced vitals extraction
    vitals_patterns = {
        "height": r'height:\s*(\d+[\'\"]\s*\d*[\"\']*|\d+\s*(?:ft|feet).*?\d*\s*(?:in|inches)?)',
        "weight": r'weight:\s*(\d+)\s*(?:lbs?|pounds?)',
        "bmi": r'bmi:\s*(\d+\.?\d*)',
        "blood_pressure": r'(?:bp|blood pressure):\s*(\d+\/\d+)',
        "neck_circumference": r'neck.*?circumference:\s*(\d+\.?\d*)\s*(?:inches?|in)',
        "mallampati_score": r'mallampati.*?(?:score|class):\s*([IVX1-4]+)'
    }
    
    for vital, pattern in vitals_patterns.items():
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            value = match.group(1)
            if vital == "bmi":
                clinical["vitals"][vital] = float(value)
            elif vital == "neck_circumference":
                clinical["vitals"]["neck_circumference_in"] = float(value)
            else:
                clinical["vitals"][vital] = value
    
    # Enhanced symptom detection
    symptom_keywords = [
        'snoring', 'loud snoring', 'witnessed apneas', 'breathing pauses',
        'gasping', 'choking', 'excessive daytime sleepiness', 'morning headaches',
        'difficulty concentrating', 'irritability', 'restless sleep', 
        'unrefreshing sleep', 'nocturia', 'fatigue', 'memory problems'
    ]
    
    for symptom in symptom_keywords:
        if symptom.lower() in text.lower():
            clinical["symptoms"].append(symptom.lower())
    
    # Epworth Sleepiness Scale extraction
    epworth_match = re.search(r'epworth.*?(?:scale|score):\s*(\d+)', text, re.IGNORECASE)
    if epworth_match:
        clinical["epworth_score"] = int(epworth_match.group(1))
    
    # Medication extraction
    med_section = re.search(r'(?:current\s+)?medications?:(.+?)(?:[A-Z][A-Z\s]*:|$)', text, re.IGNORECASE | re.DOTALL)
    if med_section:
        med_text = med_section.group(1)
        med_patterns = [
            r'([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(\d+(?:\.\d+)?)\s*mg',
            r'([A-Z][a-z]+)\s+(\d+)\s*mg'
        ]
        
        for pattern in med_patterns:
            matches = re.findall(pattern, med_text)
            for match in matches:
                clinical["medications"].append({
                    "name": match[0],
                    "dose": f"{match[1]}mg"
                })
    
    # Clinical assessment extraction
    assessment_section = re.search(r'(?:clinical\s+)?impression:(.+?)(?:[A-Z][A-Z\s]*:|$)', text, re.IGNORECASE | re.DOTALL)
    if assessment_section:
        assessment = assessment_section.group(1).strip()
        clinical["assessments"].append(assessment)
    
    return clinical


def derive_flags_enhanced(text: str, form: Dict, current_date: date, rules: Dict, 
                         ocr_confidence: float, confidence_analysis: Dict) -> List[str]:
    """Enhanced flag derivation with confidence considerations"""
    flags = []
    
    # Existing flag logic
    existing_flags = derive_flags(text, form, current_date, rules, ocr_confidence)
    flags.extend(existing_flags)
    
    # Add confidence-based flags
    if confidence_analysis['confidence_score'] < 0.5:
        flags.append("LOW_EXTRACTION_CONFIDENCE")
    
    if confidence_analysis['missing_critical_fields']:
        flags.append("MISSING_CRITICAL_DATA")
    
    if confidence_analysis['manual_review_required']:
        flags.append("MANUAL_REVIEW_REQUIRED")
    
    # OCR quality flags
    if ocr_confidence < 0.8:
        flags.append("LOW_OCR_QUALITY")
    
    if ocr_confidence < 0.6:
        flags.append("VERY_LOW_OCR_QUALITY")
    
    return list(set(flags))  # Remove duplicates


def flags_to_actions_enhanced(flags: List[str], catalog: Dict, confidence_analysis: Dict) -> List[str]:
    """Enhanced action generation with confidence considerations"""
    actions = []
    
    # Get base actions
    base_actions = flags_to_actions(flags, catalog)
    actions.extend(base_actions)
    
    # Add confidence-based actions
    if confidence_analysis['manual_review_required']:
        actions.append("Manual review required - low extraction confidence")
    
    if "LOW_OCR_QUALITY" in flags:
        actions.append("Consider re-scanning document for better quality")
    
    if "MISSING_CRITICAL_DATA" in flags:
        missing = confidence_analysis['missing_critical_fields']
        actions.append(f"Verify missing critical data: {', '.join(missing)}")
    
    return list(set(actions))  # Remove duplicates
    
    # Enhanced name extraction - handle various formats including OCR without line breaks
    name_patterns = [
        r'(?:PATIENT\s+INFORMATION\s+)?Name:\s*([A-Za-z\s]+?)(?:\s+DOB|\s+MRN|\s+Phone|$)',  # Name: John Doe DOB:
        r'patient:\s*([A-Za-z\s]+?)(?:\s+dob|\s+mrn|\s+phone|$)',  # PATIENT: Name format
        r'(?:patient\s+)?name:\s*([A-Za-z\s]+?)(?:\s+dob|\s+mrn|\s+phone|$)',
        r'patient\s+information[^\n]*\s+name:\s*([A-Za-z\s]+)',
        r'name:\s*([A-Za-z\s,]+?)(?:\s+dob|\s+mrn|\n)',
        r'patient\s+name:\s*([A-Za-z\s]+)',
        r'full\s+name:\s*([A-Za-z\s]+)'
    ]
    
    for pattern in name_patterns:
        name_match = re.search(pattern, text, re.IGNORECASE)
        if name_match:
            full_name = name_match.group(1).strip()
            # Handle "Last, First" or "First Last" formats
            if ',' in full_name:
                parts = [p.strip() for p in full_name.split(',')]
                if len(parts) >= 2:
                    patient["last_name"] = parts[0]
                    patient["first_name"] = parts[1]
            else:
                name_parts = full_name.split()
                if len(name_parts) >= 2:
                    patient["first_name"] = name_parts[0]
                    patient["last_name"] = ' '.join(name_parts[1:])
            break
    
    # Enhanced DOB extraction
    dob_patterns = [
        r'(?:dob|date of birth):\s*(\d{1,2}/\d{1,2}/\d{4})',
        r'(?:dob|date of birth):\s*(\d{1,2}-\d{1,2}-\d{4})',
        r'born:?\s*(\d{1,2}/\d{1,2}/\d{4})'
    ]
    
    for pattern in dob_patterns:
        dob_match = re.search(pattern, text, re.IGNORECASE)
        if dob_match:
            patient["dob"] = dob_match.group(1)
            break
    
    # MRN extraction with multiple formats
    mrn_patterns = [
        r'(?:mrn|medical record|patient id):\s*([A-Z0-9-]+)',
        r'id:\s*([A-Z0-9-]+)',
        r'patient\s+id:\s*([A-Z0-9-]+)'
    ]
    
    for pattern in mrn_patterns:
        mrn_match = re.search(pattern, text, re.IGNORECASE)
        if mrn_match:
            patient["mrn"] = mrn_match.group(1)
            break
    
    # Enhanced phone extraction
    phone_patterns = [
        r'phone:\s*(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})',
        r'tel:\s*(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})',
        r'contact:\s*(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})'
    ]
    
    for pattern in phone_patterns:
        phone_match = re.search(pattern, text, re.IGNORECASE)
        if phone_match:
            patient["phone_home"] = phone_match.group(1)
            break
    
    # Extract additional demographics from physical exam
    height_match = re.search(r'height:\s*(\d+[\'"]?\d*[\'"]?|\d+\'\s*\d+"|[56]\s*[\']\s*\d+)', text, re.IGNORECASE)
    if height_match:
        patient["height"] = height_match.group(1)
    
    weight_match = re.search(r'weight:\s*(\d+)\s*(?:lbs?|pounds?)', text, re.IGNORECASE)
    if weight_match:
        patient["weight"] = weight_match.group(1) + " lbs"
    
    # BMI extraction
    bmi_match = re.search(r'bmi:\s*(\d+\.?\d*)', text, re.IGNORECASE)
    if bmi_match:
        patient["bmi"] = bmi_match.group(1)
    
    return patient


def extract_referral_info(text: str) -> Dict[str, Any]:
    """Extract referral information with enhanced pattern matching"""
    referral = {}
    
    # Enhanced date extraction - multiple formats and locations
    date_patterns = [
        r'SLEEP MEDICINE REFERRAL FORM\s+Date:\s*(\d{1,2}/\d{1,2}/\d{4})',
        r'(?:date|referral date):\s*(\d{1,2}/\d{1,2}/\d{4})',
        r'(?:date|referral date):\s*(\d{1,2}-\d{1,2}-\d{4})',
        r'sleep medicine referral form\s+date:\s*(\d{1,2}/\d{1,2}/\d{4})',
        r'form date:\s*(\d{1,2}/\d{1,2}/\d{4})'
    ]
    
    for pattern in date_patterns:
        date_match = re.search(pattern, text, re.IGNORECASE)
        if date_match:
            referral["date"] = date_match.group(1)
            break
    
    # Extract referring provider - handle OCR format better
    provider_patterns = [
        r'Provider:\s*(Dr\.\s*[A-Za-z\s,]+?)(?:\s+Sleep Medicine|\s+PATIENT|$)',
        r'provider:\s*([A-Za-z\s,\.]+?)(?:\s+sleep medicine|\s+patient|$)',
        r'referring physician:\s*([A-Za-z\s,\.]+)',
        r'physician:\s*([A-Za-z\s,\.]+)'
    ]
    
    for pattern in provider_patterns:
        provider_match = re.search(pattern, text, re.IGNORECASE)
        if provider_match:
            referral["referring_provider"] = provider_match.group(1).strip()
            break
    
    # Extract study requested
    study_patterns = [
        r'study requested[:\s]*([^\n]+)',
        r'test requested[:\s]*([^\n]+)',
        r'procedure ordered[:\s]*([^\n]+)'
    ]
    
    for pattern in study_patterns:
        study_match = re.search(pattern, text, re.IGNORECASE)
        if study_match:
            referral["study_requested"] = study_match.group(1).strip()
            break
    
    return referral


def extract_insurance_info(text: str) -> Dict[str, Any]:
    """Extract insurance information"""
    insurance = {"primary": {}}
    
    # Enhanced insurance carrier detection with regex patterns
    import re
    carrier_patterns = [
        (r'blue cross blue shield', 'Blue Cross Blue Shield'),
        (r'bcbs', 'Blue Cross Blue Shield'),
        (r'blue cross', 'Blue Cross Blue Shield'),
        (r'aetna', 'Aetna'),
        (r'anthem', 'Anthem'),
        (r'cigna', 'Cigna'),
        (r'humana', 'Humana'),
        (r'kaiser', 'Kaiser Permanente'),
        (r'medicare', 'Medicare'),
        (r'medicaid', 'Medicaid'),
        (r'prominence', 'Prominence Health'),
        (r'uhc|united health', 'United Healthcare'),
        (r'united healthcare', 'United Healthcare')
    ]
    
    # Check for insurance name patterns
    insurance_match = re.search(r'insurance:\s*([^\n\r]+?)(?:\s+member|\s+policy|\n|$)', text, re.IGNORECASE)
    if insurance_match:
        insurance_text = insurance_match.group(1).strip()
        insurance["primary"]["carrier"] = insurance_text
        
        # Also check against known patterns for standardization
        for pattern, standard_name in carrier_patterns:
            if re.search(pattern, insurance_text.lower()):
                insurance["primary"]["carrier"] = standard_name
                break
    else:
        # Fallback to pattern matching in full text
        for pattern, standard_name in carrier_patterns:
            if re.search(pattern, text.lower()):
                insurance["primary"]["carrier"] = standard_name
                break
    
    # Member ID with enhanced patterns
    member_patterns = [
        r'member\s+id:\s*([A-Z0-9-]+)',
        r'policy:\s*([A-Z0-9-]+)',
        r'member\s+#:\s*([A-Z0-9-]+)',
        r'id:\s*([A-Z0-9-]+)'
    ]
    
    for pattern in member_patterns:
        member_match = re.search(pattern, text, re.IGNORECASE)
        if member_match:
            insurance["primary"]["member_id"] = member_match.group(1)
            break
    
    return insurance


def extract_physician_info(text: str) -> Dict[str, Any]:
    """Extract referring physician information"""
    physician = {}
    
    # Physician name - handle OCR format better
    doc_patterns = [
        r'Provider:\s*(Dr\.\s*[A-Za-z\s,]+?)(?:\s+Sleep Medicine|\s+PATIENT|$)',
        r'(?:provider|physician|dr\.?|doctor):\s*([A-Za-z\s,\.]+?)(?:\s+sleep medicine|\s+patient|$)',
        r'(?:provider|physician|dr\.?|doctor):\s*([A-Za-z\s,\.]+)'
    ]
    
    for pattern in doc_patterns:
        doc_match = re.search(pattern, text, re.IGNORECASE)
        if doc_match:
            physician["name"] = doc_match.group(1).strip()
            break
    
    # Practice name
    practice_match = re.search(r'(?:practice|clinic|office):\s*([^\n]+)', text, re.IGNORECASE)
    if practice_match:
        physician["practice"] = practice_match.group(1).strip()
    
    return physician


def extract_procedure_info(text: str) -> Dict[str, Any]:
    """Extract comprehensive procedure/study information"""
    procedure = {}
    
    # Comprehensive study type patterns (prioritized by specificity)
    study_patterns = [
        ('split night study', 'Split Night Study'),
        ('split-night study', 'Split Night Study'),
        ('cpap titration study', 'CPAP Titration Study'),
        ('pressure titration', 'CPAP Titration Study'),
        ('home sleep apnea test', 'Home Sleep Apnea Test'),
        ('portable sleep study', 'Home Sleep Apnea Test'),
        ('unattended sleep study', 'Home Sleep Apnea Test'),
        ('attended sleep study', 'In-Lab Polysomnography'),
        ('overnight sleep study', 'In-Lab Polysomnography'),
        ('multiple sleep latency test', 'Multiple Sleep Latency Test'),
        ('maintenance of wakefulness test', 'Maintenance of Wakefulness Test'),
        ('polysomnography', 'In-Lab Polysomnography'),
        ('home sleep test', 'Home Sleep Apnea Test'),
        ('daytime sleep study', 'Multiple Sleep Latency Test'),
        ('sleep study', 'Sleep Study'),
        ('hsat', 'Home Sleep Apnea Test'),
        ('mslt', 'Multiple Sleep Latency Test'),
        ('mwt', 'Maintenance of Wakefulness Test'),
        ('psg', 'In-Lab Polysomnography')
    ]
    
    # Find study type (first match wins due to priority ordering)
    for pattern, study_type in study_patterns:
        if pattern in text.lower():
            procedure["study_type"] = study_type
            break
    
    # Enhanced CPT codes for sleep studies with regex matching
    import re
    cpt_matches = re.findall(r'\b(95806|95810|95811|95782|95783|G0399|G0398|95800|95801)\b', text)
    if cpt_matches:
        cpt = cpt_matches[0]
        cpt_descriptions = {
            '95806': 'Home Sleep Apnea Test (Type II)',
            '95810': 'Polysomnography (6+ hours)',
            '95811': 'CPAP Titration Study',
            'G0399': 'Home Sleep Test (Medicare)',
            'G0398': 'Home Sleep Test Initial',
            '95782': 'Pediatric Sleep Study (<6 years)',
            '95783': 'Pediatric CPAP Titration',
            '95800': 'Sleep Study (Multiple Sleep Latency)',
            '95801': 'Sleep Study (Maintenance of Wakefulness)'
        }
        procedure["cpt"] = cpt
        procedure["description"] = cpt_descriptions.get(cpt, f"Sleep Study (CPT {cpt})")
    
    # Priority and urgency detection
    priority_patterns = [
        r'urgent(?:ly)?(?:\s+needed)?',
        r'stat(?:\s+order)?', 
        r'emergency(?:\s+referral)?',
        r'rush(?:\s+order)?',
        r'expedite(?:d)?',
        r'asap',
        r'priority(?:\s+1)?',
        r'high priority'
    ]
    
    for pattern in priority_patterns:
        if re.search(pattern, text.lower()):
            procedure["priority"] = "High"
            break
    else:
        # Check for routine indicators
        if any(word in text.lower() for word in ['routine', 'standard', 'regular', 'non-urgent']):
            procedure["priority"] = "Routine"
        else:
            procedure["priority"] = "Standard"
    
    # Enhanced titration and equipment indicators
    titration_keywords = [
        'titration', 'cpap pressure', 'auto-titration', 'pressure optimization',
        'mask fitting', 'compliance check', 'leak assessment', 'comfort evaluation',
        'bilevel', 'bipap', 'apap', 'auto-cpap', 'pressure relief', 'ramp',
        'humidification', 'heated tubing'
    ]
    if any(keyword in text.lower() for keyword in titration_keywords):
        procedure["titration_requested"] = True
    
    # Split night study detection
    if any(phrase in text.lower() for phrase in ['split night', 'diagnostic portion', 'therapeutic portion']):
        procedure["split_night"] = True
    
    # Insurance authorization detection
    auth_patterns = [
        r'pre-?auth(?:orization)?(?:\s+(?:required|needed|pending))?',
        r'insurance(?:\s+approval)?(?:\s+(?:required|needed|pending))?',
        r'authorization(?:\s+(?:#|number|ref):\s*(\w+))?',
        r'auth(?:\s+(?:#|number):\s*(\w+))?'
    ]
    
    for pattern in auth_patterns:
        match = re.search(pattern, text.lower())
        if match:
            procedure["authorization_required"] = True
            if len(match.groups()) > 0 and match.group(1):
                procedure["authorization_number"] = match.group(1).upper()
            break
    
    # Equipment needs detection
    equipment_patterns = {
        'cpap': 'CPAP Machine',
        'bipap': 'BiPAP Machine', 
        'auto-cpap': 'Auto-CPAP Machine',
        'apap': 'Auto-CPAP Machine',
        'mask': 'CPAP Mask',
        'nasal pillow': 'Nasal Pillow Mask',
        'full face': 'Full Face Mask',
        'nasal mask': 'Nasal Mask'
    }
    
    equipment_needed = []
    for pattern, equipment in equipment_patterns.items():
        if pattern in text.lower():
            equipment_needed.append(equipment)
    
    if equipment_needed:
        procedure["equipment_needed"] = list(set(equipment_needed))  # Remove duplicates
    
    return procedure


def extract_clinical_info(text: str) -> Dict[str, Any]:
    """Extract comprehensive clinical information from sleep medicine forms"""
    clinical = {"vitals": {}, "alerts": {}, "symptoms": [], "medications": [], "assessments": []}
    
    # Extract vital signs and physical exam findings
    vitals = {}
    
    # Height extraction (multiple formats)
    height_patterns = [
        r'height:\s*(\d+[\'\"]\s*\d*[\'\"]*|\d+\'\s*\d+\"|\d+\s*ft\s*\d+\s*in)',
        r'height:\s*(\d+\.\d+)\s*(?:m|meters)',
        r'height:\s*(\d+)\s*(?:cm|centimeters)'
    ]
    
    for pattern in height_patterns:
        height_match = re.search(pattern, text, re.IGNORECASE)
        if height_match:
            vitals["height"] = height_match.group(1)
            break
    
    # Weight extraction
    weight_match = re.search(r'weight:\s*(\d+)\s*(?:lbs?|pounds?|kg)', text, re.IGNORECASE)
    if weight_match:
        vitals["weight"] = weight_match.group(1) + " lbs"
    
    # BMI extraction
    bmi_match = re.search(r'bmi:\s*(\d+\.?\d*)', text, re.IGNORECASE)
    if bmi_match:
        vitals["bmi"] = float(bmi_match.group(1))
    
    # Blood pressure extraction
    bp_match = re.search(r'(?:blood pressure|bp):\s*(\d+/\d+)', text, re.IGNORECASE)
    if bp_match:
        vitals["blood_pressure"] = bp_match.group(1)
    
    # Neck circumference
    neck_match = re.search(r'neck circumference:\s*(\d+)\s*(?:inches?|in|cm)', text, re.IGNORECASE)
    if neck_match:
        vitals["neck_circumference_in"] = float(neck_match.group(1))
    
    # Mallampati score
    mallampati_match = re.search(r'mallampati\s*(?:score)?:\s*(i{1,4}|\d)', text, re.IGNORECASE)
    if mallampati_match:
        vitals["mallampati_score"] = mallampati_match.group(1)
    
    clinical["vitals"] = vitals
    
    # Extract symptoms (sleep medicine specific)
    sleep_symptoms = [
        'snoring', 'loud snoring', 'witnessed apneas', 'breathing pauses', 
        'gasping', 'choking', 'excessive daytime sleepiness', 'morning headaches',
        'difficulty concentrating', 'irritability', 'restless sleep', 
        'unrefreshing sleep', 'nocturia', 'insomnia', 'sleep onset difficulty'
    ]
    
    symptoms_found = []
    text_lower = text.lower()
    for symptom in sleep_symptoms:
        if symptom in text_lower:
            symptoms_found.append(symptom)
    
    clinical["symptoms"] = symptoms_found
    
    # Epworth score
    epworth_match = re.search(r'epworth.*?(\d+)', text, re.IGNORECASE)
    if epworth_match:
        clinical["epworth_score"] = int(epworth_match.group(1))
    
    # Extract current medications
    medications = []
    # Look for medication section
    med_section_match = re.search(r'(?:current\s*)?medications?[:\s]*([^A-Z]+?)(?=[A-Z][A-Z]|$)', text, re.IGNORECASE | re.DOTALL)
    if med_section_match:
        med_text = med_section_match.group(1)
        # Extract individual medications with dosages
        med_patterns = [
            r'(\w+\s+\d+mg\s+\w+)',  # Medicine with dosage and frequency
            r'(\w+\s+\d+mg)',  # Medicine with dosage
        ]
        
        for pattern in med_patterns:
            for match in re.finditer(pattern, med_text, re.IGNORECASE):
                medications.append(match.group(0).strip())
    
    clinical["medications"] = medications
    
    # Extract clinical assessments/impressions
    assessment_patterns = [
        r'(?:clinical\s*)?impression[:\s]*([^\n\r]+)',
        r'assessment[:\s]*([^\n\r]+)',
        r'diagnosis[:\s]*([^\n\r]+)'
    ]
    
    assessments = []
    for pattern in assessment_patterns:
        assessment_match = re.search(pattern, text, re.IGNORECASE)
        if assessment_match:
            assessments.append(assessment_match.group(1).strip())
    
    clinical["assessments"] = assessments
    
    # Extract sleep study requests
    study_types = []
    if 'polysomnography' in text_lower or 'psg' in text_lower:
        study_types.append('PSG')
    if 'home sleep' in text_lower or 'hsat' in text_lower:
        study_types.append('HSAT')
    if 'mslt' in text_lower or 'multiple sleep latency' in text_lower:
        study_types.append('MSLT')
    if 'mwt' in text_lower or 'maintenance of wakefulness' in text_lower:
        study_types.append('MWT')
    
    clinical["requested_studies"] = study_types
    
    return clinical


def extract_dme_info(text: str) -> Dict[str, Any]:
    """Extract DME (Durable Medical Equipment) information"""
    dme = {}
    
    # HCPCS codes
    hcpcs_codes = ['E0601', 'E0470', 'E0471', 'E0561']
    found_hcpcs = []
    
    for code in hcpcs_codes:
        if code in text:
            found_hcpcs.append(code)
    
    if found_hcpcs:
        dme["hcpcs"] = found_hcpcs
    
    # DME providers
    providers = ['Apria', 'Lincare', 'ResMed', 'Philips', 'Rotech']
    found_providers = []
    
    for provider in providers:
        if provider.lower() in text.lower():
            found_providers.append(provider)
    
    if found_providers:
        dme["providers"] = found_providers
    
    return dme


def main():
    """Extract and output JSON for backend integration"""
    if len(sys.argv) < 2:
        print("Usage: python3 enhanced_extract.py <input_file>")
        return
    
    input_file = sys.argv[1]
    
    try:
        with open(input_file, 'r') as f:
            ocr_text = f.read()
        
        # Extract form data with flagging
        form_data = extract_patient_form(ocr_text, ocr_confidence=0.94)
        
        # Output JSON for backend consumption
        print(json.dumps(form_data))
        
    except FileNotFoundError:
        print(f"Error: File '{input_file}' not found")
    except Exception as e:
        print(f"Error: {e}")

def calculate_age_from_dob(dob_str: str) -> Optional[int]:
    """Calculate age from date of birth string"""
    if not dob_str:
        return None
    
    try:
        # Parse various date formats
        for fmt in ['%m/%d/%Y', '%m-%d-%Y', '%m/%d/%y', '%m-%d-%y']:
            try:
                dob = datetime.strptime(dob_str, fmt).date()
                today = date.today()
                age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
                return age
            except ValueError:
                continue
    except:
        pass
    
    return None

def determine_study_type(cpt_code) -> str:
    """Determine sleep study type from CPT code (accepts str or list)."""
    if isinstance(cpt_code, list):
        cpt_code = cpt_code[0] if cpt_code else ''
    cpt_map = {
        '95810': 'Polysomnography with CPAP',
        '95811': 'Polysomnography with BiPAP',
        '95806': 'Sleep study with CPAP titration',
        '95782': 'Unattended home sleep study',
        '95783': 'Unattended home sleep study with oxygen',
        'G0399': 'Home sleep study',
        'G0398': 'Home sleep study interpretation'
    }
    return cpt_map.get(str(cpt_code), 'Sleep study')

def analyze_medical_form_legacy(ocr_text: str, ocr_confidence: float = 0.0) -> Dict[str, Any]:
    """
    Legacy fallback extraction method using basic pattern matching
    """
    # Initialize preprocessor and fuzzy matcher for fallback
    preprocessor = OCRPreprocessor()
    fuzzy_matcher = FuzzyPatternMatcher()
    
    # Apply OCR error correction
    corrected_text = preprocessor.correct_ocr_text(ocr_text)
    
    # Initialize basic form structure
    form = {
        "doc_type": "referral",
        "original_text": ocr_text,
        "corrected_text": corrected_text,
        "processing_timestamp": datetime.now().isoformat(),
        "extraction_method": "legacy_fallback"
    }
    
    # Basic pattern extraction (simplified)
    form["patient"] = extract_patient_info_basic(corrected_text)
    # Derive first/last name if possible for compatibility
    pname = form["patient"].get("name", "").strip()
    if pname and ("first_name" not in form["patient"] or "last_name" not in form["patient"]):
        parts = pname.split()
        if len(parts) >= 2:
            form["patient"]["first_name"] = parts[0]
            form["patient"]["last_name"] = " ".join(parts[1:])
    form["insurance"] = {"primary": {}}
    form["physician"] = {"referring": {}}
    form["procedure"] = {"cpt_codes": []}
    form["clinical"] = {}
    
    # Low confidence for fallback method
    form["confidence_scores"] = {
        "overall_confidence": 0.1,
        "ocr_confidence": ocr_confidence
    }
    # Alias for frontend parity
    form["overall_confidence"] = 0.1
    
    return form

def extract_patient_info_basic(text: str) -> Dict[str, Any]:
    """Basic patient info extraction for fallback"""
    patient_info = {
        "name": "",
        "dob": "",
        "phone": "",
        "age": None
    }
    
    # Simple name pattern
    name_match = re.search(r'([A-Z][a-z]+\s+[A-Z][a-z]+)', text)
    if name_match:
        patient_info["name"] = name_match.group(1)
    
    # Simple DOB pattern
    dob_match = re.search(r'(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})', text)
    if dob_match:
        patient_info["dob"] = dob_match.group(1)
        patient_info["age"] = calculate_age_from_dob(dob_match.group(1))
    
    return patient_info


if __name__ == "__main__":
    import sys
    main()
