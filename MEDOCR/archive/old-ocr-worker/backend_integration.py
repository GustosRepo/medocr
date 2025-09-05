#!/usr/bin/env python3
"""
Backend Integration Wrapper for Client Requirements
Bridges the backend API with the new medical OCR orchestrator
"""

import sys
import json
import argparse
from pathlib import Path
from datetime import datetime, date

# Add the current directory to path for imports
sys.path.append(str(Path(__file__).parent))

from enhanced_extract import analyze_medical_form  # Updated to use enhanced extraction
from flag_rules import derive_flags, flags_to_actions, load_flags_catalog


def process_text_for_testing(ocr_text: str, ocr_confidence: float = 0.95) -> dict:
    """
    Process OCR text directly for testing purposes
    Returns JSON-compatible results for verification
    """
    
    try:
        # Initialize components
        qc_checker = QualityControlChecker()
        filename_handler = FileNamingHandler()
        
        # Step 1: Enhanced OCR extraction with improved confidence scoring
        extracted_data = analyze_medical_form(ocr_text, ocr_confidence=ocr_confidence)
        
        # The enhanced extraction already includes flags and actions
        flags = extracted_data.get("flags", [])
        actions = extracted_data.get("actions", [])
        
        # Step 3: Quality control checks
        qc_results = qc_checker.run_all_checks(extracted_data)
        
        # Step 4: Generate patient PDF content
        pdf_content = generate_patient_pdf_content(extracted_data, ocr_text, ocr_confidence)
        
        # Step 5: Generate filename
        filename = filename_handler.generate_patient_filename(
            extracted_data.get('patient', {}),
            extracted_data.get('referral', {})
        )
        
        # Determine overall status
        status = 'ready_to_schedule' if len(flags) == 0 else 'additional_actions_required'
        
        # Prepare API response
        api_response = {
            'success': True,
            'text': ocr_text,
            'avg_conf': ocr_confidence,
            'extracted_data': extracted_data,
            'flags': flags,
            'actions': actions,
            'qc_results': qc_results,
            'suggested_filename': filename,
            'status': status,
            'pdf_content': pdf_content,
            'client_features': {
                'individual_pdf_ready': True,
                'quality_checked': True,
                'flags_applied': len(flags),
                'actions_required': len(actions)
            }
        }
        
        return api_response
        
    except Exception as e:
        return {
            'success': False,
            'error': str(e),
            'text': ocr_text,
            'avg_conf': ocr_confidence
        }


def process_single_file_for_api(image_path: str) -> dict:
    """
    Process a single file for the API endpoint
    Returns JSON-compatible results for the frontend
    """
    
    try:
        # Initialize components
        qc_checker = QualityControlChecker()
        filename_handler = FileNamingHandler()
        
        # Load flags catalog (with fallback)
        try:
            flags_catalog = load_flags_catalog('config/flags_catalog.json')
        except FileNotFoundError:
            flags_catalog = {'flags': []}
        
        # For now, simulate OCR text extraction
        # In production, this would use the actual OCR from main.py
        sample_ocr_text = f"Processing file: {image_path}"
        
        # Step 1: Enhanced OCR extraction
        extracted_data = analyze_medical_form(sample_ocr_text, ocr_confidence=0.95)
        
        # The enhanced extraction already includes flags and actions
        flags = extracted_data.get("flags", [])
        actions = extracted_data.get("actions", [])
        
        # Step 3: Quality control checks
        qc_results = qc_checker.run_all_checks(extracted_data)
        
        # Step 4: Generate patient PDF content
        pdf_content = generate_patient_pdf_content(extracted_data, sample_ocr_text, 0.95)
        
        # Step 5: Generate filename
        filename = filename_handler.generate_patient_filename(
            extracted_data.get('patient', {}),
            extracted_data.get('referral', {})
        )
        
        # Prepare API response
        api_response = {
            'success': True,
            'text': sample_ocr_text,
            'avg_conf': 0.95,
            'extracted_data': extracted_data,
            'flags': flags,
            'actions': actions,
            'qc_results': qc_results,
            'suggested_filename': filename,
            'status': 'ready_to_schedule' if not flags else 'additional_actions_required',
            'pdf_content': pdf_content,
            'client_features': {
                'individual_pdf_ready': True,
                'quality_checked': True,
                'flags_applied': len(flags),
                'actions_required': len(actions)
            }
        }
        
        return api_response
        
    except Exception as e:
        return {
            'success': False,
            'error': str(e),
            'text': f"Error processing {image_path}",
            'client_features': {
                'individual_pdf_ready': False,
                'quality_checked': False,
                'flags_applied': 0,
                'actions_required': 0
            }
        }


