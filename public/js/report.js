'use strict';

function renderReport() {
  renderBanner();
  renderMetrics();
  renderSummaryTab();
  renderBOQTab();
  renderPricesTab();
  renderQuoteTab();
  renderLabourTab();
  renderComplianceTab();
  setStage('stage-report');
}

function renderBanner() {
  const total = (bestTotal() + labourTotal()) * (1 + meta.vat);
  document.getElementById('rb-title').textContent = meta.title || 'BOQ Price Analysis Report';
  document.getElementById('rb-sub').textContent   = `Morambol Supplies${meta.rfq ? ' — ' + meta.rfq : ''} — Competitive Tender Report`;
  document.getElementById('rb-amount').textContent = fmtR(total);
}

function renderMetrics() {
  const matSub  = bestTotal();
  const labSub  = labourTotal();
  const combined = matSub + labSub;
  const boqSub  = boqItems.reduce((s,i) => s + (i.price || (i.rate ? i.rate * i.qty : 0)), 0);
  const saving  = boqSub > 0 ? ((boqSub - combined) / boqSub * 100) : null;
  const savingStr = saving !== null ? `${saving > 0 ? '-' : '+'}${Math.abs(saving).toFixed(1)}%` : 'N/A';
  document.getElementById('metrics-row').innerHTML = `
    <div class="m-card"><div class="m-label">Items Analysed</div><div class="m-value navy">${boqItems.length}</div><div class="m-sub">line items from BOQ</div></div>
    <div class="m-card"><div class="m-label">Avg. vs BOQ</div><div class="m-value ${saving !== null && saving > 0 ? 'green' : ''}">${savingStr}</div><div class="m-sub">using best-price suppliers</div></div>
    <div class="m-card"><div class="m-label">Materials Subtotal</div><div class="m-value navy">${fmtR(matSub)}</div><div class="m-sub">excl. 15% VAT</div></div>
    <div class="m-card"><div class="m-label">Labour Subtotal</div><div class="m-value ${labSub > 0 ? 'gold' : ''}">${fmtR(labSub)}</div><div class="m-sub">${labSub > 0 ? Object.keys(labourData).length + ' labour items' : 'no labour items'}</div></div>
    <div class="m-card"><div class="m-label">Total incl. VAT</div><div class="m-value navy">${fmtR(combined * 1.15)}</div><div class="m-sub">tender submission value</div></div>
    <div class="m-card"><div class="m-label">Suppliers Searched</div><div class="m-value gold">${Object.keys(priceData).length > 0 ? Math.round(Object.values(priceData).reduce((s,d) => s + (d?.suppliers?.length||0), 0) / Object.keys(priceData).length) : 0}</div><div class="m-sub">avg per material item, SA scoped</div></div>
  `;
}

