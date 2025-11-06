#!/usr/bin/env node
/**
 * Data Cleanup Script - HIPAA Retention Policy
 * 
 * Removes uploaded PDFs and processed records older than specified retention period.
 * Default: 30 days (configurable via RETENTION_DAYS env var)
 * 
 * Purpose: Minimize PHI exposure by enforcing data retention policy
 * File: backend/scripts/cleanup-old-data.js
 * 
 * Usage:
 *   node backend/scripts/cleanup-old-data.js [--dry-run] [--retention-days=30]
 *   
 *   --dry-run: Preview what would be deleted without actually deleting
 *   --retention-days=N: Override default retention period
 * 
 * Schedule via cron:
 *   0 2 * * * cd /path/to/medocr && node backend/scripts/cleanup-old-data.js >> data/logs/cleanup.log 2>&1
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = path.join(__dirname, '../..');

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const retentionArg = args.find(arg => arg.startsWith('--retention-days='));
const RETENTION_DAYS = retentionArg 
  ? parseInt(retentionArg.split('=')[1], 10) 
  : parseInt(process.env.RETENTION_DAYS || '30', 10);

const RETENTION_MS = RETENTION_DAYS * 86400000; // days to milliseconds
const now = Date.now();

console.log('='.repeat(60));
console.log('MEDOCR Data Cleanup Script');
console.log('='.repeat(60));
console.log(`Mode: ${isDryRun ? 'DRY RUN (no changes)' : 'LIVE (will delete files)'}`);
console.log(`Retention Period: ${RETENTION_DAYS} days`);
console.log(`Current Time: ${new Date(now).toISOString()}`);
console.log(`Cutoff Date: ${new Date(now - RETENTION_MS).toISOString()}`);
console.log('='.repeat(60));

const stats = {
  uploads: { scanned: 0, deleted: 0, bytes: 0 },
  processed: { total: 0, removed: 0 },
  errors: []
};

/**
 * Clean uploaded PDF files
 */
function cleanUploads() {
  const uploadsDir = path.join(ROOT_DIR, 'data/uploads');
  
  if (!fs.existsSync(uploadsDir)) {
    console.log('⚠️  Uploads directory not found:', uploadsDir);
    return;
  }
  
  console.log('\n📁 Scanning uploads directory...');
  const files = fs.readdirSync(uploadsDir);
  stats.uploads.scanned = files.length;
  
  for (const file of files) {
    try {
      const filePath = path.join(uploadsDir, file);
      const stat = fs.statSync(filePath);
      
      // Skip directories
      if (stat.isDirectory()) continue;
      
      const ageMs = now - stat.mtimeMs;
      const ageDays = Math.floor(ageMs / 86400000);
      
      if (ageMs > RETENTION_MS) {
        const sizeKB = Math.round(stat.size / 1024);
        
        if (isDryRun) {
          console.log(`  [DRY RUN] Would delete: ${file} (${ageDays} days old, ${sizeKB} KB)`);
        } else {
          fs.unlinkSync(filePath);
          console.log(`  ✅ Deleted: ${file} (${ageDays} days old, ${sizeKB} KB)`);
        }
        
        stats.uploads.deleted++;
        stats.uploads.bytes += stat.size;
      }
    } catch (err) {
      const errMsg = `Failed to process ${file}: ${err.message}`;
      console.error(`  ❌ ${errMsg}`);
      stats.errors.push(errMsg);
    }
  }
  
  const notDeleted = stats.uploads.scanned - stats.uploads.deleted;
  console.log(`\n📊 Uploads Summary:`);
  console.log(`   Scanned: ${stats.uploads.scanned} files`);
  console.log(`   Deleted: ${stats.uploads.deleted} files (${Math.round(stats.uploads.bytes / 1024 / 1024)} MB)`);
  console.log(`   Kept: ${notDeleted} files (within retention period)`);
}

/**
 * Clean processed.json records
 */
