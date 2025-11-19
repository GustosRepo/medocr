# Frontend Integration Guide

## Adding Dual-Engine Components to Existing UI

This guide shows how to integrate `DualEngineResults` and `DecisionTreeVisualization` into your existing document viewer pages.

## Step 1: Import Components

Add to your document detail page (e.g., `pages/DocumentDetail.jsx`):

```jsx
import DualEngineResults from '../components/DualEngineResults';
import DecisionTreeVisualization from '../components/DecisionTreeVisualization';
```

## Step 2: Add to Document View

Insert components in your render method:

```jsx
export default function DocumentDetail({ documentId }) {
  const [document, setDocument] = useState(null);
  
  // ... existing fetch logic ...
  
  return (
    <div className="space-y-6">
      {/* Existing header/metadata */}
      <DocumentHeader document={document} />
      
      {/* NEW: Dual-Engine Results */}
      {document?.dualEngine && (
        <DualEngineResults result={document} />
      )}
      
      {/* NEW: Decision Tree Routing */}
      {document?.routing && (
        <DecisionTreeVisualization routing={document.routing} />
      )}
      
      {/* Existing extracted data display */}
      <ExtractedDataPanel data={document} />
      
      {/* Existing PDF viewer */}
      <PDFViewer file={document.filePath} />
    </div>
  );
}
```

## Step 3: Add Toggle for OCR-Only Documents

For documents processed without LLM, show a message:

```jsx
{!document?.dualEngine || document.dualEngine.mode === 'ocr_only' ? (
  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
    <div className="flex items-center gap-2">
      <InfoIcon className="w-5 h-5 text-blue-600" />
      <div>
        <div className="font-semibold text-blue-900">
          OCR-Only Processing
        </div>
        <div className="text-sm text-blue-700">
          {document?.dualEngine?.reason || 'Processed with OCR only'}
        </div>
      </div>
    </div>
  </div>
) : (
  <>
    <DualEngineResults result={document} />
    <DecisionTreeVisualization routing={document.routing} />
  </>
)}
```

## Step 4: Add Dashboard Summary Cards

Create overview cards for batch processing dashboard:

```jsx
import { Zap, CheckCircle, AlertTriangle } from 'lucide-react';

export function DualEngineStats({ documents }) {
  const stats = documents.reduce((acc, doc) => {
    if (doc.dualEngine?.mode === 'ocr_llm_merged') {
      acc.dualEngine++;
      acc.totalAgreement += doc.dualEngine.agreementScore || 0;
      acc.conflicts += doc.dualEngine.conflictCount || 0;
    } else {
      acc.ocrOnly++;
    }
    return acc;
  }, { dualEngine: 0, ocrOnly: 0, totalAgreement: 0, conflicts: 0 });
  
  const avgAgreement = stats.dualEngine > 0 
    ? Math.round(stats.totalAgreement / stats.dualEngine) 
    : 0;
  
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-600">Dual-Engine</div>
            <div className="text-2xl font-bold text-purple-700">
              {stats.dualEngine}
            </div>
          </div>
          <Zap className="w-8 h-8 text-purple-500" />
        </div>
      </div>
      
      <div className="p-4 bg-green-50 rounded-lg border border-green-200">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-600">Avg Agreement</div>
            <div className="text-2xl font-bold text-green-700">
              {avgAgreement}%
            </div>
          </div>
          <CheckCircle className="w-8 h-8 text-green-500" />
        </div>
      </div>
      
      <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-200">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-600">Total Conflicts</div>
            <div className="text-2xl font-bold text-yellow-700">
              {stats.conflicts}
            </div>
          </div>
          <AlertTriangle className="w-8 h-8 text-yellow-500" />
        </div>
      </div>
    </div>
  );
}
```

## Step 5: Add Routing Action Badges

Show routing decision in document list:

```jsx
function RoutingBadge({ routing }) {
  if (!routing) return null;
  
  const colorMap = {
    green: 'bg-green-100 text-green-800 border-green-300',
    yellow: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    orange: 'bg-orange-100 text-orange-800 border-orange-300',
    red: 'bg-red-100 text-red-800 border-red-300'
  };
  
  const colors = colorMap[routing.color] || colorMap.yellow;
  
  return (
    <div className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-xs font-semibold ${colors}`}>
      <span className="w-2 h-2 rounded-full bg-current" />
      {routing.label}
    </div>
  );
}

// Usage in document list
<div className="flex items-center justify-between">
  <span>{document.filename}</span>
  <RoutingBadge routing={document.routing} />
