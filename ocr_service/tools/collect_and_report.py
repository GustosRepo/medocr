#!/usr/bin/env python3
"""
OCR Test Report Collector
--------------------------
Runs benchmark, collects raw OCR outputs, identifies worst cases, and packages
everything into a shareable report.zip for troubleshooting.

Usage:
    python tools/collect_and_report.py --test-dir test_data --top-n 10

Output: test_data/report.zip containing:
    - results.json (benchmark metrics)
    - worst_cases/ (top N input files + ground truth + OCR outputs)
    - ocr_outputs/ (all raw OCR JSON responses)
    - ocr_service.log (last 200 lines)
    - summary.txt (human-readable overview)
"""

import argparse
import json
import os
import shutil
import sys
import zipfile
from datetime import datetime
from pathlib import Path

# Add parent directory to path to import benchmark
sys.path.insert(0, str(Path(__file__).parent.parent))

try:
    from benchmark import benchmark_file, compute_cer_wer
    from app import preprocess_image, _load_engine
except ImportError as e:
    print(f"Error importing modules: {e}")
    print("Make sure you're running from the ocr_service directory with venv activated")
    sys.exit(1)


def collect_raw_ocr_outputs(test_dir: Path, output_dir: Path):
    """Run OCR on all test files and save raw JSON outputs."""
    from rapidocr_onnxruntime import RapidOCR
    import cv2
    
    print(f"\n📸 Collecting raw OCR outputs...")
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Initialize OCR engine
    _load_engine()
    import app
    ocr_engine = app._rapid_engine
    
    if ocr_engine is None:
        print("⚠️  OCR engine not initialized, using default RapidOCR")
        ocr_engine = RapidOCR()
    
    inputs_dir = test_dir / "inputs"
    if not inputs_dir.exists():
        print(f"⚠️  No inputs directory found at {inputs_dir}")
        return
    
    count = 0
    for input_file in sorted(inputs_dir.glob("*")):
        if input_file.suffix.lower() not in ['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.pdf']:
            continue
        
        try:
            # For images, read and run OCR
            if input_file.suffix.lower() != '.pdf':
                image = cv2.imread(str(input_file))
                if image is None:
                    print(f"⚠️  Could not read {input_file.name}")
                    continue
                
                # Run OCR with preprocessing (matches production behavior)
                processed_img = preprocess_image(image)
                result, elapse = ocr_engine(processed_img)
                
                output = {
                    "file": input_file.name,
                    "timestamp": datetime.now().isoformat(),
                    "elapsed_ms": int(elapse * 1000),
                    "result": result  # List of [bbox, text, confidence]
                }
                
                output_file = output_dir / f"{input_file.stem}.json"
                with open(output_file, 'w', encoding='utf-8') as f:
                    json.dump(output, f, indent=2, ensure_ascii=False)
                
                count += 1
                print(f"  ✓ {input_file.name} → {output_file.name}")
        
        except Exception as e:
            print(f"  ✗ {input_file.name}: {e}")
    
    print(f"✓ Collected {count} raw OCR outputs")


