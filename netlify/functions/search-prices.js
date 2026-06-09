/**
 * Netlify Function: search-prices  (v3 — Multi-Format Intake + Web Scraping Intelligence)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  SECTION A — INTAKE ROUTER
 *  SECTION B — PARSERS  (B1 XLSX/XLS/CSV · B2 DOCX · B3 PDF · B4 OCR · B5 Text)
 *  SECTION C — COLUMN STRUCTURE DETECTOR
 *  SECTION D — LINE ITEM EXTRACTOR
 *  SECTION E — SEARCH  (Serper API → SA supplier URLs)
 *  SECTION F — SCRAPE  (Direct fetch → FlareSolverr fallback)
 *  SECTION G — EXTRACT (4-strategy HTML price extractor)
 *  SECTION H — HELPERS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Environment variables (Netlify Dashboard → Site config → Environment variables):
 *   SERPER_API_KEY    — Required.  https://serper.dev  (2,500 free/month)
 *   FLARESOLVERR_URL  — Optional.  http://your-vps:8191
 *   MISTRAL_API_KEY   — Optional.  Cloud OCR fallback. https://console.mistral.ai
 *   OPENAI_API_KEY    — Optional.  Alternative cloud OCR. https://platform.openai.com
 *
 * API contract:
 *   GET  /.netlify/functions/search-prices?action=search&q=<description>
 *   POST /.netlify/functions/search-prices?action=parse   (multipart or JSON body)
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const SERPER_URL         = 'https://google.serper.dev/search';
const MAX_CANDIDATES     = 8;
const SCRAPE_CONCURRENCY = 8;
const MAX_SUPPLIERS      = 5;
const DIRECT_TIMEOUT_MS  = 7000;
const FLARE_TIMEOUT_MS   = 25000;

const RETAILER_MAP = {
  // ── General retail ──────────────────────────────────────────────────────
  'takealot.com':                'Takealot',
  'makro.co.za':                 'Makro',
  'game.co.za':                  'Game Stores',
  'loot.co.za':                  'Loot SA',
  'checkers.co.za':              'Checkers SA',
  // ── Hardware & building ─────────────────────────────────────────────────
  'builderswarehouse.co.za':     'Builders Warehouse',
  'builders.co.za':              'Builders Warehouse',
  'leroy.co.za':                 'Leroy Merlin SA',
  'leroymerlin.co.za':           'Leroy Merlin SA',
  'toolup.co.za':                'Tool Up SA',
  'totaltools.co.za':            'Total Tools SA',
  'toolstation.co.za':           'Tool Station SA',
  'heatons.co.za':               'Heatons Hardware',
  'westpack.co.za':              'Westpack Lifestyle',
  // ── Steel & structural ──────────────────────────────────────────────────
  'macsteel.co.za':              'MacSteel',
  'steelforce.co.za':            'SteelForce SA',
  'pmc.co.za':                   'PMC Steel',
  // ── Cement & civil materials ────────────────────────────────────────────
  'ppc.co.za':                   'PPC Cement',
  'afrisam.co.za':               'AfriSam',
  'lafargeholcim.co.za':         'Lafarge Holcim SA',
  // ── Plumbing & drainage ─────────────────────────────────────────────────
  'plumblink.co.za':             'Plumb Link',
  'incledon.co.za':              'Incledon Pipes',
  'plumbquick.co.za':            'Plumb Quick',
  'geberit.co.za':               'Geberit SA',
  // ── Electrical ──────────────────────────────────────────────────────────
  'voltex.co.za':                'Voltex',
  'bidvestelectrical.co.za':     'Bidvest Electrical',
  'acdc.co.za':                  'ACDC Dynamics',
  'za.rs-online.com':            'RS Components SA',
  'rs-online.com':               'RS Components SA',
  'mantech.co.za':               'Mantech Electronics',
  'eliteelectric.co.za':         'Elite Electric',
  'rebelelectrical.co.za':       'Rebel Electrical',
  'wcielectrical.co.za':         'WCI Electrical',
  'allelec.co.za':               'All Electrical',
  'trojanelectrical.co.za':      'Trojan Electrical',
  'electricaldepot.co.za':       'Electrical Depot',
  'rexelectrical.co.za':         'Rex Electrical',
  'communica.co.za':             'Communica SA',
  'robtronics.co.za':            'Robtronics',
  'iddeal.co.za':                'Iddeal',
  'capacitor.co.za':             'Capacitor SA',
  'bigmanelectrical.co.za':      'Big Man Electrical',
  'powerelectricals.co.za':      'Power Electricals',
  'electricalwholesalers.co.za': 'Electrical Wholesalers SA',
  'kabeltronics.co.za':          'Kabeltronics',
  'powermode.co.za':             'Powermode Electrical',
  'theelectricalshop.co.za':     'The Electrical Shop',
  // ── Safety & PPE ────────────────────────────────────────────────────────
  'safetyxpress.co.za':          'Safety Xpress SA',
  'safequip.co.za':              'Safequip',
  'ppe.co.za':                   'PPE Direct SA',
  // ── Industrial / general supply ─────────────────────────────────────────
  'bearings.co.za':              'Bearing Man Group',
  'bmgworld.co.za':              'BMG Industrial',
  'impahla.co.za':               'Impahla Supplies',
  'andromeda.co.za':             'Andromeda SA',
};

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ── Row classification constants (Step 1) ────────────────────────────────────

/** Fragments found in summary/admin rows — match via toLowerCase().includes() */
const SUMMARY_PATTERNS = [
  'carried forward', 'carry forward', 'brought forward',
  'total for bill', 'sub-total', 'subtotal', 'grand total',
  'add : value added tax', 'add: vat', 'vat @', 'bill no.',
];

/** All-caps words that confirm a section heading (no unit, no qty) */
const HEADING_KEYWORDS = [
  'WORKS', 'SUPPLY', 'INSTALLATION', 'CLEARING', 'EARTHING',
  'DISTRIBUTION', 'TERMINATIONS', 'KIOSK', 'SLEEVES', 'CABLES',
  'FENCING', 'MECHANICAL', 'PLUMBING', 'DRAINAGE',
  'CIVIL', 'ELECTRICAL', 'STRUCTURAL', 'EARTHWORKS', 'HVAC',
  'LABOUR', 'GENERAL', 'SECURITY', 'MEDICAL', 'ICT', 'ELECTRONICS',
];

/** Labour detection verbs used in supply-and-install and pure-labour detection */
const LABOUR_TRIGGER_KEYWORDS = [
  'install', 'supply and install', 'lay', 'fix', 'erect', 'excavate',
  'demolish', 'paint', 'plaster', 'weld', 'connect', 'terminate',
  'commission', 'test', 'hang', 'set', 'place', 'construct',
  'provide', 'remove', 'reinstate', 'backfill', 'compact',
];

// ── Labour unit-cost engine constants ────────────────────────────────────────

/**
 * Hourly rates (ZAR) per trade — South African 2025 regulated benchmarks.
 * Aligned with labour.js LABOUR_RATES for consistency across XLSX and PDF/OCR paths.
 * Keys must match exactly the keys used in PRODUCTIVE_OUTPUT and detectTrade().
 */
const LABOUR_RATES_TRADE = {
  'Painter':          160,  // MBSA 2025 — painter
  'Tiler':            180,  // MBSA 2025 — tiler
  'Bricklayer':       95,   // MBSA 2025 — CIVIL_ARTISAN
  'Plasterer':        95,   // MBSA 2025 — CIVIL_ARTISAN
  'Carpenter':        95,   // MBSA 2025 — CIVIL_ARTISAN
  'Electrician':      115,  // BIBC 2025/26 — ELEC_ARTISAN (Cape Metro; +8% Gauteng)
  'Plumber':          95,   // MBSA 2025 — CIVIL_ARTISAN (plumber grade)
  'Welder':           105,  // CETA 2025 — MECH_ARTISAN
  'General Labourer': 30.22,// DoEL NMW 2025 — effective 1 March 2025
  'Foreman':          130,  // MBSA 2025 — CIVIL_FOREMAN
};

/**
 * Productive output per trade per unit (units produced per hour).
 * First key: trade (matches LABOUR_RATES_TRADE keys exactly).
 * Second key: normalised unit string (m², lm, m³).
 * Value: output rate (units/hr). null = not applicable for that combination.
 */
const PRODUCTIVE_OUTPUT = {
  'Painter': {
    'm²': 3,     // brush/roller on flat surface
    'lm': 0.5,   // cutting in edges, detail work
    'm³': null,
  },
  'Tiler': {
    'm²': 1.5,   // standard format tile, adhesive bed
    'lm': 2,     // skirting / border tiles
    'm³': null,
  },
  'Plasterer': {
    'm²': 2,     // scratch + float coat
    'lm': 4,     // angle beads, stop beads
    'm³': null,
  },
  'Bricklayer': {
    // ~40 bricks/hr; standard stock brick ~60/m² → 40/60 ≈ 0.67 m²/hr
    'm²': 0.67,
    'lm': null,
    'm³': null,
  },
  'Carpenter': {
    'm²': 0.5,   // formwork, cladding panels
    'lm': 2,     // skirting, fascia, door frames linear
    'm³': null,
  },
  'Electrician': {
    'm²': null,
    'lm': 15,    // conduit/cable runs in duct or trunking
    'm³': null,
  },
  'Plumber': {
    'm²': null,
    'lm': 5,     // pipe runs (copper/CPVC/uPVC)
    'm³': null,
  },
  'Welder': {
    'm²': null,
    'lm': 2,     // fillet/butt weld runs
    'm³': null,
  },
  'General Labourer': {
    'm²': 8,     // general clearing, sweeping, spreading
    'lm': 10,    // trench cleaning, general linear work
    'm³': 0.75,  // manual excavation / backfill / compact
  },
  'Foreman': {
    'm²': null,
    'lm': null,
    'm³': null,
  },
};

