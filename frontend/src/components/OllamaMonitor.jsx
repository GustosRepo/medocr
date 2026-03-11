import React, { useState, useEffect, useRef } from 'react';
import { Group, Stack, Text, Badge, Button, Paper, ScrollArea, Tooltip } from '../ui/primitives.jsx';
import { IconRefresh, IconCircleCheck, IconAlertCircle, IconClock } from '@tabler/icons-react';

export default function OllamaMonitor() {
  const [health, setHealth] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastCompletionTime, setLastCompletionTime] = useState(null);
  const logsScrollRef = useRef(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [healthRes, statsRes] = await Promise.all([
        fetch('/api/ollama/health'),
        fetch('/api/ollama/stats')
      ]);
      
      if (healthRes.ok) {
        const healthData = await healthRes.json();
        setHealth(healthData);
      }
      
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }
      
      setLastUpdate(new Date());
    } catch (error) {
      console.error('Failed to fetch Ollama status:', error);
    } finally {
      setLoading(false);
    }
  };

  const resetStats = async () => {
    try {
      const res = await fetch('/api/ollama/stats/reset', { method: 'POST' });
      if (res.ok) {
        fetchData();
      }
    } catch (error) {
      console.error('Failed to reset stats:', error);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (autoRefresh) {
      const interval = setInterval(fetchData, 5000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  // Fetch Ollama logs with real-time streaming
  useEffect(() => {
    if (!showLogs) return;
    
    let eventSource = null;
    
    try {
      // Use EventSource for real-time log streaming
      eventSource = new EventSource('/api/logs/ollama/stream');
      
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.log) {
            setLogs(prev => {
              const newLogs = [...prev, data.log];
              // Keep last 100 lines
              return newLogs.slice(-100);
            });
            
            // Detect processing state
            const hasStart = data.log.includes('dual_engine_start') || 
                           data.log.includes('llm_validation_mode') ||
                           data.log.includes('ollama_validation_start');
            const hasComplete = data.log.includes('dual_engine_complete');
            
            // Track completion
            if (hasStart) {
              setIsProcessing(true);
            } else if (hasComplete) {
              if (isProcessing) {
                setLastCompletionTime(new Date());
              }
              setIsProcessing(false);
            }
            
            // Auto-scroll to bottom if enabled
            if (autoScroll && logsScrollRef.current) {
              setTimeout(() => {
                if (logsScrollRef.current) {
                  logsScrollRef.current.scrollTop = logsScrollRef.current.scrollHeight;
                }
              }, 50);
            }
          }
        } catch (err) {
          console.error('Failed to parse log event:', err);
        }
      };
      
      eventSource.onerror = (err) => {
        console.error('Ollama log stream error:', err);
        eventSource.close();
      };
    } catch (err) {
      console.error('Failed to setup Ollama log stream:', err);
    }
    
    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [showLogs, autoScroll, isProcessing]);

  // Detect manual scroll to pause auto-scroll
  useEffect(() => {
    if (!logsScrollRef.current) return;
    
    const viewport = logsScrollRef.current;
    
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = viewport;
      const isAtBottom = Math.abs(scrollHeight - clientHeight - scrollTop) < 10;
      setAutoScroll(isAtBottom);
    };
    
    viewport.addEventListener('scroll', handleScroll);
    return () => viewport.removeEventListener('scroll', handleScroll);
  }, [showLogs]);

  const getStatusColor = () => {
    if (!health) return 'gray';
    switch (health.status) {
      case 'healthy': return 'green';
      case 'unhealthy': return 'orange';
      case 'timeout': return 'yellow';
      case 'error': return 'red';
      default: return 'gray';
    }
  };

  const getStatusIcon = () => {
    if (!health) return IconClock;
    switch (health.status) {
      case 'healthy': return IconCircleCheck;
      case 'unhealthy':
      case 'timeout':
      case 'error': return IconAlertCircle;
      default: return IconClock;
    }
  };

  const StatusIcon = getStatusIcon();

  return (
    <Stack gap="md">
      {/* Header */}
      <Group justify="space-between" wrap="nowrap">
        <Group gap="sm">
          <Text size="lg" fw={600}>Ollama LLM Monitor</Text>
          {health && (
            <Badge color={getStatusColor()} variant="filled" leftSection={<StatusIcon size={12} />}>
              {health.status}
            </Badge>
          )}
        </Group>
        <Group gap="xs">
          <Button 
            size="xs" 
            variant={autoRefresh ? 'filled' : 'outline'}
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            {autoRefresh ? 'Auto' : 'Manual'}
          </Button>
          <Button 
            size="xs" 
            variant="light" 
            onClick={fetchData}
            loading={loading}
            leftSection={<IconRefresh size={14} />}
          >
            Refresh
          </Button>
        </Group>
      </Group>

      {/* Service Health */}
      {health && (
        <Paper withBorder p="md" radius="md">
          <Stack gap="sm">
            <Text size="sm" fw={500}>Service Health</Text>
            <Group gap="md" wrap="wrap">
              <Stack gap={2}>
                <Text size="xs" c="dimmed">Status</Text>
                <Badge color={getStatusColor()}>{health.status}</Badge>
              </Stack>
              <Stack gap={2}>
                <Text size="xs" c="dimmed">Available</Text>
                <Text size="sm">{health.available ? 'Yes' : 'No'}</Text>
              </Stack>
              <Stack gap={2}>
                <Text size="xs" c="dimmed">Host</Text>
                <Text size="xs" style={{ fontFamily: 'monospace' }}>{health.host}</Text>
              </Stack>
              {health.llavaInstalled !== undefined && (
                <Stack gap={2}>
                  <Text size="xs" c="dimmed">Model Installed</Text>
                  <Badge color={health.llavaInstalled ? 'green' : 'red'} variant="light">
                    {health.llavaInstalled ? 'llava-phi3' : 'Missing'}
                  </Badge>
                </Stack>
              )}
              {health.modelSize && (
                <Stack gap={2}>
                  <Text size="xs" c="dimmed">Model Size</Text>
                  <Text size="sm">{health.modelSize}</Text>
                </Stack>
              )}
            </Group>
            {health.message && (
              <Text size="xs" c={health.status === 'healthy' ? 'dimmed' : 'red'}>
                {health.message}
              </Text>
            )}
          </Stack>
        </Paper>
      )}

      {/* Processing Statistics */}
      {stats && (
        <Paper withBorder p="md" radius="md">
          <Stack gap="sm">
            <Group justify="space-between">
              <Text size="sm" fw={500}>Processing Statistics</Text>
              <Button size="xs" variant="subtle" onClick={resetStats}>
                Reset
              </Button>
            </Group>
            
            <Group gap="md" wrap="wrap">
              <Stack gap={2}>
                <Text size="xs" c="dimmed">Enabled</Text>
                <Badge color={stats.enabled ? 'green' : 'gray'} variant="light">
                  {stats.enabled ? 'Yes' : 'No'}
                </Badge>
              </Stack>
              <Stack gap={2}>
                <Text size="xs" c="dimmed">Total Requests</Text>
                <Text size="lg" fw={600}>{stats.stats.totalRequests}</Text>
              </Stack>
              <Stack gap={2}>
                <Text size="xs" c="dimmed">Success Rate</Text>
                <Text size="lg" fw={600} c="green">{stats.stats.successRate}</Text>
              </Stack>
              <Stack gap={2}>
                <Text size="xs" c="dimmed">Failed</Text>
                <Text size="lg" fw={600} c={stats.stats.failedRequests > 0 ? 'red' : 'dimmed'}>
                  {stats.stats.failedRequests}
                </Text>
              </Stack>
            </Group>

            {stats.stats.totalRequests > 0 && (
              <>
                <div style={{ borderTop: '1px solid #2a323c', margin: '8px 0' }} />
                <Group gap="md" wrap="wrap">
                  <Stack gap={2}>
                    <Text size="xs" c="dimmed">Avg Processing Time</Text>
                    <Text size="sm" style={{ fontFamily: 'monospace' }}>
                      {stats.stats.avgProcessingTime}
                    </Text>
                  </Stack>
                  <Stack gap={2}>
                    <Text size="xs" c="dimmed">Min Time</Text>
                    <Text size="sm" style={{ fontFamily: 'monospace' }}>
                      {stats.stats.minProcessingTime}
                    </Text>
                  </Stack>
                  <Stack gap={2}>
                    <Text size="xs" c="dimmed">Max Time</Text>
                    <Text size="sm" style={{ fontFamily: 'monospace' }}>
                      {stats.stats.maxProcessingTime}
                    </Text>
                  </Stack>
                  <Stack gap={2}>
                    <Text size="xs" c="dimmed">Last Request</Text>
                    <Text size="xs">
                      {stats.stats.lastRequestTime 
                        ? new Date(stats.stats.lastRequestTime).toLocaleTimeString()
                        : 'Never'}
                    </Text>
                  </Stack>
                </Group>
              </>
            )}

            {stats.stats.lastError && (
              <>
                <div style={{ borderTop: '1px solid #2a323c', margin: '8px 0' }} />
                <Stack gap={2}>
                  <Text size="xs" c="dimmed">Last Error</Text>
                  <Paper p="xs" style={{ background: 'rgba(255,0,0,0.1)' }}>
                    <Text size="xs" c="red" style={{ fontFamily: 'monospace', wordBreak: 'break-word' }}>
                      {stats.stats.lastError.message}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {new Date(stats.stats.lastError.timestamp).toLocaleString()}
                    </Text>
                  </Paper>
                </Stack>
              </>
            )}

            {/* Configuration */}
            <div style={{ borderTop: '1px solid #2a323c', margin: '8px 0' }} />
            <Stack gap={2}>
              <Text size="xs" c="dimmed">Configuration</Text>
              <Group gap="md" wrap="wrap">
                <Text size="xs" style={{ fontFamily: 'monospace' }}>
                  Model: {stats.config.model}
                </Text>
                <Text size="xs" style={{ fontFamily: 'monospace' }}>
                  Timeout: {stats.config.timeout}ms
                </Text>
              </Group>
            </Stack>
          </Stack>
        </Paper>
      )}

      {/* Live Processing Logs */}
      <Paper withBorder p="md" radius="md">
        <Stack gap="xs">
          <Group justify="space-between" align="center">
            <Group gap="xs">
              <Text size="sm" fw={600} c="dimmed" tt="uppercase">
                Ollama Processing Logs
              </Text>
              {showLogs && (
                <>
                  {isProcessing ? (
                    <Badge size="sm" variant="light" color="blue" leftSection="🔄">
                      Processing
                    </Badge>
                  ) : lastCompletionTime ? (
                    <Badge size="sm" variant="light" color="green" leftSection="✅">
                      Done {new Date(lastCompletionTime).toLocaleTimeString()}
                    </Badge>
                  ) : (
                    <Badge size="sm" variant="light" color="purple">
                      Live
                    </Badge>
                  )}
                  <Tooltip label="Shows Ollama LLM inference events, page selection, and dual-engine processing">
                    <Badge size="xs" variant="outline" color="purple">
                      Filtered
                    </Badge>
                  </Tooltip>
                </>
              )}
            </Group>
            <Button
              size="xs"
              variant={showLogs ? 'filled' : 'light'}
              color="purple"
              onClick={() => setShowLogs(v => !v)}
            >
              {showLogs ? 'Hide Logs' : 'Show Live Logs'}
            </Button>
          </Group>
          
          {showLogs && (
            <Paper p="sm" withBorder style={{ background: '#0a0e13', fontFamily: 'monospace' }}>
              <Stack gap="xs" mb="xs">
                <Group gap="xs" align="center">
                  <Text size="xs" c="dimmed">
                    {autoScroll ? '📌 Auto-scrolling' : '⏸️ Scroll paused (scroll to bottom to resume)'}
                  </Text>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    onClick={() => {
                      setAutoScroll(true);
                      if (logsScrollRef.current) {
                        logsScrollRef.current.scrollTop = logsScrollRef.current.scrollHeight;
                      }
                    }}
                  >
                    Jump to Bottom
                  </Button>
                </Group>
              </Stack>
              <ScrollArea 
                h={300} 
                offsetScrollbars
                ref={logsScrollRef}
              >
                <Stack gap={2}>
                  {logs.length === 0 && (
                    <Text size="xs" c="dimmed">
                      Waiting for Ollama processing logs...
                    </Text>
                  )}
                  {logs.map((line, i) => {
                    // Color-code important log lines
                    const isError = line.includes('error') || line.includes('failed');
                    const isWarning = line.includes('warn');
                    const isProcessingDone = line.includes('PROCESSING COMPLETE') || line.includes('✅') || line.includes('dual_engine_processing_complete');
                    const isProcessingStart = line.includes('STARTING VALIDATION') || line.includes('🔄') || line.includes('dual_engine_validation_start');
                    const isStart = line.includes('ollama_extract_start') || line.includes('page_selection');
                    const isComplete = line.includes('ollama_extract_complete') || line.includes('dual_engine_merge');
                    const isTiming = line.includes('took ') || line.includes('ms') || line.includes('processingTime');
                    
                    let color = '#9ca3af'; // default gray
                    let fontWeight = 'normal';
                    let fontSize = 'xs';
                    
                    if (isProcessingDone) {
                      color = '#10b981'; // bright green
                      fontWeight = 'bold';
                      fontSize = 'sm';
                    } else if (isProcessingStart) {
                      color = '#3b82f6'; // bright blue
                      fontWeight = 'bold';
                      fontSize = 'sm';
                    } else if (isError) {
                      color = '#ef4444'; // red
                    } else if (isWarning) {
                      color = '#f59e0b'; // orange
                    } else if (isComplete) {
                      color = '#10b981'; // green (success)
                    } else if (isStart) {
                      color = '#3b82f6'; // blue (starting)
                    } else if (isTiming) {
                      color = '#a78bfa'; // purple (timing info)
                    }
                    
                    return (
                      <Text
                        key={i}
                        size={fontSize}
                        style={{
                          color,
                          fontWeight,
                          lineHeight: 1.4,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word'
                        }}
                      >
                        {line}
                      </Text>
                    );
                  })}
                </Stack>
              </ScrollArea>
            </Paper>
          )}
        </Stack>
      </Paper>

      {lastUpdate && (
        <Text size="xs" c="dimmed" ta="right">
          Last updated: {lastUpdate.toLocaleTimeString()}
        </Text>
      )}
    </Stack>
  );
}
