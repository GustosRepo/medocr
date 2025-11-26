/**
 * Dual-Engine Document Processor
 * 
 * Orchestrates parallel OCR + LLM processing with conflict resolution
 * and decision tree routing.
 * 
 * This module enhances the existing OCR processing with:
 * - Parallel execution of OCR and Vision LLM (Ollama or Python service)
 * - Intelligent conflict resolution between engines
 * - Decision tree routing based on validation results
 * - Comprehensive audit trail
 */

// Try Ollama first (simpler), fallback to Python LLM service
import { extractWithOllama, checkOllamaHealth, extractMultiplePages, validateOcrWithVision, extractNarrativeFields } from '../ollamaService.js';
import { extractWithLocalLLM, checkLLMHealth } from '../llmService.js';
import DecisionTreeEngine from '../decisionTree.js';
import { mergeExtractions, assessDataQuality, pdfToImage } from './dualEngine.js';
import { selectInformationRichPages, getSelectionSummary } from '../pageSelector.js';
import { convertPdfPagesToImages, cleanupTempImages } from './imageResizer.js';
import { performance } from 'perf_hooks';
import { log } from '../logging/logger.js';

// Auto-detect LLM backend (Ollama or Python service)
const USE_OLLAMA = process.env.OLLAMA_HOST !== undefined;
const extractWithLLM = USE_OLLAMA ? extractWithOllama : extractWithLocalLLM;
const checkHealth = USE_OLLAMA ? checkOllamaHealth : checkLLMHealth;
const USE_VALIDATION_MODE = process.env.LLM_VALIDATION_MODE !== 'false'; // New flag
const LLM_MODE = process.env.LLM_MODE || 'validate'; // 'extract' or 'validate'

const decisionTree = new DecisionTreeEngine();

// Check if LLM service is enabled
const LLM_ENABLED = process.env.ENABLE_LLM === 'true';
const LLM_TIMEOUT = parseInt(process.env.LLM_TIMEOUT || '30000', 10);

console.log(`[DualEngine] LLM_MODE=${LLM_MODE} (extract=only free-text, validate=cross-check OCR)`);

/**
 * Process document with dual-engine approach (OCR + LLM in parallel)
 * 
 * @param {Function} ocrProcessor - Function that returns OCR result
 * @param {string} filePath - Path to document file
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} Enhanced result with dual-engine data
 */
