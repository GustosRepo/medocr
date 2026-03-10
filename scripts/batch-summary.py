#!/usr/bin/env python3
"""Summarize text_llm batch results from backend.log"""
import json, sys, os, glob

LOG = os.path.join(os.path.dirname(__file__), '..', 'data', 'logs', 'backend.log')
RESULTS_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'results')

# Parse logs
docs = {}
with open(LOG) as f:
    for line in f:
        line = line.strip()
        if not line or 'text_llm' not in line:
            continue
        try:
            d = json.loads(line)
        except:
            continue
        did = d.get('id', '')
        msg = d.get('msg', '')
        if not did:
            continue
        if did not in docs:
            docs[did] = {}
        if 'ocr_complete' in msg:
            docs[did]['ocr_ms'] = d.get('elapsed', 0)
            docs[did]['pages'] = d.get('pages', 0)
        elif 'extract_complete' in msg:
            docs[did]['llm_ms'] = d.get('elapsed', 0)
        elif 'pipeline_complete' in msg:
            docs[did]['total_ms'] = d.get('elapsed', 0)
        elif msg == 'text_llm_result':
            docs[did]['hasName'] = d.get('hasName', False)
            docs[did]['hasDob'] = d.get('hasDob', False)
            docs[did]['hasCpt'] = d.get('hasCpt', False)
            docs[did]['hasProvider'] = d.get('hasProvider', False)
            docs[did]['conf'] = d.get('confidence', 0)
        elif 'pdf_trimmed' in msg:
            docs[did]['totalPages'] = d.get('totalPages', 0)

# Also check result files for patient names
for did in docs:
    rfile = os.path.join(RESULTS_DIR, f'{did}.json')
    if os.path.exists(rfile):
        try:
            r = json.load(open(rfile))
            p = r.get('patient', {})
            docs[did]['patientName'] = f"{p.get('first', '?')} {p.get('last', '?')}"
            docs[did]['cpt'] = r.get('procedure', {}).get('cpt', None)
        except:
            pass

# Print summary
print(f"{'Doc ID':<38} {'Name':<20} {'OCR':>6} {'LLM':>6} {'Total':>7} {'Pg':>3} {'Nm':>3} {'DOB':>4} {'CPT':>6} {'Conf':>5}")
print('-' * 110)

totals = []
for did in sorted(docs.keys()):
    d = docs[did]
    if 'total_ms' not in d:
        continue
    ocr = d.get('ocr_ms', 0) / 1000
    llm = d.get('llm_ms', 0) / 1000
    total = d.get('total_ms', 0) / 1000
    pg = d.get('pages', '?')
    nm = 'Y' if d.get('hasName') else 'N'
    dob = 'Y' if d.get('hasDob') else 'N'
    cpt_val = d.get('cpt', '?')
    cpt_str = str(cpt_val)[:6] if cpt_val else '-'
    conf = d.get('conf', 0)
    pname = d.get('patientName', '?')[:18]
    totals.append(total)
    print(f"{did[-35:]:<38} {pname:<20} {ocr:>5.1f}s {llm:>5.1f}s {total:>6.1f}s {pg:>3} {nm:>3} {dob:>4} {cpt_str:>6}  {conf:>4}")

print('-' * 110)
if totals:
    print(f"{'SUMMARY':<38} {'':20} {'':>6} {'':>6} {'':>7}")
    print(f"  Docs: {len(totals)}")
    print(f"  Avg time: {sum(totals)/len(totals):.1f}s")
    print(f"  Min time: {min(totals):.1f}s")
    print(f"  Max time: {max(totals):.1f}s")
    print(f"  Total: {sum(totals):.0f}s ({sum(totals)/60:.1f}min)")
    
    # Quality counts
    name_ok = sum(1 for d in docs.values() if d.get('hasName') and 'total_ms' in d)
    dob_ok = sum(1 for d in docs.values() if d.get('hasDob') and 'total_ms' in d)
    cpt_ok = sum(1 for d in docs.values() if d.get('cpt') and 'total_ms' in d)
    prov_ok = sum(1 for d in docs.values() if d.get('hasProvider') and 'total_ms' in d)
    n = len(totals)
    print(f"  Name: {name_ok}/{n} ({100*name_ok/n:.0f}%)")
    print(f"  DOB:  {dob_ok}/{n} ({100*dob_ok/n:.0f}%)")
    print(f"  CPT:  {cpt_ok}/{n} ({100*cpt_ok/n:.0f}%)")
    print(f"  Provider: {prov_ok}/{n} ({100*prov_ok/n:.0f}%)")
