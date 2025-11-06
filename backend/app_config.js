/**
 * Application Configuration Manager
 * Manages runtime configuration settings (NPI lookups, feature flags, etc.)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_FILE = path.join(__dirname, 'data/app_config.json');

class AppConfig {
  constructor() {
    this.config = this.loadConfig();
  }

  loadConfig() {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const data = fs.readFileSync(CONFIG_FILE, 'utf8');
        return JSON.parse(data);
      }
    } catch (err) {
      console.warn('Failed to load app config, using defaults:', err.message);
    }
    return this.getDefaults();
  }

  getDefaults() {
    return {
      npi: {
        enabled: true,
        description: 'Enable external NPI registry lookups for provider name validation'
      },
      metadata: {
        lastModified: null,
        version: '1.0.0'
      }
    };
  }

  saveConfig() {
    try {
      const dir = path.dirname(CONFIG_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.config.metadata.lastModified = new Date().toISOString();
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2));
      return true;
    } catch (err) {
      console.error('Failed to save app config:', err.message);
      return false;
    }
  }

  /**
   * Check if NPI lookups are enabled
   */
  isNpiEnabled() {
    return this.config?.npi?.enabled ?? true;
  }

  /**
   * Enable or disable NPI lookups
   */
  setNpiEnabled(enabled) {
    if (!this.config.npi) {
      this.config.npi = { enabled: true };
    }
    this.config.npi.enabled = !!enabled;
    return this.saveConfig();
  }

  /**
   * Get all configuration
   */
  getAll() {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  update(updates) {
    this.config = { ...this.config, ...updates };
    return this.saveConfig();
  }
}

const appConfig = new AppConfig();
export default appConfig;
