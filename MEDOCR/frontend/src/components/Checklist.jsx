import React, { useEffect, useState } from 'react';
import { checklistImportScan as apiChecklistImportScan, checklistUpdate as apiChecklistUpdate, checklistList as apiChecklistList, checklistArchive as apiChecklistArchive } from '../lib/api';

export default function Checklist(props) {
  const {
    checklistItems: pChecklistItems,
    results: pResults,
    searchTerm: pSearchTerm,
    setSearchTerm: pSetSearchTerm,
    statusFilter: pStatusFilter,
    setStatusFilter: pSetStatusFilter,
    carrierFilter: pCarrierFilter,
    setCarrierFilter: pSetCarrierFilter,
    loadChecklist: pLoadChecklist,
    groupBy: pGroupBy,
    setGroupBy: pSetGroupBy,
    noteDrafts: pNoteDrafts,
    setNoteDrafts: pSetNoteDrafts,
    mapActionToCommon: pMapActionToCommon,
  } = props || {};

  // Fallback self-managed state if not provided via props (App shell)
  const [localChecklistItems, setLocalChecklistItems] = useState([]);
  const [localResults] = useState([]);
  const [localSearchTerm, setLocalSearchTerm] = useState('');
  const [localStatusFilter, setLocalStatusFilter] = useState('all');
  const [localCarrierFilter, setLocalCarrierFilter] = useState('');
  const [localGroupBy, setLocalGroupBy] = useState('none');
  const [showArchived, setShowArchived] = useState(false);
  const [localNoteDrafts, setLocalNoteDrafts] = useState({});

  // Strong whole-row highlight styles
  const ROW_COLORS = {
    yellow: { bg: '#FEF3C7', border: '#F59E0B' }, // yellow-100 / amber-500
    green:  { bg: '#DCFCE7', border: '#10B981' }, // green-100 / emerald-500
    red:    { bg: '#FEE2E2', border: '#EF4444' }, // red-100 / red-500
    blue:   { bg: '#DBEAFE', border: '#3B82F6' }, // blue-100 / blue-500
    gray:   { bg: '#F3F4F6', border: '#9CA3AF' }, // gray-100 / gray-400
  };
  const rowStyleFor = (color, archived=false) => {
    const c = ROW_COLORS[color] || ROW_COLORS.gray;
    return { backgroundColor: c.bg, borderLeft: `6px solid ${c.border}`, opacity: archived ? 0.9 : 1 };
  };

  const mapActionToCommon = pMapActionToCommon || ((a) => {
    const s = String(a || '').toLowerCase();
    if (!s) return null;
    if (s.includes('verification') || (s.includes('no chart') && s.includes('insurance'))) return 'Generate insurance verification form';
    if (s.includes('questionnaire') || (s.includes('insufficient') && s.includes('information')) || s.includes('call patient')) return 'Insufficient information - sleep questionnaire required, call patient';
    if (s.includes('wrong test')) return 'Wrong test ordered - need order for complete sleep study due to no testing in last 5 years';
    if (s.includes('out of network') || s.includes('uts')) return 'Out of network - fax UTS → Generate UTS referral form';
    if (s.includes('authorization')) return 'Authorization required - submit/fax request → Generate authorization form';
    if (s.includes('missing demographics') || s.includes('demographic')) return 'Missing demographics - call provider for complete patient information';
    if (s.includes('provider follow')) return 'Provider follow-up required - obtain additional clinical documentation';
    if (s.includes('expired') || s.includes('terminated')) return 'Insurance expired/terminated - verify current coverage';
    if (s.includes('pediatric')) return 'Pediatric specialist referral required';
    if (s.includes('dme')) return 'DME evaluation needed before testing';
    return a;
  });

  const loadChecklist = pLoadChecklist || (async (includeArchived) => {
    try {
      const js = await apiChecklistList({ includeArchived: !!includeArchived });
      if (js.success) setLocalChecklistItems(js.items || []);
    } catch (_) {}
  });

  useEffect(() => {
    if (!pLoadChecklist) loadChecklist(showArchived);
  }, [showArchived]);

  // Choose external vs local state
  const checklistItems = pChecklistItems ?? localChecklistItems;
  const results = pResults ?? localResults;
  const searchTerm = pSearchTerm ?? localSearchTerm;
  const setSearchTerm = pSetSearchTerm ?? setLocalSearchTerm;
  const statusFilter = pStatusFilter ?? localStatusFilter;
  const setStatusFilter = pSetStatusFilter ?? setLocalStatusFilter;
  const carrierFilter = pCarrierFilter ?? localCarrierFilter;
  const setCarrierFilter = pSetCarrierFilter ?? setLocalCarrierFilter;
  const groupBy = pGroupBy ?? localGroupBy;
  const setGroupBy = pSetGroupBy ?? setLocalGroupBy;
  const noteDrafts = pNoteDrafts ?? localNoteDrafts;
  const setNoteDrafts = pSetNoteDrafts ?? setLocalNoteDrafts;

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
    checklist: Array.isArray(rec.checklist) ? rec.checklist : [],
    archived: !!rec.archived
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
    return { id: r.id || `res-${Math.random()}`, last, first, dob, carrier, member, actions: act, status: 'new', color: 'gray', checklist: [], archived: false };
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
          <button type="button" onClick={async ()=>{ try { await apiChecklistImportScan(); await loadChecklist(); alert('Imported from export folder'); } catch(_){ alert('Import failed'); } }} className="btn-secondary btn-small">Import From Exports</button>
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
                          <select value={it.status} onChange={async (e)=>{ try { await apiChecklistUpdate({ id: it.id, status: e.target.value }); loadChecklist(); } catch(_){} }} className="form-input text-sm">
                                  <option value="new">New</option>
                                  <option value="in_progress">In Progress</option>
                                  <option value="completed">Completed</option>
                                </select>
                          <select value={it.color} onChange={async (e)=>{ try { await apiChecklistUpdate({ id: it.id, color: e.target.value }); loadChecklist(); } catch(_){} }} className="form-input text-sm">
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
                              <input type="checkbox" checked={!!ch.done} onChange={async (e) => { const payload = { id: it.id, checklist: [{ key: ch.key, done: e.target.checked }] }; try { await apiChecklistUpdate(payload); loadChecklist(); } catch (_) {} }} className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500" />
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
                          <button type="button" onClick={async ()=>{ const txt = (noteDrafts[it.id] || '').trim(); if (!txt) return; try { await apiChecklistUpdate({ id: it.id, note: txt }); setNoteDrafts(d=>({ ...d, [it.id]: '' })); loadChecklist(); } catch(_){} }} className="btn-small btn-primary">Add Note</button>
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
                  <div
                    key={it.id || i}
                    className="p-4 rounded-xl shadow-lg border border-gray-200 overflow-hidden"
                    style={rowStyleFor(it.color, it.archived)}
                  >
                    <div className="flex justify-between items-center gap-4 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-gray-800">□ {it.last}, {it.first}</span>
                        <div className="text-sm text-gray-600 mt-1">DOB: {it.dob} | Insurance: {it.carrier} | ID: {it.member}</div>
                      </div>
                      {checklistItems.length > 0 && (
                        <div className="flex gap-2 flex-shrink-0">
                          <select value={it.status} onChange={async (e)=>{ try { await apiChecklistUpdate({ id: it.id, status: e.target.value }); loadChecklist(); } catch(_){} }} className="form-input text-sm">
                            <option value="new">New</option>
                            <option value="in_progress">In Progress</option>
                            <option value="completed">Completed</option>
                          </select>
                          <select value={it.color} onChange={async (e)=>{ try { await apiChecklistUpdate({ id: it.id, color: e.target.value }); loadChecklist(); } catch(_){} }} className="form-input text-sm">
                            <option value="gray">Gray</option>
                            <option value="yellow">Yellow</option>
                            <option value="green">Green</option>
                            <option value="red">Red</option>
                            <option value="blue">Blue</option>
                          </select>
                          {!it.archived ? (
                            <button type="button" onClick={async ()=>{ try { const ok = await apiChecklistArchive({ id: it.id, archived: true }); if (ok.success) loadChecklist(showArchived); } catch(_){} }} className="btn-outline btn-small">Archive</button>
                          ) : (
                            <button type="button" onClick={async ()=>{ try { const ok = await apiChecklistArchive({ id: it.id, archived: false }); if (ok.success) loadChecklist(showArchived); } catch(_){} }} className="btn-outline btn-small">Restore</button>
                          )}
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
                              <input type="checkbox" checked={!!ch.done} onChange={async (e) => { const payload = { id: it.id, checklist: [{ key: ch.key, done: e.target.checked }] }; try { await apiChecklistUpdate(payload); loadChecklist(); } catch (_) {} }} className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500" />
                              <span className={ch.done ? 'line-through text-gray-500' : ''}>{ch.label}</span>
                            </label>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <input placeholder="Add note..." value={noteDrafts[it.id] || ''} onChange={e=>setNoteDrafts(d=>({ ...d, [it.id]: e.target.value }))} className="form-input flex-1 text-sm" />
                          <button type="button" onClick={async ()=>{ const txt = (noteDrafts[it.id] || '').trim(); if (!txt) return; try { await apiChecklistUpdate({ id: it.id, note: txt }); setNoteDrafts(d=>({ ...d, [it.id]: '' })); loadChecklist(); } catch(_){} }} className="btn-small btn-primary">Add Note</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

          </div>
          {/* Removed static COMMON ADDITIONAL ACTIONS reference list per request */}

          <div className="flex gap-2 mt-4 items-center">
            <button type="button" onClick={() => { try { const el = document.querySelector('.card .template-html'); const text = el ? el.innerText : ''; navigator.clipboard.writeText(text); alert('Checklist copied to clipboard'); } catch(_){} }} className="btn-outline btn-small">Copy Checklist</button>
            <button type="button" onClick={()=>window.print()} className="btn-secondary btn-small">Print</button>
            <label className="ml-auto flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!showArchived} onChange={(e)=> setShowArchived(!!e.target.checked)} />
              <span>Show archived</span>
            </label>
          </div>
        </div>
      </div>
    </section>
  );
}
