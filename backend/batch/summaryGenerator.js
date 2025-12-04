/**
 * Batch Summary Generator
 * 
 * Collects batch processing data and generates AI-powered summaries using Ollama.
 * Completely isolated from existing document processing - reads from processed records only.
 */

import fs from 'fs/promises';
import path from 'path';
import { log } from '../logging/logger.js';
import { getAnalysisPrompt, ANALYSIS_TYPES } from './analysisPrompts.js';

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:latest';
const PROCESSED_PATH = path.join(process.cwd(), 'data', 'processed.json');
const SUMMARIES_PATH = path.join(process.cwd(), 'data', 'batch-summaries.json');
const RESULTS_DIR = path.join(process.cwd(), 'data', 'results');

/**
 * Load processed records from disk
 */
async function loadProcessedRecords() {
  try {
    const raw = await fs.readFile(PROCESSED_PATH, 'utf8');
    const records = JSON.parse(raw);
    return Array.isArray(records) ? records : [];
  } catch (e) {
    log('warn', 'batch_summary_load_failed', { error: String(e.message) });
    return [];
  }
}

/**
 * Load saved batch summaries
 */
async function loadBatchSummaries() {
  try {
    const raw = await fs.readFile(SUMMARIES_PATH, 'utf8');
    const summaries = JSON.parse(raw);
    return Array.isArray(summaries) ? summaries : [];
  } catch (e) {
    return []; // File doesn't exist yet or parse error
  }
}

/**
 * Save batch summaries to disk
 */
async function saveBatchSummaries(summaries) {
  try {
    await fs.mkdir(path.dirname(SUMMARIES_PATH), { recursive: true });
    await fs.writeFile(SUMMARIES_PATH, JSON.stringify(summaries, null, 2), 'utf8');
  } catch (e) {
    log('error', 'batch_summary_save_failed', { error: String(e.message) });
    throw e;
  }
}

/**
 * Group processed records into batches by upload time window
 * Documents uploaded within 5 minutes of each other are considered same batch
 */
function groupIntoBatches(records) {
  if (!records.length) return [];

  // Sort by timestamp
  const sorted = [...records].sort((a, b) => 
    new Date(a.timestamp || 0) - new Date(b.timestamp || 0)
  );

  const batches = [];
  let currentBatch = [];
  let lastTimestamp = null;
  const BATCH_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

  for (const record of sorted) {
    const timestamp = new Date(record.timestamp || 0);
    
    if (!lastTimestamp || (timestamp - lastTimestamp) <= BATCH_WINDOW_MS) {
      currentBatch.push(record);
      lastTimestamp = timestamp;
    } else {
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
      }
      currentBatch = [record];
      lastTimestamp = timestamp;
    }
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches.reverse(); // Newest first
}

/**
 * Extract structured data from a batch of documents
 */
