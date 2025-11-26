/**
 * Dual-Engine Processing Utilities
 * 
 * Provides utilities for parallel OCR + LLM processing including:
 * - PDF to image conversion for LLM input
 * - Levenshtein distance for fuzzy string matching
 * - Field comparison and conflict resolution
 * - Data merging strategies
 */

import { PDFDocument } from 'pdf-lib';
import fs from 'fs/promises';
import { createCanvas, loadImage } from 'canvas';
import { performance } from 'perf_hooks';

/**
 * Convert PDF first page to image for LLM processing
 * @param {string} pdfPath - Path to PDF file
 * @param {number} pageIndex - Page to convert (default: 0)
 * @param {number} dpi - Resolution for conversion (default: 150)
 * @returns {Promise<string>} Path to generated image
 */
export async function pdfToImage(pdfPath, pageIndex = 0, dpi = 150) {
  try {
    // For now, we'll use a simple approach that works with the OCR service
    // In production, you might want to use pdf-poppler or similar
    // The LLM service can also accept PDFs directly in some cases
    
    // Read PDF bytes
    const pdfBytes = await fs.readFile(pdfPath);
    
    // For multi-page PDFs, we'll focus on first page for LLM
    // The OCR service already handles multi-page well
    const tempImagePath = pdfPath.replace('.pdf', `_page${pageIndex}_llm.png`);
    
    // TODO: Implement actual PDF to image conversion
    // For now, return the PDF path directly - the LLM service handles PDFs
    return pdfPath;
  } catch (error) {
    console.error('PDF to image conversion failed:', error);
    // Fallback: return original PDF path
    return pdfPath;
  }
}

/**
 * Calculate Levenshtein distance between two strings
 * Used for fuzzy string matching and conflict resolution
 * 
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Edit distance (0 = identical)
 */
