#!/usr/bin/env python3
"""Analyze batch results from gemma3:27b run."""
import json, os, glob

results = sorted(glob.glob('data/results/doc_*.json'))
print(f'Result files: {len(results)}\n')

for r in results:
    with open(r) as f:
        d = json.load(f)
    
    patient = d.get('patient', {})
    provider = d.get('provider', {})
    procedure = d.get('procedure', {})
    meta = d.get('_textLlm', {})
    verify = d.get('_verification', {})
    timing = d.get('_timing', {})
    
    name = f"{patient.get('first','') or ''} {patient.get('last','') or ''}"
    dob = patient.get('dob') or 'N/A'
    cpt = procedure.get('cpt') or 'N/A'
    prov_name = provider.get('name') or 'N/A'
    pphones = patient.get('phones', [])
    pr_phone = provider.get('phone', 'N/A')
    pr_fax = provider.get('fax', 'N/A')
    elapsed = timing.get('totalMs', 0) / 1000
    v_status = verify.get('status', 'none')
    method = d.get('extractionMethod', 'unknown')
    unc_score = verify.get('uncertainty', {}).get('score', 0)
    
    print(f'{name:<25} | DOB:{dob:<12} | CPT:{str(cpt):<8} | Prov:{str(prov_name)[:30]:<30} | {elapsed:.0f}s | V:{v_status}')
    
    # Show corrections if auto_corrected
    vlm_conf = verify.get('vlmConfirmation', {})
    if vlm_conf and isinstance(vlm_conf, dict) and vlm_conf.get('corrections'):
        for c in vlm_conf['corrections']:
            print(f'  ** Correction: {c}')

print('=' * 130)

# Aggregate stats
statuses = []
methods_list = []
times = []
names_found = 0
dobs_found = 0
cpts_found = 0
provs_found = 0
cpt_values = []

for r in results:
    with open(r) as f:
        d = json.load(f)
    patient = d.get('patient', {})
    provider = d.get('provider', {})
    procedure = d.get('procedure', {})
    verify = d.get('_verification', {})
    timing = d.get('_timing', {})
    
    statuses.append(verify.get('status', 'none'))
    methods_list.append(d.get('extractionMethod', 'unknown'))
    times.append(timing.get('totalMs', 0) / 1000)
    
    name = f"{patient.get('first','')} {patient.get('last','')}"
    if name.strip(): names_found += 1
    if patient.get('dob'): dobs_found += 1
    cpt = procedure.get('cpt')
    if cpt: 
        cpts_found += 1
        cpt_values.append(cpt)
    if provider.get('name'): provs_found += 1

print(f'\nVerification breakdown:')
for s in sorted(set(statuses)):
    print(f'  {s}: {statuses.count(s)}')

print(f'\nProcessing method:')
for m in sorted(set(methods_list)):
    print(f'  {m}: {methods_list.count(m)}')

print(f'\nField extraction rate:')
print(f'  Patient Name: {names_found}/{len(results)} ({100*names_found//len(results)}%)')
print(f'  Patient DOB:  {dobs_found}/{len(results)} ({100*dobs_found//len(results)}%)')
print(f'  CPT Codes:    {cpts_found}/{len(results)} ({100*cpts_found//len(results)}%)')
print(f'  Provider:     {provs_found}/{len(results)} ({100*provs_found//len(results)}%)')

print(f'\nCPT values: {sorted(set(cpt_values))} (unique)')

text_llm_times = [t for t, m in zip(times, methods_list) if m == 'text_llm']
vlm_times = [t for t, m in zip(times, methods_list) if m == 'vlm_fallback']
print(f'\nTiming:')
print(f'  All docs avg: {sum(times)/len(times):.1f}s')
print(f'  Text-LLM only ({len(text_llm_times)}): avg {sum(text_llm_times)/max(len(text_llm_times),1):.1f}s')
if vlm_times:
    print(f'  VLM fallback ({len(vlm_times)}): avg {sum(vlm_times)/max(len(vlm_times),1):.1f}s')