export async function processDualEngine(ocrProcessor, filePath, options = {}) {
  const t0 = performance.now();
  const { documentId, skipLLM = false } = options;
  
  // Check if LLM is available
  const useLLM = LLM_ENABLED && !skipLLM;
  
  if (!useLLM) {
    // Fallback to OCR-only processing
    log('debug', 'dual_engine_disabled', { documentId, reason: 'LLM not enabled' });
    return await ocrProcessor();
  }
  
  // Check LLM service health (Ollama or Python service)
  try {
    const healthy = await checkHealth();
    if (!healthy) {
      log('warn', 'llm_service_unhealthy', { documentId, backend: USE_OLLAMA ? 'ollama' : 'python' });
      return await ocrProcessor();
    }
  } catch (error) {
    log('warn', 'llm_health_check_failed', { documentId, error: String(error) });
    return await ocrProcessor();
  }
  
  log('info', 'dual_engine_start', { documentId, filePath });
  
  try {
    // STEP 1: Run OCR first (we need page texts for smart page selection)
    const ocrData = await ocrProcessor().catch(err => {
      log('error', 'ocr_processing_failed', { documentId, error: String(err) });
      throw err;
    });
    
    // DEBUG: Check what clinical data comes from rules engine
    log('debug', 'ocr_data_clinical_debug', {
      documentId,
      hasClinical: !!ocrData.result?.clinical,
      clinicalKeys: ocrData.result?.clinical ? Object.keys(ocrData.result.clinical).join(', ') : 'none',
      hasPrimaryDiagnosis: !!ocrData.result?.clinical?.primaryDiagnosis,
      hasSymptoms: !!ocrData.result?.clinical?.symptoms,
      hasVitals: !!ocrData.result?.clinical?.vitals,
      diagnoses: ocrData.result?.diagnoses
    });
    
    // STEP 2: Now run LLM with smart page selection based on OCR results
    const llmResult = await Promise.race([
      (async () => {
        try {
          
          // Select information-rich pages from OCR results
          const pageSelection = selectInformationRichPages(ocrData, {
            maxPages: 3,
            minScore: 20
          });
          
          log('info', 'page_selection', {
            documentId,
            summary: getSelectionSummary(pageSelection)
          });
          
          // If no pages selected, skip LLM processing
          if (pageSelection.selectedPages.length === 0) {
            log('warn', 'no_pages_selected', { documentId });
            throw new Error('No information-rich pages found');
          }
          
          // Convert selected pages to images (higher resolution for LLM readability)
          const imageResults = await convertPdfPagesToImages(
            filePath,
            pageSelection.selectedPages,
            {
              targetDPI: 200,  // Increased from 150 for better text readability
              maxWidth: 2400,  // Increased from 1600 for LLaVA vision model
              quality: 90,     // Increased from 85 for clearer text
              outputDir: 'data/temp'
            }
          );
          
          log('info', 'images_prepared', {
            documentId,
            pageCount: imageResults.length,
            totalSize: imageResults.reduce((sum, r) => sum + r.processedSize, 0),
            avgReduction: Math.round(
              imageResults.reduce((sum, r) => sum + r.reduction, 0) / imageResults.length
            )
          });
          
          // Process multiple pages with Ollama 
          const llmStartTime = performance.now();
          let result;
          let llmMetadata = null;
          
          if (USE_OLLAMA && LLM_MODE === 'validate' && USE_VALIDATION_MODE) {
            // VALIDATION MODE: Cross-check OCR (high false positive rate - not recommended)
            log('info', 'llm_validation_mode', { documentId, pageCount: imageResults.length });
            log('info', 'dual_engine_validation_start', {
              documentId,
              pages: imageResults.length,
              model: 'llava:7b',
              mode: 'validation',
              message: '🔄 STARTING VALIDATION'
            });
            
            // Validate each page's OCR results
            const validationResults = [];
            for (const imgResult of imageResults) {
              try {
                const validation = await Promise.race([
                  validateOcrWithVision(imgResult.imagePath, ocrData),
                  new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Validation timeout')), LLM_TIMEOUT / imageResults.length)
                  )
                ]);
                validationResults.push(validation);
              } catch (err) {
                log('warn', 'llm_validation_page_failed', { 
                  page: imgResult.pageIndex, 
                  error: err.message 
                });
                validationResults.push({ validation: null, error: err.message });
              }
            }
            
            // Aggregate validation results
            result = aggregateValidations(validationResults);
            llmMetadata = {
              totalPages: imageResults.length,
              successfulPages: validationResults.filter(v => v.validation).length,
              duration: performance.now() - llmStartTime,
              mode: 'validation'
            };
            
            log('debug', 'llm_validation_complete', { 
              documentId,
              validPagesprocessed: llmMetadata.successfulPages,
              totalPages: llmMetadata.totalPages,
              overallScore: result.overallConfidence || 0
            });
            
          } else if (USE_OLLAMA && LLM_MODE === 'extract') {
            // EXTRACT MODE: Use LLM only for narrative/free-text fields FROM OCR TEXT
            log('info', 'llm_extract_mode', { 
              documentId, 
              note: 'LLM extracts narrative fields from OCR text - more reliable than vision' 
            });
            
            // Extract narrative content from OCR text of selected pages
            const narrativeResults = [];
            for (const imgResult of imageResults) {
              try {
                // Get OCR text for this specific page
                const pageNumber = imgResult.pageIndex + 1; // pageIndex is 0-based
                const pageOcrData = ocrData.ocr?.find(p => p.page === pageNumber);
                
                if (!pageOcrData || !pageOcrData.text) {
                  log('warn', 'no_ocr_text_for_page', { page: pageNumber });
                  narrativeResults.push({ 
                    page: imgResult.pageIndex, 
                    narrative: null, 
                    error: 'No OCR text available' 
                  });
                  continue;
                }
                
                log('debug', 'extracting_from_ocr_text', { 
                  page: pageNumber, 
                  textLength: pageOcrData.text.length 
                });
                
                const narrative = await Promise.race([
                  extractNarrativeFields(pageOcrData.text),
                  new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Narrative extraction timeout')), LLM_TIMEOUT)
                  )
                ]);
                narrativeResults.push({
                  page: imgResult.pageIndex,
                  ...narrative
                });
              } catch (err) {
                log('warn', 'narrative_extraction_page_failed', { 
                  page: imgResult.pageIndex, 
                  error: err.message 
                });
                narrativeResults.push({ 
                  page: imgResult.pageIndex, 
                  narrative: null, 
                  error: err.message 
                });
              }
            }
            
            // Aggregate narrative content across all pages
            const aggregatedNarrative = {
              reasonForReferral: narrativeResults
                .map(r => r.narrative?.reasonForReferral)
                .filter(Boolean)
                .join('\n\n'),
              clinicalHistory: narrativeResults
                .map(r => r.narrative?.clinicalHistory)
                .filter(Boolean)
                .join('\n\n'),
              currentMedications: narrativeResults
                .map(r => r.narrative?.currentMedications)
                .filter(Boolean)
                .join('\n\n'),
              clinicalNotes: narrativeResults
                .map(r => r.narrative?.clinicalNotes)
                .filter(Boolean)
                .join('\n\n'),
              additionalComments: narrativeResults
                .map(r => r.narrative?.additionalComments)
                .filter(Boolean)
                .join('\n\n'),
              // Aggregate problems list from all pages (flatten arrays)
              problemsList: narrativeResults
                .map(r => r.narrative?.problemsList)
                .filter(p => Array.isArray(p) && p.length > 0)
                .flat(),
              hasNarrativeContent: narrativeResults.some(r => r.narrative?.hasNarrativeContent)
            };
            
            result = {
              extracted: aggregatedNarrative,
              mode: 'extract-narrative'
            };
            
            llmMetadata = {
              totalPages: imageResults.length,
              successfulPages: narrativeResults.filter(r => r.narrative && !r.error).length,
              duration: performance.now() - llmStartTime,
              mode: 'extract-narrative',
              hasContent: aggregatedNarrative.hasNarrativeContent,
              totalDuration: narrativeResults.reduce((sum, r) => sum + (r.metadata?.duration || 0), 0)
            };
            
            log('info', 'llm_narrative_extraction_complete', {
              documentId,
              pagesProcessed: llmMetadata.successfulPages,
              hasContent: aggregatedNarrative.hasNarrativeContent,
              duration: llmMetadata.duration
            });
            
          } else if (USE_OLLAMA) {
            // FALLBACK: Original extraction mode
            const ollamaResponse = await Promise.race([
              extractMultiplePages(imageResults.map(r => r.imagePath)),
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('LLM timeout')), LLM_TIMEOUT)
              )
            ]);
            
            result = ollamaResponse.extracted || ollamaResponse;
            llmMetadata = ollamaResponse.metadata || {
              totalPages: imageResults.length,
              successfulPages: imageResults.length,
              duration: ollamaResponse.timing || (performance.now() - llmStartTime),
              mode: 'extraction'
            };
            
          } else {
            // Python service fallback (single page)
            const imagePath = imageResults[0].imagePath;
            result = await Promise.race([
              extractWithLLM(imagePath),
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('LLM timeout')), LLM_TIMEOUT)
              )
            ]);
            
            llmMetadata = {
              totalPages: 1,
              successfulPages: 1,
              duration: performance.now() - llmStartTime,
              mode: 'python_extraction'
            };
          }
          
          const llmDuration = performance.now() - llmStartTime;
          log('debug', 'llm_processing_complete', { 
            documentId, 
            mode: llmMetadata.mode,
            pagesProcessed: llmMetadata.successfulPages,
            duration: Math.round(llmDuration) 
          });
          
          // Clean up temporary images
          await cleanupTempImages(imageResults);
          
          // Return both result and metadata
          return { result, llmMetadata };
        } catch (err) {
          log('error', 'llm_processing_failed', { documentId, error: String(err) });
          throw err;
        }
      })(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('LLM timeout')), LLM_TIMEOUT)
      )
    ]).catch(err => {
      // LLM failed - return marker for fallback
      return { __llm_failed: true, error: err };
    });
    
    // If LLM failed, fallback to OCR-only
    if (llmResult && llmResult.__llm_failed) {
      log('warn', 'dual_engine_llm_failed_fallback', { 
        documentId, 
        error: String(llmResult.error) 
      });
      
      return {
        ...ocrData,
        dualEngine: {
          mode: 'ocr_only',
          reason: 'LLM processing failed',
          error: String(llmResult.error)
        }
      };
    }
    
    // Extract LLM data and metadata
    const llmData = llmResult.result || llmResult;
    const llmMetadata = llmResult.llmMetadata || {};
    
    // DEBUG: Log OCR structure
    log('debug', 'ocr_structure_debug', {
      documentId,
      ocrTopLevel: Object.keys(ocrData || {}).join(', '),
      ocrPatientKeys: ocrData?.patient ? Object.keys(ocrData.patient).join(', ') : 'no patient object',
      ocrInsuranceKeys: ocrData?.insurance ? Object.keys(ocrData.insurance).join(', ') : 'no insurance object',
      ocrProviderKeys: ocrData?.provider ? Object.keys(ocrData.provider).join(', ') : 'no provider object',
      ocrSample: JSON.stringify(ocrData, null, 2).substring(0, 600)
    });
    
    // Handle validation mode vs extraction mode vs extract-narrative mode
    let mergeResult, quality, mergeDuration;
    
    if (LLM_MODE === 'extract' && llmData.extracted) {
      // EXTRACT-NARRATIVE MODE: LLM extracted ONLY free-text fields, OCR has structured data
      log('info', 'dual_engine_extract_narrative_mode', {
        documentId,
        hasNarrativeContent: llmData.extracted.hasNarrativeContent,
        narrativeFields: Object.keys(llmData.extracted || {}).filter(k => llmData.extracted[k]).length
      });
      
      const mergeStartTime = performance.now();
      
      // Merge: OCR provides all structured data + LLM adds narrative fields
      const mergedData = {
        ...ocrData.result,  // All OCR structured fields (was ocrData, should be ocrData.result!)
        narrative: llmData.extracted  // Add narrative section
      };
      
      // DEBUG: Check merged data before adding problemsList
      log('debug', 'merged_data_before_problems', {
        documentId,
        hasClinical: !!mergedData.clinical,
        clinicalKeys: mergedData.clinical ? Object.keys(mergedData.clinical).join(', ') : 'none'
      });
      
      // If LLM extracted problems list, add to clinical data (preserve existing clinical fields from rules engine)
      if (llmData.extracted.problemsList && Array.isArray(llmData.extracted.problemsList) && llmData.extracted.problemsList.length > 0) {
        if (!mergedData.clinical) mergedData.clinical = {};
        mergedData.clinical.problemsList = llmData.extracted.problemsList;
        
        log('info', 'llm_problems_list_extracted', {
          documentId,
          problemsCount: llmData.extracted.problemsList.length,
          problems: llmData.extracted.problemsList.map(p => p.condition).join(', ')
        });
      }
      
      // DEBUG: Check merged data AFTER adding problemsList
      log('debug', 'merged_data_after_problems', {
        documentId,
        hasClinical: !!mergedData.clinical,
        clinicalKeys: mergedData.clinical ? Object.keys(mergedData.clinical).join(', ') : 'none',
        hasPrimaryDiagnosis: !!mergedData.clinical?.primaryDiagnosis,
        hasSymptoms: !!mergedData.clinical?.symptoms,
        hasVitals: !!mergedData.clinical?.vitals
      });
      
      mergeDuration = performance.now() - mergeStartTime;
      
      log('debug', 'dual_engine_narrative_merged', {
        documentId,
        hasNarrative: llmData.extracted.hasNarrativeContent,
        duration: Math.round(mergeDuration)
      });
      
      mergeResult = {
        merged: mergedData,
        metadata: {
          hasNarrativeContent: llmData.extracted.hasNarrativeContent,
          dataQuality: 'high' // OCR structured + LLM narrative = best of both
        },
        conflicts: [], // No conflicts in extract mode
        mode: 'extract-narrative'
      };
      
      quality = { overall: 0.95, confidence: 'high' }; // High quality for this mode
      
    } else if (USE_VALIDATION_MODE && llmData.fieldValidations) {
      // VALIDATION MODE: LLM validated OCR, not extracting competing data
      log('info', 'dual_engine_validation_mode', {
        documentId,
        validatedFields: Object.keys(llmData.fieldValidations || {}).length,
        agreementScore: llmData.agreementScore
      });
      
      // Use OCR data as source of truth, LLM provides quality assessment
      const mergeStartTime = performance.now();
      
      // Calculate quality based on validation results
      const validationQuality = calculateValidationQuality(llmData);
      
      mergeDuration = performance.now() - mergeStartTime;
      
      log('debug', 'dual_engine_validation_complete', {
        documentId,
        agreementScore: llmData.agreementScore,
        issuesFound: llmData.issuesFound?.length || 0,
        duration: Math.round(mergeDuration)
      });
      
      // Prepare merge result structure for decision tree
      mergeResult = {
        merged: ocrData, // OCR is source of truth
        metadata: {
          agreementScore: llmData.agreementScore,
          conflicts: llmData.issuesFound || [],
          dataQuality: validationQuality
        },
        conflicts: llmData.issuesFound || [],
        validation: llmData
      };
      
      quality = validationQuality;
      
    } else {
      // EXTRACTION MODE: LLM extracted competing data (legacy, will have redacted values)
      const mergeStartTime = performance.now();
      mergeResult = mergeExtractions(ocrData, llmData.extracted || llmData);
      mergeDuration = performance.now() - mergeStartTime;
      
      log('debug', 'dual_engine_merge_complete', {
        documentId,
        agreementScore: mergeResult.metadata.agreementScore,
        conflicts: mergeResult.conflicts.length,
        duration: Math.round(mergeDuration)
      });
      
      // Assess data quality
      quality = assessDataQuality(mergeResult, ocrData, llmData);
    }
    
    // Save problemsList before decision tree (rules engine will recreate clinical object)
    const preservedProblemsList = mergeResult.merged?.clinical?.problemsList;
    
    // Run decision tree analysis
    const decisionTreeStartTime = performance.now();
    const routing = decisionTree.evaluate(mergeResult.merged, mergeResult.metadata);
    const decisionTreeDuration = performance.now() - decisionTreeStartTime;
    
    // Restore problemsList after rules engine processing (mergeResult.merged has the data)
    if (preservedProblemsList && Array.isArray(preservedProblemsList) && preservedProblemsList.length > 0) {
      if (!mergeResult.merged.clinical) mergeResult.merged.clinical = {};
      mergeResult.merged.clinical.problemsList = preservedProblemsList;
      log('debug', 'problems_list_restored_after_rules', {
        documentId,
        count: preservedProblemsList.length
      });
    }
    
    log('info', 'dual_engine_routing', {
      documentId,
      action: routing.route.action,
      priority: routing.route.priority,
      dataQuality: quality.grade
    });
    
    // Build enhanced result
    const totalDuration = performance.now() - t0;
    const enhancedResult = {
      // Merged data (conflicts resolved) - now includes restored problemsList
      ...mergeResult.merged,
      
      // Preserve OCR pages for UI
      ocr: ocrData.ocr,
      
      // Document metadata
      documentMeta: {
        ...ocrData.documentMeta,
        processingMode: 'dual_engine'
      },
      
      // Dual-engine specific data
      dualEngine: {
        mode: 'ocr_llm_merged',
        llmBackend: USE_OLLAMA ? 'ollama' : 'python',
        agreementScore: mergeResult.metadata.agreementScore,
        conflictCount: mergeResult.conflicts.length,
        conflicts: mergeResult.conflicts,
        resolutions: mergeResult.metadata.resolutions,
        dataQuality: quality,
        
        // LLM processing details
        llm: {
          pagesProcessed: llmMetadata.successfulPages || llmMetadata.totalPages || 0,
          totalPages: llmMetadata.totalPages || 0,
          failedPages: llmMetadata.failedPages || 0,
          processingTime: llmMetadata.duration || null,
          errors: llmMetadata.errors || []
        },
        
        // Original results for audit trail
        originalOCR: {
          patient: ocrData.patient,
          insurance: ocrData.insurance,
          provider: ocrData.provider,
          procedure: ocrData.procedure,
          confidenceDetail: ocrData.confidenceDetail
        },
        
        originalLLM: {
          extracted: llmData.extracted || llmData,
          confidence: llmData.confidence || null,
          rawResponse: llmData.rawResponse || null
        },
        
        // Performance metrics
        timing: {
          total: Math.round(totalDuration),
          ocr: ocrData.timing?.total || null,
          llm: llmMetadata.duration || null,
          merge: Math.round(mergeDuration),
          decisionTree: Math.round(decisionTreeDuration)
        }
      },
      
      // Decision tree routing
      routing: {
        action: routing.route.action,
        priority: routing.route.priority,
        label: routing.route.label,
        description: routing.route.description,
        estimatedTime: routing.route.estimatedTime,
        color: routing.route.color,
        nextSteps: routing.route.nextSteps,
        validationSteps: routing.validationSteps,
        validationSummary: routing.route.validationSummary,
        context: routing.route.context,
        processingMetadata: routing.processingMetadata
      },
      
      // Enhanced confidence based on agreement
      confidenceDetail: {
        score: mergeResult.metadata.agreementScore / 100,
        level: quality.level,
        factors: {
          ocrConfidence: ocrData.confidenceDetail?.score || 0,
          llmConfidence: llmData.confidence || 0,
          agreementScore: mergeResult.metadata.agreementScore,
          conflictRate: mergeResult.metadata.conflictCount / mergeResult.metadata.totalFields
        }
      }
    };
    
    log('info', 'dual_engine_complete', {
      documentId,
      totalDuration: Math.round(totalDuration),
      agreementScore: mergeResult.metadata.agreementScore,
      routingAction: routing.route.action,
      quality: quality.grade
    });
    
    // Clear completion message for user visibility
    log('info', 'dual_engine_processing_complete', {
      documentId,
      status: 'success',
      totalTime: `${Math.round(totalDuration / 1000)}s`,
      pagesProcessed: llmMetadata.pagesProcessed || 0,
      dataQuality: quality.grade,
      nextAction: routing.route.action,
      message: '✅ PROCESSING COMPLETE'
    });
    
    return enhancedResult;
    
  } catch (error) {
    const duration = performance.now() - t0;
    log('error', 'dual_engine_failed', {
      documentId,
      error: String(error),
      duration: Math.round(duration)
    });
    
    // Fallback to OCR-only on critical error
    try {
      const ocrResult = await ocrProcessor();
      return {
        ...ocrResult,
        dualEngine: {
          mode: 'ocr_only',
          reason: 'Dual-engine processing failed',
          error: String(error)
        }
      };
    } catch (fallbackError) {
      log('error', 'dual_engine_fallback_failed', {
        documentId,
        error: String(fallbackError)
      });
      throw fallbackError;
    }
  }
}