export function levenshteinDistance(str1, str2) {
  if (!str1) return str2 ? str2.length : 0;
  if (!str2) return str1.length;

  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();

  const matrix = [];

  // Initialize first column
  for (let i = 0; i <= s2.length; i++) {
    matrix[i] = [i];
  }

  // Initialize first row
  for (let j = 0; j <= s1.length; j++) {
    matrix[0][j] = j;
  }

  // Fill in the rest
  for (let i = 1; i <= s2.length; i++) {
    for (let j = 1; j <= s1.length; j++) {
      if (s2.charAt(i - 1) === s1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[s2.length][s1.length];
}

/**
 * Calculate similarity percentage between two strings
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Similarity percentage (0-100)
 */
export function stringSimilarity(str1, str2) {
  if (!str1 && !str2) return 100;
  if (!str1 || !str2) return 0;
  
  const distance = levenshteinDistance(str1, str2);
  const maxLength = Math.max(str1.length, str2.length);
  
  if (maxLength === 0) return 100;
  
  return Math.round((1 - distance / maxLength) * 100);
}

/**
 * Check if two field values are similar enough to be considered a match
 * @param {any} value1 - First value
 * @param {any} value2 - Second value
 * @param {number} threshold - Similarity threshold (default: 85%)
 * @returns {boolean} True if values are similar
 */
export function isFuzzyMatch(value1, value2, threshold = 85) {
  if (value1 === value2) return true;
  if (!value1 || !value2) return false;
  
  const str1 = String(value1);
  const str2 = String(value2);
  
  return stringSimilarity(str1, str2) >= threshold;
}

/**
 * Get nested field value from object using dot notation
 * @param {Object} obj - Source object
 * @param {string} path - Dot notation path (e.g., "patient.firstName")
 * @returns {any} Field value or undefined
 */
export function getNestedValue(obj, path) {
  if (!obj || !path) return undefined;
  
  const keys = path.split('.');
  let current = obj;
  
  for (const key of keys) {
    if (current?.[key] === undefined) return undefined;
    current = current[key];
  }
  
  return current;
}

/**
 * Set nested field value in object using dot notation
 * @param {Object} obj - Target object
 * @param {string} path - Dot notation path
 * @param {any} value - Value to set
 * @returns {Object} Modified object
 */
export function setNestedValue(obj, path, value) {
  if (!obj || !path) return obj;
  
  const keys = path.split('.');
  let current = obj;
  
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!current[key]) current[key] = {};
    current = current[key];
  }
  
  current[keys[keys.length - 1]] = value;
  return obj;
}

/**
 * Compare two field values and determine resolution strategy
 * Returns a resolution object with strategy and chosen value
 * 
 * @param {string} fieldPath - Field path (e.g., "patient.firstName")
 * @param {any} ocrValue - Value from OCR
 * @param {any} llmValue - Value from LLM
 * @param {Object} options - Comparison options
 * @returns {Object} Resolution result
 */
export function compareFields(fieldPath, ocrValue, llmValue, options = {}) {
  const { fuzzyThreshold = 85, fieldSpecificRules = {} } = options;
  
  // Strategy 1: Both empty
  if (!ocrValue && !llmValue) {
    return {
      strategy: 'both_empty',
      resolved: null,
      confidence: 0,
      isConflict: false
    };
  }
  
  // Strategy 2: Exact match
  if (ocrValue === llmValue) {
    return {
      strategy: 'exact_match',
      resolved: ocrValue,
      confidence: 100,
      isConflict: false
    };
  }
  
  // Strategy 3: One empty (prefer non-empty)
  if (!ocrValue && llmValue) {
    return {
      strategy: 'llm_only',
      resolved: llmValue,
      confidence: 75,
      isConflict: false,
      note: 'OCR missed this field'
    };
  }
  
  if (ocrValue && !llmValue) {
    return {
      strategy: 'ocr_only',
      resolved: ocrValue,
      confidence: 75,
      isConflict: false,
      note: 'LLM missed this field'
    };
  }
  
  // Strategy 4: Fuzzy match (close enough)
  const similarity = stringSimilarity(String(ocrValue), String(llmValue));
  if (similarity >= fuzzyThreshold) {
    // Prefer LLM for fuzzy matches (better at handling formatting)
    return {
      strategy: 'fuzzy_match',
      resolved: llmValue,
      confidence: similarity,
      isConflict: false,
      similarity,
      note: `${similarity}% similar, preferring LLM formatting`
    };
  }
  
  // Strategy 5: Field-specific rules
  const fieldRule = fieldSpecificRules[fieldPath];
  if (fieldRule) {
    const result = fieldRule(ocrValue, llmValue);
    return {
      strategy: 'field_specific_rule',
      ...result,
      isConflict: !result.resolved
    };
  }
  
  // Strategy 6: Conflict - prefer LLM by default (better context understanding)
  return {
    strategy: 'conflict_prefer_llm',
    resolved: llmValue,
    confidence: 50,
    isConflict: true,
    ocrValue,
    llmValue,
    similarity,
    note: 'Values differ significantly, preferring LLM interpretation'
  };
}

/**
 * Merge OCR and LLM extraction results
 * Implements conflict resolution and generates audit trail
 * 
 * @param {Object} ocrData - OCR extraction result
 * @param {Object} llmData - LLM extraction result
 * @param {Object} options - Merge options
 * @returns {Object} Merged result with resolution metadata
 */
export function mergeExtractions(ocrData, llmData, options = {}) {
  const merged = {};
  const conflicts = [];
  const resolutions = {};
  let matchCount = 0;
  let totalFields = 0;
  
  // DEBUG: Log structure comparison
  console.log('\n========== MERGE DEBUG START ==========');
  console.log('[OCR] Top-level keys:', Object.keys(ocrData || {}).join(', '));
  console.log('[LLM] Top-level keys:', Object.keys(llmData || {}).join(', '));
  
  // Show nested structure for common fields
  if (ocrData?.patient) {
    console.log('[OCR] patient keys:', Object.keys(ocrData.patient).join(', '));
  }
  if (llmData?.patient) {
    console.log('[LLM] patient keys:', Object.keys(llmData.patient).join(', '));
  }
  
  console.log('\n[OCR] Full structure (first 600 chars):', JSON.stringify(ocrData, null, 2).substring(0, 600));
  console.log('\n[LLM] Full structure (first 600 chars):', JSON.stringify(llmData, null, 2).substring(0, 600));
  console.log('========== MERGE DEBUG END ==========\n');
  
  // Field-specific rules for medical data
  const fieldSpecificRules = {
    'patient.dob': (ocr, llm) => {
      // Prefer format with separators for dates
      const ocrHasSep = /[-\/]/.test(String(ocr));
      const llmHasSep = /[-\/]/.test(String(llm));
      
      if (ocrHasSep && !llmHasSep) {
        return { resolved: ocr, confidence: 80, note: 'OCR has better date formatting' };
      }
      if (llmHasSep && !ocrHasSep) {
        return { resolved: llm, confidence: 80, note: 'LLM has better date formatting' };
      }
      
      // Default to LLM
      return { resolved: llm, confidence: 60 };
    },
    
    'patient.phone': (ocr, llm) => {
      // Count digits
      const ocrDigits = String(ocr).replace(/\D/g, '');
      const llmDigits = String(llm).replace(/\D/g, '');
      
      // Prefer 10-digit phone numbers
      if (ocrDigits.length === 10 && llmDigits.length !== 10) {
        return { resolved: ocr, confidence: 85, note: 'OCR has valid 10-digit phone' };
      }
      if (llmDigits.length === 10 && ocrDigits.length !== 10) {
        return { resolved: llm, confidence: 85, note: 'LLM has valid 10-digit phone' };
      }
      
      return { resolved: llm, confidence: 65 };
    },
    
    'insurance.memberId': (ocr, llm) => {
      // Prefer alphanumeric with fewer special chars
      const ocrClean = String(ocr).replace(/[^A-Z0-9]/gi, '');
      const llmClean = String(llm).replace(/[^A-Z0-9]/gi, '');
      
      if (ocrClean.length > llmClean.length) {
        return { resolved: ocr, confidence: 75, note: 'OCR has more complete member ID' };
      }
      
      return { resolved: llm, confidence: 70 };
    }
  };
  
  // Get all unique field paths from both results
  const allPaths = new Set();
  
  function collectPaths(obj, prefix = '') {
    if (!obj || typeof obj !== 'object') return;
    
    for (const [key, value] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${key}` : key;
      
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        collectPaths(value, path);
      } else if (!Array.isArray(value)) {
        allPaths.add(path);
      }
    }
  }
  
  collectPaths(ocrData);
  collectPaths(llmData);
  
  // Compare and resolve each field
  for (const path of allPaths) {
    totalFields++;
    
    const ocrValue = getNestedValue(ocrData, path);
    const llmValue = getNestedValue(llmData, path);
    
    const resolution = compareFields(path, ocrValue, llmValue, { 
      fieldSpecificRules 
    });
    
    resolutions[path] = resolution;
    
    if (resolution.resolved !== null && resolution.resolved !== undefined) {
      setNestedValue(merged, path, resolution.resolved);
    }
    
    if (resolution.isConflict) {
      conflicts.push({
        field: path,
        ocrValue,
        llmValue,
        resolved: resolution.resolved,
        strategy: resolution.strategy,
        similarity: resolution.similarity,
        note: resolution.note
      });
    } else if (resolution.strategy === 'exact_match') {
      matchCount++;
    }
  }
  
  // Calculate agreement score
  const agreementScore = totalFields > 0 
    ? Math.round((matchCount / totalFields) * 100) 
    : 0;
  
  return {
    merged,
    metadata: {
      agreementScore,
      totalFields,
      matchCount,
      conflictCount: conflicts.length,
      resolutions,
      processingTime: new Date().toISOString()
    },
    conflicts
  };
}

/**
 * Calculate overall data quality score from dual-engine results
 * @param {Object} mergeResult - Result from mergeExtractions
 * @param {Object} ocrResult - Original OCR result
 * @param {Object} llmResult - Original LLM result
 * @returns {Object} Quality assessment
 */
export function assessDataQuality(mergeResult, ocrResult, llmResult) {
  const { agreementScore, conflictCount, totalFields } = mergeResult.metadata;
  
  // Factors affecting quality
  const factors = {
    agreement: agreementScore,
    conflictRate: totalFields > 0 ? (conflictCount / totalFields) * 100 : 0,
    ocrConfidence: ocrResult?.confidenceDetail?.score || 0.5,
    completeness: (totalFields - conflictCount) / totalFields * 100
  };
  
  // Weighted quality score
  const qualityScore = Math.round(
    factors.agreement * 0.4 +
    (100 - factors.conflictRate) * 0.3 +
    factors.ocrConfidence * 100 * 0.2 +
    factors.completeness * 0.1
  );
  
  let grade;
  if (qualityScore >= 90) grade = 'A';
  else if (qualityScore >= 80) grade = 'B';
  else if (qualityScore >= 70) grade = 'C';
  else if (qualityScore >= 60) grade = 'D';
  else grade = 'F';
  
  return {
    score: qualityScore,
    grade,
    level: qualityScore >= 80 ? 'high' : qualityScore >= 60 ? 'medium' : 'low',
    factors,
    recommendation: qualityScore >= 80 
      ? 'Data quality is high, safe for automated processing'
      : qualityScore >= 60
      ? 'Data quality is acceptable, spot-check recommended'
      : 'Data quality is low, manual review required'
  };
}

export default {
  pdfToImage,
  levenshteinDistance,
  stringSimilarity,
  isFuzzyMatch,
  getNestedValue,
  setNestedValue,
  compareFields,
  mergeExtractions,
  assessDataQuality
};
