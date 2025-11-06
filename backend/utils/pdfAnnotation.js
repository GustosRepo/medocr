import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

const DEFAULT_SCOPE_COLORS = {
  patient: '#1f8efa',
  provider: '#f97316',
  facility: '#22c55e',
  default: '#8b5cf6'
};

function parseColor(input) {
  if (!input) {
    return { r: 1, g: 0, b: 0 };
  }
  if (Array.isArray(input) && input.length === 3) {
    const [r, g, b] = input;
    if (r <= 1 && g <= 1 && b <= 1) {
      return { r, g, b };
    }
    return { r: r / 255, g: g / 255, b: b / 255 };
  }
  if (typeof input === 'string' && input.startsWith('#')) {
    const hex = input.replace('#', '');
    const fullHex = hex.length === 3
      ? hex.split('').map(ch => ch + ch).join('')
      : hex.padEnd(6, '0');
    const r = parseInt(fullHex.slice(0, 2), 16) / 255;
    const g = parseInt(fullHex.slice(2, 4), 16) / 255;
    const b = parseInt(fullHex.slice(4, 6), 16) / 255;
    return { r, g, b };
  }
  return parseColor('#ff0000');
}

/**
 * Create an annotated PDF with OCR highlight rectangles.
 * @param {Uint8Array|ArrayBuffer|Buffer} pdfInput - Source PDF bytes.
 * @param {Array} spans - Array of span objects { page, bbox: { x, y, width, height }, scopeId, field } in PDF coordinate space.
 * @param {Object} [options]
 * @param {Object} [options.scopeColors] - Map of scopeId -> color (hex string or [r,g,b]).
 * @param {boolean} [options.drawLabels=true] - Whether to draw labels above rectangles.
 * @param {number} [options.strokeWidth=1.5] - Rectangle border width.
 * @param {number} [options.fillOpacity=0.18] - Fill opacity for highlight boxes.
 * @param {number} [options.borderOpacity=0.9] - Border opacity for highlight boxes.
 * @param {Object} [options.loadOptions] - Additional options passed to PDFDocument.load.
 * @returns {Promise<Uint8Array>} Annotated PDF bytes.
 */
export async function annotatePdfWithOcrSpans(pdfInput, spans = [], options = {}) {
  const {
    scopeColors = DEFAULT_SCOPE_COLORS,
    drawLabels = true,
    strokeWidth = 1.5,
    fillOpacity = 0.18,
    borderOpacity = 0.9,
    loadOptions = {}
  } = options;

  if (!pdfInput) throw new Error('pdfInput is required');

  const pdfDoc = await PDFDocument.load(pdfInput, loadOptions);
  const pages = pdfDoc.getPages();
  if (!pages.length) return pdfDoc.save();

  const spansArray = Array.isArray(spans) ? spans : [];
  let labelFont = null;

  for (const span of spansArray) {
    if (!span || !span.bbox) continue;
    const pageIndex = Math.max(0, (Number(span.page) || 1) - 1);
    if (pageIndex >= pages.length) continue;
    const page = pages[pageIndex];
    const { bbox } = span;
    const { x = 0, y = 0, width = 0, height = 0 } = bbox;
    if (width <= 0 || height <= 0) continue;

    const colorDef = parseColor(scopeColors[span.scopeId] || scopeColors.default || DEFAULT_SCOPE_COLORS.default);
    const borderColor = rgb(colorDef.r, colorDef.g, colorDef.b);

    page.drawRectangle({
      x,
      y,
      width,
      height,
      color: rgb(colorDef.r, colorDef.g, colorDef.b),
      opacity: fillOpacity,
      borderColor,
      borderOpacity,
      borderWidth: strokeWidth
    });

    if (drawLabels && span.field) {
      if (!labelFont) labelFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const labelText = String(span.field);
      const textSize = 10;
      const textWidth = labelFont.widthOfTextAtSize(labelText, textSize);
      const padding = 3;
      const labelWidth = Math.min(Math.max(textWidth + padding * 2, width), width + 24);
      const labelX = x;
      const labelY = y + height + 4;
      page.drawRectangle({
        x: labelX,
        y: labelY,
        width: labelWidth,
        height: textSize + padding,
        color: rgb(colorDef.r, colorDef.g, colorDef.b),
        opacity: Math.min(borderOpacity, 0.85)
      });
      page.drawText(labelText, {
        x: labelX + padding,
        y: labelY + padding / 2,
        size: textSize,
        font: labelFont,
        color: rgb(1, 1, 1)
      });
    }
  }

  return pdfDoc.save();
}

export { DEFAULT_SCOPE_COLORS as DEFAULT_ANNOTATION_SCOPE_COLORS };
