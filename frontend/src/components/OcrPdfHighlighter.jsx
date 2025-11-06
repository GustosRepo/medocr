import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.mjs?url';

GlobalWorkerOptions.workerSrc = workerSrc;

const DEFAULT_SCOPE_COLORS = {
  patient: '#1f8efa',
  provider: '#f97316',
  facility: '#22c55e',
  default: '#8b5cf6'
};

function normalizeColor(color) {
  if (!color) return '#ff0000';
  if (color.startsWith('#') && (color.length === 7 || color.length === 4)) {
    return color;
  }
  return color;
}

function hexToRgba(color, alpha) {
  if (!color || !color.startsWith('#')) return color;
  const hex = color.replace('#', '');
  const fullHex = hex.length === 3
    ? hex.split('').map(ch => ch + ch).join('')
    : hex.padEnd(6, '0');
  const r = parseInt(fullHex.slice(0, 2), 16);
  const g = parseInt(fullHex.slice(2, 4), 16);
  const b = parseInt(fullHex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const emptySpanArray = [];

export default function OcrPdfHighlighter({
  pdfUrl,
  spans = emptySpanArray,
  width = 800,
  scopeColors = DEFAULT_SCOPE_COLORS,
  showLabels = true,
  className = '',
  style = {}
}) {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const pdfDocRef = useRef(null);
  const pageViewportsRef = useRef({});
  const pageCanvasRefs = useRef(new Map());
  const overlayCanvasRefs = useRef(new Map());
  const renderGenerationRef = useRef(0);

  const isNumericWidth = typeof width === 'number' && !Number.isNaN(width);

  useEffect(() => {
    let cancelled = false;
    const currentGen = renderGenerationRef.current + 1;
    renderGenerationRef.current = currentGen;
    setPages([]);
    setError('');
    pdfDocRef.current = null;
    pageViewportsRef.current = {};
    pageCanvasRefs.current = new Map();
    overlayCanvasRefs.current = new Map();

    if (!pdfUrl) {
      setLoading(false);
      return () => { cancelled = true; };
    }

    setLoading(true);

    const loadDocument = async () => {
      try {
        const loadingTask = getDocument({ url: pdfUrl });
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        pdfDocRef.current = pdf;
        const metadata = [];

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
          const page = await pdf.getPage(pageNumber);
          if (cancelled) return;
          const baseViewport = page.getViewport({ scale: 1 });
          const targetWidth = isNumericWidth ? width : baseViewport.width;
          const scale = targetWidth / baseViewport.width;
          const scaledViewport = page.getViewport({ scale });
          pageViewportsRef.current[pageNumber] = scaledViewport;
          metadata.push({
            pageNumber,
            width: scaledViewport.width,
            height: scaledViewport.height,
            scale
          });
        }

        if (!cancelled && renderGenerationRef.current === currentGen) {
          setPages(metadata);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || 'Failed to load PDF');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadDocument();

    return () => { cancelled = true; };
  }, [pdfUrl, isNumericWidth, width]);

  useEffect(() => {
    if (!pdfDocRef.current || !pages.length) return undefined;
    let cancelled = false;
    const currentGen = renderGenerationRef.current;

    const renderPages = async () => {
      for (const meta of pages) {
        if (cancelled) break;
        try {
          const page = await pdfDocRef.current.getPage(meta.pageNumber);
          if (cancelled || renderGenerationRef.current !== currentGen) break;
          const canvas = pageCanvasRefs.current.get(meta.pageNumber);
          if (!canvas) continue;
          const ctx = canvas.getContext('2d');
          const viewport = pageViewportsRef.current[meta.pageNumber];
          if (!viewport) continue;
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const overlayCanvas = overlayCanvasRefs.current.get(meta.pageNumber);
          if (overlayCanvas) {
            overlayCanvas.width = viewport.width;
            overlayCanvas.height = viewport.height;
            const overlayCtx = overlayCanvas.getContext('2d');
            overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
          }
          await page.render({ canvasContext: ctx, viewport }).promise;
        } catch (err) {
          if (!cancelled) setError(err?.message || 'Failed to render page');
        }
      }
    };

    renderPages();
    return () => { cancelled = true; };
  }, [pages]);

  const spansByPage = useMemo(() => {
    if (!Array.isArray(spans)) return new Map();
    const map = new Map();
    spans.forEach(span => {
      const pageNum = Number(span?.page) || 1;
      if (!map.has(pageNum)) map.set(pageNum, []);
      map.get(pageNum).push(span);
    });
    return map;
  }, [spans]);

  useEffect(() => {
    if (!pages.length) return;
    pages.forEach(meta => {
      const overlay = overlayCanvasRefs.current.get(meta.pageNumber);
      const viewport = pageViewportsRef.current[meta.pageNumber];
      if (!overlay || !viewport) return;
      const ctx = overlay.getContext('2d');
      overlay.width = viewport.width;
      overlay.height = viewport.height;
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      const spansForPage = spansByPage.get(meta.pageNumber) || [];
      spansForPage.forEach(span => {
        const bbox = span?.bbox;
        if (!bbox || typeof bbox.x !== 'number') return;
        const rectangles = viewport.convertToViewportRectangle([
          bbox.x,
          bbox.y,
          bbox.x + (bbox.width || 0),
          bbox.y + (bbox.height || 0)
        ]);
        const [x1, y1, x2, y2] = rectangles;
        const left = Math.min(x1, x2);
        const top = Math.min(y1, y2);
        const rectWidth = Math.abs(x2 - x1);
        const rectHeight = Math.abs(y2 - y1);
        const color = normalizeColor(scopeColors[span.scopeId] || scopeColors.default || DEFAULT_SCOPE_COLORS.default);
        ctx.save();
        ctx.lineWidth = 2;
        ctx.strokeStyle = hexToRgba(color, 0.9);
        ctx.globalAlpha = 1;
        ctx.strokeRect(left, top, rectWidth, rectHeight);
        ctx.fillStyle = hexToRgba(color, 0.2);
        ctx.fillRect(left, top, rectWidth, rectHeight);
        if (showLabels && span.field) {
          const labelPadding = 4;
          const labelHeight = 14;
          ctx.fillStyle = hexToRgba(color, 0.85);
          ctx.fillRect(left, Math.max(top - labelHeight - 2, 0), rectWidth, labelHeight + labelPadding);
          ctx.fillStyle = '#ffffff';
          ctx.font = '11px system-ui, sans-serif';
          ctx.textBaseline = 'top';
          ctx.fillText(String(span.field), left + 4, Math.max(top - labelHeight, 0) + 2, rectWidth - 6);
        }
        ctx.restore();
      });
    });
  }, [pages, spansByPage, scopeColors, showLabels]);

  const containerStyles = {
    width: isNumericWidth ? `${width}px` : '100%',
    ...style
  };

  if (!pdfUrl) {
    return (
      <div className={`ocr-pdf-highlighter ${className}`.trim()} style={containerStyles}>
        <div className="text-xs text-slate-400">No PDF selected.</div>
      </div>
    );
  }

  return (
    <div className={`ocr-pdf-highlighter space-y-4 ${className}`.trim()} style={containerStyles}>
      {loading && <div className="text-xs text-slate-400">Loading PDF…</div>}
      {error && !loading && (
        <div className="text-xs text-red-400">{error}</div>
      )}
      {pages.map(meta => (
        <div key={meta.pageNumber} className="relative border border-slate-700 rounded-md overflow-hidden shadow-sm">
          <canvas
            ref={el => {
              if (el) {
                pageCanvasRefs.current.set(meta.pageNumber, el);
              } else {
                pageCanvasRefs.current.delete(meta.pageNumber);
              }
            }}
            style={{ width: '100%', display: 'block' }}
          />
          <canvas
            ref={el => {
              if (el) {
                overlayCanvasRefs.current.set(meta.pageNumber, el);
              } else {
                overlayCanvasRefs.current.delete(meta.pageNumber);
              }
            }}
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              width: '100%',
              height: '100%'
            }}
          />
          <div className="absolute top-1 left-1 text-[10px] bg-slate-900/70 text-slate-200 px-2 py-1 rounded">
            Page {meta.pageNumber}
          </div>
        </div>
      ))}
    </div>
  );
}
