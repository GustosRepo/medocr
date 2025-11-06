/**
 * Phone Number OCR Correction and Normalization
 * 
 * Common OCR substitutions for phone numbers:
 * - Letters that look like digits: t→1, l→1, O→0, o→0, S→5, s→5, I→1, B→8, G→6
 * - Punctuation variations: spaces, dashes, dots, parentheses
 */

const OCR_DIGIT_CORRECTIONS = {
  't': '1',
  'T': '1',
  'l': '1',
  'L': '1',
  'I': '1',
  'i': '1',
  'O': '0',
  'o': '0',
  'D': '0',
  'S': '5',
  's': '5',
  'B': '8',
  'b': '8',
  'G': '6',
  'g': '6',
  'Z': '2',
  'z': '2',
};

/**
 * Apply OCR corrections to a phone number string
 * @param {string} phoneStr - Raw phone number string (may contain OCR errors)
 * @returns {string} Corrected phone number string
 */
function correctOCRErrors(phoneStr) {
  if (!phoneStr || typeof phoneStr !== 'string') {
    return phoneStr;
  }

  let corrected = phoneStr;
  
  // Apply character-level corrections for common OCR mistakes
  for (const [wrong, right] of Object.entries(OCR_DIGIT_CORRECTIONS)) {
    corrected = corrected.replace(new RegExp(wrong, 'g'), right);
  }
  
  return corrected;
}

/**
 * Normalize phone number to standard format (###) ###-####
 * @param {string} phoneStr - Phone number string (possibly with OCR errors)
 * @returns {string|null} Normalized phone number or null if invalid
 */
function normalizePhone(phoneStr) {
  if (!phoneStr || typeof phoneStr !== 'string') {
    return null;
  }

  // First apply OCR corrections
  let cleaned = correctOCRErrors(phoneStr);
  
  // Extract only digits
  const digits = cleaned.replace(/\D/g, '');
  
  // US phone numbers should be 10 or 11 digits
  if (digits.length === 10) {
    // Format as (###) ###-####
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  } else if (digits.length === 11 && digits[0] === '1') {
    // Remove leading 1 (US country code) and format
    const local = digits.slice(1);
    return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
  }
  
  // Invalid length - return cleaned version but don't format
  return digits || null;
}

/**
 * Validate if a phone number looks reasonable after correction
 * @param {string} phoneStr - Phone number string
 * @returns {boolean} True if phone number passes basic validation
 */
function isValidPhone(phoneStr) {
  if (!phoneStr || typeof phoneStr !== 'string') {
    return false;
  }

  // Apply corrections and extract digits
  const cleaned = correctOCRErrors(phoneStr);
  const digits = cleaned.replace(/\D/g, '');
  
  // Must be 10 or 11 digits
  if (digits.length !== 10 && digits.length !== 11) {
    return false;
  }
  
  // If 11 digits, must start with 1
  if (digits.length === 11 && digits[0] !== '1') {
    return false;
  }
  
  // Area code (first 3 digits) can't start with 0 or 1
  const areaCode = digits.length === 11 ? digits.slice(1, 4) : digits.slice(0, 3);
  if (areaCode[0] === '0' || areaCode[0] === '1') {
    return false;
  }
  
  return true;
}

/**
 * Process phone number: apply OCR corrections, normalize, and validate
 * @param {string} phoneStr - Raw phone number string from OCR
 * @returns {{original: string, corrected: string, normalized: string|null, valid: boolean}} Processing result
 */
function processPhone(phoneStr) {
  const original = phoneStr || '';
  const corrected = correctOCRErrors(original);
  const normalized = normalizePhone(original);
  const valid = isValidPhone(original);
  
  return {
    original,
    corrected,
    normalized,
    valid,
  };
}

module.exports = {
  correctOCRErrors,
  normalizePhone,
  isValidPhone,
  processPhone,
  OCR_DIGIT_CORRECTIONS, // Export for testing/inspection
};
