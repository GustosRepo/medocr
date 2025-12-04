#!/usr/bin/env node
/**
 * Regenerate processed.json from all result files in data/results/
 * This fixes any docs that were saved before problems/actions were added to summary
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RESULTS_DIR = path.join(__dirname, '../../data/results');
const PROCESSED_PATH = path.join(__dirname, '../../data/processed.json');

function makeProcessedSummary(id, result) {
  const patient = result.patient || {};
  const clinical = result.clinical || {};
  const problemsList = clinical.problemsList || [];
  const alerts = result.alerts || {};
  
  return {
    id,
    processedAt: result.documentMeta?.processedAt || new Date().toISOString(),
    pages: result.documentMeta?.pages || (result.ocr ? result.ocr.length : 0) || 0,
    intakeDate: result.documentMeta?.intakeDate || null,
    suggestedFilename: result.documentMeta?.suggestedFilename || null,
    displayFilename: result.documentMeta?.displayFilename || null,
    fileHash: result.documentMeta?.fileHash || null,
    patient: { 
      first: patient.first || null, 
      last: patient.last || null, 
      dob: patient.dob || null 
    },
    confidence: result.confidenceLevel || result.confidence || null,
    problems: problemsList,
    actions: alerts.actions || [],
    warnings: alerts.warnings || [],
    actionsCount: (alerts.actions || []).length
  };
}

async function regenerateProcessedJson() {
  console.log('🔄 Regenerating processed.json from result files...');
  
  if (!fs.existsSync(RESULTS_DIR)) {
    console.error('❌ Results directory not found:', RESULTS_DIR);
    process.exit(1);
  }
  
  const files = fs.readdirSync(RESULTS_DIR);
  const jsonFiles = files.filter(f => f.endsWith('.json'));
  
  console.log(`📂 Found ${jsonFiles.length} result files`);
  
  const processedRecords = [];
  let successCount = 0;
  let errorCount = 0;
  
  for (const file of jsonFiles) {
    const id = file.replace('.json', '');
    const filePath = path.join(RESULTS_DIR, file);
    
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const result = JSON.parse(raw);
      const summary = makeProcessedSummary(id, result);
      processedRecords.push(summary);
      successCount++;
      
      const problemsCount = (summary.problems || []).length;
      if (problemsCount > 0) {
        console.log(`  ✅ ${id}: ${problemsCount} problems`);
      }
    } catch (e) {
      console.error(`  ❌ ${id}: ${e.message}`);
      errorCount++;
    }
  }
  
  // Write to processed.json
  const tmpPath = PROCESSED_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(processedRecords, null, 2), 'utf8');
  fs.renameSync(tmpPath, PROCESSED_PATH);
  
  console.log(`\n✅ Generated processed.json with ${successCount} records`);
  if (errorCount > 0) {
    console.log(`⚠️  ${errorCount} files had errors`);
  }
  
  // Summary stats
  const withProblems = processedRecords.filter(r => (r.problems || []).length > 0).length;
  const withActions = processedRecords.filter(r => r.actionsCount > 0).length;
  console.log(`📊 ${withProblems} docs with clinical problems`);
  console.log(`📊 ${withActions} docs with actions required`);
}

regenerateProcessedJson().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
