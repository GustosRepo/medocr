#!/usr/bin/env python3
"""
Download PP-OCRv4 Server Models

Downloads optimized PP-OCRv4 server models from PaddleOCR for improved accuracy.
These models are larger and slower than the bundled PP-OCRv3 lite models but provide
better accuracy on challenging documents.

Usage:
    python download_models.py --output models/
    
Models Downloaded:
    - ch_PP-OCRv4_det_server_infer (Detection)
    - ch_ppocr_mobile_v2.0_cls_infer (Angle Classification)
    - ch_PP-OCRv4_rec_server_infer (Recognition)
"""

import argparse
import os
import sys
import tarfile
import urllib.request
from pathlib import Path
from typing import Optional

# PP-OCRv4 server model URLs (PaddleOCR official)
MODEL_URLS = {
    "det": {
        "name": "ch_PP-OCRv4_det_server",
        "url": "https://paddleocr.bj.bcebos.com/PP-OCRv4/chinese/ch_PP-OCRv4_det_server_infer.tar",
        "onnx_name": "ch_PP-OCRv4_det_server_infer.onnx",
        "description": "PP-OCRv4 detection server model"
    },
    "cls": {
        "name": "ch_ppocr_mobile_v2.0_cls",
        "url": "https://paddleocr.bj.bcebos.com/dygraph_v2.0/ch/ch_ppocr_mobile_v2.0_cls_infer.tar",
        "onnx_name": "ch_ppocr_mobile_v2.0_cls_infer.onnx",
        "description": "PP-OCR mobile angle classification model"
    },
    "rec": {
        "name": "ch_PP-OCRv4_rec_server",
        "url": "https://paddleocr.bj.bcebos.com/PP-OCRv4/chinese/ch_PP-OCRv4_rec_server_infer.tar",
        "onnx_name": "ch_PP-OCRv4_rec_server_infer.onnx",
        "description": "PP-OCRv4 recognition server model"
    }
}


def download_file(url: str, dest: Path, show_progress: bool = True):
    """Download file with progress indicator"""
    
    def progress_hook(count, block_size, total_size):
        if not show_progress or total_size <= 0:
            return
        percent = min(100, int(count * block_size * 100 / total_size))
        mb_downloaded = count * block_size / (1024 * 1024)
        mb_total = total_size / (1024 * 1024)
        print(f"\r  Progress: {percent}% ({mb_downloaded:.1f}/{mb_total:.1f} MB)", end="", flush=True)
    
    print(f"Downloading {url}...")
    urllib.request.urlretrieve(url, dest, progress_hook if show_progress else None)
    if show_progress:
        print()  # New line after progress


def extract_tar(tar_path: Path, dest_dir: Path):
    """Extract tar archive"""
    print(f"Extracting {tar_path.name}...")
    with tarfile.open(tar_path, 'r') as tar:
        tar.extractall(dest_dir)


def convert_paddle_to_onnx(paddle_dir: Path, output_path: Path, model_type: str):
    """
    Convert PaddlePaddle model to ONNX (placeholder - requires paddle2onnx)
    
    Note: RapidOCR expects ONNX models. If downloading PaddlePaddle models,
    you'll need to convert them using paddle2onnx tool.
    
    For now, we're downloading pre-converted ONNX models or using the inference
    models directly if RapidOCR supports them.
    """
    # Check if ONNX file already exists in extracted directory
    possible_onnx = list(paddle_dir.rglob("*.onnx"))
    if possible_onnx:
        onnx_file = possible_onnx[0]
        print(f"Found ONNX model: {onnx_file}")
        if onnx_file != output_path:
            import shutil
            shutil.copy(onnx_file, output_path)
        return output_path
    
    # Check for .pdmodel files (PaddlePaddle format)
    possible_pdmodel = list(paddle_dir.rglob("*.pdmodel"))
    if possible_pdmodel:
        print(f"Warning: Found PaddlePaddle model but no ONNX. Conversion required.")
        print(f"Install paddle2onnx: pip install paddle2onnx")
        print(f"Convert with: paddle2onnx --model_dir {paddle_dir} --save_file {output_path}")
        return None
    
    print(f"Warning: Could not find model files in {paddle_dir}")
    return None


def download_models(output_dir: Path, models: Optional[list] = None):
    """Download specified models (or all if None)"""
    
    output_dir.mkdir(parents=True, exist_ok=True)
    
    if models is None:
        models = list(MODEL_URLS.keys())
    
    downloaded = []
    
    for model_key in models:
        if model_key not in MODEL_URLS:
            print(f"Unknown model: {model_key}. Available: {list(MODEL_URLS.keys())}")
            continue
        
        model_info = MODEL_URLS[model_key]
        print(f"\n=== {model_info['description']} ===")
        
        # Download tar file
        tar_filename = model_info['url'].split('/')[-1]
        tar_path = output_dir / tar_filename
        
        if tar_path.exists():
            print(f"Tar file already exists: {tar_path}")
        else:
            download_file(model_info['url'], tar_path)
        
        # Extract
        extract_dir = output_dir / model_info['name']
        extract_dir.mkdir(exist_ok=True)
        extract_tar(tar_path, extract_dir)
        
        # Find/convert ONNX model
        final_onnx = output_dir / model_info['onnx_name']
        result = convert_paddle_to_onnx(extract_dir, final_onnx, model_key)
        
        if result:
            print(f"✓ Model ready: {final_onnx}")
            downloaded.append({
                "type": model_key,
                "path": str(final_onnx),
                "size_mb": final_onnx.stat().st_size / (1024 * 1024) if final_onnx.exists() else 0
            })
        else:
            print(f"✗ Model conversion required for: {model_key}")
        
        # Clean up tar file
        if tar_path.exists():
            tar_path.unlink()
            print(f"Cleaned up: {tar_filename}")
    
    return downloaded


def main():
    parser = argparse.ArgumentParser(description="Download PP-OCRv4 Server Models")
    parser.add_argument(
        '--output',
        type=Path,
        default=Path('models'),
        help='Output directory for models (default: models/)'
    )
    parser.add_argument(
        '--models',
        nargs='+',
        choices=['det', 'cls', 'rec'],
        help='Specific models to download (default: all)'
    )
    
    args = parser.parse_args()
    
    print("=== PP-OCRv4 Model Downloader ===")
    print(f"Output directory: {args.output}")
    print()
    
    downloaded = download_models(args.output, args.models)
    
    print("\n=== Download Summary ===")
    for model in downloaded:
        print(f"  {model['type']:4s}: {model['path']} ({model['size_mb']:.1f} MB)")
    
    print("\n=== Next Steps ===")
    print("1. Verify ONNX models were extracted successfully")
    print("2. Set environment variables in docker-compose.yml:")
    print(f"     MEDOCR_DET_MODEL_PATH=/app/models/{MODEL_URLS['det']['onnx_name']}")
    print(f"     MEDOCR_CLS_MODEL_PATH=/app/models/{MODEL_URLS['cls']['onnx_name']}")
    print(f"     MEDOCR_REC_MODEL_PATH=/app/models/{MODEL_URLS['rec']['onnx_name']}")
    print("3. Mount models directory in docker-compose.yml:")
    print("     volumes:")
    print("       - ./ocr_service/models:/app/models:ro")
    print("4. Rebuild and test:")
    print("     docker-compose build ocr")
    print("     python benchmark.py --test-dir test_data --output ppocr4_results.json")


if __name__ == '__main__':
    main()
