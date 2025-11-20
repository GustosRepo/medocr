/**
 * Page Selector - Intelligent page identification for multi-page medical documents
 * Analyzes OCR results to identify information-rich pages and skip cover letters/fax pages
 */

import { log } from './logging/logger.js';

/**
 * Keywords/patterns that indicate important medical information
 */
const INFORMATION_INDICATORS = {
  // Patient demographics
  patient: [
    /\bpatient\s+name\b/i,
    /\bdate\s+of\s+birth\b/i,
    /\bdob\b/i,
    /\bmrn\b/i,
    /\bmedical\s+record\b/i,
    /\bpatient\s+id\b/i,
    /\bssn\b/i,
    /\bsocial\s+security\b/i
  ],
  
  // Insurance information
  insurance: [
    /\binsurance\b/i,
    /\bpolicy\s+number\b/i,
    /\bsubscriber\b/i,
    /\bgroup\s+number\b/i,
    /\bmedicare\b/i,
    /\bmedicaid\b/i,
    /\bcarrier\b/i,
    /\bauthorization\b/i,
    /\bpayer\b/i
  ],
  
  // Clinical information
  clinical: [
    /\bdiagnos(is|es)\b/i,
    /\bicd\s*-?\s*10?\b/i,
    /\bcpt\b/i,
    /\bprocedure\b/i,
    /\bsymptoms?\b/i,
    /\btreatment\b/i,
    /\bmedications?\b/i,
    /\ballergies\b/i,
    /\bhistory\b/i,
    /\bexam\b/i,
    /\bassessment\b/i,
    /\bplan\b/i,
    /\bsleep\s+study\b/i,
    /\bpolysomnogram\b/i,
    /\bhsat\b/i,
    /\bcpap\b/i,
    /\bahi\b/i,
    /\bapnea\b/i
  ],
  
  // Provider information
  provider: [
    /\bphysician\b/i,
    /\bprovider\b/i,
    /\border(ing|ed)?\s+(physician|provider|doctor)\b/i,
    /\bnpi\b/i,
    /\bm\.?d\.?\b/i,
    /\bd\.?o\.?\b/i,
    /\bpractice\b/i,
    /\bfacility\b/i
  ]
};

/**
 * Keywords that indicate cover letters, fax pages, or low-value pages
 */
const SKIP_INDICATORS = [
  /^(cover\s+)?sheet$/i,
  /^fax\s+cover/i,
  /^confidential/i,
  /^hipaa\s+notice/i,
  /^this\s+fax/i,
  /^page\s+\d+\s+of\s+\d+$/i,
  /^transmission\s+report/i,
  /^sent\s+by/i,
  /^to:\s*$/i,
  /^from:\s*$/i,
  /^re:\s*$/i,
  /^date:\s*\d+\/\d+\/\d+\s*$/i
];

/**
 * Analyze a single page's OCR text and calculate information richness score
 * @param {string} pageText - OCR text from the page
 * @param {number} pageNumber - Page number (0-indexed)
 * @returns {Object} Analysis result with score and reasons
 */
function analyzePageContent(pageText, pageNumber) {
  const analysis = {
    pageNumber,
    score: 0,
    hasPatientInfo: false,
    hasInsurance: false,
    hasClinical: false,
    hasProvider: false,
    isSkippable: false,
    reasons: []
  };

  // Skip empty or very short pages
  if (!pageText || pageText.trim().length < 50) {
    analysis.isSkippable = true;
    analysis.reasons.push('Empty or too short');
    return analysis;
  }

  // Check for skip indicators (cover letters, fax pages)
  const firstLines = pageText.split('\n').slice(0, 10).join('\n').toLowerCase();
  for (const pattern of SKIP_INDICATORS) {
    if (pattern.test(firstLines)) {
      analysis.isSkippable = true;
      analysis.reasons.push(`Skip indicator: ${pattern.source}`);
      return analysis;
    }
  }

  // Check for patient information (high value)
  let patientMatches = 0;
  for (const pattern of INFORMATION_INDICATORS.patient) {
    if (pattern.test(pageText)) {
      patientMatches++;
    }
  }
  if (patientMatches > 0) {
    analysis.hasPatientInfo = true;
    analysis.score += patientMatches * 10;
    analysis.reasons.push(`Patient info: ${patientMatches} matches`);
  }

  // Check for insurance information (high value)
  let insuranceMatches = 0;
  for (const pattern of INFORMATION_INDICATORS.insurance) {
    if (pattern.test(pageText)) {
      insuranceMatches++;
    }
  }
  if (insuranceMatches > 0) {
    analysis.hasInsurance = true;
    analysis.score += insuranceMatches * 10;
    analysis.reasons.push(`Insurance info: ${insuranceMatches} matches`);
  }

  // Check for clinical information (critical value)
  let clinicalMatches = 0;
  for (const pattern of INFORMATION_INDICATORS.clinical) {
    if (pattern.test(pageText)) {
      clinicalMatches++;
    }
  }
  if (clinicalMatches > 0) {
    analysis.hasClinical = true;
    analysis.score += clinicalMatches * 15; // Clinical info weighted higher
    analysis.reasons.push(`Clinical info: ${clinicalMatches} matches`);
  }

  // Check for provider information (medium value)
  let providerMatches = 0;
  for (const pattern of INFORMATION_INDICATORS.provider) {
    if (pattern.test(pageText)) {
      providerMatches++;
    }
  }
  if (providerMatches > 0) {
    analysis.hasProvider = true;
    analysis.score += providerMatches * 8;
    analysis.reasons.push(`Provider info: ${providerMatches} matches`);
  }

  // Bonus for pages with multiple information types
  const infoTypes = [
    analysis.hasPatientInfo,
    analysis.hasInsurance,
    analysis.hasClinical,
    analysis.hasProvider
  ].filter(Boolean).length;
  
  if (infoTypes >= 2) {
    analysis.score += infoTypes * 5;
    analysis.reasons.push(`Multiple info types: ${infoTypes}`);
  }

  return analysis;
}

