#!/usr/bin/env python3
import json, glob, os, sys

files = sorted(glob.glob('data/results/doc_1772742*.json'))
if not files:
    # Fallback to all results
    files = sorted(glob.glob('data/results/doc_17726*.json'))
if not files:
    print("No batch results found")
    sys.exit(1)

def analyze(docs, label):
    total = len(docs)
    if total == 0:
        return
    counts = dict.fromkeys(['name','dob','phones','address','insurance','memberId',
                            'provName','provPhone','provFax','cpt','diagnoses'], 0)
    cpt_issues = []
    problems = []

    for d in docs:
        p = d.get('patient', {}) or {}
        ins_list = d.get('insurance', []) or []
        ins = ins_list[0] if isinstance(ins_list, list) and ins_list else {}
        prov = d.get('provider', {}) or {}
        proc = d.get('procedure', {}) or {}

        counts['name'] += bool(p.get('first')) and bool(p.get('last'))
        counts['dob'] += bool(p.get('dob'))
        counts['phones'] += len(p.get('phones', []) or []) > 0
        addr = p.get('address', {})
        counts['address'] += (isinstance(addr, dict) and bool(addr.get('street')))
        counts['insurance'] += bool(ins.get('name') or ins.get('memberId'))
        counts['memberId'] += bool(ins.get('memberId'))
        counts['provName'] += bool(prov.get('name'))
        counts['provPhone'] += bool(prov.get('phone'))
        counts['provFax'] += bool(prov.get('fax'))
        cpt_val = proc.get('cpt', '') or ''
        counts['cpt'] += bool(cpt_val)
        diag = d.get('diagnoses', []) or []
        counts['diagnoses'] += len(diag) > 0

        if cpt_val and len(str(cpt_val)) > 5:
            nm = p.get('first','?') + ' ' + p.get('last','?')
            cpt_issues.append((nm, str(cpt_val)))

        missing = []
        if not counts['name']: pass  # skip for per-doc
        for k in ['name','dob','phones','address','insurance','cpt','diagnoses']:
            # per-doc check
            pass

    print(f'=== {label} - {total} docs ===')
    for k, v in counts.items():
        pct = v / total * 100
        bar = '#' * int(pct / 5) + '.' * (20 - int(pct / 5))
        print(f'  {k:12s} {v:3d}/{total:3d}  [{bar}] {pct:.0f}%')
    if cpt_issues:
        print(f'  CPT concat issues: {len(cpt_issues)}')
        for nm, cpt in cpt_issues:
            print(f'    {nm}: {cpt}')
    print()


# Group by extraction method
by_method = {}
for f in files:
    d = json.load(open(f))
    d['_file'] = f
    m = d.get('extractionMethod', 'unknown')
    by_method.setdefault(m, []).append(d)

print(f'Total results: {len(files)}')
print(f'Methods: {", ".join(f"{k}={len(v)}" for k, v in sorted(by_method.items()))}')
print()

for method, docs in sorted(by_method.items(), key=lambda x: -len(x[1])):
    model = docs[0].get('_vlm', {}).get('model', '?') if docs else '?'
    analyze(docs, f'{method} ({model})')

# Overall
all_docs = []
for f in files:
    all_docs.append(json.load(open(f)))
analyze(all_docs, 'ALL COMBINED')
