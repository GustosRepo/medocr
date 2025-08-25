import re
import sys

def extract_fields(text):
    fields = {}
    
    # Lab Report fields
    # Patient (for lab reports - single line only)
    patient_match = re.search(r'Patient\s*[:]?\s*([^\n]+)', text, re.IGNORECASE)
    fields['patient'] = patient_match.group(1).strip() if patient_match else ''
    # Accession #
    accession_match = re.search(r'Accession #\s*[:]?\s*([^\n]+)', text, re.IGNORECASE)
    fields['accession'] = accession_match.group(1).strip() if accession_match else ''
    # Test
    test_match = re.search(r'Test\s*[:]?\s*([^\n]+)', text, re.IGNORECASE)
    fields['test'] = test_match.group(1).strip() if test_match else ''
    # Collection Date
    coll_date_match = re.search(r'Collection Date\s*[:]?\s*([\d]{1,2}[/-][\d]{1,2}[/-][\d]{2,4})', text, re.IGNORECASE)
    fields['collection_date'] = coll_date_match.group(1).strip() if coll_date_match else ''
    # Results (multi-line)
    results_match = re.search(r'Results\s*[:]?\s*([\s\S]+?)(?=\n\s*Interpretation\s*[:]?)', text, re.IGNORECASE)
    fields['results'] = results_match.group(1).strip() if results_match else ''
    # Interpretation (multi-line)
    interp_match = re.search(r'Interpretation\s*[:]?\s*([\s\S]+?)(?=\n\s*Signed,|$)', text, re.IGNORECASE)
    fields['interpretation'] = interp_match.group(1).strip() if interp_match else ''
    
    # Medical intake/referral fields
    # Patient Name (for intake forms - single line only)
    patient_name_match = re.search(r'Patient Name\s*[:]?\s*([^\n]+)', text, re.IGNORECASE)
    fields['patient_name'] = patient_name_match.group(1).strip() if patient_name_match else ''
    # DOB (single line only)
    dob_match = re.search(r'DOB\s*[:]?\s*([^\n]+)', text, re.IGNORECASE)
    fields['dob'] = dob_match.group(1).strip() if dob_match else ''
    # MRN (single line only)
    mrn_match = re.search(r'MRN\s*[:]?\s*([^\n]+)', text, re.IGNORECASE)
    fields['mrn'] = mrn_match.group(1).strip() if mrn_match else ''
    # Referring Physician (single line only)
    ref_phys_match = re.search(r'Referring Physician\s*[:]?\s*([^\n]+)', text, re.IGNORECASE)
    fields['referring_physician'] = ref_phys_match.group(1).strip() if ref_phys_match else ''
    # Referral Date (Date - single line only)
    ref_date_match = re.search(r'Date\s*[:]?\s*([^\n]+)', text, re.IGNORECASE)
    fields['referral_date'] = ref_date_match.group(1).strip() if ref_date_match else ''
    # Reason for Referral (multi-line, stop at Medications)
    reason_match = re.search(r'Reason for Referral\s*[:]?\s*([\s\S]+?)(?=\n\s*Medications\s*[:]?)', text, re.IGNORECASE)
    fields['reason'] = reason_match.group(1).strip() if reason_match else ''
    # Medications (multi-line, stop at Past Medical History)
    meds_match = re.search(r'Medications\s*[:]?\s*([\s\S]+?)(?=\n\s*Past Medical History\s*[:]?)', text, re.IGNORECASE)
    fields['medications'] = meds_match.group(1).strip() if meds_match else ''
    # History (multi-line, stop at Plan)
    history_match = re.search(r'Past Medical History\s*[:]?\s*([\s\S]+?)(?=\n\s*Plan\s*[:]?)', text, re.IGNORECASE)
    fields['history'] = history_match.group(1).strip() if history_match else ''
    # Plan (multi-line, to end of text)
    plan_match = re.search(r'Plan\s*[:]?\s*([\s\S]+?)(?:\n\s*$|$)', text, re.IGNORECASE)
    fields['plan'] = plan_match.group(1).strip() if plan_match else ''
    
    return fields

def fill_template(template_path, fields, output_path):
    # Generate HTML template with styling
    html_content = generate_html_template(fields)
    with open(output_path, 'w') as f:
        f.write(html_content)

