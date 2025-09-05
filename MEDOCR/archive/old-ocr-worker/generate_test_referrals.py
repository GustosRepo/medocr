#!/usr/bin/env python3
"""
Generate synthetic referral images for testing OCR pipeline.
Creates randomized medical referral documents with varying content.
"""

import random
import datetime
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import json

# Load rules for realistic data generation
def load_rules():
    """Load existing rules files for realistic data generation"""
    rules = {}
    try:
        with open('rules/insurance.json') as f:
            rules['insurance'] = json.load(f)
    except:
        rules['insurance'] = {"accepted": ["BCBS", "Aetna", "UHC"], "auto_flag": ["Medicaid"], "contract_end": {"Prominence": "2025-10-31"}}
    
    try:
        with open('rules/cpt_keywords.json') as f:
            rules['cpt'] = json.load(f)
    except:
        rules['cpt'] = {
            "95810": ["sleep study", "sleep evaluation"],
            "95811": ["titration", "cpap titration"],
            "G0399": ["home sleep test"],
            "97110": ["physical therapy", "therapeutic exercise"],
            "99213": ["office visit", "evaluation"]
        }
    
    try:
        with open('rules/symptoms.json') as f:
            rules['symptoms'] = json.load(f)
    except:
        rules['symptoms'] = {
            "priority_keywords": [
                ["snoring", "loud snoring"],
                ["witnessed apneas", "apneic episodes"],
                ["excessive daytime sleepiness", "hypersomnia"],
                ["pain", "back", "chronic", "lower"],
                ["headache", "migraine"],
                ["fatigue", "weakness"]
            ]
        }
    
    try:
        with open('rules/dme.json') as f:
            rules['dme'] = json.load(f)
    except:
        rules['dme'] = [
            {"hcpcs": "E0601", "provider": "Apria"},
            {"hcpcs": "E0470", "provider": "Lincare"},
            {"hcpcs": "E0562", "provider": "ResMed"}
        ]
    
    return rules

# Sample data pools
PATIENT_NAMES = [
    "David Chen", "Sarah Johnson", "Michael Rodriguez", "Emily Davis", 
    "James Wilson", "Lisa Anderson", "Robert Taylor", "Jennifer Brown",
    "Christopher Garcia", "Amanda Martinez", "Daniel Lee", "Jessica White"
]

PHYSICIANS = [
    "Dr. Smith", "Dr. Johnson", "Dr. Williams", "Dr. Brown", "Dr. Jones",
    "Dr. Garcia", "Dr. Miller", "Dr. Davis", "Dr. Rodriguez", "Dr. Wilson"
]

MRNS = [f"MRN{random.randint(100000, 999999)}" for _ in range(20)]

def random_date(days_offset=400):
    """Generate random date within ±days_offset of today"""
    today = datetime.date.today()
    offset = random.randint(-days_offset, days_offset)
    return (today + datetime.timedelta(days=offset)).strftime("%m/%d/%Y")

def random_dob():
    """Generate random date of birth (18-85 years old)"""
    today = datetime.date.today()
    min_age = 18 * 365
    max_age = 85 * 365
    age_days = random.randint(min_age, max_age)
    birth_date = today - datetime.timedelta(days=age_days)
    return birth_date.strftime("%m/%d/%Y")

