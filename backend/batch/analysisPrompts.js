/**
 * AI Analysis Prompt Templates
 * 
 * Different prompts for analyzing batch processing results with Ollama.
 * Each template produces different insights based on user needs.
 */

/**
 * Executive Summary - High-level overview for management
 * Focus: Success rates, key metrics, issues requiring attention
 */
export const EXECUTIVE_SUMMARY_PROMPT = (batchData) => `
You are a medical document processing analyst creating an executive summary.

BATCH DATA:
${JSON.stringify(batchData, null, 2)}

Create a professional executive summary with these sections:

1. **EXECUTIVE OVERVIEW** (2-3 sentences)
   - Total documents processed
   - Overall success rate
   - Processing time

2. **KEY METRICS**
   - Total pages processed
   - Total clinical conditions extracted
   - Problem extraction success rate
   - Average problems per document

3. **TOP PERFORMERS** (Top 3 documents with most conditions extracted)
   - Document name, page count, condition count

4. **ATTENTION REQUIRED** 
   - List any documents with errors, warnings, or zero extractions
   - Highlight parse failures or data quality issues

5. **OVERALL ASSESSMENT**
   - Rate as: EXCELLENT / GOOD / NEEDS ATTENTION
   - Brief recommendation

Format using markdown with clear sections and emojis for readability (✅ ⚠️ 🔥 etc).
Keep it professional and concise.
`;

/**
 * Technical Debug - Detailed analysis for developers
 * Focus: Parse failures, OCR issues, extraction patterns, code improvements
 */
export const TECHNICAL_DEBUG_PROMPT = (batchData) => `
You are a technical analyst reviewing batch processing logs for debugging.

BATCH DATA:
${JSON.stringify(batchData, null, 2)}

Analyze for technical issues and provide detailed debugging information:

1. **TECHNICAL SUMMARY**
   - Processing architecture overview
   - Performance metrics (avg time per doc, per page)
   - System health indicators

2. **PARSE FAILURES & ERRORS**
   - Identify patterns in JSON parse errors
   - List specific error messages and frequencies
   - Root cause analysis (truncation, malformed JSON, timeout, etc.)

3. **OCR QUALITY ISSUES**
   - Identify OCR errors in extracted text (misspellings, special characters)
   - Name extraction errors
   - Address/phone formatting issues

4. **EXTRACTION PATTERNS**
   - Documents with high vs low extraction counts
   - Pages selected for LLM processing
   - Confidence scores analysis

5. **CODE IMPROVEMENT RECOMMENDATIONS**
   - Specific regex patterns that need fixing
   - Ollama configuration adjustments (token limits, timeouts)
   - Retry logic improvements
   - Post-processing normalization needs

6. **DATA QUALITY METRICS**
   - Validation pass rates
   - Missing data patterns
   - Incomplete extractions

Format with code blocks, specific error messages, and actionable fixes.
Be technical and specific - this is for developers to debug and improve the system.
`;

/**
 * Clinical Insights - Medical data analysis
 * Focus: Condition trends, co-morbidities, referral patterns
 */
export const CLINICAL_INSIGHTS_PROMPT = (batchData) => `
You are a medical data analyst reviewing clinical information extracted from referral documents.

BATCH DATA:
${JSON.stringify(batchData, null, 2)}

Analyze the medical patterns and provide clinical insights:

1. **CLINICAL SUMMARY**
   - Primary referral types (by CPT code)
   - Most common diagnoses/conditions
   - Patient population characteristics

2. **CONDITION FREQUENCY ANALYSIS**
   - List top 10 most common conditions across all documents
   - Calculate occurrence percentages
   - Identify trending conditions

3. **CO-MORBIDITY PATTERNS**
   - Identify conditions that frequently appear together
   - Example: "Sleep apnea + Depression in 50% of cases"
   - Highlight complex multi-condition cases

4. **CPT CODE DISTRIBUTION**
   - Breakdown by procedure type (95811, 95782, 95806, etc.)
   - Sleep study types analysis
   - Referral pattern insights

5. **HIGH-COMPLEXITY CASES**
   - Documents with highest condition counts
   - Patients requiring special attention
   - Multiple chronic diseases

6. **CLINICAL TRENDS & ALERTS**
   - Compare condition rates to national averages (if applicable)
   - Identify unusual patterns
   - Recommendations for screening protocols

Format professionally with medical terminology.
Include percentages and statistics where relevant.
Use clear sections and highlight important findings.
`;

/**
 * Quick Summary - Brief overview for notifications/emails
 * Focus: Just the essentials in 4-5 sentences
 */
