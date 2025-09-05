#!/usr/bin/env python3
"""
Advanced Medical OCR Processor with dual engine support and intelligent preprocessing
"""

import argparse
import json
import mimetypes
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from difflib import get_close_matches
from typing import List, Tuple, Dict, Optional

import cv2
import numpy as np
import pytesseract
from PIL import Image

# PaddleOCR import (conditionally loaded)
try:
    from paddleocr import PaddleOCR
    PADDLE_AVAILABLE = True
except ImportError:
    PADDLE_AVAILABLE = False
    print("Warning: PaddleOCR not available. Install with: pip install paddleocr", file=sys.stderr)

# PDF processing imports
try:
    from pdf2image import convert_from_path
    PDF2IMAGE_AVAILABLE = True
except ImportError:
    PDF2IMAGE_AVAILABLE = False

try:
    import PyPDF2
    PYPDF2_AVAILABLE = True
except ImportError:
    PYPDF2_AVAILABLE = False

# Configure Tesseract path robustly (prefer Homebrew but fall back to PATH)
DEFAULT_TESSERACT_PATHS = [
    "/opt/homebrew/bin/tesseract",
    "/usr/local/bin/tesseract",
    "/usr/bin/tesseract"
]
for path in DEFAULT_TESSERACT_PATHS:
    if os.path.exists(path):
        pytesseract.pytesseract.tesseract_cmd = path
        break
# otherwise let pytesseract use system PATH

@dataclass
class RegionResult:
    """Result for a specific region of the document"""
    region_name: str
    bbox: Tuple[int, int, int, int]  # x, y, width, height
    text: str
    confidence: float
    psm_used: Optional[int] = None

@dataclass
class OCRResult:
    """Complete OCR result with all regions and metadata"""
    text: str
    avg_conf: float
    engine: str
    regions: List[RegionResult]
    preprocessing_applied: List[str]

