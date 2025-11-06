import React, { useState } from 'react';
import { Button, Stack, Text, Paper, Title, Code, ScrollArea, Group, Badge } from '../ui/primitives.jsx';
import { notifications } from '../ui/primitives.jsx';
import { IconUpload, IconPlayerPlay, IconFileText } from '@tabler/icons-react';
import Section from '../components/Section.jsx';

const apiBase = '/api';

export default function BenchmarkPage() {
  const [file, setFile] = useState(null);
  const [groundTruth, setGroundTruth] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  function handleFileChange(e) {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
    }
  }

  async function handleRunBenchmark() {
    if (!file) {
      notifications.show({
        title: 'No File',
        message: 'Please select a file to test',
        color: 'red'
      });
      return;
    }

    if (!groundTruth.trim()) {
      notifications.show({
        title: 'No Ground Truth',
        message: 'Please provide the expected OCR text',
        color: 'red'
      });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('groundTruth', groundTruth.trim());

      const response = await fetch(`${apiBase}/benchmark`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Benchmark failed');
      }

      const data = await response.json();
      setResult(data);

      // Show notification based on CER
      const cer = data.metrics?.cer || 0;
      const accuracy = data.metrics?.characterAccuracy || 0;
      
      if (cer < 0.05) {
        notifications.show({
          title: 'Excellent Accuracy!',
          message: `${(accuracy * 100).toFixed(1)}% character accuracy (CER: ${(cer * 100).toFixed(2)}%)`,
          color: 'green'
        });
      } else if (cer < 0.15) {
        notifications.show({
          title: 'Good Accuracy',
          message: `${(accuracy * 100).toFixed(1)}% character accuracy (CER: ${(cer * 100).toFixed(2)}%)`,
          color: 'blue'
        });
      } else {
        notifications.show({
          title: 'Low Accuracy',
          message: `${(accuracy * 100).toFixed(1)}% character accuracy - check preprocessing`,
          color: 'orange'
        });
      }

    } catch (err) {
      console.error('Benchmark error:', err);
      notifications.show({
        title: 'Benchmark Failed',
        message: err.message || 'Unknown error',
        color: 'red'
      });
    } finally {
      setLoading(false);
    }
  }

  function handleClear() {
    setFile(null);
    setGroundTruth('');
    setResult(null);
    // Clear file input
    const fileInput = document.querySelector('input[type="file"]');
    if (fileInput) fileInput.value = '';
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
      <Stack spacing="lg">
        <div>
          <Title order={2}>OCR Benchmark Testing</Title>
          <Text size="sm" c="dimmed" mt="xs">
            Test OCR accuracy by comparing results against expected text (ground truth).
            Upload a test file, provide the expected text, and see detailed metrics.
          </Text>
        </div>

        <Paper p="lg" withBorder>
          <Stack spacing="md">
            <div>
              <Text fw={500} mb="xs">1. Upload Test File</Text>
              <input
                type="file"
                accept="image/*,.pdf"
                onChange={handleFileChange}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid var(--surface-border)',
                  borderRadius: '0.375rem',
                  backgroundColor: 'var(--surface-elevated)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer'
                }}
              />
              {file && (
                <Text size="xs" c="dimmed" mt={4}>
                  Selected: {file.name}
                </Text>
              )}
            </div>

            <div>
              <Text fw={500} mb="xs">2. Enter Expected Text (Ground Truth)</Text>
              <textarea
                placeholder="Type or paste the text you expect OCR to recognize..."
                value={groundTruth}
                onChange={(e) => setGroundTruth(e.target.value)}
                rows={8}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  border: '1px solid var(--surface-border)',
                  borderRadius: '0.375rem',
                  backgroundColor: 'var(--surface-elevated)',
                  color: 'var(--text-primary)',
                  fontFamily: 'inherit',
                  fontSize: '0.875rem',
                  resize: 'vertical',
                  minHeight: '8rem'
                }}
              />
              <Text size="xs" c="dimmed" mt={4}>
                {groundTruth.trim().split(/\s+/).filter(Boolean).length} words, {groundTruth.trim().length} characters
              </Text>
            </div>

            <Group>
              <Button
                leftIcon={<IconPlayerPlay size={16} />}
                onClick={handleRunBenchmark}
                loading={loading}
                disabled={!file || !groundTruth.trim()}
              >
                Run Benchmark
              </Button>
              <Button variant="outline" onClick={handleClear}>
                Clear
              </Button>
            </Group>
          </Stack>
        </Paper>

        {result && (
          <>
            <Section title="Accuracy Metrics">
              <Paper p="md" withBorder>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                  <MetricCard
                    label="Character Accuracy"
                    value={`${(result.metrics.characterAccuracy * 100).toFixed(1)}%`}
                    color={result.metrics.cer < 0.05 ? 'green' : result.metrics.cer < 0.15 ? 'blue' : 'orange'}
                  />
                  <MetricCard
                    label="Character Error Rate (CER)"
                    value={`${(result.metrics.cer * 100).toFixed(2)}%`}
                    color={result.metrics.cer < 0.05 ? 'green' : result.metrics.cer < 0.15 ? 'blue' : 'orange'}
                    description="Lower is better"
                  />
                  <MetricCard
                    label="Word Error Rate (WER)"
                    value={`${(result.metrics.wer * 100).toFixed(2)}%`}
                    color={result.metrics.wer < 0.05 ? 'green' : result.metrics.wer < 0.15 ? 'blue' : 'orange'}
                    description="Lower is better"
                  />
                  <MetricCard
                    label="Avg Confidence"
                    value={result.metrics.avgConfidence.toFixed(3)}
                    color={result.metrics.avgConfidence > 0.9 ? 'green' : result.metrics.avgConfidence > 0.7 ? 'blue' : 'orange'}
                    description="OCR certainty (0-1)"
                  />
                  <MetricCard
                    label="Low Confidence Rate"
                    value={`${(result.metrics.lowConfidenceRate * 100).toFixed(1)}%`}
                    color={result.metrics.lowConfidenceRate < 0.05 ? 'green' : result.metrics.lowConfidenceRate < 0.15 ? 'blue' : 'orange'}
                    description="Lines < 0.65 confidence"
                  />
                  <MetricCard
                    label="Total Lines"
                    value={result.metrics.totalLines}
                    color="gray"
                  />
                </div>
              </Paper>
            </Section>

            <Section title="Text Comparison">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <Paper p="md" withBorder>
                  <Text fw={600} mb="sm" c="dimmed">Expected (Ground Truth)</Text>
                  <ScrollArea h={300}>
                    <Code block style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {result.groundTruth}
                    </Code>
                  </ScrollArea>
                  <Text size="xs" c="dimmed" mt="xs">
                    {result.metrics.totalWords} words, {result.metrics.totalChars} characters
                  </Text>
                </Paper>

                <Paper p="md" withBorder>
                  <Text fw={600} mb="sm" c="blue">OCR Result</Text>
                  <ScrollArea h={300}>
                    <Code block style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {result.ocr.text}
                    </Code>
                  </ScrollArea>
                  <Text size="xs" c="dimmed" mt="xs">
                    {result.ocr.pages} pages, {result.ocr.lines} lines
                  </Text>
                </Paper>
              </div>
            </Section>

            <Section title="Analysis">
              <Paper p="md" withBorder>
                <Stack spacing="sm">
                  <Text size="sm">
                    <strong>Test File:</strong> {result.filename}
                  </Text>
                  
                  {result.metrics.cer < 0.05 && (
                    <Text size="sm" c="green">
                      ✓ Excellent accuracy! The OCR is performing very well on this document.
                    </Text>
                  )}
                  
                  {result.metrics.cer >= 0.05 && result.metrics.cer < 0.15 && (
                    <Text size="sm" c="blue">
                      ℹ️ Good accuracy with minor errors. This is typical for most scanned documents.
                    </Text>
                  )}
                  
                  {result.metrics.cer >= 0.15 && result.metrics.cer < 0.30 && (
                    <Text size="sm" c="orange">
                      ⚠️ Moderate accuracy. Check if the document is faded, low resolution, or has handwriting.
                      CLAHE preprocessing and confidence retry should help improve this.
                    </Text>
                  )}
                  
                  {result.metrics.cer >= 0.30 && (
                    <Text size="sm" c="red">
                      ⚠️ Low accuracy detected. This document may have significant issues:
                      <ul style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                        <li>Very low quality scan or fax</li>
                        <li>Handwritten text (not well-supported)</li>
                        <li>Unusual font or heavily rotated text</li>
                        <li>Wrong language (models are optimized for English/Chinese)</li>
                      </ul>
                    </Text>
                  )}
                  
                  {result.metrics.lowConfidenceRate > 0.2 && (
                    <Text size="sm" c="orange" mt="xs">
                      ℹ️ {(result.metrics.lowConfidenceRate * 100).toFixed(0)}% of lines had low confidence.
                      The system should automatically retry these with enhanced preprocessing.
                    </Text>
                  )}
                  
                  {result.metrics.minConfidence < 0.5 && (
                    <Text size="sm" c="orange" mt="xs">
                      ⚠️ Minimum confidence was {result.metrics.minConfidence.toFixed(3)}, 
                      indicating some very uncertain text regions.
                    </Text>
                  )}
                </Stack>
              </Paper>
            </Section>
          </>
        )}
      </Stack>
    </div>
  );
}

function MetricCard({ label, value, color = 'gray', description }) {
  return (
    <Paper p="sm" withBorder>
      <Text size="xs" c="dimmed" fw={500} mb={4}>{label}</Text>
      <Badge size="lg" color={color} variant="light" fullWidth style={{ height: 'auto', padding: '0.5rem' }}>
        <Text size="xl" fw={700}>{value}</Text>
      </Badge>
      {description && (
        <Text size="xs" c="dimmed" mt={4}>{description}</Text>
      )}
    </Paper>
  );
}
