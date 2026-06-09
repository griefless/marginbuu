'use strict';

let _intakeMode = 'file'; // 'file' | 'paste'

function switchIntakeTab(mode, btn) {
  _intakeMode = mode;
  document.querySelectorAll('.intake-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.intake-panel').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('intake-' + mode).classList.add('active');
  if (mode === 'paste') {
    const ta = document.getElementById('paste-input');
    ta.addEventListener('input', () => {
      document.getElementById('start-btn').disabled = !ta.value.trim();
    }, { once: false });
  }
}

// Canonical (null-safe) OCR progress functions — Step 16: only this version kept
function showOCRProgress(page, totalPages) {
  const el = document.getElementById('ocr-progress');
  if (!el) return;
  el.classList.add('active');
  const pct = totalPages > 0 ? Math.round((page / totalPages) * 100) : 0;
  document.getElementById('ocr-bar').style.width = pct + '%';
  document.getElementById('ocr-page-info').textContent =
    totalPages > 0 ? `Page ${page} of ${totalPages} — ${pct}% complete` : 'Initialising OCR…';
}
function hideOCRProgress() {
  const el = document.getElementById('ocr-progress');
  if (el) el.classList.remove('active');
}

const ALL_CATEGORIES = [
  'Civil & Construction',
  'Plumbing & Drainage',
  'Electrical & LV Systems',
  'Mechanical & HVAC',
  'Fencing & Security',
  'General Supplies & PPE',
  'Health & Medical',
  'Electronics & ICT',
  'Labour & Installation',
  'Unclassified',
];

let _activeCategories = new Set(ALL_CATEGORIES);

function buildCategoryFilter() {
  const grid = document.getElementById('cat-filter-grid');
  if (!grid) return;
  grid.innerHTML = ALL_CATEGORIES.map(cat => `
    <label class="cat-check${_activeCategories.has(cat) ? ' active' : ''}">
      <input type="checkbox" ${_activeCategories.has(cat) ? 'checked' : ''}
        onchange="toggleCategory('${cat}',this)"> ${cat}
    </label>`).join('');
}

function toggleCategory(cat, checkbox) {
  if (checkbox.checked) _activeCategories.add(cat);
  else _activeCategories.delete(cat);
  checkbox.parentElement.classList.toggle('active', checkbox.checked);
  filterReviewTable();
}

function filterReviewTable() {
  document.querySelectorAll('#review-tbody tr').forEach(tr => {
    if (tr.classList.contains('review-section-hdr') || tr.classList.contains('review-subsec-hdr')) return;
    tr.style.display = _activeCategories.has(tr.dataset.cat) ? '' : 'none';
  });
}

function handleFile(file) {
  window._boqFile = file;
  const dz = document.getElementById('drop-zone');
  if (dz) dz.classList.add('has-file');
  const el = document.getElementById('dz-fname');
  if (el) el.textContent = '✓ ' + file.name;
  document.getElementById('start-btn').disabled = false;
  toast('File ready: ' + file.name);
}

async function parseBOQFromText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const items = [];
  const LINE_PATTERN = /^([A-Z0-9]+(?:[.\-][A-Z0-9]+)*)\s+(.{3,}?)\s+([\d,\.]+)\s+([a-zA-Z²³\/]+)\s*(?:([\d,\.]+)\s*)?([\d,\.]+)?$/i;
  lines.forEach(line => {
    const m = line.match(LINE_PATTERN);
    if (!m) return;
    const [, no, desc, qtyStr, unit, rateStr, totalStr] = m;
    const qty  = parseFloat(qtyStr.replace(/,/g,''))||0;
    const rate = rateStr  ? parseFloat(rateStr.replace(/,/g,''))  : null;
    const price= totalStr ? parseFloat(totalStr.replace(/,/g,'')) : null;
    const lm   = detectLabour(desc);
    items.push({ no, desc, unit, qty:qty||1, rate, price:price||null,
      cat:detectCategoryClient(desc), item_type:lm.isLabour?'labour':'material', ...lm });
  });
  return items;
}

// ── OCR routing threshold ─────────────────────────────────────────────────────
// Files larger than this are routed to the Background Function (15 min timeout).
// ~500 KB ≈ 5–10 scanned pages at moderate scan quality; adjust if needed.
const OCR_BG_THRESHOLD_BYTES = 500 * 1024; // 500 KB

// ── Job ID generator (browser-native, no crypto dep) ─────────────────────────
function generateJobId() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Normalises a raw server parse response into the client item shape.
 */
