#!/usr/bin/env python3
"""Analyze all failure cases in the batch."""
import json, glob

results = sorted(glob.glob('data/results/doc_*.json'))
sleep_cpts = {'95800','95801','95805','95806','95807','95808','95810','95811'}

print('=== MISSING CPT ===')
for r in results:
    with open(r) as f:
        d = json.load(f)
    proc = d.get('procedure', {})
    cpt = proc.get('cpt')
    p = d.get('patient', {})
    name = f"{p.get('first','')} {p.get('last','')}"
    if not cpt:
        tlm = d.get('_textLlm', {})
        print(f"  {name}: CPT=None, method={d.get('extractionMethod')}, textLen={tlm.get('textLength',0)}")

print()
print('=== NON-SLEEP CPT ===')
for r in results:
    with open(r) as f:
        d = json.load(f)
    proc = d.get('procedure', {})
    cpt = proc.get('cpt')
    p = d.get('patient', {})
    name = f"{p.get('first','')} {p.get('last','')}"
    if cpt and cpt not in sleep_cpts:
        print(f"  {name}: CPT={cpt}, desc={proc.get('description','')}")

print()
print('=== MISSING PROVIDER ===')
for r in results:
    with open(r) as f:
        d = json.load(f)
    prov = d.get('provider', {})
    pname = prov.get('name')
    p = d.get('patient', {})
    name = f"{p.get('first','')} {p.get('last','')}"
    if not pname:
        print(f"  {name}: provider.name=None, phone={prov.get('phone')}, npi={prov.get('npi')}")

print()
print('=== FLAGGED (VLM could not fix) ===')
for r in results:
    with open(r) as f:
        d = json.load(f)
    v = d.get('_verification', {})
    if v.get('status') == 'flagged':
        p = d.get('patient', {})
        name = f"{p.get('first','')} {p.get('last','')}"
        vlm = v.get('vlmConfirmation', {})
        print(f"  {name}:")
        print(f"    Uncertainty: {v.get('uncertainty', {})}")
        if vlm:
            mm = vlm.get('mismatches', [])
            for m in mm:
                print(f"    Mismatch: {m.get('field')} extracted={m.get('extracted')} vlmSays={m.get('vlmSays')} verdict={m.get('verdict')}")
