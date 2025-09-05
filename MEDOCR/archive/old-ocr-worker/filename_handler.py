#!/usr/bin/env python3
"""
File Naming Convention Handler for Medical Form Processing
Implements client-specified naming patterns: LastName_FirstName_DOB_ReferralDate.pdf
"""

import re
import os
from datetime import datetime
from typing import Dict, Any, Optional


class FileNamingHandler:
    """Handles file naming according to client specifications"""
    
    def __init__(self):
        # Characters to remove/replace in filenames
        self.invalid_chars = r'[<>:"/\\|?*\']'
        self.space_chars = r'[\s\-\.]+'
    
    def generate_patient_filename(self, patient_data: Dict[str, Any], referral_data: Dict[str, Any]) -> str:
        """
        Generate filename according to client specification: LastName_FirstName_DOB_ReferralDate.pdf
        
        Args:
            patient_data: Patient information dictionary
            referral_data: Referral information dictionary
            
        Returns:
            Formatted filename string
        """
        
        # Extract patient name
        last_name = self._clean_name_component(patient_data.get('last_name', 'Unknown'))
        first_name = self._clean_name_component(patient_data.get('first_name', 'Unknown'))
        
        # Extract and format DOB
        dob = self._format_date_component(patient_data.get('dob', ''))
        
        # Extract and format referral date
        referral_date = self._format_date_component(referral_data.get('date', ''))
        
        # Construct filename
        filename = f"{last_name}_{first_name}_{dob}_{referral_date}.pdf"
        
        # Final cleanup and validation
        filename = self._validate_filename(filename)
        
        return filename
    
    def generate_batch_filename(self, intake_date: str, batch_type: str = "summary") -> str:
        """
        Generate batch processing filename
        
        Args:
            intake_date: Date of intake processing
            batch_type: Type of batch file (summary, review, etc.)
            
        Returns:
            Formatted batch filename
        """
        
        date_component = self._format_date_component(intake_date)
        
        batch_types = {
            'summary': f"Batch_Summary_{date_component}.pdf",
            'review': f"Manual_Review_{date_component}.pdf",
            'cover': f"Batch_Cover_{date_component}.pdf",
            'log': f"Processing_Log_{date_component}.pdf"
        }
        
        return batch_types.get(batch_type, f"Batch_{batch_type}_{date_component}.pdf")
    
    def generate_form_filename(self, patient_data: Dict[str, Any], form_type: str) -> str:
        """
        Generate filename for specific forms (authorization, verification, etc.)
        
        Args:
            patient_data: Patient information dictionary
            form_type: Type of form being generated
            
        Returns:
            Formatted form filename
        """
        
        last_name = self._clean_name_component(patient_data.get('last_name', 'Unknown'))
        first_name = self._clean_name_component(patient_data.get('first_name', 'Unknown'))
        
        today = datetime.now().strftime('%m%d%Y')
        
        form_types = {
            'authorization': f"Auth_{last_name}_{first_name}_{today}.pdf",
            'insurance_verification': f"InsVerif_{last_name}_{first_name}_{today}.pdf",
            'uts_referral': f"UTS_{last_name}_{first_name}_{today}.pdf",
            'provider_followup': f"ProviderFU_{last_name}_{first_name}_{today}.pdf",
            'patient_contact': f"PatientContact_{last_name}_{first_name}_{today}.pdf"
        }
        
        return form_types.get(form_type, f"{form_type}_{last_name}_{first_name}_{today}.pdf")
    
    def _clean_name_component(self, name: str) -> str:
        """Clean name component for filename use"""
        if not name or name.lower() in ['unknown', 'n/a', '', 'null']:
            return 'Unknown'
        
        # Remove invalid characters
        cleaned = re.sub(self.invalid_chars, '', name)
        
        # Replace multiple spaces/dashes with single underscore
        cleaned = re.sub(self.space_chars, '_', cleaned)
        
        # Remove leading/trailing underscores
        cleaned = cleaned.strip('_')
        
        # Capitalize properly
        cleaned = cleaned.title()
        
        # Handle common name prefixes/suffixes
        cleaned = self._handle_name_prefixes(cleaned)
        
        return cleaned if cleaned else 'Unknown'
    
    def _handle_name_prefixes(self, name: str) -> str:
        """Handle common name prefixes and suffixes"""
        
        # Common prefixes
        prefixes = ['Dr', 'Mr', 'Mrs', 'Ms', 'Miss']
        for prefix in prefixes:
            if name.startswith(f"{prefix}_"):
                name = name[len(prefix)+1:]
        
        # Common suffixes
        suffixes = ['Jr', 'Sr', 'Ii', 'Iii', 'Iv']
        for suffix in suffixes:
            if name.endswith(f"_{suffix}"):
                name = name[:-len(suffix)-1] + suffix
        
        return name
    
    def _format_date_component(self, date_str: str) -> str:
        """Format date for filename component"""
        if not date_str:
            return datetime.now().strftime('%m%d%Y')
        
        # Try to parse various date formats
        date_formats = [
            '%m/%d/%Y', '%m-%d-%Y', '%Y-%m-%d',
            '%m/%d/%y', '%m-%d-%y', '%y-%m-%d'
        ]
        
        for fmt in date_formats:
            try:
                parsed_date = datetime.strptime(date_str, fmt)
                return parsed_date.strftime('%m%d%Y')
            except ValueError:
                continue
        
        # If parsing fails, try to extract digits
        digits = re.findall(r'\d+', date_str)
        if len(digits) >= 3:
            month, day, year = digits[0], digits[1], digits[2]
            
            # Handle 2-digit years
            if len(year) == 2:
                year = '20' + year if int(year) < 50 else '19' + year
            
            try:
                # Validate the date
                parsed_date = datetime(int(year), int(month), int(day))
                return parsed_date.strftime('%m%d%Y')
            except ValueError:
                pass
        
        # Fallback to current date
        return datetime.now().strftime('%m%d%Y')
    
    def _validate_filename(self, filename: str) -> str:
        """Validate and ensure filename is safe for filesystem"""
        
        # Maximum filename length (Windows limit is 260, but being conservative)
        max_length = 200
        
        if len(filename) > max_length:
            # Truncate while preserving extension
            name_part = filename[:-4]  # Remove .pdf
            extension = filename[-4:]  # Keep .pdf
            
            # Truncate the name part
            truncated_length = max_length - 4  # Account for extension
            name_part = name_part[:truncated_length]
            
            filename = name_part + extension
        
        # Ensure no double underscores
        filename = re.sub(r'__+', '_', filename)
        
        # Ensure it doesn't start or end with underscore
        filename = filename.strip('_')
        
        # Final safety check - remove any remaining invalid characters
        filename = re.sub(self.invalid_chars, '', filename)
        
        return filename
    
    def check_filename_conflicts(self, filename: str, directory: str) -> str:
        """Check for filename conflicts and add suffix if needed"""
        
        if not os.path.exists(directory):
            return filename
        
        base_name = filename[:-4]  # Remove .pdf
        extension = filename[-4:]  # Keep .pdf
        
        counter = 1
        new_filename = filename
        
        while os.path.exists(os.path.join(directory, new_filename)):
            new_filename = f"{base_name}_{counter:02d}{extension}"
            counter += 1
            
            # Prevent infinite loop
            if counter > 999:
                new_filename = f"{base_name}_{datetime.now().strftime('%H%M%S')}{extension}"
                break
        
        return new_filename
    
    def parse_existing_filename(self, filename: str) -> Dict[str, Optional[str]]:
        """Parse existing filename to extract components"""
        
        # Remove extension
        name_without_ext = filename.replace('.pdf', '')
        
        # Split by underscores
        parts = name_without_ext.split('_')
        
        result = {
            'last_name': None,
            'first_name': None,
            'dob': None,
            'referral_date': None,
            'is_valid_format': False
        }
        
        # Check if it matches our expected format
        if len(parts) >= 4:
            result['last_name'] = parts[0]
            result['first_name'] = parts[1]
            result['dob'] = parts[2]
            result['referral_date'] = parts[3]
            result['is_valid_format'] = True
        
        return result
    
    def generate_directory_structure(self, base_path: str, intake_date: str) -> Dict[str, str]:
        """Generate directory structure for organized file storage"""
        
        try:
            date_obj = datetime.strptime(intake_date, '%m/%d/%Y')
        except:
            date_obj = datetime.now()
        
        year_month = date_obj.strftime('%Y_%m')
        day = date_obj.strftime('%d')
        
        directories = {
            'base': base_path,
            'year_month': os.path.join(base_path, year_month),
            'daily': os.path.join(base_path, year_month, f"Day_{day}"),
            'individual_pdfs': os.path.join(base_path, year_month, f"Day_{day}", "Individual_PDFs"),
            'batch_files': os.path.join(base_path, year_month, f"Day_{day}", "Batch_Files"),
            'forms': os.path.join(base_path, year_month, f"Day_{day}", "Generated_Forms"),
            'manual_review': os.path.join(base_path, year_month, f"Day_{day}", "Manual_Review")
        }
        
        return directories


def main():
    """Test the file naming handler"""
    
    # Sample patient data
    sample_patient = {
        'first_name': 'John Michael',
        'last_name': "O'Connor-Smith",
        'dob': '03/15/1980'
    }
    
    sample_referral = {
        'date': '12/01/2024'
    }
    
    # Initialize handler
    handler = FileNamingHandler()
    
    # Test patient filename
    patient_filename = handler.generate_patient_filename(sample_patient, sample_referral)
    print(f"Patient filename: {patient_filename}")
    
    # Test batch filename
    batch_filename = handler.generate_batch_filename('12/01/2024', 'summary')
    print(f"Batch filename: {batch_filename}")
    
    # Test form filename
    form_filename = handler.generate_form_filename(sample_patient, 'authorization')
    print(f"Authorization form filename: {form_filename}")
    
    # Test directory structure
    directories = handler.generate_directory_structure('/Users/medocr/output', '12/01/2024')
    print("\\nDirectory structure:")
    for dir_type, path in directories.items():
        print(f"  {dir_type}: {path}")
    
    # Test filename parsing
    parsed = handler.parse_existing_filename(patient_filename)
    print(f"\\nParsed filename components: {parsed}")


if __name__ == "__main__":
    main()
