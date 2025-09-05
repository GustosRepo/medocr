import re
import sys
import json

def extract_fields(text, analysis=None):
    fields = {}
    
    # Normalize text for better extraction - remove excessive line breaks
    normalized_text = re.sub(r'\n+', ' ', text)  # Replace multiple newlines with space
    normalized_text = re.sub(r'\s+', ' ', normalized_text)  # Normalize whitespace
    
    # Use analysis for enhanced field detection
    if analysis:
        # Add analysis-derived fields
        fields['cpt_code'] = analysis.get('cpt_code', 'UNKNOWN')
        fields['confidence_bucket'] = analysis.get('confidence_bucket', 'unknown')
        fields['detected_insurance'] = ', '.join(analysis.get('insurance', {}).get('accepted', []))
        fields['detected_dme'] = ', '.join([item.get('hcpcs', '') for item in analysis.get('dme', [])])
        fields['detected_symptoms'] = ', '.join(analysis.get('symptoms', {}).get('detected_symptoms', []))
    
    # Extract CPT code directly from text (works with simplified OCR)
    cpt_match = re.search(r'CPT:\s*([^-\n]+)(?:\s*-\s*([^\n]+))?', text, re.IGNORECASE)
    if cpt_match:
        cpt_code = cpt_match.group(1).strip()
        cpt_description = cpt_match.group(2).strip() if cpt_match.group(2) else ''
        fields['cpt_code'] = f"{cpt_code} - {cpt_description}" if cpt_description else cpt_code
    
    # Extract insurance from text (works with simplified OCR)
    insurance_match = re.search(r'Insurance:\s*([^\n]+)', text, re.IGNORECASE)
    if insurance_match:
        fields['insurance'] = insurance_match.group(1).strip()
    
    # Extract procedure/service information
    procedure_match = re.search(r'Procedure/Service:\s*([^\n]+)', text, re.IGNORECASE)
    if procedure_match:
        fields['procedure_service'] = procedure_match.group(1).strip()
    
    # Extract authorization status
    auth_match = re.search(r'Authorization:\s*([^\n]+)', text, re.IGNORECASE)
    if auth_match:
        fields['authorization'] = auth_match.group(1).strip()
    
    # Extract priority
    priority_match = re.search(r'Priority:\s*([^\n]+)', text, re.IGNORECASE)
    if priority_match:
        fields['priority'] = priority_match.group(1).strip()
    
    # Extract physician signature
    signature_match = re.search(r'Physician Signature:\s*([^\n]+)', text, re.IGNORECASE)
    if signature_match:
        fields['physician_signature'] = signature_match.group(1).strip()
    
    # Sleep Study Specific Fields
    # Epworth Sleepiness Scale
    epworth_match = re.search(r'Epworth(?:\s+Sleepiness)?(?:\s+Scale)?[:\s]*(\d+)', text, re.IGNORECASE)
    if epworth_match:
        fields['epworth_score'] = epworth_match.group(1).strip()
    
    # Sleep Study Type
    study_type_patterns = [
        r'(Home Sleep (?:Test|Study))',
        r'(In-lab (?:Sleep )?Study)',
        r'(Polysomnography)',
        r'(PSG)',
        r'(MSLT)',
        r'(Split Night)',
        r'(CPAP Titration)',
        r'(BiPAP Titration)'
    ]
    for pattern in study_type_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            fields['study_type'] = match.group(1)
            break
    
    # Sleep-related symptoms
    sleep_symptoms = []
    symptom_patterns = [
        r'(sleep apnea)', r'(snoring)', r'(gasping)', r'(witnessed apnea)',
        r'(daytime sleepiness)', r'(fatigue)', r'(insomnia)', r'(hypersomnia)',
        r'(restless leg)', r'(RLS)', r'(PLMD)', r'(narcolepsy)',
        r'(sleep onset)', r'(sleep maintenance)', r'(frequent awakening)',
        r'(morning headache)', r'(dry mouth)', r'(night sweats)',
        r'(difficulty concentrating)', r'(memory problems)', r'(irritability)'
    ]
    for pattern in symptom_patterns:
        if re.search(pattern, text, re.IGNORECASE):
            match = re.search(pattern, text, re.IGNORECASE)
            sleep_symptoms.append(match.group(1))
    
    if sleep_symptoms:
        fields['sleep_symptoms'] = ', '.join(sleep_symptoms)
    
    # BMI extraction
    bmi_match = re.search(r'BMI[:\s]*(\d+(?:\.\d+)?)', text, re.IGNORECASE)
    if bmi_match:
        fields['bmi'] = bmi_match.group(1).strip()
    
    # Neck circumference
    neck_match = re.search(r'neck circumference[:\s]*(\d+(?:\.\d+)?)', text, re.IGNORECASE)
    if neck_match:
        fields['neck_circumference'] = neck_match.group(1).strip()
    
    # Current CPAP/BiPAP usage
    cpap_match = re.search(r'(CPAP|BiPAP|APAP)(?:\s+(?:pressure|setting))?[:\s]*([^\n]+)', text, re.IGNORECASE)
    if cpap_match:
        fields['current_pap_therapy'] = f"{cpap_match.group(1)} {cpap_match.group(2)}".strip()
    
    # Sleep medications
    sleep_med_patterns = [
        r'(Ambien|Zolpidem)', r'(Lunesta|Eszopiclone)', r'(Sonata|Zaleplon)',
        r'(Trazodone)', r'(Melatonin)', r'(Benadryl|Diphenhydramine)',
        r'(Temazepam)', r'(Lorazepam)', r'(Clonazepam)'
    ]
    sleep_meds = []
    for pattern in sleep_med_patterns:
        if re.search(pattern, text, re.IGNORECASE):
            match = re.search(pattern, text, re.IGNORECASE)
            sleep_meds.append(match.group(1))
    
    if sleep_meds:
        fields['sleep_medications'] = ', '.join(sleep_meds)
    
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
    
    # Medical intake/referral fields - handle fragmented OCR text
    # Patient Name - try fragmented pattern first since OCR often splits names
    patient_name_match = re.search(r'Patient Name\s*[:]?\s*\n+\s*(\w+)\s*\n+\s*(\w+)', text, re.IGNORECASE)
    if patient_name_match:
        fields['patient_name'] = f"{patient_name_match.group(1)} {patient_name_match.group(2)}"
    else:
        # Try single line pattern
        patient_name_match = re.search(r'Patient Name\s*[:]?\s*([^\n]+)', text, re.IGNORECASE)
        if patient_name_match:
            fields['patient_name'] = patient_name_match.group(1).strip()
        else:
            # Try just first word after Patient Name
            patient_name_match = re.search(r'Patient Name\s*[:]?\s*\n+\s*(\w+)', text, re.IGNORECASE)
            if patient_name_match:
                fields['patient_name'] = patient_name_match.group(1)
            else:
                fields['patient_name'] = ''
    
    # DOB - handle fragmented dates like "DOB:\n\n07/06/1960"
    dob_match = re.search(r'DOB\s*[:]?\s*([^\n]+)', text, re.IGNORECASE)
    if not dob_match:
        dob_match = re.search(r'DOB\s*[:]?\s*\n+\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})', text, re.IGNORECASE)
    if not dob_match:
        dob_match = re.search(r'Date of Birth\s*[:]?\s*([^\n]+)', text, re.IGNORECASE)
    fields['dob'] = dob_match.group(1).strip() if dob_match else ''
    
    # MRN - handle "MRN: MRN873560"
    mrn_match = re.search(r'MRN\s*[:]?\s*([^\n]+)', text, re.IGNORECASE)
    if not mrn_match:
        mrn_match = re.search(r'MRN\s*[:]?\s*\n+\s*(MRN\d+)', text, re.IGNORECASE)
    fields['mrn'] = mrn_match.group(1).strip() if mrn_match else ''
    
    # Referring Physician - handle "Referring Physician: Dr. Davis"
    ref_phys_match = re.search(r'Referring Physician\s*[:]?\s*([^\n]+)', text, re.IGNORECASE)
    if not ref_phys_match:
        # Handle fragmented like "Referring Physician:\n\nDr.\n\nDavis"
        ref_phys_match = re.search(r'Referring Physician\s*[:]?\s*\n+\s*(Dr\.?\s*\w+)', text, re.IGNORECASE)
    if not ref_phys_match:
        ref_phys_match = re.search(r'Physician\s*[:]?\s*([^\n]+)', text, re.IGNORECASE)
    fields['referring_physician'] = ref_phys_match.group(1).strip() if ref_phys_match else ''
    # Referral Date (Date - single line only)
    ref_date_match = re.search(r'Date:\s*([^\n]+)', text, re.IGNORECASE)
    fields['referral_date'] = ref_date_match.group(1).strip() if ref_date_match else ''
    
    # Reason for Referral - handle both fragmented and clean OCR
    reason_match = re.search(r'Reason for Referral:\s*([^.]+\.)', text, re.IGNORECASE)
    if not reason_match:
        # Try multi-line pattern (stop at Clinical Notes or Medications)
        reason_match = re.search(r'Reason for Referral\s*[:]?\s*([\s\S]+?)(?=\n\s*(?:Clinical Notes|Medications)\s*[:]?)', text, re.IGNORECASE)
    if not reason_match:
        # Try pattern that stops at "Requesting evaluation"
        reason_match = re.search(r'Reason for Referral:\s*([^.]*(?:Requesting evaluation[^.]*\.)?)', text, re.IGNORECASE)
    fields['reason'] = reason_match.group(1).strip() if reason_match else ''
    
    # Clinical Notes - handle simplified OCR format
    clinical_match = re.search(r'Clinical Notes:\s*([^.]+(?:\.[^.]+)*\.)', text, re.IGNORECASE)
    if not clinical_match:
        # Try multi-line pattern (stop at Authorization or end)
        clinical_match = re.search(r'Clinical Notes\s*[:]?\s*([\s\S]+?)(?=\n\s*(?:Authorization|Priority|Physician)\s*[:]?)', text, re.IGNORECASE)
    fields['clinical_notes'] = clinical_match.group(1).strip() if clinical_match else ''
    
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
    # Include analysis section if we have analysis data
    analysis_section = ""
    if any(fields.get(key) for key in ['cpt_code', 'detected_insurance', 'detected_dme', 'detected_symptoms']):
        analysis_section = f'''
        <div class="analysis-section">
            <h3>Document Analysis</h3>
            <div class="field-row">
                <div class="field-group">
                    <label>CPT Code:</label>
                    <span class="field-value">{fields.get('cpt_code', 'N/A')}</span>
                </div>
                <div class="field-group">
                    <label>Confidence:</label>
                    <span class="field-value">{fields.get('confidence_bucket', 'N/A')}</span>
                </div>
            </div>
            {f'<div class="field-group"><label>Insurance:</label><span class="field-value">{fields.get("detected_insurance", "None detected")}</span></div>' if fields.get('detected_insurance') else ''}
            {f'<div class="field-group"><label>DME Items:</label><span class="field-value">{fields.get("detected_dme", "None detected")}</span></div>' if fields.get('detected_dme') else ''}
            {f'<div class="field-group"><label>Symptoms:</label><span class="field-value">{fields.get("detected_symptoms", "None detected")}</span></div>' if fields.get('detected_symptoms') else ''}
        </div>
        '''

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
        
        {analysis_section}
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
                    <label>Insurance:</label>
                    <span class="field-value">{fields.get('insurance', 'N/A')}</span>
                </div>
            </div>
            <div class="field-row">
                <div class="field-group">
                    <label>Referring Physician:</label>
                    <span class="field-value">{fields.get('referring_physician', 'N/A')}</span>
                </div>
            </div>
        </div>
        
        <div class="procedure-section">
            <h3>Procedure/Service Information</h3>
            <div class="field-group">
                <label>CPT Code:</label>
                <span class="field-value">{fields.get('cpt_code', 'N/A')}</span>
            </div>
            {f'<div class="field-group"><label>Procedure/Service:</label><span class="field-value">{fields.get("procedure_service", "N/A")}</span></div>' if fields.get('procedure_service') else ''}
            {f'<div class="field-group"><label>Study Type:</label><span class="field-value">{fields.get("study_type", "N/A")}</span></div>' if fields.get('study_type') else ''}
        </div>
        
        {f'<div class="sleep-assessment-section"><h3>Sleep Assessment</h3>' + 
         (f'<div class="field-group"><label>Epworth Sleepiness Scale:</label><span class="field-value">{fields.get("epworth_score")}</span></div>' if fields.get('epworth_score') else '') +
         (f'<div class="field-group"><label>BMI:</label><span class="field-value">{fields.get("bmi")}</span></div>' if fields.get('bmi') else '') +
         (f'<div class="field-group"><label>Neck Circumference:</label><span class="field-value">{fields.get("neck_circumference")} cm</span></div>' if fields.get('neck_circumference') else '') +
         (f'<div class="field-group"><label>Current PAP Therapy:</label><span class="field-value">{fields.get("current_pap_therapy")}</span></div>' if fields.get('current_pap_therapy') else '') +
         (f'<div class="field-group"><label>Sleep Symptoms:</label><span class="field-value">{fields.get("sleep_symptoms")}</span></div>' if fields.get('sleep_symptoms') else '') +
         (f'<div class="field-group"><label>Sleep Medications:</label><span class="field-value">{fields.get("sleep_medications")}</span></div>' if fields.get('sleep_medications') else '') +
         '</div>' if any(fields.get(key) for key in ['epworth_score', 'bmi', 'neck_circumference', 'current_pap_therapy', 'sleep_symptoms', 'sleep_medications']) else ''}
        
        {f'<div class="reason-section"><h3>Reason for Referral</h3><div class="reason-content">{format_multiline(fields.get("reason", ""))}</div></div>' if fields.get('reason') else ''}
        
        {f'<div class="clinical-section"><h3>Clinical Notes</h3><div class="clinical-content">{format_multiline(fields.get("clinical_notes", ""))}</div></div>' if fields.get('clinical_notes') else ''}
        
        {f'<div class="medications-section"><h3>Current Medications</h3><div class="medications-content">{format_multiline(fields.get("medications", ""))}</div></div>' if fields.get('medications') else ''}
        
        {f'<div class="history-section"><h3>Past Medical History</h3><div class="history-content">{format_multiline(fields.get("history", ""))}</div></div>' if fields.get('history') else ''}
        
        {f'<div class="plan-section"><h3>Plan</h3><div class="plan-content">{format_multiline(fields.get("plan", ""))}</div></div>' if fields.get('plan') else ''}
        
        <div class="authorization-section">
            <h3>Authorization & Status</h3>
            <div class="field-row">
                <div class="field-group">
                    <label>Authorization:</label>
                    <span class="field-value">{fields.get('authorization', 'N/A')}</span>
                </div>
                <div class="field-group">
                    <label>Priority:</label>
                    <span class="field-value">{fields.get('priority', 'N/A')}</span>
                </div>
            </div>
            <div class="field-group">
                <label>Physician Signature:</label>
                <span class="field-value">{fields.get('physician_signature', 'N/A')}</span>
            </div>
        </div>
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
        print('Usage: python fill_template.py <ocr_text_file> <output_file> [analysis_json_file]')
        sys.exit(1)
    ocr_text_file = sys.argv[1]
    output_file = sys.argv[2]
    analysis_json_file = sys.argv[3] if len(sys.argv) > 3 else None
    
    template_path = 'template.txt'
    with open(ocr_text_file) as f:
        text = f.read()
    
    # Load analysis if provided
    analysis = None
    if analysis_json_file:
        try:
            with open(analysis_json_file) as f:
                analysis = json.load(f)
        except:
            analysis = None
    
    fields = extract_fields(text, analysis)
    fill_template(template_path, fields, output_file)