function renderSummaryTab() {
  const panel = document.getElementById('summary-content');
  if (!panel) return;
  const matSub = bestTotal(), labSub = labourTotal();
  const lmHTML = `<div class="lm-split-card">
    <div class="lm-card mat"><div class="lm-val" style="color:var(--green)">${fmtR(matSub)}</div><div class="lm-label">Materials Subtotal (excl. VAT)</div><div style="font-size:11px;color:var(--text3);margin-top:4px">${boqItems.filter(i=>!i.isLabour).length} material items</div></div>
    <div class="lm-card lab"><div class="lm-val" style="color:var(--amber)">${fmtR(labSub)}</div><div class="lm-label">Labour Subtotal (excl. VAT)</div><div style="font-size:11px;color:var(--text3);margin-top:4px">${boqItems.filter(i=>i.isLabour).length} labour items</div></div>
  </div>`;
  const catGroups = {};
  boqItems.forEach(item => {
    const cat = item.cat || item.category || 'Unclassified';
    if (!catGroups[cat]) catGroups[cat] = { items:[], matTotal:0, labTotal:0 };
    catGroups[cat].items.push(item);
    if (item.isLabour || item.item_type === 'labour') {
      catGroups[cat].labTotal += labourData[item.no]?.totalCost || 0;
    } else {
      const d = priceData[item.no];
      if (d?.suppliers?.length) catGroups[cat].matTotal += d.suppliers[d.bestIdx].price * (item.qty||1);
    }
  });
  const catHTML = Object.entries(catGroups).map(([cat, g]) => {
    const subtotal = g.matTotal + g.labTotal;
    return `<div class="cat-group"><div class="cat-group-header"><span class="cat-group-name">${esc(cat)}</span><span class="cat-group-sub">${g.items.length} items &nbsp;·&nbsp; ${fmtR(subtotal)}</span></div></div>`;
  }).join('');
  const flagged = boqItems.filter(i => i.incomplete || i.cat === 'Unclassified' || i.category === 'Unclassified');
  const flaggedHTML = flagged.length ? `<div class="flagged-section"><div class="flagged-title">⚠ ${flagged.length} Item(s) Need Attention</div>${flagged.map(i => `<div class="flagged-row"><span class="item-no">${esc(i.no||i.item_no||'')}</span><span style="flex:1">${esc(i.desc||i.description||'')}</span>${i.incomplete ? '<span class="flag-incomplete">INCOMPLETE</span>' : ''}${(i.cat==='Unclassified'||i.category==='Unclassified') ? '<span class="flag-unclassified">UNCLASSIFIED</span>' : ''}</div>`).join('')}</div>` : '';
  const saiItems = boqItems.filter(i => i._split);
  const saiParents = {};
  saiItems.forEach(i => { const p = (i.no||'').replace(/[ab]$/,''); if (!saiParents[p]) saiParents[p]=[]; saiParents[p].push(i); });
  const saiHTML = Object.keys(saiParents).length ? `<div class="sai-section"><div class="sai-title">🔀 Supply-and-Install Splits (${Object.keys(saiParents).length} items)</div>${Object.entries(saiParents).map(([pNo, children]) => `<div class="sai-row"><strong>${esc(pNo)}</strong> split into: ${children.map(c => { const matD=priceData[c.no]; const labD=labourData[c.no]; const val=matD?.suppliers?.[matD.bestIdx] ? fmtR(matD.suppliers[matD.bestIdx].price*c.qty) : labD?.totalCost ? fmtR(labD.totalCost) : '—'; return `<span style="margin-left:12px">${esc(c.no)} [${c.item_type}] ${val} ← ${esc((c.desc||'').substring(0,50))}</span>`; }).join('<br>')}</div>`).join('')}</div>` : '';
  panel.innerHTML = lmHTML + renderLabourSummaryPanel() + `<div style="margin-bottom:16px"><h3 style="margin-bottom:12px;color:var(--navy)">Category Breakdown</h3>${catHTML}</div>` + flaggedHTML + saiHTML;
}

