/**
 * Ollama LLM Service Integration
 * 
 * Uses local Ollama instance for vision-language model inference.
 * Much simpler than running a separate Python service!
 * 
 * Supported vision models:
 * - llava:13b (best for medical documents)
 * - llava:7b (faster, good quality)
 * - bakllava (optimized for documents)
 * - llava-phi3 (efficient, good for extraction)
 */

import fetch from 'node-fetch';
import FormData from 'form-data';
import fs from 'fs';
import { log } from './logging/logger.js';
import { ollamaMonitor } from './ollamaMonitor.js';

// Ollama configuration
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llava:13b';
const OLLAMA_TIMEOUT = parseInt(process.env.OLLAMA_TIMEOUT || '60000', 10);

// Default medical extraction prompt (used in legacy extraction mode)
// Note: Validation mode avoids PHI extraction; this prompt is only used
// when explicitly running full extraction via extractWithOllama without a custom prompt.
const MEDICAL_EXTRACTION_PROMPT = `You are extracting structured data from a medical referral form image.
Return ONLY strict JSON. Use null when a field is not clearly visible.

Fields:
{
  "patient": {
    "name": "Last, First Middle" | null,
    "dob": "MM/DD/YYYY" | null,
    "phone": "(XXX) XXX-XXXX" | null
  },
  "insurance": {
    "carrier": string | null,
    "memberId": string | null,
    "groupId": string | null
  },
  "provider": {
    "name": string | null,
    "npi": string | null,
    "phone": "(XXX) XXX-XXXX" | null,
    "fax": "(XXX) XXX-XXXX" | null
  },
  "clinical": {
    "diagnosis": string | null,
    "icd10": string | null,
    "procedure": string | null,
    "cpt": string | null
  },
  "confidence": 0.0-1.0
}

Rules:
- Output JSON only, no markdown.
- Preserve exact spelling seen in the document.
- If illegible or ambiguous, use null.
`;

/**
 * Medical extraction prompt template
 */
/**
 * Generate dynamic validation prompt based on OCR extracted data
 * @param {Object} ocrData - OCR extraction results
 * @returns {string} Generated validation prompt
 */
function generateValidationPrompt(ocrData) {
  const fields = [];
  
  // Only extract from the 'extracted' section (patient, insurance, provider, etc.)
  const relevantData = ocrData.extracted || ocrData;
  
  // Dynamically extract fields from structured data only
  const extractFields = (obj, prefix = '', depth = 0) => {
    // Prevent infinite recursion
    if (depth > 3) return;
    
    for (const [key, value] of Object.entries(obj || {})) {
      // Skip non-relevant sections
      if (['rawOCR', 'rawTextCombined', 'ruleTrace', 'highlightSpans', 'ocr', 'documentMeta'].includes(key)) {
        continue;
      }
      
      if (value === null || value === undefined || value === '') continue;
      
      if (typeof value === 'object' && !Array.isArray(value)) {
        // Nested object - recurse with depth limit
        extractFields(value, prefix ? `${prefix}.${key}` : key, depth + 1);
      } else if (typeof value === 'string' || typeof value === 'number') {
        // Leaf value - add to fields list
        const fieldPath = prefix ? `${prefix}.${key}` : key;
        const fieldLabel = fieldPath.replace(/\./g, ' ').replace(/([A-Z])/g, ' $1').trim();
        const valueStr = String(value).substring(0, 100); // Limit value length
        fields.push({ path: fieldPath, label: fieldLabel, value: valueStr });
      }
    }
  };
  
  extractFields(relevantData);
  
  // Build field list for prompt
  const fieldsList = fields.map(f => `  ${f.label}: "${f.value}"`).join('\n');
  
  if (fields.length === 0) {
    return `You are validating a medical document image. No OCR data was extracted. 
Analyze the document and return:
{
  "documentQuality": "readable|poor|unreadable",
  "hasText": true/false,
  "notes": "Brief description of what you see"
}`;
  }
  
  return `You are validating OCR extraction accuracy for a medical referral document.

OCR EXTRACTED THESE ${fields.length} FIELDS:
${fieldsList}

YOUR TASK - For each field above, validate by describing what you visually observe:
1. Is text present in that field location? (yes/no)
2. Visual quality of that text area (clear/blurry/smudged/damaged)
3. Character/word count without reading actual content
4. Any visual anomalies (mixed numbers/letters, unusual spacing, etc.)

CRITICAL RULES:
- DO NOT extract new PHI (names, dates, IDs)
- DO NOT read or repeat sensitive data
- ONLY describe visual characteristics
- Use terms like "text visible", "appears clear", "2 words present"

Return JSON (create one entry per field above):
{
  "fieldValidations": {
    "patient name": {
      "extracted": "value OCR found",
      "hasText": true/false,
      "visualQuality": "clear|blurry|damaged|unreadable",
      "characterCount": number,
      "wordCount": number,
      "appearsCorrect": true/false,
      "confidence": "high|medium|low",
      "concerns": "visual issues or null"
    }
  },
  "overallAccuracy": 0.0-1.0,
  "issuesFound": ["list concerns"],
  "notes": "brief assessment"
}`;
}

