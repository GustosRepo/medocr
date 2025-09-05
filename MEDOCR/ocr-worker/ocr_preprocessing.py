"""
Advanced OCR preprocessing and error correction module
Handles image enhancement, text cleaning, and error correction
"""

import re
import cv2
import numpy as np
from typing import Dict, List, Tuple, Any
from difflib import SequenceMatcher
from collections import Counter

class OCRPreprocessor:
    def __init__(self):
        # Common OCR character substitution errors
        self.char_corrections = {
            '0': ['O', 'o', 'Q'],
            '1': ['l', 'I', '|'],
            '2': ['Z', 'z'],
            '5': ['S', 's'],
            '6': ['G', 'b'],
            '8': ['B'],
            '9': ['g', 'q'],
            'o': ['0'],
            'O': ['0'],
            'l': ['1', 'I'],
            'I': ['1', 'l'],
            'S': ['5'],
            's': ['5'],
            'G': ['6'],
            'B': ['8'],
            'Z': ['2'],
            'z': ['2']
        }
        
        # Medical terminology corrections
        self.medical_corrections = {
            'polysomnography': ['polysomnogr.*', 'PSG', 'sleep study'],
            'cpap': ['C-?PAP', 'continuous positive'],
            'apnea': ['apn[ei]a', 'breathing.*pause'],
            'hypopnea': ['hyp[oa]pn[ei]a'],
            'epworth': ['epw[oa]rth', 'sleepiness.*scale'],
            'mallampati': ['malamp[ae]ti', 'airway.*class']
        }
        
        # CPT code patterns with fuzzy matching
        self.cpt_patterns = [
            r'CPT:?\s*(\d{5})',
            r'code:?\s*(\d{5})',
            r'\b(95800|95801|95805|95806|95807|95808|95810|95811|95782|95783)\b',
            r'\b(G0398|G0399)\b',
            r'diagnostic.*?(\d{5})',
            r'titration.*?(\d{5})'
        ]

    def preprocess_image(self, image_path: str) -> str:
        """Enhanced image preprocessing for better OCR"""
        try:
            # Load image
            img = cv2.imread(image_path)
            if img is None:
                return None
                
            # Convert to grayscale
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            
            # Noise reduction
            denoised = cv2.medianBlur(gray, 3)
            
            # Contrast enhancement
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
            enhanced = clahe.apply(denoised)
            
            # Morphological operations to clean up text
            kernel = np.ones((1,1), np.uint8)
            cleaned = cv2.morphologyEx(enhanced, cv2.MORPH_CLOSE, kernel)
            
            # Adaptive thresholding
            binary = cv2.adaptiveThreshold(
                cleaned, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, 
                cv2.THRESH_BINARY, 11, 2
            )
            
            # Save processed image using stem/suffix to avoid breaking filenames with dots
            from pathlib import Path
            p = Path(image_path)
            processed_path = str(p.with_name(f"{p.stem}_processed{p.suffix}"))
            cv2.imwrite(processed_path, binary)
            return processed_path
            
        except Exception as e:
            print(f"Image preprocessing failed: {e}")
            # Returning original image_path is an intentional fallback to keep the pipeline running
            return image_path

    def correct_ocr_text(self, text: str) -> str:
        """Apply OCR error corrections to text while preserving newlines for downstream regex."""
        if not text:
            return ''
        corrected = text

        # Obvious numeric OCR confusions in context
        corrected = re.sub(r'\bO(\d)', r'0\1', corrected)     # O followed by digit -> 0
        corrected = re.sub(r'(\d)O\b', r'\1 0', corrected)    # digit followed by O -> digit 0 (space to break glued tokens)
        corrected = re.sub(r'\bl(\d)', r'1\1', corrected)     # l followed by digit -> 1
        corrected = re.sub(r'(\d)l\b', r'\1 1', corrected)    # digit followed by l -> digit 1

        # Medical terminology fixes (conservative)
        medical_fixes = {
            r'\bpolysomnogr[a-z]*': 'polysomnography',
            r'\bepw[oa]rth': 'epworth',
            r'\bmalamp[ae]ti': 'mallampati',
            r'\bpulmonar[y|l]\b': 'pulmonary',
        }
        for pattern, replacement in medical_fixes.items():
            corrected = re.sub(pattern, replacement, corrected, flags=re.IGNORECASE)

        # Preserve newlines but normalize spaces
        corrected = corrected.replace('\r', '\n')
        corrected = re.sub(r'[ \t]+', ' ', corrected)    # collapse tabs/spaces
        corrected = re.sub(r' +\n', '\n', corrected)     # strip trailing spaces before newline
        corrected = re.sub(r'\n+', '\n', corrected)      # collapse multiple blank lines

        return corrected.strip()

    def extract_cpt_codes_fuzzy(self, text: str) -> List[str]:
        """Extract CPT codes with fuzzy matching"""
        cpt_codes = []
        
        # Direct pattern matching
        for pattern in self.cpt_patterns:
            matches = re.findall(pattern, text, re.IGNORECASE)
            cpt_codes.extend(matches)
        
        # Fuzzy matching for corrupted codes
        # Look for 5-digit numbers near sleep-related terms
        sleep_terms = ['sleep', 'psg', 'polysomnography', 'cpap', 'titration']
        
        for term in sleep_terms:
            # Find term and look for nearby 5-digit numbers
            term_matches = list(re.finditer(term, text, re.IGNORECASE))
            for match in term_matches:
                start = max(0, match.start() - 50)
                end = min(len(text), match.end() + 50)
                context = text[start:end]
                
                # Look for 5-digit codes in context
                codes = re.findall(r'\b\d{5}\b', context)
                for code in codes:
                    if code.startswith('958'):  # Sleep study codes start with 958
                        cpt_codes.append(code)
        
        return list(set(cpt_codes))  # Remove duplicates