function renderLabourSummaryPanel() {
  const labourItems = boqItems.filter(i => i.isLabour || i.item_type === 'labour');
  if (!labourItems.length) return '';
  const tradeMap = {};
  labourItems.forEach(item => {
    const trade = item._labour_trade || 'Unknown', unit = item.unit || '';
    const key = `${trade}||${unit}`;
    if (!tradeMap[key]) tradeMap[key] = { trade, hourlyRate:item._hourly_rate||'—', unit, labourNote:item._labour_note||'', labourBasis:item._labour_basis||'', unitRate:item.unit_rate||null, count:0 };
    tradeMap[key].count++;
  });
  const rows = Object.values(tradeMap).map(t => {
    const basisLabel = { productive_output:'Productive output', duration_lookup:'Task duration', hourly_direct:'Hourly direct', day_rate:'Day rate', fallback:'⚠ Fallback — review' }[t.labourBasis] || t.labourBasis;
    const confClass = t.labourBasis === 'productive_output' ? 'high' : t.labourBasis === 'fallback' ? 'low' : 'medium';
    return `<tr><td style="font-weight:600">${esc(t.trade)}</td><td>${t.hourlyRate !== '—' ? fmtR(t.hourlyRate) + '/hr' : '—'}</td><td><span class="unit-tag">${esc(t.unit)}</span></td><td style="font-size:11px;color:var(--text2)">${esc(basisLabel)}</td><td style="font-size:11px">${t.unitRate ? fmtR(t.unitRate) + '/' + (t.unit||'unit') : '—'}</td><td style="font-size:11px;color:var(--text3)">${esc(t.labourNote.substring(0,55))}${t.labourNote.length>55?'…':''}</td><td style="text-align:center"><span class="labour-conf-${confClass}">${confClass.toUpperCase()}</span></td><td style="text-align:center">${t.count}</td></tr>`;
  }).join('');
  return `<div class="labour-summary-panel" style="margin-bottom:20px"><button class="labour-summary-toggle" onclick="this.nextElementSibling.classList.toggle('open')"><h3>⚒ Labour Rate Assumptions — ${Object.keys(tradeMap).length} trade/unit combinations</h3><span>Click to expand / collapse</span></button><div class="labour-summary-body"><table class="labour-summary"><thead><tr><th>Trade</th><th>Hourly Rate</th><th>Unit</th><th>Conversion Method</th><th>Unit Rate</th><th>Basis Detail</th><th>Confidence</th><th>Items</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function renderBOQTab() {
  const tbody = document.getElementById('boq-tbody');
  tbody.innerHTML = '';
  let lastSection = '', lastSubsec = '', sub = 0;
  boqItems.forEach(item => {
    const section = item.section_name || item.cat || '';
    const subsec  = item.subsection_name || '';
    if (section && section !== lastSection) {
      lastSection = section; lastSubsec = '';
      const tr = document.createElement('tr');
      tr.className = 'sec-hdr'; tr.style.cssText = 'background:var(--navy)';
      tr.innerHTML = `<td colspan="8" style="color:var(--gold);font-weight:700;letter-spacing:.6px">▸ ${esc(section)}</td>`;
      tbody.appendChild(tr);
    }
    if (subsec && subsec !== lastSubsec) {
      lastSubsec = subsec;
      const tr = document.createElement('tr');
      tr.className = 'sec-hdr';
      tr.innerHTML = `<td colspan="8" style="padding-left:22px">↳ ${esc(subsec)}</td>`;
      tbody.appendChild(tr);
    }
    const lineTotal = item.price || (item.rate ? +(item.rate * item.qty).toFixed(2) : null);
    if (lineTotal) sub += lineTotal;
    const { bg, fg } = catColors(item.cat || item.category || 'Other');
    const ctxNote = item.context_note || '';
    const tr = document.createElement('tr');
    tr.dataset.cat  = item.cat || item.category || '';
    tr.dataset.desc = (item.desc || '').toLowerCase();
    tr.innerHTML = `
      <td><span class="item-no">${esc(item.no||item.item_no||'')}</span></td>
      <td>${esc(item.desc||item.description||'')}${ctxNote ? `<div class="ctx-note" title="${esc(ctxNote)}">${esc(ctxNote.substring(0,50))}</div>` : ''}</td>
      <td><span class="unit-tag">${esc(item.unit||'')}</span></td>
      <td style="text-align:right">${item.qty||item.quantity||0}</td>
      <td style="text-align:right">${item.rate ? fmtR(item.rate) : '<span class="tbc">TBC</span>'}</td>
      <td style="text-align:right">${lineTotal ? fmtR(lineTotal) : '<span class="tbc">TBC</span>'}</td>
      <td><span class="cat-tag" style="background:${bg};color:${fg}">${esc(item.cat||item.category||'')}</span></td>`;
    tbody.appendChild(tr);
  });
  document.getElementById('boq-footer').innerHTML = `Subtotal: <strong>${fmtR(sub)}</strong> &nbsp;|&nbsp; VAT (15%): <strong>${fmtR(sub * .15)}</strong> &nbsp;|&nbsp; Total: <strong>${fmtR(sub * 1.15)}</strong>`;
}

function renderPricesTab() {
  const sub    = bestTotal();
  const boqSub = boqItems.reduce((s,i) => s + (i.price || 0), 0);
  const saved  = boqSub > sub ? boqSub - sub : 0;
  document.getElementById('price-metrics').innerHTML = `
    <div class="m-card"><div class="m-label">Total saving vs BOQ</div><div class="m-value green">${fmtR(saved)}</div><div class="m-sub">${boqSub > 0 ? ((saved/boqSub)*100).toFixed(1) + '% reduction' : 'vs client BOQ'}</div></div>
    <div class="m-card"><div class="m-label">Best-price subtotal</div><div class="m-value navy">${fmtR(sub)}</div><div class="m-sub">materials, excl. labour &amp; VAT</div></div>
    <div class="m-card"><div class="m-label">Data source</div><div class="m-value gold" style="font-size:14px">Web Scraping</div><div class="m-sub">Serper + FlareSolverr, ZA</div></div>
  `;
  const container = document.getElementById('price-cards');
  container.innerHTML = '';
  boqItems.forEach(item => {
    const d = priceData[item.no];
    if (!d || !d.suppliers?.length) return;
    const bestIdx = d.bestIdx;
    const minP = Math.min(...d.suppliers.filter(s=>s.available).map(s=>s.price));
    const maxP = Math.max(...d.suppliers.map(s=>s.price));
    const saving = item.rate && d.savingPct > 0 ? d.savingPct : null;
    const suppCards = d.suppliers.map((s, i) => {
      const isBest = i === bestIdx && s.available;
      const barW = maxP > minP ? Math.round((1-(s.price-minP)/(maxP-minP+0.001))*100) : 100;
      return `<div class="sup-card${isBest?' best':''}">
        ${isBest ? '<span class="best-badge">Best price</span>' : ''}
        <div class="sup-name">${esc(s.name)}</div><div class="sup-price">${fmtR(s.price)}</div>
        <div class="sup-unit">per ${item.unit||'unit'}</div><div class="sup-total">Total: ${fmtR(s.price*item.qty)}</div>
        <div class="sup-stars">${s.stars}</div>
        <div class="sup-avail ${s.available?'avail-y':'avail-n'}">${s.available?'✓ In stock':'✗ Check availability'}</div>
        <a class="sup-link" href="${s.url}" target="_blank" rel="noopener">${s.url.replace(/^https?:\/\//,'').substring(0,35)}</a>
        ${s.note ? `<div class="sup-note">${esc(s.note)}</div>` : ''}
        <div class="pbar"><div class="pbar-fill" style="width:${barW}%"></div></div>
      </div>`;
    }).join('');
    const div = document.createElement('div');
    div.className = 'price-card';
    div.id = 'pc-' + (item.no||'').replace(/\./g,'_');
    div.innerHTML = `<div class="pc-head"><div style="flex:1;min-width:0">
      <div class="pc-title">${esc(item.no)} — ${esc(item.desc)}</div>
      <div class="pc-meta">Qty: <strong>${item.qty}</strong> ${item.unit}${item.rate ? ' &nbsp;·&nbsp; BOQ rate: <strong>'+fmtR(item.rate)+'</strong>' : ' &nbsp;·&nbsp; BOQ rate: TBC'}</div>
      ${d.marketNote ? `<div class="pc-market">${esc(d.marketNote)}</div>` : ''}
    </div>${saving ? `<span class="save-chip">Save ${saving}%</span>` : ''}</div>
    <div class="sup-grid">${suppCards}</div>
    <div class="rec-box"><div class="rec-icon"><svg width="11" height="11" viewBox="0 0 12 12"><path d="M1.5 6l3 3 6-6"/></svg></div><div class="rec-text">${d.recommendation}</div></div>`;
    container.appendChild(div);
  });
}

function renderQuoteTab() {
  const tbody = document.getElementById('qt-tbody');
  const tfoot = document.getElementById('qt-tfoot');
  tbody.innerHTML = '';
  let matSub = 0, boqSub = 0;

  boqItems.forEach(item => {
    if (item.isLabour && !/supply/i.test(item.desc)) return;
    const d = priceData[item.no];
    if (!d?.suppliers?.length) return;
    const best      = d.suppliers[d.bestIdx];
    const lineTotal = +(best.price * item.qty).toFixed(2);
    matSub += lineTotal;
    const boqLine = item.price || (item.rate ? +(item.rate * item.qty).toFixed(2) : null);
    if (boqLine) boqSub += boqLine;
    const diff = boqLine ? +((lineTotal - boqLine) / boqLine * 100).toFixed(1) : null;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="item-no">${esc(item.no||item.item_no||'')}</span></td>
      <td style="font-size:12px">${esc(item.desc||item.description||'')}</td>
      <td style="text-align:center"><span class="unit-tag">${esc(item.unit||'')}</span></td>
      <td style="text-align:right">${item.qty||item.quantity||0}</td>
      <td style="font-size:12px;font-weight:600">${esc(best.name)}</td>
      <td style="text-align:right">${fmtR(best.price)}</td>
      <td style="text-align:right;font-weight:700">${fmtR(lineTotal)}</td>
      <td style="text-align:right;font-size:11px">${diff !== null ? diff < 0 ? `<span class="hi-g">${diff.toFixed(1)}%</span>` : `<span class="hi-r">+${diff.toFixed(1)}%</span>` : '<span class="tbc2">N/A</span>'}</td>`;
    tbody.appendChild(tr);
  });

  const labourLineItems = boqItems.filter(i => i.isLabour);
  let labSub = 0;

  if (labourLineItems.length) {
    const divRow = document.createElement('tr');
    divRow.className = 'labour-section-hdr';
    divRow.innerHTML = `<td colspan="8">⚒ Labour &amp; Installation — Regulated SA Rates</td>`;
    tbody.appendChild(divRow);

    labourLineItems.forEach(item => {
      const d = labourData[item.no];
      if (!d) return;
      const lineTotal   = d.totalCost || 0;
      labSub += lineTotal;
      const boqLine     = item.price || (item.rate ? +(item.rate * item.qty).toFixed(2) : null);
      if (boqLine) boqSub += boqLine;
      const diff        = boqLine && lineTotal ? +((lineTotal - boqLine) / boqLine * 100).toFixed(1) : null;
      const labourNote  = item._labour_note || (d.authority ? `${d.authority} @ R${d.hourlyRate}/hr` : '');
      const labourBasis = item._labour_basis || 'regulated';
      const confClass   = labourBasis === 'productive_output' ? 'high' : labourBasis === 'duration_lookup' ? 'medium' : labourBasis === 'hourly_direct' ? 'medium' : 'low';
      const isReview    = labourBasis === 'fallback';
      const unitRateDisplay = item.unit_rate ? fmtR(item.unit_rate) + `/${item.unit||'unit'}` : (d.hourlyRate ? fmtR(d.hourlyRate) + '/hr' : '—');
      const tr = document.createElement('tr');
      if (isReview) tr.classList.add('labour-review-flag');
      tr.style.background = '#fffbeb';
      tr.innerHTML = `
        <td><span class="item-no">${esc(item.no||item.item_no||'')}</span></td>
        <td style="font-size:12px">${esc(item.desc||item.description||'')}${item._labour_trade ? `<div class="labour-basis-label">${esc(item._labour_trade)}</div>` : ''}</td>
        <td style="text-align:center"><span class="unit-tag">${esc(item.unit||'')}</span></td>
        <td style="text-align:right">${item.qty||item.quantity||0}</td>
        <td style="font-size:11px;color:var(--amber-text);font-weight:600">${esc(item._labour_trade || d.authority || '')}</td>
        <td style="text-align:right">${unitRateDisplay}${labourNote ? `<div class="labour-basis-label" title="${esc(labourNote)}">${esc(labourNote.substring(0,45))}${labourNote.length>45?'…':''}</div>` : ''}<span class="labour-conf-${confClass}">${confClass.toUpperCase()}</span>${isReview ? ' <span title="Review manually">⚠</span>' : ''}</td>
        <td style="text-align:right;font-weight:700">${lineTotal ? fmtR(lineTotal) : '<span class="tbc2">0.00</span>'}</td>
        <td style="text-align:right;font-size:11px">${diff !== null ? diff < 0 ? `<span class="hi-g">${diff.toFixed(1)}%</span>` : `<span class="hi-r">+${diff.toFixed(1)}%</span>` : '<span class="tbc2">N/A</span>'}</td>`;
      tbody.appendChild(tr);
    });
  }

  const combined   = matSub + labSub;
  const vat        = +(combined * meta.vat).toFixed(2);
  const total      = +(combined + vat).toFixed(2);
  const totalSaved = boqSub > combined ? +(boqSub - combined).toFixed(2) : 0;

  if (labourLineItems.length) {
    tfoot.innerHTML = `
      <tr><td colspan="6" style="text-align:right;color:var(--text2)">Materials Subtotal (excl. VAT)</td><td style="text-align:right;font-weight:700">${fmtR(matSub)}</td><td></td></tr>
      <tr><td colspan="6" style="text-align:right;color:var(--amber-text);font-weight:600">Labour Subtotal (excl. VAT)</td><td style="text-align:right;font-weight:700;color:var(--amber-text)">${fmtR(labSub)}</td><td></td></tr>
      <tr><td colspan="6" style="text-align:right;color:var(--text2)">Combined Project Subtotal (excl. VAT)</td><td style="text-align:right;font-weight:700">${fmtR(combined)}</td><td></td></tr>
      <tr><td colspan="6" style="text-align:right;color:var(--text2)">VAT @ 15%</td><td style="text-align:right;color:var(--text2)">${fmtR(vat)}</td><td></td></tr>
      ${totalSaved > 0 ? `<tr><td colspan="6" style="text-align:right;color:var(--green);font-weight:600">Total saving vs BOQ</td><td style="text-align:right;color:var(--green);font-weight:700">${fmtR(totalSaved)}</td><td></td></tr>` : ''}
      <tr class="final"><td colspan="6" style="text-align:right">TOTAL (incl. 15% VAT)</td><td style="text-align:right">${fmtR(total)}</td><td></td></tr>`;
    document.getElementById('quote-note').innerHTML = `<strong>Morambol Supplies — Competitive Tender Price.</strong> Material unit rates sourced from live web scraping of South African supplier sites (Serper API + FlareSolverr, ZA-scoped). Labour rates sourced from MBSA / BIBC / CETA / DoEL / PSIRA / ECSA as applicable. All amounts in ZAR. Prices subject to final confirmation at time of order.`;
  } else {
    const vat2   = +(matSub * meta.vat).toFixed(2);
    const total2 = +(matSub + vat2).toFixed(2);
    const ts2    = boqSub > matSub ? +(boqSub - matSub).toFixed(2) : 0;
    tfoot.innerHTML = `
      <tr><td colspan="6" style="text-align:right;color:var(--text2)">Subtotal (excl. VAT)</td><td style="text-align:right;font-weight:700">${fmtR(matSub)}</td><td></td></tr>
      <tr><td colspan="6" style="text-align:right;color:var(--text2)">VAT @ 15%</td><td style="text-align:right;color:var(--text2)">${fmtR(vat2)}</td><td></td></tr>
      ${ts2 > 0 ? `<tr><td colspan="6" style="text-align:right;color:var(--green);font-weight:600">Total saving vs BOQ</td><td style="text-align:right;color:var(--green);font-weight:700">${fmtR(ts2)}</td><td></td></tr>` : ''}
      <tr class="final"><td colspan="6" style="text-align:right">TOTAL (incl. 15% VAT)</td><td style="text-align:right">${fmtR(total2)}</td><td></td></tr>`;
    document.getElementById('quote-note').innerHTML = `<strong>Morambol Supplies — Competitive Tender Price.</strong> Unit rates are sourced from live web scraping of South African supplier sites (Serper API + FlareSolverr, ZA-scoped). All amounts are in South African Rand (ZAR) and exclude installation labour unless stated. Prices are subject to final supplier confirmation and stock availability at time of order.`;
  }
}

