// backend/llmService.js - Integration with local Phi-3.5 Vision LLM service

import FormData from 'form-data';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

const LLM_SERVICE_URL = process.env.LLM_SERVICE_URL || 'http://localhost:8001';
const LLM_ENABLED = process.env.ENABLE_LLM !== 'false'; // Enabled by default
const LLM_TIMEOUT = parseInt(process.env.LLM_TIMEOUT || '30000', 10); // 30 seconds

/**
 * Check if LLM service is available
 */
export async function checkLLMHealth() {
  if (!LLM_ENABLED) {
    return { available: false, reason: 'disabled' };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${LLM_SERVICE_URL}/`, {
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return { available: false, reason: 'unhealthy', status: response.status };
    }

    const data = await response.json();
    return {
      available: true,
      model: data.model,
      device: data.device,
      gpu_available: data.gpu_available
    };
  } catch (error) {
    return {
      available: false,
      reason: error.name === 'AbortError' ? 'timeout' : 'unreachable',
      error: error.message
    };
  }
}

/**
 * Extract structured data from document image using LLM
 * 
 * @param {string} imagePath - Path to document image
 * @param {string} [customPrompt] - Optional custom extraction prompt
 * @returns {Promise<Object>} Extracted data with confidence scores
 */
export async function extractWithLocalLLM(imagePath, customPrompt = null) {
  if (!LLM_ENABLED) {
    console.log('[LLM] Service disabled, skipping LLM extraction');
    return null;
  }

  if (!fs.existsSync(imagePath)) {
    throw new Error(`Image file not found: ${imagePath}`);
  }

  try {
    console.log(`[LLM] Extracting from: ${path.basename(imagePath)}`);

    const formData = new FormData();
    formData.append('image', fs.createReadStream(imagePath));
    if (customPrompt) {
      formData.append('prompt', customPrompt);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT);

    const response = await fetch(`${LLM_SERVICE_URL}/extract`, {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders(),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LLM service error (${response.status}): ${error}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error('LLM extraction failed');
    }

    console.log(`[LLM] Extraction completed in ${result.metadata.inference_time}s`);
    console.log(`[LLM] Confidence: ${result.data.confidence || 'unknown'}`);

    return {
      ...result.data,
      _metadata: result.metadata
    };

  } catch (error) {
    if (error.name === 'AbortError') {
      console.error(`[LLM] Extraction timeout after ${LLM_TIMEOUT}ms`);
      return { error: 'timeout', message: 'LLM extraction timed out' };
    }

    console.error(`[LLM] Extraction failed:`, error.message);
    return { error: 'failed', message: error.message };
  }
}

/**
 * Enhance OCR extraction with LLM for missing/low-confidence fields
 * Only extracts specific missing fields to save processing time
 * 
 * @param {string} imagePath - Path to document image
 * @param {Object} ocrExtracted - OCR extraction result
 * @returns {Promise<Object>} Enhanced fields only
 */
export async function enhanceWithLocalLLM(imagePath, ocrExtracted) {
  if (!LLM_ENABLED) {
    return {};
  }

  // Identify missing critical fields
  const missingFields = [];
  
  if (!ocrExtracted.patient?.name || ocrExtracted.patient?.name === '—') {
    missingFields.push('patient name');
  }
  if (!ocrExtracted.patient?.dob || ocrExtracted.patient?.dob === '—') {
    missingFields.push('patient date of birth');
  }
  if (!ocrExtracted.insurance?.memberId || ocrExtracted.insurance?.memberId === '—') {
    missingFields.push('insurance member ID');
  }
  if (!ocrExtracted.provider?.name || ocrExtracted.provider?.name === '—') {
    missingFields.push('provider name');
  }
  if (!ocrExtracted.clinical?.cpt || ocrExtracted.clinical?.cpt === '—') {
    missingFields.push('CPT procedure code');
  }

  if (missingFields.length === 0) {
    console.log('[LLM] All critical fields present, skipping enhancement');
    return {};
  }

  console.log(`[LLM] Enhancing ${missingFields.length} missing fields: ${missingFields.join(', ')}`);

  // Build targeted prompt
  const targetedPrompt = `I'm having trouble extracting these specific fields from OCR. Please help me find:

${missingFields.map(f => `- ${f}`).join('\n')}

Return ONLY valid JSON with these fields (use null if not found):
{
  "patientName": "Last, First" or null,
  "patientDob": "MM/DD/YYYY" or null,
  "insuranceMemberId": "Member ID" or null,
  "providerName": "Provider Name" or null,
  "cptCode": "CPT code" or null,
  "confidence": 0.0 to 1.0
}`;

  try {
    const llmResult = await extractWithLocalLLM(imagePath, targetedPrompt);

    if (!llmResult || llmResult.error) {
      console.warn('[LLM] Enhancement failed, returning empty');
      return {};
    }

    // Map LLM results to expected structure
    const enhanced = {};

    if (llmResult.patientName) {
      enhanced.patient = { ...(enhanced.patient || {}), name: llmResult.patientName };
    }
    if (llmResult.patientDob) {
      enhanced.patient = { ...(enhanced.patient || {}), dob: llmResult.patientDob };
    }
    if (llmResult.insuranceMemberId) {
      enhanced.insurance = { ...(enhanced.insurance || {}), memberId: llmResult.insuranceMemberId };
    }
    if (llmResult.providerName) {
      enhanced.provider = { ...(enhanced.provider || {}), name: llmResult.providerName };
    }
    if (llmResult.cptCode) {
      enhanced.clinical = { ...(enhanced.clinical || {}), cpt: llmResult.cptCode };
    }

    console.log(`[LLM] Enhancement found ${Object.keys(enhanced).length} fields`);
    return enhanced;

  } catch (error) {
    console.error('[LLM] Enhancement error:', error.message);
    return {};
  }
}

/**
 * Validate OCR extraction against LLM vision analysis
 * Returns conflicts and agreement score
 * 
 * @param {string} imagePath - Path to document image
 * @param {Object} ocrData - OCR extracted data
 * @returns {Promise<Object>} Validation results
 */
export async function validateWithLLM(imagePath, ocrData) {
  if (!LLM_ENABLED) {
    return { available: false };
  }

  try {
    const formData = new FormData();
    formData.append('image', fs.createReadStream(imagePath));
    formData.append('ocr_data', JSON.stringify(ocrData));

    const response = await fetch(`${LLM_SERVICE_URL}/validate`, {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders()
    });

    if (!response.ok) {
      throw new Error(`Validation failed: ${response.status}`);
    }

    const result = await response.json();
    return result;

  } catch (error) {
    console.error('[LLM] Validation error:', error.message);
    return { error: error.message };
  }
}

export default {
  checkLLMHealth,
  extractWithLocalLLM,
  enhanceWithLocalLLM,
  validateWithLLM
};