function normaliseParsedItems(data) {
  if (!data.items?.length) return { items: [], excluded: [] };
  const items = data.items.map(i => {
    const lm = detectLabour(i.description || '');
    return {
      no:   i.item_no || '', desc: i.description || '', unit: i.unit || '',
      qty:  i.quantity || 1, rate: i.unit_rate || null, price: i.total || null,
      cat:  i.category || 'Unclassified', item_type: i.item_type || 'material',
      incomplete: i.incomplete || false, _split: i._split || false, spec: i.spec || null,
      section_name: i.section_name || '', subsection_name: i.subsection_name || '',
      context_note: i.context_note || '',
      classification_confidence: i.classification_confidence || 'high',
      description: i.description || '', quantity: i.quantity || 1,
      category: i.category || 'Unclassified',
      ...lm,
    };
  });
  return { items, excluded: data.excluded || [] };
}

/**
 * Parses a BOQ file via the synchronous search-prices function.
 * Used for small files (< OCR_BG_THRESHOLD_BYTES) or non-OCR types (DOCX).
 */
async function parseBOQViaServer(file) {
  try {
    const form = new FormData();
    form.append('file', file, file.name);
    const resp = await fetch(`${FUNCTION_URL}?action=parse`, { method: 'POST', body: form });
    
    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      throw new Error(
        `Server parse failed: HTTP ${resp.status}` + 
        (errBody.error ? ` — ${errBody.error}` : '')
      );
    }
    
    const result = await resp.json();
    return normaliseParsedItems(result);
  } catch (err) {
    if (err.message.includes('fetch')) {
      throw new Error('Network error: Unable to reach server. Check your internet connection.');
    }
    throw err;
  }
}

/**
 * Parses a large scanned PDF or image via the Background Function.
 * Submits the file, then polls ocr-poll every 2 s, updating the OCR progress bar.
 *
 * @param {File} file
 * @returns {Promise<{items, excluded}>}
 */
async function parseBOQViaBackground(file) {
  const jobId = generateJobId();
  const BG_URL   = '/.netlify/functions/ocr-intake-background';
  const POLL_URL = '/.netlify/functions/ocr-poll';
  const POLL_INTERVAL_MS  = 2000;
  const POLL_TIMEOUT_MS   = 14 * 60 * 1000; // 14 min safety cap (BG limit is 15)

  // ── 1. Submit to background function ─────────────────────────────────────
  showOCRProgress(0, 0);
  updateOCRText('Submitting document for background OCR…');

  const form = new FormData();
  form.append('file', file, file.name);
  const submitResp = await fetch(`${BG_URL}?jobId=${jobId}`, { method: 'POST', body: form });

  // Background Functions return 202 Accepted immediately
  if (submitResp.status !== 202 && !submitResp.ok) {
    const errBody = await submitResp.json().catch(() => ({}));
    throw new Error('OCR submission failed: HTTP ' + submitResp.status + (errBody.error ? ' — ' + errBody.error : ''));
  }

  // ── 2. Poll until done ───────────────────────────────────────────────────
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

    let poll;
    try {
      const pollResp = await fetch(`${POLL_URL}?jobId=${jobId}`);
      poll = await pollResp.json();
    } catch (e) {
      // Transient network error — keep polling
      continue;
    }

    if (poll.status === 'not_found' || poll.status === 'pending') {
      // Update progress bar with latest server data
      const pagesTotal = poll.pagesTotal || 0;
      const pagesDone  = poll.pagesDone  || 0;
      const pct        = poll.progress   || 0;

      if (pagesTotal > 0) {
        showOCRProgress(pagesDone, pagesTotal);
        updateOCRText(
          `Background OCR — page ${pagesDone} of ${pagesTotal} — ${pct}%`
        );
      } else {
        updateOCRText('Background OCR — initialising Tesseract…');
      }
      continue;
    }

    if (poll.status === 'error') {
      throw new Error('Background OCR failed: ' + (poll.error || 'unknown error'));
    }

    if (poll.status === 'done') {
      showOCRProgress(poll.pagesTotal || 1, poll.pagesTotal || 1);
      return normaliseParsedItems(poll);
    }
  }

  throw new Error('OCR timed out after 14 minutes. The document may be too large or the server is unavailable.');
}

/**
 * Updates the OCR progress bar text label (separate from page counter).
 */
function updateOCRText(msg) {
  const el = document.getElementById('ocr-page-info');
  if (el) el.textContent = msg;
}

