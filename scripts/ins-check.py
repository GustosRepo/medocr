#!/usr/bin/env python3
"""Check 3 insurance-null PDFs for insurance text in OCR."""
import subprocess, json, os

files = [
    ('Grizzle', '/tmp/ins_grizzle.pdf'),
    ('Lombardi', '/tmp/ins_lombardi.pdf'),
    ('Serenil', '/tmp/ins_serenil.pdf'),
]

# Copy files first
os.system('cp "/Users/agyhernandez/Desktop/bench/Grizzle, Ward_95811.pdf" /tmp/ins_grizzle.pdf')
os.system('cp "/Users/agyhernandez/Desktop/bench/Lombardi, Camille_95806.pdf" /tmp/ins_lombardi.pdf') 
os.system('cp "/Users/agyhernandez/Desktop/bench/Serenil, Sherilyn_95806,95810,95811.pdf" /tmp/ins_serenil.pdf')

with open('/tmp/ins_analysis.txt', 'w') as out:
    for name, path in files:
        out.write(f'\n{"="*60}\n')
        out.write(f'INSURANCE SEARCH: {name}\n')
        out.write(f'{"="*60}\n')
        
        result = subprocess.run(
            ['curl', '-s', '-X', 'POST', '-F', f'file=@{path}', 'http://127.0.0.1:8000/ocr'],
            capture_output=True, text=True, timeout=120
        )
        
        try:
            d = json.loads(result.stdout)
        except:
            out.write(f'  OCR FAILED\n')
            continue
        
        pages = d.get('ocr', [])
        all_text = '\n'.join(p.get('text', '') for p in pages)
        out.write(f'  {len(pages)} pages, {len(all_text)} chars\n\n')
        
        # Search for insurance keywords
        out.write(f'  INSURANCE-RELATED LINES:\n')
        found = 0
        for line in all_text.split('\n'):
            low = line.lower().strip()
            if not low:
                continue
            kw = ['insur', 'member', 'plan', 'policy', 'subscriber',
                  'aetna', 'bcbs', 'anthem', 'cigna', 'united',
                  'medicare', 'medicaid', 'blue cross', 'payer', 'benefit',
                  'coverage', 'group num', 'id:']
            if any(w in low for w in kw):
                out.write(f'    {line.strip()[:120]}\n')
                found += 1
        if found == 0:
            out.write(f'    (none found)\n')
        out.write('\n')

print('Done. Output in /tmp/ins_analysis.txt')
