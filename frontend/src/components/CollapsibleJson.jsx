import React, { useState, useMemo } from 'react';
import { Button, ScrollArea, JsonInput, Text, Group } from '@mantine/core';

/* Generic collapsible JSON viewer; pass object or stringified JSON */
export default function CollapsibleJson({ value, maxHeight=360, initiallyOpen=false }) {
  const [open, setOpen] = useState(initiallyOpen);
  const jsonString = useMemo(() => {
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value, null, 2); } catch { return '"<unserializable>"'; }
  }, [value]);
  const topKeys = useMemo(() => {
    if (typeof value === 'object' && value && !Array.isArray(value)) return Object.keys(value).length;
    return 0;
  }, [value]);
  return (
    <>
      <Group justify="center" mb={4} gap={8} style={{ textAlign: 'center' }}>
        <Text size="xs" c="dimmed" fw={500}>Raw JSON</Text>
        <Button size="compact-xs" variant="subtle" onClick={()=>setOpen(o=>!o)}>{open ? 'Collapse' : 'Expand'}</Button>
      </Group>
      {!open && (
        <Text size="xs" c="dimmed" mb={0} style={{ textAlign: 'center' }}>
          Collapsed • {topKeys} top-level keys
        </Text>
      )}
      {open && (
        <ScrollArea h={maxHeight} offsetScrollbars>
          <JsonInput
            value={jsonString}
            readOnly
            autosize={false}
            minRows={Math.min(18, Math.round(maxHeight/20))}
            styles={{ input: { fontSize: 12 } }}
          />
        </ScrollArea>
      )}
    </>
  );
}
