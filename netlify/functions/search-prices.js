/* KHUTHADZO SUPPLIES — Research & pricing endpoint */

async function llmExtract(description) {
  const openai = process.env.OPENAI_API_KEY, mistral = process.env.MISTRAL_API_KEY;
  if (!openai && !mistral) return null;
  const url = openai ? "https://api.openai.com/v1/chat/completions" : "https://api.mistral.ai/v1/chat/completions";
  const model = openai ? "gpt-4o-mini" : "mistral-small-latest"; // FIX: was "open-mistral-3b" (invalid)
  const key = openai || mistral;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
      body: JSON.stringify({
        model, response_format: { type: "json_object" },
        messages: [{ role: "user", content: `Return JSON {product, grade, unit, quantity} from: "${description}"` }]
      })
    });
    const d = await r.json();
    if (!d.choices || !d.choices[0]) return null; // guard against API error response
    return JSON.parse(d.choices[0].message.content);
  } catch (e) { return null; }
}

// Heuristic block parser fallback
function heuristic(text) {
  const m = String(text).match(/(each|m)(\d+)/i);
  if (!m) return null;
  if (m[1].toLowerCase() === "each") return { quantity: 1, unit: "each" };
  const d = m[2];
  return d.length >= 3 ? { quantity: parseInt(d.slice(1), 10), unit: "square metre" } : { quantity: parseInt(d, 10), unit: "linear metre" };
}

async function scrapeWithFallback(query) {
  const flare = process.env.FLARESOLVERR_URL;
  if (flare) {
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
      const r = await fetch(flare, {
        method: "POST", signal: ctrl.signal, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: "request.get", url: "https://www.builders.co.za/search/?text=" + encodeURIComponent(query), maxTimeout: 20000 })
      });
      clearTimeout(t);
      const d = await r.json();
      const priceMatch = (d.solution?.response || "").match(/R\s?([\d,]+\.\d{2})/);
      if (priceMatch) return { price: parseFloat(priceMatch[1].replace(/,/g, "")), source: "Builders Warehouse", url: "https://www.builders.co.za/search/?text=" + encodeURIComponent(query) };
    } catch (e) {}
  }
  return null;
}

export default async (req) => {
  const { query, item } = await req.json();
  // FIX: capture structured result and include it in response
  const structured = await llmExtract(item?.description) || heuristic(item?.description);
  const result = await scrapeWithFallback(query);
  if (result) return Response.json({ ...result, structured });
  return Response.json({
    price: null, source: null, url: null,
    structured,
    fallbackLinks: [
      "https://www.builders.co.za/search/?text=" + encodeURIComponent(query),
      "https://www.voltex.co.za/catalogsearch/result/?q=" + encodeURIComponent(query),
      "https://www.takealot.com/all?qsearch=" + encodeURIComponent(query),
      "https://za.rs-online.com/web/c/?searchTerm=" + encodeURIComponent(query)
    ]
  });
};

export const config = { path: "/.netlify/functions/search-prices", method: "POST" };
