#!/usr/bin/env python3
"""Simple metrics harness to run OCR over a directory and count occurrences of
CPT codes, insurance keywords, and DME mentions. Supports A/B between tesseract and paddle.
"""
import argparse
import json
import re
from pathlib import Path
import subprocess

CPT_RE = re.compile(r"\b\d{5}\b")
INSURANCE_KEYWORDS = ["insurance", "medicare", "medicaid", "aetna", "cigna", "unitedhealthcare"]
DME_KEYWORDS = ["DME", "durable medical", "walker", "wheelchair", "oxygen"]


def run_ocr(path: Path, engine: str = 'tesseract', user_words: str = None, user_patterns: str = None):
    cmd = [sys.executable, 'ocr_cli.py', str(path), '--engine', engine]
    if user_words:
        cmd.extend(['--user-words', user_words])
    if user_patterns:
        cmd.extend(['--user-patterns', user_patterns])
    out = subprocess.run(cmd, capture_output=True, text=True)
    try:
        return json.loads(out.stdout)
    except Exception:
        return {'text': out.stdout}


if __name__ == '__main__':
    import sys
    p = argparse.ArgumentParser()
    p.add_argument('input_dir')
    p.add_argument('--engine', choices=['tesseract', 'paddle', 'both'], default='tesseract')
    p.add_argument('--user-words')
    p.add_argument('--user-patterns')
    args = p.parse_args()

    folder = Path(args.input_dir)
    if not folder.exists():
        print('input dir not found')
        sys.exit(1)

    stats = {'total': 0, 'cpt_hits': 0, 'insurance_hits': 0, 'dme_hits': 0}
    per_file = []

    for pth in folder.iterdir():
        if not pth.is_file():
            continue
        stats['total'] += 1
        engines = ['tesseract'] if args.engine != 'both' else ['tesseract', 'paddle']
        results = {}
        for eng in engines:
            res = run_ocr(pth, eng, args.user_words, args.user_patterns)
            text = (res.get('text') or '')
            cpts = CPT_RE.findall(text)
            ins = sum(1 for k in INSURANCE_KEYWORDS if k.lower() in text.lower())
            dme = sum(1 for k in DME_KEYWORDS if k.lower() in text.lower())
            results[eng] = {'cpt_count': len(cpts), 'cpts': cpts, 'insurance_count': ins, 'dme_count': dme}
            if eng == 'tesseract':
                stats['cpt_hits'] += len(cpts)
                stats['insurance_hits'] += ins
                stats['dme_hits'] += dme
        per_file.append({'file': pth.name, 'results': results})

    print(json.dumps({'stats': stats, 'files': per_file}, indent=2))
