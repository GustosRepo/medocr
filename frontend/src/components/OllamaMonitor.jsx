import React, { useState, useEffect } from 'react';
import { Group, Stack, Text, Badge, Button, Paper } from '../ui/primitives.jsx';
import { IconRefresh, IconCircleCheck, IconAlertCircle, IconClock } from '@tabler/icons-react';

export default function OllamaMonitor() {
  const [health, setHealth] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

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

      {lastUpdate && (
        <Text size="xs" c="dimmed" ta="right">
          Last updated: {lastUpdate.toLocaleTimeString()}
        </Text>
      )}
    </Stack>
  );
}