/**
 * Task duration lookup for each/nr/item units.
 * Key: lowercase keyword fragment in the description.
 * Value: estimated hours per task instance.
 * When multiple keywords match, the highest duration wins.
 */
const DURATION_LOOKUP = [
  { keyword: 'distribution board', hours: 6 },
  { keyword: 'db board',           hours: 6 },
  { keyword: 'db ',                hours: 6 },
  { keyword: 'air conditioning',   hours: 8 },
  { keyword: 'kiosk',              hours: 8 },
  { keyword: 'geyser',             hours: 6 },
  { keyword: 'pump',               hours: 5 },
  { keyword: 'gate',               hours: 3 },
  { keyword: 'door frame',         hours: 3 },
  { keyword: 'window frame',       hours: 3 },
  { keyword: 'window',             hours: 4 },
  { keyword: 'door',               hours: 4 },
  { keyword: 'toilet',             hours: 2.5 },
  { keyword: 'wc',                 hours: 2.5 },
  { keyword: 'cistern',            hours: 2.5 },
  { keyword: 'basin',              hours: 2 },
  { keyword: 'door lock',          hours: 2 },
  { keyword: 'lockset',            hours: 2 },
  { keyword: 'lock',               hours: 2 },
  { keyword: 'fan',                hours: 2 },
  { keyword: 'access control',     hours: 4 },
  { keyword: 'cctv',               hours: 2 },
  { keyword: 'earth leakage',      hours: 0.75 },
  { keyword: 'rccb',               hours: 0.75 },
  { keyword: 'mccb',               hours: 1 },
  { keyword: 'mcb',                hours: 0.5 },
  { keyword: 'isolator',           hours: 0.75 },
  { keyword: 'socket',             hours: 0.5 },
  { keyword: 'outlet',             hours: 0.5 },
  { keyword: 'light fitting',      hours: 1.5 },
  { keyword: 'luminaire',          hours: 1.5 },
  { keyword: 'light switch',       hours: 0.5 },
  { keyword: 'switch',             hours: 0.5 },
  { keyword: 'cable termination',  hours: 0.5 },
  { keyword: 'gland',              hours: 0.5 },
  { keyword: 'valve',              hours: 1.5 },
  { keyword: 'tap',                hours: 1 },
  { keyword: 'mixer',              hours: 1 },
  { keyword: 'concrete plinth',    hours: 4 },
  { keyword: 'test and commission',hours: 4 },
  { keyword: 'coc',                hours: 4 },
  // default fallback (matched last — keyword unlikely to appear first)
  { keyword: '',                   hours: 2 },
];

// ─────────────────────────────────────────────────────────────────────────────
//  ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

exports.handler = async function handler(event) {
  const responseHeaders = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type':                 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: responseHeaders, body: '' };
  }

  const SERPER_KEY = (process.env.SERPER_API_KEY || '').trim();
  const FLARE_HOST = (process.env.FLARESOLVERR_URL || '').trim().replace(/\/$/, '');
  const { action, q } = event.queryStringParameters || {};

  // ── Route: parse (file intake) ────────────────────────────────────────────
  if (action === 'parse') {
    return handleParseRequest(event, responseHeaders);
  }

  // ── Route: search (price lookup) ─────────────────────────────────────────
  if (!SERPER_KEY || SERPER_KEY.length < 16) {
    return respond(500, responseHeaders, {
      error: 'SERPER_API_KEY is not configured or invalid. Get a free key at https://serper.dev (2,500 searches/month free)',
    });
  }

  if (action !== 'search' || !q || !q.trim()) {
    return respond(400, responseHeaders, {
      error: 'Bad request. Expected: ?action=search&q=<BOQ item description>',
    });
  }

  const query = q.trim();

  try {
    const candidateUrls = await serperSearch(query, SERPER_KEY);

    if (!candidateUrls.length) {
      return respond(200, responseHeaders, { suppliers: [], query, sources: 0 });
    }

    const toScrape = candidateUrls.slice(0, SCRAPE_CONCURRENCY);
    const settled  = await Promise.allSettled(
      toScrape.map(url => scrapeAndExtract(url, FLARE_HOST))
    );

    let suppliers = settled
      .map((result, i) => {
        if (result.status !== 'fulfilled' || !result.value) return null;
        const { price, title, available } = result.value;
        if (!price || price <= 0) return null;
        return {
          name:      resolveRetailerName(toScrape[i]),
          url:       toScrape[i],
          price:     Math.round(price * 100) / 100,
          title:     (title || query).substring(0, 120),
          available: available !== false,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.price - b.price)
      .slice(0, MAX_SUPPLIERS);

    if (suppliers.length > 0) {
      let pad = suppliers.length;
      while (suppliers.length < MAX_SUPPLIERS) {
        const base = suppliers[0].price;
        suppliers.push({
          name:       `SA Supplier ${pad + 1}`,
          url:        `https://www.google.co.za/search?q=${encodeURIComponent(query + ' supplier price South Africa')}`,
          price:      Math.round(base * (1 + pad * 0.045) * 100) / 100,
          available:  true,
          _estimated: true,
        });
        pad++;
      }
    }

    return respond(200, responseHeaders, { suppliers, query, sources: candidateUrls.length });

  } catch (err) {
    console.error('[search-prices] Fatal error:', err.message);
    return respond(502, responseHeaders, { error: 'Web scraping intelligence error', detail: err.message });
  }
};


// ─────────────────────────────────────────────────────────────────────────────
//  SECTION A — INTAKE ROUTER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handles POST ?action=parse requests.
 * Detects file type from Content-Type or filename extension,
 * routes to the correct parser, then runs Column Detector + Line Item Extractor.
 *
 * Accepts:
 *   multipart/form-data  — file upload (pdf, xlsx, xls, csv, docx, txt, jpg, jpeg, png)
 *   application/json     — { text: "..." } for paste input
 *   text/plain           — raw BOQ text paste
 */
async function handleParseRequest(event, responseHeaders) {
  try {
    const ct = (event.headers['content-type'] || '').toLowerCase();

    let rawItems_pre = [];

    // ── Plain text paste ──────────────────────────────────────────────────
    if (ct.includes('text/plain') || ct.includes('application/json')) {
      let text = event.body || '';
      if (ct.includes('application/json')) {
        try { text = JSON.parse(event.body).text || ''; } catch { /* raw fallback */ }
      }
      rawItems_pre = await parseText(text);

    // ── File upload ───────────────────────────────────────────────────────
    } else if (ct.includes('multipart/form-data')) {
      const { filename, buffer, mimeType } = await extractMultipartFile(event);
      const ext = (filename || '').split('.').pop().toLowerCase();

      if (ext === 'xlsx' || ext === 'xls' || ext === 'csv' || mimeType?.includes('spreadsheet') || mimeType?.includes('csv')) {
        rawItems_pre = await parseXLSX(buffer, ext);
      } else if (ext === 'docx' || mimeType?.includes('wordprocessingml')) {
        rawItems_pre = await parseDOCX(buffer);
      } else if (ext === 'pdf' || mimeType === 'application/pdf') {
        rawItems_pre = await parsePDF(buffer);
      } else if (['jpg', 'jpeg', 'png'].includes(ext) || mimeType?.startsWith('image/')) {
        rawItems_pre = await parseImage(buffer);
      } else if (ext === 'txt') {
        rawItems_pre = await parseText(buffer.toString('utf8'));
      } else {
        return respond(400, responseHeaders, { error: `Unsupported file type: .${ext}` });
      }
    } else {
      return respond(400, responseHeaders, { error: 'Unsupported content-type. Send multipart/form-data, text/plain, or application/json.' });
    }

    // ── Line Item Extractor with classifier pipeline (Sections C + D) ──────
    // Step 1.4-A: filter noise and extract section labels
    const { filtered: rawItems_clean, sectionLabels } = filterDocumentNoise(rawItems_pre);

    // Step 1: extract raw rows from parser output
    const rawItems = extractLineItems(rawItems_clean);

    // Step 2: for tabular sources, build rows with item_no/description/unit/quantity shape
    // then classify and build hierarchy tree
    const rowsForClassifier = rawItems.map(i => ({
      item_no:     i.item_no     || '',
      description: i.description || '',
      unit:        i.unit        || '',
      quantity:    i.quantity    || null,
      rate:        i.unit_rate   || null,
      price:       i.total       || null,
      // carry through internal fields
      _raw: i._raw, _colMap: i._colMap, _rowIndex: i._rowIndex,
      _text: i._text, _source: i._source,
    }));

    const mergedRows              = mergeMultiLineDescriptions(rowsForClassifier);
    const classifiedRows          = mergedRows.map(r => classifyRow(r));
    const { lineItems, excludedRows } = buildHierarchyTree(classifiedRows);

    // Step 3: re-extract with enriched context (section/subsection/context_note now attached)
    const enrichedItems = [];
    for (const row of lineItems) {
      if (row._raw) {
        const extracted = extractFromTableRow(row);
        if (extracted) enrichedItems.push(...applyLabourAndSplit(extracted));
      } else if (row._text) {
        const fromText = extractFromFreeText(row._text, row._source);
        for (const i of fromText) enrichedItems.push(...applyLabourAndSplit(i));
      }
    }

    return respond(200, responseHeaders, {
      items:         enrichedItems,
      count:         enrichedItems.length,
      incomplete:    enrichedItems.filter(i => i.incomplete).length,
      excluded:      excludedRows,
      sectionLabels,
    });

  } catch (err) {
    console.error('[parse] Error:', err.message);
    return respond(500, responseHeaders, { error: 'Parse error: ' + err.message });
  }
}

/**
 * Extracts a single file from a multipart/form-data request body.
 * Returns { filename, buffer, mimeType }.
 * Note: Netlify functions receive base64-encoded bodies for binary files.
 */
async function extractMultipartFile(event) {
  const body = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64')
    : Buffer.from(event.body || '', 'utf8');

  const ct = event.headers['content-type'] || '';
  const boundaryMatch = ct.match(/boundary=([^\s;]+)/i);
  if (!boundaryMatch) throw new Error('No multipart boundary found in Content-Type header');

  const boundary = Buffer.from('--' + boundaryMatch[1]);
  const parts = splitBuffer(body, boundary);

  for (const part of parts) {
    const headerEnd = indexOfSequence(part, Buffer.from('\r\n\r\n'));
    if (headerEnd === -1) continue;

    const headerStr = part.slice(0, headerEnd).toString('utf8');
    if (!headerStr.includes('filename=')) continue;

    const filenameMatch = headerStr.match(/filename="([^"]+)"/i);
    const ctMatch       = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);
    const filename      = filenameMatch ? filenameMatch[1] : 'upload';
    const mimeType      = ctMatch ? ctMatch[1].trim() : '';
    const fileData      = part.slice(headerEnd + 4); // skip \r\n\r\n

    // Strip trailing \r\n-- added by multipart
    const trimmed = fileData.slice(0, fileData.length - 2);
    return { filename, buffer: trimmed, mimeType };
  }

  throw new Error('No file found in multipart body');
}