function extractBatchData(batchRecords) {
  const documents = [];
  let totalPages = 0;
  let totalProblems = 0;
  let parseFailures = 0;
  let noProblemsCount = 0;
  const conditionFrequency = {};
  const cptCodes = {};
  
  for (const record of batchRecords) {
    const result = record.result || {};
    const documentMeta = result.documentMeta || {};
    const clinical = result.clinical || {};
    const problemsList = clinical.problemsList || [];
    const pages = documentMeta.pages || 0;
    const actions = (result.alerts?.actions || []).length;
    
    totalPages += pages;
    
    // Extract problems
    const problems = [];
    if (Array.isArray(problemsList) && problemsList.length > 0) {
      for (const problem of problemsList) {
        if (typeof problem === 'string' && problem.trim()) {
          problems.push(problem.trim());
          totalProblems++;
          
          // Count frequency
          const normalized = problem.trim().toLowerCase();
          conditionFrequency[normalized] = (conditionFrequency[normalized] || 0) + 1;
        }
      }
    }
    
    if (problems.length === 0) {
      noProblemsCount++;
    }
    
    // Extract CPT codes from procedure
    const procedure = result.procedure || {};
    const cptCode = procedure.code || procedure.cptCode || 'unknown';
    cptCodes[cptCode] = (cptCodes[cptCode] || 0) + 1;
    
    // Check for errors/warnings
    const warnings = [];
    const trace = result.trace || {};
    if (trace.llmParseErrors && trace.llmParseErrors > 0) {
      parseFailures++;
      warnings.push(`${trace.llmParseErrors} LLM parse failures`);
    }
    if (trace.ollamaErrors && trace.ollamaErrors > 0) {
      warnings.push(`${trace.ollamaErrors} Ollama errors`);
    }
    
    // Validation info
    const qc = result.qc || {};
    const validation = {
      passed: 0,
      total: 5,
      missing: []
    };
    
    // Simple validation checks
    const patient = result.patient || {};
    const insurance = result.insurance || {};
    const provider = result.provider || {};
    
    if (patient.first && patient.last) validation.passed++;
    else validation.missing.push('patient name');
    
    if (patient.dob) validation.passed++;
    else validation.missing.push('DOB');
    
    if (insurance.carrier) validation.passed++;
    else validation.missing.push('insurance');
    
    if (provider.name) validation.passed++;
    else validation.missing.push('provider');
    
    if (clinical.primaryDiagnosis) validation.passed++;
    else validation.missing.push('diagnosis');
    
    documents.push({
      id: record.id,
      filename: result.displayFilename || record.filename || record.id,
      patient: {
        name: patient.first && patient.last ? `${patient.last}, ${patient.first}` : 'Unknown',
        dob: patient.dob || null
      },
      pages,
      cptCode,
      problems: {
        count: problems.length,
        list: problems
      },
      actions,
      warnings,
      validation,
      processingTime: trace.totalDuration || null,
      timestamp: record.timestamp
    });
  }
  
  // Calculate aggregate stats
  const avgPagesPerDoc = batchRecords.length > 0 ? (totalPages / batchRecords.length).toFixed(1) : 0;
  const avgProblemsPerDoc = batchRecords.length > 0 ? (totalProblems / batchRecords.length).toFixed(1) : 0;
  const extractionSuccessRate = batchRecords.length > 0 ? 
    ((batchRecords.length - noProblemsCount) / batchRecords.length) : 0;
  
  // Sort conditions by frequency
  const topConditions = Object.entries(conditionFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([condition, count]) => ({
      condition,
      count,
      percentage: ((count / batchRecords.length) * 100).toFixed(1)
    }));
  
  return {
    summary: {
      totalDocuments: batchRecords.length,
      totalPages,
      totalProblems,
      parseFailures,
      noProblemsCount,
      avgPagesPerDoc: parseFloat(avgPagesPerDoc),
      avgProblemsPerDoc: parseFloat(avgProblemsPerDoc),
      extractionSuccessRate: parseFloat((extractionSuccessRate * 100).toFixed(1))
    },
    documents,
    aggregateStats: {
      conditionFrequency: topConditions,
      cptDistribution: cptCodes
    },
    issues: [
      ...(parseFailures > 0 ? [{
        type: 'parse_failure',
        count: parseFailures,
        message: 'LLM JSON parsing errors detected'
      }] : []),
      ...(noProblemsCount > 0 ? [{
        type: 'no_problems_extracted',
        count: noProblemsCount,
        documents: documents.filter(d => d.problems.count === 0).map(d => d.filename),
        message: 'Documents with zero problems extracted'
      }] : [])
    ]
  };
}

/**
 * Call Ollama to generate AI summary
 */
async function generateAISummary(batchData, analysisType = 'executive') {
  try {
    const prompt = getAnalysisPrompt(analysisType, batchData);
    
    // Handle both batch data and document data
    const documentCount = batchData.summary?.totalDocuments || (batchData.docId ? 1 : 0);
    
    log('info', 'batch_summary_ollama_start', { analysisType, documents: documentCount });
    
    const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: {
          temperature: 0.3, // Lower temperature for more consistent analysis
          num_predict: 2048  // Allow longer responses
        }
      })
    });
    
    if (!response.ok) {
      throw new Error(`Ollama returned ${response.status}`);
    }
    
    const data = await response.json();
    const summary = data.response || '';
    
    log('info', 'batch_summary_ollama_complete', { 
      analysisType, 
      summaryLength: summary.length,
      model: OLLAMA_MODEL
    });
    
    return summary;
    
  } catch (error) {
    log('error', 'batch_summary_ollama_failed', { 
      error: String(error.message),
      analysisType
    });
    throw error;
  }
}

/**
 * Generate batch summary
 * @param {Array} batchRecords - Array of processed document records
 * @param {string} analysisType - Type of analysis (executive, technical, clinical, quick)
 * @returns {Object} - { rawData, aiSummary, metadata }
 */