/**
 * Check if Ollama service is available
 * @returns {Promise<boolean>}
 */
export async function checkOllamaHealth() {
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/tags`, {
      method: 'GET',
      timeout: 5000
    });
    
    if (!response.ok) {
      log('warn', 'ollama_health_check_failed', { status: response.status });
      return false;
    }
    
    const data = await response.json();
    const models = data.models || [];
    const hasVisionModel = models.some(m => 
      m.name.includes('llava') || 
      m.name.includes('bakllava') ||
      m.name.includes('vision')
    );
    
    if (!hasVisionModel) {
      log('warn', 'ollama_no_vision_model', { 
        availableModels: models.map(m => m.name) 
      });
    }
    
    return true;
  } catch (error) {
    log('error', 'ollama_health_check_error', { error: String(error) });
    return false;
  }
}

/**
 * Extract structured data from image using Ollama vision model
 * @param {string} imagePath - Path to image file
 * @param {string} customPrompt - Optional custom prompt
 * @returns {Promise<Object>} Extracted data
 */
export async function extractWithOllama(imagePath, customPrompt = null) {
  const startTime = Date.now();
  
  try {
    // Read image and convert to base64
    const imageBuffer = await fs.promises.readFile(imagePath);
    const base64Image = imageBuffer.toString('base64');
    
    const prompt = customPrompt || MEDICAL_EXTRACTION_PROMPT;
    
    log('debug', 'ollama_extract_start', { 
      imagePath, 
      model: OLLAMA_MODEL,
      imageSize: imageBuffer.length 
    });
    
    // Call Ollama API
    const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: prompt,
        images: [base64Image],
        stream: false,
        options: {
          temperature: 0.0,  // Deterministic for data extraction
          num_predict: 2048
        }
      }),
      timeout: OLLAMA_TIMEOUT
    });
    
    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }
    
    const result = await response.json();
    const duration = Date.now() - startTime;
    
    log('debug', 'ollama_extract_complete', { 
      duration,
      model: OLLAMA_MODEL 
    });
    
    // Parse JSON from response
    const extracted = parseJsonResponse(result.response);
    
    // Record successful request
    ollamaMonitor.recordRequest(true, duration);
    
    return {
      extracted,
      rawResponse: result.response,
      model: OLLAMA_MODEL,
      timing: duration,
      success: true
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    
    log('error', 'ollama_extract_failed', { 
      imagePath, 
      error: String(error) 
    });
    
    // Record failed request
    ollamaMonitor.recordRequest(false, duration, error);
    
    throw error;
  }
}

/**
 * Validate OCR results against Ollama extraction
 * @param {string} imagePath - Path to image file
 * @param {Object} ocrData - OCR extraction result
 * @returns {Promise<Object>} Validation result with conflicts
 */
export async function validateWithOllama(imagePath, ocrData) {
  try {
    // Extract with Ollama
    const ollamaResult = await extractWithOllama(imagePath);
    
    // Compare OCR vs Ollama
    const conflicts = compareExtractions(ocrData, ollamaResult.extracted);
    
    return {
      ocrData,
      ollamaData: ollamaResult.extracted,
      conflicts,
      agreementScore: calculateAgreementScore(conflicts),
      model: OLLAMA_MODEL,
      timing: ollamaResult.timing
    };
    
  } catch (error) {
    log('error', 'ollama_validate_failed', { 
      imagePath, 
      error: String(error) 
    });
    
    throw error;
  }
}

/**
 * Parse JSON from Ollama response (handles markdown code blocks and malformed JSON)
 */
function parseJsonResponse(text) {
  // Log raw response for debugging
  if (process.env.LOG_LEVEL === 'debug') {
    log('debug', 'ollama_raw_response', { 
      length: text.length, 
      preview: text.substring(0, 200) 
    });
  }
  
  try {
    // Try direct parse first
    return JSON.parse(text);
  } catch (firstError) {
    // Look for JSON in markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch (e) {
        log('warn', 'ollama_json_parse_markdown_failed', { error: String(e) });
      }
    }
    
    // Try to find JSON object in text (greedy match)
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      let jsonStr = objectMatch[0];
      
      // Clean up common issues:
      // 1. Remove trailing commas before }
      jsonStr = jsonStr.replace(/,(\s*[}\]])/g, '$1');
      
      // 2. Fix unquoted keys (heuristic)
      jsonStr = jsonStr.replace(/(\w+):/g, '"$1":');
      
      // 3. Remove comments (// or /* */)
      jsonStr = jsonStr.replace(/\/\/.*$/gm, '');
      jsonStr = jsonStr.replace(/\/\*[\s\S]*?\*\//g, '');
      
      try {
        return JSON.parse(jsonStr);
      } catch (e) {
        log('error', 'ollama_json_parse_failed_after_cleanup', { 
          error: String(e),
          cleanedJson: jsonStr.substring(0, 500)
        });
      }
    }
    
    // If all else fails, log the raw response and throw
    log('error', 'ollama_no_valid_json', { 
      rawResponse: text.substring(0, 1000),
      originalError: String(firstError)
    });
    
    throw new Error('No valid JSON found in response');
  }
}

/**
 * Compare two extraction results
 */
function compareExtractions(ocr, ollama) {
  const conflicts = [];
  
  const compareField = (path, ocrVal, ollamaVal) => {
    const ocrStr = String(ocrVal || '').trim();
    const ollamaStr = String(ollamaVal || '').trim();
    
    if (!ocrStr && !ollamaStr) return; // Both empty
    if (ocrStr === ollamaStr) return; // Exact match
    
    conflicts.push({
      field: path,
      ocrValue: ocrVal,
      ollamaValue: ollamaVal
    });
  };
  
  // Compare patient fields
  if (ocr.patient && ollama.patient) {
    compareField('patient.name', ocr.patient.name, ollama.patient.name);
    compareField('patient.dob', ocr.patient.dob, ollama.patient.dob);
    compareField('patient.phone', ocr.patient.phone, ollama.patient.phone);
  }
  
  // Compare insurance fields
  if (ocr.insurance && ollama.insurance) {
    compareField('insurance.carrier', ocr.insurance.carrier, ollama.insurance.carrier);
    compareField('insurance.memberId', ocr.insurance.memberId, ollama.insurance.memberId);
  }
  
  // Compare provider fields
  if (ocr.provider && ollama.provider) {
    compareField('provider.name', ocr.provider.name, ollama.provider.name);
    compareField('provider.npi', ocr.provider.npi, ollama.provider.npi);
  }
  
  // Compare clinical fields
  if (ocr.clinical && ollama.clinical) {
    compareField('clinical.diagnosis', ocr.clinical.diagnosis, ollama.clinical.diagnosis);
    compareField('clinical.procedure', ocr.clinical.procedure, ollama.clinical.procedure);
  }
  
  return conflicts;
}

/**
 * Calculate agreement score based on conflicts
 */
function calculateAgreementScore(conflicts) {
  if (conflicts.length === 0) return 100;
  
  // Assume ~20 total fields being compared
  const totalFields = 20;
  const matchedFields = totalFields - conflicts.length;
  return Math.round((matchedFields / totalFields) * 100);
}

/**
 * Extract structured data from multiple page images with error recovery
 * Processes pages sequentially to avoid memory issues and crashes
 * @param {string[]} imagePaths - Array of image file paths
 * @param {string} customPrompt - Optional custom prompt
 * @returns {Promise<Object>} Aggregated extraction results
 */
export async function extractMultiplePages(imagePaths, customPrompt = null) {
  const overallStartTime = Date.now();
  const results = [];
  const errors = [];
  let successCount = 0;
  let failCount = 0;

  log('info', 'multi_page_extraction_start', {
    pageCount: imagePaths.length,
    model: OLLAMA_MODEL
  });

  // Process pages sequentially to avoid overwhelming Ollama
  for (let i = 0; i < imagePaths.length; i++) {
    const imagePath = imagePaths[i];
    const pageNum = i + 1;

    try {
      log('debug', 'processing_page', { pageNum, total: imagePaths.length, imagePath });

      // Extract from this page
      const pageResult = await extractWithOllama(imagePath, customPrompt);
      
      results.push({
        pageIndex: i,
        success: true,
        data: pageResult,
        error: null
      });
      
      successCount++;
      
      log('info', 'page_extraction_success', { 
        pageNum, 
        confidence: pageResult.extracted?.confidence || pageResult.confidence 
      });

    } catch (error) {
      // Log error but continue with next page
      log('error', 'page_extraction_failed', { 
        pageNum, 
        imagePath,
        error: error.message 
      });
      
      results.push({
        pageIndex: i,
        success: false,
        data: null,
        error: error.message
      });
      
      errors.push({ pageNum, error: error.message });
      failCount++;
      
      // Continue to next page instead of failing completely
    }
  }

  const overallDuration = Date.now() - overallStartTime;

  // If all pages failed, throw error
  if (successCount === 0) {
    const errorMsg = `All ${imagePaths.length} pages failed to process`;
    log('error', 'multi_page_extraction_failed', { 
      pageCount: imagePaths.length,
      errors: errors.map(e => e.error)
    });
    throw new Error(errorMsg);
  }

  // Merge successful results
  const successfulResults = results.filter(r => r.success).map(r => r.data);
  const mergedExtraction = mergeMultipleExtractions(successfulResults);

  log('info', 'multi_page_extraction_complete', {
    totalPages: imagePaths.length,
    successCount,
    failCount,
    duration: `${overallDuration}ms`,
    mergedConfidence: mergedExtraction.confidence
  });

  return {
    extracted: mergedExtraction,
    metadata: {
      totalPages: imagePaths.length,
      successfulPages: successCount,
      failedPages: failCount,
      pageResults: results,
      errors: errors.length > 0 ? errors : undefined,
      duration: overallDuration
    }
  };
}

/**
 * Merge extraction results from multiple pages
 * Prioritizes non-null values and higher confidence scores
 * @param {Array<Object>} extractions - Array of extraction results
 * @returns {Object} Merged extraction result
 */
function mergeMultipleExtractions(extractions) {
  if (extractions.length === 0) {
    return { confidence: 0, notes: 'No successful extractions' };
  }

  if (extractions.length === 1) {
    return extractions[0].extracted || extractions[0];
  }

  // Initialize merged result
  const merged = {
    patient: {},
    insurance: {},
    provider: {},
    clinical: {},
    confidence: 0,
    notes: ''
  };

  const allNotes = [];

  // Merge each extraction
  for (const extraction of extractions) {
    const data = extraction.extracted || extraction;
    
    // Merge patient data
    if (data.patient) {
      for (const [key, value] of Object.entries(data.patient)) {
        if (value && !merged.patient[key]) {
          merged.patient[key] = value;
        }
      }
    }

    // Merge insurance data
    if (data.insurance) {
      for (const [key, value] of Object.entries(data.insurance)) {
        if (value && !merged.insurance[key]) {
          merged.insurance[key] = value;
        }
      }
    }

    // Merge provider data
    if (data.provider) {
      for (const [key, value] of Object.entries(data.provider)) {
        if (value && !merged.provider[key]) {
          merged.provider[key] = value;
        }
      }
    }

    // Merge clinical data
    if (data.clinical) {
      for (const [key, value] of Object.entries(data.clinical)) {
        if (value && !merged.clinical[key]) {
          merged.clinical[key] = value;
        }
      }
    }

    // Collect notes
    if (data.notes) {
      allNotes.push(data.notes);
    }
  }

  // Calculate average confidence
  const confidences = extractions
    .map(e => (e.extracted || e).confidence)
    .filter(c => typeof c === 'number' && c > 0);
  
  merged.confidence = confidences.length > 0
    ? confidences.reduce((sum, c) => sum + c, 0) / confidences.length
    : 0.5;

  // Merge notes
  merged.notes = allNotes.length > 0
    ? `Merged from ${extractions.length} pages: ${allNotes.join('; ')}`
    : `Merged from ${extractions.length} pages`;

  return merged;
}

/**
 * List available Ollama models
 */
export async function listOllamaModels() {
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/tags`, {
      method: 'GET',
      timeout: 5000
    });
    
    if (!response.ok) {
      throw new Error(`Failed to list models: ${response.status}`);
    }
    
    const data = await response.json();
    return data.models || [];
  } catch (error) {
    log('error', 'ollama_list_models_failed', { error: String(error) });
    return [];
  }
}