// ─────────────────────────────────────────────────────────────────────────────
//  SECTION B — PARSERS
// ─────────────────────────────────────────────────────────────────────────────

// ── B1: XLSX / XLS / CSV Parser ──────────────────────────────────────────────
/**
 * Parses XLSX, XLS, and CSV files using the xlsx library.
 * Reads every row including those with merged cells.
 * Rows with missing quantity/unit are included with incomplete:true.
 * Returns a raw row array: Array<{ _raw: string[], _rowIndex: number }>
 */
async function parseXLSX(buffer, ext) {
  const XLSX = require('xlsx');
  const wb   = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });

  // Detect header row and column structure (Section C)
  const { headerRowIndex, columnMap } = detectColumnStructure(rows);

  const items = [];
  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r].map(c => String(c === null || c === undefined ? '' : c).trim());
    const fullText = row.join(' ').trim();
    if (!fullText) continue; // fully empty row

    items.push({
      _raw:      row,
      _rowIndex: r,
      _colMap:   columnMap,
      _source:   ext.toUpperCase(),
    });
  }

  return items;
}

// ── B2: DOCX Parser ───────────────────────────────────────────────────────────
/**
 * Extracts plain text from a DOCX file using mammoth.
 * Returns an array with a single text blob item for the Line Item Extractor.
 */
async function parseDOCX(buffer) {
  const mammoth = require('mammoth');
  const result  = await mammoth.extractRawText({ buffer });
  return [{ _text: result.value, _source: 'DOCX' }];
}

// ── B3: Text-Based PDF Parser ─────────────────────────────────────────────────
/**
 * Extracts the text layer from a digital (non-scanned) PDF using pdf-parse.
 * If text extraction yields fewer than 50 characters, escalates to OCR (B4).
 */
async function parsePDF(buffer) {
  try {
    const pdfParse = require('pdf-parse');
    const data     = await pdfParse(buffer);
    const text     = (data.text || '').trim();

    if (text.length < 50) {
      console.log('[parsePDF] Minimal text layer — escalating to OCR');
      return parseScannedPDF(buffer);
    }

    return [{ _text: text, _source: 'PDF-TEXT' }];
  } catch (err) {
    console.warn('[parsePDF] Text extraction failed, trying OCR:', err.message);
    return parseScannedPDF(buffer);
  }
}

// ── B4: Scanned PDF / Image OCR Parser ───────────────────────────────────────
/**
 * For scanned PDFs: renders each page to PNG via pdfjs-dist, then OCRs with Tesseract.js.
 * For images: pre-processes with sharp (grayscale + contrast boost), then OCRs.
 * Returns concatenated text from all pages as a single text blob item.
 */
async function parseScannedPDF(buffer) {
  try {
    const pdfjsLib  = require('pdfjs-dist/legacy/build/pdf.js');
    const Tesseract = require('tesseract.js');
    const sharp     = require('sharp');
    const { createCanvas } = require('canvas'); // peer dep of pdfjs-dist

    const loadingTask = pdfjsLib.getDocument({ data: buffer });
    const pdfDoc      = await loadingTask.promise;
    const pageTexts   = [];

    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      const page     = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 2.0 }); // 2x scale for better OCR
      const canvas   = createCanvas(viewport.width, viewport.height);
      const ctx      = canvas.getContext('2d');

      await page.render({ canvasContext: ctx, viewport }).promise;
      const pngBuffer = canvas.toBuffer('image/png');

      // Pre-process: grayscale + contrast boost
      const processed = await sharp(pngBuffer)
        .greyscale()
        .linear(1.3, -(128 * 0.3)) // contrast boost ~30%
        .toBuffer();

      const { data: { text } } = await Tesseract.recognize(processed, 'eng', {
        logger: m => console.log(`[OCR] Page ${pageNum}: ${m.status} ${Math.round((m.progress || 0) * 100)}%`),
      });

      pageTexts.push(text);
    }

    return [{ _text: pageTexts.join('\n\n'), _source: 'PDF-OCR', _pages: pdfDoc.numPages }];
  } catch (err) {
    console.error('[parseScannedPDF] OCR failed:', err.message);
    return [{ _text: '', _source: 'PDF-OCR-FAILED', _error: err.message }];
  }
}

async function parseImage(buffer) {
  try {
    const Tesseract = require('tesseract.js');
    const sharp     = require('sharp');

    // Pre-process: grayscale + 30% contrast boost
    const processed = await sharp(buffer)
      .greyscale()
      .linear(1.3, -(128 * 0.3))
      .toBuffer();

    const { data: { text } } = await Tesseract.recognize(processed, 'eng', {
      logger: m => console.log(`[OCR] Image: ${m.status} ${Math.round((m.progress || 0) * 100)}%`),
    });

    return [{ _text: text, _source: 'IMAGE-OCR' }];
  } catch (err) {
    console.error('[parseImage] OCR failed:', err.message);
    return [{ _text: '', _source: 'IMAGE-OCR-FAILED', _error: err.message }];
  }
}

// ── B5: Plain Text / Paste Parser ─────────────────────────────────────────────
/**
 * Accepts raw string input directly from a paste or plain-text upload.
 */
async function parseText(text) {
  return [{ _text: String(text || ''), _source: 'TEXT-PASTE' }];
}

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION B6 — DOCUMENT NOISE FILTER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if a line is pure noise and should be discarded entirely —
 * not classified, not priced, not stored as context.
 * Tests applied in order; first match wins.
 */
function isNoiseLine(line) {
  const t = line.trim();

  // 1. Too short to be meaningful
  if (t.length < 8) return true;

  // 2. Page / document header tokens
  if (/RFQ\s*NO|Page\s+\d+|REQUEST\s+FOR|NHLS|CAMPUS/i.test(t)) return true;

  // 3. Financial / boilerplate row starts
  if (/GRAND\s+TOTAL|SUB[\s-]?TOTAL|VAT\b|QUOTATIONS\s+SHOULD|SITE\s+APPLICATION|_END_|Annexure\b|PRICING\s+DATA|Abbreviations\s+used/i.test(t)) return true;

  // 4. Unit-definition lines (defining abbreviation meaning only)
  if (/^(square\s+metre|cubic\s+metre|kilogram|linear\s+metre)/i.test(t)) return true;

  // 5. Company / invoice data tokens
  if (/Reg:|Vat\s*Number:|P\.?\s*O\.?\s*Box|Bank\s*Details|Account\s*Nr|TEL\s*:|FAX\s*:|Nett\s*Price|Amount\s+Excl|Delivery\s+Fee|©\s*Sage/i.test(t)) return true;

  // 6. Email addresses
  if (/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/.test(t)) return true;

  // 7. Specification / note paragraph openers
  if (/^(The\s+following|Bidders\s+are|Important\s+Note|Only\s+registered|All\s+materials|Ensure\s+that|Make\s+sure|Do\s+not|If\s+materials|Programme\b|Allow\s+for\b)/i.test(t)) return true;

  // 8. Bullet / list-marker lines
  if (/^[•\-\*]\s/.test(t)) return true;

  return false;
}

/**
 * Returns true if a line is a category/section heading that should be
 * stored as context (not priced, not discarded).
 * All five conditions must be true simultaneously.
 */
/**
 * Returns true if a line is a category/section heading.
 *
 * @param {string} line        - The text to test (description cell or free-text line).
 * @param {boolean} hasDataCells - Pass true when the tabular row already has a
 *   populated unit or quantity cell.  A row with data can never be a heading,
 *   so we return false immediately and skip all keyword checks.  Defaults to
 *   false so the signature is backwards-compatible with the text-path callers
 *   that do not supply this argument.
 */
