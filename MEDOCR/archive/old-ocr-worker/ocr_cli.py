#!/usr/bin/env python3
"""Lightweight OCR CLI wrapper that ensures reliable JSON output.
Tries to run main.py and parse JSON. If that fails or returns empty,
it runs a fallback preprocess + Tesseract and returns JSON with fallback:true.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path


def run_fallback(image_path: str, user_words: str = None, user_patterns: str = None):
    try:
        # local import to avoid heavy deps at module load
        from debug_runner import preprocess
        import pytesseract
        from PIL import Image

        pre = preprocess(image_path)
        pil = Image.fromarray(pre)
        cfg = '--oem 3 --psm 3'
        if user_words:
            cfg += f' --user-words {user_words}'
        if user_patterns:
            cfg += f' --user-patterns {user_patterns}'
        text = pytesseract.image_to_string(pil, config=cfg)
        return {'text': text.strip(), 'avg_conf': None, 'engine': 'tesseract', 'fallback': True}
    except Exception as e:
        return {'error': 'fallback failed', 'detail': str(e)}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('input_path')
    p.add_argument('--engine', choices=['tesseract', 'paddle'], default='tesseract')
    p.add_argument('--debug', action='store_true')
    p.add_argument('--user-words', dest='user_words', help='path to user-words.txt to bias tesseract')
    p.add_argument('--user-patterns', dest='user_patterns', help='path to user-patterns.txt to bias tesseract')
    p.add_argument('--use-legacy', action='store_true', help='force use of legacy complex OCR')
    args = p.parse_args()

    if not Path(args.input_path).exists():
        print(json.dumps({'error': 'input not found'}))
        sys.exit(1)

    res = None
    
    # Try simplified OCR first (unless legacy is forced)
    if not args.use_legacy:
        simple_py = Path('simple_ocr.py')
        if simple_py.exists():
            try:
                cmd = [sys.executable, str(simple_py), args.input_path, '--engine', args.engine]
                if args.debug:
                    cmd.append('--debug')
                if args.user_words:
                    cmd.extend(['--user-words', args.user_words])
                if args.user_patterns:
                    cmd.extend(['--user-patterns', args.user_patterns])
                out = subprocess.run(cmd, capture_output=True, text=True, check=False, timeout=60)
                try:
                    res = json.loads(out.stdout)
                    if res.get('text', '').strip():  # Only accept if we got actual text
                        res['ocr_method'] = 'simplified'
                    else:
                        res = None
                except Exception:
                    res = None
            except Exception:
                res = None

    # Fallback to legacy OCR if simplified failed or was skipped
    if not res:
        main_py = Path('main.py')
        if main_py.exists():
            try:
                cmd = [sys.executable, str(main_py), args.input_path, '--engine', args.engine]
                if args.debug:
                    cmd.append('--debug')
                if args.user_words:
                    cmd.extend(['--user-words', args.user_words])
                if args.user_patterns:
                    cmd.extend(['--user-patterns', args.user_patterns])
                out = subprocess.run(cmd, capture_output=True, text=True, check=False, timeout=60)
                try:
                    res = json.loads(out.stdout)
                    if res.get('text', '').strip():
                        res['ocr_method'] = 'legacy'
                    else:
                        res = None
                except Exception:
                    res = None
            except Exception:
                res = None

    # Final fallback
    if not res:
        fb = run_fallback(args.input_path, user_words=args.user_words, user_patterns=args.user_patterns)
        fb['ocr_method'] = 'fallback'
        print(json.dumps(fb, indent=2))
    else:
        print(json.dumps(res, indent=2))


if __name__ == '__main__':
    main()
