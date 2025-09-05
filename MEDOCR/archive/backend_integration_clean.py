#!/usr/bin/env python3
"""
Backend Integration Wrapper for Client Requirements
Simplified version using only core working components
"""

import sys
import json
import argparse
from pathlib import Path
from datetime import datetime, date

# Add the current directory to path for imports
sys.path.append(str(Path(__file__).parent))

from enhanced_extract import analyze_medical_form
from flag_rules import derive_flags, flags_to_actions, load_flags_catalog


def process_text_for_testing(ocr_text: str, ocr_confidence: float = 0.95) -> dict:
    """
    Process OCR text directly for testing purposes
    Returns JSON-compatible results for verification
    """
    
    try:
        # Process through enhanced extraction pipeline
        extracted_data = analyze_medical_form(ocr_text, ocr_confidence)
        
        # Format results for API compatibility
        result = {
            'success': True,
            'data': extracted_data,
            'metadata': {
                'processing_timestamp': datetime.now().isoformat(),
                'extraction_method': extracted_data.get('extraction_method', 'enhanced'),
                'confidence': extracted_data.get('semantic_confidence', ocr_confidence)
            }
        }
        
        return result
        
    except Exception as e:
        return {
            'success': False,
            'error': str(e),
            'data': None
        }


def process_single_file_for_api(image_path: str) -> dict:
    """
    Process a single file for the API endpoint
    Returns JSON-compatible results for the frontend
    """
    
    try:
        # Import main processing function
        from main import run_file
        
        # Run OCR on the image
        ocr_result = run_file(image_path, engine='tesseract')
        
        if not ocr_result or 'error' in ocr_result:
            return {
                'success': False,
                'error': ocr_result.get('error', 'OCR failed'),
                'data': None
            }
        
        ocr_text = ocr_result.get('text', '')
        ocr_confidence = ocr_result.get('avg_conf', 0.0)
        
        # Process through enhanced extraction
        extracted_data = analyze_medical_form(ocr_text, ocr_confidence)
        
        # Load flags catalog (with fallback)
        try:
            flags_catalog = load_flags_catalog('config/flags_catalog.json')
        except FileNotFoundError:
            flags_catalog = {'flags': []}
        
        # Build complete result structure
        result = {
            'success': True,
            'ocr_text': ocr_text,
            'ocr_confidence': ocr_confidence,
            'extracted_data': extracted_data,
            'semantic_data': extracted_data.get('semantic_data', {}),
            'semantic_confidence': extracted_data.get('semantic_confidence', 0.0),
            'flags': extracted_data.get('flags', []),
            'processing_metadata': {
                'timestamp': datetime.now().isoformat(),
                'extraction_method': extracted_data.get('extraction_method', 'enhanced'),
                'engine': ocr_result.get('engine', 'tesseract'),
                'preprocessing_applied': ocr_result.get('preprocessing_applied', [])
            }
        }
        
        return result
        
    except Exception as e:
        return {
            'success': False,
            'error': str(e),
            'data': None,
            'ocr_text': '',
            'ocr_confidence': 0.0
        }


def process_ocr_result(image_path: str, ocr_text: str, ocr_confidence: float) -> dict:
    """
    Main API integration function - processes OCR results through our pipeline
    """
    try:
        # Process through enhanced extraction pipeline
        extracted_data = analyze_medical_form(ocr_text, ocr_confidence)
        
        # Build result structure for frontend compatibility
        result = {
            'success': True,
            'ocr_text': ocr_text,
            'ocr_confidence': ocr_confidence,
            'extracted_data': extracted_data,
            'semantic_data': extracted_data.get('semantic_data', {}),
            'semantic_confidence': extracted_data.get('semantic_confidence', 0.0),
            'flags': extracted_data.get('flags', []),
            'processing_metadata': {
                'timestamp': datetime.now().isoformat(),
                'extraction_method': extracted_data.get('extraction_method', 'enhanced'),
                'image_path': image_path
            }
        }
        
        return result
        
    except Exception as e:
        return {
            'success': False,
            'error': str(e),
            'data': None,
            'ocr_text': ocr_text,
            'ocr_confidence': ocr_confidence
        }


def main():
    """Command line interface for testing"""
    parser = argparse.ArgumentParser(description='Backend Integration Testing')
    parser.add_argument('--mode', choices=['single', 'text'], default='text',
                       help='Processing mode: single file or text input')
    parser.add_argument('--image-file', help='Path to image file for single mode')
    parser.add_argument('--text-file', help='Path to text file for text mode')
    parser.add_argument('--confidence', type=float, default=0.95, 
                       help='OCR confidence for text mode')
    
    args = parser.parse_args()
    
    if args.mode == 'single':
        if not args.image_file:
            print("Error: --image-file required for single mode", file=sys.stderr)
            sys.exit(1)
        
        result = process_single_file_for_api(args.image_file)
        
    elif args.mode == 'text':
        if not args.text_file:
            print("Error: --text-file required for text mode", file=sys.stderr)
            sys.exit(1)
        
        try:
            with open(args.text_file, 'r') as f:
                ocr_text = f.read().strip()
        except FileNotFoundError:
            print(f"Error: Text file not found: {args.text_file}", file=sys.stderr)
            sys.exit(1)
        
        result = process_text_for_testing(ocr_text, args.confidence)
    
    # Output results as JSON
    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    main()
