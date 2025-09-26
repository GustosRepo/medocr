import { useEffect, useMemo, useState } from 'react'
import './app.css'

const apiBase = '/api'

export default function App() {
  const [file, setFile] = useState(null)
  const [docId, setDocId] = useState('')
  const [status, setStatus] = useState(null)
  const [result, setResult] = useState(null)
  const [debugTrace, setDebugTrace] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [fileInfo, setFileInfo] = useState(null)
  const [batchDates, setBatchDates] = useState([])

  useEffect(() => {
    // Fetch available batch dates for report links
    fetch(`${apiBase}/batch`).then(r => r.ok ? r.json() : Promise.reject())
      .then(j => setBatchDates(Array.isArray(j?.dates) ? j.dates : []))
      .catch(() => setBatchDates([]))
  }, [])

  const confidenceBadge = useMemo(() => {
    if (!result?.confidence) return null
    const level = result.confidence
    const cls = level === 'High' ? 'ok' : level === 'Medium' ? 'warn' : level === 'Low' ? 'err' : ''
    return <span className={`badge ${cls}`}>Confidence: {level}</span>
  }, [result])

  const insuranceName = useMemo(() => {
    const ins = result?.insurance
    if (!ins) return 'Unknown'
    if (Array.isArray(ins)) return ins[0]?.carrier || 'Unknown'
    if (typeof ins === 'object') return ins.carrier || 'Unknown'
    return String(ins)
  }, [result])

  async function upload() {
    setError('')
    setResult(null)
    setLoading(true)
  const fd = new FormData()
    // Validate file before appending
    if (!(file instanceof Blob)) {
      setLoading(false)
      setError('Please select a PDF file')
      return
    }
    if (file.type && file.type !== 'application/pdf') {
      setLoading(false)
      setError('Only PDF files are supported')
      return
    }
    try {
      const ab = await file.arrayBuffer()
      const name = file.name || 'upload.pdf'
      let part
      if (typeof File !== 'undefined') {
        part = new File([ab], name, { type: 'application/pdf' })
      } else {
        part = new Blob([ab], { type: 'application/pdf' })
      }
      fd.append('file', part, name)
    } catch (e) {
      setLoading(false)
      setError('Could not read file bytes')
      return
    }
    try {
      const res = await fetch(`${apiBase}/documents`, { method: 'POST', body: fd })
  if (!res.ok) throw new Error('Upload failed')
      const data = await res.json()
      setDocId(data.id)
      pollStatus(data.id)
    } catch (e) {
  setError((e && e.message) ? e.message : 'Upload failed')
      setLoading(false)
    }
  }

  async function pollStatus(id) {
    setStatus('processing')
    let tries = 0
    const maxTries = 20
    const baseDelay = 600
    while (tries < maxTries) {
      try {
        const res = await fetch(`${apiBase}/documents/${id}/status`)
        if (!res.ok) throw new Error('Status check failed')
        const data = await res.json()
        setStatus(data.status)
        if (data.status === 'done') {
          const r = await fetch(`${apiBase}/documents/${id}/result`)
          if (!r.ok) {
            const err = await r.json().catch(() => ({}))
            setError(err?.error?.message || 'Processing error')
            setLoading(false)
            setStatus('error')
            return
          }
          const json = await r.json()
          setResult(json)
          setDebugTrace(json?.debug?.trace || null)
          setLoading(false)
          return
        }
        if (data.status === 'error') {
          setError(data.error || 'Processing error')
          setLoading(false)
          return
        }
      } catch (e) {
        setError(e.message || 'Network error during status')
        setLoading(false)
        return
      }
      tries++
      await new Promise(r => setTimeout(r, baseDelay + tries * 200))
    }
    setError('Processing timeout')
    setLoading(false)
  }

  async function fetchDebug() {
    if (!docId) return
    try {
      const r = await fetch(`${apiBase}/documents/${docId}/result?debug=1`)
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        setError(err?.error?.message || 'Debug fetch failed')
        return
      }
      const json = await r.json()
      setResult(json)
      setDebugTrace(json?.debug?.trace || [])
    } catch (e) {
      setError(e.message || 'Network error fetching debug')
    }
  }

  async function loadSample() {
    setError('')
    setResult(null)
    setLoading(true)
    try {
      // Use fixtures endpoint for a stable sample payload
      const r = await fetch(`${apiBase}/fixtures/titration_auto_approve`)
      if (!r.ok) throw new Error('Sample not available')
      const json = await r.json()
      setResult(json)
      setStatus('done')
      setDocId('sample')
    } catch (e) {
      setError('Could not load sample')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="header">
        <div className="container header-inner">
          <div className="brand">MED<b>OCR</b></div>
          <div className="row meta">
            {docId && <span className="badge">ID: {docId}</span>}
            {status && <span className={`badge ${status==='done'?'ok':'warn'}`}>Status: {status}</span>}
            {confidenceBadge}
          </div>
        </div>
      </div>
      <div className="container app">
        <div className="panel">
          <div className="title">Upload</div>
          <div className="body">
            <label
              className="dropzone"
              onDragOver={e => { e.preventDefault() }}
              onDrop={async e => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) { setFile(f); setFileInfo(await describeFile(f)); } }}
            >
              <input
                type="file"
                accept="application/pdf"
                style={{ display: 'none' }}
                onChange={async e => { const f = e.target.files?.[0] || null; setFile(f); setFileInfo(f ? await describeFile(f) : null); }}
              />
              {file ? file.name : 'Drop referral PDF here or click to select'}
            </label>
            {fileInfo && (
              <div className="meta" style={{ marginTop: 8 }}>
                File: {fileInfo.name} • {fileInfo.type || 'unknown'} • {(fileInfo.size/1024|0)} KB • PDF header: {fileInfo.pdfHeader ? 'yes' : 'no'}
              </div>
            )}
            <div className="controls">
              <button className="btn" disabled={!file || loading} onClick={upload}>{loading ? <span className="row"><span className="spinner"/> Processing…</span> : 'Process Referral'}</button>
              <button className="btn secondary" onClick={loadSample} disabled={loading}>Load sample</button>
              {error && <span className="badge err" role="alert">{error}</span>}
            </div>
            <hr className="sep" />
            <div className="list">
              <div className="card">
                <div className="kv">
                  <div className="k">Accepted carriers</div>
                  <div>Aetna, Anthem, UHC, Medicare, Medicaid (see full list)</div>
                  <div className="k">Auto flags</div>
                  <div>DME mentions, Do‑Not‑Accept plans, 95811 criteria missing</div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="panel">
          <div className="title">Result</div>
          <div className="body">
            {!result && !error && <div className="meta">Upload a PDF to view extraction results.</div>}
            {!result && error && <div className="meta" style={{ color: '#ff7b72' }}>{error}</div>}
            {result && (
              <div className="list">
                <div className="card">
                  <div className="row">
                    <div className="badge">Patient</div>
                    <div className="meta">{result.patient?.last}, {result.patient?.first} • DOB {result.patient?.dob}</div>
                  </div>
                  <div className="kv" style={{ marginTop: 8 }}>
                    <div className="k">CPT</div>
                    <div>{result.procedure?.cpt} {result.procedure?.description ? `— ${result.procedure.description}` : ''}</div>
                    <div className="k">Insurance</div>
                    <div>{insuranceName}</div>
                    <div className="k">Diagnosis</div>
                    <div>
                      {Array.isArray(result.diagnoses) && result.diagnoses.length
                        ? (typeof result.diagnoses[0] === 'string'
                            ? result.diagnoses[0]
                            : (result.diagnoses[0]?.code || '—'))
                        : '—'}
                    </div>
                    {result?.documentMeta?.suggestedFilename && (
                      <>
                        <div className="k">Suggested filename</div>
                        <div>{result.documentMeta.suggestedFilename}</div>
                      </>
                    )}
                  </div>
                </div>
                {(result?.flags?.verifyManually || (result?.alerts?.actions||[]).length || result?.qc) && (
                  <div className="card">
                    <div className="row"><div className="badge">Quality</div><div className="meta">Flags, reasons, and checks</div></div>
                    <div className="kv" style={{ marginTop: 8 }}>
                      <div className="k">Manual review</div>
                      <div>{result?.flags?.verifyManually ? 'Yes' : 'No'}</div>
                      {Array.isArray(result?.flags?.reasons) && result.flags.reasons.length > 0 && (
                        <>
                          <div className="k">Reasons</div>
                          <div>{result.flags.reasons.join(', ')}</div>
                        </>
                      )}
                      {result?.qc && (
                        <>
                          <div className="k">QC</div>
                          <div>
                            name: {result.qc.nameConsistency || 'unknown'} • dob: {result.qc.dateValidity || 'unknown'} • phone: {result.qc.phoneValidity || 'unknown'} • cpt: {result.qc.cptValid || 'unknown'}
                          </div>
                        </>
                      )}
                      {Array.isArray(result?.alerts?.actions) && result.alerts.actions.length > 0 && (
                        <>
                          <div className="k">Actions</div>
                          <div>{result.alerts.actions.join(', ')}</div>
                        </>
                      )}
                    </div>
                  </div>
                )}
                <div className="card">
                  <div className="row"><div className="badge">Rules</div><div className="meta">Trace of matched rules</div></div>
                  <div className="row" style={{ marginBottom: 8 }}>
                    <button className="btn secondary" onClick={fetchDebug} disabled={!docId}>Show debug</button>
                    <div className="meta" style={{ marginLeft: 8 }}>(fetches /result?debug=1)</div>
                  </div>
                  {!debugTrace && <div className="meta">No trace loaded. Click "Show debug".</div>}
                  {Array.isArray(debugTrace) && debugTrace.length > 0 && (
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {debugTrace.map((t, i) => (
                        <li key={i}><code>{t.rule}</code>{t.value ? `: ${String(t.value)}` : ''}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="card">
                  <div className="row"><div className="badge">JSON</div><div className="meta">Full payload</div></div>
                  <pre className="json">{JSON.stringify(result, null, 2)}</pre>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="panel">
          <div className="title">Batch</div>
          <div className="body">
            {batchDates.length === 0 && <div className="meta">No batches yet.</div>}
            {batchDates.length > 0 && (
              <ul className="list" style={{ margin: 0, paddingLeft: 18 }}>
                {batchDates.map(d => (
                  <li key={d} style={{ marginBottom: 6 }}>
                    <span style={{ marginRight: 8 }}>{d}</span>
                    <a className="btn secondary" href={`${apiBase}/batch/${d}/cover.json`} target="_blank" rel="noreferrer">cover.json</a>
                    <a className="btn secondary" href={`${apiBase}/batch/${d}/cover.pdf`} target="_blank" rel="noreferrer" style={{ marginLeft: 6 }}>cover.pdf</a>
                    <a className="btn secondary" href={`${apiBase}/batch/${d}/problem-log.json`} target="_blank" rel="noreferrer" style={{ marginLeft: 6 }}>problems.json</a>
                    <a className="btn secondary" href={`${apiBase}/batch/${d}/problem-log.pdf`} target="_blank" rel="noreferrer" style={{ marginLeft: 6 }}>problems.pdf</a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
  <div className="container footer">Local development build — proxying API at /api to 127.0.0.1:4387</div>
    </>
  )
}

  async function describeFile(f) {
    const head = await f.slice(0, 5).arrayBuffer().catch(() => null)
    const sig = head ? new TextDecoder().decode(new Uint8Array(head)) : ''
    return { name: f.name, type: f.type, size: f.size, pdfHeader: sig.startsWith('%PDF') }
  }