/**
 * Wrapper for existing processDocument function to add dual-engine support
 * This can be used to enhance the existing server.js processDocument function
 * 
 * @param {Function} originalProcessor - Original processDocument function
 * @returns {Function} Enhanced processor with dual-engine support
 */
export function enhanceWithDualEngine(originalProcessor) {
  return async function processDocumentEnhanced(id, docs, options = {}) {
    const entry = docs.get(id);
    if (!entry || !entry.filePath) {
      return originalProcessor(id, docs, options);
    }
    
    // Wrap the original processor
    const ocrProcessor = async () => {
      await originalProcessor(id, docs, options);
      return docs.get(id)?.result;
    };
    
    try {
      // Run dual-engine processing
      const result = await processDualEngine(
        ocrProcessor,
        entry.filePath,
        { documentId: id, ...options }
      );
      
      // Update document entry with enhanced result
      if (result) {
        entry.result = result;
        entry.status = 'done';
        entry.error = null;
        docs.set(id, entry);
      }
      
      return result;
      
    } catch (error) {
      log('error', 'enhanced_processor_failed', {
        documentId: id,
        error: String(error)
      });
      
      // Fallback to original processor
      return originalProcessor(id, docs, options);
    }
  };
}

/**
 * Calculate data quality from validation results
 */
