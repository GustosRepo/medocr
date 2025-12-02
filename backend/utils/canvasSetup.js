/**
 * Canvas Setup - Must be imported BEFORE any pdfjs usage
 * Sets up browser-like globals that pdfjs-dist expects
 */

import canvas from 'canvas';
import { createRequire } from 'module';

const { createCanvas, loadImage, Image, ImageData: CanvasImageData } = canvas;

// Create require function for ES modules
const require = createRequire(import.meta.url);

// Polyfill process.getBuiltinModule for Node 18 (pdfjs expects Node 22+)
if (!process.getBuiltinModule) {
  process.getBuiltinModule = function(module) {
    return require(module);
  };
}

// Polyfill DOMMatrix
if (!globalThis.DOMMatrix) {
  globalThis.DOMMatrix = class DOMMatrix {
    constructor(init) {
      if (!init) {
        this.a = 1; this.b = 0; this.c = 0;
        this.d = 1; this.e = 0; this.f = 0;
      } else if (typeof init === 'string') {
        this.a = 1; this.b = 0; this.c = 0;
        this.d = 1; this.e = 0; this.f = 0;
      } else if (Array.isArray(init)) {
        [this.a, this.b, this.c, this.d, this.e, this.f] = init;
      }
    }
    
    scale(sx, sy = sx) {
      const m = new DOMMatrix();
      m.a = this.a * sx;
      m.b = this.b * sx;
      m.c = this.c * sy;
      m.d = this.d * sy;
      m.e = this.e;
      m.f = this.f;
      return m;
    }
    
    translate(tx, ty = 0) {
      const m = new DOMMatrix();
      m.a = this.a;
      m.b = this.b;
      m.c = this.c;
      m.d = this.d;
      m.e = this.a * tx + this.c * ty + this.e;
      m.f = this.b * tx + this.d * ty + this.f;
      return m;
    }
    
    rotate(angle) {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const m = new DOMMatrix();
      m.a = this.a * cos + this.c * sin;
      m.b = this.b * cos + this.d * sin;
      m.c = this.c * cos - this.a * sin;
      m.d = this.d * cos - this.b * sin;
      m.e = this.e;
      m.f = this.f;
      return m;
    }
  };
}

// Polyfill Path2D
if (!globalThis.Path2D) {
  globalThis.Path2D = class Path2D {
    constructor() {
      this.ops = [];
    }
  };
}

// Polyfill ImageData
if (!globalThis.ImageData) {
  globalThis.ImageData = CanvasImageData;
}

// Polyfill Image
if (!globalThis.Image) {
  globalThis.Image = Image;
}

console.log('[CanvasSetup] Polyfills installed: DOMMatrix, Path2D, ImageData, Image');
