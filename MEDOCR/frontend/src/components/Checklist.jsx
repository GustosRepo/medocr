import React from 'react';

export default function Checklist(props) {
  const {
    checklistItems, results, searchTerm, setSearchTerm,
    statusFilter, setStatusFilter, carrierFilter, setCarrierFilter,
    loadChecklist, groupBy, setGroupBy, noteDrafts, setNoteDrafts,
    mapActionToCommon
  } = props;

  // Build items list (mirrors previous App.renderChecklist logic)
  let items = checklistItems && checklistItems.length ? checklistItems.map(rec => ({
    id: rec.id,
    last: rec.patient?.last_name || 'Not found',
    first: rec.patient?.first_name || 'Not found',
    dob: rec.patient?.dob || 'Not found',
    carrier: rec.insurance?.carrier || 'Not found',
    member: rec.insurance?.member_id || 'Not found',
    actions: Array.isArray(rec.actions) ? rec.actions.map(mapActionToCommon).filter(Boolean) : [],
    status: rec.status || 'new',
    color: rec.color || 'gray',
    checklist: Array.isArray(rec.checklist) ? rec.checklist : []
  })) : (results || []).map((r) => {
    const ed = r.enhanced_data || {};
    const p = ed.patient || {};
    const ins = (ed.insurance && ed.insurance.primary) || {};
    const last = p.last_name || 'Not found';
    const first = p.first_name || 'Not found';
    const dob = p.dob || 'Not found';
    const carrier = ins.carrier || 'Not found';
    const member = ins.member_id || 'Not found';
    const act = Array.isArray(r.actions) && r.actions.length ? r.actions.map(mapActionToCommon).filter(Boolean) : [];
    return { id: r.id || `res-${Math.random()}`, last, first, dob, carrier, member, actions: act, status: 'new', color: 'gray', checklist: [] };
  });

  const st = (searchTerm || '').toLowerCase();
  items = items.filter(it => {
    if (statusFilter !== 'all' && it.status !== statusFilter) return false;
    if (carrierFilter && !String(it.carrier||'').toLowerCase().includes(carrierFilter.toLowerCase())) return false;
    if (!st) return true;
    return [it.last, it.first, it.member, it.carrier].some(v => String(v||'').toLowerCase().includes(st));
  });

  return (
    <section className="card">
      <div className="card-header">
        <h2 className="text-xl font-semibold">Patient Checklist</h2>
      </div>
      <div className="card-body">
        <div className="flex flex-wrap gap-2 mb-4">
          <input
            placeholder="Search patient, member, carrier"
            value={searchTerm}
            onChange={e=>setSearchTerm(e.target.value)}
            className="form-input flex-1 min-w-[200px]"
          />
          <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} className="form-input w-auto">
            <option value="all">All statuses</option>
            <option value="new">New</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
          </select>
          <input placeholder="Carrier filter" value={carrierFilter} onChange={e=>setCarrierFilter(e.target.value)} className="form-input w-40" />
          <button type="button" onClick={loadChecklist} className="btn-outline btn-small">Refresh</button>
          <button type="button" onClick={async ()=>{ try { await fetch('http://localhost:5001/checklist/import-scan', { method:'POST' }); await loadChecklist(); alert('Imported from export folder'); } catch(_){ alert('Import failed'); } }} className="btn-secondary btn-small">Import From Exports</button>
          <select value={groupBy} onChange={e=>setGroupBy(e.target.value)} className="form-input w-auto">
            <option value="none">Group: None</option>
            <option value="carrier">Group: Insurance</option>
          </select>
        </div>

        <div className="space-y-4">
          <div className="font-bold text-lg text-gray-800">PATIENT CHECKLIST:</div>
          <div>
            {items.length === 0 && (
              <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 text-center">
                <p className="text-gray-600 text-sm">No checklist records yet. Export a combined PDF, or click "Import From Exports" to scan your Desktop/MEDOCR-Exports folder.</p>
              </div>
            )}

            {groupBy === 'carrier' ? (
              (() => {
                const groups = items.reduce((acc, it) => { const k = it.carrier || 'Unknown'; (acc[k] = acc[k] || []).push(it); return acc; }, {});
                return Object.keys(groups).sort().map((k) => (
                  <div key={k} className="mb-6">
                    <h3 className="font-bold text-lg text-gray-800 mb-3 px-2">{k}</h3>
                    <div className="space-y-3">
                      {groups[k].map((it, i) => (
                        <div key={it.id || i} className={`card p-4 border-l-4 ${
                          it.color === 'yellow' ? 'bg-yellow-50 border-l-yellow-400' :
                          it.color === 'green' ? 'bg-green-50 border-l-green-500' :
                          it.color === 'red' ? 'bg-red-50 border-l-red-500' :
                          it.color === 'blue' ? 'bg-blue-50 border-l-blue-500' :
                          'bg-gray-50 border-l-gray-400'
                        }`}>
                          <div className="flex justify-between items-center gap-4 flex-wrap">
                            <div className="flex-1 min-w-0">
                              <span className="font-medium text-gray-800">□ {it.last}, {it.first}</span>
                              <div className="text-sm text-gray-600 mt-1">DOB: {it.dob} | Insurance: {it.carrier} | ID: {it.member}</div>
                            </div>
                            {checklistItems.length > 0 && (
                              <div className="flex gap-2 flex-shrink-0">
                                <select value={it.status} onChange={async (e)=>{ try { await fetch('http://localhost:5001/checklist/update', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: it.id, status: e.target.value })}); loadChecklist(); } catch(_){} }} className="form-input text-sm">
                                  <option value="new">New</option>
                                  <option value="in_progress">In Progress</option>
                                  <option value="completed">Completed</option>
                                </select>
                                <select value={it.color} onChange={async (e)=>{ try { await fetch('http://localhost:5001/checklist/update', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: it.id, color: e.target.value })}); loadChecklist(); } catch(_){} }} className="form-input text-sm">
                                  <option value="gray">Gray</option>
                                  <option value="yellow">Yellow</option>
                                  <option value="green">Green</option>
                                  <option value="red">Red</option>
                                  <option value="blue">Blue</option>
                                </select>
                              </div>
                            )}
                          </div>
                          {it.actions && it.actions.length > 0 && (
                            <div className="mt-3 pl-4 text-sm text-gray-700 bg-white/50 rounded-lg p-2"><span className="font-medium">Additional Actions Required:</span> {it.actions.join('; ')}</div>
                          )}
                          {checklistItems.length > 0 && (
                            <div className="mt-3 pl-4">
                              <div className="flex flex-wrap gap-3 mb-3">
                                {(it.checklist||[]).map(ch => (
                                  <label key={ch.key} className="flex items-center gap-2 text-sm">
                                    <input type="checkbox" checked={!!ch.done} onChange={async (e) => { const payload = { id: it.id, checklist: [{ key: ch.key, done: e.target.checked }] }; try { await fetch('http://localhost:5001/checklist/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); loadChecklist(); } catch (_) {} }} className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500" />
                                    <span className={ch.done ? 'line-through text-gray-500' : ''}>{ch.label}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}
                          {checklistItems.length > 0 && (
                            <div className="mt-3 pl-4">
                              <div className="flex gap-2">
                                <input placeholder="Add note..." value={noteDrafts[it.id] || ''} onChange={e=>setNoteDrafts(d=>({ ...d, [it.id]: e.target.value }))} className="form-input flex-1 text-sm" />
                                <button type="button" onClick={async ()=>{ const txt = (noteDrafts[it.id] || '').trim(); if (!txt) return; try { await fetch('http://localhost:5001/checklist/update', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: it.id, note: txt }) }); setNoteDrafts(d=>({ ...d, [it.id]: '' })); loadChecklist(); } catch(_){} }} className="btn-small btn-primary">Add Note</button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ));
              })()
            ) : (
              <div className="space-y-3">
                {items.map((it, i) => (
                  <div key={it.id || i} className={`card p-4 border-l-4 ${
                    it.color === 'yellow' ? 'bg-yellow-50 border-l-yellow-400' :
                    it.color === 'green' ? 'bg-green-50 border-l-green-500' :
                    it.color === 'red' ? 'bg-red-50 border-l-red-500' :
                    it.color === 'blue' ? 'bg-blue-50 border-l-blue-500' :
                    'bg-gray-50 border-l-gray-400'
                  }`}>
                    <div className="flex justify-between items-center gap-4 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-gray-800">□ {it.last}, {it.first}</span>
                        <div className="text-sm text-gray-600 mt-1">DOB: {it.dob} | Insurance: {it.carrier} | ID: {it.member}</div>
                      </div>
                      {checklistItems.length > 0 && (
                        <div className="flex gap-2 flex-shrink-0">
                          <select value={it.status} onChange={async (e)=>{ try { await fetch('http://localhost:5001/checklist/update', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: it.id, status: e.target.value })}); loadChecklist(); } catch(_){} }} className="form-input text-sm">
                            <option value="new">New</option>
                            <option value="in_progress">In Progress</option>
                            <option value="completed">Completed</option>
                          </select>
                          <select value={it.color} onChange={async (e)=>{ try { await fetch('http://localhost:5001/checklist/update', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: it.id, color: e.target.value })}); loadChecklist(); } catch(_){} }} className="form-input text-sm">
                            <option value="gray">Gray</option>
                            <option value="yellow">Yellow</option>
                            <option value="green">Green</option>
                            <option value="red">Red</option>
                            <option value="blue">Blue</option>
                          </select>
                        </div>
                      )}
                    </div>
                    {it.actions && it.actions.length > 0 && (
                      <div className="mt-3 pl-4 text-sm text-gray-700 bg-white/50 rounded-lg p-2"><span className="font-medium">Additional Actions Required:</span> {it.actions.join('; ')}</div>
                    )}
                    {checklistItems.length > 0 && (
                      <div className="mt-3 pl-4">
                        <div className="flex flex-wrap gap-3 mb-3">
                          {(it.checklist||[]).map(ch => (
                            <label key={ch.key} className="flex items-center gap-2 text-sm">
                              <input type="checkbox" checked={!!ch.done} onChange={async (e) => { const payload = { id: it.id, checklist: [{ key: ch.key, done: e.target.checked }] }; try { await fetch('http://localhost:5001/checklist/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); loadChecklist(); } catch (_) {} }} className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500" />
                              <span className={ch.done ? 'line-through text-gray-500' : ''}>{ch.label}</span>
                            </label>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <input placeholder="Add note..." value={noteDrafts[it.id] || ''} onChange={e=>setNoteDrafts(d=>({ ...d, [it.id]: e.target.value }))} className="form-input flex-1 text-sm" />
                          <button type="button" onClick={async ()=>{ const txt = (noteDrafts[it.id] || '').trim(); if (!txt) return; try { await fetch('http://localhost:5001/checklist/update', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: it.id, note: txt }) }); setNoteDrafts(d=>({ ...d, [it.id]: '' })); loadChecklist(); } catch(_){} }} className="btn-small btn-primary">Add Note</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

          </div>
          {/* Removed static COMMON ADDITIONAL ACTIONS reference list per request */}

          <div className="flex gap-2 mt-4">
            <button type="button" onClick={() => { try { const el = document.querySelector('.card .template-html'); const text = el ? el.innerText : ''; navigator.clipboard.writeText(text); alert('Checklist copied to clipboard'); } catch(_){} }} className="btn-outline btn-small">Copy Checklist</button>
            <button type="button" onClick={()=>window.print()} className="btn-secondary btn-small">Print</button>
          </div>
        </div>
      </div>
    </section>
  );
}