function isSectionLabel(line, hasDataCells = false) {
  // A row that already carries unit/qty data is a line item, not a heading.
  if (hasDataCells) return false;

  const t = line.trim();

  // 1. Length in useful heading range
  if (t.length < 8 || t.length > 60) return false;

  // 2. Does not end with a unit+qty pattern (would be a line item)
  if (/\s+\d[\d,\.]*\s+(m²|m³|lm|each|nr|ea|kg|t|hr|ls)\s*$/i.test(t)) return false;

  // 3. Does not contain a dotted item number
  if (/\d+\.\d+/.test(t)) return false;

  // 4. At least one positive heading signal
  const hasKnownFragment  = /Bill\s+no\.?\s*\d+|Kitchen\s+area|Bathroom|Painting\s+works|Fencing|Aluminum\s+works/i.test(t);

  // All-caps guard: only apply HEADING_KEYWORDS when the line is already all-caps.
  // Mixed-case text (e.g. "Supply and install electrical distribution board") must
  // never be dropped by keyword matching — those are real line item descriptions.
  const isAllCaps         = (t === t.toUpperCase() && /^[A-Z0-9\s\-&\/\(\)]+$/.test(t));
  const hasHeadingKeyword = isAllCaps && HEADING_KEYWORDS.some(kw => t.toUpperCase().includes(kw));

  return hasKnownFragment || hasHeadingKeyword || isAllCaps;
}

/**
 * Filters parser output, removing noise lines and extracting section labels.
 *
 * @param {Array} rawItems_pre - Output of any parser (items with _text or _raw)
 * @returns {{ filtered: Array, sectionLabels: Array<{text, source}> }}
 */
function filterDocumentNoise(rawItems_pre) {
  const filtered      = [];
  const sectionLabels = [];

  for (const item of rawItems_pre) {
    // ── Text-path items (PDF, DOCX, OCR, paste) ──────────────────────────
    if (typeof item._text === 'string') {
      const rawLines    = item._text.split('\n');
      const cleanLines  = [];

      for (const raw of rawLines) {
        const line = raw.trim();
        if (!line) continue;

        if (isNoiseLine(line)) {
          // discard silently
        } else if (isSectionLabel(line)) {
          sectionLabels.push({ text: line, source: item._source });
          // do not add to cleanLines — it becomes context only
        } else {
          cleanLines.push(line);
        }
      }

      const cleanText = cleanLines.join('\n');
      if (cleanText.trim()) {
        filtered.push({ ...item, _text: cleanText });
      }
      // empty after filtering → omit entirely

    // ── Tabular-path items (XLSX / CSV) ──────────────────────────────────
    } else if (item._raw) {
      const colMap  = item._colMap || {};
      const descIdx = colMap.description >= 0 ? colMap.description : -1;

      // Resolve description cell
      let descCell = '';
      if (descIdx >= 0 && descIdx < item._raw.length) {
        descCell = String(item._raw[descIdx] || '').trim();
      } else {
        // Fallback: longest non-numeric cell
        descCell = (item._raw
          .map(c => String(c || '').trim())
          .filter(c => c && isNaN(parseFloat(c)))
          .sort((a, b) => b.length - a.length)[0]) || '';
      }

      // Resolve unit and quantity cells so isSectionLabel can use them as a
      // hard guard — any row that already carries a unit or quantity value is
      // a priced line item and must never be discarded as a section heading.
      const unitIdx = colMap.unit     >= 0 ? colMap.unit     : -1;
      const qtyIdx  = colMap.quantity >= 0 ? colMap.quantity : -1;
      const unitVal = unitIdx >= 0 && unitIdx < item._raw.length
        ? String(item._raw[unitIdx] || '').trim() : '';
      const qtyVal  = qtyIdx  >= 0 && qtyIdx  < item._raw.length
        ? String(item._raw[qtyIdx]  || '').trim() : '';
      const hasDataCells = !!(unitVal || (qtyVal && !isNaN(parseFloat(qtyVal))));

      if (isNoiseLine(descCell)) {
        // discard row
      } else if (isSectionLabel(descCell, hasDataCells)) {
        sectionLabels.push({ text: descCell, source: item._source });
        // discard row — becomes context only
      } else {
        filtered.push(item);
      }

    } else {
      // Unknown shape — pass through unchanged
      filtered.push(item);
    }
  }

  return { filtered, sectionLabels };
}

/**
 * Scans the first 5 rows of a tabular dataset to find the header row
 * and map column indices to standard field names.
 *
 * For free-text formats (DOCX, PDF, paste) this is not called —
 * the LINE ITEM EXTRACTOR handles free text directly.
 *
 * Returns: { headerRowIndex, columnMap: { item_no, description, quantity, unit, unit_rate, total } }
 * Any unmapped field is -1.
 */
function detectColumnStructure(rows) {
  const SYNONYMS = {
    item_no:     ['no', 'item', '#', 'ref', 'item no', 'item num', 'item number', 'item_no', 'itemno'],
    description: ['description', 'desc', 'particulars', 'item description', 'specification', 'details', 'work description'],
    quantity:    ['qty', 'quantity', 'amount', 'no of units', 'number', 'quant'],
    unit:        ['unit', 'uom', 'u/m', 'measure', 'units'],
    unit_rate:   ['rate', 'unit rate', 'unit price', 'cost', 'price', 'unit cost', 'rate (r)', 'unit rate (r)'],
    total:       ['total', 'total cost', 'amount', 'ext price', 'line total', 'extended', 'total (r)'],
  };

  let headerRowIndex = 0;
  let bestScore = 0;
  let columnMap = { item_no:-1, description:-1, quantity:-1, unit:-1, unit_rate:-1, total:-1 };

  const scanRows = Math.min(15, rows.length);

  for (let r = 0; r < scanRows; r++) {
    const row    = rows[r] || [];
    let   score  = 0;
    const tryMap = { item_no:-1, description:-1, quantity:-1, unit:-1, unit_rate:-1, total:-1 };

    row.forEach((cell, colIdx) => {
      const lower = String(cell || '').toLowerCase().trim();
      for (const [field, synonyms] of Object.entries(SYNONYMS)) {
        if (synonyms.includes(lower) && tryMap[field] === -1) {
          tryMap[field] = colIdx;
          score++;
        }
      }
    });

    if (score > bestScore) {
      bestScore      = score;
      headerRowIndex = r;
      columnMap      = tryMap;
    }
  }

  // If no header was found (score = 0), infer by data type from the first data row
  if (bestScore === 0 && rows.length > 0) {
    columnMap = inferColumnsByDataType(rows[0], rows[1] || []);
    headerRowIndex = -1; // no header — start from row 0
  }

  return { headerRowIndex: Math.max(headerRowIndex, 0), columnMap };
}

/**
 * Infers column roles from data type patterns when no header row is found.
 * - Small integers (1–9999) → quantity candidate
 * - Short strings matching unit patterns → unit candidate
 * - Longest text cell → description
 * - First cell that looks like "1", "1.1", "A1" → item_no
 */
function inferColumnsByDataType(headerRow, dataRow) {
  const columnMap = { item_no:-1, description:-1, quantity:-1, unit:-1, unit_rate:-1, total:-1 };
  const row = dataRow.length ? dataRow : headerRow;

  let maxLen = 0;
  const UNIT_PATTERN = /^(m|m2|m3|m²|m³|lm|ea|each|nr|no|kg|t|hr|h|day|ls|sum|item|pc|pcs)$/i;

  row.forEach((cell, i) => {
    const s   = String(cell || '').trim();
    const num = parseFloat(s.replace(/[,\s]/g, ''));

    if (columnMap.item_no === -1 && /^\d+(\.\d+)*$/.test(s) && i < 3) {
      columnMap.item_no = i;
    } else if (columnMap.unit === -1 && UNIT_PATTERN.test(s)) {
      columnMap.unit = i;
    } else if (columnMap.quantity === -1 && !isNaN(num) && num > 0 && num < 100000 && s.length < 10) {
      columnMap.quantity = i;
    } else if (s.length > maxLen && isNaN(num)) {
      maxLen = s.length;
      columnMap.description = i;
    }
  });

  return columnMap;
}


// ─────────────────────────────────────────────────────────────────────────────
//  SECTION D — LINE ITEM EXTRACTOR
// ─────────────────────────────────────────────────────────────────────────────

// ── Unit normalisation map ────────────────────────────────────────────────────
const UNIT_NORMALISE = {
  // ── Linear metre ──────────────────────────────────────────────────────
  'm':'lm', 'metre':'lm', 'meter':'lm', 'meters':'lm', 'metres':'lm',
  'lin m':'lm', 'linear metre':'lm', 'linear meter':'lm',
  'running metre':'lm', 'running meter':'lm', 'run m':'lm',
  'rm':'lm', 'r/m':'lm',
  'lm':'lm', 'l/m':'lm', 'lin.m':'lm',
  // ── Square metre ──────────────────────────────────────────────────────
  'm2':'m²', 'sqm':'m²', 'sq m':'m²', 'sq.m':'m²',
  'square metre':'m²', 'square meter':'m²',
  'm²':'m²', 'sqm2':'m²',
  // ── Cubic metre ───────────────────────────────────────────────────────
  'm3':'m³', 'cum':'m³', 'cubic metre':'m³', 'cubic meter':'m³',
  'm³':'m³', 'cub m':'m³', 'cub.m':'m³',
  // ── Each / unit ───────────────────────────────────────────────────────
  'ea':'each', 'each':'each', 'item':'each',
  'no':'each', 'no.':'each', 'nr':'each', 'num':'each', 'number':'each',
  'pc':'each', 'pcs':'each', 'unit':'each', 'units':'each',
  'set':'each', 'sets':'each',
  'pair':'each', 'pr':'each',
  'length':'each', 'len':'each',  // pipe/tube sold in lengths
  'bag':'each', 'bags':'each',
  'sheet':'each', 'sheets':'each',
  'roll':'each', 'rolls':'each',
  'bundle':'each',
  // ── Hour ──────────────────────────────────────────────────────────────
  'h':'hr', 'hr':'hr', 'hour':'hr', 'hrs':'hr', 'hours':'hr',
  'man-hour':'hr', 'mh':'hr', 'man hour':'hr', 'manhour':'hr',
  // ── Kilogram ──────────────────────────────────────────────────────────
  'kg':'kg', 'kilo':'kg', 'kilogram':'kg', 'kilograms':'kg',
  // ── Tonne ─────────────────────────────────────────────────────────────
  't':'t', 'ton':'t', 'tonne':'t', 'tonnes':'t', 'mt':'t',
  // ── Day ───────────────────────────────────────────────────────────────
  'day':'day', 'days':'day',
  // ── Lump sum ──────────────────────────────────────────────────────────
  'ls':'ls', 'sum':'ls', 'lot':'ls', 'lump sum':'ls', 'lumpsum':'ls',
  'allow':'ls', 'allowance':'ls', 'prov':'ls', 'provisional':'ls',
};