def generate_html_template(fields):
    # Detect document type based on available fields
    is_lab_report = fields.get('test') or fields.get('accession') or fields.get('results')
    is_referral = fields.get('referring_physician') or fields.get('reason')
    
    if is_lab_report:
        return generate_lab_report_html(fields)
    elif is_referral:
        return generate_referral_html(fields)
    else:
        return generate_generic_html(fields)

def generate_lab_report_html(fields):
    return f'''
    <div class="document-template lab-report">
        <div class="document-header">
            <h2>Laboratory Report</h2>
            <div class="header-info">
                <span class="accession">Accession: {fields.get('accession', 'N/A')}</span>
                <span class="date">Collection Date: {fields.get('collection_date', 'N/A')}</span>
            </div>
        </div>
        
        <div class="patient-section">
            <h3>Patient Information</h3>
            <div class="field-row">
                <div class="field-group">
                    <label>Patient:</label>
                    <span class="field-value">{fields.get('patient', 'N/A')}</span>
                </div>
                <div class="field-group">
                    <label>DOB:</label>
                    <span class="field-value">{fields.get('dob', 'N/A')}</span>
                </div>
            </div>
        </div>
        
        <div class="test-section">
            <h3>Test Information</h3>
            <div class="field-group">
                <label>Test:</label>
                <span class="field-value">{fields.get('test', 'N/A')}</span>
            </div>
        </div>
        
        {f'<div class="results-section"><h3>Results</h3><div class="results-content">{format_multiline(fields.get("results", ""))}</div></div>' if fields.get('results') else ''}
        
        {f'<div class="interpretation-section"><h3>Interpretation</h3><div class="interpretation-content">{format_multiline(fields.get("interpretation", ""))}</div></div>' if fields.get('interpretation') else ''}
    </div>
    '''

def generate_referral_html(fields):
    return f'''
    <div class="document-template referral-form">
        <div class="document-header">
            <h2>Patient Referral Form</h2>
            <div class="header-info">
                <span class="date">Date: {fields.get('referral_date', 'N/A')}</span>
            </div>
        </div>
        
        <div class="patient-section">
            <h3>Patient Information</h3>
            <div class="field-row">
                <div class="field-group">
                    <label>Patient Name:</label>
                    <span class="field-value">{fields.get('patient_name', 'N/A')}</span>
                </div>
                <div class="field-group">
                    <label>DOB:</label>
                    <span class="field-value">{fields.get('dob', 'N/A')}</span>
                </div>
            </div>
            <div class="field-row">
                <div class="field-group">
                    <label>MRN:</label>
                    <span class="field-value">{fields.get('mrn', 'N/A')}</span>
                </div>
                <div class="field-group">
                    <label>Referring Physician:</label>
                    <span class="field-value">{fields.get('referring_physician', 'N/A')}</span>
                </div>
            </div>
        </div>
        
        {f'<div class="reason-section"><h3>Reason for Referral</h3><div class="reason-content">{format_multiline(fields.get("reason", ""))}</div></div>' if fields.get('reason') else ''}
        
        {f'<div class="medications-section"><h3>Current Medications</h3><div class="medications-content">{format_multiline(fields.get("medications", ""))}</div></div>' if fields.get('medications') else ''}
        
        {f'<div class="history-section"><h3>Past Medical History</h3><div class="history-content">{format_multiline(fields.get("history", ""))}</div></div>' if fields.get('history') else ''}
        
        {f'<div class="plan-section"><h3>Plan</h3><div class="plan-content">{format_multiline(fields.get("plan", ""))}</div></div>' if fields.get('plan') else ''}
    </div>
    '''

def generate_generic_html(fields):
    sections = []
    for key, value in fields.items():
        if value:
            label = key.replace('_', ' ').title()
            sections.append(f'''
                <div class="field-group">
                    <label>{label}:</label>
                    <span class="field-value">{format_multiline(value)}</span>
                </div>
            ''')
    
    return f'''
    <div class="document-template generic-form">
        <div class="document-header">
            <h2>Medical Document</h2>
        </div>
        <div class="content-section">
            {"".join(sections)}
        </div>
    </div>
    '''

def format_multiline(text):
    """Convert newlines to HTML line breaks and format content"""
    if not text:
        return "N/A"
    return text.replace('\n', '<br>')

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print('Usage: python fill_template.py <ocr_text_file> <output_file>')
        sys.exit(1)
    ocr_text_file = sys.argv[1]
    output_file = sys.argv[2]
    template_path = 'template.txt'
    with open(ocr_text_file) as f:
        text = f.read()
    fields = extract_fields(text)
    fill_template(template_path, fields, output_file)
