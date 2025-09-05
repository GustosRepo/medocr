#!/usr/bin/env python3
"""
Unit tests for flag_rules.py
"""

import unittest
from datetime import date, datetime
from flag_rules import (
    derive_flags, 
    compute_confidence_bucket, 
    flags_to_actions, 
    load_flags_catalog, 
    severity
)


class TestFlagRules(unittest.TestCase):
    
    def setUp(self):
        """Set up test fixtures"""
        self.today = date(2025, 8, 28)
        self.catalog = {
            'flags': [
                {'id': 'TITRATION_REQUIRES_CLINICAL_REVIEW', 'category': 'core', 'route': 'Clinical review for 95811'},
                {'id': 'PROMINENCE_CONTRACT_ENDED', 'category': 'insurance', 'route': 'Out of network — Prominence cutoff'},
                {'id': 'DME_MENTIONED', 'category': 'clinical', 'route': 'DME evaluation before test'},
                {'id': 'NOT_REFERRAL_DOCUMENT', 'category': 'core', 'route': 'Classify as clinical note'},
                {'id': 'NO_TEST_ORDER_FOUND', 'category': 'core', 'route': 'Request explicit order'},
                {'id': 'LOW_OCR_CONFIDENCE', 'category': 'processing', 'route': 'Manual verify OCR areas'}
            ]
        }
        self.rules = {
            'carrier_autoflag': ['BadInsurance', 'RejectCorp'],
            'prominence_contract_end': '10/31/2025',
            'hcpcs': ['E0601', 'E0470', 'A7034'],
            'dme_providers': ['Apria', 'Lincare', 'ResMed']
        }
    
    def test_titration_requires_clinical_review(self):
        """Test 95811 without criteria flags for clinical review"""
        parsed = {
            'doc_type': 'referral',
            'procedure': {'cpt': '95811', 'titration_auto_criteria': False},
            'patient': {'dob': '01/15/1980', 'mrn': 'MRN123', 'phones': ['555-1234']},
            'referral': {'date': '08/20/2025'},
            'insurance': {'primary': {'carrier': 'GoodInsurance'}},
            'clinical': {'symptoms': ['snoring']}
        }
        
        text = "Patient needs sleep study for snoring"
        flags = derive_flags(text, parsed, self.today, self.rules, 0.9)
        
        self.assertIn('TITRATION_REQUIRES_CLINICAL_REVIEW', flags)
    
    def test_prominence_contract_ended(self):
        """Test Prominence after contract end date"""
        parsed = {
            'doc_type': 'referral',
            'procedure': {'cpt': '95810'},
            'patient': {'dob': '01/15/1980', 'mrn': 'MRN123', 'phones': ['555-1234']},
            'referral': {'date': '12/01/2025'},  # After 10/31/2025
            'insurance': {'primary': {'carrier': 'Prominence Health'}},
            'clinical': {'symptoms': ['snoring']}
        }
        
        text = "Patient with Prominence insurance needs sleep study"
        flags = derive_flags(text, parsed, self.today, self.rules, 0.9)
        
        self.assertIn('PROMINENCE_CONTRACT_ENDED', flags)
    
    def test_dme_mentioned(self):
        """Test DME detection with HCPCS and provider"""
        parsed = {
            'doc_type': 'referral',
            'procedure': {'cpt': '95810'},
            'patient': {'dob': '01/15/1980', 'mrn': 'MRN123', 'phones': ['555-1234']},
            'referral': {'date': '08/20/2025'},
            'insurance': {'primary': {'carrier': 'GoodInsurance'}},
            'clinical': {'symptoms': ['snoring']},
            'dme': {'hcpcs': ['E0601'], 'providers': ['Apria']}
        }
        
        text = "Patient needs CPAP from Apria with E0601 equipment"
        flags = derive_flags(text, parsed, self.today, self.rules, 0.9)
        
        self.assertIn('DME_MENTIONED', flags)
    
    def test_consult_note_without_order(self):
        """Test consult note classification and missing order"""
        parsed = {
            'doc_type': 'referral',
            'procedure': {},  # No CPT
            'patient': {'dob': '01/15/1980', 'mrn': 'MRN123', 'phones': ['555-1234']},
            'referral': {'date': '08/20/2025'},
            'insurance': {'primary': {'carrier': 'GoodInsurance'}},
            'clinical': {'symptoms': []}
        }
        
        text = """
        CONSULTATION NOTE
        
        History of Present Illness:
        Patient reports excessive daytime sleepiness.
        
        Assessment and Plan:
        Continue monitoring sleep patterns.
        """
        
        flags = derive_flags(text, parsed, self.today, self.rules, 0.9)
        
        self.assertIn('NOT_REFERRAL_DOCUMENT', flags)
        self.assertIn('NO_TEST_ORDER_FOUND', flags)
    
    def test_low_ocr_confidence(self):
        """Test low OCR confidence flagging"""
        parsed = {
            'doc_type': 'referral',
            'procedure': {'cpt': '95810'},
            'patient': {'dob': '01/15/1980', 'mrn': 'MRN123', 'phones': ['555-1234']},
            'referral': {'date': '08/20/2025'},
            'insurance': {'primary': {'carrier': 'GoodInsurance'}},
            'clinical': {'symptoms': ['snoring']}
        }
        
        text = "Patient needs sleep study"
        flags = derive_flags(text, parsed, self.today, self.rules, 0.62)  # Low confidence
        
        self.assertIn('LOW_OCR_CONFIDENCE', flags)
    
    def test_missing_patient_info(self):
        """Test missing patient information detection"""
        parsed = {
            'doc_type': 'referral',
            'procedure': {'cpt': '95810'},
            'patient': {'dob': '', 'mrn': '', 'phones': []},  # Missing info
            'referral': {'date': '08/20/2025'},
            'insurance': {'primary': {'carrier': 'GoodInsurance'}},
            'clinical': {'symptoms': ['snoring']}
        }
        
        text = "Patient needs sleep study"
        flags = derive_flags(text, parsed, self.today, self.rules, 0.9)
        
        self.assertIn('MISSING_PATIENT_INFO', flags)
    
    def test_pediatric_special_handling(self):
        """Test pediatric patient detection"""
        parsed = {
            'doc_type': 'referral',
            'procedure': {'cpt': '95782'},  # Pediatric CPT
            'patient': {'dob': '01/15/2010', 'mrn': 'MRN123', 'phones': ['555-1234']},  # 15 years old
            'referral': {'date': '08/20/2025'},
            'insurance': {'primary': {'carrier': 'GoodInsurance'}},
            'clinical': {'symptoms': ['snoring']}
        }
        
        text = "Pediatric patient needs sleep study"
        flags = derive_flags(text, parsed, self.today, self.rules, 0.9)
        
        self.assertIn('PEDIATRIC_SPECIAL_HANDLING', flags)
    
    def test_contradictory_info(self):
        """Test detection of contradictory information"""
        parsed = {
            'doc_type': 'referral',
            'procedure': {'cpt': '95810'},
            'patient': {'dob': '01/15/1980', 'mrn': 'MRN123', 'phones': ['555-1234']},
            'referral': {'date': '08/20/2025'},
            'insurance': {'primary': {'carrier': 'GoodInsurance'}},
            'clinical': {'symptoms': ['snoring']}
        }
        
        text = "Patient denies snoring but has witnessed apneas"
        flags = derive_flags(text, parsed, self.today, self.rules, 0.9)
        
        self.assertIn('CONTRADICTORY_INFO', flags)
    
    def test_manual_review_required(self):
        """Test manual review flag when multiple high severity flags present"""
        parsed = {
            'doc_type': 'referral',
            'procedure': {'cpt': '95811', 'titration_auto_criteria': False},
            'patient': {'dob': '', 'mrn': '', 'phones': []},  # Missing info
            'referral': {'date': '08/20/2025'},
            'insurance': {'primary': {'carrier': 'BadInsurance'}},  # Auto-flag carrier
            'clinical': {'symptoms': []}  # No symptoms -> missing chart notes
        }
        
        text = "Patient needs titration study"
        flags = derive_flags(text, parsed, self.today, self.rules, 0.9)
        
        # Should have multiple high-severity flags
        high_severity_flags = [f for f in flags if severity(f) == 'high']
        self.assertGreaterEqual(len(high_severity_flags), 2)
        self.assertIn('MANUAL_REVIEW_REQUIRED', flags)
    
    def test_severity_classification(self):
        """Test flag severity classification"""
        self.assertEqual(severity('TITRATION_REQUIRES_CLINICAL_REVIEW'), 'high')
        self.assertEqual(severity('INSURANCE_NOT_ACCEPTED'), 'high')
        self.assertEqual(severity('DME_MENTIONED'), 'medium')
        self.assertEqual(severity('PPE_REQUIRED'), 'low')
    
    def test_flags_to_actions(self):
        """Test flag to action mapping"""
        flags = ['TITRATION_REQUIRES_CLINICAL_REVIEW', 'DME_MENTIONED', 'LOW_OCR_CONFIDENCE']
        actions = flags_to_actions(flags, self.catalog)
        
        expected = [
            'Clinical review for 95811',
            'DME evaluation before test', 
            'Manual verify OCR areas'
        ]
        self.assertEqual(actions, expected)
    
    def test_confidence_bucket_computation(self):
        """Test confidence bucket computation"""
        # High confidence, no major flags
        bucket = compute_confidence_bucket(0.95, ['PPE_REQUIRED'])
        self.assertEqual(bucket, 'High')
        
        # Low OCR confidence
        bucket = compute_confidence_bucket(0.65, [])
        self.assertEqual(bucket, 'Low')
        
        # Manual review required
        bucket = compute_confidence_bucket(0.95, ['MANUAL_REVIEW_REQUIRED'])
        self.assertEqual(bucket, 'Manual Review Required')
        
        # Multiple high severity flags
        bucket = compute_confidence_bucket(0.95, ['MISSING_PATIENT_INFO', 'INSURANCE_NOT_ACCEPTED'])
        self.assertEqual(bucket, 'Low')
        
        # Medium confidence scenario
        bucket = compute_confidence_bucket(0.82, ['MISSING_PATIENT_INFO'])
        self.assertEqual(bucket, 'Medium')


if __name__ == '__main__':
    # Run tests
    unittest.main(verbosity=2)
