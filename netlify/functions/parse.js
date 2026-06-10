/* KHUTHADZO SUPPLIES — Document parsing endpoint */
import * as XLSX from "xlsx";
import { getStore } from "@netlify/blobs";

const HEADER_MAP = {
  no: "item_no", ref: "item_no", particulars: "description", desc: "description",
  description: "description", uom: "unit", measure: "unit", unit: "unit",
  qty: "quantity", quantity: "quantity"
};

function canonical(h) { return HEADER_MAP[String(h || "").toLowerCase().trim()] || String(h || "").toLowerCase().trim(); }

function classifyRow(r) {
  const d = (r.description || "").toLowerCase();
  const u = (r.unit || "").toString().toLowerCase();
  const hasNo = r.item_no != null && String(r.item_no).trim() !== "";
  const qty = parseFloat(r.quantity);
  if (/carried forward|brought forward|sub-total|subtotal|vat at/.test(d) || ["page", "page-", "pg"].includes(u)) return "summary";
  if (hasNo && !String(r.item_no).includes(".") && !r.unit && !r.quantity) return "section_heading";
  if (!hasNo && !r.unit && !r.quantity && (r.description || "").length > 15) return "narrative";
  if (r.unit && qty > 0) return "line_item";
  return "narrative";
}

function detectIntelligence(text) {
  const t = (text || "").toLowerCase();
  const context = [];
  if (/coastal|marine|sea/.test(t)) context.push("coastal");
  if (/national park|protected area|reserve/.test(t)) context.push("park");
  if (/24[\s-]?hour|24\/7|operational facility/.test(t)) context.push("24hr");
  if (/remote|provincial|rural/.test(t)) context.push("remote");
  const trades = [];
  if (/electric|lv |db board/.test(t)) trades.push("Specialist LV Electrical");
  if (/concrete|earthwork|excavat/.test(t)) trades.push("Civil Earthworks");
  if (/plumb|drain|sanitary/.test(t)) trades.push("Plumbing & Drainage");
  if (/aluminium|glazing|window/.test(t)) trades.push("Aluminium Glazing");
  if (!trades.length) trades.push("BIBC General Building");
  let format = "flat RFQ pricing schedule";
  if (/bill no|preliminaries|principal building agreement|asaqs/.test(t)) format = "ASAQS building BOQ";
  else if (/section a|section b|material supply|labour/.test(t)) format = "split-section engineering BOQ";
  const products = [];
  const brandRe = /\b([A-Z][a-zA-Z]+)\s+([A-Z0-9\-]{3,})\b/g; let m;
  while ((m = brandRe.exec(text || "")) && products.length < 25)
    products.push({ name: `${m[1]} ${m[2]}`, type: /or approved equivalent|or equal/.test(t) ? "equiv" : "hard" });
  return { format, trades, context, products, uncertain: format === "flat RFQ pricing schedule" };
}

function rowsToItems(rows) {
  const items = [], excluded = [];
  rows.forEach(r => {
    const cls = classifyRow(r);
    const rec = { item_no: r.item_no || "", description: r.description || "", unit: r.unit || "", quantity: r.quantity || "", classification: cls };
    if (cls === "line_item") items.push(rec); else excluded.push(rec);
  });
  return { items, excluded };
}

export default async (req) => {
  const url = new URL(req.url);

  // OCR polling
  const job = url.searchParams.get("job");
  if (job) {
    const store = getStore("ocr-jobs");
    const data = await store.get(job, { type: "json" });
    return Response.json(data || { progress: 0, done: false });
  }

  const body = await req.json();
  let rawText = "";
  let items = [], excluded = [];

  if (body.text) {
    rawText = body.text;
    const rows = body.text.split(/\r?\n/).map(line => {
      const parts = line.split(/\t|,|\s{2,}/);
      return { item_no: parts[0], description: parts[1], unit: parts[2], quantity: parts[3] };
    });
    ({ items, excluded } = rowsToItems(rows));
  } else if (body.contentBase64) {
    const buf = Buffer.from(body.contentBase64, "base64");
    const name = (body.filename || "").toLowerCase();

    if (/\.(xlsx|xls|csv)$/.test(name)) {
      const wb = XLSX.read(buf, { type: "buffer" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      const headers = json[0].map(canonical);
      const rows = json.slice(1).map(arr => { const o = {}; headers.forEach((h, i) => o[h] = arr[i]); return o; });
      rawText = rows.map(r => Object.values(r).join(" ")).join("\n");
      ({ items, excluded } = rowsToItems(rows));
    } else if (/\.docx$/.test(name)) {
      const mammoth = await import("mammoth");
      const out = await mammoth.extractRawText({ buffer: buf });
      rawText = out.value;
      const rows = rawText.split(/\r?\n/).map(l => { const p = l.split(/\s{2,}/); return { item_no: p[0], description: p[1], unit: p[2], quantity: p[3] }; });
      ({ items, excluded } = rowsToItems(rows));
    } else if (/\.pdf$/.test(name)) {
      // Digital PDF: pdf-parse. Large/scanned files → background OCR.
      if (body.size > 500 * 1024) {
        const jobId = "ocr-" + Date.now();
        const store = getStore("ocr-jobs");
        await store.setJSON(jobId, { progress: 0, done: false });
        // Fire background function (asynchronous)
        await fetch(`${url.origin}/.netlify/functions/ocr-intake-background`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId, contentBase64: body.contentBase64 })
        }).catch(() => {});
        return Response.json({ background: true, jobId });
      }
      const pdfParse = (await import("pdf-parse")).default;
      const parsed = await pdfParse(buf);
      rawText = parsed.text;
      const rows = rawText.split(/\r?\n/).map(l => { const p = l.split(/\s{2,}/); return { item_no: p[0], description: p[1], unit: p[2], quantity: p[3] }; });
      ({ items, excluded } = rowsToItems(rows));
    } else {
      // image → background OCR
      const jobId = "ocr-" + Date.now();
      const store = getStore("ocr-jobs");
      await store.setJSON(jobId, { progress: 0, done: false });
      await fetch(`${url.origin}/.netlify/functions/ocr-intake-background`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, contentBase64: body.contentBase64 })
      }).catch(() => {});
      return Response.json({ background: true, jobId });
    }
  }

  const intelligence = detectIntelligence(rawText);
  return Response.json({ raw: rawText.slice(0, 5000), format: intelligence.format, structure: intelligence.format, intelligence, items, excluded });
};

export const config = { path: "/.netlify/functions/parse", method: ["POST", "GET"] };