function renderLabourTab() {
  const panel = document.getElementById('tp-labour');
  const labourItems = boqItems.filter(i => i.isLabour);
  if (!labourItems.length) {
    panel.innerHTML = `<div class="labour-empty">⚒ No labour or installation line items were detected in this BOQ.<br><span style="font-size:12px;margin-top:8px;display:block">Labour items are identified by keywords such as "install", "terminate", "electrician", "foreman", etc.</span></div>`;
    return;
  }
  const labSub = labourTotal(), combined = bestTotal() + labSub;
  const labPct = combined > 0 ? (labSub / combined * 100).toFixed(1) : '0.0';
  const tradeCounts = {}, authCounts = {};
  labourItems.forEach(i => { tradeCounts[i.tradeCode] = (tradeCounts[i.tradeCode]||0) + 1; });
  Object.values(labourData).forEach(d => { if (d?.authority) authCounts[d.authority] = (authCounts[d.authority]||0) + 1; });
  const dominantTrade = Object.entries(tradeCounts).sort((a,b)=>b[1]-a[1])[0]?.[0] || '—';
  const dominantAuth  = Object.entries(authCounts).sort((a,b)=>b[1]-a[1])[0]?.[0] || '—';
  const ALL_AUTHS = [
    { code:'MBSA', name:'Master Builders SA' },
    { code:'BIBC', name:'Bargaining Council — Building Industry' },
    { code:'CETA', name:'Construction Education & Training Authority' },
    { code:'DoEL', name:'Dept. of Employment & Labour / NMW' },
    { code:'PSIRA', name:'Private Security Industry Regulatory Authority' },
    { code:'ECSA', name:'Engineering Council of South Africa' },
    { code:'NMW Fallback', name:'NMW Fallback (DoEL)' },
  ];
  const consultedSet = new Set(Object.values(labourData).map(d => d?.authority).filter(Boolean));
  const authHTML = ALL_AUTHS.map((a, idx) => {
    const c = consultedSet.has(a.code);
    return `<div class="auth-item${c?' consulted':''}"><div class="auth-dot" aria-hidden="true"></div><div><div class="auth-label">${idx+1}. ${a.code}</div><div class="auth-status">${c ? '✓ Consulted' : 'Not used'}</div></div></div>`;
  }).join('');
  const cardsHTML = labourItems.map(item => {
    const d = labourData[item.no];
    if (!d) return '';
    const srcLink  = d.source_url ? `<a href="${d.source_url}" target="_blank" rel="noopener">${esc(d.regulation)}</a>` : esc(d.regulation);
    const effDate  = d.effectiveDate ? new Date(d.effectiveDate).toLocaleDateString('en-ZA',{day:'numeric',month:'long',year:'numeric'}) : '—';
    return `<div class="labour-card">
      <div class="labour-card-head"><div>
        <div class="labour-card-title">${esc(item.no)} — ${esc(item.desc||item.description||'')}</div>
        <div>${(item.labourTypes||[]).map(t=>`<span class="labour-badge">${t.toUpperCase()}</span>`).join('')}<span class="labour-authority-badge">${esc(d.authority)}</span>${d.usedFallback?'<span class="labour-badge" style="background:var(--text3)">NMW FALLBACK</span>':''}</div>
      </div></div>
      <div style="overflow-x:auto"><table class="labour-rate-tbl">
        <thead><tr><th>Trade</th><th>R/hr</th><th>R/day</th><th>Est. Hours</th><th>× Oncost</th><th>Line Total</th></tr></thead>
        <tbody><tr>
          <td>${esc(item.tradeCode||'—')}</td><td>${fmtR(d.hourlyRate||0)}</td><td>${fmtR(d.dailyRate||0)}</td>
          <td>${d.qtyHours != null ? d.qtyHours.toFixed(1) : '<em style="color:var(--text3)">unmapped unit</em>'}</td>
          <td>× 1.25</td><td style="font-weight:800;color:var(--amber-text)">${d.totalCost != null ? fmtR(d.totalCost) : '—'}</td>
        </tr></tbody>
      </table></div>
      <div class="labour-reg">Regulation: ${srcLink} &nbsp;·&nbsp; Effective: ${effDate}${d.unmappedUnit?`<br><span style="color:var(--red)">⚠ Unit "${esc(item.unit)}" not in productivity table — review manually.</span>`:''}</div>
    </div>`;
  }).join('');
  panel.innerHTML = `
    <div class="metrics-row" style="margin-bottom:22px">
      <div class="m-card"><div class="m-label">Total Labour Cost</div><div class="m-value gold">${fmtR(labSub)}</div><div class="m-sub">excl. 15% VAT</div></div>
      <div class="m-card"><div class="m-label">Labour as % of Project</div><div class="m-value">${labPct}%</div><div class="m-sub">of combined project cost</div></div>
      <div class="m-card"><div class="m-label">Labour Line Items</div><div class="m-value navy">${labourItems.length}</div><div class="m-sub">detected in BOQ</div></div>
      <div class="m-card"><div class="m-label">Dominant Trade</div><div class="m-value" style="font-size:14px">${esc(dominantTrade)}</div><div class="m-sub">most frequent trade code</div></div>
      <div class="m-card"><div class="m-label">Primary Authority</div><div class="m-value" style="font-size:14px">${esc(dominantAuth)}</div><div class="m-sub">regulatory source used most</div></div>
    </div>
    <div class="auth-section-title">Regulatory Authority Hierarchy</div>
    <div class="auth-priority">${authHTML}</div>
    ${cardsHTML}`;
}

