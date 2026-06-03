/**
 * Netlify Background Function: ocr-intake-background
 *
 * Accepts a multipart file upload (PDF or image), runs full OCR via Tesseract.js,
 * and writes the parsed line items to /tmp/<jobId>.json.
 *
 * Background Functions have a 15-minute timeout — suitable for BOQs with 50+ pages.
 *
 * Triggered by POST /.netlify/functions/ocr-intake-background?jobId=<id>
 * The caller must supply the jobId (a UUID generated client-side or by the router).
 *
 * Job result file schema:
 *   /tmp/<jobId>.json  →  { status, items, count, incomplete, excluded, sectionLabels, error }
 *   status: 'pending' | 'done' | 'error'
 *
 * NOTE: /tmp is an ephemeral in-memory filesystem shared within a single Netlify
 * function invocation sandbox.  For multi-instance deployments, replace the
 * /tmp read/write calls with a key-value store (Netlify Blobs, Redis, etc.).
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Re-used helpers from search-prices (copied to avoid circular deps) ──────
// These are the OCR parsers + full pipeline extracted verbatim so this function
// is self-contained and can be deployed independently.

const HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json',
};

// ─────────────────────────────────────────────────────────────────────────────
exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }

  const { jobId } = event.queryStringParameters || {};
  if (!jobId || !/^[a-zA-Z0-9_-]{8,64}$/.test(jobId)) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid or missing jobId' }) };
  }

  const jobFile = path.join('/tmp', `${jobId}.json`);

  // Mark job as pending immediately so the poller knows it was accepted
  writeJob(jobFile, { status: 'pending', progress: 0, pagesDone: 0, pagesTotal: 0 });

  try {
    const ct = (event.headers['content-type'] || '').toLowerCase();
    if (!ct.includes('multipart/form-data')) {
      writeJob(jobFile, { status: 'error', error: 'Expected multipart/form-data' });
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Expected multipart/form-data' }) };
    }

    const { filename, buffer, mimeType } = extractMultipartFile(event);
    const ext = (filename || '').split('.').pop().toLowerCase();

    let rawItems_pre = [];

    if (ext === 'pdf' || mimeType === 'application/pdf') {
      rawItems_pre = await parsePDFWithProgress(buffer, jobFile);
    } else if (['jpg', 'jpeg', 'png'].includes(ext) || mimeType?.startsWith('image/')) {
      rawItems_pre = await parseImageWithProgress(buffer, jobFile);
    } else {
      writeJob(jobFile, { status: 'error', error: `Unsupported file type for background OCR: .${ext}` });
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: `Unsupported type: .${ext}` }) };
    }

    // ── Shared pipeline (mirrors search-prices.js handleParseRequest) ──────
    const { filtered: rawItems_clean, sectionLabels } = filterDocumentNoise(rawItems_pre);
    const rawItems       = extractLineItems(rawItems_clean);
    const rowsForClassifier = rawItems.map(i => ({
      item_no:     i.item_no     || '',
      description: i.description || '',
      unit:        i.unit        || '',
      quantity:    i.quantity    || null,
      rate:        i.unit_rate   || null,
      price:       i.total       || null,
      _raw: i._raw, _colMap: i._colMap, _rowIndex: i._rowIndex,
      _text: i._text, _source: i._source,
    }));

    const mergedRows     = mergeMultiLineDescriptions(rowsForClassifier);
    const classifiedRows = mergedRows.map(r => classifyRow(r));
    const { lineItems, excludedRows } = buildHierarchyTree(classifiedRows);

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

    writeJob(jobFile, {
      status:        'done',
      items:         enrichedItems,
      count:         enrichedItems.length,
      incomplete:    enrichedItems.filter(i => i.incomplete).length,
      excluded:      excludedRows,
      sectionLabels,
    });

    return { statusCode: 202, headers: HEADERS, body: JSON.stringify({ accepted: true, jobId }) };

  } catch (err) {
    console.error('[ocr-intake-background] Fatal:', err.message);
    writeJob(jobFile, { status: 'error', error: err.message });
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  Job file helpers
// ─────────────────────────────────────────────────────────────────────────────

function writeJob(jobFile, data) {
  try { fs.writeFileSync(jobFile, JSON.stringify(data)); } catch (e) { /* /tmp write failure is non-fatal */ }
}

// ─────────────────────────────────────────────────────────────────────────────
//  OCR parsers (progress-aware versions)
// ─────────────────────────────────────────────────────────────────────────────

