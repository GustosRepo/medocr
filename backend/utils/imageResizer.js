/**
 * Image Resizer - Convert PDF pages to lower-resolution images for LLM processing
 * Reduces memory usage and prevents Ollama crashes while maintaining readability
 */

// MUST import canvas setup first to polyfill browser APIs before pdfjs loads
import './canvasSetup.js';

import sharp from 'sharp';
import { pdfToPng } from 'pdf-to-png-converter';
import fs from 'fs/promises';
import path from 'path';
import { log } from '../logging/logger.js';

/**
 * Convert specific pages of a PDF to lower-resolution PNG images
 * @param {string} pdfPath - Path to the PDF file
 * @param {number[]} pageIndices - Array of page indices to convert (0-indexed)
 * @param {Object} options - Conversion options
 * @param {number} options.targetDPI - Target DPI for images (default: 150)
 * @param {number} options.maxWidth - Maximum width in pixels (default: 1600)
 * @param {number} options.quality - JPEG quality 1-100 (default: 85)
 * @param {string} options.outputDir - Directory for temporary images (default: data/temp)
 * @returns {Promise<Array>} Array of objects with {pageIndex, imagePath, size}
 */
export async function convertPdfPagesToImages(pdfPath, pageIndices, options = {}) {
  const {
    targetDPI = 150,
    maxWidth = 1600,
    quality = 85,
    outputDir = 'data/temp'
  } = options;

  const startTime = Date.now();
  const results = [];

  try {
    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true });

    log('info', 'pdf_conversion_start', {
      pdfPath,
      pageIndices,
      targetDPI,
      maxWidth,
      quality
    });

    // Convert PDF pages to PNG buffers
    // pdfToPng uses 1-based page numbers
    const pngPages = await pdfToPng(pdfPath, {
      disableFontFace: false,
      useSystemFonts: false,
      viewportScale: targetDPI / 72, // 72 DPI is default
      outputFolder: outputDir,
      pagesToProcess: pageIndices.map(i => i + 1), // Convert to 1-based
      strictPagesToProcess: true,
      verbosityLevel: 0
    });

    log('debug', 'pdf_to_png_complete', {
      pagesConverted: pngPages.length,
      duration: `${Date.now() - startTime}ms`
    });

    // Process each page image
    for (let i = 0; i < pngPages.length; i++) {
      const pageData = pngPages[i];
      const pageIndex = pageIndices[i];
      
      try {
        // Resize and optimize the image using sharp
        const imageBuffer = pageData.content;
        const metadata = await sharp(imageBuffer).metadata();
        
        log('debug', 'image_metadata', {
          page: pageIndex,
          originalWidth: metadata.width,
          originalHeight: metadata.height,
          originalSize: imageBuffer.length
        });

        // Calculate resize dimensions
        let resizeWidth = metadata.width;
        let resizeHeight = metadata.height;
        
        if (resizeWidth > maxWidth) {
          const scale = maxWidth / resizeWidth;
          resizeWidth = maxWidth;
          resizeHeight = Math.round(resizeHeight * scale);
        }

        // Resize and compress
        const processedBuffer = await sharp(imageBuffer)
          .resize(resizeWidth, resizeHeight, {
            fit: 'inside',
            withoutEnlargement: true
          })
          .jpeg({
            quality,
            progressive: true,
            mozjpeg: true
          })
          .toBuffer();

        // Save to disk
        const fileName = `page_${pageIndex + 1}_lowres.jpg`;
        const outputPath = path.join(outputDir, fileName);
        await fs.writeFile(outputPath, processedBuffer);

        const reductionPercent = Math.round((1 - processedBuffer.length / imageBuffer.length) * 100);

        log('info', 'image_processed', {
          page: pageIndex,
          width: resizeWidth,
          height: resizeHeight,
          originalSize: imageBuffer.length,
          processedSize: processedBuffer.length,
          reduction: `${reductionPercent}%`,
          outputPath
        });

        results.push({
          pageIndex,
          imagePath: outputPath,
          width: resizeWidth,
          height: resizeHeight,
          originalSize: imageBuffer.length,
          processedSize: processedBuffer.length,
          reduction: reductionPercent
        });

      } catch (error) {
        log('error', 'image_processing_failed', {
          page: pageIndex,
          error: error.message
        });
        // Continue with other pages
      }
    }

    const totalDuration = Date.now() - startTime;
    const totalOriginalSize = results.reduce((sum, r) => sum + r.originalSize, 0);
    const totalProcessedSize = results.reduce((sum, r) => sum + r.processedSize, 0);
    const avgReduction = Math.round((1 - totalProcessedSize / totalOriginalSize) * 100);

    log('info', 'pdf_conversion_complete', {
      pagesProcessed: results.length,
      totalOriginalSize,
      totalProcessedSize,
      avgReduction: `${avgReduction}%`,
      duration: `${totalDuration}ms`
    });

    return results;

  } catch (error) {
    log('error', 'pdf_conversion_failed', {
      pdfPath,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Clean up temporary image files
 * @param {Array} imageResults - Results from convertPdfPagesToImages
 */
export async function cleanupTempImages(imageResults) {
  if (!Array.isArray(imageResults)) return;

  for (const result of imageResults) {
    try {
      await fs.unlink(result.imagePath);
      log('debug', 'temp_image_deleted', { path: result.imagePath });
    } catch (error) {
      log('warn', 'temp_image_cleanup_failed', {
        path: result.imagePath,
        error: error.message
      });
    }
  }
}

/**
 * Convert a single page to a base64-encoded image for direct API use
 * @param {string} pdfPath - Path to the PDF file
 * @param {number} pageIndex - Page index (0-indexed)
 * @param {Object} options - Same as convertPdfPagesToImages
 * @returns {Promise<Object>} {pageIndex, base64Data, mimeType, size}
 */
export async function convertPageToBase64(pdfPath, pageIndex, options = {}) {
  const tempResults = await convertPdfPagesToImages(pdfPath, [pageIndex], options);
  
  if (tempResults.length === 0) {
    throw new Error(`Failed to convert page ${pageIndex}`);
  }

  const result = tempResults[0];
  const imageBuffer = await fs.readFile(result.imagePath);
  const base64Data = imageBuffer.toString('base64');

  // Clean up temp file
  await cleanupTempImages([result]);

  return {
    pageIndex,
    base64Data,
    mimeType: 'image/jpeg',
    size: result.processedSize,
    width: result.width,
    height: result.height
  };
}

export default {
  convertPdfPagesToImages,
  cleanupTempImages,
  convertPageToBase64
};