function cleanProcessed() {
  const processedPath = path.join(ROOT_DIR, 'data/processed.json');
  
  if (!fs.existsSync(processedPath)) {
    console.log('\n⚠️  processed.json not found');
    return;
  }
  
  console.log('\n📄 Cleaning processed.json records...');
  
  try {
    const data = JSON.parse(fs.readFileSync(processedPath, 'utf-8'));
    
    if (!Array.isArray(data)) {
      console.log('  ⚠️  processed.json is not an array, skipping');
      return;
    }
    
    stats.processed.total = data.length;
    
    const filtered = data.filter(doc => {
      if (!doc.timestamp) return true; // Keep if no timestamp
      
      const docTime = new Date(doc.timestamp).getTime();
      const ageMs = now - docTime;
      const ageDays = Math.floor(ageMs / 86400000);
      
      if (ageMs > RETENTION_MS) {
        const id = doc.id || doc.filename || 'unknown';
        if (isDryRun) {
          console.log(`  [DRY RUN] Would remove: ${id} (${ageDays} days old)`);
        } else {
          console.log(`  ✅ Removed: ${id} (${ageDays} days old)`);
        }
        stats.processed.removed++;
        return false; // Remove
      }
      
      return true; // Keep
    });
    
    if (!isDryRun && stats.processed.removed > 0) {
      fs.writeFileSync(processedPath, JSON.stringify(filtered, null, 2), 'utf-8');
      console.log(`  💾 Updated processed.json (${filtered.length} records remaining)`);
    }
    
    console.log(`\n📊 Processed Records Summary:`);
    console.log(`   Total: ${stats.processed.total} records`);
    console.log(`   Removed: ${stats.processed.removed} records`);
    console.log(`   Kept: ${filtered.length} records`);
    
  } catch (err) {
    const errMsg = `Failed to process processed.json: ${err.message}`;
    console.error(`  ❌ ${errMsg}`);
    stats.errors.push(errMsg);
  }
}

/**
 * Clean temporary OCR debug images
 */
function cleanOcrDebug() {
  const debugDir = process.env.MEDOCR_PREPROC_DEBUG_DIR || '/tmp/ocr-debug';
  
  if (!fs.existsSync(debugDir)) {
    console.log(`\n⚠️  OCR debug directory not found: ${debugDir}`);
    return;
  }
  
  console.log(`\n🖼️  Cleaning OCR debug images...`);
  
  try {
    const files = fs.readdirSync(debugDir);
    let deleted = 0;
    let bytesDeleted = 0;
    
    for (const file of files) {
      try {
        const filePath = path.join(debugDir, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory()) continue;
        
        const ageMs = now - stat.mtimeMs;
        
        // Delete debug images older than 7 days (shorter retention)
        if (ageMs > 7 * 86400000) {
          if (isDryRun) {
            console.log(`  [DRY RUN] Would delete: ${file}`);
          } else {
            fs.unlinkSync(filePath);
          }
          deleted++;
          bytesDeleted += stat.size;
        }
      } catch (err) {
        // Ignore individual file errors
      }
    }
    
    console.log(`   Deleted: ${deleted} debug images (${Math.round(bytesDeleted / 1024)} KB)`);
    
  } catch (err) {
    const errMsg = `Failed to clean OCR debug: ${err.message}`;
    console.error(`  ❌ ${errMsg}`);
    stats.errors.push(errMsg);
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    cleanUploads();
    cleanProcessed();
    cleanOcrDebug();
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ Cleanup Complete');
    console.log('='.repeat(60));
    
    if (stats.errors.length > 0) {
      console.log(`\n⚠️  Errors encountered: ${stats.errors.length}`);
      stats.errors.forEach((err, i) => {
        console.log(`   ${i + 1}. ${err}`);
      });
      process.exit(1);
    }
    
    if (isDryRun) {
      console.log('\n💡 This was a dry run. Re-run without --dry-run to actually delete files.');
    }
    
    process.exit(0);
    
  } catch (err) {
    console.error('\n❌ Fatal error:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
