/**
 * AI Analysis API Routes
 * 
 * REST API endpoints for batch analysis and AI-powered summaries.
 * Completely isolated - doesn't interfere with existing document routes.
 */

import express from 'express';
import { 
  generateBatchSummary, 
  listRecentBatches, 
  getSavedSummary,
  getAnalysisTypes,
  analyzeDocument,
  listAllDocuments
} from '../batch/summaryGenerator.js';
import { log } from '../logging/logger.js';
import fs from 'fs/promises';
import path from 'path';

const router = express.Router();
const PROCESSED_PATH = path.join(process.cwd(), 'data', 'processed.json');

/**
 * GET /api/ai-analysis/batches
 * List recent batches available for analysis
 */
router.get('/batches', async (req, res) => {
  try {
    const batches = await listRecentBatches();
    res.json({ batches });
  } catch (error) {
    log('error', 'ai_analysis_list_batches_failed', { error: String(error.message) });
    res.status(500).json({ 
      error: { 
        code: 'list_failed', 
        message: 'Failed to list batches' 
      } 
    });
  }
});

/**
 * GET /api/ai-analysis/types
 * Get available analysis types
 */
router.get('/types', (req, res) => {
  res.json({ types: getAnalysisTypes() });
});

/**
 * POST /api/ai-analysis/generate
 * Generate new batch summary
 * Body: { batchIndex: number, analysisType: string }
 */
router.post('/generate', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const { batchIndex, analysisType = 'executive' } = req.body;
    
    if (typeof batchIndex !== 'number' || batchIndex < 0) {
      return res.status(400).json({ 
        error: { 
          code: 'invalid_batch_index', 
          message: 'batchIndex must be a non-negative number' 
        } 
      });
    }
    
    // Load processed records and get the specified batch
    const raw = await fs.readFile(PROCESSED_PATH, 'utf8');
    const allRecords = JSON.parse(raw);
    
    // Group into batches (same logic as summaryGenerator)
    const sorted = [...allRecords].sort((a, b) => 
      new Date(a.timestamp || 0) - new Date(b.timestamp || 0)
    );
    
    const batches = [];
    let currentBatch = [];
    let lastTimestamp = null;
    const BATCH_WINDOW_MS = 5 * 60 * 1000;
    
    for (const record of sorted) {
      const timestamp = new Date(record.timestamp || 0);
      if (!lastTimestamp || (timestamp - lastTimestamp) <= BATCH_WINDOW_MS) {
        currentBatch.push(record);
        lastTimestamp = timestamp;
      } else {
        if (currentBatch.length > 0) batches.push(currentBatch);
        currentBatch = [record];
        lastTimestamp = timestamp;
      }
    }
    if (currentBatch.length > 0) batches.push(currentBatch);
    
    const reversedBatches = batches.reverse(); // Newest first
    const targetBatch = reversedBatches[batchIndex];
    
    if (!targetBatch) {
      return res.status(404).json({ 
        error: { 
          code: 'batch_not_found', 
          message: `Batch index ${batchIndex} not found` 
        } 
      });
    }
    
    log('info', 'ai_analysis_generate_start', { 
      batchIndex, 
      analysisType, 
      documentCount: targetBatch.length 
    });
    
    // Generate summary
    const result = await generateBatchSummary(targetBatch, analysisType);
    
    log('info', 'ai_analysis_generate_complete', { 
      batchId: result.batchId, 
      analysisType 
    });
    
    res.json({ 
      success: true, 
      result 
    });
    
  } catch (error) {
    log('error', 'ai_analysis_generate_failed', { error: String(error.message) });
    res.status(500).json({ 
      error: { 
        code: 'generation_failed', 
        message: error.message 
      } 
    });
  }
});

/**
 * GET /api/ai-analysis/summary/:batchId
 * Get a previously generated summary
 */
