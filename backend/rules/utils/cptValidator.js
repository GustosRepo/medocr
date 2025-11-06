import fs from 'fs';
import path from 'path';

/**
 * CPT Code Validator
 * 
 * Validates and enriches CPT codes with descriptions and metadata.
 * 
 * Purpose: Ensure extracted CPT codes are valid and provide standardized descriptions
 * File: backend/rules/utils/cptValidator.js
 */

let validCptCache = null;

/**
 * Load valid CPT codes from configuration
 * @returns {object} - CPT codes dictionary
 */
function loadValidCpts() {
  if (validCptCache) return validCptCache;
  
  const configPath = path.join(process.cwd(), 'backend/config/valid_cpt_codes.json');
  
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    validCptCache = JSON.parse(raw);
    return validCptCache;
  } catch (err) {
    console.warn('[cptValidator] valid_cpt_codes.json not found, validation disabled');
    return {};
  }
}

/**
 * Validate a CPT code
 * @param {string} code - CPT code to validate
 * @returns {object} - Validation result with normalized code and metadata
 */
export function validateCpt(code) {
  if (!code) {
    return { 
      valid: false, 
      message: 'Missing CPT code',
      code: null
    };
  }
  
  // Normalize: remove non-alphanumeric characters, uppercase
  const normalized = String(code).replace(/[^A-Z0-9]/gi, '').toUpperCase();
  
  if (!normalized) {
    return {
      valid: false,
      message: 'Invalid CPT code format',
      code: normalized
    };
  }
  
  const validCpts = loadValidCpts();
  
  // Check if code exists in valid codes
  if (!validCpts[normalized]) {
    return {
      valid: false,
      message: `Unknown CPT code: ${normalized}`,
      code: normalized,
      suggestion: 'Verify code is correct or update valid_cpt_codes.json'
    };
  }
  
  const metadata = validCpts[normalized];
  
  return {
    valid: true,
    code: normalized,
    description: metadata.description,
    category: metadata.category,
    type: metadata.type,
    ageRestriction: metadata.ageRestriction,
    notes: metadata.notes
  };
}

/**
 * Validate CPT code with age check
 * @param {string} code - CPT code
 * @param {number} age - Patient age in years
 * @returns {object} - Validation result with age-specific warnings
 */
export function validateCptWithAge(code, age) {
  const result = validateCpt(code);
  
  if (!result.valid) return result;
  
  // Age-specific validation
  if (result.ageRestriction && age !== undefined && age !== null) {
    if (result.ageRestriction === '<6' && age >= 6) {
      result.ageWarning = `Code ${code} is for pediatric patients (<6 years). Patient age: ${age}`;
    } else if (result.ageRestriction === '6+' && age < 6) {
      result.ageWarning = `Code ${code} is for patients 6+ years. Patient age: ${age}`;
    }
  }
  
  return result;
}

/**
 * Get all valid CPT codes for a category
 * @param {string} category - Category name (e.g., "Home Sleep Test")
 * @returns {array} - Array of CPT codes in category
 */
export function getCptsByCategory(category) {
  const validCpts = loadValidCpts();
  
  return Object.entries(validCpts)
    .filter(([_, meta]) => meta.category === category)
    .map(([code, meta]) => ({ code, ...meta }));
}

/**
 * Suggest alternative CPT codes
 * @param {string} code - Current CPT code
 * @param {number} age - Patient age (optional)
 * @returns {array} - Array of suggested alternative codes
 */
export function suggestAlternatives(code, age) {
  const result = validateCpt(code);
  if (!result.valid) return [];
  
  const suggestions = [];
  
  // If age-restricted code doesn't match patient age, suggest alternatives
  if (result.ageWarning) {
    const validCpts = loadValidCpts();
    
    if (age < 6 && result.ageRestriction === '6+') {
      // Suggest pediatric codes
      if (code === '95810') suggestions.push({ code: '95782', reason: 'Pediatric version of 95810' });
      if (code === '95811') suggestions.push({ code: '95783', reason: 'Pediatric version of 95811' });
    } else if (age >= 6 && result.ageRestriction === '<6') {
      // Suggest adult codes
      if (code === '95782') suggestions.push({ code: '95810', reason: 'Adult version of 95782' });
      if (code === '95783') suggestions.push({ code: '95811', reason: 'Adult version of 95783' });
    }
  }
  
  return suggestions;
}

/**
 * Check if code requires prior authorization
 * @param {string} code - CPT code
 * @param {string} carrier - Insurance carrier name
 * @returns {boolean} - True if prior auth likely required
 */
export function requiresPriorAuth(code, carrier) {
  // This is a placeholder - in production, check against carrier-specific preauth rules
  const result = validateCpt(code);
  if (!result.valid) return false;
  
  // Common patterns: Titration studies often require prior diagnostic study
  if (result.type === 'therapeutic' && ['95811', '95783'].includes(code)) {
    return true;
  }
  
  return false;
}

export default {
  validateCpt,
  validateCptWithAge,
  getCptsByCategory,
  suggestAlternatives,
  requiresPriorAuth
};
