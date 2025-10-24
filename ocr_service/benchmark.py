#!/usr/bin/env python3
"""
OCR Benchmark Harness
Measures accuracy, throughput, and confidence metrics for OCR pipeline validation.

Usage:
    python benchmark.py --test-dir ./test_data --output results.json
    python benchmark.py --single test_data/sample.pdf --ground-truth test_data/sample.txt
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Dict, List, Tuple, Any, Optional
from dataclasses import dataclass, asdict
from collections import defaultdict
import statistics

try:
    from rapidocr_onnxruntime import RapidOCR
    from PIL import Image, ImageOps, ImageFilter
    from pdf2image import convert_from_path
    import numpy as np
    import cv2
except ImportError as e:
    print(f"Missing dependency: {e}", file=sys.stderr)
    print("Install with: pip install rapidocr-onnxruntime pillow pdf2image opencv-python-headless numpy", file=sys.stderr)
    sys.exit(1)

# Import preprocessing from app.py
sys.path.insert(0, str(Path(__file__).parent))
from app import preprocess_image as app_preprocess_image


@dataclass
class BenchmarkResult:
    """Individual test case result"""
    filename: str
    pages: int
    total_time_ms: float
    per_page_time_ms: float
    preprocessing_time_ms: float
    inference_time_ms: float
    total_chars: int
    total_lines: int
    avg_confidence: float
    min_confidence: float
    max_confidence: float
    low_conf_lines: int  # Lines below 0.65 confidence
    character_accuracy: Optional[float] = None
    word_accuracy: Optional[float] = None
    cer: Optional[float] = None  # Character Error Rate
    wer: Optional[float] = None  # Word Error Rate
    ground_truth_chars: Optional[int] = None


@dataclass
class BenchmarkSummary:
    """Aggregate statistics across all tests"""
    total_files: int
    total_pages: int
    total_time_s: float
    avg_throughput_pages_per_s: float
    avg_confidence: float
    avg_chars_per_page: int
    avg_lines_per_page: int
    low_confidence_rate: float  # Percentage of lines below 0.65
    avg_cer: Optional[float] = None
    avg_wer: Optional[float] = None
    avg_char_accuracy: Optional[float] = None
    model_info: Dict[str, Any] = None


def load_ground_truth(txt_path: Path) -> str:
    """Load ground truth text from file"""
    try:
        with open(txt_path, 'r', encoding='utf-8') as f:
            return f.read()
    except Exception as e:
        print(f"Warning: Could not load ground truth from {txt_path}: {e}", file=sys.stderr)
        return ""


def normalize_text(text: str) -> str:
    """Normalize text for comparison (lowercase, remove extra whitespace)"""
    import re
    text = text.lower()
    text = re.sub(r'\s+', ' ', text)
    text = text.strip()
    return text


def compute_levenshtein(s1: str, s2: str) -> int:
    """Compute Levenshtein distance between two strings"""
    if len(s1) < len(s2):
        return compute_levenshtein(s2, s1)
    if len(s2) == 0:
        return len(s1)
    
    previous_row = range(len(s2) + 1)
    for i, c1 in enumerate(s1):
        current_row = [i + 1]
        for j, c2 in enumerate(s2):
            insertions = previous_row[j + 1] + 1
            deletions = current_row[j] + 1
            substitutions = previous_row[j] + (c1 != c2)
            current_row.append(min(insertions, deletions, substitutions))
        previous_row = current_row
    
    return previous_row[-1]


def compute_cer_wer(predicted: str, ground_truth: str) -> Tuple[float, float]:
    """
    Compute Character Error Rate (CER) and Word Error Rate (WER)
    
    CER = Levenshtein(predicted_chars, gt_chars) / len(gt_chars)
    WER = Levenshtein(predicted_words, gt_words) / len(gt_words)
    """
    pred_norm = normalize_text(predicted)
    gt_norm = normalize_text(ground_truth)
    
    # Character Error Rate
    char_distance = compute_levenshtein(pred_norm, gt_norm)
    cer = char_distance / max(len(gt_norm), 1)
    
    # Word Error Rate
    pred_words = pred_norm.split()
    gt_words = gt_norm.split()
    word_distance = compute_levenshtein(' '.join(pred_words), ' '.join(gt_words))
    wer = word_distance / max(len(' '.join(gt_words)), 1)
    
    return cer, wer


def benchmark_file(
    file_path: Path,
    engine: Any,
    ground_truth: Optional[str] = None,
    preprocess_mode: str = "enhanced",
    verbose: bool = False
) -> BenchmarkResult:
    """Benchmark OCR on a single PDF/image file"""
    
    if verbose:
        print(f"Processing: {file_path.name}...", end=" ", flush=True)
    
    start_total = time.perf_counter()
    
    # Load document as images
    if file_path.suffix.lower() == '.pdf':
        dpi = int(os.getenv('MEDOCR_RENDER_DPI', '300'))
        try:
            images = convert_from_path(str(file_path), dpi=dpi, fmt='png')
        except Exception as e:
            print(f"Error rendering PDF {file_path}: {e}", file=sys.stderr)
            return None
    else:
        try:
            images = [Image.open(file_path)]
        except Exception as e:
            print(f"Error loading image {file_path}: {e}", file=sys.stderr)
            return None
    
    page_count = len(images)
    preprocessing_times = []
    inference_times = []
    all_text_parts = []
    all_confidences = []
    low_conf_count = 0
    total_lines = 0
    
    # Set preprocessing mode
    os.environ['MEDOCR_PREPROCESS_MODE'] = preprocess_mode
    
    for img in images:
        # Preprocessing
        preproc_start = time.perf_counter()
        processed_img = app_preprocess_image(img)
        preproc_time = (time.perf_counter() - preproc_start) * 1000
        preprocessing_times.append(preproc_time)
        
        # OCR Inference
        inf_start = time.perf_counter()
        try:
            result, _ = engine(processed_img)
        except Exception as e:
            print(f"Error during OCR inference: {e}", file=sys.stderr)
            result = []
        inf_time = (time.perf_counter() - inf_start) * 1000
        inference_times.append(inf_time)
        
        # Parse results
        if result:
            for item in result:
                text = ""
                score = 0.0
                
                if isinstance(item, (list, tuple)) and len(item) >= 3:
                    first = item[0]
                    if isinstance(first, (list, tuple)) and len(first) >= 4:
                        # Box-first format: [box, text, score]
                        text = str(item[1])
                        score = float(item[2]) if len(item) > 2 else 0.0
                    else:
                        # Text-first format: [text, score, box]
                        text = str(item[0])
                        score = float(item[1]) if len(item) > 1 else 0.0
                
                if text.strip():
                    all_text_parts.append(text)
                    all_confidences.append(score)
                    total_lines += 1
                    if score < 0.65:
                        low_conf_count += 1
    
    end_total = time.perf_counter()
    total_time = (end_total - start_total) * 1000  # ms
    
    combined_text = '\n'.join(all_text_parts)
    total_chars = len(combined_text)
    
    avg_conf = statistics.mean(all_confidences) if all_confidences else 0.0
    min_conf = min(all_confidences) if all_confidences else 0.0
    max_conf = max(all_confidences) if all_confidences else 0.0
    
    avg_preproc = statistics.mean(preprocessing_times) if preprocessing_times else 0.0
    avg_inf = statistics.mean(inference_times) if inference_times else 0.0
    
    # Compute accuracy metrics if ground truth provided
    char_acc = None
    word_acc = None
    cer = None
    wer = None
    gt_chars = None
    
    if ground_truth:
        gt_chars = len(ground_truth)
        cer, wer = compute_cer_wer(combined_text, ground_truth)
        char_acc = max(0.0, 1.0 - cer)
        word_acc = max(0.0, 1.0 - wer)
    
    if verbose:
        print(f"Done! ({total_time:.0f}ms, {page_count}p, conf={avg_conf:.2f})")
    
    return BenchmarkResult(
        filename=file_path.name,
        pages=page_count,
        total_time_ms=total_time,
        per_page_time_ms=total_time / page_count,
        preprocessing_time_ms=avg_preproc,
        inference_time_ms=avg_inf,
        total_chars=total_chars,
        total_lines=total_lines,
        avg_confidence=avg_conf,
        min_confidence=min_conf,
        max_confidence=max_conf,
        low_conf_lines=low_conf_count,
        character_accuracy=char_acc,
        word_accuracy=word_acc,
        cer=cer,
        wer=wer,
        ground_truth_chars=gt_chars
    )


def run_benchmark_suite(
    test_dir: Path,
    output_file: Optional[Path] = None,
    preprocess_mode: str = "enhanced",
    verbose: bool = True
) -> BenchmarkSummary:
    """Run benchmark suite on all PDFs/images in test directory"""
    
    print("=== OCR Benchmark Harness ===")
    print(f"Test Directory: {test_dir}")
    print(f"Preprocessing Mode: {preprocess_mode}")
    print(f"RapidOCR Version: rapidocr-onnxruntime")
    print()
    
    # Initialize engine
    print("Loading RapidOCR engine...", end=" ", flush=True)
    try:
        engine = RapidOCR()
        print("OK")
    except Exception as e:
        print(f"FAILED: {e}", file=sys.stderr)
        sys.exit(1)
    
    # Find test files
    pdf_files = list(test_dir.glob("*.pdf"))
    img_files = list(test_dir.glob("*.png")) + list(test_dir.glob("*.jpg")) + list(test_dir.glob("*.jpeg"))
    test_files = sorted(pdf_files + img_files)
    
    if not test_files:
        print(f"No test files found in {test_dir}", file=sys.stderr)
        sys.exit(1)
    
    print(f"Found {len(test_files)} test files")
    print()
    
    results = []
    
    for test_file in test_files:
        # Check for ground truth file (same name with .txt extension)
        gt_file = test_file.with_suffix('.txt')
        ground_truth = load_ground_truth(gt_file) if gt_file.exists() else None
        
        result = benchmark_file(test_file, engine, ground_truth, preprocess_mode, verbose)
        if result:
            results.append(result)
    
    if not results:
        print("No successful results", file=sys.stderr)
        sys.exit(1)
    
    # Compute summary statistics
    total_pages = sum(r.pages for r in results)
    total_time_s = sum(r.total_time_ms for r in results) / 1000
    
    avg_throughput = total_pages / total_time_s if total_time_s > 0 else 0
    avg_confidence = statistics.mean([r.avg_confidence for r in results])
    avg_chars_per_page = int(statistics.mean([r.total_chars / r.pages for r in results]))
    avg_lines_per_page = int(statistics.mean([r.total_lines / r.pages for r in results]))
    
    total_lines_all = sum(r.total_lines for r in results)
    total_low_conf = sum(r.low_conf_lines for r in results)
    low_conf_rate = (total_low_conf / total_lines_all * 100) if total_lines_all > 0 else 0
    
    # Accuracy metrics (only if ground truth available)
    results_with_gt = [r for r in results if r.cer is not None]
    avg_cer = statistics.mean([r.cer for r in results_with_gt]) if results_with_gt else None
    avg_wer = statistics.mean([r.wer for r in results_with_gt]) if results_with_gt else None
    avg_char_acc = statistics.mean([r.character_accuracy for r in results_with_gt]) if results_with_gt else None
    
    summary = BenchmarkSummary(
        total_files=len(results),
        total_pages=total_pages,
        total_time_s=total_time_s,
        avg_throughput_pages_per_s=avg_throughput,
        avg_confidence=avg_confidence,
        avg_chars_per_page=avg_chars_per_page,
        avg_lines_per_page=avg_lines_per_page,
        low_confidence_rate=low_conf_rate,
        avg_cer=avg_cer,
        avg_wer=avg_wer,
        avg_char_accuracy=avg_char_acc,
        model_info={
            "engine": "RapidOCR",
            "version": "1.3.24",
            "backend": "onnxruntime",
            "preprocessing": preprocess_mode
        }
    )
    
    # Print summary
    print()
    print("=== BENCHMARK SUMMARY ===")
    print(f"Files Processed: {summary.total_files}")
    print(f"Total Pages: {summary.total_pages}")
    print(f"Total Time: {summary.total_time_s:.2f}s")
    print(f"Throughput: {summary.avg_throughput_pages_per_s:.2f} pages/sec")
    print(f"Avg Confidence: {summary.avg_confidence:.3f}")
    print(f"Avg Chars/Page: {summary.avg_chars_per_page}")
    print(f"Avg Lines/Page: {summary.avg_lines_per_page}")
    print(f"Low Confidence Lines (<0.65): {summary.low_confidence_rate:.1f}%")
    
    if summary.avg_cer is not None:
        print(f"\n--- Accuracy Metrics (with ground truth) ---")
        print(f"Character Accuracy: {summary.avg_char_accuracy*100:.1f}%")
        print(f"Character Error Rate (CER): {summary.avg_cer:.3f}")
        print(f"Word Error Rate (WER): {summary.avg_wer:.3f}")
    
    # Save detailed results
    if output_file:
        output_data = {
            "summary": asdict(summary),
            "results": [asdict(r) for r in results]
        }
        
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(output_data, f, indent=2)
        
        print(f"\nDetailed results saved to: {output_file}")
    
    return summary


def main():
    parser = argparse.ArgumentParser(description="OCR Benchmark Harness")
    parser.add_argument(
        '--test-dir',
        type=Path,
        help='Directory containing test PDFs/images'
    )
    parser.add_argument(
        '--single',
        type=Path,
        help='Benchmark a single file'
    )
    parser.add_argument(
        '--ground-truth',
        type=Path,
        help='Ground truth text file for --single mode'
    )
    parser.add_argument(
        '--output',
        type=Path,
        default=Path('benchmark_results.json'),
        help='Output JSON file for results (default: benchmark_results.json)'
    )
    parser.add_argument(
        '--preprocess',
        choices=['off', 'basic', 'enhanced'],
        default='enhanced',
        help='Preprocessing mode (default: enhanced)'
    )
    parser.add_argument(
        '--verbose',
        action='store_true',
        help='Verbose output'
    )
    
    args = parser.parse_args()
    
    if args.single:
        # Single file mode
        if not args.single.exists():
            print(f"File not found: {args.single}", file=sys.stderr)
            sys.exit(1)
        
        print("Loading RapidOCR engine...", end=" ", flush=True)
        engine = RapidOCR()
        print("OK")
        
        gt = load_ground_truth(args.ground_truth) if args.ground_truth else None
        result = benchmark_file(args.single, engine, gt, args.preprocess, verbose=True)
        
        if result:
            print(f"\n=== RESULTS ===")
            print(f"File: {result.filename}")
            print(f"Pages: {result.pages}")
            print(f"Total Time: {result.total_time_ms:.0f}ms ({result.per_page_time_ms:.0f}ms/page)")
            print(f"Preprocessing: {result.preprocessing_time_ms:.1f}ms/page")
            print(f"Inference: {result.inference_time_ms:.1f}ms/page")
            print(f"Characters: {result.total_chars}")
            print(f"Lines: {result.total_lines}")
            print(f"Avg Confidence: {result.avg_confidence:.3f}")
            print(f"Min/Max Confidence: {result.min_confidence:.3f} / {result.max_confidence:.3f}")
            print(f"Low Confidence Lines: {result.low_conf_lines}/{result.total_lines} ({result.low_conf_lines/result.total_lines*100:.1f}%)")
            
            if result.character_accuracy is not None:
                print(f"\n--- Accuracy vs Ground Truth ---")
                print(f"Character Accuracy: {result.character_accuracy*100:.1f}%")
                print(f"CER: {result.cer:.3f}")
                print(f"WER: {result.wer:.3f}")
        
    elif args.test_dir:
        # Benchmark suite mode
        if not args.test_dir.is_dir():
            print(f"Directory not found: {args.test_dir}", file=sys.stderr)
            sys.exit(1)
        
        run_benchmark_suite(args.test_dir, args.output, args.preprocess, args.verbose)
    
    else:
        parser.print_help()
        print("\nExample usage:", file=sys.stderr)
        print("  python benchmark.py --test-dir ./test_data", file=sys.stderr)
        print("  python benchmark.py --single sample.pdf --ground-truth sample.txt", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
