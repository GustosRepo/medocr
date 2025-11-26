/**
 * Intelligent File Naming Utility
 * Generates clean, searchable filenames from extracted patient data
 * Format: LastName_FirstName_CPT_Date.pdf
 */

/**
 * Sanitize string for use in filenames
 * - Handles accents: García → Garcia
 * - Removes special chars: O'Brien → OBrien
 * - Spaces → underscores
 * - Safe for Windows/Mac/Linux
 */
function sanitizeForFilename(str) {
  if (!str) return '';
  
  return str
    .normalize('NFD') // Decompose accents
    .replace(/[\u0300-\u036f]/g, '') // Remove accent marks
    .replace(/[^a-zA-Z0-9\s-]/g, '') // Keep only alphanumeric, space, hyphen
    .replace(/\s+/g, '_') // Spaces → underscores
    .replace(/_+/g, '_') // Collapse multiple underscores
    .replace(/^_|_$/g, '') // Trim leading/trailing underscores
    .substring(0, 50); // Reasonable length limit
}

/**
 * Parse patient name from various formats:
 * - "Last, First" → { last: "Last", first: "First" }
 * - "First Last" → { first: "First", last: "Last" }
 * - { firstName, lastName } → { first, last }
 * - { first, last } → { first, last }
 */
function parsePatientName(patient) {
  if (!patient) return { first: '', last: '' };

  // Handle object with firstName/lastName
  if (patient.firstName || patient.lastName) {
    return {
      first: patient.firstName || '',
      last: patient.lastName || ''
    };
  }

  // Handle object with first/last
  if (patient.first || patient.last) {
    return {
      first: patient.first || '',
      last: patient.last || ''
    };
  }

  // Handle name string
  const name = patient.name || '';
  
  // Format: "Last, First"
  if (name.includes(',')) {
    const [last, first] = name.split(',').map(s => s.trim());
    return { first: first || '', last: last || '' };
  }

  // Format: "First Last" (assume last word is last name)
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return {
      first: parts[0],
      last: parts[parts.length - 1]
    };
  }

  // Single name - use as last name
  return { first: '', last: parts[0] || '' };
}

/**
 * Extract primary CPT code from procedure data
 * Handles multiple CPT formats and arrays
 */
function extractPrimaryCPT(procedure) {
  if (!procedure) return '';

  // Direct cpt field
  if (procedure.cpt) {
    // If array, take first
    if (Array.isArray(procedure.cpt)) {
      return procedure.cpt[0] || '';
    }
    return String(procedure.cpt);
  }

  // Check codes array
  if (Array.isArray(procedure.codes) && procedure.codes.length > 0) {
    return String(procedure.codes[0]);
  }

  // Check cptCode field
  if (procedure.cptCode) {
    return String(procedure.cptCode);
  }

  return '';
}

/**
 * Format date as YYYYMMDD for filename
 * Handles both ISO date strings and Date objects
 */
function formatDateForFilename(date) {
  if (!date) return '';
  
  // If it's already in YYYY-MM-DD format, parse it directly
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(date)) {
    const [year, month, day] = date.split('T')[0].split('-');
    return `${year}${month}${day}`;
  }
  
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  
  return `${year}${month}${day}`;
}

/**
 * Generate intelligent display filename from extracted data
 * Format: LastName_FirstName_CPT[_Date].pdf
 * 
 * @param {Object} extracted - Extracted data from document
 * @param {Object} options - Optional configuration
 * @returns {string} - Smart filename
 * 
 * Examples:
 * - Full data: "Arellano_Karla_95806_20250820.pdf"
 * - No date: "Arellano_Karla_95806.pdf"
 * - Missing name: "Unknown_95806_20250820.pdf"
 * - Missing CPT: "Arellano_Karla_20250820.pdf"
 */
export function generateDisplayFilename(extracted, options = {}) {
  const {
    includeDate = true,
    includeExtension = true,
    fallbackName = 'Unknown'
  } = options;

  const parts = [];

  // 1. Patient Name
  const { first, last } = parsePatientName(extracted?.patient);
  const lastName = sanitizeForFilename(last);
  const firstName = sanitizeForFilename(first);

  if (lastName) {
    parts.push(lastName);
  }

  if (firstName) {
    parts.push(firstName);
  }

  // If no name found, use fallback
  if (parts.length === 0) {
    parts.push(fallbackName);
  }

  // 2. CPT Code
  const cpt = extractPrimaryCPT(extracted?.procedure);
  if (cpt) {
    parts.push(sanitizeForFilename(cpt));
  }

  // 3. Date (optional)
  if (includeDate) {
    // Priority: referralDate > orderDate > documentDate > intakeDate
    const dateStr = extracted?.documentMeta?.referralDate || 
                    extracted?.documentMeta?.orderDate ||
                    extracted?.documentMeta?.documentDate ||
                    extracted?.documentMeta?.intakeDate ||
                    extracted?.header?.referralDate ||
                    extracted?.dates?.referral;
    
    const formattedDate = formatDateForFilename(dateStr);
    if (formattedDate) {
      parts.push(formattedDate);
    }
  }

  // Join parts with underscores
  let filename = parts.join('_');

  // Ensure we have something
  if (!filename || filename === '_') {
    filename = `${fallbackName}_${Date.now()}`;
  }

  // Add extension
  if (includeExtension) {
    filename += '.pdf';
  }

  return filename;
}

/**
 * Generate summary/export filename for PDF reports
 * Format: LastName_FirstName_CPT_Summary_Date.pdf
 * 
 * @param {Object} extracted - Extracted data or pdfModel
 * @returns {string} - Export filename
 * 
 * Example: "Arellano_Karla_95806_Summary_20250820.pdf"
 */
export function generateExportFilename(extracted) {
  const baseFilename = generateDisplayFilename(extracted, { 
    includeDate: true, 
    includeExtension: false 
  });
  
  return `${baseFilename}_Summary.pdf`;
}

/**
 * Validate if a filename is safe
 * Checks for path traversal, reserved names, length limits
 */
export function isValidFilename(filename) {
  if (!filename || typeof filename !== 'string') return false;
  
  // Check length (255 is common filesystem limit)
  if (filename.length > 255) return false;
  
  // Check for path traversal
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return false;
  }
  
  // Check for reserved names (Windows compatibility)
  const reserved = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 
                    'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 
                    'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'];
  
  const nameWithoutExt = filename.replace(/\.[^.]+$/, '').toUpperCase();
  if (reserved.includes(nameWithoutExt)) return false;
  
  return true;
}

/**
 * Handle filename collisions by appending counter
 * LastName_FirstName_CPT.pdf → LastName_FirstName_CPT_v2.pdf
 * 
 * @param {string} baseFilename - Desired filename
 * @param {string[]} existingFilenames - Array of already-used filenames
 * @returns {string} - Unique filename
 */
export function handleFilenameCollision(baseFilename, existingFilenames) {
  if (!existingFilenames.includes(baseFilename)) {
    return baseFilename;
  }

  const ext = baseFilename.match(/\.[^.]+$/)?.[0] || '';
  const nameWithoutExt = baseFilename.replace(/\.[^.]+$/, '');

  let counter = 2;
  let newFilename = `${nameWithoutExt}_v${counter}${ext}`;

  while (existingFilenames.includes(newFilename)) {
    counter++;
    newFilename = `${nameWithoutExt}_v${counter}${ext}`;
  }

  return newFilename;
}

// Export helper functions for testing
export const _test = {
  sanitizeForFilename,
  parsePatientName,
  extractPrimaryCPT,
  formatDateForFilename
};