/**
 * Validate OCR extraction by having LLM check if data exists in correct locations
 * @param {string} imagePath - Path to image file
 * @param {Object} ocrData - OCR-extracted data to validate
 * @returns {Promise<Object>} Validation results
 */
export async function validateOcrWithVision(imagePath, ocrData) {
  const startTime = Date.now();
  
  try {
    // Read image and convert to base64
    const imageBuffer = await fs.promises.readFile(imagePath);
    const base64Image = imageBuffer.toString('base64');
    
    // Generate dynamic validation prompt based on OCR data
    const validationPrompt = generateValidationPrompt(ocrData);
    
    const fieldCount = countFields(ocrData);
    
    log('debug', 'ollama_validation_start', { 
      imagePath, 
      model: OLLAMA_MODEL,
      ocrFieldCount: fieldCount
    });
    
    // Call Ollama API with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT);
    
    const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: validationPrompt,
        images: [base64Image],
        stream: false,
        options: {
          temperature: 0.1,
          num_predict: 4096 // Increased for 55+ field validations (was 2048)
        }
      }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`Ollama validation error: ${response.status}`);
    }
    
    const result = await response.json();
    const duration = Date.now() - startTime;
    
    log('debug', 'ollama_validation_complete', { 
      duration, 
      responseLength: result.response?.length || 0 
    });
    
    log('debug', 'ollama_raw_validation_response', {
      length: result.response?.length || 0,
      preview: result.response?.substring(0, 300)
    });
    
    // Parse validation response with robust error handling
    const validation = parseOllamaValidationResponse(result.response);
    
    ollamaMonitor.recordRequest(true, duration);
    
    return {
      validation,
      rawResponse: result.response,
      duration,
      success: true
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    log('error', 'ollama_validation_failed', { 
      error: error.message,
      duration 
    });
    ollamaMonitor.recordRequest(false, duration);
    
    return {
      validation: null,
      error: error.message,
      duration,
      success: false
    };
  }
}