class MedicalOCRProcessor:
    """Advanced OCR processor optimized for medical documents"""
    
    def __init__(self, engine: str = 'tesseract', user_words_file: str = None, user_patterns_file: str = None, lang: str = 'eng', quality: bool = False):
        self.engine = engine.lower()
        self.lang = lang or 'eng'
        self.quality = bool(quality)
        
        # Initialize engines
        if self.engine == 'paddle' and PADDLE_AVAILABLE:
            self.paddle_ocr = PaddleOCR(use_angle_cls=True, lang='en')
        elif self.engine == 'paddle' and not PADDLE_AVAILABLE:
            print("PaddleOCR not available, falling back to Tesseract", file=sys.stderr)
            self.engine = 'tesseract'
        
        # Load user vocabularies (extend with helpful defaults if empty)
        self.user_words = self._load_user_words(user_words_file) if user_words_file else []
        self.user_patterns = self._load_user_patterns(user_patterns_file) if user_patterns_file else []

        # sensible defaults to bias Tesseract when no external files provided
        default_carriers = [
            'Aetna', 'BCBS', 'Blue Cross Blue Shield', 'Cigna', 'UHC', 'United Healthcare',
            'Humana', 'Medicare', 'Medicaid', 'Anthem', 'Kaiser', 'Wellcare'
        ]
        default_terms = [
            'CPT', 'MRN', 'DOB', 'Procedure', 'Referring', 'Physician', 'Authorization'
        ]
        if not self.user_words:
            self.user_words = default_carriers + default_terms
        else:
            # lightly augment provided list
            for w in default_carriers + default_terms:
                if w not in self.user_words:
                    self.user_words.append(w)

        if not self.user_patterns:
            self.user_patterns = [r"\d{5}", r"\d{2}/\d{2}/\d{2,4}"]
        
        # Medical term corrections dictionary (avoid global single-char numeric substitutions here)
        self.medical_corrections = {
            'patieni': 'patient', 'patlent': 'patient', 'palent': 'patient',
            'dlagnosis': 'diagnosis', 'diagnosls': 'diagnosis', 'dagnosis': 'diagnosis',
            'medicai': 'medical', 'medlcal': 'medical', 'medcal': 'medical',
            'hospltal': 'hospital', 'hospita1': 'hospital', 'hospilal': 'hospital',
            'doctoi': 'doctor', 'docto1': 'doctor', 'dactor': 'doctor',
            'treatmeni': 'treatment', 'treatmenl': 'treatment', 'treaiment': 'treatment',
            'prescriptlon': 'prescription', 'prescriplion': 'prescription',
            'insuranci': 'insurance', 'lnsurance': 'insurance', 'insuranc3': 'insurance',
            'symptons': 'symptoms', 'symptorns': 'symptoms', 'symploms': 'symptoms'
        }
    
    def _load_user_words(self, filepath: str) -> List[str]:
        """Load user word list for Tesseract bias"""
        try:
            with open(filepath, 'r') as f:
                return [line.strip() for line in f if line.strip()]
        except:
            return []
    
    def _load_user_patterns(self, filepath: str) -> List[str]:
        """Load user pattern list for Tesseract bias"""
        try:
            with open(filepath, 'r') as f:
                return [line.strip() for line in f if line.strip()]
        except:
            return []

    def detect_form_regions(self, image: np.ndarray) -> List[Tuple[str, Tuple[int, int, int, int]]]:
        """Detect form regions using contours and heuristics"""
        regions = []
        
        # Find contours for potential form boxes
        thresh = cv2.threshold(image, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        h, w = image.shape[:2]
        
        # Heuristic region detection based on position and size
        for contour in contours:
            x, y, cw, ch = cv2.boundingRect(contour)
            
            # Skip very small or very large regions
            if cw < 50 or ch < 20 or cw > w * 0.8 or ch > h * 0.5:
                continue
            
            # Classify regions based on position (rough heuristics)
            region_name = "unknown"
            if y < h * 0.3:  # Top third
                quick_text = self._ocr_region_quick(image[y:y+ch, x:x+cw]).lower()
                if "name" in quick_text:
                    region_name = "patient_name"
                elif "insurance" in quick_text:
                    region_name = "insurance"
                else:
                    region_name = "header"
            elif y < h * 0.6:  # Middle third
                quick_text = self._ocr_region_quick(image[y:y+ch, x:x+cw]).lower()
                if "cpt" in quick_text:
                    region_name = "procedure"
                else:
                    region_name = "body"
            else:  # Bottom third
                region_name = "footer"
            
            regions.append((region_name, (x, y, cw, ch)))
        
        # Add full document as fallback
        regions.append(("full_document", (0, 0, w, h)))
        
        return regions
    
    def _ocr_region_quick(self, region: np.ndarray) -> str:
        """Quick OCR for region classification"""
        try:
            if self.engine == 'tesseract':
                return pytesseract.image_to_string(region, config='--psm 8').strip()
            else:
                result = self.paddle_ocr.ocr(region, cls=True)
                if result and result[0]:
                    return ' '.join([item[1][0] for item in result[0]])
                return ""
        except:
            return ""
    
    def ocr_region(self, image: np.ndarray, region_name: str, bbox: Tuple[int, int, int, int]) -> RegionResult:
        """OCR a specific region with optimized settings"""
        x, y, w, h = bbox
        region_img = image[y:y+h, x:x+w]
        
        if self.engine == 'tesseract':
            return self._tesseract_ocr_region(region_img, region_name, bbox)
        else:
            return self._paddle_ocr_region(region_img, region_name, bbox)
    
    def _tesseract_ocr_region(self, region: np.ndarray, region_name: str, bbox: Tuple[int, int, int, int]) -> RegionResult:
        """OCR region using Tesseract with optimized PSM"""
        # Try multiple OEM/PSM combinations and pick the best by avg confidence
        psm_default = self._get_optimal_psm(region_name)
        # Base OEM/PSM; expanded when quality mode is on
        oems = [1, 3]
        psms = [psm_default, 6, 3, 11, 12, 13]
        rn = (region_name or '').lower()
        # Region-aware PSM overrides
        if rn == 'full_document':
            psms = [6, 4, 11, 13] if self.quality else [psm_default, 6, 3]

        best_text = ""
        best_conf = -1
        best_psm = psm_default

        # Convert region to PIL Image for consistency
        try:
            if isinstance(region, np.ndarray):
                pil_region = Image.fromarray(region)
            else:
                pil_region = region
        except Exception:
            pil_region = None

        # Prepare user words file once if present
        user_words_path = None
        if self.user_words:
            try:
                user_words_path = '/tmp/user_words.txt'
                with open(user_words_path, 'w') as f:
                    for word in self.user_words:
                        f.write(f"{word}\n")
            except Exception:
                user_words_path = None
        # Prepare user patterns file once if present
        user_patterns_path = None
        if self.user_patterns:
            try:
                user_patterns_path = '/tmp/user_patterns.txt'
                with open(user_patterns_path, 'w') as f:
                    for pat in self.user_patterns:
                        f.write(f"{pat}\n")
            except Exception:
                user_patterns_path = None

        whitelist = self._get_character_whitelist(region_name)

        # Region-specific aggressive configs
        strict_first = False
        region_whitelist = whitelist
        numeric_mode = False
        preserve_spaces = self.quality
        if rn and any(k in rn for k in ['procedure', 'cpt']):
            region_whitelist = '0123456789'
            psms = [7, 8, 6, 13] if self.quality else [7, 8, psm_default, 6, 3]
            strict_first = True
            numeric_mode = True
        elif rn and 'patient_name' in rn:
            region_whitelist = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz .,–-'
            psms = [7, 6, 13]
        elif rn and 'insurance' in rn:
            region_whitelist = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,-&'
            psms = [7, 6, 13]
        elif rn and ('phone' in rn or 'fax' in rn):
            region_whitelist = '0123456789()-. '
            psms = [7, 6, 13]
            numeric_mode = True

        # Build attempts list: strict-first for numeric/procedure regions
        attempts = []
        if strict_first:
            attempts.append({'psms': psms, 'whitelist': region_whitelist, 'strict': True})
            attempts.append({'psms': [psm_default, 6, 3], 'whitelist': whitelist, 'strict': False})
        else:
            attempts.append({'psms': psms, 'whitelist': region_whitelist, 'strict': False})

        for attempt in attempts:
            for oem in oems:
                for psm in attempt['psms']:
                    cfg = f"--oem {oem} --psm {psm} -l {self.lang}"
                    if preserve_spaces:
                        cfg += ' -c preserve_interword_spaces=1'
                    if numeric_mode:
                        cfg += ' -c classify_bln_numeric_mode=1'
                    if numeric_mode and ('procedure' in rn or 'cpt' in rn):
                        cfg += ' -c tessedit_char_blacklist=OIlS'
                    if attempt.get('whitelist'):
                        cfg += f" -c tessedit_char_whitelist={attempt.get('whitelist')}"
                    if user_words_path:
                        cfg += f" --user-words {user_words_path}"
                    if user_patterns_path:
                        cfg += f" --user-patterns {user_patterns_path}"
                    try:
                        data = pytesseract.image_to_data(pil_region if pil_region is not None else region, config=cfg, output_type=pytesseract.Output.DICT)
                        words = []
                        confidences = []
                        for i, conf in enumerate(data.get('conf', [])):
                            try:
                                conff = float(conf)
                            except Exception:
                                # sometimes conf is '-1' or non-numeric; treat as 0
                                conff = 0.0
                            # normalize negative confidences to 0
                            if conff < 0:
                                conff = 0.0
                            word = data.get('text', [])[i].strip() if i < len(data.get('text', [])) else ''
                            if word:
                                words.append(word)
                                confidences.append(conff)
                        # Reconstruct text with line breaks using Tesseract's block/line indexes
                        lines = []
                        current_key = None
                        line_words = []
                        for i in range(len(data.get('text', []))):
                            word = data['text'][i].strip()
                            if not word:
                                continue
                            blk = data.get('block_num', [0])[i]
                            lin = data.get('line_num', [0])[i]
                            key = (blk, lin)
                            if current_key is None:
                                current_key = key
                            if key != current_key:
                                if line_words:
                                    lines.append(' '.join(line_words))
                                line_words = [word]
                                current_key = key
                            else:
                                line_words.append(word)
                        # flush last line
                        if line_words:
                            lines.append(' '.join(line_words))
                        text = '\n'.join(lines).strip()
                        avg_conf = sum(confidences) / len(confidences) if confidences else 0.0
                        # prefer higher avg_conf, tie-breaker by longer text
                        if avg_conf > best_conf or (avg_conf == best_conf and len(text) > len(best_text)):
                            best_conf = avg_conf
                            best_text = text
                            best_psm = psm
                    except Exception:
                        continue

        # If we never got a positive confidence, try a basic fallback
        if best_conf <= 0:
            try:
                fb_cfg = f'-l {self.lang}'
                if user_words_path:
                    fb_cfg += f' --user-words {user_words_path}'
                if user_patterns_path:
                    fb_cfg += f' --user-patterns {user_patterns_path}'
                raw = pytesseract.image_to_string(pil_region if pil_region is not None else region, config=fb_cfg)
                return RegionResult(region_name, bbox, raw.strip(), 0.0, psm_default)
            except Exception:
                return RegionResult(region_name, bbox, "", 0.0, psm_default)

        return RegionResult(region_name, bbox, best_text, best_conf, best_psm)
    
    def _paddle_ocr_region(self, region: np.ndarray, region_name: str, bbox: Tuple[int, int, int, int]) -> RegionResult:
        """OCR region using PaddleOCR"""
        try:
            result = self.paddle_ocr.ocr(region, cls=True)
            
            if not result or not result[0]:
                return RegionResult(region_name, bbox, "", 0)
            
            # Extract text and confidence
            texts = []
            confidences = []
            
            for line in result[0]:
                text = line[1][0]
                conf = line[1][1]
                texts.append(text)
                confidences.append(conf * 100)  # Convert to percentage
            
            combined_text = ' '.join(texts)
            avg_conf = sum(confidences) / len(confidences) if confidences else 0
            
            return RegionResult(region_name, bbox, combined_text, avg_conf)
            
        except Exception as e:
            print(f"PaddleOCR failed for region {region_name}: {e}", file=sys.stderr)
            return RegionResult(region_name, bbox, "", 0)
    
    def _get_optimal_psm(self, region_name: str) -> int:
        """Get optimal PSM based on region type"""
        psm_map = {
            'patient_name': 7,      # Single line
            'insurance': 7,         # Single line
            'procedure': 7,         # Single line
            'header': 6,           # Uniform block
            'body': 6,             # Uniform block
            'footer': 6,           # Uniform block
            'full_document': 6,    # Uniform block
            'unknown': 6           # Default
        }
        return psm_map.get(region_name, 6)
    
    def _get_character_whitelist(self, region_name: str) -> str:
        """Get character whitelist for specific field types"""
        whitelist_map = {
            'patient_name': 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz .,',
            'insurance': 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,',
            'procedure': '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz -',
            'date': '0123456789/',
            'mrn': '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
            'cpt': '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
            'phone': '0123456789()-. ',
            'fax': '0123456789()-. ',
        }
        return whitelist_map.get(region_name, '')
    
    def validate_and_correct_text(self, text: str, region_name: str = None) -> str:
        """Apply post-OCR validation and correction"""
        if not text:
            return text
        
        corrected = text
        
        # Apply medical term corrections
        for wrong, correct in self.medical_corrections.items():
            # Case-insensitive replacement
            pattern = re.compile(re.escape(wrong), re.IGNORECASE)
            corrected = pattern.sub(correct, corrected)
        
        # Fuzzy matching for insurance carriers
        if region_name == 'insurance':
            corrected = self._correct_insurance_name(corrected)
        
        # Date validation and correction
        if region_name == 'date' or (region_name and 'date' in region_name.lower()):
            corrected = self._correct_date(corrected)
        
        # CPT code validation - apply if region is CPT-related OR if text contains CPT patterns
        should_correct_cpt = (region_name and ('cpt' in region_name.lower() or 'procedure' in region_name.lower())) or \
                            ('cpt' in corrected.lower() or 'procedure' in corrected.lower())
        if should_correct_cpt:
            corrected = self._correct_cpt_code(corrected)
        
        return corrected
    
    def _correct_insurance_name(self, text: str) -> str:
        """Correct insurance carrier names using fuzzy matching"""
        known_carriers = [
            'Aetna', 'BCBS', 'Blue Cross Blue Shield', 'Cigna', 'UHC', 'United Healthcare',
            'Humana', 'Medicare', 'Medicaid', 'Anthem', 'Kaiser', 'Wellcare'
        ]
        
        words = text.split()
        corrected_words = []
        
        for word in words:
            matches = get_close_matches(word, known_carriers, n=1, cutoff=0.6)
            if matches:
                corrected_words.append(matches[0])
            else:
                corrected_words.append(word)
        
        return ' '.join(corrected_words)
    
    def _correct_date(self, text: str) -> str:
        """Validate and correct date formats"""
        # Look for date patterns and validate
        date_pattern = r'(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})'
        match = re.search(date_pattern, text)
        
        if match:
            month, day, year = match.groups()
            
            # Convert 2-digit year to 4-digit
            if len(year) == 2:
                current_year = datetime.now().year
                year_int = int(year)
                if year_int <= (current_year % 100):
                    year = f"20{year}"
                else:
                    year = f"19{year}"
            
            # Validate date ranges
            try:
                month_int, day_int, year_int = int(month), int(day), int(year)
                if 1 <= month_int <= 12 and 1 <= day_int <= 31 and 1900 <= year_int <= 2030:
                    return f"{month:0>2}/{day:0>2}/{year}"
            except ValueError:
                pass
        
        return text
    
    def _correct_cpt_code(self, text: str) -> str:
        """Correct common CPT code OCR errors"""
        # Heuristic: clean tokens that may represent CPTs and normalize common OCR glyphs
        corrections = {'O': '0', 'o': '0', 'I': '1', 'l': '1', 'i': '1', 'S': '5', 's': '5', 'B': '8', 'G': '6'}

        def clean_token(tok: str) -> str:
            t = tok
            # currency symbol often mistaken for leading 5
            t = t.replace('$', '5')
            # remove commas and inner spaces
            t = t.replace(',', '')
            t = re.sub(r'\s+', '', t)
            # map common homoglyphs
            t = ''.join(corrections.get(ch, ch) for ch in t)
            return t

        # Find potential CPT tokens including $ prefix patterns
        # Order matters: longer/more specific patterns first to avoid double-matching
        cpt_patterns = [
            r'\$[0-9OolISBG]{4,5}',  # $5806, $O58O6 (with homoglyphs)
            r'\$\d{4,5}',            # $5806, $12345 
            r'\b[0-9OolISBG]{5}\b',  # O58O6 as 5-digit homoglyph
            r'\b\d{5}\b',            # 12345 as standalone 5-digit
            r'\b[0-9OolISBG]{4}\b',  # O586 as 4-digit homoglyph  
            r'\b\d{4}\b'             # 5806 as standalone 4-digit
        ]
        
        # Collect all matches with their positions to avoid overlaps
        all_matches = []
        for pattern in cpt_patterns:
            for match in re.finditer(pattern, text):
                all_matches.append((match.start(), match.end(), match.group(0), pattern))
        
        # Sort by start position and remove overlapping matches (keep first/longest)
        all_matches.sort()
        non_overlapping = []
        for start, end, token, pattern in all_matches:
            # Check if this overlaps with any already selected match
            overlaps = False
            for prev_start, prev_end, _, _ in non_overlapping:
                if not (end <= prev_start or start >= prev_end):  # overlapping
                    overlaps = True
                    break
            if not overlaps:
                non_overlapping.append((start, end, token, pattern))
        
        lower_text = text.lower()
        has_cpt_label = 'cpt' in lower_text or 'procedure' in lower_text
        
        # Process non-overlapping tokens
        for start, end, tok, pattern in non_overlapping:
            cleaned = clean_token(tok)
            
            # Check for 5-digit codes first (after cleaning)
            m5 = re.search(r'(\d{5})', cleaned)
            if m5:
                code = m5.group(1)
                text = text.replace(tok, code)
                continue
            
            # Check for 4-digit codes that need padding (only if CPT context present)
            if has_cpt_label:
                m4 = re.search(r'^(\d{4})$', cleaned)
                if m4:
                    code4 = m4.group(1)
                    padded = '0' + code4
                    text = text.replace(tok, padded)

        # Finally, apply a simple pass to convert isolated homoglyphs inside detected 5-digit groups
        def finalize_match(m):
            code = m.group(0)
            return ''.join(corrections.get(ch, ch) for ch in code)

        text = re.sub(r"[0-9OolISBG]{5}", finalize_match, text)
        return text
    
    def process_image(self, image: np.ndarray) -> OCRResult:
        """Process entire image with region detection and validation"""
        # Apply preprocessing
        processed_img, preprocessing_steps = advanced_preprocess(image)
        
        # Detect regions
        regions = self.detect_form_regions(processed_img)
        
        # OCR each region
        region_results = []
        all_text_parts = []
        all_confidences = []
        
        for region_name, bbox in regions:
            result = self.ocr_region(processed_img, region_name, bbox)
            
            # Apply validation and correction
            corrected_text = self.validate_and_correct_text(result.text, region_name)
            result.text = corrected_text
            
            region_results.append(result)
            
            if result.text.strip():
                all_text_parts.append(result.text)
                all_confidences.append(result.confidence)
        
        # Combine results
        combined_text = '\n'.join(all_text_parts)
        avg_confidence = sum(all_confidences) / len(all_confidences) if all_confidences else 0
        
        # Apply final validation and correction to the combined text
        if combined_text.strip():
            combined_text = self.validate_and_correct_text(combined_text)
        
        # If combined text empty or avg confidence very low, try variants
        if (not combined_text.strip()) or (avg_confidence < 20):
            variants = _generate_preprocess_variants(image)
            best = None
            for var_img, name in variants:
                # Run OCR on full document for each variant
                var_res = self._tesseract_ocr_region(var_img, 'full_document', (0, 0, var_img.shape[1], var_img.shape[0])) if self.engine == 'tesseract' else self._paddle_ocr_region(var_img, 'full_document', (0, 0, var_img.shape[1], var_img.shape[0]))
                # Apply validation to variant result too
                if var_res.text.strip():
                    var_res.text = self.validate_and_correct_text(var_res.text)
                # Basic heuristic: prefer higher confidence and non-empty text
                score = var_res.confidence
                if best is None or score > best[0]:
                    best = (score, name, var_res)
            if best and best[0] > avg_confidence:
                # Replace combined outputs with best variant
                combined_text = best[2].text
                avg_confidence = best[2].confidence
                # Overwrite region results with single full_document result
                region_results = [best[2]]
                preprocessing_steps.append(f'variant:{best[1]}')

        return OCRResult(
            text=combined_text,
            avg_conf=avg_confidence,
            engine=self.engine,
            regions=region_results,
            preprocessing_applied=preprocessing_steps
        )

def pdf_to_images(pdf_path: str, dpi: int = 600) -> List[Image.Image]:
    """Convert PDF to images with fallback to PyPDF2"""
    if PDF2IMAGE_AVAILABLE:
        try:
            return convert_from_path(pdf_path, dpi=dpi)
        except Exception as e:
            print(f"pdf2image failed: {e}. Attempting PyPDF2 fallback...", file=sys.stderr)
    
    if PYPDF2_AVAILABLE:
        try:
            with open(pdf_path, 'rb') as f:
                reader = PyPDF2.PdfReader(f)
                text_pages = []
                for page in reader.pages:
                    text = page.extract_text()
                    if text.strip():
                        # Create a simple text image
                        img = Image.new('RGB', (800, 1000), 'white')
                        text_pages.append(img)
                return text_pages
        except Exception as e:
            print(f"PyPDF2 also failed: {e}", file=sys.stderr)
    
    print("No PDF processing libraries available", file=sys.stderr)
    sys.exit(3)

def advanced_preprocess(image: np.ndarray) -> Tuple[np.ndarray, List[str]]:
    """Apply comprehensive preprocessing pipeline for medical documents"""
    steps_applied = []
    
    # Convert to grayscale if needed
    if len(image.shape) == 3:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        steps_applied.append("grayscale")
    else:
        gray = image.copy()
    
    # Apply CLAHE for contrast enhancement
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
    gray = clahe.apply(gray)
    steps_applied.append("clahe")
    
    # Denoise using fastNlMeansDenoising
    gray = cv2.fastNlMeansDenoising(gray, h=10)
    steps_applied.append("denoise")
    
    # Deskew if needed
    gray, was_deskewed = deskew_image(gray)
    if was_deskewed:
        steps_applied.append("deskew")
    
    # Adaptive threshold for binarization
    binary = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2
    )
    steps_applied.append("adaptive_threshold")
    
    # Morphological operations to clean noise
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    # Opening to remove noise
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)
    # Closing to connect text
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
    steps_applied.append("morphology")
    
    # Upscale 2x for better OCR
    height, width = binary.shape
    binary = cv2.resize(binary, (width * 2, height * 2), interpolation=cv2.INTER_CUBIC)
    steps_applied.append("upscale_2x")
    
    # Apply unsharp mask for sharpening
    gaussian = cv2.GaussianBlur(binary, (0, 0), 2.0)
    binary = cv2.addWeighted(binary, 2.0, gaussian, -1.0, 0)
    steps_applied.append("unsharp_mask")
    
    return binary, steps_applied

