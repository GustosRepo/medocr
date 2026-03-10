#!/usr/bin/env python3
"""Show auto-corrected and flagged docs with correction details."""
import json, glob

results = sorted(glob.glob('data/results/doc_*.json'))
for r in results:
    with open(r) as f:
        d = json.load(f)
    v = d.get('_verification', {})
    if v.get('status') in ('auto_corrected', 'flagged'):
        p = d.get('patient', {})
        name = f"{p.get('first','')} {p.get('last','')}"
        print(f"--- {name} [{v['status']}] ---")
        unc = v.get('uncertainty', {})
        print(f"  Uncertainty: score={unc.get('score',0)}, reasons={unc.get('reasons',[])}")
        vlm = v.get('vlmConfirmation', {})
        if vlm:
            mm = vlm.get('mismatches', [])
            for m in mm:
                print(f"  Mismatch: {m.get('field')} => extracted={m.get('extracted')}, vlmSays={m.get('vlmSays')}, verdict={m.get('verdict')}")
            ca = vlm.get('correctionsApplied', [])
            for c in ca:
                print(f"  Correction: {c['field']}: {c['old']} -> {c['new']}")
        print()