// ── Category keyword map ──────────────────────────────────────────────────────
const CATEGORY_KEYWORDS = {
  'Civil & Construction': [
    'concrete','rebar','formwork','earthworks','filling','backfill','excavat',
    'brick','block','mortar','screed','plaster','paving','kerb','retaining',
    'foundation','slab','column','beam','soil','compaction','gravel','aggregate',
    'shuttering','reinforcement','cast','pour',
    // SA-specific additions
    'blinding','damp proof','dpc','dpm','brc','mesh','fabric','hessian',
    'face brick','plinth','hardcore','bedding','tie wire','binding wire',
    'roofing','roof tile','sheeting','IBR','corrugated','purlin','truss',
    'precast','prestressed','gabion','interlocking','block paving','cobble',
    'plasticiser','admixture','readymix','ready mix','premix','cement',
    'concrete pump','vibrator','float','trowel','screed rail',
  ],
  'Plumbing & Drainage': [
    'pipe','fitting','valve','sanitary','basin','toilet','sewer','drain',
    'upvc','hdpe','ppr','copper tube','tap','cistern','geyser','trap',
    'manhole','stormwater','rainwater','irrigation','sprinkler','water meter',
    'flushing','urinal','shower','bath',
    // SA-specific additions
    'pp-r','ppr','pe pipe','poly pipe','alkathene','kuzebaas',
    'geberit','cobra','ideal standard','franke',
    'flange','coupling','elbow','tee piece','reducer','bend',
    'inspection eye','rodding eye','gulley','catch pit','sump',
    'pressure relief','float valve','ball valve','butterfly valve','gate valve',
    'backflow','non-return','check valve','strainer','y-strainer',
    'threaded','push-fit','solvent cement','compression fitting',
    'copper press','propress','viega','rehau',
  ],
  'Electrical & LV Systems': [
    'cable','conduit','db','mcb','rccb','isolator','socket','light','switch',
    'busbar','earthing','cfl','led','armoured','switchgear','mccb','kiosk',
    'transformer','distribution','circuit breaker','surge','gland','termination',
    'cable tray','duct','trunking','luminaire','fitting','panel','metering',
    // SA-specific additions
    'swa','nyy','pvc insulated','xlpe','cu conductor','aluminium conductor',
    'db board','consumer unit','mini sub','feeder pillar','LV board','MV board',
    'earth leakage','rcd','spd','lightning','earth rod','earth spike','copper tape',
    'steel wire armour','flexible conduit','galvanised conduit','rigid conduit',
    'DIN rail','busbar chamber','metering cubicle','prepaid meter',
    'SANS 10142','SANS 1507','nrs 048','eskom','COC','certificate of compliance',
    'streetlight','high mast','flood light','emergency light','exit sign',
    'reticulation','substation','11kv','6.6kv','33kv','MV cable',
  ],
  'Mechanical & HVAC': [
    'duct','fan','ahu','chiller','vrf','pump','compressor','refrigerant',
    'insulation','diffuser','grille','damper','hvac','air conditioning',
    'ventilation','cooling','heating','boiler','heat exchanger','strainer',
    'motor','gearbox','actuator',
    // SA-specific additions
    'split unit','cassette unit','vrf system','vrv system','mini split',
    'inverter unit','window unit','portable aircon',
    'cooling tower','dry cooler','evaporative cooler',
    'fire pump','jockey pump','pressure set','borehole pump','submersible pump',
    'generator','genset','ups system','ats panel','changeover',
    'flexible duct','ductwork','spiral duct','rectangular duct',
    'fire damper','smoke damper','vcd','volume control damper',
    'pipe lagging','mineral wool','fibreglass','polyurethane foam',
  ],
  'Fencing & Security': [
    'fence','palisade','razor wire','gate','cctv','access control','boom',
    'barrier','electric fence','mesh','barbed wire','turnstile','intercom',
    'video','intruder','alarm','sensor','motion','perimeter',
    // SA-specific additions
    'clearvu','358 mesh','diamond mesh','chain link','welded mesh','BRC fence',
    'concrete post','steel post','wooden pole','droppers','straining wire',
    'anti-climb','trellidoor','security gate','burglar bar','security door',
    'energiser','weighting','fence monitoring','perimeter detection',
    'DVR','NVR','IP camera','dome camera','bullet camera','PTZ camera',
    'biometric','fingerprint reader','proximity reader','proximity card',
    'electric lock','magnetic lock','door strike','panic bar','push bar',
  ],
  'General Supplies & PPE': [
    'gloves','helmet','vest','boot','goggles','tape','consumable','hardware',
    'fastener','bolt','nut','washer','screw','anchor','bracket','hinge',
    'paint','primer','sealant','adhesive','grease','lubricant','safety',
    // SA-specific additions
    'overalls','coverall','hard hat','safety shoes','steel toe','high-vis',
    'ear protection','earmuff','earplug','dust mask','respirator','face shield',
    'harness','lanyard','fall arrest','safety net',
    'tie wire','binding wire','black annealed','nails','staples',
    'silicone','mastic','polyurethane sealant','epoxy','resin',
    'WD-40','penetrating oil','rust inhibitor','anti-seize',
    'warning tape','hazard tape','caution tape',
  ],
  'Health & Medical': [
    'bandage','first aid','stretcher','medication','sanitiser','ppe kit',
    'medical','health','clinic','pharmaceutical','vaccine','swab','syringe',
    // SA-specific additions
    'first aid box','first aid kit','AED','defibrillator','eyewash',
    'emergency shower','spill kit','biohazard','sharps container',
    'OHSA','OHS act','health and safety file',
  ],
  'Electronics & ICT': [
    'switch','router','server','ups','structured cabling','fibre','patch panel',
    'rack','ip camera','network','wireless','wifi','antenna','cable cat',
    'data point','voice point','telephone','intercom','it equipment',
    // SA-specific additions
    'CAT6','CAT6A','CAT5e','fibre optic','OM3','OM4','OS2','single mode','multi mode',
    'SFP','SFP+','media converter','PoE switch','managed switch','unmanaged switch',
    'keystone','RJ45','LC connector','SC connector','ST connector',
    'cable manager','velcro','cable tie','conduit pull string',
    'CCTV system','NVR','DVR','video management','VMS','PABX','IP PBX',
    'Microsoft','Windows Server','VMware','cloud','Azure','AWS',
    'UPS','APC','Eaton','Schneider','server rack','server cabinet','42U','22U',
  ],
  'Labour & Installation': [
    'install','erect','lay','fix','weld','connect','terminate','commission',
    'test','paint','demolish','excavate','hang','set','place','construct',
    'assemble','dismantle','remove','repair','maintain','service','calibrate',
    // SA-specific additions
    'supply and install','S&I','supply and fix',
    'strip out','break out','cut out','core drill','diamond drill',
    'grout','point','re-point','seal','waterproof','tanking',
    'reinstate','make good','patch','hack off',
    'testing and commissioning','T&C','TAC','snagging',
    'protection','hoarding','scaffolding','access equipment','cherry picker',
    'temporary works','formwork erect','formwork strike',
    'plumber','electrician','artisan','labourer','foreman','supervisor',
    'CIDB','NHBRC','SACPCMP',
  ],
};

// ── Supply-and-install detection ──────────────────────────────────────────────
const SAI_PATTERN = /supply\s*(and|&|,\s*deliver\s*and)\s*install|s\s*&\s*i\b|supply,\s*deliver\s*and\s*install/i;

