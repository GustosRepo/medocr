/**
 * DecisionTreeVisualization Component
 * 
 * Visualizes routing decision from decision tree analysis:
 * - Priority-based action recommendation
 * - Validation step results with status icons
 * - Required next steps
 * - Time estimates for workflow
 * - Visual flow from validation to action
 */

import React, { useState } from 'react';
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  ChevronRight,
  User,
  Shield,
  Activity,
  Stethoscope,
  MapPin,
  ArrowRight,
  Calendar,
  Phone,
  FileText,
  AlertOctagon
} from 'lucide-react';

export default function DecisionTreeVisualization({ routing }) {
  const [showDetails, setShowDetails] = useState(false);

  if (!routing) {
    return null;
  }

  const {
    action,
    priority,
    label,
    description,
    estimatedTime,
    color,
    nextSteps = [],
    validationSteps = [],
    validationSummary = {},
    context = {}
  } = routing;

  // Map colors to Tailwind classes
  const colorMap = {
    green: {
      bg: 'bg-green-100',
      border: 'border-green-500',
      text: 'text-green-800',
      icon: 'text-green-600',
      badge: 'bg-green-500'
    },
    yellow: {
      bg: 'bg-yellow-100',
      border: 'border-yellow-500',
      text: 'text-yellow-800',
      icon: 'text-yellow-600',
      badge: 'bg-yellow-500'
    },
    orange: {
      bg: 'bg-orange-100',
      border: 'border-orange-500',
      text: 'text-orange-800',
      icon: 'text-orange-600',
      badge: 'bg-orange-500'
    },
    red: {
      bg: 'bg-red-100',
      border: 'border-red-500',
      text: 'text-red-800',
      icon: 'text-red-600',
      badge: 'bg-red-500'
    }
  };

  const theme = colorMap[color] || colorMap.yellow;

  // Get icon for validation level
  const getValidationIcon = (level) => {
    const icons = {
      1: User,
      2: Shield,
      3: Activity,
      4: Stethoscope,
      5: MapPin
    };
    return icons[level] || AlertTriangle;
  };

  // Get icon for action
  const getActionIcon = (actionKey) => {
    const icons = {
      READY_TO_SCHEDULE: Calendar,
      INSURANCE_VERIFICATION: Shield,
      AUTHORIZATION_REQUEST: FileText,
      PROVIDER_FOLLOWUP: Phone,
      MANUAL_REVIEW: AlertOctagon
    };
    return icons[actionKey] || ArrowRight;
  };

  const ActionIcon = getActionIcon(action);

  // Priority badge
  const priorityColors = {
    1: 'bg-green-500',
    2: 'bg-blue-500',
    3: 'bg-yellow-500',
    4: 'bg-orange-500',
    5: 'bg-red-500'
  };

  return (
    <div className="space-y-4 p-4 bg-white rounded-lg shadow-sm border">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <ArrowRight className="w-5 h-5" />
          Routing Decision
        </h3>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-1 ${priorityColors[priority] || 'bg-gray-500'} text-white text-xs font-semibold rounded`}>
            P{priority}
          </span>
          <span className="text-xs text-gray-500">
            Est. {estimatedTime}
          </span>
        </div>
      </div>

      {/* Primary Action Card */}
      <div className={`${theme.bg} ${theme.border} border-l-4 rounded-lg p-4`}>
        <div className="flex items-start gap-3">
          <div className={`p-2 ${theme.badge} rounded-lg`}>
            <ActionIcon className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <h4 className={`text-lg font-semibold ${theme.text}`}>
              {label}
            </h4>
            <p className="text-sm text-gray-700 mt-1">
              {description}
            </p>
            {context.reason && (
              <div className="mt-2 text-sm text-gray-600 italic">
                Reason: {context.reason}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Clock className={`w-4 h-4 ${theme.icon}`} />
            <span className={`text-sm font-medium ${theme.text}`}>
              {estimatedTime}
            </span>
          </div>
        </div>
      </div>

      {/* Validation Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-green-50 rounded-lg p-3 border border-green-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-600" />
              <span className="text-sm font-medium text-gray-700">Passed</span>
            </div>
            <span className="text-2xl font-bold text-green-600">
              {validationSummary.passed || 0}
            </span>
          </div>
        </div>

        <div className="bg-red-50 rounded-lg p-3 border border-red-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <XCircle className="w-5 h-5 text-red-600" />
              <span className="text-sm font-medium text-gray-700">Failed</span>
            </div>
            <span className="text-2xl font-bold text-red-600">
              {validationSummary.failed || 0}
            </span>
          </div>
        </div>

        <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-gray-600" />
              <span className="text-sm font-medium text-gray-700">Total</span>
            </div>
            <span className="text-2xl font-bold text-gray-600">
              {validationSummary.total || 0}
            </span>
          </div>
        </div>
      </div>

      {/* Validation Steps */}
      <div className="border rounded-lg overflow-hidden">
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="w-full px-4 py-3 bg-gray-50 hover:bg-gray-100 flex items-center justify-between transition-colors"
        >
          <span className="font-medium text-gray-900">
            Validation Steps ({validationSteps.length})
          </span>
          <ChevronRight className={`w-5 h-5 text-gray-500 transition-transform ${showDetails ? 'rotate-90' : ''}`} />
        </button>

        {showDetails && (
          <div className="divide-y">
            {validationSteps.map((step, idx) => {
              const Icon = getValidationIcon(step.level);
              const isLast = idx === validationSteps.length - 1;
              
              return (
                <div key={idx} className="p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start gap-3">
                    {/* Step indicator with connecting line */}
                    <div className="flex flex-col items-center">
                      <div className={`p-2 rounded-lg ${
                        step.passed 
                          ? 'bg-green-100' 
                          : step.severity === 'critical' 
                          ? 'bg-red-100' 
                          : 'bg-yellow-100'
                      }`}>
                        <Icon className={`w-5 h-5 ${
                          step.passed 
                            ? 'text-green-600' 
                            : step.severity === 'critical' 
                            ? 'text-red-600' 
                            : 'text-yellow-600'
                        }`} />
                      </div>
                      {!isLast && (
                        <div className="w-0.5 h-8 bg-gray-200 my-1" />
                      )}
                    </div>

                    {/* Step content */}
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <h5 className="font-medium text-gray-900">
                          Level {step.level}: {step.name}
                        </h5>
                        {step.passed ? (
                          <CheckCircle className="w-5 h-5 text-green-600" />
                        ) : step.severity === 'critical' ? (
                          <XCircle className="w-5 h-5 text-red-600" />
                        ) : (
                          <AlertTriangle className="w-5 h-5 text-yellow-600" />
                        )}
                      </div>

                      <p className="text-sm text-gray-600 mt-1">
                        {step.message}
                      </p>

                      {/* Issues/Missing Fields */}
                      {(step.issues?.length > 0 || step.missingFields?.length > 0) && (
                        <div className="mt-2">
                          <div className="text-xs font-medium text-gray-500 mb-1">
                            {step.issues ? 'Issues:' : 'Missing Fields:'}
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {(step.issues || step.missingFields).map((item, i) => (
                              <span
                                key={i}
                                className="px-2 py-1 bg-red-100 text-red-800 text-xs rounded"
                              >
                                {item}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Urgent flag */}
                      {step.isUrgent && (
                        <div className="mt-2 flex items-center gap-1 text-xs text-red-600 font-semibold">
                          <AlertOctagon className="w-3 h-3" />
                          URGENT
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Next Steps */}
      {nextSteps.length > 0 && (
        <div className="border rounded-lg p-4">
          <h5 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <ArrowRight className="w-5 h-5" />
            Next Steps
          </h5>
          <ol className="space-y-2">
            {nextSteps.map((step, idx) => (
              <li key={idx} className="flex items-start gap-3">
                <div className="flex-shrink-0 w-6 h-6 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-sm font-semibold">
                  {idx + 1}
                </div>
                <span className="text-sm text-gray-700 pt-0.5">
                  {step}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Context Details */}
      {context.details?.length > 0 && (
        <div className={`${theme.bg} rounded-lg p-3 border ${theme.border}`}>
          <h5 className={`text-sm font-semibold ${theme.text} mb-2`}>
            Additional Context
          </h5>
          <ul className="space-y-1">
            {context.details.map((detail, idx) => (
              <li key={idx} className="text-xs text-gray-700 flex items-start gap-2">
                <ChevronRight className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span>{detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
