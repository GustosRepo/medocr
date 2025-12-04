import { useState, useEffect } from 'react';
import { Paper, Title, Text, Button, Stack, Group, Badge, ScrollArea } from '../ui/primitives.jsx';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4387';

export default function AIAnalysisPage() {
  const [documents, setDocuments] = useState([]);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    loadDocuments();
  }, []);

  const loadDocuments = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/ai-analysis/documents`);
      const data = await res.json();
      setDocuments(data.documents || []);
    } catch (error) {
      console.error('Failed to load documents:', error);
    }
  };

  const analyzeDocument = async (docId) => {
    setAnalyzing(true);
    setAnalysis(null);
    
    try {
      const res = await fetch(`${API_BASE}/api/ai-analysis/document/${docId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      const data = await res.json();
      
      if (data.success) {
        setAnalysis(data.analysis);
      } else {
        alert('Failed to analyze document: ' + (data.error?.message || 'Unknown error'));
      }
    } catch (error) {
      console.error('Failed to analyze document:', error);
      alert('Failed to analyze document');
    } finally {
      setAnalyzing(false);
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'success': return '✅';
      case 'warning': return '⚠️';
      case 'error': return '❌';
      default: return '●';
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'success': return 'green';
      case 'warning': return 'yellow';
      case 'error': return 'red';
      default: return 'gray';
    }
  };

  const filteredDocs = documents.filter(doc => 
    filter === 'all' ? true : doc.status === filter
  );

  const formatMarkdown = (text) => {
    if (!text) return '';
    
    return text
      .replace(/^### (.*$)/gim, '<h3 class="text-lg font-semibold mt-4 mb-2 text-slate-200">$1</h3>')
      .replace(/^## (.*$)/gim, '<h2 class="text-xl font-bold mt-6 mb-3 text-slate-200">$1</h2>')
      .replace(/^# (.*$)/gim, '<h1 class="text-2xl font-bold mt-8 mb-4 text-slate-200">$1</h1>')
      .replace(/\*\*(.*?)\*\*/gim, '<strong class="text-slate-100">$1</strong>')
      .replace(/\*(.*?)\*/gim, '<em class="text-slate-300">$1</em>')
      .replace(/\n\n/g, '</p><p class="mb-3 text-slate-300">')
      .replace(/\n/g, '<br />');
  };

  return (
    <div className="flex h-screen bg-slate-950">
      <div className="w-96 bg-slate-900 border-r border-slate-700 flex flex-col">
        <div className="p-4 border-b border-slate-700">
          <Title order={2} className="text-slate-100">Documents</Title>
          <Text size="sm" c="dimmed">{documents.length} processed documents</Text>
        </div>
        
        <Group gap="xs" className="p-4 border-b border-slate-700">
          <Button onClick={() => setFilter('all')} variant={filter === 'all' ? 'filled' : 'light'} size="xs">
            All ({documents.length})
          </Button>
          <Button onClick={() => setFilter('error')} variant={filter === 'error' ? 'filled' : 'light'} size="xs" color="red">
            Errors ({documents.filter(d => d.status === 'error').length})
          </Button>
          <Button onClick={() => setFilter('warning')} variant={filter === 'warning' ? 'filled' : 'light'} size="xs" color="yellow">
            Warnings ({documents.filter(d => d.status === 'warning').length})
          </Button>
        </Group>

        <ScrollArea className="flex-1" offsetScrollbars>
          <Stack gap="xs" className="p-4">
            {filteredDocs.length === 0 ? (
              <Text size="sm" c="dimmed" className="text-center py-8">No documents found</Text>
            ) : (
              filteredDocs.map((doc) => (
                <Paper 
                  key={doc.id} 
                  withBorder 
                  p="sm" 
                  className={`cursor-pointer transition-colors bg-slate-800/40 border-slate-700 hover:bg-slate-800/60 ${
                    selectedDoc?.id === doc.id ? 'ring-2 ring-sky-500' : ''
                  }`}
                  onClick={() => setSelectedDoc(doc)}
                >
                  <Group gap="xs">
                    <Text size="lg">{getStatusIcon(doc.status)}</Text>
                    <Stack gap="xs" className="flex-1">
                      <Text size="sm" fw={500} lineClamp={1} className="text-slate-100">{doc.filename}</Text>
                      <Text size="xs" c="dimmed">{doc.pages} pages • {doc.problemsCount} problems</Text>
                      {(doc.actionsCount > 0 || doc.warningsCount > 0) && (
                        <Text size="xs" c="dimmed">
                          {doc.actionsCount > 0 && `${doc.actionsCount} actions`}
                          {doc.actionsCount > 0 && doc.warningsCount > 0 && ' • '}
                          {doc.warningsCount > 0 && `${doc.warningsCount} warnings`}
                        </Text>
                      )}
                    </Stack>
                  </Group>
                </Paper>
              ))
            )}
          </Stack>
        </ScrollArea>
      </div>

      <div className="flex-1 overflow-y-auto bg-slate-950">
        <div className="max-w-4xl mx-auto p-6">
          {!selectedDoc ? (
            <div className="text-center py-12">
              <Text c="dimmed">Select a document to view details and analyze</Text>
            </div>
          ) : (
            <Stack gap="md">
              <Paper withBorder p="lg" className="bg-slate-900/40 border-slate-700">
                <Group justify="space-between" align="flex-start">
                  <Stack gap="xs">
                    <Group gap="xs">
                      <Text size="2xl">{getStatusIcon(selectedDoc.status)}</Text>
                      <div>
                        <Title order={3} className="text-slate-100">
                          {selectedDoc.filename === selectedDoc.id ? 'Unnamed Document' : selectedDoc.filename}
                        </Title>
                        <Text size="xs" className="text-slate-500 font-mono">ID: {selectedDoc.id}</Text>
                      </div>
                    </Group>
                    <Text size="sm" c="dimmed">{selectedDoc.dateLabel} at {selectedDoc.timeLabel}</Text>
                  </Stack>
                  <Button onClick={() => analyzeDocument(selectedDoc.id)} disabled={analyzing}>
                    {analyzing ? '🤖 Analyzing...' : '🔍 Analyze Document'}
                  </Button>
                </Group>
                
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div>
                    <Text size="sm" fw={500} className="text-slate-300">Status:</Text>
                    <Badge color={getStatusColor(selectedDoc.status)}>{selectedDoc.status.toUpperCase()}</Badge>
                  </div>
                  <div>
                    <Text size="sm" fw={500} className="text-slate-300">Pages:</Text>
                    <Text size="sm" className="text-slate-200">{selectedDoc.pages}</Text>
                  </div>
                  <div>
                    <Text size="sm" fw={500} className="text-slate-300">Problems Extracted:</Text>
                    <Text size="sm" className="text-slate-200">{selectedDoc.problemsCount}</Text>
                  </div>
                  <div>
                    <Text size="sm" fw={500} className="text-slate-300">Actions Required:</Text>
                    <Text size="sm" className="text-slate-200">{selectedDoc.actionsCount}</Text>
                  </div>
                </div>
              </Paper>

              {analyzing && (
                <Paper withBorder p="xl" className="bg-slate-900/40 border-slate-700">
                  <div className="flex items-center justify-center">
                    <Stack gap="sm" align="center">
                      <Text size="4xl">🤖</Text>
                      <Text size="sm" fw={500} className="text-slate-200">Analyzing document with Ollama...</Text>
                      <Text size="xs" className="text-slate-400">{selectedDoc?.filename}</Text>
                      <Text size="xs" c="dimmed">This may take 20-40 seconds</Text>
                    </Stack>
                  </div>
                </Paper>
              )}

              {analysis && !analyzing && (
                <Paper withBorder p="lg" className="bg-slate-900/40 border-slate-700">
                  <Stack gap="md">
                    <div>
                      <Title order={4} className="text-slate-100">AI Analysis Result</Title>
                      <Text size="sm" fw={500} className="text-slate-300 mb-1">
                        Document: {analysis.filename === analysis.docId ? 'Unnamed Document' : analysis.filename}
                      </Text>
                      <Text size="xs" className="text-slate-500 font-mono mb-1">ID: {analysis.docId}</Text>
                      <Text size="xs" c="dimmed">Analyzed with {analysis.model}</Text>
                    </div>
                    
                    <div 
                      className="prose prose-invert max-w-none"
                      dangerouslySetInnerHTML={{ 
                        __html: `<p class="mb-3 text-slate-300">${formatMarkdown(analysis.aiSummary)}</p>` 
                      }}
                    />
                    
                    <details className="mt-6">
                      <summary className="cursor-pointer text-sm font-medium text-slate-300 hover:text-slate-100">
                        Show Raw Data (Debug)
                      </summary>
                      <pre className="mt-3 bg-slate-900/70 border border-slate-700 p-4 rounded-md overflow-x-auto text-xs text-slate-300">
                        {JSON.stringify(analysis.rawData, null, 2)}
                      </pre>
                    </details>
                  </Stack>
                </Paper>
              )}
            </Stack>
          )}
        </div>
      </div>
    </div>
  );
}
