#!/usr/bin/env python3
"""Deep-dive: CPT value accuracy and insurance/provider failures."""
import json, glob, os, re, subprocess

print("=" * 70)
print("DEEP INVESTIGATION: CPT values, Insurance nulls, Provider null")
print("=" * 70)

# ============================================================
# Part 1: CPT value accuracy - are we returning the RIGHT code?
# ============================================================
print("\n\n" + "=" * 70)
print("PART 1: CPT VALUE ACCURACY")
print("=" * 70)
print("""
Filenames encode ground truth CPT codes (e.g., 'Anderson, Darryl_95806,95810,95811.pdf')
The filename contains ALL CPTs the provider ordered, from low to high complexity:
  95806 = unattended sleep test (HST/HSAT)
  95810 = attended polysomnography (PSG) 
  95811 = attended PSG with CPAP titration (split-night)

When multiple CPTs are listed, typically the HIGHER code (95810 or 95811) is
what gets authorized/performed. The lower code is the initial order.
""")

bench_files = sorted(glob.glob('/Users/agyhernandez/Desktop/bench/*.pdf'))
gt = {}
for bf in bench_files:
    fn = os.path.basename(bf).replace('.pdf', '')
    parts = fn.rsplit('_', 1)
    if len(parts) == 2:
        name_part = parts[0].strip()
        cpt_part = parts[1].strip()
        last = name_part.split(',')[0].strip().lower()
        cpts = [c.strip() for c in cpt_part.split(',') if re.match(r'^\d{5}$', c.strip())]
        gt[last] = {'filename': fn, 'cpts': cpts, 'raw': cpt_part, 'highest': max(cpts) if cpts else None}

# Categorize results
results = sorted(glob.glob('/Users/agyhernandez/Desktop/medocr/data/results/doc_177317679*.json'))
exact_highest = 0
exact_any = 0
wrong_but_sleep = 0
total_compared = 0
details = []

for f in results:
    d = json.load(open(f))
    p = d.get('patient', {})
    proc = d.get('procedure', {})
    last = (p.get('last') or '').strip().lower()
    extracted = proc.get('cpt') or ''
    
    # Match to ground truth
    matched_gt = None
    for gl, gd in gt.items():
        if gl in last or last in gl or (len(last) > 3 and gl[:4] == last[:4]):
            matched_gt = gd
            break
    
    if not matched_gt or not matched_gt['cpts']:
        continue
    
    if not extracted:
        total_compared += 1
        details.append(f"  MISS:     {matched_gt['filename']:<45} expected={matched_gt['cpts']}")
        continue
    
    total_compared += 1
    exp = matched_gt['cpts']
    highest = matched_gt['highest']
    
    if extracted == highest:
        exact_highest += 1
        details.append(f"  HIGHEST:  {matched_gt['filename']:<45} expected={exp} -> {extracted} ✓ (highest)")
    elif extracted in exp:
        exact_any += 1
        details.append(f"  IN LIST:  {matched_gt['filename']:<45} expected={exp} -> {extracted} (not highest)")
    elif re.search(r'9580[0-9]|9581[01]', extracted):
        wrong_but_sleep += 1
        details.append(f"  SLEEP:    {matched_gt['filename']:<45} expected={exp} -> {extracted} ✗ (valid sleep, wrong code)")
    else:
        details.append(f"  BAD:      {matched_gt['filename']:<45} expected={exp} -> {extracted} ✗✗")

print(f"\nResults ({total_compared} docs with ground truth CPT):")
print(f"  Matched highest CPT:  {exact_highest}/{total_compared} ({100*exact_highest//total_compared}%)")
print(f"  Matched any in list:  {exact_any}/{total_compared} ({100*exact_any//total_compared}%)")
print(f"  Wrong but valid sleep: {wrong_but_sleep}/{total_compared}")
print(f"  Missing (null):       {total_compared - exact_highest - exact_any - wrong_but_sleep}/{total_compared}")
print(f"\n  TOTAL CORRECT (exact match to any listed): {exact_highest + exact_any}/{total_compared}")

print(f"\nDetails:")
for d in sorted(details):
    print(d)

# ============================================================
# Part 2: Insurance null analysis - are the PDFs scanned images?
# ============================================================
print("\n\n" + "=" * 70)
print("PART 2: INSURANCE NULL ANALYSIS")
print("=" * 70)

ins_null_patients = {
    'Becerra': 'doc_1773176790083_wmbucl',
    'Brissette_ChartNotes': 'doc_1773176790095_caw6cv',
    'Grizzle': 'doc_1773176790117_ub896i',
    'Lombardi': 'doc_1773176790134_apym9z',
    'Serenil': 'doc_1773176790153_gvfjlx',
}

for label, docid in ins_null_patients.items():
    f = f'/Users/agyhernandez/Desktop/medocr/data/results/{docid}.json'
    d = json.load(open(f))
    p = d.get('patient', {})
    tlm = d.get('_textLlm', {})
    ins = d.get('insurance', [{}])
    prov = d.get('provider', {})
    
    print(f"\n  {label}:")
    print(f"    Patient: {p.get('last')}, {p.get('first')}")
    print(f"    Insurance: {json.dumps(ins[0] if ins else {})}")
    print(f"    Pages: {tlm.get('pagesUsed')}, Text: {tlm.get('textLength')} chars")
    print(f"    Provider: {prov.get('name')}")
    print(f"    Reason: {d.get('clinical',{}).get('reasonForReferral') or '?'}")

# ============================================================  
# Part 3: How many docs return only 95810 regardless of expected
# ============================================================
print("\n\n" + "=" * 70)
print("PART 3: CPT DISTRIBUTION (what codes are we actually returning)")
print("=" * 70)

cpt_dist = {}
for f in results:
    d = json.load(open(f))
    proc = d.get('procedure', {})
    cpt = proc.get('cpt') or 'NULL'
    cpt_dist[cpt] = cpt_dist.get(cpt, 0) + 1

for k, v in sorted(cpt_dist.items(), key=lambda x: -x[1]):
    print(f"  {k}: {v} docs ({100*v//len(results)}%)")

# ============================================================
# Part 4: Provider null case 
# ============================================================
print("\n\n" + "=" * 70)
print("PART 4: PROVIDER NULL (Sengprachanh first file)")
print("=" * 70)

f = '/Users/agyhernandez/Desktop/medocr/data/results/doc_1773176790150_8o9t07.json'
d = json.load(open(f))
p = d.get('patient', {})
prov = d.get('provider', {})
tlm = d.get('_textLlm', {})

print(f"  Patient: {p.get('last')}, {p.get('first')}")
print(f"  Provider (full): {json.dumps(prov, indent=4)}")
print(f"  Pages: {tlm.get('pagesUsed')}, Text: {tlm.get('textLength')}")
print(f"  Prompt length: ?, KB block: ?")
print(f"  Confidence: {d.get('confidence')} ({d.get('confidenceScore')})")

# Check if second Sengprachanh file DID get provider
f2 = '/Users/agyhernandez/Desktop/medocr/data/results/doc_1773176790152_r774kk.json'
d2 = json.load(open(f2))
prov2 = d2.get('provider', {})
print(f"\n  Second Sengprachanh file:")
print(f"  Provider: {prov2.get('name')}")
print(f"  NPI: {prov2.get('npi')}")
print(f"  Pages: {d2.get('_textLlm',{}).get('pagesUsed')}, Text: {d2.get('_textLlm',{}).get('textLength')}")