def generate_referral_content(rules):
    """Generate randomized referral content"""
    
    # Basic patient info
    patient_name = random.choice(PATIENT_NAMES)
    dob = random_dob()
    mrn = random.choice(MRNS)
    physician = random.choice(PHYSICIANS)
    referral_date = random_date()
    
    # Insurance - randomly pick from different pools
    insurance_pools = []
    if rules['insurance'].get('accepted'):
        insurance_pools.extend(rules['insurance']['accepted'])
    if rules['insurance'].get('auto_flag'):
        insurance_pools.extend(rules['insurance']['auto_flag'])
    if rules['insurance'].get('contract_end'):
        insurance_pools.extend(rules['insurance']['contract_end'].keys())
    
    insurance = random.choice(insurance_pools) if insurance_pools else "BCBS"
    
    # CPT code and procedure
    cpt_code = random.choice(list(rules['cpt'].keys()))
    cpt_keywords = rules['cpt'][cpt_code]
    procedure = random.choice(cpt_keywords) if cpt_keywords else "evaluation"
    
    # Symptoms - randomly sample from flattened symptom groups
    all_symptoms = []
    for group in rules['symptoms'].get('priority_keywords', []):
        if isinstance(group, list):
            all_symptoms.extend(group)
        else:
            all_symptoms.append(group)
    
    # Pick 2-4 symptoms
    num_symptoms = random.randint(2, 4)
    selected_symptoms = random.sample(all_symptoms, min(num_symptoms, len(all_symptoms)))
    
    # DME equipment (30% chance)
    dme_mention = ""
    if random.random() < 0.3 and rules['dme']:
        dme_item = random.choice(rules['dme'])
        if random.choice([True, False]):
            dme_mention = f"\nDME Provider: {dme_item.get('provider', 'Unknown')}"
        else:
            dme_mention = f"\nEquipment Code: {dme_item.get('hcpcs', 'Unknown')}"
    
    # Build referral text
    content = f"""PATIENT REFERRAL FORM

Date: {referral_date}

Patient Information:
Patient Name: {patient_name}
DOB: {dob}
MRN: {mrn}
Insurance: {insurance}

Referring Physician: {physician}

Procedure/Service:
CPT: {cpt_code} - {procedure.title()}

Reason for Referral:
Patient presents with {', '.join(selected_symptoms)}.
Requesting evaluation and treatment as appropriate.{dme_mention}

Clinical Notes:
Patient has been experiencing symptoms for several weeks.
Standard conservative treatments have been attempted.
Specialist evaluation recommended for further management.

Authorization: Pre-approved
Priority: Routine

Physician Signature: {physician}
Date: {referral_date}"""

    return content, {
        'patient_name': patient_name,
        'dob': dob,
        'mrn': mrn,
        'insurance': insurance,
        'cpt_code': cpt_code,
        'procedure': procedure,
        'symptoms': selected_symptoms,
        'physician': physician,
        'referral_date': referral_date
    }

def create_referral_image(content, filename):
    """Create PNG image from referral content"""
    
    # Letter size: 8.5" x 11" at 300 DPI
    width, height = 2550, 3300
    
    # Create white background
    image = Image.new('RGB', (width, height), 'white')
    draw = ImageDraw.Draw(image)
    
    # Try to load a better font with larger size for OCR
    font_size = 48  # Increased from 36
    try:
        # Try system fonts that are more OCR-friendly
        font = ImageFont.truetype("/System/Library/Fonts/Courier.ttc", font_size)
    except:
        try:
            font = ImageFont.truetype("/System/Library/Fonts/Monaco.ttc", font_size)
        except:
            try:
                font = ImageFont.truetype("Courier New", font_size)
            except:
                try:
                    font = ImageFont.truetype("courier", font_size)
                except:
                    # Load default with larger size
                    font = ImageFont.load_default()
    
    # Text positioning with more margin
    margin = 150  # Increased from 100
    line_spacing = 60  # Increased from 45
    y_position = margin
    
    # Split content into lines and draw
    lines = content.split('\n')
    
    for line in lines:
        # Make sure text fits on page
        if y_position > height - margin - line_spacing:
            break
            
        if font:
            draw.text((margin, y_position), line, fill='black', font=font)
        else:
            draw.text((margin, y_position), line, fill='black')
        y_position += line_spacing
    
    # Save image with higher quality
    image.save(filename, 'PNG', dpi=(300, 300), optimize=False)
    print(f"Saved: {filename}")

def main():
    """Generate multiple random referral images"""
    
    print("Generating synthetic referral images for OCR testing...")
    print("=" * 60)
    
    # Load rules for realistic data
    rules = load_rules()
    
    # Generate 5 random referrals
    for i in range(1, 6):
        print(f"\n--- REFERRAL {i} ---")
        
        # Generate content
        content, metadata = generate_referral_content(rules)
        
        # Print to console
        print(content)
        print(f"\nMetadata: {metadata}")
        
        # Create image
        filename = f"test_referral_{i:02d}.png"
        create_referral_image(content, filename)
        
        print(f"Generated: {filename}")
    
    print(f"\n{'-'*60}")
    print("Generated 5 test referral images successfully!")
    print("You can now test these with your OCR pipeline:")
    print("  curl -F 'file=@test_referral_01.png' http://localhost:5000/ocr")

if __name__ == "__main__":
    main()