function calculateValidationQuality(validationData) {
  const score = validationData.agreementScore || (validationData.overallAccuracy * 100) || 0;
  const issueCount = validationData.issuesFound?.length || 0;
  
  // Grade based on validation score and issues
  let grade, recommendation;
  
  if (score >= 95 && issueCount === 0) {
    grade = 'A';
    recommendation = 'APPROVE';
  } else if (score >= 85 && issueCount <= 2) {
    grade = 'B';
    recommendation = 'APPROVE';
  } else if (score >= 70 && issueCount <= 5) {
    grade = 'C';
    recommendation = 'REVIEW';
  } else if (score >= 50) {
    grade = 'D';
    recommendation = 'MANUAL_REVIEW';
  } else {
    grade = 'F';
    recommendation = 'REJECT';
  }
  
  return {
    grade,
    score,
    issueCount,
    recommendation,
    validatedFields: Object.keys(validationData.fieldValidations || {}).length,
    notes: validationData.notes || 'LLM validation complete'
  };
}

/**
 * Aggregate multiple page validation results into overall assessment
 * Handles any field structure dynamically
 */
function aggregateValidations(validationResults) {
  const validations = validationResults.filter(v => v.validation).map(v => v.validation);
  
  if (validations.length === 0) {
    return {
      overallAccuracy: 0,
      fieldValidations: {},
      issuesFound: ['All validations failed'],
      validatedPages: 0,
      notes: 'LLM validation unavailable'
    };
  }
  
  // Dynamically aggregate all fields from all pages
  const allFields = {};
  const issuesFound = [];
  let totalFieldsChecked = 0;
  let fieldsCorrect = 0;
  
  validations.forEach((v, pageIdx) => {
    if (v.fieldValidations) {
      Object.keys(v.fieldValidations).forEach(fieldName => {
        const field = v.fieldValidations[fieldName];
        totalFieldsChecked++;
        
        // Track if this field appears correct
        if (field.appearsCorrect === true || field.confidence === 'high') {
          fieldsCorrect++;
        }
        
        // Store best validation for each field (prefer "correct" over "incorrect")
        if (!allFields[fieldName]) {
          allFields[fieldName] = { ...field, pageNum: pageIdx + 1 };
        } else if (field.appearsCorrect && !allFields[fieldName].appearsCorrect) {
          // Override with correct version if found
          allFields[fieldName] = { ...field, pageNum: pageIdx + 1 };
        }
        
        // Collect issues with field name and page context
        if (field.appearsCorrect === false || field.confidence === 'low') {
          const concern = field.concerns || field.notes || 'Visual quality issue';
          issuesFound.push(`Page ${pageIdx + 1} - ${fieldName}: ${concern}`);
        }
      });
    }
    
    // Collect document-level issues
    if (v.issuesFound && Array.isArray(v.issuesFound)) {
      v.issuesFound.forEach(issue => {
        issuesFound.push(`Page ${pageIdx + 1}: ${issue}`);
      });
    }
  });
  
  // Calculate accuracy from multiple sources
  const accuracies = validations
    .map(v => v.overallAccuracy)
    .filter(a => typeof a === 'number' && !isNaN(a));
  
  // Weighted average: prefer page-reported accuracy, fallback to field counts
  let avgAccuracy;
  if (accuracies.length > 0) {
    avgAccuracy = accuracies.reduce((sum, a) => sum + a, 0) / accuracies.length;
  } else if (totalFieldsChecked > 0) {
    // Use actual field validation results
    avgAccuracy = fieldsCorrect / totalFieldsChecked;
  } else {
    // Only use fallback if truly no data
    avgAccuracy = 0;
  }
  
  // Calculate agreement score (0-100 for decision tree)
  // Don't use fallback - show actual calculated score
  const agreementScore = Math.round(avgAccuracy * 100);
  
  return {
    fieldValidations: allFields,
    overallAccuracy: avgAccuracy,
    agreementScore: agreementScore,
    totalFieldsValidated: totalFieldsChecked,
    correctFields: fieldsCorrect,
    issuesFound: [...new Set(issuesFound)], // Remove duplicates
    validatedPages: validations.length,
    notes: `LLM validated ${validations.length} pages, ${totalFieldsChecked} fields - ${agreementScore}% accuracy`
  };
}

/**
 * Find most common value in array
 */
function mostCommon(arr) {
  if (arr.length === 0) return null;
  const counts = {};
  arr.forEach(v => counts[v] = (counts[v] || 0) + 1);
  return Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
}

/**
 * Health check for dual-engine system
 * @returns {Promise<Object>} Health status
 */
export async function dualEngineHealth() {
  const health = {
    enabled: LLM_ENABLED,
    ocr: true, // OCR is always available
    llm: false,
    timestamp: new Date().toISOString()
  };
  
  if (LLM_ENABLED) {
    try {
      health.llm = await checkLLMHealth();
    } catch (error) {
      health.llm = false;
      health.llmError = String(error);
    }
  }
  
  health.status = health.ocr && (health.llm || !LLM_ENABLED) ? 'healthy' : 'degraded';
  
  return health;
}

export default {
  processDualEngine,
  enhanceWithDualEngine,
  dualEngineHealth
};
