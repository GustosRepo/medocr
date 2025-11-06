import fs from 'fs';
import path from 'path';

/**
 * ICD-10 Code Validator
 * 
 * Validates and enriches ICD-10 diagnosis codes with descriptions and metadata.
 * 
 * Purpose: Ensure extracted ICD-10 codes are valid and provide clinical context
 * File: backend/rules/utils/icd10Validator.js
 */

let validIcd10Cache = null;

/**
 * Load valid ICD-10 codes from configuration
 * @returns {object} - ICD-10 codes dictionary
 */
function loadValidIcd10() {
  if (validIcd10Cache) return validIcd10Cache;
  
  const configPath = path.join(process.cwd(), 'backend/config/icd10_codes.json');
  
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    validIcd10Cache = JSON.parse(raw);
    return validIcd10Cache;
  } catch (err) {
    console.warn('[icd10Validator] icd10_codes.json not found, validation disabled');
    return {};
  }
}

/**
 * Normalize ICD-10 code format
 * @param {string} code - Raw ICD-10 code
 * @returns {string} - Normalized code with proper decimal placement
 */
export function normalizeIcd10(code) {
  if (!code) return null;
  
  // Remove whitespace and convert to uppercase
  let normalized = String(code).replace(/\s+/g, '').toUpperCase();
  
  // ICD-10 format: Letter + 2 digits + optional decimal + 1-2 digits
  // Examples: G47.33, G4733, E11.9, E119
  
  // If no decimal and length > 3, insert decimal after 3rd character
  if (!normalized.includes('.') && normalized.length > 3) {
    normalized = normalized.slice(0, 3) + '.' + normalized.slice(3);
  }
  
  return normalized;
}

/**
 * Validate an ICD-10 code
 * @param {string} code - ICD-10 code to validate
 * @returns {object} - Validation result with normalized code and metadata
 */
export function validateIcd10(code) {
  if (!code) {
    return {
      valid: false,
      message: 'Missing ICD-10 code',
      code: null
    };
  }
  
  const normalized = normalizeIcd10(code);
  
  // Validate format: Letter + 2-3 digits + optional decimal + 0-2 digits
  if (!/^[A-Z]\d{2,3}(?:\.\d{0,2})?$/.test(normalized)) {
    return {
      valid: false,
      message: `Invalid ICD-10 format: ${normalized}`,
      code: normalized,
      suggestion: 'Expected format: Letter + 2-3 digits (e.g., G47.33)'
    };
  }
  
  const validIcd10 = loadValidIcd10();
  
  // Check if code exists in valid codes
  if (!validIcd10[normalized]) {
    // Try to find close match (e.g., G47.3 if G47.33 not found)
    const baseCode = normalized.split('.')[0];
    const matches = Object.keys(validIcd10).filter(k => k.startsWith(baseCode));
    
    return {
      valid: false,
      message: `Unknown ICD-10 code: ${normalized}`,
      code: normalized,
      suggestion: matches.length > 0 
        ? `Did you mean: ${matches.slice(0, 3).join(', ')}?`
        : 'Verify code is correct or update icd10_codes.json'
    };
  }
  
  const metadata = validIcd10[normalized];
  
  return {
    valid: true,
    code: normalized,
    description: metadata.description,
    category: metadata.category,
    chronic: metadata.chronic,
    severity: metadata.severity,
    notes: metadata.notes,
    relatedCpt: metadata.relatedCpt
  };
}

/**
 * Validate multiple ICD-10 codes
 * @param {array} codes - Array of ICD-10 codes
 * @returns {array} - Array of validation results
 */
export function validateIcd10Batch(codes) {
  if (!Array.isArray(codes)) return [];
  
  return codes.map(code => validateIcd10(code));
}

/**
 * Get ICD-10 codes by category
 * @param {string} category - Category name (e.g., "Sleep Disorders")
 * @returns {array} - Array of ICD-10 codes in category
 */
export function getIcd10ByCategory(category) {
  const validIcd10 = loadValidIcd10();
  
  return Object.entries(validIcd10)
    .filter(([_, meta]) => meta.category === category)
    .map(([code, meta]) => ({ code, ...meta }));
}

/**
 * Check if diagnosis code is related to a CPT code
 * @param {string} icdCode - ICD-10 code
 * @param {string} cptCode - CPT code
 * @returns {boolean} - True if codes are related
 */
export function isRelatedToCpt(icdCode, cptCode) {
  const result = validateIcd10(icdCode);
  if (!result.valid || !result.relatedCpt) return false;
  
  return result.relatedCpt.includes(cptCode);
}

/**
 * Check if HST (Home Sleep Test) is appropriate for diagnosis
 * @param {string} icdCode - ICD-10 code
 * @param {array} comorbidities - Array of comorbid ICD-10 codes
 * @returns {object} - HST eligibility assessment
 */
export function checkHstEligibility(icdCode, comorbidities = []) {
  const primary = validateIcd10(icdCode);
  if (!primary.valid) {
    return {
      eligible: false,
      reason: 'Invalid primary diagnosis'
    };
  }
  
  // HST contraindications
  const contraindications = [
    'J44.9',  // COPD
    'I50.9',  // Heart failure
    'G47.31', // Central sleep apnea
    'G47.419', // Narcolepsy
    'G47.411'  // Narcolepsy with cataplexy
  ];
  
  // Check primary diagnosis
  if (contraindications.includes(primary.code)) {
    return {
      eligible: false,
      reason: `HST not appropriate for ${primary.description}`,
      recommendation: 'In-lab polysomnography (95810) recommended'
    };
  }
  
  // Check comorbidities
  for (const comorbid of comorbidities) {
    const normalized = normalizeIcd10(comorbid);
    if (contraindications.includes(normalized)) {
      const info = validateIcd10(normalized);
      return {
        eligible: false,
        reason: `Comorbid condition contraindicates HST: ${info.description}`,
        recommendation: 'In-lab polysomnography (95810) recommended'
      };
    }
  }
  
  // Check if diagnosis is OSA-related
  if (primary.code.startsWith('G47.3') || primary.code === 'R06.83') {
    return {
      eligible: true,
      reason: 'Appropriate for HST (95806 or G0399)',
      recommendation: 'Home sleep test suitable for uncomplicated OSA'
    };
  }
  
  return {
    eligible: 'uncertain',
    reason: 'Diagnosis not specifically sleep apnea',
    recommendation: 'Clinical judgment required'
  };
}

/**
 * Enrich diagnosis with full metadata
 * @param {string} code - ICD-10 code
 * @returns {object} - Enriched diagnosis object
 */
export function enrichDiagnosis(code) {
  const result = validateIcd10(code);
  
  if (!result.valid) {
    return {
      code: normalizeIcd10(code),
      description: 'Unknown diagnosis',
      valid: false
    };
  }
  
  return {
    code: result.code,
    description: result.description,
    category: result.category,
    chronic: result.chronic,
    severity: result.severity,
    notes: result.notes,
    valid: true
  };
}

export default {
  normalizeIcd10,
  validateIcd10,
  validateIcd10Batch,
  getIcd10ByCategory,
  isRelatedToCpt,
  checkHstEligibility,
  enrichDiagnosis
};