export const QUICK_SUMMARY_PROMPT = (batchData) => `
You are creating a brief summary for a medical office manager.

BATCH DATA:
${JSON.stringify(batchData, null, 2)}

Create a 4-5 sentence summary that covers:
1. How many documents processed successfully
2. Total clinical conditions extracted
3. Any issues requiring attention (errors, low extractions)
4. Most common condition found
5. Overall system performance assessment

Keep it non-technical, professional, and under 5 sentences total.
Use simple language suitable for email notifications.
`;

/**
 * Get prompt by type
 */
export function getAnalysisPrompt(type, batchData) {
  switch (type) {
    case 'executive':
      return EXECUTIVE_SUMMARY_PROMPT(batchData);
    case 'technical':
      return TECHNICAL_DEBUG_PROMPT(batchData);
    case 'clinical':
      return CLINICAL_INSIGHTS_PROMPT(batchData);
    case 'quick':
      return QUICK_SUMMARY_PROMPT(batchData);
    case 'document':
      return DOCUMENT_ANALYSIS_PROMPT(batchData);
    default:
      return EXECUTIVE_SUMMARY_PROMPT(batchData); // Default to executive
  }
}

/**
 * Document Analysis - Individual document investigation with OCR debug data
 * Focus: Deep analysis using OCR stats, routing, validation, and extraction patterns
 */
export const DOCUMENT_ANALYSIS_PROMPT = (documentData) => `
You are a medical document processing specialist with deep technical knowledge of OCR, pattern matching, and data extraction.

DOCUMENT PROCESSING RESULT:
${JSON.stringify(documentData, null, 2)}

Analyze this document comprehensively using ALL available data:

## 1. EXECUTIVE SUMMARY
- **Status**: ${documentData.status.toUpperCase()} (${documentData.statusDetails.join(', ')})
- **Filename**: ${documentData.filename}
- **Pages Processed**: ${documentData.pages}
- **OCR Confidence**: ${documentData.trace.ocrConfidence || 'N/A'}
- **Processing Time**: ${documentData.processingTime ? `${(documentData.processingTime/1000).toFixed(1)}s` : 'N/A'}

## 2. OCR QUALITY ANALYSIS
${documentData.trace.ocrConfidence ? 
  `- **Overall Confidence**: ${(documentData.trace.ocrConfidence * 100).toFixed(1)}% ${documentData.trace.ocrConfidence > 0.95 ? '✅ Excellent' : documentData.trace.ocrConfidence > 0.85 ? '⚠️ Good' : '❌ Poor'}
