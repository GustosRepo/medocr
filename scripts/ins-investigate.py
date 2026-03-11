#!/usr/bin/env python3
"""Check insurance-null PDFs for insurance-related text via OCR."""
import subprocess, json, os

files = {
    'Grizzle': '/Users/agyhernandez/Desktop/bench/Grizzle, Ward_95811.pdf',
    'Lombardi': '/Users/agyhernandez/Desktop/bench/Lombardi, Camille_95806.pdf',
    'Serenil': '/Users/agyhernandez/Desktop/bench/Serenil, Sherilyn_95806,95810,95811.pdf',
}

for name, path in files.items():
    # Copy to tmp to avoid comma issues
    tmp = f'/tmp/ins_{name.lower()}.pdf'
    os.system(f'cp "{path}" "{tmp}"')
    
    print(f'\n{"="*60}')
    print(f'INSURANCE SEARCH: {name}')
    print(f'{"="*60}')
    
    # Use page selector to only OCR the trimmed pages (first 4)
    result = subprocess.run(
        ['curl', '-s', '-X', 'POST', '-F', f'file=@{tmp}', 
         '-F', 'max_pages=4',
         'http://127.0.0.1:8000/ocr'],
        capture_output=True, text=True, timeout=120
    )
    
    try:
        d = json.loads(result.stdout)
    except:
        print(f"  OCR FAILED: {result.stdout[:200]}")
        continue
    
    pages = d.get('pages', [])
    print(f'  {len(pages)} pages OCR-ed')
    
    all_text = ''
    for i, p in enumerate(pages):
        text = p.get('text', '')
        all_text += text + '\n'
    
    # Search for insurance keywords
    print(f'\n  INSURANCE-RELATED LINES:')
    found = 0
    for line in all_text.split('\n'):
        low = line.lower().strip()
        if not low:
            continue
        keywords = ['insur', 'carrier', 'member', 'group', 'plan', 'policy',
                    'subscriber', 'aetna', 'bcbs', 'anthem', 'cigna', 'united',
                    'medicare', 'medicaid', 'tricare', 'humana', 'blue cross',
                    'anthem', 'payer', 'benefit', 'coverage', 'health plan',
                    'id:', 'id #', 'member id', 'group #']
        if any(w in low for w in keywords):
            print(f'    ** {line.strip()[:120]}')
            found += 1
    if found == 0:
        print(f'    (no insurance keywords found in OCR text)')
    
    print(f'\n  TOTAL OCR TEXT: {len(all_text)} chars across {len(pages)} pages')