def deskew_image(image: np.ndarray) -> Tuple[np.ndarray, bool]:
    """Detect and correct skew in image"""
    # Find contours and get skew angle
    thresh = cv2.threshold(image, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]
    coords = np.column_stack(np.where(thresh > 0))
    
    if coords.size == 0:
        return image, False
    
    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45:
        angle = -(90 + angle)
    else:
        angle = -angle
    
    # Only deskew if angle is significant
    if abs(angle) < 0.5:
        return image, False
    
    (h, w) = image.shape[:2]
    center = (w // 2, h // 2)
    M = cv2.getRotationMatrix2D(center, angle, 1.0)
    deskewed = cv2.warpAffine(image, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    
    return deskewed, True


def _generate_preprocess_variants(image: np.ndarray):
    """Generate a small set of preprocessing variants (grayscale arrays) to try as fallbacks."""
    variants = []
    # Ensure grayscale
    if len(image.shape) == 3:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    else:
        gray = image.copy()

    # Variant 1: CLAHE + denoise + adaptive threshold (standard)
    v1, _ = advanced_preprocess(image)
    variants.append((v1, 'clahe_denoise_adaptiveth'))

    # Variant 2: Simple bilateral filter + adaptive threshold
    b = cv2.bilateralFilter(gray, 9, 75, 75)
    bth = cv2.adaptiveThreshold(b, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY, 15, 5)
    variants.append((bth, 'bilateral_adaptiveth_mean'))

    # Variant 3: Otsu threshold after Gaussian blur
    blur = cv2.GaussianBlur(gray, (5,5), 0)
    _, otsu = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    variants.append((otsu, 'gauss_otsu'))

    # Variant 4: Inverted (sometimes helps white-on-black scans)
    inv = cv2.bitwise_not(v1)
    variants.append((inv, 'inverted'))

    # Variant 5: Contrast stretch using simple normalization
    norm = cv2.normalize(gray, None, 0, 255, cv2.NORM_MINMAX)
    _, norm_th = cv2.threshold(norm, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    variants.append((norm_th, 'normalized_otsu'))

    # Variant 6: Aggressive denoise + larger morphology (helps very noisy scans)
    den = cv2.fastNlMeansDenoising(gray, h=20)
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (3,3))
    den = cv2.morphologyEx(den, cv2.MORPH_CLOSE, k)
    den = cv2.adaptiveThreshold(den, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 25, 6)
    variants.append((den, 'aggressive_denoise_close'))

    return variants

def run_file(file_path: str, engine: str = 'tesseract', user_words: str = None, user_patterns: str = None, debug: bool = False, lang: str = 'eng', quality: bool = False) -> dict:
    """Main OCR processing function"""
    # Initialize processor
    processor = MedicalOCRProcessor(engine, user_words, user_patterns, lang=lang, quality=quality)
    
    # Determine file type
    mime_type, _ = mimetypes.guess_type(file_path)
    is_pdf = mime_type == 'application/pdf'
    
    if not is_pdf:
        # Check file header for PDF
        try:
            with open(file_path, 'rb') as f:
                header = f.read(5)
                if header == b'%PDF-':
                    is_pdf = True
        except:
            pass
    
    if is_pdf:
        # PDF processing: extract all pages
        pages = pdf_to_images(file_path, dpi=400)
        if not pages:
            return {"error": "No pages extracted from PDF", "text": "", "avg_conf": 0}
        
        all_results = []
        all_confidences = []
        
        for i, page in enumerate(pages):
            # Convert PIL to numpy array
            page_array = np.array(page)
            result = processor.process_image(page_array)
            
            if result.text.strip():
                all_results.append({
                    "page": i + 1,
                    "text": result.text,
                    "confidence": result.avg_conf,
                    "engine": result.engine,
                    "regions": [
                        {
                            "region_name": r.region_name,
                            "bbox": r.bbox,
                            "text": r.text,
                            "confidence": r.confidence
                        } for r in result.regions
                    ],
                    "preprocessing": result.preprocessing_applied
                })
                all_confidences.append(result.avg_conf)
        
        # Combine results
        combined_text = "\n\n".join([f"Page {r['page']}:\n{r['text']}" for r in all_results])
        avg_conf = sum(all_confidences) / len(all_confidences) if all_confidences else 0
        
        return {
            "text": combined_text,
            "avg_conf": avg_conf,
            "engine": engine,
            "pages": all_results
        }
    
    else:
        # Image processing
        img = Image.open(file_path)
        img_array = np.array(img)

        # Run preprocessing separately so we can save the preprocessed image in debug mode
        processed_img, preprocessing_steps = advanced_preprocess(img_array)
        if debug:
            print(f"[DEBUG] preprocessing steps: {preprocessing_steps}")

        # Save preprocessed image for debugging if requested
        debug_info = {}
        if debug:
            try:
                debug_path = '/tmp/ocr_debug_preprocessed.png'
                # processed_img may be grayscale; ensure 3-channel for viewing if needed
                if len(processed_img.shape) == 2:
                    cv2.imwrite(debug_path, processed_img)
                else:
                    cv2.imwrite(debug_path, cv2.cvtColor(processed_img, cv2.COLOR_BGR2RGB))
                debug_info['preprocessed_image'] = debug_path
            except Exception as e:
                debug_info['preprocessed_image_error'] = str(e)

        # If debug, run full-image OCR with both engines (or the selected one) to compare
        full_engine_results = {}
        try:
            # Use processor internal methods to get raw OCR on the full preprocessed image
            h, w = processed_img.shape[:2]
            if processor.engine == 'tesseract' or engine == 'tesseract':
                t_res = processor._tesseract_ocr_region(processed_img, 'full_document', (0, 0, w, h))
                full_engine_results['tesseract'] = {"text": t_res.text, "confidence": t_res.confidence, "psm": t_res.psm_used}
            if processor.engine == 'paddle' or engine == 'paddle':
                if PADDLE_AVAILABLE:
                    p_res = processor._paddle_ocr_region(processed_img, 'full_document', (0, 0, w, h))
                    full_engine_results['paddle'] = {"text": p_res.text, "confidence": p_res.confidence}
                else:
                    full_engine_results['paddle_error'] = 'paddle not available'
        except Exception as e:
            full_engine_results['error'] = str(e)

        # Now run the standard region-based processing
        result = processor.process_image(img_array)

        out = {
            "text": result.text,
            "avg_conf": result.avg_conf,
            "engine": result.engine,
            "regions": [
                {
                    "region_name": r.region_name,
                    "bbox": r.bbox,
                    "text": r.text,
                    "confidence": r.confidence,
                    "psm_used": r.psm_used
                } for r in result.regions
            ],
            "preprocessing_applied": result.preprocessing_applied
        }

        if debug:
            out['debug'] = {
                'preprocessing_steps': preprocessing_steps,
                'full_engine_results': full_engine_results,
                **debug_info
            }
            print(f"[DEBUG] full_engine_results keys: {list(full_engine_results.keys())}")
            if 'preprocessed_image' in debug_info:
                print(f"[DEBUG] preprocessed image saved to: {debug_info['preprocessed_image']}")

        return out

def main():
    """CLI entry point"""
    parser = argparse.ArgumentParser(description="Advanced Medical OCR Processor")
    parser.add_argument("input_path", help="Path to image or PDF file")
    parser.add_argument("--engine", choices=['tesseract', 'paddle'], default='tesseract',
                       help="OCR engine to use (default: tesseract)")
    parser.add_argument("--user-words", help="Path to user words file for Tesseract bias")
    parser.add_argument("--user-patterns", help="Path to user patterns file for Tesseract bias")
    parser.add_argument("--lang", default="eng", help="Tesseract language code (default: eng)")
    parser.add_argument("--quality", action="store_true", help="High-quality OCR (slower, more accurate)")
    parser.add_argument("--debug", action="store_true", help="Enable debug outputs (save preprocessed image, show raw engine OCR)")
    parser.add_argument("--fail-on-empty", action="store_true", help="Exit non-zero if no text was extracted")
    args = parser.parse_args()
    
    # Check input file exists
    if not os.path.exists(args.input_path):
        print("Input file not found", file=sys.stderr)
        sys.exit(1)
    
    try:
        result = run_file(args.input_path, args.engine, args.user_words, args.user_patterns, debug=args.debug, lang=args.lang, quality=args.quality)
        # Fallback: if no text extracted, try quick full-image preprocess + tesseract
        if not result.get('text') or not str(result.get('text')).strip():
            try:
                from debug_runner import preprocess
                pre = preprocess(args.input_path)
                from PIL import Image as _Image
                pil = _Image.fromarray(pre)
                fb_cfg = f"--oem 3 --psm 6 -l {args.lang}"
                if args.user_words:
                    fb_cfg += f' --user-words {args.user_words}'
                if args.user_patterns:
                    fb_cfg += f' --user-patterns {args.user_patterns}'
                text = pytesseract.image_to_string(pil, config=fb_cfg)
                if text and text.strip():
                    result['fallback_text'] = text.strip()
            except Exception:
                pass
        # Fail fast if --fail-on-empty is set and no text was extracted
        if args.fail_on_empty and (not result.get('text') or not str(result.get('text')).strip()):
            print("No text extracted (fail-on-empty)", file=sys.stderr)
            sys.exit(4)
        # Only emit JSON to stdout; all debug/info already logged to stderr
        try:
            print(json.dumps(result, indent=2))
        except Exception as e:
            print(f"Failed to serialize result: {e}", file=sys.stderr)
            sys.exit(2)
        sys.exit(0)
    except Exception as e:
        print(f"OCR processing failed: {e}", file=sys.stderr)
        sys.exit(2)

if __name__ == "__main__":
    main()