/**
 * Parse Ollama validation response with robust error handling
 */
function parseOllamaValidationResponse(response) {
  try {
    // Remove markdown code blocks
    let cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    
    // Extract JSON if surrounded by other text
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleaned = jsonMatch[0];
    }
    
    // Try parsing
    const parsed = JSON.parse(cleaned);
    
    // Ensure expected structure
    return {
      fieldValidations: parsed.fieldValidations || parsed.validations || {},
      overallAccuracy: parsed.overallAccuracy || parsed.accuracy || 0.85,
      issuesFound: parsed.issuesFound || parsed.issues || [],
      notes: parsed.notes || 'Validation complete'
    };
    
  } catch (error) {
    log('warn', 'ollama_validation_parse_failed', { 
      error: error.message,
      responsePreview: response?.substring(0, 200)
    });
    
    // Return default structure on parse failure
    return {
      fieldValidations: {},
      overallAccuracy: 0.5,
      issuesFound: ['Failed to parse validation response'],
      notes: 'Validation parsing error',
      rawResponse: response
    };
  }
}

/**
 * Count populated fields in OCR data
 */
function countFields(data) {
  let count = 0;
  
  // Only count fields in the extracted section (patient, insurance, provider, etc.)
  const relevantData = data?.extracted || data;
  
  const traverse = (obj, depth = 0) => {
    // Depth limit to prevent infinite recursion
    if (depth > 3) return;
    
    for (const key in obj) {
      // Skip non-field sections (raw OCR data)
      if (['rawOCR', 'rawTextCombined', 'ruleTrace', 'highlightSpans', 'ocr', 'documentMeta'].includes(key)) {
        continue;
      }
      
      if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
        traverse(obj[key], depth + 1);
      } else if (obj[key] !== null && obj[key] !== '') {
        count++;
      }
    }
  };
  
  traverse(relevantData);
  return count;
}

