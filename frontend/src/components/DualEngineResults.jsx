/**
 * DualEngineResults Component
 * 
 * Displays results from dual-engine (OCR + LLM) processing with:
 * - Agreement score visualization
 * - Conflict display with resolution reasoning
 * - Side-by-side comparison of OCR vs LLM values
 * - Expandable detail views
 * - Data quality assessment
 */

import React, { useState } from 'react';
import { 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  ChevronDown, 
  ChevronRight,
  Eye,
  Zap
} from 'lucide-react';

export default function DualEngineResults({ result }) {
  const [expandedSections, setExpandedSections] = useState({
    conflicts: true,
    matched: false,
    original: false
  });

  // Extract dual-engine data
  const dualEngine = result?.dualEngine;
  
  if (!dualEngine || dualEngine.mode !== 'ocr_llm_merged') {
    return null; // Only show for dual-engine processed documents
  }

  const {
    agreementScore = 0,
    conflictCount = 0,
    conflicts = [],
    dataQuality = {},
    originalOCR = {},
    originalLLM = {}
  } = dualEngine;

  // Toggle section expansion
  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  // Get color based on score
  const getScoreColor = (score) => {
    if (score >= 90) return 'text-green-600 bg-green-50 border-green-200';
    if (score >= 80) return 'text-blue-600 bg-blue-50 border-blue-200';
    if (score >= 70) return 'text-yellow-600 bg-yellow-50 border-yellow-200';
    return 'text-red-600 bg-red-50 border-red-200';
  };

  // Get grade emoji
  const getGradeEmoji = (grade) => {
    const emojis = { A: '🏆', B: '✅', C: '⚠️', D: '❌', F: '🚫' };
    return emojis[grade] || '❓';
  };

  // Format field name for display
  const formatFieldName = (path) => {
    return path
      .split('.')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' → ');
  };

  // Get strategy badge color
  const getStrategyColor = (strategy) => {
    const colors = {
      exact_match: 'bg-green-100 text-green-800',
      fuzzy_match: 'bg-blue-100 text-blue-800',
      llm_only: 'bg-purple-100 text-purple-800',
      ocr_only: 'bg-orange-100 text-orange-800',
      conflict_prefer_llm: 'bg-red-100 text-red-800',
      field_specific_rule: 'bg-indigo-100 text-indigo-800'
    };
    return colors[strategy] || 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="space-y-4 p-4 bg-white rounded-lg shadow-sm border">
      {/* Header with Agreement Score */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-purple-500 to-blue-500 rounded-lg">
            <Zap className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              Dual-Engine Analysis
            </h3>
            <p className="text-sm text-gray-600">
              OCR + AI Vision Validation
            </p>
          </div>
        </div>

        {/* Agreement Score Badge */}
        <div className={`px-4 py-2 rounded-lg border-2 ${getScoreColor(agreementScore)}`}>
          <div className="text-center">
            <div className="text-2xl font-bold">{agreementScore}%</div>
            <div className="text-xs uppercase tracking-wide">Agreement</div>
          </div>
        </div>
      </div>

      {/* Data Quality Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Quality Grade */}
        <div className="p-4 bg-gray-50 rounded-lg border">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-gray-600">Quality Grade</div>
              <div className="text-2xl font-bold text-gray-900 mt-1">
                {dataQuality.grade || 'N/A'} {getGradeEmoji(dataQuality.grade)}
              </div>
            </div>
          </div>
          <div className="mt-2 text-xs text-gray-500">
            Score: {dataQuality.score || 0}/100
          </div>
        </div>

        {/* Conflicts */}
        <div className="p-4 bg-gray-50 rounded-lg border">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-gray-600">Conflicts Found</div>
              <div className="text-2xl font-bold text-gray-900 mt-1">
                {conflictCount}
              </div>
            </div>
            {conflictCount > 0 ? (
              <AlertTriangle className="w-8 h-8 text-yellow-500" />
            ) : (
              <CheckCircle className="w-8 h-8 text-green-500" />
            )}
          </div>
          <div className="mt-2 text-xs text-gray-500">
            {conflictCount > 0 ? 'Requires review' : 'All fields agree'}
          </div>
        </div>

        {/* Processing Time */}
        <div className="p-4 bg-gray-50 rounded-lg border">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-gray-600">Processing Time</div>
              <div className="text-2xl font-bold text-gray-900 mt-1">
                {Math.round((dualEngine.timing?.total || 0) / 1000)}s
              </div>
            </div>
          </div>
          <div className="mt-2 text-xs text-gray-500">
            OCR: {Math.round((dualEngine.timing?.ocr || 0) / 1000)}s | 
            LLM: {Math.round((dualEngine.timing?.llm || 0) / 1000)}s
          </div>
        </div>
      </div>

      {/* Conflicts Section */}
      {conflictCount > 0 && (
        <div className="border rounded-lg">
          <button
            onClick={() => toggleSection('conflicts')}
            className="w-full px-4 py-3 flex items-center justify-between bg-yellow-50 hover:bg-yellow-100 rounded-t-lg transition-colors"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-600" />
              <span className="font-semibold text-gray-900">
                Conflicts & Resolutions ({conflictCount})
              </span>
            </div>
            {expandedSections.conflicts ? (
              <ChevronDown className="w-5 h-5 text-gray-500" />
            ) : (
              <ChevronRight className="w-5 h-5 text-gray-500" />
            )}
          </button>

          {expandedSections.conflicts && (
            <div className="p-4 space-y-3">
              {conflicts.map((conflict, idx) => (
                <div key={idx} className="border rounded-lg overflow-hidden">
                  {/* Conflict Header */}
                  <div className="bg-gray-50 px-4 py-2 border-b">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-900">
                        {formatFieldName(conflict.field)}
                      </span>
                      <span className={`px-2 py-1 text-xs rounded ${getStrategyColor(conflict.strategy)}`}>
                        {conflict.strategy.replace(/_/g, ' ')}
                      </span>
                    </div>
                  </div>

                  {/* Comparison Grid */}
                  <div className="grid grid-cols-2 divide-x">
                    {/* OCR Value */}
                    <div className="p-3">
                      <div className="text-xs font-medium text-gray-500 mb-1">OCR</div>
                      <div className="text-sm font-mono bg-blue-50 p-2 rounded border border-blue-200">
                        {conflict.ocrValue || <span className="text-gray-400 italic">empty</span>}
                      </div>
                    </div>

                    {/* LLM Value */}
                    <div className="p-3">
                      <div className="text-xs font-medium text-gray-500 mb-1">AI Vision</div>
                      <div className="text-sm font-mono bg-purple-50 p-2 rounded border border-purple-200">
                        {conflict.llmValue || <span className="text-gray-400 italic">empty</span>}
                      </div>
                    </div>
                  </div>

                  {/* Resolution */}
                  <div className="bg-green-50 px-4 py-2 border-t border-green-200">
                    <div className="flex items-start gap-2">
                      <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <div className="text-xs font-medium text-green-900">Resolved Value:</div>
                        <div className="text-sm font-mono text-green-800 mt-1">
                          {conflict.resolved}
                        </div>
                        {conflict.note && (
                          <div className="text-xs text-green-700 mt-1">
                            {conflict.note}
                            {conflict.similarity && ` (${conflict.similarity}% similar)`}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Recommendation */}
      <div className={`p-4 rounded-lg border-l-4 ${
        dataQuality.level === 'high' 
          ? 'bg-green-50 border-green-500' 
          : dataQuality.level === 'medium'
          ? 'bg-yellow-50 border-yellow-500'
          : 'bg-red-50 border-red-500'
      }`}>
        <div className="flex items-start gap-3">
          {dataQuality.level === 'high' ? (
            <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
          ) : dataQuality.level === 'medium' ? (
            <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5" />
          ) : (
            <XCircle className="w-5 h-5 text-red-600 mt-0.5" />
          )}
          <div>
            <div className="font-semibold text-gray-900">Recommendation</div>
            <div className="text-sm text-gray-700 mt-1">
              {dataQuality.recommendation || 'No recommendation available'}
            </div>
          </div>
        </div>
      </div>

      {/* Original Results Toggle */}
      <div className="border rounded-lg">
        <button
          onClick={() => toggleSection('original')}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 rounded-lg transition-colors"
        >
          <div className="flex items-center gap-2">
            <Eye className="w-5 h-5 text-gray-500" />
            <span className="font-medium text-gray-700">
              View Original OCR & LLM Results
            </span>
          </div>
          {expandedSections.original ? (
            <ChevronDown className="w-5 h-5 text-gray-500" />
          ) : (
            <ChevronRight className="w-5 h-5 text-gray-500" />
          )}
        </button>

        {expandedSections.original && (
          <div className="p-4 border-t">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Original OCR */}
              <div>
                <div className="font-medium text-gray-700 mb-2">Original OCR</div>
                <pre className="text-xs bg-blue-50 p-3 rounded border border-blue-200 overflow-auto max-h-96">
                  {JSON.stringify(originalOCR, null, 2)}
                </pre>
              </div>

              {/* Original LLM */}
              <div>
                <div className="font-medium text-gray-700 mb-2">Original AI Vision</div>
                <pre className="text-xs bg-purple-50 p-3 rounded border border-purple-200 overflow-auto max-h-96">
                  {JSON.stringify(originalLLM, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