def process_batch_for_api(image_paths: list, intake_date: str = None) -> dict:
    """
    Process a batch of files for the API endpoint
    Returns JSON-compatible batch results
    """
    
    try:
        # Initialize orchestrator
        orchestrator = MedicalOCROrchestrator('/tmp/medocr_api_output')
        
        # Process batch
        batch_results = orchestrator.process_batch(
            image_paths, 
            intake_date=intake_date,
            save_files=False  # Don't save files for API response
        )
        
        # Prepare API response
        api_response = {
            'success': True,
            'batch_summary': {
                'total_documents': batch_results['total_documents'],
                'intake_date': batch_results['intake_date'],
                'statistics': batch_results['processing_statistics'],
                'ready_to_schedule': batch_results['processing_statistics']['ready_to_schedule'],
                'additional_actions_required': batch_results['processing_statistics']['additional_actions_required']
            },
            'individual_results': [],
            'cover_sheet_content': batch_results['cover_sheet_content'],
            'filename_suggestions': batch_results['filename_suggestions'],
            'client_features': {
                'batch_cover_sheet_ready': True,
                'individual_pdfs_ready': batch_results['total_documents'],
                'quality_control_applied': True,
                'file_naming_standardized': True
            }
        }
        
        # Process individual results for API
        for result in batch_results['individual_results']:
            if result.get('error'):
                api_result = {
                    'success': False,
                    'error': result['error'],
                    'source_file': result.get('source_file', 'unknown')
                }
            else:
                api_result = {
                    'success': True,
                    'source_file': result.get('source_file', 'unknown'),
                    'filename': result.get('filename', 'unknown.pdf'),
                    'status': result.get('status', 'unknown'),
                    'flags': result.get('flags', []),
                    'actions': result.get('actions', []),
                    'confidence_score': result.get('confidence_score', 0),
                    'qc_issues': len(result.get('qc_results', {}).get('errors', [])) + len(result.get('qc_results', {}).get('warnings', []))
                }
            
            api_response['individual_results'].append(api_result)
        
        return api_response
        
    except Exception as e:
        return {
            'success': False,
            'error': str(e),
            'client_features': {
                'batch_cover_sheet_ready': False,
                'individual_pdfs_ready': 0,
                'quality_control_applied': False,
                'file_naming_standardized': False
            }
        }


def main():
    """Command line interface for backend integration"""
    
    parser = argparse.ArgumentParser(description='Backend integration for client requirements')
    parser.add_argument('--mode', choices=['single', 'batch'], required=True,
                       help='Processing mode')
    parser.add_argument('--file', help='Single file path for single mode')
    parser.add_argument('--text-file', help='OCR text file path for enhanced processing')
    parser.add_argument('--confidence', type=float, default=0.95, help='OCR confidence score')
    parser.add_argument('--files', nargs='+', help='Multiple file paths for batch mode')
    parser.add_argument('--intake-date', help='Intake date for batch processing')
    
    args = parser.parse_args()
    
    if args.mode == 'single':
        if args.text_file:
            # Process OCR text directly for enhanced extraction
            try:
                with open(args.text_file, 'r', encoding='utf-8') as f:
                    ocr_text = f.read()
                result = process_text_for_testing(ocr_text, args.confidence)
                print(json.dumps(result, indent=2))
            except Exception as e:
                print(json.dumps({'error': f'Failed to read OCR text file: {str(e)}'}))
                sys.exit(1)
        elif args.file:
            result = process_single_file_for_api(args.file)
            print(json.dumps(result, indent=2))
        else:
            print(json.dumps({'error': 'File path or text-file required for single mode'}))
            sys.exit(1)
        
    elif args.mode == 'batch':
        if not args.files:
            print(json.dumps({'error': 'File paths required for batch mode'}))
            sys.exit(1)
        
        result = process_batch_for_api(args.files, args.intake_date)
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
