/**
 * Training Data Collector
 * 
 * Exports corrections from corrections_db.js into training-ready format
 * HIPAA-compliant: Filters out all PHI fields
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CORRECTIONS_FILE = path.join(__dirname, '../data/corrections.json');
const OUTPUT_DIR = path.join(__dirname, '../../training/datasets');
const RESULTS_DIR = path.join(__dirname, '../../data/results');

// HIPAA Compliance: Never export PHI fields
const PHI_FIELDS = ['patientNames', 'patient', 'dob', 'memberId', 'ssn'];
const ALLOWED_FIELDS = [
  'providerNames', 'npi', 'phone', 'fax', 'carrier', 'cpt', 'icd', 'facilities',
  'procedureDescription', 'practiceName', 'referringProvider', 'referringNpi',
  'referringPhone', 'referringFax', 'diagnosisDescription', 'providerNotes',
  'safetyCategory', 'accommodationType', 'supervisingProvider', 'supervisingNpi',
  'planType', 'studyType'
];

/**
 * Load corrections database
 */
function loadCorrections() {
  try {
    if (fs.existsSync(CORRECTIONS_FILE)) {
      const data = fs.readFileSync(CORRECTIONS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Failed to load corrections:', err.message);
  }
  return null;
}

/**
 * Filter out PHI fields (HIPAA compliance)
 */
function filterPHI(corrections) {
  const filtered = {};
  
  for (const field of ALLOWED_FIELDS) {
    if (corrections[field]) {
      filtered[field] = corrections[field];
    }
  }
  
  return filtered;
}

/**
 * Convert corrections to training format
 * Format: Array of {ocrText, correctedText, field, confidence, count}
 */
function convertToTrainingFormat(corrections) {
  const trainingData = [];
  
  for (const [fieldName, entries] of Object.entries(corrections)) {
    // Skip metadata and PHI fields
    if (fieldName === 'metadata' || PHI_FIELDS.includes(fieldName)) {
      continue;
    }
    
    for (const [key, entry] of Object.entries(entries)) {
      if (!entry.corrections || entry.corrections.length === 0) continue;
      
      // Get the most frequent correction
      const best = entry.corrections.reduce((a, b) => a.count > b.count ? a : b);
      
      // Only include corrections with at least 3 occurrences (high confidence)
      if (best.count >= 3 || entry.confidence >= 0.8) {
        trainingData.push({
          ocrText: entry.ocrText,
          correctedText: best.text,
          field: fieldName,
          confidence: entry.confidence,
          count: best.count,
          occurrences: entry.count,
          metadata: best.metadata || {}
        });
      }
    }
  }
  
  return trainingData;
}

/**
 * Export to JSON Lines format (one JSON object per line)
 */
function exportToJSONL(data, filename) {
  const filepath = path.join(OUTPUT_DIR, filename);
  const lines = data.map(item => JSON.stringify(item)).join('\n');
  
  fs.writeFileSync(filepath, lines, 'utf8');
  console.log(`✅ Exported ${data.length} training samples to ${filename}`);
  
  return filepath;
}

/**
 * Export to regular JSON format
 */
function exportToJSON(data, filename) {
  const filepath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`✅ Exported ${data.length} training samples to ${filename}`);
  
  return filepath;
}

/**
 * Generate statistics about the training data
 */
function generateStats(data) {
  const stats = {
    total: data.length,
    byField: {},
    byConfidence: {
      high: 0, // >= 0.9
      medium: 0, // >= 0.7
      low: 0 // < 0.7
    },
    byCount: {
      frequent: 0, // >= 10 occurrences
      moderate: 0, // >= 5
      rare: 0 // < 5
    },
    avgConfidence: 0,
    avgCount: 0
  };
  
  let totalConfidence = 0;
  let totalCount = 0;
  
  for (const item of data) {
    // By field
    stats.byField[item.field] = (stats.byField[item.field] || 0) + 1;
    
    // By confidence
    if (item.confidence >= 0.9) stats.byConfidence.high++;
    else if (item.confidence >= 0.7) stats.byConfidence.medium++;
    else stats.byConfidence.low++;
    
    // By count
    if (item.count >= 10) stats.byCount.frequent++;
    else if (item.count >= 5) stats.byCount.moderate++;
    else stats.byCount.rare++;
    
    totalConfidence += item.confidence;
    totalCount += item.count;
  }
  
  stats.avgConfidence = (totalConfidence / data.length).toFixed(3);
  stats.avgCount = (totalCount / data.length).toFixed(1);
  
  return stats;
}

/**
 * Main export function
 */
async function main() {
  console.log('🔄 MedOCR Training Data Collector');
  console.log('================================\n');
  
  // Load corrections
  console.log('📂 Loading corrections database...');
  const corrections = loadCorrections();
  
  if (!corrections) {
    console.error('❌ No corrections found. Run the application and make corrections first.');
    process.exit(1);
  }
  
  // HIPAA filter
  console.log('🔒 Filtering PHI (HIPAA compliance)...');
  const filtered = filterPHI(corrections);
  console.log(`   Kept ${Object.keys(filtered).length} non-PHI fields`);
  console.log(`   Blocked ${PHI_FIELDS.length} PHI fields\n`);
  
  // Convert to training format
  console.log('🔄 Converting to training format...');
  const trainingData = convertToTrainingFormat(filtered);
  
  if (trainingData.length === 0) {
    console.error('❌ No training data available. Need at least 3 occurrences of each correction.');
    console.log('   Make more corrections in the UI and try again.');
    process.exit(1);
  }
  
  // Generate statistics
  const stats = generateStats(trainingData);
  console.log(`\n📊 Training Data Statistics:`);
  console.log(`   Total samples: ${stats.total}`);
  console.log(`   Average confidence: ${stats.avgConfidence}`);
  console.log(`   Average count: ${stats.avgCount}`);
  console.log(`\n   By field:`);
  for (const [field, count] of Object.entries(stats.byField).sort((a, b) => b[1] - a[1])) {
    console.log(`     - ${field}: ${count} samples`);
  }
  console.log(`\n   By confidence:`);
  console.log(`     - High (≥0.9): ${stats.byConfidence.high}`);
  console.log(`     - Medium (≥0.7): ${stats.byConfidence.medium}`);
  console.log(`     - Low (<0.7): ${stats.byConfidence.low}`);
  
  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  // Export in multiple formats
  console.log('\n💾 Exporting data...');
  const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
  
  exportToJSON(trainingData, `training_data_${timestamp}.json`);
  exportToJSONL(trainingData, `training_data_${timestamp}.jsonl`);
  exportToJSON(stats, `training_stats_${timestamp}.json`);
  
  // Export latest (symlink alternative)
  exportToJSON(trainingData, 'training_data_latest.json');
  exportToJSONL(trainingData, 'training_data_latest.jsonl');
  
  console.log(`\n✅ Data collection complete!`);
  console.log(`\n📁 Output files in: ${OUTPUT_DIR}`);
  
  // Check if we have enough data for training
  if (trainingData.length < 50) {
    console.log(`\n⚠️  WARNING: Only ${trainingData.length} samples available.`);
    console.log(`   Recommend at least 100 samples for effective fine-tuning.`);
    console.log(`   Continue making corrections in the UI.`);
  } else if (trainingData.length < 100) {
    console.log(`\n⚠️  Note: ${trainingData.length} samples is borderline for training.`);
    console.log(`   100-500 samples recommended for best results.`);
  } else {
    console.log(`\n✅ ${trainingData.length} samples is sufficient for training!`);
  }
  
  process.exit(0);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  });
}

export { loadCorrections, filterPHI, convertToTrainingFormat, generateStats };
