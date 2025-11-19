/**
 * Ollama Service Monitor
 * Provides health checks and processing statistics for Ollama LLM integration
 */

import fetch from 'node-fetch';
import { log } from './logging/logger.js';

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

/**
 * Get Ollama service health and model information
 */
export async function getOllamaHealth() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${OLLAMA_HOST}/api/tags`, {
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return {
        status: 'unhealthy',
        available: false,
        message: `HTTP ${response.status}`,
        host: OLLAMA_HOST
      };
    }

    const data = await response.json();
    const models = data.models || [];
    const llavaModel = models.find(m => m.name.includes('llava-phi3'));

    return {
      status: 'healthy',
      available: true,
      host: OLLAMA_HOST,
      models: models.map(m => ({
        name: m.name,
        size: m.size,
        modifiedAt: m.modified_at
      })),
      llavaInstalled: !!llavaModel,
      modelSize: llavaModel ? (llavaModel.size / (1024 * 1024 * 1024)).toFixed(2) + ' GB' : null,
      modifiedAt: llavaModel?.modified_at || null
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      return {
        status: 'timeout',
        available: false,
        message: 'Request timed out after 5s',
        host: OLLAMA_HOST
      };
    }
    return {
      status: 'error',
      available: false,
      message: error.message,
      host: OLLAMA_HOST
    };
  }
}

/**
 * Monitor for tracking Ollama processing statistics
 */
export class OllamaMonitor {
  constructor() {
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalProcessingTime: 0,
      avgProcessingTime: 0,
      minProcessingTime: null,
      maxProcessingTime: null,
      lastRequestTime: null,
      lastSuccessTime: null,
      lastError: null,
      recentErrors: []
    };
  }

  /**
   * Record a request to Ollama
   */
  recordRequest(success, duration, error = null) {
    const now = new Date().toISOString();
    this.stats.totalRequests++;
    this.stats.lastRequestTime = now;

    if (success) {
      this.stats.successfulRequests++;
      this.stats.lastSuccessTime = now;
      this.stats.totalProcessingTime += duration;
      this.stats.avgProcessingTime = 
        this.stats.totalProcessingTime / this.stats.successfulRequests;
      
      // Update min/max
      if (this.stats.minProcessingTime === null || duration < this.stats.minProcessingTime) {
        this.stats.minProcessingTime = duration;
      }
      if (this.stats.maxProcessingTime === null || duration > this.stats.maxProcessingTime) {
        this.stats.maxProcessingTime = duration;
      }
    } else {
      this.stats.failedRequests++;
      if (error) {
        const errorEntry = {
          timestamp: now,
          message: error.message || String(error),
          type: error.name || 'Error'
        };
        this.stats.lastError = errorEntry;
        this.stats.recentErrors.push(errorEntry);
        
        // Keep only last 10 errors
        if (this.stats.recentErrors.length > 10) {
          this.stats.recentErrors.shift();
        }
      }
    }

    log('debug', 'ollama_request_recorded', {
      success,
      duration: duration ? `${Math.round(duration)}ms` : 'N/A',
      total: this.stats.totalRequests,
      successRate: this.getSuccessRate()
    });
  }

  /**
   * Get success rate as percentage
   */
  getSuccessRate() {
    if (this.stats.totalRequests === 0) return 'N/A';
    return ((this.stats.successfulRequests / this.stats.totalRequests) * 100).toFixed(2) + '%';
  }

  /**
   * Get formatted statistics
   */
  getStats() {
    return {
      ...this.stats,
      successRate: this.getSuccessRate(),
      avgProcessingTime: this.stats.avgProcessingTime 
        ? `${Math.round(this.stats.avgProcessingTime)}ms` 
        : 'N/A',
      minProcessingTime: this.stats.minProcessingTime 
        ? `${Math.round(this.stats.minProcessingTime)}ms` 
        : 'N/A',
      maxProcessingTime: this.stats.maxProcessingTime 
        ? `${Math.round(this.stats.maxProcessingTime)}ms` 
        : 'N/A'
    };
  }

  /**
   * Reset all statistics
   */
  reset() {
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalProcessingTime: 0,
      avgProcessingTime: 0,
      minProcessingTime: null,
      maxProcessingTime: null,
      lastRequestTime: null,
      lastSuccessTime: null,
      lastError: null,
      recentErrors: []
    };
    log('info', 'ollama_monitor_reset');
  }
}

// Global monitor instance
export const ollamaMonitor = new OllamaMonitor();
