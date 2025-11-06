const DEFAULT_PAGE_HEIGHT = 792;

function normalizeText(text) {
  return String(text || '').toLowerCase();
}

function normalizeWhitespace(text) {
  return normalizeText(text).replace(/\s+/g, ' ').trim();
}

function normalizeDigits(text) {
  return String(text || '').replace(/\D+/g, '');
}

function normalizeAlnum(text) {
  return normalizeText(text).replace(/[^a-z0-9]+/g, '');
}

function convertBboxToSpan(pageInfo, rawBox, scopeId, field) {
  if (!rawBox || !Array.isArray(rawBox.bbox) || rawBox.bbox.length < 4) {
    return null;
  }
  const [xRaw, yRaw, widthRaw, heightRaw] = rawBox.bbox.map(v => Number.isFinite(Number(v)) ? Number(v) : 0);
  const width = widthRaw || 0;
  const height = heightRaw || 0;
  const x = xRaw || 0;
  const y = yRaw || 0;
  if (width <= 0 || height <= 0) return null;
  const pageHeight = pageInfo.height || DEFAULT_PAGE_HEIGHT;
  const pdfY = Math.max(0, pageHeight - (y + height));
  return {
    page: pageInfo.pageNumber,
    scopeId,
    field,
    bbox: {
      x: Math.max(0, x),
      y: pdfY,
      width,
      height
    }
  };
}

function buildHighlightSpans(result) {
  const spans = [];
  const dedupe = new Set();
  const pages = Array.isArray(result?.ocr) ? result.ocr : [];
  if (!pages.length) return spans;

  const pageInfos = pages.map((page, idx) => {
    const boxes = Array.isArray(page?.boxes) ? page.boxes : [];
    const processed = boxes
      .map(box => {
        if (!box || !Array.isArray(box.bbox) || box.bbox.length < 4) return null;
        const text = String(box.text || '');
        return {
          raw: box,
          norm: normalizeText(text),
          simple: normalizeWhitespace(text),
          digits: normalizeDigits(text),
          alnum: normalizeAlnum(text)
        };
      })
      .filter(Boolean);

    const height = processed.reduce((max, box) => {
      const [, y = 0, , h = 0] = box.raw.bbox;
      return Math.max(max, Number(y) + Number(h));
    }, 0);

    return {
      pageNumber: Number(page?.page) || idx + 1,
      height: height || DEFAULT_PAGE_HEIGHT,
      boxes: processed
    };
  });

  let currentPage = pageInfos[0];

  function addSpan(box, scopeId, field) {
    const span = convertBboxToSpan(currentPage, box.raw, scopeId, field);
    if (!span) return;
    const key = `${span.page}:${span.bbox.x}:${span.bbox.y}:${field}`;
    if (dedupe.has(key)) return;
    dedupe.add(key);
    spans.push(span);
  }

  function highlightValue(value, scopeId, field, property = 'simple', maxPerField = 4) {
    const normalized = property === 'digits'
      ? normalizeDigits(value)
      : property === 'alnum'
        ? normalizeAlnum(value)
        : normalizeWhitespace(value);
    if (!normalized) return;
    let matched = 0;
    for (const pageInfo of pageInfos) {
      currentPage = pageInfo;
      for (const box of pageInfo.boxes) {
        const hay = box[property];
        if (!hay || !hay.includes(normalized)) continue;
        addSpan(box, scopeId, field);
        matched++;
        if (matched >= maxPerField) return;
      }
    }
  }

  function highlightByPredicate(scopeId, field, predicate, maxPerField = 4) {
    let matched = 0;
    for (const pageInfo of pageInfos) {
      currentPage = pageInfo;
      for (const box of pageInfo.boxes) {
        if (!predicate(box)) continue;
        addSpan(box, scopeId, field);
        matched++;
        if (matched >= maxPerField) return;
      }
    }
  }

  const patient = result?.patient || {};
  const insurance = Array.isArray(result?.insurance) ? result.insurance[0] || {} : {};
  const provider = result?.provider || {};
  const procedure = result?.procedure || {};

  if (patient.last) {
    highlightValue(patient.last, 'patient', 'Patient Last Name', 'simple', 2);
  }
  if (patient.first) {
    highlightValue(patient.first, 'patient', 'Patient First Name', 'simple', 2);
  }
  if (patient.dob) {
    highlightValue(patient.dob, 'patient', 'DOB', 'simple', 2);
  }
  if (Array.isArray(patient.phones)) {
    for (const phone of patient.phones) {
      highlightValue(phone, 'patient', 'Patient Phone', 'digits', 2);
    }
  }
  if (patient.email) {
    highlightValue(patient.email, 'patient', 'Patient Email', 'simple', 2);
  }

  if (insurance.carrier) {
    highlightValue(insurance.carrier, 'default', 'Insurance Carrier', 'simple', 3);
  }
  if (insurance.memberId) {
    highlightValue(insurance.memberId, 'default', 'Member ID', 'alnum', 3);
  }
  if (insurance.groupId) {
    highlightValue(insurance.groupId, 'default', 'Group ID', 'alnum', 2);
  }

  if (procedure.cpt) {
    highlightValue(procedure.cpt, 'default', 'CPT Code', 'alnum', 2);
  }
  if (procedure.description) {
    highlightValue(procedure.description, 'default', 'Procedure Description', 'simple', 2);
  }

  if (provider.name) {
    highlightValue(provider.name, 'provider', 'Provider Name', 'simple', 3);
  }
  if (provider.npi) {
    highlightValue(provider.npi, 'provider', 'Provider NPI', 'digits', 2);
  }
  if (provider.phone) {
    highlightValue(provider.phone, 'provider', 'Provider Phone', 'digits', 2);
  }
  if (provider.fax) {
    highlightValue(provider.fax, 'provider', 'Provider Fax', 'digits', 2);
  }
  if (provider.practice) {
    highlightValue(provider.practice, 'facility', 'Facility Name', 'simple', 2);
  }

  // As a fallback, highlight any line containing "member id" or "insurance" to provide context
  highlightByPredicate('default', 'Insurance Block', box => /member\s*(id|number)|subscriber|policy/i.test(box.raw.text || ''), 4);

  return spans;
}

export { buildHighlightSpans };
