#!/usr/bin/env python3
"""
Simplified Medical OCR Processor - Focus on Quality over Complexity
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
from typing import List, Dict, Optional

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

# Tesseract configuration
TESSERACT_PATH = "/opt/homebrew/bin/tesseract"
if os.path.exists(TESSERACT_PATH):
    pytesseract.pytesseract.tesseract_cmd = TESSERACT_PATH

@dataclass
class OCRResult:
    """Simple OCR result with text and metadata"""
    text: str
    avg_conf: float
    engine: str
    preprocessing_applied: List[str]

class SimpleMedicalOCR:
    """Simplified OCR processor optimized for quality and reliability"""
    
    def __init__(self, engine: str = 'tesseract', user_words_file: str = None, user_patterns_file: str = None):
        self.engine = engine.lower()
        
        # Initialize engines
        if self.engine == 'paddle' and PADDLE_AVAILABLE:
            self.paddle_ocr = PaddleOCR(use_angle_cls=True, lang='en')
        elif self.engine == 'paddle' and not PADDLE_AVAILABLE:
            print("PaddleOCR not available, falling back to Tesseract", file=sys.stderr)
            self.engine = 'tesseract'
        
        # Load user vocabularies if provided
        self.user_words = self._load_user_words(user_words_file) if user_words_file else []
        self.user_patterns = self._load_user_patterns(user_patterns_file) if user_patterns_file else []
        
        # Medical term corrections dictionary
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

    def simple_preprocess(self, image: np.ndarray) -> tuple[np.ndarray, List[str]]:
        """Simple, effective preprocessing that doesn't destroy quality"""
        steps_applied = []
        
        # Convert to grayscale if needed
        if len(image.shape) == 3:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            steps_applied.append("grayscale")
        else:
            gray = image.copy()
        
        # Simple 2x upscale for better OCR (this is the key improvement)
        height, width = gray.shape
        gray = cv2.resize(gray, (width * 2, height * 2), interpolation=cv2.INTER_CUBIC)
        steps_applied.append("upscale_2x")
        
        # Optional: Light denoising only if image is very noisy
        # We'll keep this minimal to avoid quality degradation
        noise_level = cv2.Laplacian(gray, cv2.CV_64F).var()
        if noise_level < 100:  # Only denoise if very noisy
            gray = cv2.fastNlMeansDenoising(gray, h=10)
            steps_applied.append("light_denoise")
        
        return gray, steps_applied

    def tesseract_ocr(self, image: np.ndarray) -> tuple[str, float]:
        """Simple, effective Tesseract OCR"""
        # Convert to PIL for consistency
        if isinstance(image, np.ndarray):
            pil_image = Image.fromarray(image)
        else:
            pil_image = image
        
        # Prepare user files if available
        config_parts = ['--oem 3 --psm 6']  # Best general settings
        
        # Add user words if available
        user_words_path = None
        if self.user_words:
            try:
                user_words_path = '/tmp/user_words.txt'
                with open(user_words_path, 'w') as f:
                    for word in self.user_words:
                        f.write(f"{word}\n")
                config_parts.append(f'--user-words {user_words_path}')
            except:
                pass
        
        # Add user patterns if available
        user_patterns_path = None
        if self.user_patterns:
            try:
                user_patterns_path = '/tmp/user_patterns.txt'
                with open(user_patterns_path, 'w') as f:
                    for pattern in self.user_patterns:
                        f.write(f"{pattern}\n")
                config_parts.append(f'--user-patterns {user_patterns_path}')
            except:
                pass
        
        config = ' '.join(config_parts)
        
        try:
            # Get text and confidence data
            data = pytesseract.image_to_data(pil_image, config=config, output_type=pytesseract.Output.DICT)
            
            # Extract text and calculate average confidence
            words = []
            confidences = []
            
            for i, conf in enumerate(data.get('conf', [])):
                try:
                    conf_val = float(conf) if conf != '-1' else 0.0
                    conf_val = max(0.0, conf_val)  # Ensure non-negative
                except:
                    conf_val = 0.0
                
                word = data.get('text', [])[i].strip() if i < len(data.get('text', [])) else ''
                if word:
                    words.append(word)
                    confidences.append(conf_val)
            
            text = ' '.join(words)
            avg_conf = sum(confidences) / len(confidences) if confidences else 0.0
            
            return text, avg_conf
            
        except Exception as e:
            print(f"Tesseract OCR failed: {e}", file=sys.stderr)
            # Fallback to basic string extraction
            try:
                text = pytesseract.image_to_string(pil_image, config='--oem 3 --psm 6')
                return text.strip(), 50.0  # Default confidence
            except:
                return "", 0.0

    def paddle_ocr(self, image: np.ndarray) -> tuple[str, float]:
        """Simple PaddleOCR processing"""
        try:
            result = self.paddle_ocr.ocr(image, cls=True)
            
            if not result or not result[0]:
                return "", 0.0
            
            texts = []
            confidences = []
            
            for line in result[0]:
                text = line[1][0]
                conf = line[1][1] * 100  # Convert to percentage
                texts.append(text)
                confidences.append(conf)
            
            combined_text = ' '.join(texts)
            avg_conf = sum(confidences) / len(confidences) if confidences else 0.0
            
            return combined_text, avg_conf
            
        except Exception as e:
            print(f"PaddleOCR failed: {e}", file=sys.stderr)
            return "", 0.0

    def correct_cpt_code(self, text: str) -> str:
        """Simple, effective CPT code correction"""
        if not text:
            return text
        
        # Simple pattern-based corrections
        corrections = {
            'O': '0', 'o': '0', 'I': '1', 'l': '1', 'i': '1', 
            'S': '5', 's': '5', 'B': '8', 'G': '6'
        }
        
        # Find CPT patterns and fix them
        cpt_patterns = [
            r'CPT:\s*\$(\d{4,5})',  # CPT: $5806
            r'CPT:\s*([0-9OolISBG]{4,5})',  # CPT: O58O6
        ]
        
        for pattern in cpt_patterns:
            matches = re.finditer(pattern, text, re.IGNORECASE)
            for match in matches:
                original = match.group(0)
                code = match.group(1)
                
                # Apply corrections
                corrected_code = ''.join(corrections.get(c, c) for c in code)
                
                # Ensure 5 digits (pad 4-digit codes)
                if len(corrected_code) == 4:
                    corrected_code = '0' + corrected_code
                
                # Replace in text
                replacement = f"CPT: {corrected_code}"
                text = text.replace(original, replacement)
        
        return text

    def correct_text(self, text: str) -> str:
        """Apply basic text corrections"""
        if not text:
            return text
        
        corrected = text
        
        # Apply medical term corrections
        for wrong, correct in self.medical_corrections.items():
            pattern = re.compile(re.escape(wrong), re.IGNORECASE)
            corrected = pattern.sub(correct, corrected)
        
        # Apply CPT corrections
        corrected = self.correct_cpt_code(corrected)
        
        return corrected

    def process_image(self, image: np.ndarray, debug: bool = False) -> OCRResult:
        """Process image with simple, effective approach"""
        # Simple preprocessing
        processed_img, preprocessing_steps = self.simple_preprocess(image)
        
        # Save debug image if requested
        if debug:
            try:
                debug_path = '/tmp/simple_ocr_preprocessed.png'
                cv2.imwrite(debug_path, processed_img)
                print(f"[DEBUG] Preprocessed image saved to: {debug_path}", file=sys.stderr)
            except Exception as e:
                print(f"[DEBUG] Could not save debug image: {e}", file=sys.stderr)
        
        # Run OCR
        if self.engine == 'tesseract':
            text, confidence = self.tesseract_ocr(processed_img)
        else:
            text, confidence = self.paddle_ocr(processed_img)
        
        # Apply corrections
        corrected_text = self.correct_text(text)
        
        return OCRResult(
            text=corrected_text,
            avg_conf=confidence,
            engine=self.engine,
            preprocessing_applied=preprocessing_steps
        )