router.get('/summary/:batchId', async (req, res) => {
  try {
    const { batchId } = req.params;
    const summary = await getSavedSummary(batchId);
    
    if (!summary) {
      return res.status(404).json({ 
        error: { 
          code: 'summary_not_found', 
          message: 'Summary not found' 
        } 
      });
    }
    
    res.json({ summary });
    
  } catch (error) {
    log('error', 'ai_analysis_get_summary_failed', { error: String(error.message) });
    res.status(500).json({ 
      error: { 
        code: 'fetch_failed', 
        message: 'Failed to fetch summary' 
      } 
    });
  }
});

/**
 * GET /api/ai-analysis/export/:batchId/json
 * Export batch summary as JSON file
 */
router.get('/export/:batchId/json', async (req, res) => {
  try {
    const { batchId } = req.params;
    const summary = await getSavedSummary(batchId);
    
    if (!summary) {
      return res.status(404).json({ 
        error: { 
          code: 'summary_not_found', 
          message: 'Summary not found' 
        } 
      });
    }
    
    const filename = `batch-summary-${batchId}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(summary, null, 2));
    
  } catch (error) {
    log('error', 'ai_analysis_export_failed', { error: String(error.message) });
    res.status(500).json({ 
      error: { 
        code: 'export_failed', 
        message: 'Failed to export summary' 
      } 
    });
  }
});

/**
 * GET /api/ai-analysis/export/:batchId/markdown
 * Export batch summary as Markdown file
 */
router.get('/export/:batchId/markdown', async (req, res) => {
  try {
    const { batchId } = req.params;
    const summary = await getSavedSummary(batchId);
    
    if (!summary) {
      return res.status(404).json({ 
        error: { 
          code: 'summary_not_found', 
          message: 'Summary not found' 
        } 
      });
    }
    
    // Create markdown document
    const markdown = `# Batch Analysis Report
    
**Batch ID:** ${summary.batchId}  
**Generated:** ${new Date(summary.createdAt).toLocaleString()}  
**Analysis Type:** ${summary.analysisType}  
**Model:** ${summary.model}  
**Documents:** ${summary.metadata.documentCount}

---

${summary.aiSummary}

---

## Raw Data

\`\`\`json
${JSON.stringify(summary.rawData, null, 2)}
\`\`\`
`;
    
    const filename = `batch-summary-${batchId}.md`;
    res.setHeader('Content-Type', 'text/markdown');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(markdown);
    
  } catch (error) {
    log('error', 'ai_analysis_export_markdown_failed', { error: String(error.message) });
    res.status(500).json({ 
      error: { 
        code: 'export_failed', 
        message: 'Failed to export summary' 
      } 
    });
  }
});

/**
 * GET /api/ai-analysis/documents
 * List all processed documents with status
 */
router.get('/documents', async (req, res) => {
  try {
    const documents = await listAllDocuments();
    res.json({ documents });
  } catch (error) {
    log('error', 'ai_analysis_list_documents_failed', { error: String(error.message) });
    res.status(500).json({ 
      error: { 
        code: 'list_failed', 
        message: 'Failed to list documents' 
      } 
    });
  }
});

/**
 * POST /api/ai-analysis/document/:docId
 * Analyze a specific document
 */
router.post('/document/:docId', async (req, res) => {
  try {
    const { docId } = req.params;
    
    log('info', 'ai_analysis_document_start', { docId });
    
    const analysis = await analyzeDocument(docId);
    
    log('info', 'ai_analysis_document_complete', { 
      docId, 
      status: analysis.status 
    });
    
    res.json({ 
      success: true, 
      analysis 
    });
    
  } catch (error) {
    log('error', 'ai_analysis_document_failed', { 
      docId: req.params.docId, 
      error: String(error.message) 
    });
    
    if (error.message.includes('not found')) {
      return res.status(404).json({ 
        error: { 
          code: 'document_not_found', 
          message: error.message 
        } 
      });
    }
    
    res.status(500).json({ 
      error: { 
        code: 'analysis_failed', 
        message: error.message 
      } 
    });
  }
});

export default router;