/**
 * Select the most information-rich pages from OCR results
 * @param {Object} ocrResult - OCR result with pageTexts array
 * @param {Object} options - Selection options
 * @param {number} options.maxPages - Maximum number of pages to select (default: 3)
 * @param {number} options.minScore - Minimum score threshold (default: 20)
 * @returns {Object} Selection result with page indices and analyses
 */
export function selectInformationRichPages(ocrResult, options = {}) {
  const {
    maxPages = 3,
    minScore = 20
  } = options;

  const startTime = Date.now();
  
  // Extract page texts from OCR result
  // OCR result can have different structures:
  // 1. ocrResult.pageTexts (ideal)
  // 2. ocrResult.ocr (array of page objects with .text)
  // 3. ocrResult.pages (array of page objects with .text)
  let pageTexts = null;
  
  if (ocrResult.pageTexts && Array.isArray(ocrResult.pageTexts)) {
    pageTexts = ocrResult.pageTexts;
  } else if (ocrResult.ocr && Array.isArray(ocrResult.ocr)) {
    pageTexts = ocrResult.ocr.map(page => page.text || '');
  } else if (ocrResult.pages && Array.isArray(ocrResult.pages)) {
    pageTexts = ocrResult.pages.map(page => page.text || '');
  }
  
  // Handle case where we can't extract page texts
  if (!pageTexts || pageTexts.length === 0) {
    log('warn', 'no_page_texts', { 
      reason: 'No page texts found in OCR result',
      hasOcr: !!ocrResult.ocr,
      hasPages: !!ocrResult.pages,
      hasPageTexts: !!ocrResult.pageTexts
    });
    return {
      selectedPages: [0], // Fallback to first page
      analyses: [],
      totalPages: 0,
      reason: 'No page-by-page text available'
    };
  }

  // Analyze each page
  const analyses = pageTexts.map((pageText, index) => 
    analyzePageContent(pageText, index)
  );

  // Filter out skippable pages
  const validPages = analyses.filter(a => !a.isSkippable);

  // Sort by score (highest first)
  validPages.sort((a, b) => b.score - a.score);

  // Select top pages that meet minimum score
  const selectedPages = validPages
    .filter(a => a.score >= minScore)
    .slice(0, maxPages)
    .map(a => a.pageNumber)
    .sort((a, b) => a - b); // Sort by page order for processing

  const duration = Date.now() - startTime;

  log('info', 'page_selection_complete', {
    totalPages: ocrResult.pageTexts.length,
    analyzedPages: analyses.length,
    validPages: validPages.length,
    selectedPages: selectedPages.length,
    pageIndices: selectedPages,
    duration: `${duration}ms`
  });

  // Log top page scores for debugging
  validPages.slice(0, 5).forEach(page => {
    log('debug', 'page_analysis', {
      page: page.pageNumber,
      score: page.score,
      hasPatient: page.hasPatientInfo,
      hasInsurance: page.hasInsurance,
      hasClinical: page.hasClinical,
      hasProvider: page.hasProvider,
      reasons: page.reasons
    });
  });

  return {
    selectedPages,
    analyses,
    totalPages: pageTexts.length,
    duration
  };
}

/**
 * Get a human-readable summary of page selection
 * @param {Object} selectionResult - Result from selectInformationRichPages
 * @returns {string} Summary text
 */
export function getSelectionSummary(selectionResult) {
  const { selectedPages, totalPages, analyses } = selectionResult;
  
  const selectedAnalyses = analyses.filter(a => 
    selectedPages.includes(a.pageNumber)
  );

  const infoTypes = {
    patient: selectedAnalyses.filter(a => a.hasPatientInfo).length,
    insurance: selectedAnalyses.filter(a => a.hasInsurance).length,
    clinical: selectedAnalyses.filter(a => a.hasClinical).length,
    provider: selectedAnalyses.filter(a => a.hasProvider).length
  };

  return `Selected ${selectedPages.length} of ${totalPages} pages: ` +
    `${selectedPages.map(p => p + 1).join(', ')} | ` +
    `Info types: Patient=${infoTypes.patient}, Insurance=${infoTypes.insurance}, ` +
    `Clinical=${infoTypes.clinical}, Provider=${infoTypes.provider}`;
}

export default {
  selectInformationRichPages,
  getSelectionSummary,
  analyzePageContent
};