</div>
```

## Step 6: Add Conflict Alert Banner

Show alert if conflicts need review:

```jsx
function ConflictAlert({ dualEngine }) {
  if (!dualEngine || dualEngine.conflictCount === 0) return null;
  
  return (
    <div className="p-4 bg-yellow-50 border-l-4 border-yellow-500 rounded">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5" />
        <div>
          <div className="font-semibold text-yellow-900">
            {dualEngine.conflictCount} Conflict{dualEngine.conflictCount !== 1 ? 's' : ''} Detected
          </div>
          <div className="text-sm text-yellow-800 mt-1">
            OCR and AI Vision produced different values for some fields. 
            Review conflicts below to ensure accuracy.
          </div>
        </div>
      </div>
    </div>
  );
}
```

## Step 7: Add Settings Toggle

Allow users to enable/disable LLM processing:

```jsx
function DualEngineSettings() {
  const [enabled, setEnabled] = useState(true);
  
  const handleToggle = async () => {
    await fetch('/api/settings/dual-engine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !enabled })
    });
    setEnabled(!enabled);
  };
  
  return (
    <div className="p-4 border rounded-lg">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold">Dual-Engine Processing</div>
          <div className="text-sm text-gray-600">
            Run OCR + AI Vision on all documents
          </div>
        </div>
        <button
          onClick={handleToggle}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            enabled ? 'bg-blue-600' : 'bg-gray-200'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
    </div>
  );
}
```

## Complete Example: Document Detail Page

```jsx
import React, { useState, useEffect } from 'react';
import DualEngineResults from '../components/DualEngineResults';
import DecisionTreeVisualization from '../components/DecisionTreeVisualization';
import { AlertTriangle, CheckCircle, Download } from 'lucide-react';

export default function DocumentDetailPage({ documentId }) {
  const [document, setDocument] = useState(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    fetchDocument();
  }, [documentId]);
  
  const fetchDocument = async () => {
    try {
      const res = await fetch(`/api/documents/${documentId}`);
      const data = await res.json();
      setDocument(data);
    } catch (error) {
      console.error('Failed to fetch document:', error);
    } finally {
      setLoading(false);
    }
  };
  
  if (loading) return <div>Loading...</div>;
  if (!document) return <div>Document not found</div>;
  
  const isDualEngine = document.dualEngine?.mode === 'ocr_llm_merged';
  const hasConflicts = document.dualEngine?.conflictCount > 0;
  
  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {document.documentMeta?.filename}
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Processed {new Date(document.documentMeta?.intakeDate).toLocaleDateString()}
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          {isDualEngine && (
            <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 rounded-lg border border-purple-200">
              <Zap className="w-4 h-4 text-purple-600" />
              <span className="text-sm font-semibold text-purple-700">
                Dual-Engine
              </span>
            </div>
          )}
          
          <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
      </div>
      
      {/* Conflict Alert */}
      {hasConflicts && (
        <div className="p-4 bg-yellow-50 border-l-4 border-yellow-500 rounded">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5" />
            <div>
              <div className="font-semibold text-yellow-900">
                {document.dualEngine.conflictCount} Conflict{document.dualEngine.conflictCount !== 1 ? 's' : ''} Detected
              </div>
              <div className="text-sm text-yellow-800 mt-1">
                Review conflicts below to ensure data accuracy.
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Dual-Engine Results */}
      {isDualEngine && <DualEngineResults result={document} />}
      
      {/* Decision Tree Routing */}
      {document.routing && <DecisionTreeVisualization routing={document.routing} />}
      
      {/* Extracted Data */}
      <div className="border rounded-lg p-6 bg-white">
        <h2 className="text-lg font-semibold mb-4">Extracted Data</h2>
        
        {/* Patient Info */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <label className="text-sm font-medium text-gray-600">Patient Name</label>
            <div className="text-base font-semibold">
              {document.patient?.last}, {document.patient?.first}
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-600">Date of Birth</label>
            <div className="text-base font-semibold">
              {document.patient?.dob}
            </div>
          </div>
        </div>
        
        {/* More fields... */}
      </div>
      
      {/* PDF Viewer */}
      <div className="border rounded-lg overflow-hidden">
        <iframe
          src={`/api/documents/${documentId}/pdf`}
          className="w-full h-[800px]"
          title="Document Preview"
        />
      </div>
    </div>
  );
}
```

## Styling Tips

### Tailwind Classes Used
- `bg-purple-50`, `border-purple-200` - Dual-engine theme
- `bg-green-50`, `text-green-600` - Success/passed
- `bg-yellow-50`, `text-yellow-600` - Warnings/conflicts
- `bg-red-50`, `text-red-600` - Errors/failures
- `rounded-lg` - Consistent border radius
- `shadow-sm` - Subtle shadows
- `space-y-4` - Vertical spacing

### Custom CSS (Optional)

Add to `app.css`:
```css
.dual-engine-card {
  @apply p-4 bg-white rounded-lg shadow-sm border hover:shadow-md transition-shadow;
}

.conflict-badge {
  @apply inline-flex items-center px-2 py-1 text-xs font-semibold rounded;
}

.routing-action {
  @apply flex items-center gap-2 p-4 rounded-lg border-l-4;
}
```

## Testing

1. Upload a document
2. Check for `dualEngine` field in response
3. Verify components render correctly
4. Test conflict resolution display
5. Validate routing decision visualization

That's it! The dual-engine components are now integrated into your UI.
