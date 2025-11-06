import fs from 'fs';
import path from 'path';

/**
 * OCR Text Corrector
 * 
 * Applies OCR error corrections to raw text before extraction:
 * 1. Common OCR errors from extraction_patterns.json
 * 2. Learned corrections from corrections_db.js
 * 
 * Purpose: Normalize corrupted OCR text to improve extraction accuracy
 * File: backend/rules/utils/ocrCorrector.js
 */

/**
 * Load extraction patterns configuration
 * @returns {object} - Config object with patterns and ocr_corrections
 */
function loadConfig() {
  const configPath = path.join(process.cwd(), 'backend/config/extraction_patterns.json');
  
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[ocrCorrector] extraction_patterns.json not found');
    return null;
  }
}

/**
 * Apply OCR corrections to raw text
 * @param {string} text - Raw OCR text
 * @param {object} correctionsDB - Instance of corrections database
 * @returns {string} - Corrected text
 */
export function applyOcrCorrections(text, correctionsDB) {
  if (!text) return text;
  
  let corrected = text;
  
  // 1. Apply common OCR error patterns from config
  const config = loadConfig();
  if (config?.ocr_corrections?.common_errors) {
    const commonErrors = config.ocr_corrections.common_errors;
    
    for (const [wrong, right] of Object.entries(commonErrors)) {
      // Case-insensitive replacement, preserving original case where possible
      const regex = new RegExp(escapeRegex(wrong), 'gi');
      corrected = corrected.replace(regex, (match) => {
        // Try to preserve case of original match
        if (match === match.toUpperCase()) return right.toUpperCase();
        if (match === match.toLowerCase()) return right.toLowerCase();
        if (match[0] === match[0].toUpperCase()) {
          return right.charAt(0).toUpperCase() + right.slice(1).toLowerCase();
        }
        return right;
      });
    }
  }
  
  // 2. Apply learned corrections from corrections database
  if (correctionsDB && typeof correctionsDB.getAll === 'function') {
    try {
      const learned = correctionsDB.getAll();
      
      // Apply corrections for non-PHI fields only
      const safeTypes = [
        'providerNames',
        'facilities',
        'cpt',
        'carrier',
        'procedureDescription',
        'diagnosisDescription',
        'practiceName',
        'referringProvider',
        'safetyCategory',
        'accommodationType',
        'supervisingProvider',
        'planType',
        'studyType'
      ];
      
      for (const type of safeTypes) {
        const corrections = learned[type];
        if (!corrections || typeof corrections !== 'object') continue;
        
        for (const [key, data] of Object.entries(corrections)) {
          if (!data.corrections || data.corrections.length === 0) continue;
          
          // Use the most frequently corrected value
          const best = data.corrections[0].text;
          const count = data.corrections[0].count;
          
          // Only apply if corrected at least 2 times (confidence threshold)
          if (count >= 2 && key && best && key !== best) {
            const regex = new RegExp(escapeRegex(key), 'gi');
            corrected = corrected.replace(regex, best);
          }
        }
      }
    } catch (err) {
      console.warn('[ocrCorrector] Failed to apply learned corrections:', err.message);
    }
  }
  
  // 3. Apply character-level replacements in specific contexts
  // (e.g., l→1 in member IDs, O→0 in phone numbers)
  // This is handled separately in phone detection's extractDigits()
  // but we can add context-aware replacements here if needed
  
  return corrected;
}

/**
 * Escape special regex characters
 * @param {string} str - String to escape
 * @returns {string} - Escaped string
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Apply corrections to specific field values after extraction
 * @param {string} type - Field type (e.g., 'carrier', 'cpt')
 * @param {string} value - Extracted value
 * @param {object} correctionsDB - Corrections database instance
 * @returns {string} - Corrected value or original if no correction found
 */
export function applyFieldCorrection(type, value, correctionsDB) {
  if (!value || !correctionsDB) return value;
  
  try {
    const corrected = correctionsDB.getCorrection(type, value);
    if (!corrected) return value;
    if (typeof corrected === 'string') return corrected;
    if (typeof corrected.text === 'string' && corrected.text.trim()) return corrected.text;
    return value;
  } catch (err) {
    console.warn(`[ocrCorrector] Failed to apply correction for ${type}:`, err.message);
    return value;
  }
}

/**
 * Normalize insurance carrier names with common OCR variations
 * @param {string} name - Raw carrier name
 * @returns {string} - Normalized name
 */
export function normalizeCarrierName(name) {
  if (!name) return name;
  
  const normalized = name.toLowerCase()
    .replace(/lnsurance/g, 'insurance')
    .replace(/insurence/g, 'insurance')
    .replace(/\baetha\b/g, 'aetna')
    .replace(/\baethna\b/g, 'aetna')
    .replace(/\bathem\b/g, 'anthem')
    .replace(/\bbule\s+cross\b/g, 'blue cross')
    .replace(/\bcigha\b/g, 'cigna')
    .replace(/\bhumaha\b/g, 'humana')
    .replace(/\bunitad\b/g, 'united')
    .replace(/\bmedicere\b/g, 'medicare')
    .trim();
  
  // Restore proper capitalization
  return normalized.split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Normalize provider names with common OCR variations
 * @param {string} name - Raw provider name
 * @returns {string} - Normalized name
 */
export function normalizeProviderName(name) {
  if (!name) return name;
  
  const normalized = name
    .replace(/\bprovidар\b/gi, 'provider')
    .replace(/\bphysicion\b/gi, 'physician')
    .replace(/\brefering\b/gi, 'referring')
    .replace(/\borderihg\b/gi, 'ordering')
    .trim();
  
  return normalized;
}

export default {
  applyOcrCorrections,
  applyFieldCorrection,
  normalizeCarrierName,
  normalizeProviderName
};