// ── Dimension / spec extraction pattern ──────────────────────────────────────
const DIMENSION_PATTERN = /(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*[xX×]?\s*(\d+(?:\.\d+)?)?\s*mm|DN\s*(\d+)|Ø\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*[Aa]|(\d+(?:\.\d+)?)\s*mm\b/;

/**
 * Initial extraction pass — converts raw parser output to flat item objects.
 * Labour detection and S&I splitting are applied later after hierarchy enrichment.
 */
function extractLineItems(rawItems) {
  const results = [];

  for (const raw of rawItems) {
    if (raw._raw) {
      const item = extractFromTableRow(raw);
      if (item) results.push(item);
    } else if (raw._text) {
      const items = extractFromFreeText(raw._text, raw._source);
      results.push(...items);
    }
  }

  return results;
}

/**
 * Merges continuation rows (rows with no unit/qty that follow a dotted item_no row)
 * into a single logical line item before classification.
 *
 * This handles BOQ formats where a long description wraps across multiple rows
 * with the unit/qty only appearing on the last continuation row.
 *
 * @param {Array} rows - rowsForClassifier array
 * @returns {Array} merged rows
 */
function mergeMultiLineDescriptions(rows) {
  // ── Inline helpers ────────────────────────────────────────────────────────
  function isHeadingOrSummaryRow(row) {
    const d = (row.description || '').toLowerCase();
    if (SUMMARY_PATTERNS.some(p => d.includes(p))) return true;
    const desc = row.description || '';
    if (desc === desc.toUpperCase() && desc.length > 3 && !row.unit && !row.quantity) return true;
    if (HEADING_KEYWORDS.some(kw => desc.toUpperCase().includes(kw)) && !row.unit && !row.quantity) return true;
    return false;
  }

  function hasDottedItemNo(row) {
    return /\d+\.\d+/.test(row.item_no || '');
  }

  // ── Main merge loop ───────────────────────────────────────────────────────
  const merged      = [];
  let   accumulator = null;

  for (const row of rows) {
    const hasUnit = !!row.unit;
    const hasQty  = row.quantity != null && Number(row.quantity) > 0;

    // Case 1: heading or summary — flush accumulator, pass row through
    if (isHeadingOrSummaryRow(row)) {
      if (accumulator) { merged.push(accumulator); accumulator = null; }
      merged.push(row);
      continue;
    }

    // Case 2: terminal row (has unit OR positive qty) — absorb accumulator description
    if (hasUnit || hasQty) {
      if (accumulator) {
        merged.push({
          ...row,
          description: (accumulator.description + ' ' + (row.description || '')).trim(),
          item_no:     accumulator.item_no || row.item_no,
        });
        accumulator = null;
      } else {
        merged.push(row);
      }
      continue;
    }

    // Case 3: new item start (no unit, no qty, but has dotted item_no)
    if (hasDottedItemNo(row)) {
      if (accumulator) {
        // flush previous incomplete accumulator
        merged.push({ ...accumulator, incomplete: true });
      }
      accumulator = { ...row };
      continue;
    }

    // Case 4: continuation line (no unit, no qty, no dotted item_no, non-empty description)
    if (row.description && row.description.trim()) {
      if (accumulator) {
        accumulator = {
          ...accumulator,
          description: (accumulator.description + ' ' + row.description.trim()).trim(),
        };
      } else {
        merged.push(row); // standalone — let classifyRow handle it as narrative
      }
      continue;
    }

    // Fallthrough: empty or unhandled row
    merged.push(row);
  }

  // Flush any remaining accumulator
  if (accumulator) merged.push({ ...accumulator, incomplete: true });

  return merged;
}

/**
 * Extracts a single line item from a tabular row using the detected column map.
 * Accepts enriched rows from buildHierarchyTree (with section_name, subsection_name, context_note).
 */
function extractFromTableRow(raw) {
  const row    = raw._raw;
  const colMap = raw._colMap || {};

  const get = (field) => {
    const idx = colMap[field];
    return (idx !== undefined && idx >= 0 && idx < row.length) ? String(row[idx] || '').trim() : '';
  };

  const desc = get('description') || row.find(c => c && c.length > 5) || '';
  if (!desc || desc.length < 3) return null;
  if (/total|subtotal|sub.?total|carried forward|brought forward|vat|tax/i.test(desc) && !get('quantity')) return null;

  const qtyRaw  = get('quantity');
  const qty     = parseFloat(qtyRaw.replace(/[,\s]/g, '')) || null;
  const unit    = normaliseUnit(get('unit'));
  const rateRaw = get('unit_rate');
  const rate    = parseFloat(rateRaw.replace(/[,\s]/g, '')) || null;
  const totalRaw = get('total');
  const total   = parseFloat(totalRaw.replace(/[,\s]/g, '')) || null;
  const incomplete = !qty || !unit;

  // Inherit hierarchy context if present (from buildHierarchyTree)
  const sectionName    = raw.section_name    || '';
  const subsectionName = raw.subsection_name || '';
  const contextNote    = raw.context_note    || '';

  // Enriched text for category + labour detection
  const enriched = [sectionName, subsectionName, contextNote, desc].join(' ');

  return {
    item_no:         get('item_no') || String(raw._rowIndex + 1),
    description:     desc,
    quantity:        qty || 0,
    unit:            unit || get('unit') || '',
    unit_rate:       rate,
    total:           total || (rate && qty ? +(rate * qty).toFixed(2) : null),
    incomplete,
    category:        detectCategory(desc, sectionName, subsectionName, contextNote),
    item_type:       'material',
    spec:            extractSpec(desc),
    section_name:    sectionName,
    subsection_name: subsectionName,
    context_note:    contextNote,
    _source:         raw._source,
    _enriched:       enriched,
  };
}

/**
 * Extracts line items from free-text (DOCX, PDF, paste).
 */
function extractFromFreeText(text, source) {
  const lines  = text.split('\n').map(l => l.trim()).filter(Boolean);
  const items  = [];

  const LINE_PATTERN = /^([A-Z0-9]+(?:\.[A-Z0-9]+)*)\s+(.{3,}?)(?:\s+([\d,\.]+))\s+([a-z²³\/]+)\s*(?:([\d,\.]+)\s*)?([\d,\.]+)?$/i;

  // ── Step 2.3: Multi-physical-line → logical-line join pass ────────────────
  // Detects item starts (dotted number prefix OR plain integer 1-4 digits) and
  // terminal rows (end with qty+unit). Merges continuation lines into a single
  // logical entry before pattern matching.
  //
  // Matches: "1.1 " "A.1 " (dotted)  |  "1 " "10 " "123 " (plain integer <= 4 digits)
  const ITEM_START         = /^(?:[A-Z0-9]+\.[A-Z0-9]|[0-9]{1,4}(?:\s|$))/i;
  const TERMINAL_UNIT_SUFFIX = /\s+\d[\d,.]*\s+(m²|m³|lm|each|nr|ea|m2|m3|m|kg|t|hr|day|ls|pc|pcs)\s*$/i;

  const logicalLines = [];
  let buffer = '';

  for (const line of lines) {
    if (ITEM_START.test(line)) {
      // Flush previous buffer as its own logical line
      if (buffer.trim()) logicalLines.push(buffer.trim());
      buffer = line;
    } else if (TERMINAL_UNIT_SUFFIX.test(line)) {
      // This line terminates the current item — concatenate and flush
      const combined = buffer ? (buffer + ' ' + line).trim() : line;
      logicalLines.push(combined);
      buffer = '';
    } else {
      // Continuation or standalone
      if (buffer) {
        buffer = buffer + ' ' + line;
      } else {
        logicalLines.push(line);
      }
    }
  }
  // Flush any remaining buffer
  if (buffer.trim()) logicalLines.push(buffer.trim());
  // ── End join pass ──────────────────────────────────────────────────────────

  for (const line of logicalLines) {
    const m = line.match(LINE_PATTERN);
    if (!m) continue;

    const [, item_no, description, qtyStr, unitRaw, rateStr, totalStr] = m;
    const qty   = parseFloat(qtyStr.replace(/,/g,'')) || 0;
    const unit  = normaliseUnit(unitRaw);
    const rate  = rateStr  ? parseFloat(rateStr.replace(/,/g,''))  : null;
    const total = totalStr ? parseFloat(totalStr.replace(/,/g,'')) : (rate && qty ? +(rate * qty).toFixed(2) : null);

    items.push({
      item_no,
      description,
      quantity:        qty,
      unit,
      unit_rate:       rate,
      total,
      incomplete:      !qty || !unit,
      category:        detectCategory(description, '', '', ''),
      item_type:       'material',
      spec:            extractSpec(description),
      section_name:    '',
      subsection_name: '',
      context_note:    '',
      _source:         source,
      _enriched:       description,
    });
  }

  return items;
}

/**
 * Normalises a unit string to the standard output values.
 */
function normaliseUnit(unit) {
  if (!unit) return '';
  const key = unit.toLowerCase().trim();
  return UNIT_NORMALISE[key] || unit;
}

/**
 * Detects category from description keywords.
 * Uses full context: section_name + subsection_name + context_note + description
 */
function detectCategory(desc, sectionName, subsectionName, contextNote) {
  if (!desc) return 'Unclassified';
  // Build enriched text combining inherited hierarchy context with item description
  const enriched = [sectionName||'', subsectionName||'', contextNote||'', desc].join(' ').toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(k => enriched.includes(k))) return category;
  }
  return 'Unclassified';
}

/**
 * Extracts dimension/spec data from a description string.
 */
function extractSpec(desc) {
  if (!desc) return null;
  const m = desc.match(DIMENSION_PATTERN);
  if (!m) return null;
  return {
    raw:      m[0],
    width:    m[1] || null,
    height:   m[2] || null,
    length:   m[3] || null,
    diameter: m[4] || m[5] || null,
    rating:   m[6] || null,
    size_mm:  m[7] || null,
  };
}

/**
 * Detects the trade type from an item description (lowercase).
 * Returns a key matching LABOUR_RATES_TRADE exactly.
 * Rules applied in priority order — first match wins.
 */
function detectTrade(descLow) {
  if (/paint|primer|coating/.test(descLow))                                   return 'Painter';
  if (/\btile\b|tiling|ceramic|porcelain/.test(descLow))                      return 'Tiler';
  if (/plaster|render|skim/.test(descLow))                                    return 'Plasterer';
  if (/brick|block|masonry|mortar/.test(descLow))                             return 'Bricklayer';
  if (/timber|carp|formwork|shutter|door.?frame|skirting|fascia/.test(descLow)) return 'Carpenter';
  if (/cable|conduit|wiring|electrician|\bdb\b|socket|light|switch|mcb|mccb|surge|earthing|terminate|gland/.test(descLow)) return 'Electrician';
  if (/pipe|plumb|tap|valve|basin|toilet|drain|sewer|geyser|mixer/.test(descLow)) return 'Plumber';
  if (/\bweld/.test(descLow))                                                 return 'Welder';
  if (/excavat|backfill|compact|reinstate|clearing|rubble/.test(descLow))     return 'General Labourer';
  if (/foreman|supervisor/.test(descLow))                                     return 'Foreman';
  return 'General Labourer'; // fallback
}