function detectCategoryClient(desc) {
  if (!desc) return 'Unclassified';
  const d = desc.toLowerCase();
  const MAP = {
    'Civil & Construction':   ['concrete','rebar','formwork','earthwork','backfill','excavat','brick','block','paving','screed','kerb'],
    'Plumbing & Drainage':    ['pipe','valve','sanitary','basin','toilet','sewer','drain','upvc','hdpe','tap','geyser','cistern'],
    'Electrical & LV Systems':['cable','conduit','db','mcb','rccb','isolator','socket','light','switch','busbar','earthing','armoured','switchgear','mccb','kiosk'],
    'Mechanical & HVAC':      ['duct','fan','ahu','chiller','pump','compressor','refrigerant','insulation','diffuser','hvac'],
    'Fencing & Security':     ['fence','palisade','razor wire','gate','cctv','access control','boom','barrier','electric fence'],
    'General Supplies & PPE': ['gloves','helmet','vest','boot','goggles','tape','fastener','bolt','nut','paint','primer'],
    'Health & Medical':       ['bandage','first aid','stretcher','medication','sanitiser','medical'],
    'Electronics & ICT':      ['router','server','ups','fibre','patch panel','rack','ip camera','network','structured cabling'],
    'Labour & Installation':  ['install','erect','lay','fix','weld','connect','terminate','commission','test','demolish','excavate','hang'],
  };
  for (const [cat, keys] of Object.entries(MAP)) {
    if (keys.some(k => d.includes(k))) return cat;
  }
  return 'Unclassified';
}

async function parseBOQ(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = new Uint8Array(ev.target.result);
        const wb   = XLSX.read(data, { type:'array' });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' });
        const items = [];
        const parsedMeta = { rfq: null, title: null };
        let lastCat = 'Unclassified';
        for (let r = 0; r < rows.length; r++) {
          const row = rows[r].map(c => String(c === null || c === undefined ? '' : c).trim());
          const fullLow = row.join(' ').toLowerCase();
          if (!parsedMeta.rfq) { const m = row.join(' ').match(/RFQ[\s\/\w]+/i); if (m) parsedMeta.rfq = m[0].trim().substring(0, 40); }
          if (!parsedMeta.title && fullLow.includes('project')) parsedMeta.title = row.filter(Boolean).join(' ').substring(0, 80);
          const isNumericItem = /^\d+(\.\d+)*$/.test(row[0]);
          if (!isNumericItem) {
            if (/civil|paving|concrete|excavat|trench|rubble|site.?work/i.test(fullLow)) lastCat = 'Civil & Construction';
            else if (/electr|cable|switchgear|kiosk|mccb|mcb|surge|earthing|coc|commission/i.test(fullLow)) lastCat = 'Electrical & LV Systems';
            else if (/hdpe|sleeve|conduit|duct/i.test(fullLow)) lastCat = 'Electrical & LV Systems';
            else if (/mechan|hvac|pump|ahu|chiller/i.test(fullLow)) lastCat = 'Mechanical & HVAC';
            else if (/plumb|drain|sewer|pipe|valve/i.test(fullLow)) lastCat = 'Plumbing & Drainage';
            else if (/steel|struct|beam|rebar|reinforce/i.test(fullLow)) lastCat = 'Civil & Construction';
            else if (/earthwork|bulk|import|fill|excavat/i.test(fullLow)) lastCat = 'Civil & Construction';
            else if (/fence|palisade|gate|cctv|security/i.test(fullLow)) lastCat = 'Fencing & Security';
            else if (/install|erect|lay|fix|weld|commission/i.test(fullLow)) lastCat = 'Labour & Installation';
            continue;
          }
          const desc = row[1] || row[2] || '';
          if (!desc || desc.length < 4) continue;
          if (/total|summary|carried forward|brought forward|vat|tax|sub.?total/i.test(desc) && !row[3]) continue;
          let no = row[0], dsc = desc, unit = row[2] || '';
          let qty = parseFloat(row[3]) || 0, rate = parseFloat(row[4]) || null, price = parseFloat(row[5]) || null;
          if (!qty) { const nums = row.slice(2).filter(c => c !== '' && !isNaN(parseFloat(c))).map(parseFloat); if (nums.length >= 1) qty = nums[0]; if (nums.length >= 2) rate = nums[1]; }
          if (!rate && price && qty) rate = +(price / qty).toFixed(4);
          if (rate === 0) rate = null;
          let cat = lastCat;
          if (/cable|termination|gland|mccb|mcb|surge|kiosk|switchgear|coc|commission|earth.*conduct/i.test(dsc)) cat = 'Electrical & LV Systems';
          else if (/hdpe|sleeve|conduit|duct|bend.*pipe/i.test(dsc)) cat = 'Electrical & LV Systems';
          else if (/concrete|paving|excavat|trench|rubble|backfill|compact/i.test(dsc)) cat = 'Civil & Construction';
          else if (/pipe|valve|drain|sewer|basin|toilet/i.test(dsc)) cat = 'Plumbing & Drainage';
          else if (/install|erect|lay|fix|weld|connect|terminate|commission/i.test(dsc)) cat = 'Labour & Installation';
          items.push({ no, desc:dsc, unit, qty:qty||1, rate, price:price||null, cat });
          Object.assign(items[items.length-1], detectLabour(dsc));
        }
        if (parsedMeta.rfq) meta.rfq = parsedMeta.rfq;
        if (parsedMeta.title) meta.title = parsedMeta.title;
        res(items);
      } catch(err) { rej(err); }
    };
    reader.onerror = rej;
    reader.readAsArrayBuffer(file);
  });
}

