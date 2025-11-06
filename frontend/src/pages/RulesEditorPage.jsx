import React, { useEffect, useMemo, useState } from 'react';
import { Button, Group, Stack, Text, Paper, ScrollArea, JsonInput, Title, Badge } from '../ui/primitives.jsx';
import { IconWorld, IconWorldOff } from '@tabler/icons-react';

const FILES_ENDPOINT = '/api/admin/rules/files';
const PATTERN_OVERRIDES_FILE = 'pattern_overrides.json';

function formatTimestamp(ms) {
  if (!ms && ms !== 0) return '—';
  try {
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString();
  } catch {
    return '—';
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function RulesEditorPage() {
  const [files, setFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [filesError, setFilesError] = useState('');
  const [selected, setSelected] = useState(null);
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState('');
  const [fileMeta, setFileMeta] = useState(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [search, setSearch] = useState('');
  const [npiEnabled, setNpiEnabled] = useState(true);
  const [npiLoading, setNpiLoading] = useState(false);

  const dirty = useMemo(() => content !== original, [content, original]);

  useEffect(() => {
    refreshList();
    loadAppConfig();
  }, []);

  function refreshList() {
    setLoadingFiles(true);
    setFilesError('');
    fetch(FILES_ENDPOINT)
      .then(res => {
        if (!res.ok) throw new Error(`Failed to load files (${res.status})`);
        return res.json();
      })
      .then(data => {
        const list = Array.isArray(data?.files) ? data.files : [];
        const ordered = [...list].sort((a, b) => {
          if (a.name === PATTERN_OVERRIDES_FILE) return -1;
          if (b.name === PATTERN_OVERRIDES_FILE) return 1;
          return a.name.localeCompare(b.name);
        });
        setFiles(ordered);
        const hasPatternOverrides = ordered.some(file => file.name === PATTERN_OVERRIDES_FILE);
        if (!selected && hasPatternOverrides) {
          handleSelect(PATTERN_OVERRIDES_FILE);
        }
      })
      .catch(err => setFilesError(err.message || String(err)))
      .finally(() => setLoadingFiles(false));
  }

  function loadAppConfig() {
    fetch('/api/config')
      .then(res => res.ok ? res.json() : Promise.reject())
      .then(data => {
        setNpiEnabled(data?.npi?.enabled ?? true);
      })
      .catch(() => {
        // Silently fail, keep default
      });
  }

  async function toggleNpi() {
    if (npiLoading) return;
    setNpiLoading(true);
    try {
      const res = await fetch('/api/config/npi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !npiEnabled })
      });
      if (!res.ok) throw new Error('Failed to update NPI config');
      const data = await res.json();
      setNpiEnabled(data.npiEnabled);
      setSaveMessage(`NPI lookups ${data.npiEnabled ? 'enabled' : 'disabled'}`);
      setTimeout(() => setSaveMessage(''), 2500);
    } catch (err) {
      setSaveError(err.message || 'Failed to update NPI config');
      setTimeout(() => setSaveError(''), 3000);
    } finally {
      setNpiLoading(false);
    }
  }

  function loadFile(name) {
    if (!name) {
      setContent('');
      setOriginal('');
      setFileMeta(null);
      return;
    }
    setLoadingFile(true);
    const endpoint = name === PATTERN_OVERRIDES_FILE
      ? `/api/admin/rules/pattern-overrides`
      : `${FILES_ENDPOINT}/${encodeURIComponent(name)}`;
    fetch(endpoint)
      .then(res => {
        if (!res.ok) throw new Error(`Failed to load ${name} (${res.status})`);
        return res.json();
      })
      .then(data => {
        const body = typeof data?.content === 'string' ? data.content : '';
        setContent(body);
        setOriginal(body);
        setFileMeta({ size: data?.size, mtimeMs: data?.mtimeMs, name: data?.name });
      })
      .catch(err => {
        setContent('');
        setOriginal('');
        setFileMeta(null);
        setSaveError(err.message || String(err));
      })
      .finally(() => setLoadingFile(false));
  }

  function handleSelect(name) {
    if (dirty) {
      const confirmed = window.confirm('You have unsaved changes. Discard them?');
      if (!confirmed) return;
    }
    setSelected(name);
    setSaveError('');
    setSaveMessage('');
    loadFile(name);
  }

  function handleSave() {
    setSaveError('');
    setSaveMessage('');
    if (!selected) return;
    let payload = content;
    try {
      const parsed = JSON.parse(content);
      const formatted = JSON.stringify(parsed, null, 2);
      setContent(formatted);
      payload = formatted;
    } catch (e) {
      setSaveError(`JSON parse error: ${e?.message || e}`);
      return;
    }
    setSaving(true);
    const endpoint = selected === PATTERN_OVERRIDES_FILE
      ? `/api/admin/rules/pattern-overrides`
      : `${FILES_ENDPOINT}/${encodeURIComponent(selected)}`;
    fetch(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: payload })
    })
      .then(res => {
        if (!res.ok) return res.json().then(err => { throw new Error(err?.error?.message || `Save failed (${res.status})`); });
        return res.json();
      })
      .then(data => {
        setOriginal(payload);
        setSaveMessage('Saved successfully');
        setFileMeta(meta => meta ? { ...meta, size: data?.size ?? meta.size, mtimeMs: data?.mtimeMs ?? meta.mtimeMs } : meta);
        refreshList();
      })
      .catch(err => setSaveError(err.message || String(err)))
      .finally(() => setSaving(false));
  }

  function handleReload() {
    setSaveError('');
    setSaveMessage('');
    const target = selected && selected.trim();
    if (dirty) {
      const confirmed = window.confirm('You have unsaved changes. Reloading will discard them. Continue?');
      if (!confirmed) return;
    }
    setReloading(true);
    fetch('/api/admin/rules/reload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(target ? { filename: target } : {})
    })
      .then(res => {
        if (!res.ok) return res.json().then(err => { throw new Error(err?.error?.message || `Reload failed (${res.status})`); });
        return res.json();
      })
      .then(data => {
        const scope = data?.scope || (target || 'all');
        setSaveMessage(`Reloaded ${scope === 'all' ? 'all rule caches' : scope}`);
        if (target) {
          loadFile(target);
        } else if (selected) {
          loadFile(selected);
        } else {
          refreshList();
        }
      })
      .catch(err => setSaveError(err.message || String(err)))
      .finally(() => setReloading(false));
  }

  function handleFormat() {
    try {
      const parsed = JSON.parse(content);
      setContent(JSON.stringify(parsed, null, 2));
      setSaveError('');
    } catch (e) {
      setSaveError(`JSON parse error: ${e?.message || e}`);
    }
  }

  function handleReset() {
    setContent(original);
    setSaveError('');
    setSaveMessage('');
  }

  const filteredFiles = useMemo(() => {
    if (!search) return files;
    const q = search.toLowerCase();
    return files.filter(f => f.name.toLowerCase().includes(q));
  }, [files, search]);

  return (
    <Stack gap="lg" className="page-container">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <Title order={2} className="page-title">Rules Editor</Title>
          <Button
            size="sm"
            variant={npiEnabled ? 'light' : 'outline'}
            color={npiEnabled ? 'blue' : 'gray'}
            leftSection={npiEnabled ? <IconWorld size={16} /> : <IconWorldOff size={16} />}
            onClick={toggleNpi}
            loading={npiLoading}
          >
            NPI Lookups: {npiEnabled ? 'ON' : 'OFF'}
          </Button>
        </Group>
        <Text size="sm" c="dimmed">
          Edit the JSON catalogs that drive extraction logic. Changes are written directly to files under <code>backend/rules/data</code>{' '}.
          All rule files hot-reload automatically, so updates take effect immediately. Always validate JSON before saving.
        </Text>
        <Paper withBorder radius="md" p="sm" className={npiEnabled ? "bg-blue-950/30 border-blue-700/60" : "bg-slate-950/30 border-slate-700/60"}>
          <Stack gap="xs">
            <Group gap="xs">
              {npiEnabled ? <IconWorld size={16} className="text-blue-400" /> : <IconWorldOff size={16} className="text-slate-400" />}
              <Text size="xs" fw={600} c={npiEnabled ? "blue" : "dimmed"}>
                External NPI Registry: {npiEnabled ? 'ENABLED' : 'DISABLED'}
              </Text>
            </Group>
            <Text size="xs" c="dimmed">
              {npiEnabled 
                ? 'Provider names will be validated against the public CMS NPPES registry (https://npiregistry.cms.hhs.gov). Only provider names are transmitted - no PHI.' 
                : 'NPI lookups are disabled. The app runs in 100% offline mode, using cached NPI data only. No external network calls will be made.'}
            </Text>
          </Stack>
        </Paper>
      </Stack>
      <Group align="flex-start" gap="lg" wrap="wrap">
        <Paper withBorder radius="md" className="w-full max-w-md" p="md">
          <Stack gap="sm">
            <input
              placeholder="Search files"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full rounded-md bg-slate-900/70 border border-slate-700 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            <ScrollArea h={420} offsetScrollbars>
              <Stack gap="xs">
                {loadingFiles && <Text size="sm" c="dimmed">Loading files…</Text>}
                {!loadingFiles && filesError && <Text size="sm" c="red">{filesError}</Text>}
                {!loadingFiles && !filesError && filteredFiles.length === 0 && (
                  <Text size="sm" c="dimmed">No matching files</Text>
                )}
                {filteredFiles.map(file => {
                  const active = file.name === selected;
                  const isPatternOverrides = file.name === PATTERN_OVERRIDES_FILE;
                  return (
                    <Button
                      key={file.name}
                      size="xs"
                      variant={active ? 'filled' : 'subtle'}
                      fullWidth
                      onClick={() => handleSelect(file.name)}
                    >
                      <span className="flex-1 text-left truncate">{file.name}</span>
                      {isPatternOverrides && (
                        <Badge size="xs" color="grape" variant="light" className="ml-2">Primary</Badge>
                      )}
                      <span className="text-[10px] text-slate-300 ml-2">{formatBytes(file.size)}</span>
                    </Button>
                  );
                })}
              </Stack>
            </ScrollArea>
          </Stack>
        </Paper>
        <Stack gap="md" className="flex-1 min-w-[360px]">
          {loadingFile && <Paper withBorder radius="md" p="lg"><Text size="sm" c="dimmed">Loading file…</Text></Paper>}
          {!loadingFile && !selected && (
            <Paper withBorder radius="md" p="lg">
              <Text size="sm" c="dimmed">Select a JSON file to view and edit its contents.</Text>
            </Paper>
          )}
          {!loadingFile && selected && (
            <Stack gap="sm">
              <Group justify="space-between" align="center">
                <Group gap="xs">
                  <Title order={4}>{selected}</Title>
                  {fileMeta && (
                    <Badge size="xs" color="blue" variant="light">
                      {formatBytes(fileMeta.size)} • {formatTimestamp(fileMeta.mtimeMs)}
                    </Badge>
                  )}
                </Group>
                <Group gap="xs">
                  <Button size="xs" variant="subtle" onClick={handleFormat}>Format</Button>
                  <Button size="xs" variant="subtle" onClick={handleReset} disabled={!dirty}>Reset</Button>
                  <Button size="xs" variant="outline" onClick={handleReload} loading={reloading}>
                    Reload
                  </Button>
                  <Button size="xs" onClick={handleSave} disabled={!dirty || saving} loading={saving}>
                    Save
                  </Button>
                </Group>
              </Group>
              {saveError && <Text size="sm" c="red">{saveError}</Text>}
              {saveMessage && <Text size="sm" c="green">{saveMessage}</Text>}
              <JsonInput value={content} onChange={e => setContent(e.target.value)} readOnly={false} rows={28} />
              <Paper withBorder radius="md" p="md" className="bg-slate-950/40 border-slate-800/70">
                <Stack gap="xs">
                  <Text size="xs" c="dimmed">Usage Tips:</Text>
                  <Text size="xs" c="dimmed">• Ensure valid JSON before saving. Use the Format button to pretty-print.</Text>
                  <Text size="xs" c="dimmed">• All rule catalogs hot-reload instantly; consider downloading a copy or relying on version control for rollbacks.</Text>
                  <Text size="xs" c="dimmed">• If a change produces unexpected results, revert the JSON and save to restore prior behaviour.</Text>
                </Stack>
              </Paper>
            </Stack>
          )}
        </Stack>
      </Group>
    </Stack>
  );
}
