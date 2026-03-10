#!/usr/bin/env python3
"""Check OCR text for specific docs to understand CPT failures."""
import json, glob, re

# Map filenames to doc IDs from batch results
results = sorted(glob.glob('data/results/doc_*.json'))
problem_names = ['De Mario', 'Shirley Polo', 'Judith Hantin', 'Dayana ReyesTobar']

for r in results:
    with open(r) as f:
        d = json.load(f)
    p = d.get('patient', {})
    name = f"{p.get('first','')} {p.get('last','')}"
    if any(pn in name for pn in problem_names):
        proc = d.get('procedure', {})
        cpt = proc.get('cpt')
        cpt_desc = proc.get('description', '')
        print(f"=== {name} ===")
        print(f"  CPT: {cpt} ({cpt_desc})")
        print(f"  Method: {d.get('extractionMethod')}")
        
        # Look for sleep-related content in the result
        notes = proc.get('notes', [])
        print(f"  Notes: {notes}")
        
        diag = d.get('diagnoses', [])
        sleep_diag = [dx for dx in diag if 'sleep' in str(dx).lower() or 'G47' in str(dx)]
        print(f"  Sleep diagnoses: {sleep_diag}")
        print()
