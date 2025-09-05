"""
Advanced Template Matching and Inference System
Uses semantic analysis and contextual pattern matching for better extraction.
"""

import re
import json
from typing import Dict, List, Any, Optional
from difflib import SequenceMatcher
from collections import defaultdict

# Try to import spacy, but continue without it if not available
try:
    import spacy
    SPACY_AVAILABLE = True
except ImportError:
    SPACY_AVAILABLE = False
    spacy = None


class SemanticTemplateMapper:
    """
    Advanced template mapping using semantic analysis and contextual understanding
    """

    def __init__(self):
        # Try to load spaCy model, fallback to simple patterns if not available
        if SPACY_AVAILABLE:
            try:
                self.nlp = spacy.load("en_core_web_sm")
                self.use_spacy = True
            except OSError:
                print("spaCy model not found, using pattern-based approach")
                self.nlp = None
                self.use_spacy = False
        else:
            print("spaCy not available, using pattern-based approach")
            self.nlp = None
            self.use_spacy = False

        # Comprehensive medical form patterns with context
        self.field_patterns = {
            'patient_name': {
                'patterns': [
                    r"^([A-Z][a-zA-Z'\-]+\s+[A-Z][a-zA-Z'\-]+(?:\s+[A-Z][a-zA-Z'\-]+)?)\s+(?:DOB|D\.O\.B)",
                    r"(?:patient|name):\s*([A-Z][a-zA-Z'\-]+\s+[A-Z][a-zA-Z'\-]+(?:\s+[A-Z][a-zA-Z'\-]+)?)\b",
                    r"PATIENT\s+INFORMATION.*?Name:?\s*([A-Z][a-zA-Z'\-]+\s+[A-Z][a-zA-Z'\-]+)",
                    r"PATIENT\s+NAME:?\s*([A-Z][a-zA-Z'\-]+\s+[A-Z][a-zA-Z'\-]+(?:\s+[A-Z][a-zA-Z'\-]+)?)",
                    r"Patient:\s*([A-Z][a-zA-Z'\-]+\s+[A-Z][a-zA-Z'\-]+)\s+DOB"
                ],
                'context_words': ['patient', 'name', 'individual'],
                'required': True
            },
            'date_of_birth': {
                'patterns': [
                    r'(?:dob|d\.o\.b|date.*?birth|birth.*?date):\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})',
                    r'born:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})',
                    r'DOB:\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})',
                    r'DOB\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})',
                    r'DOB\s*[:\-]?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})'
                ],
                'context_words': ['birth', 'born', 'dob'],
                'required': True
            },
            'insurance_carrier': {
                'patterns': [
                    r'insurance:\s*([A-Za-z\s]+?)(?:\s+member|\s+id|\s+policy|$)',
                    r'carrier:\s*([A-Za-z\s]+)',
                    r'(blue\s+cross\s+blue\s+shield|bcbs|aetna|cigna|united\s*health|medicare|medicaid|humana|kaiser)',
                    r'primary.*?insurance:?\s*([A-Za-z\s]+)'
                ],
                'context_words': ['insurance', 'carrier', 'policy', 'coverage'],
                'fuzzy_targets': ['Blue Cross Blue Shield', 'BCBS', 'Aetna', 'Cigna', 'UnitedHealthcare', 'Medicare', 'Medicaid'],
                'required': False
            },
            'member_id': {
                'patterns': [
                    r'(?:member|policy).*?id.*?([A-Z]{2,4}[-\s]?\d{6,12})',
                    r'\b(?:subscriber|policy)\s*id[:\s]*([A-Z0-9\-]{4,20})'
                ],
                'context_words': ['member', 'policy', 'identification'],
                'required': False
            },
            'mrn': {
                'patterns': [
                    r'\b[MI]RN[:\-\s]*([A-Z0-9\-]{3,20})',  # tolerate OCR M/I confusion & hyphen
                    r'medical\s*record\s*number[:\s]*([A-Z0-9\-]{3,20})',
                    r'\bMRN-([A-Z0-9\-]{3,20})'
                ],
                'context_words': ['mrn', 'record'],
                'required': False
            },
            'height': {
                'patterns': [
                    r'height[:\s]*([5-7]\'?\d{1,2}\"?)',
                    r'height[:\s]*(\d+\s*(?:cm|in|inch|inches))'
                ],
                'context_words': ['height'],
                'required': False
            },
            'weight': {
                'patterns': [
                    r'weight[:\s]*(\d{2,3})\s*(?:lbs|pounds|kg)',
                    r'wt[:\s]*(\d{2,3})\s*(?:lbs|pounds|kg)'
                ],
                'context_words': ['weight', 'wt'],
                'required': False
            },
            'bmi': {
                'patterns': [
                    r'\bBMI[:\s]*([0-9]{1,2}\.?[0-9]?)'
                ],
                'context_words': ['bmi'],
                'required': False
            },
            'blood_pressure': {
                'patterns': [
                    r'(?:blood\s*pressure|bp)[:\s]*(\d{2,3})\s*[/\\]\s*(\d{2,3})'
                ],
                'context_words': ['blood pressure', 'bp'],
                'required': False
            },
            'study_requested': {
                'patterns': [
                    r'(in-?lab\s+polysomnography\s*\(\s*psg\s*\))',
                    r'(home\s+sleep\s+apnea\s+test\s*\(\s*h[5s]at\s*\))',   # HSAT/H5AT
                    r'\b(?:hsat|h5at)\b',
                    r'\b(mslt|multiple\s+sleep\s+latency\s+test)\b',
                    r"\b(mw['’]?t|maintenance\s+of\s+wakefulness\s+test)\b",
                    r'cpap\s*[/|]?\s*bi\s*p\s*ap',
                    r'cpap\s*bi\s*pap',
                    r'cpapbipap'
                ],
                'context_words': ['psg', 'hsat', 'mslt', 'mwt', 'study', 'requested'],
                'required': False
            },
            'cpt_codes': {
                'patterns': [
                    r'cpt:?\s*(\d{5})',
                    r'code:?\s*(\d{5})',
                    r'\b(95800|95801|95805|95806|95807|95808|95810|95811|95782|95783|G0398|G0399)\b',
                    r'diagnostic.*?(\d{5})',
                    r'titration.*?(\d{5})',
                    r'polysomnography.*?(\d{5})',
                    r'sleep.*?study.*?(\d{5})'
                ],
                'context_words': ['cpt', 'code', 'procedure', 'study', 'diagnostic'],
                # Keep required True if you want to push for explicit codes; set False if you want higher overall confidence without codes present.
                'required': True
            },
            'provider_name': {
                'patterns': [
                    r'provider:\s*(dr\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)(?=\s+Patient|\s+[A-Z][a-z]+\s+presents|\s*$)',
                    r'provider:\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),?\s*MD',
                    r'(dr\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),?\s*MD',
                    r'referring.*?(?:physician|doctor):?\s*(dr\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)',
                    r'ordered\s+by:?\s*(dr\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)',
                    r'Provider:\s*(Dr\.?\s+[A-Za-z]+(?:\s+[A-Za-z]+)*)',
                    r'Provider:\s*([A-Za-z]+(?:\s+[A-Za-z]+)*),?\s*MD',
                    r'Dr\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*'  # loose fallback
                ],
                'context_words': ['provider', 'doctor', 'physician', 'referring'],
                'required': True
            },
            'provider_specialty': {
                'patterns': [
                    r'Specialty[:\s]*([A-Za-z ]+)',
                    r'Provider\s*Specialty[:\s]*([A-Za-z ]+)',
                    r'Pulmonary|Sleep\s*Medicine|Pulmonology'
                ],
                'context_words': ['specialty', 'provider'],
                'required': False
            },
            'provider_npi': {
                'patterns': [
                    r'\bNPI[:\s]*([0-9]{8,15})\b'
                ],
                'context_words': ['npi', 'provider'],
                'required': False
            },
            'clinic_phone': {
                'patterns': [
                    r'Clinic\s*phone[:\s]*\((\d{3})\)\s*(\d{3})[-\s]?(\d{4})',
                    r'Clinic\s*Phone[:\s]*(\d{3})[-\s]?(\d{3})[-\s]?(\d{4})'
                ],
                'context_words': ['clinic', 'phone'],
                'required': False
            },
            'fax': {
                'patterns': [
                    r'Fax[:\s]*\((\d{3})\)\s*(\d{3})[-\s]?(\d{4})',
                    r'Fax[:\s]*(\d{3})[-\s]?(\d{3})[-\s]?(\d{4})'
                ],
                'context_words': ['fax'],
                'required': False
            },
            'authorization_number': {
                'patterns': [
                    r'Authorization(?:\s*number)?[:\s]*([A-Z0-9\-]{3,})'
                ],
                'context_words': ['authorization', 'auth'],
                'required': False
            },
            'document_date': {
                'patterns': [
                    r'(?:Referral\s*\/\s*order\s*date|Referral\s*order\s*date|Document\s*Date)[:\s]*([01]?\d\/[0-3]?\d\/\d{4})',
                    r'\bDate[:\s]*([01]?\d\/[0-3]?\d\/\d{4})\b'
                ],
                'context_words': ['referral', 'document', 'date'],
                'required': False
            },
            'intake_date': {
                'patterns': [
                    r'(?:Intake\s*\/\s*processing|Intake\s*Date)[:\s]*([01]?\d\/[0-3]?\d\/\d{4})'
                ],
                'context_words': ['intake', 'processing', 'date'],
                'required': False
            },
            'indication': {
                'patterns': [
                    r'(?:Indication|Primary\s*Diagnosis)[:\s]*([^\n]+)'
                ],
                'context_words': ['indication', 'diagnosis'],
                'required': False
            },
            'phone_number': {
                'patterns': [
                    r'(?:phone|tel|telephone):\s*\((\d{3})\)\s*(\d{3})[-\s]?(\d{4})',
                    r'phone:\s*\((\d{3})\)\s*(\d{3})-(\d{4})',
                    r'phone\s+\((\d{3})\)\s*(\d{3})[-\s]?(\d{4})',
                    r'Phone:\s*\((\d{3})\)\s*(\d{3})[-\s]?(\d{4})',
                    r'(?:phone|tel|telephone)[:\s]*?(\d{3})[-\s]?(\d{3})[-\s]?(\d{4})',
                    r'\b(\d{3})[-\s]?(\d{3})[-\s]?(\d{4})\b'
                ],
                'context_words': ['phone', 'telephone', 'contact'],
                'required': False
            },
            'epworth_score': {
                'patterns': [
                    r'epworth.*?scale.*?(\d{1,2})',
                    r'sleepiness.*?scale.*?(\d{1,2})',
                    r'ess.*?(\d{1,2})'
                ],
                'context_words': ['epworth', 'sleepiness', 'scale'],
                'required': False
            }
        }

    def extract_with_context(self, text: str) -> Dict[str, Any]:
        """
        Extract information using contextual analysis and semantic understanding
        """
        extracted: Dict[str, Any] = {}
        confidence_scores: Dict[str, float] = {}

        # Preprocess text for better matching
        text = self._preprocess_text(text)

        for field_name, field_config in self.field_patterns.items():
            result = self._extract_field_contextual(text, field_name, field_config)
            if result:
                extracted[field_name] = result['value']
                confidence_scores[field_name] = result['confidence']

        # Post-process and validate extracted data
        extracted = self._post_process_extracted_data(extracted, text)

        # Calculate overall confidence
        overall_confidence = 0.0
        if confidence_scores:
            overall_confidence = sum(confidence_scores.values()) / len(confidence_scores)

        return {
            'extracted_data': extracted,
            'confidence_scores': confidence_scores,
            'overall_confidence': overall_confidence,
            'extraction_method': 'contextual_semantic'
        }

    def _preprocess_text(self, text: str) -> str:
        """Clean and normalize text for better pattern matching while preserving newlines."""
        if not text:
            return ''

        # Normalize newlines first
        text = text.replace('\r', '\n')

        # Fix camel-case run-ons without removing newlines
        def _split_camel(m):
            return f"{m.group(1)} {m.group(2)}"
        text = re.sub(r'([a-z])([A-Z])', _split_camel, text)

        # Conservative corrections
        corrections = {
            r"\bIll\b": 'III',
            r"\b0(\d+)\b": r"\1",
            r"\bIbs\b": 'lbs',
            r"\boln-lab\b": 'in-lab',
            r"5°(\d+)": r"5'\1",
            r"(\d)°(\d+)\"": r"\1'\2\"",
            r"’": "'",
            r"“|”": '"',
            r"\bH4SAT\b": 'HSAT',
            r"\bH5AT\b": 'HSAT',
            r"\bMW['’]?T\b": 'MWT',
            r"CPAP\s*B\s*I\s*B\s*I\s*PAP": 'CPAP/BiPAP',
            r"CPAPBIBIPAP": 'CPAP/BiPAP',
            r"\bUnirefrshing\b": 'Unrefreshing',
            r"sleepin-": 'sleepiness',
            r"\bPR[rt]\.": 'PRN'
        }
        for pattern, replacement in corrections.items():
            text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)

        # Strip stray glyph noise without nuking line structure
        text = re.sub(r"[\[\]<>•·¤©™®]", " ", text)

        # Normalize horizontal whitespace but keep line boundaries
        text = re.sub(r"[ \t]+", " ", text)
        text = re.sub(r" +\n", "\n", text)
        text = re.sub(r"\n{3,}", "\n\n", text)

        return text.strip()

    def _extract_field_contextual(self, text: str, field_name: str, config: Dict) -> Optional[Dict]:
        """Extract a specific field using contextual patterns"""
        # Try direct pattern matching first
        for pattern in config['patterns']:
            matches = re.finditer(pattern, text, re.IGNORECASE | re.MULTILINE)
            for match in matches:
                # Special handling for blood_pressure
                if field_name == 'blood_pressure' and len(match.groups()) >= 2:
                    value = f"{match.group(1)}/{match.group(2)}"
                # Handle phone numbers with multiple groups specially
                elif field_name == 'phone_number' and len(match.groups()) >= 3:
                    value = f"({match.group(1)}) {match.group(2)}-{match.group(3)}"
                else:
                    value = match.group(1) if match.groups() else match.group()
                confidence = self._calculate_pattern_confidence(match, text, config)
                if confidence > 0.5:  # Minimum confidence threshold
                    return {
                        'value': self._clean_extracted_value(value, field_name),
                        'confidence': confidence,
                        'method': 'pattern_match'
                    }
        # Try fuzzy matching for specific fields
        if 'fuzzy_targets' in config:
            fuzzy_result = self._fuzzy_match_field(text, config['fuzzy_targets'], config['context_words'])
            if fuzzy_result:
                return fuzzy_result
        # Try semantic extraction if spaCy is available
        if self.use_spacy:
            semantic_result = self._semantic_extract_field(text, field_name, config)
            if semantic_result:
                return semantic_result
        return None

    def _calculate_pattern_confidence(self, match: re.Match, text: str, config: Dict) -> float:
        """Calculate confidence score for a pattern match"""
        base_confidence = 0.7
        # Boost confidence if context words are nearby
        context_boost = 0.0
        match_start = max(0, match.start() - 80)
        match_end = min(len(text), match.end() + 80)
        context = text[match_start:match_end].lower()
        for context_word in config.get('context_words', []):
            if context_word.lower() in context:
                context_boost += 0.1
        # Reduce confidence for very short matches
        length_penalty = 0.0
        if len(match.group()) < 3:
            length_penalty = 0.2
        return min(1.0, base_confidence + context_boost - length_penalty)

    def _fuzzy_match_field(self, text: str, targets: List[str], context_words: List[str]) -> Optional[Dict]:
        """Perform fuzzy matching for field values"""
        words = text.split()
        best_match = None
        best_ratio = 0.0

        for target in targets:
            for i in range(len(words)):
                for j in range(i + 1, min(i + len(target.split()) + 2, len(words) + 1)):
                    phrase = ' '.join(words[i:j])
                    ratio = SequenceMatcher(None, target.lower(), phrase.lower()).ratio()

                    if ratio > best_ratio and ratio > 0.6:
                        # Check if context words are nearby
                        context_score = self._get_context_score(words, i, j, context_words)
                        total_score = ratio * 0.7 + context_score * 0.3

                        if total_score > best_ratio:
                            best_ratio = total_score
                            best_match = phrase

        if best_match and best_ratio > 0.6:
            return {
                'value': best_match,
                'confidence': best_ratio,
                'method': 'fuzzy_match'
            }

        return None

    def _get_context_score(self, words: List[str], start: int, end: int, context_words: List[str]) -> float:
        """Calculate context score based on nearby words"""
        context_window = 5
        context_start = max(0, start - context_window)
        context_end = min(len(words), end + context_window)
        context_text = ' '.join(words[context_start:context_end]).lower()

        score = 0.0
        for context_word in context_words:
            if context_word.lower() in context_text:
                score += 1.0 / len(context_words)

        return score

    def _semantic_extract_field(self, text: str, field_name: str, config: Dict) -> Optional[Dict]:
        """Use spaCy for semantic extraction (if available)"""
        if not self.use_spacy:
            return None
        # Placeholder for advanced NLP-based extraction
        return None

    def _clean_extracted_value(self, value: str, field_name: str) -> str:
        """Clean and format extracted values"""
        value = value.strip()
        if field_name == 'patient_name':
            # Ensure proper capitalization
            return ' '.join(word.capitalize() for word in value.split())
        elif field_name in ('phone_number', 'clinic_phone', 'fax'):
            digits = re.sub(r'\D', '', value)
            if len(digits) == 10:
                return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
        elif field_name == 'insurance_carrier':
            # Standardize insurance names
            standardized = {
                'blue cross blue shield': 'Blue Cross Blue Shield',
                'bcbs': 'Blue Cross Blue Shield',
                'aetna': 'Aetna',
                'cigna': 'Cigna',
                'united healthcare': 'UnitedHealthcare',
                'unitedhealthcare': 'UnitedHealthcare'
            }
            return standardized.get(value.lower(), value.title())
        elif field_name == 'blood_pressure':
            # already formatted by extractor; no-op here
            return value
        elif field_name == 'height':
            # Ensure format like 5'10"
            v = value.replace(' ', '')
            v = v.replace("°", "'")
            return v
        return value

    def _post_process_extracted_data(self, extracted: Dict, text: str) -> Dict:
        """Post-process and validate extracted data"""

        # Infer missing CPT codes from study type mentions
        if 'cpt_codes' not in extracted or not extracted['cpt_codes']:
            inferred_cpt = self._infer_cpt_from_context(text)
            if inferred_cpt:
                extracted['cpt_codes'] = inferred_cpt

        # Try to recover missing insurance from context
        if 'insurance_carrier' not in extracted:
            inferred_insurance = self._infer_insurance_from_context(text)
            if inferred_insurance:
                extracted['insurance_carrier'] = inferred_insurance

        # Normalize Epworth Sleepiness Scale if present in text (e.g., 16/24)
        ep = re.search(r"epworth\s+sleepiness\s+scale\s*[:\-]?\s*(\d{1,2})\s*/\s*(\d{1,2})", text, re.IGNORECASE)
        if ep:
            extracted['epworth_structured'] = {
                'score': int(ep.group(1)),
                'total': int(ep.group(2))
            }

        # Detect common OSA-related symptoms from keywords
        symptom_map = {
            'loud snoring': r'\bloud\s+snor',
            'witnessed apneas': r'\bwitnessed\s+apnea',
            'gasping/choking during sleep': r'gasping|choking\s+during\s+sleep',
            'excessive daytime sleepiness': r'excessive\s+daytime\s+sleep',
            'morning headaches': r'morning\s+headache',
            'difficulty concentrating': r'difficulty\s+concentrat',
            'restless sleep': r'restless\s+sleep'
        }
        detected = []
        for label, patt in symptom_map.items():
            if re.search(patt, text, re.IGNORECASE):
                detected.append(label)
        if detected:
            extracted['symptoms_list'] = detected

        return extracted

    def _infer_cpt_from_context(self, text: str) -> Optional[List[str]]:
        """Infer CPT codes from study type context and return a list (unique, ordered)."""
        mapping = [
            (r'in-?lab.*?(polysomnography|psg)', '95810'),
            (r'cpap\s*.*?titration|titration.*?cpap', '95811'),
            (r'cpap\s*[/|]?\s*bi\s*p\s*ap|cpap\s*bi\s*pap|cpapbipap', '95811'),
            (r'home.*sleep.*(apnea)?\s*test|\bhsat\b|\bh5at\b', '95806'),
            (r'\bmslt\b|multiple\s+sleep\s+latency', '95805'),
            (r"\bmw['’]?t\b|maintenance\s+of\s+wakefulness", '95805')
        ]
        text_lower = text.lower()
        codes: List[str] = []
        for pattern, code in mapping:
            if re.search(pattern, text_lower):
                if code not in codes:
                    codes.append(code)
        return codes or None

    def _infer_insurance_from_context(self, text: str) -> Optional[str]:
        """Try to infer insurance from partial mentions or context"""
        partial_patterns = [
            r'blue\s+cross',
            r'bcbs',
            r'medicare',
            r'medicaid',
            r'aetna',
            r'cigna',
            r'united',
            r'humana',
            r'kaiser'
        ]

        for pattern in partial_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                matched_text = match.group().lower()
                if 'blue' in matched_text or 'bcbs' in matched_text:
                    return 'Blue Cross Blue Shield'
                elif 'medicare' in matched_text:
                    return 'Medicare'
                elif 'medicaid' in matched_text:
                    return 'Medicaid'
                elif 'aetna' in matched_text:
                    return 'Aetna'
                elif 'cigna' in matched_text:
                    return 'Cigna'
                elif 'united' in matched_text:
                    return 'UnitedHealthcare'
                elif 'humana' in matched_text:
                    return 'Humana'
                elif 'kaiser' in matched_text:
                    return 'Kaiser Permanente'

        return None


