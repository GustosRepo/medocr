/**
 * PHI Sanitizer for Logging
 * 
 * Redacts Protected Health Information (PHI) from logs to ensure HIPAA compliance.
 * 
 * Purpose: Prevent logging of sensitive patient data
 * File: backend/utils/phiSanitizer.js
 */

const PHI_PATTERNS = {
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  dob: /\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/\d{4}\b/g,
  phone: /\b\d{3}[-.)]\s*\d{3}[-.\s]\d{4}\b/g,
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  memberIdPattern: /\b([A-Z]\d{8,10})\b/g
};

/**
 * Sanitize log data by redacting PHI
 * @param {any} data - Data to sanitize (string, object, or array)
 * @returns {string} - Sanitized log string
 */
export function sanitizeLogData(data) {
  if (!data) return String(data);
  
  // Convert to string if object
  let str = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  
  // Apply pattern-based redactions
  for (const [type, pattern] of Object.entries(PHI_PATTERNS)) {
    str = str.replace(pattern, `[${type.toUpperCase()}_REDACTED]`);
  }
  
  // Redact common PHI field names in JSON
  str = str.replace(/"(?:patient)?[Nn]ame":\s*"[^"]+"/g, '"name":"[REDACTED]"');
  str = str.replace(/"(?:patient)?[Dd]ob":\s*"[^"]+"/g, '"dob":"[REDACTED]"');
  str = str.replace(/"(?:member|subscriber|policy)[Ii]d":\s*"[^"]+"/g, '"memberId":"[REDACTED]"');
  str = str.replace(/"(?:patient)?[Ee]mail":\s*"[^"]+"/g, '"email":"[REDACTED]"');
  str = str.replace(/"(?:patient)?[Pp]hones?":\s*\[[^\]]*\]/g, '"phones":["[REDACTED]"]');
  
  // Redact first/last names in patient object
  str = str.replace(/"first":\s*"[^"]+"/g, '"first":"[REDACTED]"');
  str = str.replace(/"last":\s*"[^"]+"/g, '"last":"[REDACTED]"');
  
  return str;
}

/**
 * Sanitize result object for logging (preserves non-PHI clinical data)
 * @param {object} result - Extraction result object
 * @returns {object} - Sanitized result
 */
export function sanitizeResult(result) {
  if (!result || typeof result !== 'object') return result;
  
  const sanitized = { ...result };
  
  // Redact patient information
  if (sanitized.patient) {
    sanitized.patient = {
      ...sanitized.patient,
      first: '[REDACTED]',
      last: '[REDACTED]',
      name: '[REDACTED]',
      dob: '[REDACTED]',
      email: '[REDACTED]',
      phones: sanitized.patient.phones ? ['[REDACTED]'] : undefined
    };
  }
  
  // Redact insurance member/subscriber IDs (carrier name is non-PHI)
  if (Array.isArray(sanitized.insurance)) {
    sanitized.insurance = sanitized.insurance.map(ins => ({
      ...ins,
      memberId: ins.memberId ? '[REDACTED]' : undefined,
      groupId: ins.groupId ? '[REDACTED]' : undefined
    }));
  }
  
  // Provider info is non-PHI (business identifiers), keep as-is
  // CPT/ICD codes are non-PHI, keep as-is
  // Clinical data is non-PHI in aggregate, keep as-is
  
  return sanitized;
}

/**
 * Create a sanitized error message
 * @param {Error} error - Error object
 * @param {object} context - Additional context
 * @returns {string} - Sanitized error message
 */
export function sanitizeError(error, context = {}) {
  const message = error?.message || String(error);
  const sanitizedContext = sanitizeResult(context);
  
  return `${message} | Context: ${JSON.stringify(sanitizedContext)}`;
}

export default {
  sanitizeLogData,
  sanitizeResult,
  sanitizeError
};
