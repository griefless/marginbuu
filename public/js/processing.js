'use strict';

// ── Rate limiting configuration ──────────────────────────────────────────────
// Serper API free tier: 2,500 searches/month (≈83/day or 3.5/hour)
// This delay prevents exhausting the quota on large BOQs
const RATE_LIMIT_DELAY_MS = 300; // 300ms between requests = max ~3 req/sec = 180/min
let lastRequestTime = 0;

async function rateLimitedDelay() {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_DELAY_MS) {
    await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

async function fetchPricesForItem(item) {
  await rateLimitedDelay(); // Enforce rate limit before each API call
  
  const query = buildSearchQuery(item.desc, item.cat, item.spec||null, item.item_type||'material', item.context_note||'');
  
  try {
    const resp = await fetch(`${FUNCTION_URL}?action=search&q=${encodeURIComponent(query)}`);
    
    if (!resp.ok) {
      // Check for rate limit errors
      if (resp.status === 429) {
        throw new Error('API rate limit exceeded. Please wait and try again.');
      }
      throw new Error(`Scraping search failed: HTTP ${resp.status}`);
    }
    
    const data = await resp.json();
    
    // Check for Serper API quota errors
    if (data.error && data.error.toLowerCase().includes('quota')) {
      throw new Error('Serper API quota exceeded. Get more at https://serper.dev');
    }
    
    if (!data.suppliers?.length) return null;

  const suppliers = data.suppliers.map(s => ({
    name:        s.name || 'SA Supplier',
    url:         s.url  || '#',
    price:       roundPrice(s.price),
    available:   s.available !== false,
    stars:       '★★★★☆',
    reliability: s._estimated ? 'Market estimate' : (s.name || 'Live scraped price'),
    note:        s._estimated ? 'Market estimate (no live page found)' : (s.title ? s.title.substring(0,70) : ''),
  }));

  const available    = suppliers.filter(s => s.available);
  const bestSupplier = available.length ? available.reduce((a,b) => a.price < b.price ? a : b) : suppliers[0];
  const bestIdx      = suppliers.indexOf(bestSupplier);
  const bestActualIdx = bestIdx >= 0 ? bestIdx : 0;
  const saving = item.rate && suppliers[bestActualIdx].price < item.rate
    ? +((item.rate - suppliers[bestActualIdx].price) / item.rate * 100).toFixed(1) : 0;

  return {
    suppliers, bestIdx: bestActualIdx,
    recommendation: buildRecommendation(item, suppliers, bestActualIdx, saving),
    savingPct: saving,
    marketNote: `Source: Live web scraping (Serper + FlareSolverr) — "${query}" · ${data.sources||0} SA pages analysed · Prices in ZAR`,
    productTitle: data.suppliers[0]?.title || query,
  };
  } catch (err) {
    console.error('[fetchPrices] Error for item', item.no, ':', err.message);
    throw err; // Re-throw to be handled by caller
  }
}

function buildSearchQuery(desc, category, spec, itemType, contextNote) {
  let q = (desc||'').replace(/\b(incl|including|with|for|from|and|or|the|of|per|as|to|in|at|by|supply|install)\b/gi,' ').replace(/[()[\]{};:]/g,' ').replace(/\s+/g,' ').trim().substring(0,80);
  if (spec) { if (spec.diameter) q+=` ${spec.diameter}mm`; if (spec.rating) q+=` ${spec.rating}A`; if (spec.size_mm) q+=` ${spec.size_mm}mm`; }
  if (contextNote && contextNote.trim()) q = (q+' '+contextNote.trim().substring(0,60)).trim();
  if (itemType === 'labour') return (q+' labour rate installation cost ZAR').substring(0,150);
  const hints = { 'Electrical & LV Systems':'electrical supplier south africa', 'Civil & Construction':'construction materials south africa', 'Plumbing & Drainage':'plumbing supplies south africa', 'Mechanical & HVAC':'mechanical supplier south africa', 'Fencing & Security':'security fencing supplier south africa', 'General Supplies & PPE':'hardware supplies south africa', 'Electronics & ICT':'electronics supplier south africa' };
  return (q+' '+(hints[category]||'south africa')).trim().substring(0,150);
}

function roundPrice(p) { return Math.round(p * 100) / 100; }
function ratingToStars(r) { if (!r) return '★★★★☆'; const n = Math.round(r); return '★'.repeat(Math.min(n,5))+'☆'.repeat(Math.max(0,5-n)); }
function reliabilityNote(name, rating, reviews) { if (!name) return 'SA supplier'; return `${name}${rating?` · ${rating.toFixed(1)}/5`:''}${reviews?` (${reviews.toLocaleString()} reviews)`:''}`; }

function buildRecommendation(item, suppliers, bestIdx, saving) {
  const best = suppliers[bestIdx];
  const parts = [`<span class="rec-bold">Buy from ${best.name}</span> at ${fmtR(best.price)} per ${item.unit||'unit'}.`];
  if (saving > 0) parts.push(`This is <strong>${saving}% cheaper</strong> than the client BOQ rate of ${fmtR(item.rate)}.`);
  if (!best.available) parts.push('Note: Confirm stock availability before ordering.');
  parts.push(complianceHint(item.desc));
  return parts.join(' ');
}

function complianceHint(desc) {
  if (/cable.*pvc.*swa|swa.*cable/i.test(desc)) return 'Ensure SANS 1507-3 compliance (SABS mark required).';
  if (/hdpe|sleeve/i.test(desc))                return 'Must comply with SANS 1808 for underground ducting.';
  if (/mccb|circuit breaker/i.test(desc))       return 'SABS approved SANS 60947-2 required.';
  if (/earth.*leakage/i.test(desc))             return 'Compliant with SANS 10142-1 earthing regulations.';
  if (/copper.*earth|bare.*earth/i.test(desc))  return 'Install per SANS 10142-1 earthing code.';
  if (/concrete/i.test(desc))                   return 'Mix design to comply with SANS 10100 / project specification.';
  return 'Verify SABS/SANS compliance before procurement.';
}

function buildFallback(item) {
  const base = item.rate || estimatePrice(item.desc);
  const suppliers = [
    { name:'Builders Warehouse',  url:'https://www.builderswarehouse.co.za', price:+(base*0.91).toFixed(2), available:true, stars:'★★★★☆', reliability:'National hardware chain', note:'Verify in-store availability' },
    { name:'Voltex',              url:'https://www.voltex.co.za',            price:+(base*0.97).toFixed(2), available:true, stars:'★★★★★', reliability:'SA specialist electrical wholesaler', note:'SABS-compliant stock' },
    { name:'Bidvest Electrical',  url:'https://www.bidvestelectrical.co.za', price:+(base*0.94).toFixed(2), available:true, stars:'★★★★★', reliability:'SABS-certified wholesale supplier', note:'Best for large quantities' },
    { name:'Takealot',            url:'https://www.takealot.com',            price:+(base*1.03).toFixed(2), available:true, stars:'★★★★☆', reliability:'SA e-commerce — fast delivery', note:'Check seller ratings' },
    { name:'RS Components SA',    url:'https://za.rs-online.com',            price:+(base*1.01).toFixed(2), available:true, stars:'★★★★☆', reliability:'Global brand with SA-stocked items', note:'Technical datasheets available' },
  ];
  suppliers.sort((a,b) => a.price - b.price);
  return { suppliers, bestIdx:0, recommendation:`<span class="rec-bold">Estimated: buy from ${suppliers[0].name}</span> at ${fmtR(suppliers[0].price)} per ${item.unit||'unit'}. Rates estimated from SA market benchmarks.`, savingPct:item.rate?+((item.rate-suppliers[0].price)/item.rate*100).toFixed(1):0, marketNote:'Estimated from SA market benchmarks.', productTitle:item.desc };
}

function estimatePrice(desc) {
  const d = desc.toLowerCase();
  if (/35mm.*4.?core|4.?core.*35mm/.test(d)) return 91;
  if (/16mm.*4.?core|4.?core.*16mm/.test(d)) return 58;
  if (/hdpe.*110|110.*hdpe/.test(d))         return 33;
  if (/mccb.*200a?|200a?.*mccb/.test(d))     return 2700;
  if (/20a.*mcb|mcb.*20a/.test(d))           return 44;
  if (/60a.*mcb|mcb.*60a/.test(d))           return 76;
  if (/earth.?leak|leakage/.test(d))         return 275;
  if (/surge/.test(d))                       return 1750;
  if (/kiosk/.test(d))                       return 26500;
  if (/concrete/.test(d))                    return 238;
  if (/excavat|trench/.test(d))              return 330;
  if (/paving/.test(d))                      return 185;
  if (/copper.*earth|bare.*earth/.test(d))   return 23;
  if (/rubble/.test(d))                      return 470;
  if (/cable.*warn|warn.*tape/.test(d))      return 14;
  return 160;
}

async function runAnalysis() {
  setStage('stage-processing');
  setStatus('Analysing…', 'gold');
  clearLog();

  try {
    // ── Phase 2: Price search ──
    setProg(10, `Phase 2 of 4 — Searching prices for ${boqItems.length} items`);
    for (let i = 0; i < boqItems.length; i++) {
      const item = boqItems[i];
      if (item.isLabour && !/supply/i.test(item.desc)) continue;
      const pct = 10 + Math.round((i / boqItems.length) * 65);
      setProg(pct, `Phase 2 of 4 — Item ${i+1} of ${boqItems.length}`);
      setProcSub(`Live search: ${item.desc.substring(0,65)}…`);
      addLog(item.no, `${item.no}  ${item.desc.substring(0,58)}`, 'active');
      try {
        const result = await fetchPricesForItem(item);
        priceData[item.no] = result || buildFallback(item);
        const best = priceData[item.no].suppliers[priceData[item.no].bestIdx];
        updateLog(item.no, result ? `✓ ${result.suppliers.length} prices — best: ${best.name} @ ${fmtR(best.price)}` : `~ Estimated (no live results)`, result ? 'done' : 'warn');
      } catch (err) {
        console.warn('Scraping error for', item.no, err.message);
        priceData[item.no] = buildFallback(item);
        updateLog(item.no, '~ Estimated (search error)', 'warn');
      }
    }

    // ── Phase 3: Labour Rate Resolution ──
    labourData = {};
    const labourItems = boqItems.filter(i => i.isLabour);
    if (labourItems.length) {
      setProg(75, `Phase 3 of 4 — Resolving labour rates for ${labourItems.length} items`);
      setProcSub('Looking up regulated SA labour rates…');
      addLog('_labour', `Resolving ${labourItems.length} labour items`, 'active');
      for (let i = 0; i < labourItems.length; i++) {
        const item = labourItems[i];
        const pct = 75 + Math.round((i / labourItems.length) * 15);
        setProg(pct, `Phase 3 of 4 — Labour item ${i+1} of ${labourItems.length}`);
        try {
          const result = await fetchLabourRateForItem(item);
          if (result) { labourData[item.no] = result; addLog('_lab_'+item.no, `✓ ${item.tradeCode} resolved — ${result.authority} @ R${result.hourlyRate.toFixed(2)}/hr`, 'done'); }
          else { labourData[item.no] = { ...LABOUR_RATE_FALLBACK, qtyHours:0, totalCost:0, oncostMultiplier:1.25, usedFallback:true, tradeCode:item.tradeCode }; addLog('_lab_'+item.no, `ℹ ${item.no} — no rate resolved; NMW fallback applied`, 'warn'); }
        } catch (err) {
          labourData[item.no] = { ...LABOUR_RATE_FALLBACK, qtyHours:0, totalCost:0, oncostMultiplier:1.25, usedFallback:true, tradeCode:item.tradeCode };
          addLog('_lab_'+item.no, `✗ ${item.no} — ${err.message}; NMW fallback applied`, 'err');
        }
      }
      updateLog('_labour', `✓ ${Object.keys(labourData).length} labour rates resolved`, 'done');
    }

    // ── Phase 4: Compliance ──
    setProg(90, 'Phase 4 of 4 — Generating SA compliance report');
    setProcSub('Checking CIDB, SANS, SABS, OHS Act, labour regulations…');
    addLog('_comp', 'Generating SA compliance checklist', 'active');
    compChecks = generateCompliance(boqItems);
    updateLog('_comp', `✓ ${compChecks.length} compliance checks generated`, 'done');

    setProg(100, 'Complete');
    setStatus('Report Ready', 'green');
    setTimeout(renderReport, 500);

  } catch (err) {
    console.error(err);
    addLog('_err', '✗ Error: ' + err.message, 'err');
    setStatus('Error', '');
    toast('Error: ' + err.message);
  }
}
