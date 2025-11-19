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

// Ollama configuration
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llava:13b';
const OLLAMA_TIMEOUT = parseInt(process.env.OLLAMA_TIMEOUT || '60000', 10);

/**
 * Medical extraction prompt template
 */
const MEDICAL_EXTRACTION_PROMPT = `You are a medical document extraction assistant. Extract the following information from this medical referral form image. Be precise and only extract what you can clearly see.

Extract these fields:
- Patient full name (Last, First)
- Date of birth (MM/DD/YYYY)
- Phone number
- Insurance carrier name
- Member/Policy ID
- Referring provider name
- Provider NPI (if visible)
- Primary diagnosis or referral reason
- Requested procedure/test

Return ONLY valid JSON in this exact format (use null for missing fields):
{
  "patient": {
    "name": "Last, First" or null,
    "dob": "MM/DD/YYYY" or null,
    "phone": "(XXX) XXX-XXXX" or null
  },
  "insurance": {
    "carrier": "Carrier Name" or null,
    "memberId": "ID" or null
  },
  "provider": {
    "name": "Provider Name" or null,
    "npi": "NPI" or null
  },
  "clinical": {
    "diagnosis": "Diagnosis text" or null,
    "procedure": "Procedure name" or null
  },
  "confidence": 0.0 to 1.0,
  "notes": "Any concerns or unclear fields"
}

Important:
- Return ONLY the JSON, no other text
- Use null for missing fields, not empty strings
- Format phone numbers as (XXX) XXX-XXXX
- Format dates as MM/DD/YYYY`;

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
    
    const startTime = Date.now();
    
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
    
    return {
      extracted,
      rawResponse: result.response,
      model: OLLAMA_MODEL,
      timing: duration,
      success: true
    };
    
  } catch (error) {
    log('error', 'ollama_extract_failed', { 
      imagePath, 
      error: String(error) 
    });
    
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
 * Parse JSON from Ollama response (handles markdown code blocks)
 */
function parseJsonResponse(text) {
  try {
    // Try direct parse first
    return JSON.parse(text);
  } catch {
    // Look for JSON in markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]);
    }
    
    // Try to find JSON object in text
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      return JSON.parse(objectMatch[0]);
    }
    
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

export default {
  checkOllamaHealth,
  extractWithOllama,
  validateWithOllama,
  listOllamaModels
};
