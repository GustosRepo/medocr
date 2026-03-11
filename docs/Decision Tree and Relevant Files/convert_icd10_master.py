"""
ICD-10 Master List Converter -- Tier B for MEDOCR
=================================================

PURPOSE:
  Converts the CMS ICD-10-CM flat file into a category-indexed JSON
  optimized for LLM semantic matching (Tier B).

HOW TO GET THE SOURCE FILE:
  1. Go to: https://www.cms.gov/medicare/coding-billing/icd-10-codes
  2. Download the current year's "ICD-10-CM Code Descriptions" 
     (usually a .zip containing icd10cm_codes_[year].txt or similar)
  3. Extract the .txt file -- it's a simple tab or fixed-width format:
     
     Format A (tab-delimited):
       A000\tCholera due to Vibrio cholerae 01, biovar cholerae
     
     Format B (fixed-width, ~8 char code + description):
       A000    Cholera due to Vibrio cholerae 01, biovar cholerae

USAGE:
  python3 convert_icd10_master.py icd10cm_codes_2026.txt

OUTPUT:
  icd10_master_2026.json -- Category-indexed JSON (~3-5 MB)

WHY CATEGORY-INDEXED:
  The LLM doesn't scan all 70K codes. When the system reads "restless legs"
  from notes, it identifies it as neurological (G-category), narrows to G25,
  and the LLM picks G25.81 from just that small block of ~20 codes.
  
  This reduces the LLM's search space from 70K codes to ~50-200 codes
  per category block, making Tier B fast enough for production use.

ANNUAL UPDATE (PIN-8):
  CMS releases new ICD-10-CM codes each October 1.
  1. Download new year's file
  2. Run this script
  3. Validate curated list (icd10_curated.json) against new master:
     - Flag retired codes that are in curated list
     - Note new codes in sleep-relevant categories
  4. Load new icd10_master_[year].json into system
"""

import json
import sys
import os
import re
from collections import defaultdict
from datetime import datetime


def parse_icd10_line(line):
    """Parse a single line from CMS ICD-10-CM file.
    
    Handles both tab-delimited and fixed-width formats.
    Returns (code, description) or None if unparseable.
    """
    line = line.strip()
    if not line:
        return None
    
    # Try tab-delimited first
    if '\t' in line:
        parts = line.split('\t', 1)
        if len(parts) == 2:
            return parts[0].strip(), parts[1].strip()
    
    # Try fixed-width (code is first 7-8 chars, then spaces, then description)
    match = re.match(r'^([A-Z]\d{2}[\dA-Z.]{0,5})\s{2,}(.+)$', line)
    if match:
        return match.group(1).strip(), match.group(2).strip()
    
    # Try space-separated (code has no spaces, description follows)
    parts = line.split(None, 1)
    if len(parts) == 2 and re.match(r'^[A-Z]\d{2}', parts[0]):
        return parts[0].strip(), parts[1].strip()
    
    return None


def get_category(code):
    """Extract the 3-character category from an ICD-10 code.
    
    A00.0 -> A00
    G47.33 -> G47
    E66.01 -> E66
    Z99.81 -> Z99
    """
    # Remove dot if present
    clean = code.replace('.', '')
    return clean[:3] if len(clean) >= 3 else code


def get_chapter(code):
    """Get the ICD-10-CM chapter letter/range for high-level grouping.
    
    Used for the LLM to quickly narrow: "neurological" -> G codes,
    "respiratory" -> J codes, "cardiovascular" -> I codes, etc.
    """
    first_char = code[0].upper()
    chapters = {
        'A': 'infectious_parasitic',      # A00-B99
        'B': 'infectious_parasitic',
        'C': 'neoplasms',                 # C00-D49
        'D': 'blood_immune',              # D50-D89 (overlaps neoplasms D00-D49)
        'E': 'endocrine_metabolic',       # E00-E89
        'F': 'mental_behavioral',         # F01-F99
        'G': 'nervous_system',            # G00-G99
        'H': 'eye_ear',                   # H00-H95
        'I': 'circulatory',              # I00-I99
        'J': 'respiratory',              # J00-J99
        'K': 'digestive',                # K00-K95
        'L': 'skin',                     # L00-L99
        'M': 'musculoskeletal',          # M00-M99
        'N': 'genitourinary',            # N00-N99
        'O': 'pregnancy',               # O00-O9A
        'P': 'perinatal',               # P00-P96
        'Q': 'congenital',              # Q00-Q99
        'R': 'symptoms_signs',           # R00-R99
        'S': 'injury',                   # S00-T88
        'T': 'injury',
        'V': 'external_causes',          # V00-Y99
        'W': 'external_causes',
        'X': 'external_causes',
        'Y': 'external_causes',
        'Z': 'factors_influencing',      # Z00-Z99
    }
    return chapters.get(first_char, 'other')