function renderComplianceTab() {
  buildOutputEditor();
  const list = document.getElementById('comp-list');
  list.innerHTML = '';
  compChecks.forEach(c => {
    const isPass = c.status === 'pass', isWarn = c.status === 'warn';
    const div = document.createElement('div');
    div.className = 'comp-row';
    div.innerHTML = `
      <div class="comp-icon ${isPass?'ci-pass':isWarn?'ci-warn':'ci-fail'}">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="${isPass?'#1a7a4a':isWarn?'#7a4d0a':'#8b1a1a'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          ${isPass?'<path d="M1.5 6l3 3 6-6"/>':isWarn?'<line x1="6" y1="2" x2="6" y2="7"/><circle cx="6" cy="9.5" r=".5" fill="currentColor"/>':'<path d="M2 2l8 8M10 2 2 10"/>'}
        </svg>
      </div>
      <div class="comp-body">
        <div class="comp-title-row">
          <span class="comp-title">${esc(c.title)}</span>
          <span class="${isPass?'s-pass':isWarn?'s-warn':'s-fail'}">${isPass?'Compliant':isWarn?'Action required':'Non-compliant'}</span>
          ${c.reg ? `<span class="comp-reg">${esc(c.reg)}</span>` : ''}
        </div>
        <div class="comp-detail">${esc(c.detail)}</div>
      </div>`;
    list.appendChild(div);
  });
  document.getElementById('comp-note').innerHTML = `<strong>South African Regulatory Compliance Review.</strong> The following checks apply to this project under SA law, standards, and procurement regulations. Items marked "Action required" must be resolved before submission. Morambol is responsible for ensuring all subcontractors and suppliers are independently compliant.`;
}
