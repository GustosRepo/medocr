import fs from 'fs';
import path from 'path';

const cache = new Map();

function logWarn(message) {
  try {
    // eslint-disable-next-line no-console
    console.warn(`[rules-config] ${message}`);
  } catch {
    // ignore logging issues
  }
}

export function loadJsonConfig(filename, { transform, defaultFactory } = {}) {
  const abs = path.resolve(process.cwd(), 'backend/rules/data', filename);
  try {
    const stat = fs.statSync(abs);
    const key = abs;
    const cached = cache.get(key);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached.value;
    }
    const raw = fs.readFileSync(abs, 'utf8');
    const parsed = JSON.parse(raw);
    const value = transform ? transform(parsed) : parsed;
    cache.set(key, { mtimeMs: stat.mtimeMs, value });
    return value;
  } catch (err) {
    const key = abs;
    if (cache.has(key)) {
      logWarn(`Using cached value for ${filename} after load error: ${err?.message || err}`);
      return cache.get(key).value;
    }
    if (typeof defaultFactory === 'function') {
      const value = defaultFactory(err);
      cache.set(key, { mtimeMs: null, value });
      logWarn(`Loaded default value for ${filename}: ${err?.message || err}`);
      return value;
    }
    logWarn(`No default for ${filename}; returning null (${err?.message || err})`);
    return null;
  }
}

export function invalidateConfigCache(filename) {
  if (!filename) {
    cache.clear();
    return;
  }
  const abs = path.resolve(process.cwd(), 'backend/rules/data', filename);
  cache.delete(abs);
}
