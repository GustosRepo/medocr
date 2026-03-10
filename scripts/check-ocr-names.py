#!/usr/bin/env python3
"""Check OCR text for name-related content in failing docs."""
import subprocess, json, sys, os

BENCH = "/Users/agyhernandez/Desktop/bench"
OCR_URL = "http://127.0.0.1:8000/ocr?dpi=150&mode=basic&skip_rotate=true&skip_tile=true"
FAILING = [
    "Hook, Cameron_95806,95810,95811.pdf",
    "Kamer, Gregory_95806.pdf",
    "Kitchen, Jon_95806,95810.pdf",
    "Garcia, Mary_95806,95810,95811.pdf",
    "Grizzle, Ward_95811.pdf",
    "Polo, Shirley_95806.pdf",
    "Lombardi, Camille_95806.pdf",
    "Oporto, Ed Anthony_VA.pdf",
    "White, Gastinel Depriest_VA.pdf",
]

for fname in FAILING:
    fpath = os.path.join(BENCH, fname)
    if not os.path.exists(fpath):
        print(f"SKIP: {fname} not found")
        continue
    
    expected_last = fname.split(",")[0].strip()
    expected_first = fname.split(",")[1].strip().split("_")[0] if "," in fname else "?"
    
    print(f"\n{'='*60}")
    print(f"FILE: {fname}")
    print(f"EXPECTED: {expected_first} {expected_last}")
    print(f"{'='*60}")
    
    result = subprocess.run(
        ["curl", "-s", "-X", "POST", "-F", f"file=@{fpath}", OCR_URL],
        capture_output=True, text=True
    )
    try:
        data = json.loads(result.stdout)
    except:
        print(f"  ERROR parsing OCR response")
        continue
    
    pages = data.get("ocr", [])
    for i, page in enumerate(pages[:2]):
        text = page.get("text", "")
        print(f"\n  --- Page {i+1} (first 600 chars) ---")
        lines = [l.strip() for l in text.split("\n") if l.strip()]
        for line in lines[:15]:
            # Highlight lines with patient name keywords
            low = line.lower()
            marker = ""
            if any(w in low for w in ["patient", "name", "dob", "birth", expected_last.lower()[:5], expected_first.lower()[:4]]):
                marker = " <<<" 
            print(f"  {line[:120]}{marker}")