def pdf_to_images(pdf_path: str, dpi: int = 400) -> List[Image.Image]:
    """Convert PDF to images with fallback"""
    if PDF2IMAGE_AVAILABLE:
        try:
            return convert_from_path(pdf_path, dpi=dpi)
        except Exception as e:
            print(f"pdf2image failed: {e}", file=sys.stderr)
    
    if PYPDF2_AVAILABLE:
        try:
            with open(pdf_path, 'rb') as f:
                reader = PyPDF2.PdfReader(f)
                # For simplicity, just return empty list if can't extract images
                return []
        except Exception as e:
            print(f"PyPDF2 failed: {e}", file=sys.stderr)
    
    print("No PDF processing libraries available", file=sys.stderr)
    return []

def run_file(file_path: str, engine: str = 'tesseract', user_words: str = None, user_patterns: str = None, debug: bool = False) -> dict:
    """Main OCR processing function"""
    processor = SimpleMedicalOCR(engine, user_words, user_patterns)
    
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
        # PDF processing
        pages = pdf_to_images(file_path)
        if not pages:
            return {"error": "No pages extracted from PDF", "text": "", "avg_conf": 0}
        
        all_results = []
        all_confidences = []
        
        for i, page in enumerate(pages):
            page_array = np.array(page)
            result = processor.process_image(page_array, debug)
            
            if result.text.strip():
                all_results.append({
                    "page": i + 1,
                    "text": result.text,
                    "confidence": result.avg_conf,
                    "engine": result.engine,
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
        
        result = processor.process_image(img_array, debug)
        
        return {
            "text": result.text,
            "avg_conf": result.avg_conf,
            "engine": result.engine,
            "preprocessing_applied": result.preprocessing_applied
        }

def main():
    """CLI entry point"""
    parser = argparse.ArgumentParser(description="Simple Medical OCR Processor")
    parser.add_argument("input_path", help="Path to image or PDF file")
    parser.add_argument("--engine", choices=['tesseract', 'paddle'], default='tesseract',
                       help="OCR engine to use (default: tesseract)")
    parser.add_argument("--user-words", help="Path to user words file for Tesseract bias")
    parser.add_argument("--user-patterns", help="Path to user patterns file for Tesseract bias")
    parser.add_argument("--debug", action="store_true", help="Enable debug outputs")
    
    args = parser.parse_args()
    
    # Check input file exists
    if not os.path.exists(args.input_path):
        print("Input file not found", file=sys.stderr)
        sys.exit(1)
    
    try:
        result = run_file(args.input_path, args.engine, args.user_words, args.user_patterns, args.debug)
        print(json.dumps(result, indent=2))
        sys.exit(0)
    except Exception as e:
        print(f"OCR processing failed: {e}", file=sys.stderr)
        sys.exit(2)

if __name__ == "__main__":
    main()