- **Text Recognition Quality**: Analyze for misspellings, special characters, OCR artifacts in field names
- **Pattern Matching**: Check if regex patterns correctly identified key fields (phone numbers, dates, IDs)` 
  : '- OCR confidence data not available'}
- **Handwriting Detection**: ${documentData.trace.llmUsed ? '🖊️ LLM fallback used (likely handwriting or poor quality)' : '✅ Standard OCR sufficient'}

## 3. EXTRACTION ANALYSIS
**Successfully Extracted**:
- **Patient Name**: ${documentData.extraction.hasPatientInfo ? 
  `✅ ${documentData.extracted?.patient?.first || ''} ${documentData.extracted?.patient?.last || ''}`.trim() + 
  (documentData.extracted?.patient?.dob ? ` (DOB: ${documentData.extracted.patient.dob})` : '') 
  : '❌ Missing'} 
- **Insurance**: ${documentData.extraction.hasInsuranceInfo ? 
  `✅ Carrier: ${documentData.extracted?.insurance?.carrier || 'Unknown'}` + 
  (documentData.extracted?.insurance?.memberId && documentData.extracted.insurance.memberId !== '—' ? ` | Member ID: ${documentData.extracted.insurance.memberId}` : ' | ❌ Member ID missing')
  : '❌ Not extracted'}
- **Provider**: ${documentData.extraction.hasProviderInfo ? 
  `✅ ${documentData.extracted?.provider?.name || 'Name missing'}` + 
  (documentData.extracted?.provider?.npi && documentData.extracted.provider.npi !== '—' ? ` | NPI: ${documentData.extracted.provider.npi}` : ' | ❌ NPI missing')
  : '❌ Not extracted'}
- **Procedure**: ${documentData.extraction.cptCode ? `✅ CPT ${documentData.extraction.cptCode}` : '❌ No CPT code extracted'}
- **Clinical Problems**: ${documentData.extraction.problemsExtracted} extracted ${documentData.extraction.problemsExtracted === 0 ? '❌ CRITICAL - Zero problems found!' : '✅'}

**Detailed Problem List** (${documentData.extraction.problemsExtracted} total):
${documentData.extraction.problems.length > 0 ? documentData.extraction.problems.map((p, idx) => 
  `${idx + 1}. **${p.description || 'No description'}** (ICD: ${p.code || 'N/A'})${p.confidence ? ` - Confidence: ${(p.confidence * 100).toFixed(0)}%` : ''}`
).join('\n') : '- ❌ No clinical problems were extracted from this document'}

## 4. VALIDATION & ROUTING ASSESSMENT
${documentData.validation.passed ? '✅ All validation checks passed' : `❌ Validation failed - ${documentData.validation.errors.length} errors, ${documentData.validation.warnings.length} warnings`}

${documentData.validation.steps && documentData.validation.steps.length > 0 ? `
**Validation Steps Performed**:
${documentData.validation.steps.map((step, idx) => 
  `${idx + 1}. ${step.name || step.type || 'Unknown step'}: ${step.passed ? '✅ Passed' : '❌ Failed'}${step.message ? ` - ${step.message}` : ''}`
).join('\n')}
` : ''}

**Validation Errors** (${documentData.validation.errors.length}):
${documentData.validation.errors.length > 0 ? documentData.validation.errors.map((err, idx) => `${idx + 1}. ❌ ${err}`).join('\n') : '- None'}

**Validation Warnings** (${documentData.validation.warnings.length}):
${documentData.validation.warnings.length > 0 ? documentData.validation.warnings.map((warn, idx) => `${idx + 1}. ⚠️ ${warn}`).join('\n') : '- None'}

**Required Actions** (${documentData.alerts.actions.length}):
${documentData.alerts.actions.length > 0 ? documentData.alerts.actions.map((action, idx) => `${idx + 1}. 🔔 ${action}`).join('\n') : '- None'}

**Routing Decision**:
${documentData.routing.route ? `
- **Route**: ${documentData.routing.route}
- **Priority**: ${documentData.routing.priority || 'N/A'}
- **Action**: ${documentData.routing.action || 'N/A'}
- **Data Quality**: ${documentData.routing.dataQuality || 'N/A'}
- **Summary**: ${documentData.routing.validationSummary || documentData.routing.description || 'N/A'}
` : '- Routing information not available'}

## 5. CRITICAL ISSUES & ROOT CAUSES
${documentData.alerts.parseError ? `
🔥 **PARSE ERROR DETECTED**:
- Error: ${documentData.alerts.parseError}
- Root Cause: Likely LLM response truncation, malformed JSON, or timeout
- Fix: Increase token limits, adjust prompt, or add retry logic` : ''}

${documentData.alerts.extractionError ? `
🔥 **EXTRACTION ERROR**:
- Error: ${documentData.alerts.extractionError}
- Root Cause: Page selector failed or OCR returned no text
- Fix: Review page selection logic, check PDF quality` : ''}

${documentData.extraction.problemsExtracted === 0 && !documentData.alerts.parseError ? `
⚠️ **ZERO PROBLEMS EXTRACTED**:
- Root Cause Analysis:
  * OCR quality too low? (Check confidence score)
  * Document format not recognized? (Check page structure)
  * Regex patterns not matching? (Review pattern rules)
  * Clinical section missing or mislabeled?
