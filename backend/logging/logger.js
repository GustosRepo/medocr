// Simple structured logger with level gating and correlation id support.
import { sanitizeLogData } from '../utils/phiSanitizer.js';

const LEVELS = ['error','warn','info','debug','trace'];
const envLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();
const threshold = LEVELS.includes(envLevel) ? LEVELS.indexOf(envLevel) : 2;

function ts() { return new Date().toISOString(); }

export function log(level, msg, meta = {}) {
  const idx = LEVELS.indexOf(level);
  if (idx === -1 || idx > threshold) return;
  const base = { t: ts(), level, msg };
  
  // Sanitize meta to remove PHI before logging (Step 4)
  const sanitizedMeta = {};
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value === 'string') {
      sanitizedMeta[key] = sanitizeLogData(value);
    } else if (typeof value === 'object' && value !== null) {
      sanitizedMeta[key] = JSON.parse(sanitizeLogData(JSON.stringify(value)));
    } else {
      sanitizedMeta[key] = value;
    }
  }
  
  const out = { ...base, ...sanitizedMeta };
  try {
    process.stdout.write(JSON.stringify(out) + '\n');
  } catch (_) {}
}

export function classifyError(code) {
  if (!code) return 'system';
  const c = String(code).toLowerCase();
  if (['invalid_type','invalid_pdf','no_file','not_found','not_ready','rate_limited','bad_request'].includes(c)) return 'user';
  if (['ocr_failed','external_service_unavailable'].includes(c)) return 'external';
  if (['coverage_failed'].includes(c)) return 'system';
  if (c.endsWith('_failed')) return 'external';
  return c === 'internal_error' ? 'system' : 'system';
}

export function withReq(req) {
  return {
    error: (msg, meta) => log('error', msg, { rid: req.id, ...meta }),
    warn: (msg, meta) => log('warn', msg, { rid: req.id, ...meta }),
    info: (msg, meta) => log('info', msg, { rid: req.id, ...meta }),
    debug: (msg, meta) => log('debug', msg, { rid: req.id, ...meta }),
    trace: (msg, meta) => log('trace', msg, { rid: req.id, ...meta })
  };
}
