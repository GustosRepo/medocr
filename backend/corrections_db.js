/**
 * OCR Corrections Database
 * 
 * Learns from user corrections to improve future extractions.
 * Stores corrections locally and can sync with NPI registry for provider names.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CORRECTIONS_FILE = path.join(__dirname, 'data/corrections.json');

class CorrectionsDB {
  constructor() {
    this.corrections = this.loadCorrections();
    this.npiCache = new Map(); // Cache for NPI lookups
  }

  loadCorrections() {
    try {
      if (fs.existsSync(CORRECTIONS_FILE)) {
        const data = fs.readFileSync(CORRECTIONS_FILE, 'utf8');
        return JSON.parse(data);
      }
    } catch (err) {
      console.warn('Failed to load corrections DB:', err.message);
    }
    return {
      providerNames: {},
      npi: {},
      phone: {},
      fax: {},
      carrier: {},
      cpt: {},
      icd: {},
      facilities: {},
      // Tier 1: High-value non-PHI fields
      procedureDescription: {},
      practiceName: {},
      referringProvider: {},
      referringNpi: {},
      referringPhone: {},
      referringFax: {},
      diagnosisDescription: {},
      // Tier 2: Quality-of-life improvements
      providerNotes: {},
      safetyCategory: {},
      accommodationType: {},
      // Tier 3: Nice-to-have fields
      supervisingProvider: {},
      supervisingNpi: {},
      planType: {},
      studyType: {},
      // patientNames removed - HIPAA compliance, never store patient PHI
      metadata: {
        totalCorrections: 0,
        lastUpdated: null,
        hipaaCompliant: true
      }
    };
  }

  saveCorrections() {
    try {
      const dir = path.dirname(CORRECTIONS_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(CORRECTIONS_FILE, JSON.stringify(this.corrections, null, 2));
    } catch (err) {
      console.error('Failed to save corrections DB:', err.message);
    }
  }

  /**
   * Reload corrections from disk. Useful in development to pick up manual edits
   * to backend/data/corrections.json without restarting the server.
   */
  reload() {
    try {
      this.corrections = this.loadCorrections();
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Record a user correction
   * @param {string} type - Correction type: 'provider', 'npi', 'phone', 'fax', 'carrier', 'cpt', 'icd', 'facility',
   *                        'procedureDescription', 'practiceName', 'referringProvider', 'diagnosisDescription',
   *                        'providerNotes', 'safetyCategory', 'accommodationType', 'supervisingProvider', 'planType', 'studyType'
   *                        NOTE: 'patient' type is blocked per HIPAA
   * @param {string} ocrText - The text extracted by OCR
   * @param {string} correctedText - The user's correction
   * @param {object} metadata - Additional context (documentId, confidence, etc.)
   */
  recordCorrection(type, ocrText, correctedText, metadata = {}) {
    if (!ocrText || !correctedText || ocrText === correctedText) return;

    // HIPAA COMPLIANCE: Block patient data and member IDs
    if (type === 'patient' || type === 'memberId' || type === 'patientName' || type === 'dob') {
      console.warn(`HIPAA: ${type} correction blocked from storage (PHI)`);
      return;
    }

    // Map type to field name
    const fieldMap = {
      'provider': 'providerNames',
      'npi': 'npi',
      'phone': 'phone',
      'fax': 'fax',
      'carrier': 'carrier',
      'cpt': 'cpt',
      'icd': 'icd',
      'facility': 'facilities',
      // Tier 1: High-value fields
      'procedureDescription': 'procedureDescription',
      'practiceName': 'practiceName',
      'referringProvider': 'referringProvider',
      'referringNpi': 'referringNpi',
      'referringPhone': 'referringPhone',
      'referringFax': 'referringFax',
      'diagnosisDescription': 'diagnosisDescription',
      // Tier 2: Quality-of-life
      'providerNotes': 'providerNotes',
      'safetyCategory': 'safetyCategory',
      'accommodationType': 'accommodationType',
      // Tier 3: Nice-to-have
      'supervisingProvider': 'supervisingProvider',
      'supervisingNpi': 'supervisingNpi',
      'planType': 'planType',
      'studyType': 'studyType'
    };

    const field = fieldMap[type];
    if (!field) {
      console.warn(`Unknown correction type: ${type}`);
      return;
    }

    // Initialize field if it doesn't exist (for backwards compatibility)
    if (!this.corrections[field]) {
      this.corrections[field] = {};
    }

    const key = this.normalizeKey(ocrText);

    if (!this.corrections[field][key]) {
      this.corrections[field][key] = {
        ocrText,
        corrections: [],
        confidence: 0,
        count: 0
      };
    }

    const entry = this.corrections[field][key];
    
    // Find if this correction already exists
    const existing = entry.corrections.find(c => c.text === correctedText);
    if (existing) {
      existing.count++;
      existing.lastSeen = new Date().toISOString();
    } else {
      entry.corrections.push({
        text: correctedText,
        count: 1,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        metadata
      });
    }

    entry.count++;
    
    // Calculate confidence (most frequent correction wins)
    const maxCount = Math.max(...entry.corrections.map(c => c.count));
    entry.confidence = maxCount / entry.count;

    this.corrections.metadata.totalCorrections++;
    this.corrections.metadata.lastUpdated = new Date().toISOString();

    this.saveCorrections();
  }

  /**
   * Get the best correction for OCR text
   * @param {string} type - Correction type: 'provider', 'npi', 'phone', 'fax', 'carrier', 'cpt', 'icd', 'facility',
   *                        and all Tier 1-3 types
   *                        NOTE: 'patient' type returns null per HIPAA
   * @param {string} ocrText - The text extracted by OCR
   * @returns {object|null} - {text, confidence} or null
   */
  getCorrection(type, ocrText) {
    if (!ocrText) return null;

    // HIPAA COMPLIANCE: Block patient data
    if (type === 'patient' || type === 'memberId' || type === 'patientName' || type === 'dob') {
      return null;
    }

    // Map type to field name
    const fieldMap = {
      'provider': 'providerNames',
      'npi': 'npi',
      'phone': 'phone',
      'fax': 'fax',
      'carrier': 'carrier',
      'cpt': 'cpt',
      'icd': 'icd',
      'facility': 'facilities',
      // Tier 1-3 types
      'procedureDescription': 'procedureDescription',
      'practiceName': 'practiceName',
      'referringProvider': 'referringProvider',
      'referringNpi': 'referringNpi',
      'referringPhone': 'referringPhone',
      'referringFax': 'referringFax',
      'diagnosisDescription': 'diagnosisDescription',
      'providerNotes': 'providerNotes',
      'safetyCategory': 'safetyCategory',
      'accommodationType': 'accommodationType',
      'supervisingProvider': 'supervisingProvider',
      'supervisingNpi': 'supervisingNpi',
      'planType': 'planType',
      'studyType': 'studyType'
    };

    const field = fieldMap[type];
    if (!field || !this.corrections[field]) return null;

    const key = this.normalizeKey(ocrText);
    const entry = this.corrections[field][key];
    if (!entry || !entry.corrections.length) return null;

    // Return the most frequent correction
    const best = entry.corrections.reduce((a, b) => a.count > b.count ? a : b);
    
    return {
      text: best.text,
      confidence: entry.confidence,
      source: 'user_corrections'
    };
  }

  /**
   * Get detailed correction stats for gating logic
   * @param {string} type
   * @param {string} ocrText
   * @returns {object|null} - { text, confidence, totalCount, topCount, source }
   */
  getCorrectionDetail(type, ocrText) {
    if (!ocrText) return null;

    // HIPAA COMPLIANCE: Block patient data
    if (type === 'patient' || type === 'memberId' || type === 'patientName' || type === 'dob') {
      return null;
    }

    const fieldMap = {
      'provider': 'providerNames',
      'npi': 'npi',
      'phone': 'phone',
      'fax': 'fax',
      'carrier': 'carrier',
      'cpt': 'cpt',
      'icd': 'icd',
      'facility': 'facilities',
      // Tier 1-3 types
      'procedureDescription': 'procedureDescription',
      'practiceName': 'practiceName',
      'referringProvider': 'referringProvider',
      'referringNpi': 'referringNpi',
      'referringPhone': 'referringPhone',
      'referringFax': 'referringFax',
      'diagnosisDescription': 'diagnosisDescription',
      'providerNotes': 'providerNotes',
      'safetyCategory': 'safetyCategory',
      'accommodationType': 'accommodationType',
      'supervisingProvider': 'supervisingProvider',
      'supervisingNpi': 'supervisingNpi',
      'planType': 'planType',
      'studyType': 'studyType'
    };

    const field = fieldMap[type];
    if (!field || !this.corrections[field]) return null;

    const key = this.normalizeKey(ocrText);
    const entry = this.corrections[field][key];
    if (!entry || !entry.corrections.length) return null;

    const best = entry.corrections.reduce((a, b) => a.count > b.count ? a : b);
    const topCount = best.count || 0;
    const totalCount = entry.count || topCount;
    return {
      text: best.text,
      confidence: entry.confidence,
      totalCount,
      topCount,
      source: 'user_corrections'
    };
  }

  /**
   * Fuzzy match OCR text against corrections database
   * @param {string} type - Correction type: 'provider', 'npi', 'phone', 'fax', 'carrier', 'cpt', 'icd', 'facility',
   *                        and all Tier 1-3 types
   *                        NOTE: 'patient' type returns null per HIPAA
   * @param {string} ocrText - The text extracted by OCR
   * @param {number} threshold - Similarity threshold (0-1)
   * @returns {object|null} - {text, confidence, similarity} or null
   */
  fuzzyMatch(type, ocrText, threshold = 0.8) {
    if (!ocrText) return null;

    // HIPAA COMPLIANCE: Block patient data
    if (type === 'patient' || type === 'memberId' || type === 'patientName' || type === 'dob') {
      return null;
    }

    // Map type to field name
    const fieldMap = {
      'provider': 'providerNames',
      'npi': 'npi',
      'phone': 'phone',
      'fax': 'fax',
      'carrier': 'carrier',
      'cpt': 'cpt',
      'icd': 'icd',
      'facility': 'facilities',
      // Tier 1-3 types
      'procedureDescription': 'procedureDescription',
      'practiceName': 'practiceName',
      'referringProvider': 'referringProvider',
      'referringNpi': 'referringNpi',
      'referringPhone': 'referringPhone',
      'referringFax': 'referringFax',
      'diagnosisDescription': 'diagnosisDescription',
      'providerNotes': 'providerNotes',
      'safetyCategory': 'safetyCategory',
      'accommodationType': 'accommodationType',
      'supervisingProvider': 'supervisingProvider',
      'supervisingNpi': 'supervisingNpi',
      'planType': 'planType',
      'studyType': 'studyType'
    };

    const field = fieldMap[type];
    if (!field || !this.corrections[field]) return null;

    const entries = Object.values(this.corrections[field]);
    let bestMatch = null;
    let bestSimilarity = 0;

    for (const entry of entries) {
      const similarity = this.calculateSimilarity(ocrText, entry.ocrText);
      if (similarity > bestSimilarity && similarity >= threshold) {
        bestSimilarity = similarity;
        const best = entry.corrections.reduce((a, b) => a.count > b.count ? a : b);
        bestMatch = {
          text: best.text,
          confidence: entry.confidence,
          similarity,
          source: 'fuzzy_match'
        };
      }
    }

    return bestMatch;
  }

  /**
   * Calculate Levenshtein distance similarity
   */
  calculateSimilarity(str1, str2) {
    const s1 = this.normalizeKey(str1);
    const s2 = this.normalizeKey(str2);
    
    const len1 = s1.length;
    const len2 = s2.length;
    const maxLen = Math.max(len1, len2);
    
    if (maxLen === 0) return 1.0;
    
    const distance = this.levenshteinDistance(s1, s2);
    return 1 - (distance / maxLen);
  }

  levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
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
    
    return matrix[str2.length][str1.length];
  }

  normalizeKey(text) {
    return text.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /**
   * Get statistics about corrections
   */
  getStats() {
    return {
      totalCorrections: this.corrections.metadata.totalCorrections,
      lastUpdated: this.corrections.metadata.lastUpdated,
      providerNames: Object.keys(this.corrections.providerNames || {}).length,
      npi: Object.keys(this.corrections.npi || {}).length,
      phone: Object.keys(this.corrections.phone || {}).length,
      fax: Object.keys(this.corrections.fax || {}).length,
      carrier: Object.keys(this.corrections.carrier || {}).length,
      cpt: Object.keys(this.corrections.cpt || {}).length,
      icd: Object.keys(this.corrections.icd || {}).length,
      facilities: Object.keys(this.corrections.facilities || {}).length,
      // Tier 1
      procedureDescription: Object.keys(this.corrections.procedureDescription || {}).length,
      practiceName: Object.keys(this.corrections.practiceName || {}).length,
      referringProvider: Object.keys(this.corrections.referringProvider || {}).length,
      referringNpi: Object.keys(this.corrections.referringNpi || {}).length,
      referringPhone: Object.keys(this.corrections.referringPhone || {}).length,
      referringFax: Object.keys(this.corrections.referringFax || {}).length,
      diagnosisDescription: Object.keys(this.corrections.diagnosisDescription || {}).length,
      // Tier 2
      providerNotes: Object.keys(this.corrections.providerNotes || {}).length,
      safetyCategory: Object.keys(this.corrections.safetyCategory || {}).length,
      accommodationType: Object.keys(this.corrections.accommodationType || {}).length,
      // Tier 3
      supervisingProvider: Object.keys(this.corrections.supervisingProvider || {}).length,
      supervisingNpi: Object.keys(this.corrections.supervisingNpi || {}).length,
      planType: Object.keys(this.corrections.planType || {}).length,
      studyType: Object.keys(this.corrections.studyType || {}).length,
      hipaaCompliant: true // Never stores patient PHI
    };
  }
}

// Singleton instance
const correctionsDB = new CorrectionsDB();

export default correctionsDB;