async function startAnalysis() {
  setStage('stage-processing');
  setStatus('Parsing…', 'gold');
  clearLog();
  setProg(3, 'Phase 1 of 4 — Parsing BOQ');
  setProcSub('Reading and extracting line items…');
  addLog('_parse', 'Parsing BOQ…', 'active');

  try {
    if (_intakeMode === 'paste') {
      const text = (document.getElementById('paste-input') || {}).value || '';
      if (!text.trim()) throw new Error('Paste area is empty.');
      // Send to the server pipeline (parseText → full extractor) instead of the
      // limited client-side regex that previously handled paste input.
      addLog('_parse', 'Sending pasted text to server pipeline…', 'active');
      const resp = await fetch(`${FUNCTION_URL}?action=parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: text,
      });
      if (!resp.ok) throw new Error('Server parse failed: HTTP ' + resp.status);
      const result = normaliseParsedItems(await resp.json());
      boqItems = result.items;
      renderReviewTable(boqItems, result.excluded || []);
    } else {
      const file = window._boqFile;
      if (!file) throw new Error('No file selected.');
      meta.title = file.name.replace(/\.[^/.]+$/, "");
      const ext = (file.name || '').split('.').pop().toLowerCase();

      if (['pdf', 'jpg', 'jpeg', 'png'].includes(ext)) {
        // ── Route based on file size ──────────────────────────────────────
        // Large scanned files → Background Function (15 min timeout, progress polling)
        // Small files or text-layer PDFs → existing synchronous function (26 s timeout)
        if (file.size > OCR_BG_THRESHOLD_BYTES) {
          // Background OCR path — progress bar is managed by parseBOQViaBackground
          addLog('_parse', `Large file (${(file.size / 1024).toFixed(0)} KB) — routing to background OCR…`, 'active');
          const result = await parseBOQViaBackground(file);
          hideOCRProgress();
          boqItems = result.items;
          renderReviewTable(boqItems, result.excluded || []);
        } else {
          // Synchronous path for small PDFs / images
          showOCRProgress(0, 1);
          const result = await parseBOQViaServer(file);
          hideOCRProgress();
          boqItems = result.items;
          renderReviewTable(boqItems, result.excluded || []);
        }
      } else if (ext === 'docx') {
        // DOCX: always synchronous (no OCR, fast)
        showOCRProgress(0, 1);
        const result = await parseBOQViaServer(file);
        hideOCRProgress();
        boqItems = result.items;
        renderReviewTable(boqItems, result.excluded || []);
      } else {
        // XLSX / XLS / CSV — client-side SheetJS parser
        boqItems = await parseBOQ(file);
        renderReviewTable(boqItems, []);
      }
    }

    if (!boqItems.length) throw new Error('No line items found. Check that the file has item numbers, descriptions, units, and quantities in standard columns.');
    updateLog('_parse', `✓ ${boqItems.length} line items extracted`, 'done');
    setProg(10, 'Phase 1 of 4 — Parsing complete');
    return;
  } catch (err) {
    hideOCRProgress();
    console.error(err);
    addLog('_err', '✗ Error: ' + err.message, 'err');
    setStatus('Error', '');
    toast('Error: ' + err.message);
    setStage('stage-upload');
  }
}
