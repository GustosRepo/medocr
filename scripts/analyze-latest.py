import json, glob, os, re

files = sorted(glob.glob('data/results/doc_177309062*.json'))
total = len(files)
name_ok = dob_ok = cpt_ok = prov_ok = cpt_null = 0
ver = {}
issues = []
corrs = []

for f in files:
    d = json.load(open(f))
    p = d.get('patient', {})
    prov = d.get('provider', {})
    proc = d.get('procedure', {})
    v = d.get('_verification', {})
    first = (p.get('first') or '').strip()
    last = (p.get('last') or '').strip()
    name = f'{last}, {first}'
    vs = v.get('status', 'none')
    ver[vs] = ver.get(vs, 0) + 1
    if first and last:
        name_ok += 1
    else:
        issues.append(f'NAME: {name} ({os.path.basename(f)})')
    if p.get('dob') and p['dob'] not in ('', '\u2014'):
        dob_ok += 1
    else:
        issues.append(f'DOB MISSING: {name}')
    pn = (prov.get('name') or '').strip()
    if pn and len(pn) > 2:
        prov_ok += 1
    else:
        issues.append(f'PROVIDER MISSING: {name}')
    cpt = proc.get('cpt') or ''
    if not cpt or cpt == 'N/A':
        cpt_null += 1
        issues.append(f'CPT NULL: {name}')
    elif re.search(r'9580[0-9]|9581[01]', str(cpt)):
        cpt_ok += 1
    else:
        issues.append(f'CPT NON-SLEEP: {name} -> {cpt}')
    for c in v.get('corrections', []):
        corrs.append(f'  {name}: {c.get("field","?")} "{c.get("old","")}" -> "{c.get("new","")}"')

pct = lambda n: 100 * n // max(total, 1)
print(f'=== BATCH ACCURACY ({total} docs) ===')
print(f'Name:     {name_ok}/{total} ({pct(name_ok)}%)')
print(f'DOB:      {dob_ok}/{total} ({pct(dob_ok)}%)')
print(f'CPT:      {cpt_ok}/{total} ({pct(cpt_ok)}%) [null: {cpt_null}]')
print(f'Provider: {prov_ok}/{total} ({pct(prov_ok)}%)')
print()
print('VERIFICATION:')
for k, cnt in sorted(ver.items(), key=lambda x: -x[1]):
    print(f'  {k}: {cnt}')
print()
if corrs:
    print(f'AUTO-CORRECTIONS ({len(corrs)}):')
    for c in corrs:
        print(c)
    print()
if issues:
    print(f'ISSUES ({len(issues)}):')
    for i in issues:
        print(f'  {i}')
