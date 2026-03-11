#!/usr/bin/env python3
"""OCR the two CPT-null PDFs and search for sleep/CPT references."""
import subprocess, json, sys

for name, path in [('BECERRA', '/tmp/becerra.pdf'), ('POLO', '/tmp/polo.pdf')]:
    print(f'\n{"="*60}')
    print(f'OCR ANALYSIS: {name}')
    print(f'{"="*60}')
    
    result = subprocess.run(
        ['curl', '-s', '-X', 'POST', '-F', f'file=@{path}', 'http://127.0.0.1:8000/ocr'],
        capture_output=True, text=True, timeout=60
    )
    
    d = json.loads(result.stdout)
    pages = d.get('pages', [])
    print(f'{len(pages)} pages')
    
    all_text = ''
    for i, p in enumerate(pages):
        text = p.get('text', '')
        conf = p.get('confidence', 0)
        all_text += text + '\n'
        print(f'\n--- Page {i+1} (conf={conf:.3f}, {len(text)} chars) ---')
        
        # Search for CPT/sleep references
        found_any = False
        for line in text.split('\n'):
            low = line.lower()
            keywords = ['9580', '9581', 'cpt', 'sleep study', 'polysomnography', 
                       'psg', 'sleep test', 'sleep apnea', 'obstructive sleep',
                       'sleep referral', 'sleep lab', 'sleep medicine',
                       'overnight', 'titration', 'split night']
            if any(w in low for w in keywords):
                print(f'  ** MATCH: {line.strip()[:120]}')
                found_any = True
        if not found_any:
            print(f'  (no sleep/CPT keywords found on this page)')
    
    # Also search for insurance references
    print(f'\n--- INSURANCE SEARCH ---')
    for line in all_text.split('\n'):
        low = line.lower()
        ins_kw = ['insurance', 'carrier', 'member', 'group', 'plan', 'policy', 
                  'subscriber', 'aetna', 'bcbs', 'anthem', 'cigna', 'united',
                  'medicare', 'medicaid', 'tricare', 'humana']
        if any(w in low for w in ins_kw):
            print(f'  ** {line.strip()[:120]}')
    
    print(f'\n--- FULL PAGE 1 TEXT (first 1500 chars) ---')
    if pages:
        print(pages[0].get('text', '')[:1500])