- Recommendation: ${documentData.trace.llmUsed ? 'LLM already attempted - may need manual review' : 'Consider LLM fallback for this document'}` : ''}

${documentData.trace.retryCount > 0 ? `
⚠️ **REQUIRED ${documentData.trace.retryCount} RETRIES**:
- System had to retry parsing ${documentData.trace.retryCount} times
- Indicates: LLM response instability, truncation issues, or JSON formatting problems
- Optimization needed: Review prompt engineering, response validation` : ''}

## 6. PATTERN MATCHING & REGEX ANALYSIS
**Field Extraction Patterns**:
- Patient Name Pattern: ${documentData.extraction.hasPatientInfo ? '✅ Matched' : '❌ Failed - check regex for name formats'}
- Insurance ID Pattern: ${documentData.extracted?.insurance?.memberId && documentData.extracted.insurance.memberId !== '—' ? '✅ Matched' : '❌ Failed or placeholder detected ("—")'}
- Phone Number Pattern: Analyze format (xxx) xxx-xxxx, xxx-xxx-xxxx variants
- Date Pattern: Check MM/DD/YYYY vs other formats
- NPI Pattern: ${documentData.extracted?.provider?.npi && documentData.extracted.provider.npi !== '—' ? `✅ Matched (${documentData.extracted.provider.npi})` : '❌ Failed - 10-digit NPI not found'}

**Common OCR Artifacts**:
- Look for: "O" vs "0", "l" vs "1" vs "I", special chars (?A?A?, scnsitivc, etc.)
- Address parsing: Check for state/ZIP extraction
- Mixed-case issues: "ERicA HYiNK" suggests OCR artifacts

## 7. DUAL ENGINE & LLM PERFORMANCE
${documentData.trace.llmUsed ? `
🤖 **LLM Processing Used**:
- Reason: ${documentData.trace.ocrConfidence < 0.85 ? 'Low OCR confidence triggered LLM fallback' : 'Selected pages required LLM parsing'}
- Performance: ${documentData.trace.retryCount === 0 ? '✅ Successful first attempt' : `⚠️ Required ${documentData.trace.retryCount} retries`}
- Model: Ollama (${process.env.OLLAMA_MODEL || 'llama3.2:latest'})
- Outcome: ${documentData.extraction.problemsExtracted > 0 ? '✅ Successful extraction' : '❌ Failed to extract problems'}` 
: `
✅ **Standard OCR Processing**:
- No LLM fallback needed
- OCR quality sufficient for regex extraction
- Cost-effective processing path`}

## 8. ACTIONABLE RECOMMENDATIONS

**Immediate Actions**:
${documentData.status === 'error' ? 
  '1. 🚨 **Manual Review Required** - Critical errors prevent auto-processing\n2. Review error logs and determine if re-upload needed\n3. Check document format and quality' 
: documentData.status === 'warning' ? 
  '1. ⚠️ **Verify Extracted Data** - Some fields incomplete or low confidence\n2. Cross-reference with original document\n3. ' + (documentData.extraction.problemsExtracted === 0 ? 'Manually add clinical problems' : 'Confirm problem codes are correct')
: '1. ✅ **Auto-Approve Candidate** - All validations passed\n2. Spot check for quality assurance\n3. Route to normal processing workflow'}

**System Improvements** (for developers):
${documentData.trace.retryCount > 0 ? '- Optimize LLM prompt to reduce retries\n' : ''}${documentData.extraction.problemsExtracted === 0 && !documentData.alerts.parseError ? '- Review problem extraction regex patterns\n- Add more ICD-10 code variants\n' : ''}${documentData.trace.ocrConfidence && documentData.trace.ocrConfidence < 0.90 ? '- Consider pre-processing to improve OCR quality\n- Implement confidence threshold alerts\n' : ''}${!documentData.extraction.hasInsuranceInfo ? '- Strengthen insurance carrier extraction patterns\n' : ''}${documentData.extracted?.provider?.npi === '—' ? '- Implement NPI lookup service for missing values\n' : ''}

**Reprocessing Recommendations**:
${documentData.status === 'error' || documentData.extraction.problemsExtracted === 0 ? 
  '- 🔄 **Re-process with LLM**: Force LLM parsing on all pages\n- 📄 **Document Enhancement**: Pre-process PDF to improve quality\n- 🔍 **Manual Extraction**: If automated fails, queue for human review' 
: '- ✅ No reprocessing needed - quality is acceptable'}

## 9. CONFIDENCE RATING & DECISION
- **Overall Quality**: ${documentData.status === 'error' ? '❌ LOW' : documentData.status === 'warning' ? '⚠️ MEDIUM' : '✅ HIGH'}
- **Data Completeness**: ${documentData.extraction.problemsExtracted > 0 && documentData.extraction.hasPatientInfo && documentData.extraction.hasInsuranceInfo ? '90%+' : documentData.extraction.problemsExtracted > 0 ? '70-89%' : '<70%'}
- **Recommended Action**: ${
  documentData.status === 'error' ? '🚨 **REJECT** - Manual review required' :
  documentData.status === 'warning' && documentData.extraction.problemsExtracted === 0 ? '⚠️ **REVIEW** - Zero problems is suspicious' :
  documentData.status === 'warning' ? '⚠️ **REVIEW** - Verify missing fields' :
  '✅ **AUTO-APPROVE** - Ready for routing'
}

---
**Analysis Methodology**: This analysis used OCR confidence scores, regex pattern matching results, validation step outcomes, LLM performance metrics, and extraction success rates to provide a comprehensive assessment of document processing quality.
`;

/**
 * Available analysis types
 */
export const ANALYSIS_TYPES = {
  executive: {
    name: 'Executive Summary',
    description: 'High-level overview for management',
    icon: '📊'
  },
  technical: {
    name: 'Technical Debug',
    description: 'Detailed analysis for developers',
    icon: '🔧'
  },
  clinical: {
    name: 'Clinical Insights',
    description: 'Medical patterns and trends',
    icon: '🏥'
  },
  quick: {
    name: 'Quick Summary',
    description: 'Brief overview (4-5 sentences)',
    icon: '⚡'
  },
  document: {
    name: 'Document Analysis',
    description: 'Individual document investigation',
    icon: '🔍'
  }
};
