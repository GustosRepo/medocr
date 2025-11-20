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
import { extractWithOllama, checkOllamaHealth, extractMultiplePages } from '../ollamaService.js';
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

const decisionTree = new DecisionTreeEngine();

// Check if LLM service is enabled
const LLM_ENABLED = process.env.ENABLE_LLM === 'true';
const LLM_TIMEOUT = parseInt(process.env.LLM_TIMEOUT || '30000', 10);

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
    // Run OCR and LLM in parallel for maximum efficiency
    const [ocrResult, llmResult] = await Promise.allSettled([
      // OCR processing (existing pipeline)
      ocrProcessor().catch(err => {
        log('error', 'ocr_processing_failed', { documentId, error: String(err) });
        throw err;
      }),
      
      // LLM processing (Ollama or Python service) with smart page selection
      (async () => {
        try {
          // Wait for OCR to complete first (we need page texts for selection)
          const ocrData = await ocrProcessor();
          
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
          
          // Convert selected pages to low-res images
          const imageResults = await convertPdfPagesToImages(
            filePath,
            pageSelection.selectedPages,
            {
              targetDPI: 150,
              maxWidth: 1600,
              quality: 85,
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
          
          // Process multiple pages with Ollama (with error recovery)
          const llmStartTime = performance.now();
          let result;
          
          if (USE_OLLAMA) {
            // Use new multi-page Ollama function
            result = await Promise.race([
              extractMultiplePages(imageResults.map(r => r.imagePath)),
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('LLM timeout')), LLM_TIMEOUT)
              )
            ]);
          } else {
            // Fallback to single-page Python service (first page only)
            const imagePath = imageResults[0].imagePath;
            result = await Promise.race([
              extractWithLLM(imagePath),
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('LLM timeout')), LLM_TIMEOUT)
              )
            ]);
          }
          
          const llmDuration = performance.now() - llmStartTime;
          log('debug', 'llm_extraction_complete', { 
            documentId, 
            backend: USE_OLLAMA ? 'ollama' : 'python',
            pagesProcessed: imageResults.length,
            duration: Math.round(llmDuration) 
          });
          
          // Clean up temporary images
          await cleanupTempImages(imageResults);
          
          return result;
        } catch (err) {
          log('error', 'llm_processing_failed', { documentId, error: String(err) });
          throw err;
        }
      })()
    ]);
    
    // Handle processing results
    const ocrSuccess = ocrResult.status === 'fulfilled';
    const llmSuccess = llmResult.status === 'fulfilled';
    
    // If OCR failed, we can't proceed
    if (!ocrSuccess) {
      log('error', 'dual_engine_ocr_failed', { documentId });
      throw ocrResult.reason;
    }
    
    const ocrData = ocrResult.value;
    
    // If LLM failed, fallback to OCR-only
    if (!llmSuccess) {
      log('warn', 'dual_engine_llm_failed_fallback', { 
        documentId, 
        error: String(llmResult.reason) 
      });
      
      return {
        ...ocrData,
        dualEngine: {
          mode: 'ocr_only',
          reason: 'LLM processing failed',
          error: String(llmResult.reason)
        }
      };
    }
    
    const llmData = llmResult.value;
    
    // Both engines succeeded - merge and validate
    const mergeStartTime = performance.now();
    const mergeResult = mergeExtractions(ocrData, llmData.extracted || llmData);
    const mergeDuration = performance.now() - mergeStartTime;
    
    log('debug', 'dual_engine_merge_complete', {
      documentId,
      agreementScore: mergeResult.metadata.agreementScore,
      conflicts: mergeResult.conflicts.length,
      duration: Math.round(mergeDuration)
    });
    
    // Assess data quality
    const quality = assessDataQuality(mergeResult, ocrData, llmData);
    
    // Run decision tree analysis
    const decisionTreeStartTime = performance.now();
    const routing = decisionTree.evaluate(mergeResult.merged, mergeResult.metadata);
    const decisionTreeDuration = performance.now() - decisionTreeStartTime;
    
    log('info', 'dual_engine_routing', {
      documentId,
      action: routing.route.action,
      priority: routing.route.priority,
      dataQuality: quality.grade
    });
    
    // Build enhanced result
    const totalDuration = performance.now() - t0;
    const enhancedResult = {
      // Merged data (conflicts resolved)
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
        agreementScore: mergeResult.metadata.agreementScore,
        conflictCount: mergeResult.conflicts.length,
        conflicts: mergeResult.conflicts,
        resolutions: mergeResult.metadata.resolutions,
        dataQuality: quality,
        
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
          llm: llmData.timing || null,
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