def run_benchmark(test_dir: Path) -> dict:
    """Run benchmark and return results."""
    print(f"\n📊 Running benchmark on {test_dir}...")
    
    from benchmark import main as benchmark_main
    
    # Temporarily override sys.argv to pass args to benchmark
    old_argv = sys.argv
    sys.argv = ['benchmark.py', '--test-dir', str(test_dir), '--output', str(test_dir / 'results.json')]
    
    try:
        benchmark_main()
    except SystemExit:
        pass  # benchmark calls sys.exit(0) on success
    finally:
        sys.argv = old_argv
    
    # Load results
    results_file = test_dir / 'results.json'
    if results_file.exists():
        with open(results_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    else:
        print("⚠️  No results.json generated")
        return {}


def identify_worst_cases(results: dict, top_n: int = 10) -> list:
    """Extract top N worst cases by CER."""
    if not results:
        return []
    
    # Handle both old and new benchmark result formats
    files = results.get('files', results.get('results', []))
    if not files:
        return []
    
    # Sort files by CER descending
    sorted_files = sorted(files, key=lambda x: x.get('cer', 0), reverse=True)
    
    return sorted_files[:top_n]


def copy_worst_cases(worst_cases: list, test_dir: Path, report_dir: Path):
    """Copy worst case inputs, ground truth, and OCR outputs to report directory."""
    worst_dir = report_dir / "worst_cases"
    worst_dir.mkdir(parents=True, exist_ok=True)
    
    print(f"\n📋 Copying top {len(worst_cases)} worst cases...")
    
    for i, case in enumerate(worst_cases, 1):
        file_name = case.get('file', case.get('filename', ''))
        if not file_name:
            continue
        
        # Copy input file
        input_file = test_dir / "inputs" / file_name
        if input_file.exists():
            shutil.copy2(input_file, worst_dir / f"{i:02d}_{file_name}")
        
        # Copy ground truth
        gt_file = test_dir / "gt" / f"{Path(file_name).stem}.txt"
        if gt_file.exists():
            shutil.copy2(gt_file, worst_dir / f"{i:02d}_{Path(file_name).stem}_gt.txt")
        
        # Copy OCR output JSON
        ocr_output = test_dir / "ocr_outputs" / f"{Path(file_name).stem}.json"
        if ocr_output.exists():
            shutil.copy2(ocr_output, worst_dir / f"{i:02d}_{Path(file_name).stem}_ocr.json")
        
        print(f"  {i:02d}. {file_name} (CER: {case.get('cer', 0):.1%}, WER: {case.get('wer', 0):.1%})")


def create_summary(results: dict, worst_cases: list, report_dir: Path):
    """Create a human-readable summary file."""
    summary_file = report_dir / "summary.txt"
    
    # Extract summary data (handle both formats)
    summary = results.get('summary', results)
    
    with open(summary_file, 'w', encoding='utf-8') as f:
        f.write("=" * 80 + "\n")
        f.write("OCR TEST REPORT\n")
        f.write("=" * 80 + "\n\n")
        f.write(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"Test Directory: {results.get('test_dir', 'N/A')}\n\n")
        
        # Overall metrics
        f.write("OVERALL METRICS\n")
        f.write("-" * 80 + "\n")
        f.write(f"Total Files: {summary.get('total_files', 0)}\n")
        f.write(f"Average CER: {summary.get('avg_cer', 0):.2%}\n")
        f.write(f"Average WER: {summary.get('avg_wer', 0):.2%}\n")
        f.write(f"Throughput: {summary.get('avg_throughput_pages_per_s', summary.get('throughput', 0)):.2f} pages/sec\n\n")
        
        # Worst cases
        f.write(f"WORST {len(worst_cases)} CASES (by CER)\n")
        f.write("-" * 80 + "\n")
        for i, case in enumerate(worst_cases, 1):
            f.write(f"\n{i:02d}. {case.get('file', case.get('filename', 'unknown'))}\n")
            f.write(f"    CER: {case.get('cer', 0):.2%} | WER: {case.get('wer', 0):.2%}\n")
            f.write(f"    Avg Confidence: {case.get('avg_confidence', 0):.2f}\n")
            
            # Show first 200 chars of expected vs actual
            gt = case.get('ground_truth', '')[:200]
            ocr = case.get('ocr_text', '')[:200]
            if gt or ocr:
                f.write(f"    Expected: {gt}...\n")
                f.write(f"    Got:      {ocr}...\n")
        
        f.write("\n" + "=" * 80 + "\n")
        f.write("FILES IN THIS REPORT\n")
        f.write("=" * 80 + "\n")
        f.write("- results.json: Full benchmark results with per-file metrics\n")
        f.write("- ocr_outputs/: Raw OCR JSON responses for all test files\n")
        f.write("- worst_cases/: Top N worst cases with inputs, ground truth, and OCR outputs\n")
        f.write("- ocr_service.log: Last 200 lines of OCR service log\n")
        f.write("- summary.txt: This file\n")
    
    print(f"✓ Created summary: {summary_file}")


def copy_service_log(report_dir: Path):
    """Copy last 200 lines of OCR service log."""
    log_file = Path(__file__).parent.parent.parent / "data" / "logs" / "ocr-8000.log"
    
    if not log_file.exists():
        print(f"⚠️  OCR log not found at {log_file}")
        return
    
    try:
        with open(log_file, 'r', encoding='utf-8') as f:
            lines = f.readlines()
        
        # Get last 200 lines
        last_lines = lines[-200:] if len(lines) > 200 else lines
        
        output_file = report_dir / "ocr_service.log"
        with open(output_file, 'w', encoding='utf-8') as f:
            f.writelines(last_lines)
        
        print(f"✓ Copied service log ({len(last_lines)} lines)")
    
    except Exception as e:
        print(f"⚠️  Could not copy log: {e}")


def create_zip_archive(report_dir: Path, output_file: Path):
    """Create ZIP archive of the report directory."""
    print(f"\n📦 Creating archive: {output_file}")
    
    with zipfile.ZipFile(output_file, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(report_dir):
            for file in files:
                file_path = Path(root) / file
                arcname = file_path.relative_to(report_dir.parent)
                zipf.write(file_path, arcname)
    
    # Get size
    size_mb = output_file.stat().st_size / (1024 * 1024)
    print(f"✓ Created {output_file.name} ({size_mb:.1f} MB)")


def main():
    parser = argparse.ArgumentParser(
        description="Collect OCR test results and package into a shareable report"
    )
    parser.add_argument(
        '--test-dir',
        type=Path,
        default=Path('test_data'),
        help='Directory containing inputs/ and gt/ subdirectories'
    )
    parser.add_argument(
        '--top-n',
        type=int,
        default=10,
        help='Number of worst cases to include in report'
    )
    parser.add_argument(
        '--skip-benchmark',
        action='store_true',
        help='Skip running benchmark (use existing results.json)'
    )
    parser.add_argument(
        '--skip-raw-outputs',
        action='store_true',
        help='Skip collecting raw OCR outputs'
    )
    
    args = parser.parse_args()
    
    test_dir = args.test_dir
    if not test_dir.exists():
        print(f"❌ Test directory not found: {test_dir}")
        return 1
    
    print("=" * 80)
    print("OCR TEST REPORT COLLECTOR")
    print("=" * 80)
    
    # Create report directory
    report_dir = test_dir / "report"
    if report_dir.exists():
        shutil.rmtree(report_dir)
    report_dir.mkdir(parents=True)
    
    # Step 1: Collect raw OCR outputs
    if not args.skip_raw_outputs:
        collect_raw_ocr_outputs(test_dir, test_dir / "ocr_outputs")
    
    # Step 2: Run benchmark
    if not args.skip_benchmark:
        results = run_benchmark(test_dir)
    else:
        results_file = test_dir / 'results.json'
        if results_file.exists():
            with open(results_file, 'r', encoding='utf-8') as f:
                results = json.load(f)
        else:
            print("❌ No results.json found. Run without --skip-benchmark first.")
            return 1
    
    # Step 3: Identify worst cases
    worst_cases = identify_worst_cases(results, args.top_n)
    
    # Step 4: Copy files to report directory
    # Copy results.json
    shutil.copy2(test_dir / "results.json", report_dir / "results.json")
    
    # Copy all raw OCR outputs
    if (test_dir / "ocr_outputs").exists():
        shutil.copytree(test_dir / "ocr_outputs", report_dir / "ocr_outputs")
    
    # Copy worst cases
    copy_worst_cases(worst_cases, test_dir, report_dir)
    
    # Copy service log
    copy_service_log(report_dir)
    
    # Create summary
    create_summary(results, worst_cases, report_dir)
    
    # Step 5: Create ZIP archive
    zip_file = test_dir / "report.zip"
    create_zip_archive(report_dir, zip_file)
    
    print("\n" + "=" * 80)
    print("✅ REPORT READY")
    print("=" * 80)
    print(f"Location: {zip_file}")
    print(f"Size: {zip_file.stat().st_size / (1024 * 1024):.1f} MB")
    print("\nYou can now share this file for troubleshooting.")
    print("It contains:")
    print("  • Benchmark results with CER/WER metrics")
    print(f"  • Top {args.top_n} worst cases with inputs + ground truth + OCR outputs")
    print("  • All raw OCR JSON responses")
    print("  • Service log (last 200 lines)")
    print("  • Human-readable summary")
    
    return 0


if __name__ == '__main__':
    sys.exit(main())