/**
 * Extract ONLY narrative/free-text fields from medical document
 * OCR handles structured fields - this focuses on unstructured text
 * @param {string} imagePath - Path to document image
 * @returns {Promise<Object>} Extracted narrative content
 */
export async function extractNarrativeFields(ocrText) {
  const narrativePrompt = `You are extracting narrative/free-text content AND problem lists from OCR-extracted text of a medical referral form.

DO NOT extract structured fields like:
- Patient name, DOB, ID numbers
- Insurance carrier, member ID
- Provider names, phone numbers, fax numbers
- CPT codes (unless part of procedure description)
- Dates, addresses

EXTRACT these sections from the text:
1. **Reason for Referral**: Why is the patient being referred? (clinical justification, symptoms, complaints)
2. **Clinical History**: Past medical history, relevant background
3. **Current Medications**: List of medications if present in narrative form
4. **Clinical Notes**: Any physician notes, observations, or special instructions
5. **Additional Comments**: Any other free-text physician commentary
6. **Problems List**: IMPORTANT - Look for ANY of these section headers and extract ALL conditions with onset dates:
   - "Problems", "Problem List", "Active Problems", "Medical Problems"
   - "Reviewed Problems", "Current Problems" 
   - "Past Medical History", "PMH", "Medical History"
   - "Diagnoses", "Diagnosis List", "Active Diagnoses", "Current Diagnoses"
   - "Conditions", "Medical Conditions", "Chronic Conditions"
   
   Extract format: array of objects with condition and onset date (if present)

Example Problems format:
[
  {"condition": "Recurrent major depressive episodes, mild", "onset": "08/20/2025"},
  {"condition": "Obstructive sleep apnea syndrome", "onset": "09/02/2025"},
  {"condition": "Snoring", "onset": "08/20/2025"}
]

Return ONLY valid JSON in this exact format:
{
  "reasonForReferral": "extracted text or null",
  "clinicalHistory": "extracted text or null",
  "currentMedications": "extracted text or null",
  "clinicalNotes": "extracted text or null",
  "additionalComments": "extracted text or null",
  "problemsList": [array of problem objects] or null,
  "hasNarrativeContent": true/false
}

If there is NO narrative content AND NO problems list, return all fields as null and hasNarrativeContent: false.

Here is the OCR text to analyze:

${ocrText}`;

  try {
    const startTime = Date.now();
    const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: narrativePrompt,
        stream: false,
        options: {
          temperature: 0.1, // Low temperature for consistency
          num_predict: 1000  // Increased for potential longer responses with problems
        }
      }),
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT)
    });

    if (!response.ok) {
      throw new Error(`Ollama narrative extraction failed: ${response.status}`);
    }

    const data = await response.json();
    const responseText = data.response || '';
    const duration = Date.now() - startTime;

    // Parse JSON from response
    let narrativeData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        narrativeData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseErr) {
      log('warn', 'ollama_narrative_parse_failed', { error: parseErr.message, response: responseText.substring(0, 200) });
      narrativeData = {
        reasonForReferral: null,
        clinicalHistory: null,
        currentMedications: null,
        clinicalNotes: null,
        additionalComments: null,
        problemsList: null,
        hasNarrativeContent: false,
        parseError: true
      };
    }

    // Log with more detail about what was extracted
    const problemsCount = Array.isArray(narrativeData.problemsList) ? narrativeData.problemsList.length : 0;
    
    log('info', 'ollama_narrative_extracted', {
      hasContent: narrativeData.hasNarrativeContent,
      duration,
      fieldsFound: Object.values(narrativeData).filter(v => v && v !== null).length,
      problemsCount,
      hasProblems: problemsCount > 0
    });
    
    if (problemsCount > 0) {
      log('info', 'problems_extracted_from_text', {
        count: problemsCount,
        conditions: narrativeData.problemsList.map(p => p.condition).join(', ')
      });
    }

    // Record successful request in monitor
    ollamaMonitor.recordRequest(true, duration);

    return {
      narrative: narrativeData,
      metadata: {
        model: OLLAMA_MODEL,
        duration,
        hasContent: narrativeData.hasNarrativeContent
      }
    };

  } catch (err) {
    log('error', 'ollama_narrative_extraction_failed', { error: err.message });
    
    // Record failed request in monitor
    ollamaMonitor.recordRequest(false, 0, err.message);
    
    return {
      narrative: {
        reasonForReferral: null,
        clinicalHistory: null,
        currentMedications: null,
        clinicalNotes: null,
        additionalComments: null,
        hasNarrativeContent: false,
        error: err.message
      },
      metadata: {
        model: OLLAMA_MODEL,
        duration: 0,
        error: err.message
      }
    };
  }
}

export default {
  checkOllamaHealth,
  extractWithOllama,
  extractMultiplePages,
  validateWithOllama,
  validateOcrWithVision,
  extractNarrativeFields,
  listOllamaModels
};