class FuzzyPatternMatcher:
    """Fuzzy pattern matching for corrupted OCR text"""
    
    def __init__(self):
        self.insurance_carriers = [
            'Blue Cross Blue Shield', 'BCBS', 'Aetna', 'Cigna', 
            'UnitedHealthcare', 'Medicare', 'Medicaid', 'Humana',
            'Kaiser Permanente', 'Anthem'
        ]
        
        self.provider_titles = [
            'MD', 'DO', 'NP', 'PA', 'RN', 'Dr.', 'Doctor'
        ]

    def fuzzy_match(self, text: str, patterns: List[str], threshold: float = 0.6) -> List[Tuple[str, float]]:
        """Find fuzzy matches for patterns in text"""
        matches = []
        
        for pattern in patterns:
            # Split text into words for matching
            words = text.split()
            
            for i, word in enumerate(words):
                # Check single word match
                ratio = SequenceMatcher(None, pattern.lower(), word.lower()).ratio()
                if ratio >= threshold:
                    matches.append((word, ratio))
                
                # Check multi-word matches
                for j in range(i+1, min(i+4, len(words))):
                    phrase = ' '.join(words[i:j+1])
                    ratio = SequenceMatcher(None, pattern.lower(), phrase.lower()).ratio()
                    if ratio >= threshold:
                        matches.append((phrase, ratio))
        
        return sorted(matches, key=lambda x: x[1], reverse=True)

    def extract_insurance_fuzzy(self, text: str) -> Dict[str, Any]:
        """Extract insurance with fuzzy matching"""
        insurance = {}
        
        # Fuzzy match insurance carriers
        carrier_matches = self.fuzzy_match(text, self.insurance_carriers, threshold=0.7)
        if carrier_matches:
            insurance['carrier'] = carrier_matches[0][0]
            insurance['confidence'] = carrier_matches[0][1]
        
        # Extract member ID patterns
        id_patterns = [
            r'member.*id:?\s*([A-Z0-9-]{6,20})',
            r'id:?\s*([A-Z0-9-]{6,20})',
            r'policy:?\s*([A-Z0-9-]{6,20})'
        ]
        
        for pattern in id_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                insurance['member_id'] = match.group(1)
                break
        
        return insurance

    def extract_provider_fuzzy(self, text: str) -> Dict[str, Any]:
        """Extract provider information with fuzzy matching"""
        provider = {}
        
        # Look for provider names with titles
        provider_pattern = r'(?:Dr\.?|Doctor)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),?\s*(MD|DO|NP|PA)?'
        matches = re.findall(provider_pattern, text, re.IGNORECASE)
        
        if matches:
            name, title = matches[0]
            provider['name'] = f"Dr. {name}"
            if title:
                provider['name'] += f", {title.upper()}"
        
        return provider

def enhance_extraction_confidence(extracted_data: Dict, required_fields: List[str]) -> Dict[str, Any]:
    """Calculate confidence based on critical field extraction"""
    
    confidence_metrics = {
        'patient_name': 0.3,
        'dob': 0.2,
        'insurance': 0.2,
        'cpt_codes': 0.2,
        'provider': 0.1
    }
    
    score = 0.0
    missing_critical = []
    
    for field, weight in confidence_metrics.items():
        if field in required_fields:
            if field == 'patient_name':
                has_data = bool(extracted_data.get('patient', {}).get('first_name') and 
                               extracted_data.get('patient', {}).get('last_name'))
            elif field == 'insurance':
                has_data = bool(extracted_data.get('insurance', {}).get('primary', {}).get('carrier'))
            elif field == 'cpt_codes':
                has_data = bool(extracted_data.get('procedure', {}).get('cpt'))
            else:
                has_data = bool(extracted_data.get(field))
            
            if has_data:
                score += weight
            else:
                missing_critical.append(field)
    
    # Determine confidence level
    if score >= 0.9:
        confidence = "High"
    elif score >= 0.7:
        confidence = "Medium"
    elif score >= 0.5:
        confidence = "Low"
    else:
        confidence = "Manual Review Required"
    
    return {
        'confidence_score': score,
        'confidence_level': confidence,
        'missing_critical_fields': missing_critical,
        'manual_review_required': score < 0.7
    }
