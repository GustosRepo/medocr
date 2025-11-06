/**
 * NPI (National Provider Identifier) Lookup Service
 * 
 * Uses the free CMS NPPES API to validate and correct provider names.
 * Caches results locally to minimize API calls.
 * 
 * HIPAA Note: Provider names are public business identifiers (not PHI).
 * Safe Harbor provision: Business names/addresses are not protected identifiers.
 * CMS NPPES is a public government registry - no PHI transmission occurs.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import appConfig from './app_config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const NPI_CACHE_FILE = path.join(__dirname, 'data/npi_cache.json');
const NPPES_API_BASE = 'https://npiregistry.cms.hhs.gov/api';

class NPIService {
  constructor() {
    this.cache = this.loadCache();
    this.requestQueue = [];
    this.rateLimitDelay = 200; // ms between requests to respect API limits
  }

  loadCache() {
    try {
      if (fs.existsSync(NPI_CACHE_FILE)) {
        const data = fs.readFileSync(NPI_CACHE_FILE, 'utf8');
        return JSON.parse(data);
      }
    } catch (err) {
      console.warn('Failed to load NPI cache:', err.message);
    }
    return {
      byName: {},
      byNPI: {},
      metadata: {
        totalEntries: 0,
        lastUpdated: null
      }
    };
  }

  saveCache() {
    try {
      const dir = path.dirname(NPI_CACHE_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(NPI_CACHE_FILE, JSON.stringify(this.cache, null, 2));
    } catch (err) {
      console.error('Failed to save NPI cache:', err.message);
    }
  }

  /**
   * Search for provider by name
   * @param {string} name - Provider name (e.g., "BEHZAD KERMANI")
   * @param {string} state - Optional state filter (e.g., "NV")
   * @returns {Promise<Array>} - Array of matching providers
   */
  async searchByName(name, state = null) {
    if (!name) return [];

    // Check if NPI lookups are disabled
    if (!appConfig.isNpiEnabled()) {
      console.log('[NPI] Lookups disabled via config, using cache only');
      const cacheKey = this.getCacheKey(name, state);
      if (this.cache.byName[cacheKey]) {
        const cached = this.cache.byName[cacheKey];
        if (Date.now() - cached.timestamp < 30 * 24 * 60 * 60 * 1000) {
          return cached.results;
        }
      }
      return []; // Return empty if disabled and not in cache
    }

    const cacheKey = this.getCacheKey(name, state);
    
    // Check cache first
    if (this.cache.byName[cacheKey]) {
      const cached = this.cache.byName[cacheKey];
      // Cache valid for 30 days
      if (Date.now() - cached.timestamp < 30 * 24 * 60 * 60 * 1000) {
        return cached.results;
      }
    }

    try {
      const params = new URLSearchParams();
      params.append('version', '2.1');
      
      // Parse name into first/last
      const nameParts = this.parseName(name);
      if (nameParts.firstName) params.append('first_name', nameParts.firstName);
      if (nameParts.lastName) params.append('last_name', nameParts.lastName);
      if (state) params.append('state', state);
      
      params.append('limit', '10');

      const url = `${NPPES_API_BASE}/?${params.toString()}`;
      
      // Rate limiting
      await this.sleep(this.rateLimitDelay);
      
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`NPI API error: ${response.status}`);
        return [];
      }

      const data = await response.json();
      const results = this.parseNPIResults(data);

      // Cache the results
      this.cache.byName[cacheKey] = {
        results,
        timestamp: Date.now()
      };
      this.cache.metadata.totalEntries = Object.keys(this.cache.byName).length;
      this.cache.metadata.lastUpdated = new Date().toISOString();
      this.saveCache();

      return results;
    } catch (err) {
      console.error('NPI lookup failed:', err.message);
      return [];
    }
  }

  /**
   * Fuzzy match provider name against NPI registry
   * @param {string} ocrName - OCR-extracted name (may have errors)
   * @param {string} state - Optional state filter
   * @returns {Promise<object|null>} - Best match or null
   */
  async fuzzyMatchProvider(ocrName, state = null) {
    if (!ocrName) return null;

    const results = await this.searchByName(ocrName, state);
    if (!results.length) return null;

    // Calculate similarity scores
    const matches = results.map(provider => ({
      ...provider,
      similarity: this.calculateNameSimilarity(ocrName, provider.fullName)
    }));

    // Sort by similarity
    matches.sort((a, b) => b.similarity - a.similarity);

    // Return best match if similarity is high enough
    const best = matches[0];
    if (best.similarity >= 0.7) {
      return {
        npi: best.npi,
        name: best.fullName,
        firstName: best.firstName,
        lastName: best.lastName,
        credential: best.credential,
        specialty: best.specialty,
        state: best.state,
        similarity: best.similarity,
        source: 'npi_registry'
      };
    }

    return null;
  }

  parseNPIResults(data) {
    if (!data.results || !Array.isArray(data.results)) return [];

    return data.results.map(result => {
      const basic = result.basic || {};
      const address = (result.addresses || []).find(a => a.address_purpose === 'LOCATION') || {};
      const taxonomy = (result.taxonomies || [])[0] || {};

      return {
        npi: result.number,
        firstName: basic.first_name || '',
        lastName: basic.last_name || '',
        fullName: `${basic.first_name || ''} ${basic.last_name || ''}`.trim(),
        credential: basic.credential || '',
        specialty: taxonomy.desc || '',
        state: address.state || '',
        city: address.city || '',
        phone: address.telephone_number || ''
      };
    });
  }

  parseName(name) {
    // Handle "LastName, FirstName" format
    if (name.includes(',')) {
      const [last, first] = name.split(',').map(s => s.trim());
      return { firstName: first, lastName: last };
    }

    // Handle "FirstName LastName" format
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return {
        firstName: parts[0],
        lastName: parts[parts.length - 1]
      };
    }

    // Single name - assume it's last name
    return { firstName: '', lastName: name.trim() };
  }

  calculateNameSimilarity(name1, name2) {
    const normalize = str => str.toLowerCase().replace(/[^a-z]/g, '');
    const s1 = normalize(name1);
    const s2 = normalize(name2);
    
    const maxLen = Math.max(s1.length, s2.length);
    if (maxLen === 0) return 1.0;
    
    const distance = this.levenshteinDistance(s1, s2);
    return 1 - (distance / maxLen);
  }

  levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  getCacheKey(name, state) {
    return `${name.toLowerCase().replace(/[^a-z]/g, '')}_${state || 'any'}`;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      totalEntries: this.cache.metadata.totalEntries,
      lastUpdated: this.cache.metadata.lastUpdated,
      cacheSize: JSON.stringify(this.cache).length
    };
  }
}

// Singleton instance
const npiService = new NPIService();

export default npiService;