def convert(input_file, output_file=None):
    """Convert CMS ICD-10-CM file to category-indexed JSON."""
    
    if not os.path.exists(input_file):
        print(f"ERROR: File not found: {input_file}")
        sys.exit(1)
    
    # Determine output filename
    if output_file is None:
        year = datetime.now().year
        # Try to extract year from input filename
        year_match = re.search(r'20\d{2}', input_file)
        if year_match:
            year = year_match.group()
        output_file = f"icd10_master_{year}.json"
    
    print(f"Reading: {input_file}")
    
    # Parse all codes
    codes = {}
    categories = defaultdict(list)
    parse_errors = 0
    
    with open(input_file, 'r', encoding='utf-8', errors='replace') as f:
        for line_num, line in enumerate(f, 1):
            result = parse_icd10_line(line)
            if result is None:
                parse_errors += 1
                if parse_errors <= 5:
                    print(f"  SKIP line {line_num}: {line[:80].strip()}")
                continue
            
            code, description = result
            
            # Normalize code format (add dot if missing)
            if len(code) > 3 and '.' not in code:
                code = code[:3] + '.' + code[3:]
            
            codes[code] = description
            cat = get_category(code)
            categories[cat].append(code)
    
    print(f"Parsed: {len(codes)} codes in {len(categories)} categories")
    if parse_errors > 5:
        print(f"  ({parse_errors} unparseable lines skipped)")
    
    # Build category-indexed structure
    output = {
        "_version": "1.0",
        "_generated": datetime.now().strftime("%Y-%m-%d"),
        "_source": os.path.basename(input_file),
        "_tier": "B",
        "_description": "Full ICD-10-CM master reference for LLM semantic matching. Category-indexed to reduce search space.",
        "_usage": "When Tier A (icd10_curated.json) has no keyword match, system identifies likely chapter/category from clinical context, then LLM semantically matches within that category block.",
        "_total_codes": len(codes),
        "_total_categories": len(categories),
        
        "chapters": {},
        "categories": {}
    }
    
    # Build chapter index
    chapter_cats = defaultdict(list)
    for cat in sorted(categories.keys()):
        chapter = get_chapter(cat)
        chapter_cats[chapter].append(cat)
    
    for chapter, cats in sorted(chapter_cats.items()):
        code_count = sum(len(categories[c]) for c in cats)
        output["chapters"][chapter] = {
            "categories": sorted(cats),
            "code_count": code_count
        }
    
    # Build category blocks
    for cat in sorted(categories.keys()):
        cat_codes = {}
        for code in sorted(categories[cat]):
            cat_codes[code] = codes[code]
        
        output["categories"][cat] = {
            "chapter": get_chapter(cat),
            "code_count": len(cat_codes),
            "codes": cat_codes
        }
    
    # Write output
    print(f"Writing: {output_file}")
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    
    file_size = os.path.getsize(output_file)
    print(f"Done: {file_size / (1024*1024):.1f} MB")
    print()
    
    # Print sleep-relevant categories summary
    sleep_cats = ['G47', 'G25', 'R06', 'R40', 'R53', 'I48', 'I50', 
                  'E66', 'J44', 'F11', 'G20', 'G12', 'G35', 'Z99', 'Z68']
    print("Sleep-relevant categories:")
    for cat in sleep_cats:
        if cat in categories:
            count = len(categories[cat])
            # Show first few codes
            sample = sorted(categories[cat])[:3]
            sample_desc = [f"{c}: {codes[c][:40]}" for c in sample]
            print(f"  {cat} ({count} codes): {', '.join(sample_desc)}...")
        else:
            print(f"  {cat}: not found in file")
    
    return output_file


def validate_curated(master_file, curated_file):
    """Validate Tier A curated list against Tier B master.
    
    Flags:
    - Retired codes (in curated but not in master)
    - New codes in sleep categories (in master but not curated)
    """
    print(f"\nValidating curated list against master...")
    
    with open(master_file) as f:
        master = json.load(f)
    with open(curated_file) as f:
        curated = json.load(f)
    
    master_codes = set()
    for cat_data in master["categories"].values():
        master_codes.update(cat_data["codes"].keys())
    
    curated_codes = set(curated.get("codes", {}).keys())
    
    retired = curated_codes - master_codes
    if retired:
        print(f"\n[!]  RETIRED CODES (in curated, not in master):")
        for code in sorted(retired):
            desc = curated["codes"][code].get("description", "?")
            print(f"  {code}: {desc}")
    else:
        print("[OK] No retired codes found")
    
    # Check for new codes in sleep-relevant categories
    sleep_cats = ['G47', 'G25']
    new_sleep = []
    for cat in sleep_cats:
        if cat in master["categories"]:
            for code in master["categories"][cat]["codes"]:
                if code not in curated_codes:
                    new_sleep.append((code, master["categories"][cat]["codes"][code]))
    
    if new_sleep:
        print(f"\n[DOC] NEW SLEEP CODES (in master, not in curated):")
        for code, desc in sorted(new_sleep):
            print(f"  {code}: {desc}")
    else:
        print("[OK] Curated list covers all sleep-category codes")
    
    print(f"\nSummary: {len(curated_codes)} curated / {len(master_codes)} master")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python3 convert_icd10_master.py <cms_icd10_file.txt>")
        print("  python3 convert_icd10_master.py <cms_file.txt> --validate <curated.json>")
        print()
        print("Download the CMS ICD-10-CM file from:")
        print("  https://www.cms.gov/medicare/coding-billing/icd-10-codes")
        sys.exit(1)
    
    input_file = sys.argv[1]
    output_file = convert(input_file)
    
    # Optional validation
    if '--validate' in sys.argv:
        idx = sys.argv.index('--validate')
        if idx + 1 < len(sys.argv):
            validate_curated(output_file, sys.argv[idx + 1])
        else:
            print("ERROR: --validate requires path to curated JSON")
