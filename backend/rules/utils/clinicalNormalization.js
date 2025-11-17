/**
 * Clinical Notes Normalization Utilities
 * 
 * Cleans and deduplicates history notes, clinical notes, and medication lists
 * to improve flag detection accuracy and reduce OCR noise.
 */

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1, str2) {
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

/**
 * Calculate similarity ratio between two strings (0-1)
 */
function calculateSimilarity(str1, str2) {
  const maxLen = Math.max(str1.length, str2.length);
  if (maxLen === 0) return 1.0;
  
  const distance = levenshteinDistance(str1, str2);
  return 1 - (distance / maxLen);
}

/**
 * Normalize a single line: trim, clean punctuation
 */
function normalizeLine(line) {
  let normalized = String(line || '').trim();
  
  // Remove leading/trailing punctuation
  normalized = normalized.replace(/^[;:,.\-\s)]+/, '');
  normalized = normalized.replace(/[;:,.\-\s(]+$/, '');
  
  // Fix broken punctuation patterns
  normalized = normalized.replace(/;\s*\)/g, '.');
  normalized = normalized.replace(/\(\s*[;:,]/g, '(');
  normalized = normalized.replace(/[;:,]\s*\)/g, ')');
  
  // Normalize multiple spaces
  normalized = normalized.replace(/\s+/g, ' ');
  
  return normalized.trim();
}

/**
 * Check if a line is likely a footer/boilerplate (staff name, page numbers, etc.)
 */
function isFooterBoilerplate(line) {
  const trimmed = line.trim();
  
  // Very short lines that are just names
  if (trimmed.length < 25 && /^[A-Z][a-z]+\s+[A-Z][a-z]+$/.test(trimmed)) {
    return true;
  }
  
  // Page numbers
  if (/^page\s+\d+\s*of\s*\d+$/i.test(trimmed)) {
    return true;
  }
  
  // Common footer patterns
  if (/^confidential|^printed\s+on|^generated\s+on/i.test(trimmed)) {
    return true;
  }
  
  return false;
}

/**
 * Deduplicate near-identical lines in an array
 * Keeps the longest/most informative version when duplicates are found
 * 
 * @param {string[]} lines - Array of text lines
 * @param {number} similarityThreshold - Similarity threshold (0-1), default 0.85
 * @returns {string[]} - Deduplicated array
 */
export function deduplicateLines(lines, similarityThreshold = 0.85) {
  if (!Array.isArray(lines) || lines.length === 0) return [];
  
  const normalized = lines.map(normalizeLine).filter(l => l.length > 0);
  const kept = [];
  const seen = new Set();
  
  for (const line of normalized) {
    // Skip footer boilerplate
    if (isFooterBoilerplate(line)) continue;
    
    // Check if this line is too similar to anything we've already kept
    let isDuplicate = false;
    for (const existing of kept) {
      const similarity = calculateSimilarity(line.toLowerCase(), existing.toLowerCase());
      if (similarity >= similarityThreshold) {
        isDuplicate = true;
        // If new line is longer and more informative, replace the existing one
        if (line.length > existing.length) {
          const idx = kept.indexOf(existing);
          kept[idx] = line;
        }
        break;
      }
    }
    
    if (!isDuplicate && !seen.has(line.toLowerCase())) {
      kept.push(line);
      seen.add(line.toLowerCase());
    }
  }
  
  return kept;
}

/**
 * Normalize history notes array
 * Removes duplicates, cleans OCR artifacts, removes footer noise
 */
export function normalizeHistoryNotes(historyNotes) {
  if (!Array.isArray(historyNotes)) return [];
  
  // First pass: basic normalization
  const cleaned = historyNotes
    .map(normalizeLine)
    .filter(line => line.length >= 10); // Remove very short fragments
  
  // Second pass: deduplicate
  return deduplicateLines(cleaned);
}

/**
 * Check if any line in the array mentions history of falls
 * @returns {{ found: boolean, phrase?: string }}
 */
