/* KHUTHADZO SUPPLIES — Background OCR for large/scanned files (15-min limit) */
import { getStore } from "@netlify/blobs";

export default async (req) => {
  const { jobId, contentBase64 } = await req.json();
  const store = getStore("ocr-jobs");
  const buf = Buffer.from(contentBase64, "base64");

  try {
    // pdfjs-dist needs a canvas factory in Node — use the 'canvas' npm package
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const { createCanvas } = await import("canvas");
    const sharp = (await import("sharp")).default;
    const { createWorker } = await import("tesseract.js");

    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
    const worker = await createWorker("eng");
    let fullText = "";

    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 2 });

      // Rasterise the page to a canvas using Node canvas
      const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx, viewport }).promise;

      // Convert to PNG buffer, greyscale + contrast boost for better OCR
      const rawPng = canvas.toBuffer("image/png");
      const png = await sharp(rawPng).greyscale().linear(1.3, 0).png().toBuffer();

      const { data } = await worker.recognize(png);
      fullText += data.text + "\n";

      await store.setJSON(jobId, { progress: Math.round((p / doc.numPages) * 100), done: false });
    }
    await worker.terminate();

    const rows = fullText.split(/\r?\n/).map(l => {
      const x = l.split(/\s{2,}/);
      return { item_no: x[0], description: x[1], unit: x[2], quantity: x[3], classification: "line_item" };
    });

    await store.setJSON(jobId, {
      progress: 100, done: true,
      result: {
        raw: fullText.slice(0, 5000),
        format: "flat RFQ pricing schedule",
        intelligence: { format: "flat RFQ pricing schedule", trades: ["BIBC General Building"], context: [], products: [], uncertain: true },
        items: rows.filter(r => r.unit),
        excluded: []
      }
    });
  } catch (e) {
    await store.setJSON(jobId, {
      progress: 100, done: true,
      error: String(e),
      result: { items: [], excluded: [], intelligence: {} }
    });
  }
  return new Response("OK");
};

export const config = { path: "/.netlify/functions/ocr-intake-background", method: "POST" };
