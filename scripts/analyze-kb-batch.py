#!/usr/bin/env python3
"""Analyze KB-enriched batch results (doc_177317679* prefix) vs baseline."""
import json, glob, os, re

# KB-enriched batch (current run)
files = sorted(glob.glob('data/results/doc_177317679*.json'))
total = len(files)
print(f'Found {total} result files from KB-enriched batch\n')

name_ok = dob_ok = cpt_ok = prov_ok = cpt_null = ins_ok = npi_ok = 0
ver = {}
issues = []
corrs = []
cpt_details = []

for f in files:
    d = json.load(open(f))
    p = d.get('patient', {})
    prov = d.get('provider', {})
    proc = d.get('procedure', {})
    v = d.get('_verification', {})
    ins = d.get('insurance', [{}])
    tlm = d.get('_textLlm', {})
    
    first = (p.get('first') or '').strip()
    last = (p.get('last') or '').strip()
    name = f'{last}, {first}'
    fname = os.path.basename(f)
    
    vs = v.get('status', 'none')
    ver[vs] = ver.get(vs, 0) + 1
    
    if first and last:
        name_ok += 1
    else:
        issues.append(f'NAME MISSING: {fname}')
    
    if p.get('dob') and p['dob'] not in ('', '\u2014'):
        dob_ok += 1
    else:
        issues.append(f'DOB MISSING: {name} ({fname})')
    
    pn = (prov.get('name') or '').strip()
    if pn and len(pn) > 2:
        prov_ok += 1
    else:
        issues.append(f'PROVIDER MISSING: {name} ({fname})')
    
    if prov.get('npi'):
        npi_ok += 1
    
    carrier = None
    if ins and isinstance(ins, list) and len(ins) > 0:
        carrier = (ins[0].get('carrier') or '').strip()
    if carrier and carrier.lower() not in ('', 'n/a', 'none', 'unknown'):
        ins_ok += 1
    else:
        issues.append(f'INSURANCE MISSING: {name} ({fname})')
    
    cpt = proc.get('cpt') or ''
    # Extract expected CPT from original filename (stored in procedure notes or infer from batch)
    if not cpt or cpt in ('N/A', 'null'):
        cpt_null += 1
        cpt_details.append(f'  NULL: {name}')
        issues.append(f'CPT NULL: {name}')
    elif re.search(r'9580[0-9]|9581[01]', str(cpt)):
        cpt_ok += 1
        cpt_details.append(f'  OK: {name} -> {cpt}')
    else:
        cpt_details.append(f'  NON-SLEEP: {name} -> {cpt}')
        issues.append(f'CPT NON-SLEEP: {name} -> {cpt}')
    
    for c in v.get('corrections', []):
        corrs.append(f'  {name}: {c.get("field","?")} "{c.get("old","")}" -> "{c.get("new","")}"')

pct = lambda n: 100 * n // max(total, 1)

print('=' * 50)
print(f'  KB-ENRICHED BATCH ACCURACY ({total} docs)')
print('=' * 50)
print(f'  Name:      {name_ok}/{total} ({pct(name_ok)}%)')
print(f'  DOB:       {dob_ok}/{total} ({pct(dob_ok)}%)')
print(f'  CPT:       {cpt_ok}/{total} ({pct(cpt_ok)}%) [null: {cpt_null}]')
print(f'  Provider:  {prov_ok}/{total} ({pct(prov_ok)}%)')
print(f'  Insurance: {ins_ok}/{total} ({pct(ins_ok)}%)')
print(f'  NPI:       {npi_ok}/{total} ({pct(npi_ok)}%)')
print()

print('BASELINE COMPARISON:')
print(f'  {"Field":<12} {"Baseline":<12} {"KB-enriched":<12} {"Delta"}')
print(f'  {"─"*12} {"─"*12} {"─"*12} {"─"*8}')
baseline = {'Name': (32, 100), 'DOB': (32, 100), 'CPT': (28, 87), 'Provider': (31, 96)}
current = {'Name': (name_ok, pct(name_ok)), 'DOB': (dob_ok, pct(dob_ok)), 
           'CPT': (cpt_ok, pct(cpt_ok)), 'Provider': (prov_ok, pct(prov_ok))}
for field in baseline:
    b_n, b_pct = baseline[field]
    c_n, c_pct = current[field]
    delta = c_n - b_n
    sign = '+' if delta > 0 else ''
    print(f'  {field:<12} {b_n}/32 ({b_pct}%)   {c_n}/32 ({c_pct}%)   {sign}{delta}')

print()
print('VERIFICATION STATUS:')
for k, cnt in sorted(ver.items(), key=lambda x: -x[1]):
    print(f'  {k}: {cnt}')

print()
print(f'CPT DETAILS ({total}):')
for d in cpt_details:
    print(d)

if corrs:
    print(f'\nAUTO-CORRECTIONS ({len(corrs)}):')
    for c in corrs:
        print(c)

if issues:
    print(f'\nISSUES ({len(issues)}):')
    for i in issues:
        print(f'  {i}')

# Timing stats
elapsed_list = []
for f in sorted(glob.glob('data/results/doc_177317679*.json')):
    d = json.load(open(f))
    tlm = d.get('_textLlm', {})
    e = tlm.get('elapsed', 0)
    if e:
        elapsed_list.append(e / 1000)

if elapsed_list:
    print(f'\nTIMING ({len(elapsed_list)} docs with LLM):')
    print(f'  Avg: {sum(elapsed_list)/len(elapsed_list):.1f}s')
    print(f'  Min: {min(elapsed_list):.1f}s')
    print(f'  Max: {max(elapsed_list):.1f}s')
    print(f'  Total: {sum(elapsed_list):.0f}s ({sum(elapsed_list)/60:.1f}min)')