export function hasHistoryOfFalls(notes) {
  if (!Array.isArray(notes)) return { found: false };
  
  const fallPatterns = [
    /history\s+of\s+fall(?:s|ing)/i,
    /\b(?:multiple|several|frequent|six|6|many)\s+falls?\b/i,
    /fall(?:s|ing)\s+(?:history|risk)/i,
    /(?:recurrent|repeated)\s+fall(?:s|ing)/i
  ];
  
  for (const note of notes) {
    const text = String(note || '').toLowerCase();
    for (const pattern of fallPatterns) {
      if (pattern.test(text)) {
        // Extract the matching phrase for trace
        const match = String(note).match(new RegExp(pattern.source, 'i'));
        return { found: true, phrase: match ? match[0] : text.slice(0, 50) };
      }
    }
  }
  
  return { found: false };
}

/**
 * Check if medication list contains opioids
 * @param {string[]} meds - Array of medication strings
 * @returns {{ found: boolean, name?: string }}
 */
export function hasOpioidMed(meds) {
  if (!Array.isArray(meds)) return { found: false };
  
  const opioids = [
    'oxycodone', 'hydrocodone', 'morphine', 'fentanyl', 'tramadol',
    'codeine', 'oxycontin', 'vicodin', 'percocet', 'norco',
    'dilaudid', 'hydromorphone', 'methadone', 'buprenorphine'
  ];
  
  for (const med of meds) {
    const medLower = String(med || '').toLowerCase();
    for (const opioid of opioids) {
      if (medLower.includes(opioid)) {
        return { found: true, name: opioid };
      }
    }
  }
  
  return { found: false };
}

/**
 * Check if notes mention oxygen use or caretaker
 * @param {string[]} notes - Array of note strings
 * @returns {{ found: boolean, term?: string }}
 */
export function hasOxygenOrCaretaker(notes) {
  if (!Array.isArray(notes)) return { found: false };
  
  const patterns = [
    { term: 'oxygen', re: /\b(?:oxygen|o2)\s*(?:use|dependent|therapy|required)/i },
    { term: 'caretaker', re: /\b(?:caretaker|caregiver|guardian|home\s+health\s+aide)/i }
  ];
  
  for (const note of notes) {
    const text = String(note || '');
    for (const { term, re } of patterns) {
      if (re.test(text)) {
        return { found: true, term };
      }
    }
  }
  
  return { found: false };
}

/**
 * Check if description contains pediatric indicators
 * @param {string} description - Procedure description text
 * @returns {boolean}
 */
export function isPediatricDescription(description) {
  if (!description) return false;
  return /\bpediatric\b/i.test(description);
}

/**
 * Check for prior study CPT codes or keywords in text
 * @param {string} fullText - Full document text
 * @param {string[]} allDetectedCpts - Array of all detected CPT codes
 * @returns {{ found: boolean, cpts?: string[], keywords?: string[] }}
 */
export function hasPriorStudyEvidence(fullText, allDetectedCpts = []) {
  const priorStudyCpts = ['95806', '95810', 'G0399'];
  const foundCpts = allDetectedCpts.filter(cpt => priorStudyCpts.includes(String(cpt)));
  
  const priorStudyKeywords = [
    /home\s+sleep\s+(?:apnea\s+)?test/i,
    /\bhsat\b/i,
    /prior\s+(?:sleep\s+)?study/i,
    /previous\s+(?:sleep\s+)?study/i,
    /baseline\s+(?:sleep\s+)?study/i,
    /diagnostic\s+(?:sleep\s+)?study/i
  ];
  
  const foundKeywords = [];
  const text = String(fullText || '');
  for (const pattern of priorStudyKeywords) {
    if (pattern.test(text)) {
      const match = text.match(pattern);
      if (match) foundKeywords.push(match[0]);
    }
  }
  
  return {
    found: foundCpts.length > 0 || foundKeywords.length > 0,
    cpts: foundCpts,
    keywords: foundKeywords
  };
}

/**
 * Check for CPAP/titration failure/intolerance keywords
 * @param {string} fullText - Full document text
 * @returns {boolean}
 */
export function hasCpapTitrationContext(fullText) {
  const patterns = [
    /\bcpap\b/i,
    /\btitration\b/i,
    /intoleran(?:t|ce)/i,
    /non[- ]complian(?:t|ce)/i,
    /failure\s+(?:of|to)/i,
    /unable\s+to\s+tolerate/i
  ];
  
  const text = String(fullText || '');
  return patterns.some(pattern => pattern.test(text));
}