def enhanced_template_extraction(ocr_text: str, ocr_confidence: float = 0.0) -> Dict[str, Any]:
    """
    Enhanced template extraction using semantic mapping (canonical schema).
    """
    mapper = SemanticTemplateMapper()
    result = mapper.extract_with_context(ocr_text)

    extracted = result['extracted_data']
    confidences = result['confidence_scores']

    patient_data: Dict[str, Any] = {}
    insurance_data: Dict[str, Any] = {"primary": {}}
    procedure_data: Dict[str, Any] = {}
    physician_data: Dict[str, Any] = {}
    clinical_data: Dict[str, Any] = {}

    # Patient
    if 'patient_name' in extracted:
        parts = extracted['patient_name'].split()
        if len(parts) >= 2:
            patient_data['first_name'] = parts[0]
            patient_data['last_name'] = ' '.join(parts[1:])
    if 'date_of_birth' in extracted:
        patient_data['dob'] = extracted['date_of_birth']
    if 'mrn' in extracted:
        patient_data['mrn'] = extracted['mrn']
    if 'phone_number' in extracted:
        patient_data['phone_home'] = extracted['phone_number']

    # Vitals
    for k in ('height', 'weight', 'bmi', 'blood_pressure'):
        if k in extracted:
            patient_data[k] = extracted[k]

    # Insurance Primary
    if 'insurance_carrier' in extracted:
        insurance_data['primary']['carrier'] = extracted['insurance_carrier']
        insurance_data['primary']['confidence'] = confidences.get('insurance_carrier', 0.7)
    if 'member_id' in extracted:
        insurance_data['primary']['member_id'] = extracted['member_id']
    if 'authorization_number' in extracted:
        insurance_data['primary']['authorization_number'] = extracted['authorization_number']

    # Procedure
    if 'study_requested' in extracted:
        procedure_data['study_requested'] = extracted['study_requested']
    if 'cpt_codes' in extracted:
        codes = extracted['cpt_codes'] if isinstance(extracted['cpt_codes'], list) else [extracted['cpt_codes']]
        procedure_data['cpt'] = codes
        cpt_descriptions = {
            '95810': 'In-lab polysomnography (diagnostic, 6+ hours)',
            '95811': 'In-lab CPAP/BiPAP titration or split-night',
            '95808': 'Polysomnography; 1-3 parameters',
            '95807': 'PSG; 4 or more parameters',
            '95806': 'Home sleep apnea test (HSAT)',
            '95805': 'MSLT/MWT (sleepiness/wakefulness testing)',
            '95782': 'PSG pediatric under 6',
            '95783': 'PSG pediatric with titration',
            'G0398': 'Home sleep study type II',
            'G0399': 'Home sleep study type III'
        }
        procedure_data['description'] = [cpt_descriptions.get(c, 'Sleep Study') for c in codes]
    if 'indication' in extracted:
        procedure_data['indication'] = extracted['indication']

    # Physician (flattened)
    if 'provider_name' in extracted:
        physician_data['name'] = extracted['provider_name']
    if 'provider_specialty' in extracted:
        physician_data['specialty'] = extracted['provider_specialty']
    if 'provider_npi' in extracted:
        physician_data['npi'] = extracted['provider_npi']
    if 'clinic_phone' in extracted:
        physician_data['clinic_phone'] = extracted['clinic_phone']
    if 'fax' in extracted:
        physician_data['fax'] = extracted['fax']

    # Clinical
    if 'epworth_structured' in extracted:
        score = extracted['epworth_structured'].get('score')
        total = extracted['epworth_structured'].get('total', 24)
        if isinstance(score, int):
            clinical_data['epworth_score'] = f"{score}/{total}"
        else:
            clinical_data['epworth_score'] = extracted['epworth_structured']
    elif 'epworth_score' in extracted:
        try:
            clinical_data['epworth_score'] = f"{int(extracted['epworth_score'])}/24"
        except Exception:
            clinical_data['epworth_score'] = str(extracted['epworth_score'])
    if 'symptoms_list' in extracted:
        clinical_data['symptoms'] = extracted['symptoms_list']

    # Document / Metadata
    doc = extracted.get('document_date', '')
    intake = extracted.get('intake_date', '')

    # Overall confidence
    overall_conf = result['overall_confidence'] if result['overall_confidence'] else (ocr_confidence or 0.0)

    return {
        'patient': patient_data,
        'insurance': insurance_data,
        'procedure': procedure_data,
        'physician': physician_data,
        'clinical': clinical_data,
        'document_date': doc,
        'intake_date': intake,
        'confidence_scores': confidences,
        'extraction_method': result['extraction_method'],
        'overall_confidence': overall_conf
    }