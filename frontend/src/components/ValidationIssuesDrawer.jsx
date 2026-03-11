import React, { useState } from 'react';
import { Text, Stack, Group, Badge, Button, Paper, Tooltip } from '../ui/primitives.jsx';
import { notifications } from '../ui/primitives.jsx';
import { IconAlertTriangle, IconCircleCheck, IconEdit, IconX, IconDeviceFloppy } from '@tabler/icons-react';

/**
 * ValidationIssuesDrawer - Shows LLM validation issues with inline editing
 * 
 * Props:
 * - isOpen: boolean - drawer open state
 * - onClose: function - close handler
 * - conflicts: array - list of validation issues from dualEngine.conflicts
 * - extractedData: object - the extracted data structure
 * - onUpdateField: function(fieldPath, newValue) - callback to update a field
 */
export default function ValidationIssuesDrawer({ 
  isOpen, 
  onClose, 
  conflicts = [], 
  extractedData = {},
  onUpdateField 
}) {
  const [editingField, setEditingField] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [resolvedIssues, setResolvedIssues] = useState(new Set());
  const [expandedPages, setExpandedPages] = useState(new Set(['2'])); // Track which pages are expanded


  // Parse conflicts into structured format
  // Bug 17 fix: handle both string format ("Page 2 - patient name: ...") 
  // and object format ({ field, ocrValue, llmValue, ... }) from different LLM modes
  const parseConflicts = () => {
    const byPage = {};
    
    conflicts.forEach((conflict, idx) => {
      let pageNum = 0;
      let fieldName = 'Unknown field';
      let concern = '';

      if (typeof conflict === 'string') {
        // Validation mode: "Page 2 - patient name: Incorrect extraction of patient name"
        const pageMatch = conflict.match(/Page (\d+)/);
        const fieldMatch = conflict.match(/Page \d+ - ([^:]+):/);
        const concernMatch = conflict.match(/: (.+)$/);
        
        pageNum = pageMatch ? parseInt(pageMatch[1]) : 0;
        fieldName = fieldMatch ? fieldMatch[1].trim() : 'Unknown field';
        concern = concernMatch ? concernMatch[1].trim() : conflict;
      } else if (typeof conflict === 'object' && conflict !== null) {
        // Extraction mode: { field, ocrValue, llmValue, resolved, strategy, similarity, note, page }
        pageNum = conflict.page || 0;
        fieldName = conflict.field || 'Unknown field';
        concern = conflict.note || 
          (conflict.ocrValue && conflict.llmValue 
            ? `OCR: "${conflict.ocrValue}" vs LLM: "${conflict.llmValue}" (${conflict.strategy || 'unresolved'})`
            : 'Value mismatch detected');
      }
      
      if (!byPage[pageNum]) {
        byPage[pageNum] = [];
      }
      
      // Extract current value from extractedData
      const currentValue = getFieldValue(fieldName);
      
      byPage[pageNum].push({
        id: `issue-${idx}`,
        fieldName,
        concern,
        currentValue,
        severity: getSeverity(fieldName, concern),
        isResolved: resolvedIssues.has(`issue-${idx}`) || (typeof conflict === 'object' && conflict.resolved)
      });
    });
    
    return byPage;
  };

  // Get field value from extracted data (handles nested paths)
  const getFieldValue = (fieldName) => {
    const normalized = fieldName.toLowerCase().replace(/\s+/g, ' ');
    
    // Try to find in extracted structure
    if (normalized.includes('patient name') || normalized.includes('patient first')) {
      return extractedData?.patient?.name || '—';
    }
    if (normalized.includes('patient last')) {
      return extractedData?.patient?.name?.split(',')[0] || '—';
    }
    if (normalized.includes('dob') || normalized.includes('date of birth')) {
      return extractedData?.patient?.dob || '—';
    }
    // Bug 15 fix: field is patient.phones (plural, array), not patient.phone
    if (normalized.includes('phone')) {
      return extractedData?.patient?.phones?.[0] || '—';
    }
    // Bug 14 fix: insurance is an array, not an object
    if (normalized.includes('insurance') || normalized.includes('carrier')) {
      return extractedData?.insurance?.[0]?.carrier || '—';
    }
    if (normalized.includes('member') || normalized.includes('member id')) {
      return extractedData?.insurance?.[0]?.memberId || '—';
    }
    if (normalized.includes('provider name')) {
      return extractedData?.provider?.name || '—';
    }
    if (normalized.includes('provider fax')) {
      return extractedData?.provider?.fax || '—';
    }
    if (normalized.includes('cpt')) {
      return extractedData?.procedure?.cpt || '—';
    }
    if (normalized.includes('procedure description')) {
      return extractedData?.procedure?.description || '—';
    }
    
    return '—';
  };

  // Determine severity based on field type
  const getSeverity = (fieldName, concern) => {
    const critical = ['patient name', 'patient last', 'dob', 'insurance', 'member id'];
    const normalized = fieldName.toLowerCase();
    
    if (critical.some(term => normalized.includes(term))) {
      return 'critical';
    }
    return 'warning';
  };

  // Handle field edit
  const handleStartEdit = (issue) => {
    setEditingField(issue.id);
    setEditValue(issue.currentValue);
  };

  const handleSaveEdit = (issue) => {
    if (onUpdateField) {
      // Map field name to path in extracted data
      const fieldPath = mapFieldNameToPath(issue.fieldName);
      onUpdateField(fieldPath, editValue);
    }
    
    // Mark as resolved
    setResolvedIssues(prev => new Set([...prev, issue.id]));
    setEditingField(null);
    
    notifications.show({
      title: 'Field updated',
      message: `${issue.fieldName} has been corrected`,
      color: 'green',
      autoClose: 2000
    });
  };

  const handleCancelEdit = () => {
    setEditingField(null);
    setEditValue('');
  };

  // Map field name to path for updates
  const mapFieldNameToPath = (fieldName) => {
    const normalized = fieldName.toLowerCase();
    
    if (normalized.includes('patient name') || normalized.includes('patient first')) {
      return 'patient.name';
    }
    if (normalized.includes('dob')) {
      return 'patient.dob';
    }
    // Bug 15 fix: correct path is patient.phones[0]
    if (normalized.includes('phone')) {
      return 'patient.phones[0]';
    }
    // Bug 14/16 fix: correct path includes array index
    if (normalized.includes('insurance') || normalized.includes('carrier')) {
      return 'insurance[0].carrier';
    }
    if (normalized.includes('member')) {
      return 'insurance[0].memberId';
    }
    if (normalized.includes('provider name')) {
      return 'provider.name';
    }
    if (normalized.includes('provider fax')) {
      return 'provider.fax';
    }
    if (normalized.includes('cpt')) {
      return 'procedure.cpt';
    }
    if (normalized.includes('description')) {
      return 'procedure.description';
    }
    
    return fieldName;
  };

  const conflictsByPage = parseConflicts();
  const totalIssues = conflicts.length;
  const resolvedCount = resolvedIssues.size;
  const progressPercent = totalIssues > 0 ? (resolvedCount / totalIssues) * 100 : 0;
  
  const criticalIssues = Object.values(conflictsByPage)
    .flat()
    .filter(i => i.severity === 'critical' && !i.isResolved).length;

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            zIndex: 1000,
          }}
          onClick={onClose}
        />
      )}
      
      {/* Drawer */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: isOpen ? 0 : '-600px',
          width: '600px',
          height: '100%',
          backgroundColor: 'var(--card-bg, #1a1b1e)',
          boxShadow: '-4px 0 20px rgba(0, 0, 0, 0.3)',
          transition: 'right 0.3s ease',
          zIndex: 1001,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ padding: '1.5rem', borderBottom: '1px solid #2a323c' }}>
          <Stack gap="sm">
            <Group gap="xs" style={{ justifyContent: 'space-between' }}>
              <Group gap="xs">
                <IconAlertTriangle size={20} color="#f59e0b" />
                <Text size="lg" fw={700}>Validation Issues</Text>
              </Group>
              <Button size="xs" variant="subtle" onClick={onClose}>
                <IconX size={16} />
              </Button>
            </Group>
            <Group gap="xs">
              <Badge color={criticalIssues > 0 ? 'red' : 'yellow'} size="sm">
                {totalIssues} Total
              </Badge>
              <Badge color="red" size="sm">
                {criticalIssues} Critical
              </Badge>
              <Badge color="green" size="sm">
                {resolvedCount} Resolved
              </Badge>
            </Group>
            <div>
              <div
                style={{
                  width: '100%',
                  height: '8px',
                  backgroundColor: '#2a323c',
                  borderRadius: '4px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${progressPercent}%`,
                    height: '100%',
                    backgroundColor: progressPercent === 100 ? '#10b981' : '#f59e0b',
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
              <Text size="xs" c="dimmed" style={{ marginTop: '4px' }}>
                {resolvedCount} of {totalIssues} issues resolved
              </Text>
            </div>
          </Stack>
        </div>

        {/* Issues List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
          <Stack gap="md">
            {Object.entries(conflictsByPage).length === 0 ? (
              <Paper p="xl" style={{ textAlign: 'center' }}>
                <IconCircleCheck size={48} color="#10b981" style={{ margin: '0 auto 16px' }} />
                <Text size="lg" fw={600}>No Issues Found</Text>
                <Text c="dimmed">All fields validated successfully!</Text>
              </Paper>
            ) : (
              <Stack gap="md">
                {Object.entries(conflictsByPage)
                  .sort(([a], [b]) => parseInt(a) - parseInt(b))
                  .map(([pageNum, issues]) => {
                    const isExpanded = expandedPages.has(pageNum);
                    const toggleExpand = () => {
                      const newExpanded = new Set(expandedPages);
                      if (isExpanded) {
                        newExpanded.delete(pageNum);
                      } else {
                        newExpanded.add(pageNum);
                      }
                      setExpandedPages(newExpanded);
                    };
                    
                    return (
                      <Paper key={pageNum} withBorder p="md">
                        <Stack gap="md">
                          {/* Page Header */}
                          <div
                            onClick={toggleExpand}
                            style={{ cursor: 'pointer' }}
                          >
                            <Group gap="xs" style={{ justifyContent: 'space-between' }}>
                              <Group gap="xs">
                                <Text fw={600}>Page {pageNum}</Text>
                                <Badge color="orange" size="sm">{issues.length} issues</Badge>
                                {issues.every(i => i.isResolved) && (
                                  <IconCircleCheck size={16} color="#10b981" />
                                )}
                              </Group>
                              <Text size="sm" c="dimmed">{isExpanded ? '▼' : '▶'}</Text>
                            </Group>
                          </div>

                          {/* Issues */}
                          {isExpanded && (
                            <Stack gap="md">
                          {issues.map((issue) => (
                            <Paper
                              key={issue.id}
                              p="md"
                              withBorder
                              style={{
                                borderColor: issue.isResolved ? 'var(--mantine-color-green-3)' : issue.severity === 'critical' ? 'var(--mantine-color-red-3)' : 'var(--mantine-color-orange-3)',
                                backgroundColor: issue.isResolved ? 'var(--mantine-color-green-0)' : issue.severity === 'critical' ? 'var(--mantine-color-red-0)' : 'var(--mantine-color-orange-0)'
                              }}
                            >
                              <Stack gap="xs">
                                <Group justify="space-between">
                                  <Group gap="xs">
                                    <Badge color={issue.severity === 'critical' ? 'red' : 'orange'} size="sm">
                                      {issue.severity}
                                    </Badge>
                                    <Text fw={600} size="sm">
                                      {issue.fieldName}
                                    </Text>
                                    {issue.isResolved && (
                                      <IconCircleCheck size={16} color="var(--mantine-color-green-6)" />
                                    )}
                                  </Group>
                                  {!issue.isResolved && editingField !== issue.id && (
                                    <Tooltip label="Edit this field">
                                      <Button
                                        size="xs"
                                        leftSection={<IconEdit size={14} />}
                                        onClick={() => handleStartEdit(issue)}
                                      >
                                        Edit
                                      </Button>
                                    </Tooltip>
                                  )}
                                </Group>
                                
                                <Text size="sm">
                                  <strong>Concern:</strong> {issue.concern}
                                </Text>
                                
                                {editingField === issue.id ? (
                                  <Stack gap="xs">
                                    <input
                                      type="text"
                                      value={editValue}
                                      onChange={(e) => setEditValue(e.target.value)}
                                      placeholder="Enter corrected value"
                                      autoFocus
                                      style={{
                                        width: '100%',
                                        padding: '8px 12px',
                                        borderRadius: '4px',
                                        border: '1px solid #2a323c',
                                        backgroundColor: '#25262b',
                                        color: '#c1c2c5',
                                        fontSize: '14px',
                                      }}
                                    />
                                    <Group gap="xs" style={{ justifyContent: 'flex-end' }}>
                                      <Button size="xs" variant="default" leftSection={<IconX size={14} />} onClick={handleCancelEdit}>
                                        Cancel
                                      </Button>
                                      <Button 
                                        size="xs" 
                                        color="green"
                                        leftSection={<IconDeviceFloppy size={14} />}
                                        onClick={() => handleSaveEdit(issue)}
                                      >
                                        Save
                                      </Button>
                                    </Group>
                                  </Stack>
                                ) : (
                                  <div
                                    style={{
                                      padding: '8px',
                                      backgroundColor: '#25262b',
                                      borderRadius: '4px',
                                      border: '1px solid #2a323c',
                                    }}
                                  >
                                    <Text size="xs" c="dimmed">Current value:</Text>
                                    <Text size="sm" style={{ fontFamily: 'monospace' }}>
                                      {issue.currentValue || '—'}
                                    </Text>
                                  </div>
                                )}
                              </Stack>
                            </Paper>
                          ))}
                            </Stack>
                          )}
                        </Stack>
                      </Paper>
                    );
                  })}
              </Stack>
            )}
          </Stack>
        </div>

        {/* Footer */}
        <div style={{ padding: '1rem', borderTop: '1px solid #2a323c' }}>
          <Group gap="md" style={{ justifyContent: 'space-between' }}>
            <Text size="sm" c="dimmed">
              {criticalIssues > 0 ? `${criticalIssues} critical issues remaining` : 'All critical issues resolved'}
            </Text>
            <Button variant="default" onClick={onClose}>
              Close
            </Button>
          </Group>
        </div>
      </div>
    </>
  );
}