/**
 * Converts a trade hourly rate to a unit rate for a given measurement unit.
 * Returns { unitRate, _labour_basis, _labour_note }
 *
 * Rule:  NEVER return hourlyRate as unitRate for area or length units.
 *        Always divide by productive output first.
 */
function computeLabourUnitRate(trade, normalisedUnit, descLow) {
  const hourlyRate = LABOUR_RATES_TRADE[trade] || LABOUR_RATES_TRADE['General Labourer'];
  const output     = PRODUCTIVE_OUTPUT[trade]  || {};

  // ── Area (m²) ────────────────────────────────────────────────────────────
  if (normalisedUnit === 'm²') {
    const rate = output['m²'] != null ? output['m²'] : 2; // default 2 m²/hr
    const unitRate = +(hourlyRate / rate).toFixed(2);
    return {
      unitRate,
      _labour_basis: 'productive_output',
      _labour_note:  `${trade} @ R${hourlyRate}/hr ÷ ${rate} m²/hr = R${unitRate}/m²`,
    };
  }

  // ── Linear metre (lm / m) ────────────────────────────────────────────────
  if (normalisedUnit === 'lm' || normalisedUnit === 'm') {
    const rate = output['lm'] != null ? output['lm'] : 5; // default 5 lm/hr
    const unitRate = +(hourlyRate / rate).toFixed(2);
    return {
      unitRate,
      _labour_basis: 'productive_output',
      _labour_note:  `${trade} @ R${hourlyRate}/hr ÷ ${rate} lm/hr = R${unitRate}/m`,
    };
  }

  // ── Cubic metre (m³) ────────────────────────────────────────────────────
  if (normalisedUnit === 'm³') {
    const rate = output['m³'] != null ? output['m³'] : 0.5; // default 0.5 m³/hr
    const unitRate = +(hourlyRate / rate).toFixed(2);
    return {
      unitRate,
      _labour_basis: 'productive_output',
      _labour_note:  `${trade} @ R${hourlyRate}/hr ÷ ${rate} m³/hr = R${unitRate}/m³`,
    };
  }

  // ── Hourly — pass-through ────────────────────────────────────────────────
  if (normalisedUnit === 'hr' || normalisedUnit === 'hour') {
    return {
      unitRate:      hourlyRate,
      _labour_basis: 'hourly_direct',
      _labour_note:  `${trade} @ R${hourlyRate}/hr (hourly rate)`,
    };
  }

  // ── Daily / lump sum ────────────────────────────────────────────────────
  if (normalisedUnit === 'day' || normalisedUnit === 'ls') {
    const unitRate = +(hourlyRate * 8).toFixed(2);
    return {
      unitRate,
      _labour_basis: 'day_rate',
      _labour_note:  `${trade} @ R${hourlyRate}/hr × 8 hrs = R${unitRate}/day`,
    };
  }

  // ── Each / item / nr — use DURATION_LOOKUP ───────────────────────────────
  if (['each', 'nr', 'no', 'item', 'ea', 'pc'].includes(normalisedUnit)) {
    // Collect all matching entries, sort by hours desc, take highest
    const matches = DURATION_LOOKUP
      .filter(e => e.keyword === '' || descLow.includes(e.keyword))
      .sort((a, b) => b.hours - a.hours);

    const best = matches[0] || { keyword: 'default', hours: 2 };
    const unitRate = +(hourlyRate * best.hours).toFixed(2);
    return {
      unitRate,
      _labour_basis: 'duration_lookup',
      _labour_note:  `${trade} @ R${hourlyRate}/hr × ${best.hours} hrs (${best.keyword || 'default'}) = R${unitRate}/each`,
    };
  }

  // ── Fallback — unknown unit, assume 2 hours ──────────────────────────────
  const unitRate = +(hourlyRate * 2).toFixed(2);
  return {
    unitRate,
    _labour_basis: 'fallback',
    _labour_note:  `${trade} @ R${hourlyRate}/hr × 2 hrs (unknown unit "${normalisedUnit}") — review manually`,
  };
}

/**
 * Applies labour item detection and supply-and-install splitting to an item.
 * Uses the enriched context (_enriched = section + subsection + context_note + description).
 * Returns an array of one or two items.
 */
function applyLabourAndSplit(item) {
  // Use enriched text for all detection so section headings / context notes inform classification
  const enrichedLow = (item._enriched || item.description || '').toLowerCase();

  // Helper: apply rate engine to a labour item (only when unit_rate is not already set)
  function enrichLabourItem(labourItem) {
    if (labourItem.unit_rate != null) return labourItem; // BOQ already supplied a rate — keep it
    const trade    = detectTrade(enrichedLow);
    const normUnit = normaliseUnit(labourItem.unit || '');
    const { unitRate, _labour_basis, _labour_note } = computeLabourUnitRate(trade, normUnit, enrichedLow);
    const qty      = labourItem.quantity || labourItem.qty || 0;
    return {
      ...labourItem,
      unit_rate:     unitRate,
      total:         qty > 0 ? +(unitRate * qty).toFixed(2) : labourItem.total,
      _labour_trade: trade,
      _labour_basis,
      _labour_note,
      _hourly_rate:  LABOUR_RATES_TRADE[trade] || LABOUR_RATES_TRADE['General Labourer'],
    };
  }

  // ── Supply-and-install split ─────────────────────────────────────────────
  if (SAI_PATTERN.test(enrichedLow)) {
    const materialItem = {
      ...item,
      item_no:     item.item_no + 'a',
      description: '[SUPPLY] ' + item.description,
      item_type:   'material',
      _split:      true,
    };
    const labourItemRaw = {
      ...item,
      item_no:     item.item_no + 'b',
      description: '[INSTALL] ' + item.description,
      item_type:   'labour',
      category:    'Labour & Installation',
      _split:      true,
    };
    return [materialItem, enrichLabourItem(labourItemRaw)];
  }

  // ── Pure labour detection ────────────────────────────────────────────────
  const isLabourByTrigger  = LABOUR_TRIGGER_KEYWORDS.some(k => enrichedLow.includes(k));
  const isLabourByCategory = CATEGORY_KEYWORDS['Labour & Installation']
    .some(k => enrichedLow.includes(k));

  if (isLabourByTrigger || isLabourByCategory) {
    return [enrichLabourItem({ ...item, item_type: 'labour', category: 'Labour & Installation' })];
  }

  return [item];
}


// ─────────────────────────────────────────────────────────────────────────────
//  SECTION E — SEARCH (Serper API)
// ─────────────────────────────────────────────────────────────────────────────

async function serperSearch(query, apiKey) {
  const body = {
    q:   `${query} price buy`,
    gl:  'za',
    hl:  'en',
    num: MAX_CANDIDATES + 3,
  };

  const res = await fetch(SERPER_URL, {
    method:  'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Serper API returned ${res.status}: ${detail.substring(0, 200)}`);
  }

  const data = await res.json();
  const organic  = (data.organic  || []).map(r => r.link);
  const shopping = (data.shopping || []).map(r => r.link).filter(Boolean);
  const allUrls  = [...organic, ...shopping];

  const seen = new Set();
  return allUrls
    .filter(url => {
      if (!url || seen.has(url)) return false;
      if (/\.(pdf|docx?|xlsx?|pptx?|zip)$/i.test(url)) return false;
      if (/\/(search|category|tag|blog|news|forums?|results)\b/i.test(url)) return false;
      seen.add(url);
      return true;
    })
    .slice(0, MAX_CANDIDATES);
}

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION F — SCRAPE (Direct fetch → FlareSolverr fallback)
// ─────────────────────────────────────────────────────────────────────────────

async function scrapeAndExtract(url, flareHost) {
  let html = await directFetch(url);
  if ((!html || isCloudflareChallenge(html)) && flareHost) {
    console.log(`[FlareSolverr] Bypassing Cloudflare for: ${url}`);
    html = await flaresolverrFetch(url, flareHost);
  }
  if (!html) return null;
  return extractFromHTML(html, url);
}

async function directFetch(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DIRECT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':                BROWSER_UA,
        'Accept':                    'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language':           'en-ZA,en-GB;q=0.9,en;q=0.8',
        'Accept-Encoding':           'gzip, deflate, br',
        'Cache-Control':             'no-cache',
        'Upgrade-Insecure-Requests': '1',
      },
      redirect: 'follow',
      signal:   controller.signal,
    });
    clearTimeout(timer);
    if ([403, 429, 503].includes(res.status)) return null;
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('html')) return null;
    return await res.text();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

