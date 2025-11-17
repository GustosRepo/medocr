import json

# Load existing catalog
with open('carriers_catalog.json', 'r') as f:
    catalog = json.load(f)

# Common member ID patterns by carrier type
PATTERNS = {
    'bcbs': [
        {"pattern": "^[A-Z]{3}\\d{9}$", "name": "Standard BCBS Format", "score": 22, "examples": ["ABC123456789"]},
        {"pattern": "^[A-Z]{2}\\d{10}$", "name": "Alternate BCBS Format", "score": 18, "examples": ["AB1234567890"]},
        {"pattern": "^[A-Z0-9]{11}$", "name": "Alphanumeric 11-char", "score": 15},
        {"pattern": "^[A-Z]{1}\\d{8}$", "name": "Single letter + 8 digits", "score": 12, "examples": ["W12345678"]}
    ],
    'united': [
        {"pattern": "^\\d{9}$", "name": "Standard UHC 9-digit", "score": 20, "examples": ["123456789"]},
        {"pattern": "^[A-Z]{1}\\d{8}$", "name": "Letter + 8 digits", "score": 18, "examples": ["W12345678"]},
        {"pattern": "^[A-Z0-9]{9,11}$", "name": "Alphanumeric variant", "score": 12}
    ],
    'aetna': [
        {"pattern": "^W\\d{9}$", "name": "W-prefix format", "score": 25, "examples": ["W123456789"]},
        {"pattern": "^[A-Z]{1}\\d{8}$", "name": "Standard Aetna Format", "score": 22, "examples": ["W12345678"]},
        {"pattern": "^[A-Z0-9]{9,11}$", "name": "Alphanumeric variant", "score": 12}
    ],
    'cigna': [
        {"pattern": "^[A-Z0-9]{8,11}$", "name": "Standard Cigna Format", "score": 18}
    ],
    'humana': [
        {"pattern": "^H\\d{8,9}$", "name": "H-prefix format", "score": 22, "examples": ["H12345678"]},
        {"pattern": "^\\d{9,11}$", "name": "Pure numeric", "score": 15}
    ],
    'medicaid': [
        {"pattern": "^\\d{8,12}$", "name": "Standard Medicaid Format", "score": 18},
        {"pattern": "^[A-Z]{2}\\d{6,10}$", "name": "State prefix + digits", "score": 15}
    ],
    'generic': [
        {"pattern": "^[A-Z0-9]{8,12}$", "name": "Generic alphanumeric", "score": 10}
    ]
}

# Map carriers to pattern types
CARRIER_PATTERN_MAP = {
    'Anthem BCBS': 'bcbs',
    'Blue Cross/Blue Shield': 'bcbs',
    'United Healthcare': 'united',
    'United Healthcare Medicare': 'united',
    'Aetna': 'aetna',
    'Aetna Medicare': 'aetna',
    'Cigna': 'cigna',
    'Humana': 'humana',
    'Humana HMO': 'humana',
    'Humana PPO': 'humana',
    'Medicaid': 'medicaid',
    'Anthem BCBS Medicaid': 'medicaid',
    'HPN Medicaid': 'medicaid',
    'Molina Medicaid': 'medicaid'
}

# Generate JSON files for each carrier
for carrier_entry in catalog:
    carrier_name = carrier_entry['name']
    status = carrier_entry['status']
    patterns_raw = carrier_entry['patterns']
    
    # Skip if already have specific file
    if carrier_name in ['Medicare', 'Blue Cross Blue Shield', 'UnitedHealthcare', 'Aetna']:
        continue
    
    # Determine pattern type
    pattern_type = CARRIER_PATTERN_MAP.get(carrier_name, 'generic')
    member_id_patterns = PATTERNS.get(pattern_type, PATTERNS['generic'])
    
    # Build carrier JSON
    carrier_json = {
        "carrier": carrier_name,
        "status": status,
        "synonyms": [carrier_name.lower()],
        "patterns": {
            "memberId": member_id_patterns
        },
        "labels": {
            "memberId": ["insurance id", "member id", "subscriber id", "policy number"]
        },
        "sections": {
            "preferredLocation": "insurance_section",
            "avoidLocations": ["header", "footer", "page_identifier"]
        },
        "validation": {
            "memberIdLength": {"min": 6, "max": 15}
        },
        "metadata": {
            "requiresPreauth": status == "accepted"
        }
    }
    
    # Write file
    filename = carrier_name.lower().replace(' ', '_').replace('/', '_').replace('&', 'and') + '.json'
    with open(filename, 'w') as f:
        json.dump(carrier_json, f, indent=2)
    
    print(f"Created: {filename}")

print(f"\nGenerated {len(catalog)} carrier files")
