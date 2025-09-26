// Patient name + DOB detectors used by the rules engine

export function detectName(fullText, linesLCInput) {
  const origLines = fullText.split(/\r?\n/);
  const linesLC = Array.isArray(linesLCInput)
    ? linesLCInput
    : origLines.map(l => String(l || '').toLowerCase());

  // Words that indicate addresses/context, not person names
  const addressStop = new Set([
    'road','rd','street','st','suite','ste','ave','avenue','blvd','drive','dr','court','ct','lane','ln',
    'circle','cir','parkway','pkwy','apt','apartment','unit','floor','fl','highway','hwy','way','terrace','ter',
    'place','pl','north','south','east','west','n','s','e','w','city','state','zip','address','phone','fax'
  ]);

  const hasAt = s => /@/.test(s || '');
  const stripAfterDob = s => String(s || '').replace(/\b(0[1-9]|1[0-2])[\/-](0[1-9]|[12]\d|3[01])[\/-]((?:19|20)\d{2})\b.*$/, '').trim();

  // Allow unicode letters, apostrophes, hyphens
  const nameToken = "[A-Za-z\\p{L}'’\\-]+";
  const reLastFirst = new RegExp(`\\b(${nameToken})\\s*,\\s*(${nameToken})(?:\\s+(${nameToken}))?\\b`, 'u');
  const reFirstLast = new RegExp(`\\b(${nameToken})\\s+(${nameToken})(?:\\s+(${nameToken}))?\\b`, 'u');

  function looksLikeNameCandidate(text) {
    if (!text) return false;
    if (hasAt(text)) return false;
    const tokens = text
      .replace(/[^A-Za-z\p{L}'’\- ]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean);
    if (tokens.length < 2 || tokens.length > 4) return false;
    if (tokens.some(t => addressStop.has(t.toLowerCase()))) return false;
    return true;
  }

  function tc(s) {
    return String(s || '').toLowerCase().replace(/\b([a-z\p{Ll}])/gu, (_, c) => c.toUpperCase());
  }

  function assembleName(m, order) {
    const a = m[1], b = m[2];
    const last = order === 'lf' ? a : b;
    const first = order === 'lf' ? b : a;
    if (addressStop.has(last.toLowerCase()) || addressStop.has(first.toLowerCase())) return null;
    return { last: tc(last), first: tc(first) };
  }

  // 1) Labeled lines: “Patient Name:”, “Patient:”, “Name:”
  let idx = linesLC.findIndex(l => /(patient\s*name|patient|name)\s*[:\-]\s*/i.test(l));
  if (idx >= 0) {
    const lineOrig = origLines[idx] || '';
    const afterColon = lineOrig.split(/[:\-]/).slice(1).join(':').trim();
    const candidateLines = [afterColon, origLines[idx + 1] || ''].map(stripAfterDob).filter(Boolean);
    for (const cand of candidateLines) {
      if (!looksLikeNameCandidate(cand)) continue;
      let m = cand.match(reLastFirst);
      if (m) {
        const val = assembleName(m, 'lf');
        if (val) return { hit: true, value: val, why: 'patient_name_labeled_lf' };
      }
      m = cand.match(reFirstLast);
      if (m) {
        const val = assembleName(m, 'fl');
        if (val) return { hit: true, value: val, why: 'patient_name_labeled_fl' };
      }
    }
  }

  // 2) Separate First/Last labeled fields
  let firstVal = null, lastVal = null;
  for (let i = 0; i < linesLC.length && i < 80; i++) {
    const o = origLines[i] || '';
    if (!firstVal) {
      const m1 = o.match(new RegExp(`first\\s*name\\s*[:\\-]?\\s*(${nameToken})(?:\\s+(${nameToken}))?`, 'iu'));
      const lookNext = !m1 && /first\s*name\s*[:\-]?\s*$/i.test(o);
      const src = m1 ? m1[1] : (lookNext ? (origLines[i + 1] || '') : '');
      if (src && looksLikeNameCandidate(src)) firstVal = tc(src.split(/\s+/)[0]);
    }
    if (!lastVal) {
      const m2 = o.match(new RegExp(`last\\s*name\\s*[:\\-]?\\s*(${nameToken})`, 'iu'));
      const lookNext = !m2 && /last\s*name\s*[:\-]?\s*$/i.test(o);
      const src = m2 ? m2[1] : (lookNext ? (origLines[i + 1] || '') : '');
      if (src && looksLikeNameCandidate(src)) lastVal = tc(src.split(/\s+/)[0]);
    }
    if (firstVal && lastVal) return { hit: true, value: { first: firstVal, last: lastVal }, why: 'patient_name_fields' };
  }

  // 3) Fallback: scan first ~40 lines
  const scan = origLines.slice(0, Math.min(40, origLines.length)).map(stripAfterDob);
  for (const line of scan) {
    if (!looksLikeNameCandidate(line)) continue;
    let m = line.match(reLastFirst);
    if (m) {
      const val = assembleName(m, 'lf');
      if (val) return { hit: true, value: val, why: 'patient_name_fallback_lf' };
    }
    m = line.match(reFirstLast);
    if (m) {
      const val = assembleName(m, 'fl');
      if (val) return { hit: true, value: val, why: 'patient_name_fallback_fl' };
    }
  }

  return { hit: false, why: 'name_none' };
}

export function detectDob(fullText) {
  const origLines = fullText.split(/\r?\n/);

  const dateRe = /\b(0?[1-9]|1[0-2])[\/-](0?[1-9]|[12]\d|3[01])[\/-]((?:19|20)\d{2})\b/;
  const dobLabelRe = /(dob|d\.\s*o\.\s*b\.|date\s*of\s*birth)\s*[:\-]?\s*(.*)$/i;
  const notDobContextRe = /(referral\s*date|order\s*date|date\s*of\s*service|dos\b|service\s*date|signed|signature|fax|scanned|printed|report\s*date|visit\s*date|appt|appointment|today|now)/i;

  const now = new Date();
  const currentYear = now.getFullYear();
  const pad2 = n => String(n).padStart(2, '0');
  const normalize = m => `${pad2(m[1])}/${pad2(m[2])}/${m[3]}`;

  const ageMatch = fullText.match(/\bage\s*[:\-]?\s*(\d{1,3})\b/i);
  const ageVal = ageMatch ? parseInt(ageMatch[1], 10) : null;

  function plausibleDob(y) {
    if (y > currentYear - 1) return false; // no future/this-year DOBs for adults
    if (y < 1900) return false;
    return true;
  }

  function scoreCandidate(lineIdx, m, whyBase) {
    const y = parseInt(m[3], 10);
    if (!plausibleDob(y)) return { score: -Infinity };
    let score = Math.max(0, 20 - lineIdx); // nearer top preferred
    if (ageVal != null) {
      const approx = currentYear - y;
      const delta = Math.abs(approx - ageVal);
      if (delta <= 2) score += 5;
      else if (delta <= 5) score += 2;
      else score -= 4;
    }
    return { score, value: normalize(m), why: whyBase };
  }

  // 1) Labeled same-line or next-line
  for (let i = 0; i < origLines.length && i < 120; i++) {
    const line = origLines[i] || '';
    const label = line.match(dobLabelRe);
    if (label) {
      const after = label[2] || '';
      const mSame = after.match(dateRe);
      if (mSame) {
        const s = scoreCandidate(i, mSame, 'dob_labeled_same_line');
        if (s.score > -Infinity) return { hit: true, value: s.value, why: s.why };
      }
      for (let j = 1; j <= 2 && i + j < origLines.length; j++) {
        const next = origLines[i + j] || '';
        const mNext = next.match(dateRe);
        if (mNext) {
          const s = scoreCandidate(i + j, mNext, 'dob_labeled_next_line');
          if (s.score > -Infinity) return { hit: true, value: s.value, why: s.why };
        }
      }
    }
  }

  // 2) Context-filtered scan
  let best = { score: -Infinity, value: null, why: null };
  for (let i = 0; i < origLines.length && i < 200; i++) {
    const line = origLines[i] || '';
    if (notDobContextRe.test(line)) continue;
    const m = line.match(dateRe);
    if (!m) continue;
    const s = scoreCandidate(i, m, 'dob_context_scan');
    if (s.score > best.score) best = s;
  }
  if (best.score > -Infinity) return { hit: true, value: best.value, why: best.why };

  // 3) Fallback
  for (let i = 0; i < origLines.length; i++) {
    const m = (origLines[i] || '').match(dateRe);
    if (m && plausibleDob(parseInt(m[3], 10))) {
      return { hit: true, value: normalize(m), why: 'dob_fallback' };
    }
  }

  return { hit: false, why: 'dob_none' };
}