export async function generateBatchSummary(batchRecords, analysisType = 'executive') {
  if (!batchRecords || batchRecords.length === 0) {
    throw new Error('No documents in batch');
  }
  
  // Extract structured data
  const batchData = extractBatchData(batchRecords);
  
  // Generate AI summary
  const aiSummary = await generateAISummary(batchData, analysisType);
  
  // Create full result
  const result = {
    batchId: `batch_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    createdAt: new Date().toISOString(),
    analysisType,
    model: OLLAMA_MODEL,
    rawData: batchData,
    aiSummary,
    metadata: {
      documentCount: batchRecords.length,
      firstDocument: batchRecords[0]?.timestamp,
      lastDocument: batchRecords[batchRecords.length - 1]?.timestamp
    }
  };
  
  // Save to disk
  const summaries = await loadBatchSummaries();
  summaries.unshift(result); // Add to beginning (newest first)
  
  // Keep only last 50 summaries
  if (summaries.length > 50) {
    summaries.length = 50;
  }
  
  await saveBatchSummaries(summaries);
  
  log('info', 'batch_summary_generated', {
    batchId: result.batchId,
    analysisType,
    documentCount: batchRecords.length
  });
  
  return result;
}

/**
 * List recent batches available for analysis
 */
export async function listRecentBatches() {
  const records = await loadProcessedRecords();
  const batches = groupIntoBatches(records);
  const savedSummaries = await loadBatchSummaries();
  
  // Create batch info with analysis status
  return batches.map((batchRecords, index) => {
    const firstDoc = batchRecords[0];
    const lastDoc = batchRecords[batchRecords.length - 1];
    const totalPages = batchRecords.reduce((sum, r) => sum + (r.result?.documentMeta?.pages || 0), 0);
    
    // Check if this batch has been analyzed
    const batchTimestamp = new Date(firstDoc.timestamp || 0).getTime();
    const analysis = savedSummaries.find(s => {
      const analysisTime = new Date(s.metadata?.firstDocument || 0).getTime();
      return Math.abs(analysisTime - batchTimestamp) < 60000; // Within 1 minute
    });
    
    return {
      batchIndex: index,
      documentCount: batchRecords.length,
      totalPages,
      timestamp: firstDoc.timestamp,
      dateLabel: new Date(firstDoc.timestamp || 0).toLocaleDateString(),
      timeLabel: new Date(firstDoc.timestamp || 0).toLocaleTimeString(),
      hasAnalysis: !!analysis,
      analysisId: analysis?.batchId || null,
      documents: batchRecords.map(r => ({
        id: r.id,
        filename: r.result?.displayFilename || r.filename || r.id
      }))
    };
  });
}

/**
 * Get saved batch summary by ID
 */
export async function getSavedSummary(batchId) {
  const summaries = await loadBatchSummaries();
  return summaries.find(s => s.batchId === batchId);
}

/**
 * Analyze a single document
 * @param {string} docId - Document ID to analyze
 * @returns {Object} - { docId, rawData, aiSummary, metadata }
 */
export async function analyzeDocument(docId) {
  // Load all processed records
  const records = await loadProcessedRecords();
  
  // Find the specific document
  const docRecord = records.find(r => r.id === docId);
  
  if (!docRecord) {
    throw new Error(`Document ${docId} not found`);
  }
  
  // Try to load full result from data/results/ directory first
  let result = docRecord.result || {};
  try {
    const resultFilePath = path.join(RESULTS_DIR, `${docId}.json`);
    const resultData = await fs.readFile(resultFilePath, 'utf8');
    result = JSON.parse(resultData);
  } catch (e) {
    // If no result file exists, use whatever is in docRecord
    log('warn', 'document_result_file_not_found', { docId, usingDocRecord: true });
  }
  
  const documentMeta = result.documentMeta || {};
  const clinical = result.clinical || {};
  const problemsList = clinical.problemsList || [];
  const alerts = result.alerts || {};
  const actions = (alerts.actions || []).length;
  const warnings = (alerts.warnings || []).length;
  const validation = result.validation || {};
  const trace = result.trace || {};
  
  // Determine document status
  let status = 'success';
  let statusDetails = [];
  
  if (alerts.parseError || alerts.extractionError) {
    status = 'error';
    statusDetails.push('Parse/extraction error detected');
  }
  
  if (problemsList.length === 0) {
    if (status !== 'error') status = 'warning';
    statusDetails.push('No clinical problems extracted');
  }
  
  if (actions > 0) {
    if (status !== 'error') status = 'warning';
    statusDetails.push(`${actions} action(s) required`);
  }
  
  if (warnings > 0) {
    if (status === 'success') status = 'warning';
    statusDetails.push(`${warnings} warning(s)`);
  }
  
  // Extract problems
  const problems = problemsList.map(p => ({
    code: p.code || 'N/A',
    description: p.description || p.problem || 'No description',
    confidence: p.confidence || null
  }));
  
  // Get routing and validation details
  const routing = result.routing || {};
  const validationSteps = routing.validationSteps || [];
  const dualEngine = result.dualEngine || {};
  
  // Extract comprehensive data from the result
  const extracted = {
    patient: result.patient || {},
    insurance: result.insurance || {},
    procedure: result.procedure || clinical,
    provider: result.provider || {}
  };
  
  // Structure document data for AI analysis - INCLUDE ALL DEBUG DATA
  const documentData = {
    docId,
    filename: result.displayFilename || docRecord.displayFilename || docRecord.suggestedFilename || docRecord.filename || docId,
    status,
    statusDetails,
    pages: documentMeta.pages || docRecord.pages || 0,
    processingTime: trace.totalDuration || null,
    timestamp: docRecord.processedAt || docRecord.timestamp,
    
    // Core extraction data
    extraction: {
      problemsExtracted: problems.length,
      problems,
      cptCode: clinical.cptCode || result.procedure?.cptCode || result.procedure?.code || null,
      hasPatientInfo: !!(result.patient?.name || result.patient?.dob),
      hasProviderInfo: !!(result.provider?.name || result.provider?.npi),
      hasInsuranceInfo: !!(result.insurance?.carrier || result.insurance?.primary)
    },
    
    // Extracted structured fields
    extracted,
    
    // Alerts and errors
    alerts: {
      actions: alerts.actions || [],
      warnings: alerts.warnings || [],
      parseError: alerts.parseError || null,
      extractionError: alerts.extractionError || null
    },
    
    // Validation details
    validation: {
      passed: validation.passed || false,
      errors: validation.errors || [],
      warnings: validation.warnings || [],
      steps: validationSteps // Include detailed validation steps
    },
    
    // OCR and processing trace
    trace: {
      ocrConfidence: trace.ocrConfidence || null,
      llmUsed: trace.llmUsed || false,
      retryCount: trace.retryCount || 0,
      totalDuration: trace.totalDuration || null
    },
    
    // Routing information
    routing: {
      action: routing.action || null,
      route: routing.route || null,
      priority: routing.priority || null,
      description: routing.description || null,
      dataQuality: routing.dataQuality || null,
      validationSummary: routing.validationSummary || null
    },
    
    // Dual engine metrics
    dualEngine: {
      enabled: dualEngine.enabled || false,
      llmBackend: dualEngine.llmBackend || null,
      pagesProcessed: dualEngine.pagesProcessed || 0,
      conflicts: dualEngine.conflicts || [],
      dataQuality: dualEngine.dataQuality || null
    }
  };
  
  // Generate AI analysis using document-specific prompt
  log('info', 'document_analysis_start', { docId, status });
  
  const aiSummary = await generateAISummary(documentData, 'document');
  
  const analysisResult = {
    analysisId: `doc_analysis_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    createdAt: new Date().toISOString(),
    docId,
    filename: documentData.filename,
    status,
    model: OLLAMA_MODEL,
    rawData: documentData,
    aiSummary,
    metadata: {
      processedAt: docRecord.timestamp,
      analyzedAt: new Date().toISOString()
    }
  };
  
  log('info', 'document_analysis_complete', { 
    docId, 
    status,
    summaryLength: aiSummary.length 
  });
  
  return analysisResult;
}

/**
 * List all processed documents with status
 */
export async function listAllDocuments() {
  const records = await loadProcessedRecords();
  
  return records.map(record => {
    // New structure: fields at root level
    const problemsList = record.problems || [];
    const actions = record.actions || [];
    const warnings = record.warnings || [];
    
    // Determine status
    let status = 'success';
    if (record.parseError || record.extractionError) {
      status = 'error';
    } else if (problemsList.length === 0 || actions.length > 0) {
      status = 'warning';
    }
    
    return {
      id: record.id,
      filename: record.displayFilename || record.suggestedFilename || record.id,
      status,
      pages: record.pages || 0,
      problemsCount: problemsList.length,
      actionsCount: actions.length,
      warningsCount: warnings.length,
      timestamp: record.processedAt || record.timestamp,
      dateLabel: new Date(record.processedAt || record.timestamp || 0).toLocaleDateString(),
      timeLabel: new Date(record.processedAt || record.timestamp || 0).toLocaleTimeString()
    };
  }).reverse(); // Newest first
}

/**
 * Get available analysis types
 */
export function getAnalysisTypes() {
  return ANALYSIS_TYPES;
}