async function parsePDFWithProgress(buffer, jobFile) {
  // Try text-layer first
  try {
    const pdfParse = require('pdf-parse');
    const data     = await pdfParse(buffer);
    const text     = (data.text || '').trim();
    if (text.length >= 50) {
      writeJob(jobFile, { status: 'pending', progress: 100, pagesDone: 1, pagesTotal: 1 });
      return [{ _text: text, _source: 'PDF-TEXT' }];
    }
  } catch (e) {
    console.warn('[ocr-bg] pdf-parse failed, falling back to OCR:', e.message);
  }

  // Scanned PDF — full OCR path
  const pdfjsLib        = require('pdfjs-dist/legacy/build/pdf.js');
  const Tesseract       = require('tesseract.js');
  const sharp           = require('sharp');
  const { createCanvas } = require('canvas');

  const pdfDoc   = await pdfjsLib.getDocument({ data: buffer }).promise;
  const total    = pdfDoc.numPages;
  const pageTexts = [];

  writeJob(jobFile, { status: 'pending', progress: 0, pagesDone: 0, pagesTotal: total });

  for (let pageNum = 1; pageNum <= total; pageNum++) {
    const page     = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas   = createCanvas(viewport.width, viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

    const processed = await sharp(canvas.toBuffer('image/png'))
      .greyscale()
      .linear(1.3, -(128 * 0.3))
      .toBuffer();

    const { data: { text } } = await Tesseract.recognize(processed, 'eng', {
      logger: m => {
        if (m.status === 'recognizing text') {
          const pageProgress = Math.round(m.progress * 100);
          const overall      = Math.round(((pageNum - 1 + m.progress) / total) * 100);
          writeJob(jobFile, {
            status:     'pending',
            progress:   overall,
            pagesDone:  pageNum - 1,
            pagesTotal: total,
            pagePct:    pageProgress,
          });
        }
      },
    });

    pageTexts.push(text);
    writeJob(jobFile, {
      status:     'pending',
      progress:   Math.round((pageNum / total) * 100),
      pagesDone:  pageNum,
      pagesTotal: total,
    });
  }

  return [{ _text: pageTexts.join('\n\n'), _source: 'PDF-OCR', _pages: total }];
}

async function parseImageWithProgress(buffer, jobFile) {
  const Tesseract = require('tesseract.js');
  const sharp     = require('sharp');

  writeJob(jobFile, { status: 'pending', progress: 0, pagesDone: 0, pagesTotal: 1 });

  const processed = await sharp(buffer)
    .greyscale()
    .linear(1.3, -(128 * 0.3))
    .toBuffer();

  const { data: { text } } = await Tesseract.recognize(processed, 'eng', {
    logger: m => {
      if (m.status === 'recognizing text') {
        writeJob(jobFile, {
          status:     'pending',
          progress:   Math.round(m.progress * 100),
          pagesDone:  0,
          pagesTotal: 1,
          pagePct:    Math.round(m.progress * 100),
        });
      }
    },
  });

  return [{ _text: text, _source: 'IMAGE-OCR' }];
}

// ─────────────────────────────────────────────────────────────────────────────
//  Multipart parser (copied from search-prices.js — self-contained)
// ─────────────────────────────────────────────────────────────────────────────

function extractMultipartFile(event) {
  const body = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64')
    : Buffer.from(event.body || '', 'utf8');

  const ct = event.headers['content-type'] || '';
  const boundaryMatch = ct.match(/boundary=([^\s;]+)/i);
  if (!boundaryMatch) throw new Error('No multipart boundary found in Content-Type header');

  const boundary = Buffer.from('--' + boundaryMatch[1]);
  const parts    = splitBuffer(body, boundary);

  for (const part of parts) {
    const headerEnd = indexOfSequence(part, Buffer.from('\r\n\r\n'));
    if (headerEnd === -1) continue;

    const headerStr     = part.slice(0, headerEnd).toString('utf8');
    if (!headerStr.includes('filename=')) continue;

    const filenameMatch = headerStr.match(/filename="([^"]+)"/i);
    const ctMatch       = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);
    const filename      = filenameMatch ? filenameMatch[1] : 'upload';
    const mimeType      = ctMatch ? ctMatch[1].trim() : '';
    const fileData      = part.slice(headerEnd + 4);
    const trimmed       = fileData.slice(0, fileData.length - 2);
    return { filename, buffer: trimmed, mimeType };
  }

  throw new Error('No file found in multipart body');
}

function splitBuffer(buf, separator) {
  const parts = [];
  let start = 0;
  while (start < buf.length) {
    const idx = indexOfSequence(buf, separator, start);
    if (idx === -1) { parts.push(buf.slice(start)); break; }
    if (idx > start) parts.push(buf.slice(start, idx));
    start = idx + separator.length;
    if (buf[start] === 0x0d && buf[start + 1] === 0x0a) start += 2;
  }
  return parts.filter(p => p.length > 0);
}

function indexOfSequence(buf, seq, start = 0) {
  outer: for (let i = start; i <= buf.length - seq.length; i++) {
    for (let j = 0; j < seq.length; j++) {
      if (buf[i + j] !== seq[j]) continue outer;
    }
    return i;
  }
  return -1;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Pipeline helpers — loaded from search-prices.js exports.pipeline
//  Single source of truth: all transform logic lives in search-prices.js.
//  esbuild will bundle both files independently, so this require() resolves
//  at build time to the same source module.
// ─────────────────────────────────────────────────────────────────────────────

const {
  filterDocumentNoise,
  extractLineItems,
  mergeMultiLineDescriptions,
  classifyRow,
  buildHierarchyTree,
  extractFromTableRow,
  extractFromFreeText,
  applyLabourAndSplit,
} = require('./search-prices').pipeline;
