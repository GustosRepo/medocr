#!/usr/bin/env python3
"""
Quality Control Checks for Medical Form Processing
Validates extracted data according to client specifications
"""

import re
from datetime import datetime
from typing import Dict, List, Any, Tuple


class QualityControlChecker:
    """Performs quality control checks on extracted medical form data"""
    
    def __init__(self):
        # Valid CPT codes for sleep studies
        self.valid_cpt_codes = {
            '95810', '95811', '95782', '95783', '95800', '95801',
            '95806', '95807', '95808', '95822', '95823'
        }
        
        # Major insurance carriers
        self.major_carriers = {
            'AETNA', 'BCBS', 'BLUE CROSS', 'BLUE SHIELD', 'CIGNA', 'HUMANA',
            'UNITED', 'UNITEDHEALTH', 'MEDICARE', 'MEDICAID', 'TRICARE',
            'PROMINENCE', 'ANTHEM', 'KAISER', 'MOLINA'
        }
    
    def run_all_checks(self, extracted_data: Dict[str, Any]) -> Dict[str, List[str]]:
        """
        Run all quality control checks
        
        Args:
            extracted_data: The extracted form data
            
        Returns:
            Dictionary with check results categorized by type
        """
        
        results = {
            'patient_name_consistency': [],
            'date_validation': [],
            'phone_formatting': [],
            'insurance_id_validation': [],
            'cpt_code_validation': [],
            'warnings': [],
            'errors': []
        }
        
        # Run each check
        results['patient_name_consistency'] = self.check_patient_name_consistency(extracted_data)
        results['date_validation'] = self.validate_dates(extracted_data)
        results['phone_formatting'] = self.check_phone_formatting(extracted_data)
        results['insurance_id_validation'] = self.validate_insurance_ids(extracted_data)
        results['cpt_code_validation'] = self.validate_cpt_codes(extracted_data)
        
        # Categorize results into warnings and errors
        for check_type, issues in results.items():
            if check_type not in ['warnings', 'errors']:
                for issue in issues:
                    if any(keyword in issue.lower() for keyword in ['error', 'invalid', 'missing required']):
                        results['errors'].append(f"{check_type}: {issue}")
                    else:
                        results['warnings'].append(f"{check_type}: {issue}")
        
        return results
    
    def check_patient_name_consistency(self, data: Dict[str, Any]) -> List[str]:
        """Check patient name consistency across form sections"""
        issues = []
        
        patient = data.get('patient', {})
        
        # Extract names from different sections
        patient_first = patient.get('first_name', '').strip().upper()
        patient_last = patient.get('last_name', '').strip().upper()
        
        # Check insurance section
        insurance = data.get('insurance', {}).get('primary', {})
        insurance_first = insurance.get('subscriber_first_name', '').strip().upper()
        insurance_last = insurance.get('subscriber_last_name', '').strip().upper()
        
        # Check authorization section
        auth = data.get('authorization', {})
        auth_patient_name = auth.get('patient_name', '').strip().upper()
        
        # Consistency checks
        if patient_first and insurance_first and patient_first != insurance_first:
            issues.append(f"Patient first name mismatch: '{patient_first}' vs '{insurance_first}' in insurance")
        
        if patient_last and insurance_last and patient_last != insurance_last:
            issues.append(f"Patient last name mismatch: '{patient_last}' vs '{insurance_last}' in insurance")
        
        if auth_patient_name:
            auth_names = auth_patient_name.replace(',', ' ').split()
            if len(auth_names) >= 2:
                auth_first = auth_names[-1]  # Usually last word is first name
                auth_last = ' '.join(auth_names[:-1])  # Rest is last name
                
                if patient_first and auth_first and patient_first != auth_first:
                    issues.append(f"Patient first name mismatch: '{patient_first}' vs '{auth_first}' in authorization")
                
                if patient_last and auth_last and patient_last != auth_last:
                    issues.append(f"Patient last name mismatch: '{patient_last}' vs '{auth_last}' in authorization")
        
        # Check for completely missing names
        if not patient_first or not patient_last:
            issues.append("Missing required patient name information")
        
        return issues
    
    def validate_dates(self, data: Dict[str, Any]) -> List[str]:
        """Validate date formats and logical consistency"""
        issues = []
        
        patient = data.get('patient', {})
        referral = data.get('referral', {})
        insurance = data.get('insurance', {}).get('primary', {})
        
        # Check date formats
        dob = patient.get('dob', '')
        ref_date = referral.get('date', '')
        ins_effective = insurance.get('effective_date', '')
        
        # Validate DOB
        if dob:
            if not self._is_valid_date(dob):
                issues.append(f"Invalid date of birth format: {dob}")
            else:
                # Check if DOB is reasonable (not in future, not too old)
                try:
                    dob_obj = self._parse_date(dob)
                    today = datetime.now()
                    
                    if dob_obj > today:
                        issues.append(f"Date of birth is in the future: {dob}")
                    
                    age = (today - dob_obj).days / 365.25
                    if age > 120:
                        issues.append(f"Patient age appears unrealistic: {age:.0f} years")
                    if age < 0:
                        issues.append(f"Invalid patient age: {age:.0f} years")
                        
                except:
                    issues.append(f"Could not parse date of birth: {dob}")
        
        # Validate referral date
        if ref_date:
            if not self._is_valid_date(ref_date):
                issues.append(f"Invalid referral date format: {ref_date}")
            else:
                try:
                    ref_obj = self._parse_date(ref_date)
                    today = datetime.now()
                    
                    # Referral shouldn't be too far in future
                    days_ahead = (ref_obj - today).days
                    if days_ahead > 365:
                        issues.append(f"Referral date is too far in future: {ref_date}")
                        
                except:
                    issues.append(f"Could not parse referral date: {ref_date}")
        
        # Validate insurance effective date
        if ins_effective and not self._is_valid_date(ins_effective):
            issues.append(f"Invalid insurance effective date format: {ins_effective}")
        
        return issues
    
    def check_phone_formatting(self, data: Dict[str, Any]) -> List[str]:
        """Check phone number formatting"""
        issues = []
        
        patient = data.get('patient', {})
        emergency = data.get('emergency_contact', {})
        referring = data.get('referring_physician', {})
        
        # Collect all phone numbers
        phone_fields = [
            ('Patient home phone', patient.get('phone_home', '')),
            ('Patient cell phone', patient.get('phone_cell', '')),
            ('Patient work phone', patient.get('phone_work', '')),
            ('Emergency contact phone', emergency.get('phone', '')),
            ('Referring physician phone', referring.get('phone', '')),
            ('Referring physician fax', referring.get('fax', ''))
        ]
        
        for field_name, phone in phone_fields:
            if phone and not self._is_valid_phone(phone):
                issues.append(f"Invalid phone format for {field_name}: {phone}")
        
        return issues
    
    def validate_insurance_ids(self, data: Dict[str, Any]) -> List[str]:
        """Validate insurance member IDs"""
        issues = []
        
        insurance = data.get('insurance', {})
        primary = insurance.get('primary', {})
        secondary = insurance.get('secondary', {})
        
        # Check primary insurance
        if primary:
            member_id = primary.get('member_id', '')
            carrier = primary.get('carrier', '').upper()
            
            if not member_id:
                issues.append("Missing primary insurance member ID")
            elif not self._is_valid_insurance_id(member_id, carrier):
                issues.append(f"Invalid primary insurance member ID format: {member_id}")
        
        # Check secondary insurance
        if secondary:
            member_id = secondary.get('member_id', '')
            carrier = secondary.get('carrier', '').upper()
            
            if member_id and not self._is_valid_insurance_id(member_id, carrier):
                issues.append(f"Invalid secondary insurance member ID format: {member_id}")
        
        return issues
    
    def validate_cpt_codes(self, data: Dict[str, Any]) -> List[str]:
        """Validate CPT codes for sleep studies"""
        issues = []
        
        procedures = data.get('procedures', [])
        referral = data.get('referral', {})
        
        # Extract CPT codes from procedures
        cpt_codes = []
        for proc in procedures:
            cpt = proc.get('cpt_code', '').strip()
            if cpt:
                cpt_codes.append(cpt)
        
        # Also check referral section
        ref_cpt = referral.get('cpt_code', '').strip()
        if ref_cpt:
            cpt_codes.append(ref_cpt)
        
        # Validate each CPT code
        for cpt in cpt_codes:
            if not self._is_valid_cpt_format(cpt):
                issues.append(f"Invalid CPT code format: {cpt}")
            elif cpt not in self.valid_cpt_codes:
                issues.append(f"Unrecognized sleep study CPT code: {cpt}")
        
        # Check if any CPT codes were found
        if not cpt_codes:
            issues.append("No CPT codes found - procedure type unclear")
        
        return issues
    
    def _is_valid_date(self, date_str: str) -> bool:
        """Check if date string is in valid format"""
        if not date_str:
            return False
        
        # Common date formats
        formats = ['%m/%d/%Y', '%m-%d-%Y', '%Y-%m-%d', '%m/%d/%y', '%m-%d-%y']
        
        for fmt in formats:
            try:
                datetime.strptime(date_str, fmt)
                return True
            except ValueError:
                continue
        
        return False
    
    def _parse_date(self, date_str: str) -> datetime:
        """Parse date string into datetime object"""
        formats = ['%m/%d/%Y', '%m-%d-%Y', '%Y-%m-%d', '%m/%d/%y', '%m-%d-%y']
        
        for fmt in formats:
            try:
                return datetime.strptime(date_str, fmt)
            except ValueError:
                continue
        
        raise ValueError(f"Could not parse date: {date_str}")
    
    def _is_valid_phone(self, phone: str) -> bool:
        """Check if phone number is in valid format"""
        if not phone:
            return True  # Empty is OK
        
        # Remove all non-digits
        digits_only = re.sub(r'[^\d]', '', phone)
        
        # Should be 10 digits for US phone numbers
        if len(digits_only) == 10:
            return True
        
        # Allow 11 digits if starts with 1
        if len(digits_only) == 11 and digits_only.startswith('1'):
            return True
        
        return False
    
    def _is_valid_insurance_id(self, member_id: str, carrier: str) -> bool:
        """Check if insurance member ID is in valid format"""
        if not member_id:
            return False
        
        # Remove whitespace
        member_id = member_id.strip()
        
        # Basic length check (most IDs are 6-20 characters)
        if len(member_id) < 3 or len(member_id) > 25:
            return False
        
        # Carrier-specific validation
        if 'MEDICARE' in carrier:
            # Medicare IDs are typically 11 characters
            return len(member_id) >= 9 and len(member_id) <= 12
        
        elif 'MEDICAID' in carrier:
            # Medicaid IDs vary by state but usually 8-15 digits
            return len(member_id) >= 6 and len(member_id) <= 20
        
        else:
            # General commercial insurance - usually alphanumeric
            return re.match(r'^[A-Za-z0-9\-]{3,20}$', member_id) is not None
    
    def _is_valid_cpt_format(self, cpt_code: str) -> bool:
        """Check if CPT code is in valid format"""
        if not cpt_code:
            return False
        
        # CPT codes should be 5 digits
        return re.match(r'^\d{5}$', cpt_code.strip()) is not None
    
    def generate_qc_report(self, qc_results: Dict[str, List[str]]) -> str:
        """Generate a formatted quality control report"""
        
        total_issues = len(qc_results.get('warnings', [])) + len(qc_results.get('errors', []))
        
        report = f"""
QUALITY CONTROL REPORT
Generated: {datetime.now().strftime('%m/%d/%Y %H:%M')}
Total Issues Found: {total_issues}

"""
        
        # Errors (critical issues)
        errors = qc_results.get('errors', [])
        if errors:
            report += "CRITICAL ERRORS (Must Fix Before Processing):\n"
            for i, error in enumerate(errors, 1):
                report += f"{i}. {error}\n"
            report += "\n"
        
        # Warnings (should review)
        warnings = qc_results.get('warnings', [])
        if warnings:
            report += "WARNINGS (Recommend Review):\n"
            for i, warning in enumerate(warnings, 1):
                report += f"{i}. {warning}\n"
            report += "\n"
        
        if not errors and not warnings:
            report += "✓ All quality control checks passed successfully\n"
        
        # Detailed breakdown
        report += "DETAILED BREAKDOWN:\n"
        check_categories = [
            'patient_name_consistency', 'date_validation', 'phone_formatting',
            'insurance_id_validation', 'cpt_code_validation'
        ]
        
        for category in check_categories:
            issues = qc_results.get(category, [])
            status = "✓ PASS" if not issues else f"⚠ {len(issues)} issue(s)"
            report += f"- {category.replace('_', ' ').title()}: {status}\n"
        
        return report


def main():
    """Test the quality control checker"""
    
    # Sample data with some issues
    sample_data = {
        'patient': {
            'first_name': 'John',
            'last_name': 'Doe',
            'dob': '13/45/1980',  # Invalid date
            'phone_home': '555-123-456'  # Invalid phone
        },
        'insurance': {
            'primary': {
                'carrier': 'AETNA',
                'member_id': 'A12',  # Too short
                'subscriber_first_name': 'Jon',  # Name mismatch
                'subscriber_last_name': 'Doe'
            }
        },
        'procedures': [
            {'cpt_code': '12345'},  # Invalid CPT
            {'cpt_code': '95810'}   # Valid CPT
        ],
        'referral': {
            'date': '03/15/2025'
        }
    }
    
    # Run quality control checks
    qc = QualityControlChecker()
    results = qc.run_all_checks(sample_data)
    
    # Generate report
    report = qc.generate_qc_report(results)
    
    print("Quality Control Test Results:")
    print("=" * 50)
    print(report)
    
    # Save detailed results
    with open('qc_test_results.json', 'w') as f:
        import json
        json.dump(results, f, indent=2)
    
    print(f"Detailed results saved to: qc_test_results.json")


if __name__ == "__main__":
    main()