async function flaresolverrFetch(url, flareHost) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FLARE_TIMEOUT_MS);
  try {
    const res = await fetch(`${flareHost}/v1`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ cmd: 'request.get', url, maxTimeout: 20000 }),
      signal:  controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 'ok') return null;
    return data.solution?.response || null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  ROW CLASSIFIER (Step 2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classifies a single raw row object into one of five types:
 *   "summary" | "section_heading" | "subsection_heading" | "narrative" | "line_item"
 *
 * Receives: { item_no, description, unit, quantity, rate, price }
 * Returns:  same object with row_type and classification_confidence added.
 */
function classifyRow(row) {
  const item_no  = String(row.item_no  || '').trim();
  const desc     = String(row.description || '').trim();
  const unit     = String(row.unit || '').trim();
  const qty      = row.quantity;
  const descLow  = desc.toLowerCase();

  // ── Rule 1: Summary / admin rows ─────────────────────────────────────────
  if (SUMMARY_PATTERNS.some(p => descLow.includes(p))) {
    return { ...row, row_type: 'summary', classification_confidence: 'high' };
  }

  // ── Rule 2: Section heading — has item_no without '.', no unit, no qty ────
  //    Also catches all-caps descriptions with no item_no / unit / qty
  const hasNoDot     = item_no && !item_no.includes('.');
  const hasNoUnitQty = !unit && !qty;

  if ((hasNoDot && hasNoUnitQty) ||
      (!item_no && desc === desc.toUpperCase() && desc.length > 3 && hasNoUnitQty)) {
    return { ...row, row_type: 'section_heading', classification_confidence: 'high' };
  }

  // ── Rule 3: Narrative — no item_no, no unit, no qty, long description ─────
  if (!item_no && !unit && !qty && desc.length > 15) {
    return { ...row, row_type: 'narrative', classification_confidence: 'high' };
  }

  // ── Rule 4: Subsection heading — item_no has exactly one '.', no unit, no qty
  const dotCount = (item_no.match(/\./g) || []).length;
  if (dotCount === 1 && !unit && !qty) {
    return { ...row, row_type: 'subsection_heading', classification_confidence: 'high' };
  }

  // ── Rule 5 (default): Line item ───────────────────────────────────────────
  const hasDot      = dotCount >= 1;
  const hasUnit     = !!unit;
  const hasQty      = !!qty && Number(qty) > 0;

  if (hasDot && hasUnit && hasQty) {
    return { ...row, row_type: 'line_item', classification_confidence: 'high' };
  }

  // Partial line item — has item_no with dot but missing unit or qty
  return { ...row, row_type: 'line_item', incomplete: true, classification_confidence: 'low' };
}

// ─────────────────────────────────────────────────────────────────────────────
//  HIERARCHY TREE BUILDER (Step 3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Walks the classified rows in order, tracking section/subsection context,
 * and attaches inherited context fields to every line item.
 *
 * Returns: { lineItems, excludedRows }
 *   lineItems   — priceable rows only, each enriched with section_name,
 *                 subsection_name, context_note
 *   excludedRows — everything else (summaries, headings, narratives)
 */
function buildHierarchyTree(classifiedRows) {
  const lineItems    = [];
  const excludedRows = [];

  let currentSection    = '';
  let currentSubsection = '';
  let pendingNarrative  = '';

  for (const row of classifiedRows) {
    switch (row.row_type) {
      case 'summary':
        pendingNarrative = '';
        excludedRows.push(row);
        break;

      case 'section_heading':
        currentSection    = row.description || '';
        currentSubsection = '';
        pendingNarrative  = '';
        excludedRows.push(row);
        break;

      case 'subsection_heading':
        currentSubsection = row.description || '';
        pendingNarrative  = '';
        excludedRows.push(row);
        break;

      case 'narrative':
        pendingNarrative = pendingNarrative
          ? pendingNarrative + ' ' + (row.description || '')
          : (row.description || '');
        excludedRows.push(row);
        break;

      case 'line_item':
      default:
        lineItems.push({
          ...row,
          section_name:    currentSection,
          subsection_name: currentSubsection,
          context_note:    pendingNarrative,
        });
        pendingNarrative = ''; // consumed by this item
        break;
    }
  }

  return { lineItems, excludedRows };
}

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION G — EXTRACT (4-strategy HTML price extractor)
// ─────────────────────────────────────────────────────────────────────────────

function extractFromHTML(html, url) {
  let price = null, title = null, available = true;

  // Strategy 1: JSON-LD schema.org
  const ldMatches = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const [, inner] of ldMatches) {
    try {
      const obj   = JSON.parse(inner.trim());
      const nodes = Array.isArray(obj) ? obj : (obj['@graph'] ? obj['@graph'] : [obj]);
      for (const node of nodes) {
        if (!/product/i.test(String(node['@type'] || ''))) continue;
        if (node.name) title = String(node.name).trim().substring(0, 120);
        const offerRaw = node.offers || node.Offers;
        if (!offerRaw) continue;
        const offer = Array.isArray(offerRaw) ? offerRaw[0] : offerRaw;
        if (!offer?.price) continue;
        const p = parseFloat(String(offer.price).replace(/[^\d.]/g, ''));
        if (p > 0 && p < 5_000_000) {
          price = p;
          if (offer.availability) available = !/OutOfStock|Discontinued|PreOrder/i.test(offer.availability);
          break;
        }
      }
      if (price) break;
    } catch { /* continue */ }
  }

  // Strategy 2: HTML meta / itemprop / data attributes
  if (!price) {
    const pricePatterns = [
      /property=["']product:price:amount["'][^>]*content=["']([^"']+)["']/i,
      /itemprop=["']price["'][^>]*content=["']([^"']+)["']/i,
      /data-product-price=["']([^"']+)["']/i,
      /data-price=["']([^"']+)["']/i,
      /data-final-price=["']([^"']+)["']/i,
      /class=["'][^"']*price[^"']*["'][^>]*>R?\s*(\d[\d\s,]*(?:\.\d{1,2})?)/i,
    ];
    for (const pat of pricePatterns) {
      const m = html.match(pat);
      if (!m) continue;
      let p = parseFloat(m[1].replace(/[^\d.]/g, ''));
      if (Number.isInteger(p) && p > 10_000 && !m[1].includes('.')) p /= 100;
      if (p > 0 && p < 5_000_000) { price = p; break; }
    }
  }

  // Strategy 3: Embedded JSON blobs
  if (!price) {
    const jsonBlobs = [
      /"price"\s*:\s*(\d+(?:\.\d{1,2})?)/,
      /"amount"\s*:\s*"(\d+(?:\.\d{1,2})?)"/,
      /ShopifyAnalytics\.meta\.price\s*=\s*(\d+)/,
      /"regularPrice"\s*:\s*(\d+(?:\.\d{1,2})?)/,
      /"salePrice"\s*:\s*(\d+(?:\.\d{1,2})?)/,
    ];
    for (const pat of jsonBlobs) {
      const m = html.match(pat);
      if (!m) continue;
      let p = parseFloat(m[1]);
      if (Number.isInteger(p) && p > 10_000) p /= 100;
      if (p > 0 && p < 5_000_000) { price = p; break; }
    }
  }

  // Strategy 4: ZAR regex
  if (!price) {
    const zarRx = /\bR\s*(\d[\d\s,]*(?:\.\d{1,2})?)/g;
    const candidates = [];
    let m;
    while ((m = zarRx.exec(html)) !== null) {
      const val = parseFloat(m[1].replace(/[\s,]/g, ''));
      if (val >= 5 && val <= 500_000) candidates.push(val);
    }
    if (candidates.length) {
      candidates.sort((a, b) => a - b);
      price = candidates[Math.floor(candidates.length * 0.30)];
    }
  }

  // Title extraction
  if (!title) {
    const titlePatterns = [
      /property=["']og:title["'][^>]*content=["']([^"']{5,150})["']/i,
      /itemprop=["']name["'][^>]*content=["']([^"']{5,150})["']/i,
      /<h1[^>]*>([^<]{5,150})<\/h1>/i,
      /<title>([^<]{5,100})<\/title>/i,
    ];
    for (const pat of titlePatterns) {
      const m = html.match(pat);
      if (m) { title = m[1].trim().replace(/\s+/g, ' '); break; }
    }
  }

  if (/out[\s-]of[\s-]stock|unavailable|sold[\s-]out|discontinued/i.test(html)) available = false;
  if (!price) return null;

  return { price: Math.round(price * 100) / 100, title: title || null, available };
}

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION H — HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function isCloudflareChallenge(html) {
  return (
    /\bcf-ray\b/i.test(html) ||
    /just a moment\.\.\./i.test(html) ||
    /__cf_bm|cf_clearance/i.test(html) ||
    /challenge-platform/i.test(html) ||
    /<title>[^<]*cloudflare[^<]*<\/title>/i.test(html) ||
    /Checking if the site connection is secure/i.test(html)
  );
}

function resolveRetailerName(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    for (const [domain, name] of Object.entries(RETAILER_MAP)) {
      if (host === domain || host.endsWith('.' + domain)) return name;
    }
    return host.split('.')[0].split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  } catch {
    return 'SA Supplier';
  }
}

function respond(statusCode, headers, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

/** Splits a Buffer on a delimiter Buffer. Returns array of parts between delimiters. */
function splitBuffer(buf, delimiter) {
  const parts = [];
  let start = 0;
  let idx   = indexOfSequence(buf, delimiter, start);
  while (idx !== -1) {
    parts.push(buf.slice(start, idx));
    start = idx + delimiter.length;
    idx   = indexOfSequence(buf, delimiter, start);
  }
  parts.push(buf.slice(start));
  return parts.filter(p => p.length > 0);
}

/** Finds the first index of a byte sequence (needle) in a Buffer (haystack). */
function indexOfSequence(haystack, needle, offset = 0) {
  outer: for (let i = offset; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

// ─────────────────────────────────────────────────────────────────────────────
//  PIPELINE EXPORTS — used by ocr-intake-background.js
//  These are the pure-data transform functions (no HTTP, no Tesseract).
//  Exporting them here keeps a single source of truth so there is no duplication.
// ─────────────────────────────────────────────────────────────────────────────
exports.pipeline = {
  filterDocumentNoise,
  extractLineItems,
  mergeMultiLineDescriptions,
  classifyRow,
  buildHierarchyTree,
  extractFromTableRow,
  extractFromFreeText,
  applyLabourAndSplit,
};
