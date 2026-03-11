#!/usr/bin/env python3
"""Deep investigation of batch failure cases."""
import json, glob, os, re

print("=" * 60)
print("INVESTIGATION: KB-Enriched Batch Failures")
print("=" * 60)

# --- CPT NULL CASES ---
cpt_nulls = {
    'Becerra': 'data/results/doc_1773176790083_wmbucl.json',
    'Polo': 'data/results/doc_1773176790142_hygpdz.json',
}

for name, path in cpt_nulls.items():
    d = json.load(open(path))
    p = d.get('patient', {})
    prov = d.get('provider', {})
    proc = d.get('procedure', {})
    ins = d.get('insurance', [{}])
    tlm = d.get('_textLlm', {})
    ver = d.get('_verification', {})
    
    print(f"\n{'='*60}")
    print(f"CPT NULL: {p.get('last')}, {p.get('first')}")
    print(f"{'='*60}")
    print(f"  File: {os.path.basename(path)}")
    print(f"  Method: {d.get('extractionMethod')}")
    print(f"  OCR conf: {tlm.get('ocrConfidence')}")
    print(f"  Pages: {tlm.get('pagesUsed')}, Text: {tlm.get('textLength')} chars")
    print(f"  LLM elapsed: {tlm.get('elapsed')}ms")
    print(f"  Procedure: {json.dumps(proc)}")
    print(f"  Insurance: {json.dumps(ins[0]) if ins else 'none'}")
    print(f"  Provider: {prov.get('name')} NPI={prov.get('npi')}")
    print(f"  Clinical reason: {d.get('clinical',{}).get('reasonForReferral','?')}")
    print(f"  Symptoms: {[s.get('name') for s in d.get('symptoms',[])]}")
    print(f"  Verification: {ver.get('status')}")
    print(f"  Confidence: {d.get('confidence')} ({d.get('confidenceScore')})")

# --- INSURANCE NULL CASES ---
print(f"\n\n{'='*60}")
print("INSURANCE NULL CASES (5)")
print("="*60)

ins_nulls = [
    ('Becerra', 'data/results/doc_1773176790083_wmbucl.json'),
    ('Brissette-ChartNotes', 'data/results/doc_1773176790095_caw6cv.json'),
    ('Grizzle', 'data/results/doc_1773176790117_ub896i.json'),
    ('Lombardi', 'data/results/doc_1773176790134_apym9z.json'),
    ('Serenil', 'data/results/doc_1773176790153_gvfjlx.json'),
]

for name, path in ins_nulls.items() if hasattr(ins_nulls, 'items') else ins_nulls:
    d = json.load(open(path))
    p = d.get('patient', {})
    ins = d.get('insurance', [{}])
    tlm = d.get('_textLlm', {})
    carrier = ins[0].get('carrier') if ins else None
    member = ins[0].get('memberId') if ins else None
    
    print(f"\n  {name}: carrier={carrier}, memberId={member}")
    print(f"    Pages={tlm.get('pagesUsed')}, Text={tlm.get('textLength')} chars")
    reason = d.get('clinical',{}).get('reasonForReferral') or '?'
    print(f"    Clinical: {reason[:80]}")

# --- PROVIDER NULL CASE ---
print(f"\n\n{'='*60}")
print("PROVIDER NULL CASE")
print("="*60)

d = json.load(open('data/results/doc_1773176790150_8o9t07.json'))
p = d.get('patient', {})
prov = d.get('provider', {})
print(f"  Patient: {p.get('last')}, {p.get('first')}")
print(f"  Provider: {json.dumps(prov, indent=2)}")
print(f"  Pages: {d.get('_textLlm',{}).get('pagesUsed')}")
print(f"  Text length: {d.get('_textLlm',{}).get('textLength')}")

# --- CPT VALUE ACCURACY CHECK ---
print(f"\n\n{'='*60}")
print("CPT VALUE vs FILENAME GROUND TRUTH")
print("="*60)

# Ground truth from filenames
bench_files = sorted(glob.glob('/Users/agyhernandez/Desktop/bench/*.pdf'))
ground_truth = {}
for bf in bench_files:
    fn = os.path.basename(bf).replace('.pdf', '')
    # Extract name part and CPT part
    parts = fn.rsplit('_', 1)
    if len(parts) == 2:
        name_part = parts[0].strip()
        cpt_part = parts[1].strip()
        # Normalize name for matching
        last = name_part.split(',')[0].strip().lower() if ',' in name_part else name_part.lower()
        ground_truth[last] = {
            'filename': fn,
            'expected_cpts': [c.strip() for c in cpt_part.split(',') if re.match(r'^\d{5}$', c.strip())],
            'raw_cpt': cpt_part
        }

# Match results to ground truth
correct = 0
wrong = 0
missing = 0
details = []

files = sorted(glob.glob('data/results/doc_177317679*.json'))
for f in files:
    d = json.load(open(f))
    p = d.get('patient', {})
    proc = d.get('procedure', {})
    last = (p.get('last') or '').strip().lower()
    extracted_cpt = proc.get('cpt') or ''
    
    # Find ground truth match  
    gt = None
    for gt_last, gt_data in ground_truth.items():
        if gt_last in last or last in gt_last or (len(last) > 3 and gt_last[:4] == last[:4]):
            gt = gt_data
            break
    
    if not gt:
        details.append(f"  NO GT MATCH: {p.get('last')}, {p.get('first')} -> {extracted_cpt}")
        continue
    
    expected = gt['expected_cpts']
    if not expected:
        # Files like VA, Chart Notes - no CPT in filename
        details.append(f"  NO EXPECTED: {gt['filename']} -> extracted={extracted_cpt}")
        continue
    
    if not extracted_cpt:
        missing += 1
        details.append(f"  MISS: {gt['filename']} expected={expected} got=NULL")
    elif extracted_cpt in expected:
        correct += 1
        details.append(f"  EXACT: {gt['filename']} expected={expected} got={extracted_cpt}")
    elif re.search(r'9580[0-9]|9581[01]', extracted_cpt):
        # Got a sleep CPT but not the exact one expected
        wrong += 1
        details.append(f"  WRONG: {gt['filename']} expected={expected} got={extracted_cpt}")
    else:
        wrong += 1
        details.append(f"  BAD: {gt['filename']} expected={expected} got={extracted_cpt}")

total_with_gt = correct + wrong + missing
print(f"Exact match: {correct}/{total_with_gt}")
print(f"Wrong CPT:   {wrong}/{total_with_gt}")
print(f"Missing:     {missing}/{total_with_gt}")
print()
for d in sorted(details):
    print(d)
