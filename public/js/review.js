'use strict';

function renderReviewTable(items, excluded) {
  excludedRows = excluded || [];
  buildCategoryFilter();

  const tbody         = document.getElementById('review-tbody');
  const excludedTbody = document.getElementById('excluded-tbody');
  if (!tbody) { proceedToAnalysis(); return; }
  tbody.innerHTML         = '';
  excludedTbody.innerHTML = '';

  document.getElementById('rtab-items-count').textContent   = items.length;
  document.getElementById('rtab-excluded-count').textContent = excludedRows.length;

  const incomplete   = items.filter(i => i.incomplete).length;
  const unclassified = items.filter(i => (i.cat||i.category) === 'Unclassified').length;
  const labourCount  = items.filter(i => i.isLabour || i.item_type==='labour').length;
  const splitCount   = items.filter(i => i._split).length;

  document.getElementById('review-title').textContent = `Review ${items.length} Extracted Line Items`;
  document.getElementById('review-meta').innerHTML =
    `${items.length} items &nbsp;·&nbsp;` +
    (incomplete   ? ` <span style="color:var(--warn-text)">${incomplete} incomplete</span> &nbsp;·&nbsp;` : '') +
    (unclassified ? ` <span style="color:var(--red)">${unclassified} unclassified</span> &nbsp;·&nbsp;` : '') +
    ` ${labourCount} labour &nbsp;·&nbsp; ${splitCount} S&amp;I splits` +
    (excludedRows.length ? ` &nbsp;·&nbsp; <span style="color:var(--text3)">${excludedRows.length} excluded</span>` : '');

  let lastSection = '', lastSubsection = '';
  items.forEach((item, idx) => {
    const cat     = item.cat || item.category || 'Unclassified';
    const section = item.section_name    || '';
    const subsec  = item.subsection_name || '';
    const ctxNote = item.context_note    || '';

    if (section && section !== lastSection) {
      lastSection = section; lastSubsection = '';
      const sepTr = document.createElement('tr');
      sepTr.className = 'review-section-hdr';
      sepTr.innerHTML = `<td colspan="10">▸ ${esc(section)}</td>`;
      tbody.appendChild(sepTr);
    }
    if (subsec && subsec !== lastSubsection) {
      lastSubsection = subsec;
      const subTr = document.createElement('tr');
      subTr.className = 'review-subsec-hdr';
      subTr.innerHTML = `<td colspan="10" style="padding-left:22px">↳ ${esc(subsec)}</td>`;
      tbody.appendChild(subTr);
    }

    const flags = [];
    if (item.incomplete)                            flags.push(`<span class="flag-incomplete">INCOMPLETE</span>`);
    if (item.isLabour || item.item_type==='labour') flags.push(`<span class="flag-labour">LABOUR</span>`);
    if (item._split)                                flags.push(`<span class="flag-split">S&amp;I</span>`);
    if (cat === 'Unclassified')                     flags.push(`<span class="flag-unclassified">UNCLASSIFIED</span>`);
    const confColor = (item.classification_confidence||'high')==='high' ? 'var(--green)' : 'var(--warn-text)';

    const tr = document.createElement('tr');
    tr.dataset.cat = cat;
    tr.dataset.idx = String(idx);
    tr.innerHTML = `
      <td><span class="item-no">${esc(item.no||item.item_no||String(idx+1))}</span></td>
      <td style="font-size:11px;color:var(--text3)">${esc(section.substring(0,18))}</td>
      <td><input type="text" value="${esc(item.desc||item.description||'')}"
        onchange="boqItems[${idx}].desc=this.value;boqItems[${idx}].description=this.value"
        style="min-width:200px"></td>
      <td><span class="ctx-note" title="${esc(ctxNote)}">${esc(ctxNote.substring(0,40))||'—'}</span></td>
      <td>
        <select onchange="boqItems[${idx}].cat=this.value;boqItems[${idx}].category=this.value;this.closest('tr').dataset.cat=this.value">
          ${ALL_CATEGORIES.map(c=>`<option value="${c}"${c===cat?' selected':''}>${c}</option>`).join('')}
        </select>
      </td>
      <td style="text-align:center">
        <input type="text" value="${esc(item.unit||'')}" style="width:46px;text-align:center"
          onchange="boqItems[${idx}].unit=this.value">
      </td>
      <td style="text-align:right">
        <input type="number" value="${item.qty||item.quantity||0}" style="width:54px;text-align:right"
          onchange="boqItems[${idx}].qty=parseFloat(this.value)||0;boqItems[${idx}].quantity=parseFloat(this.value)||0">
      </td>
      <td>
        <select onchange="boqItems[${idx}].item_type=this.value">
          <option value="material"${(item.item_type||'material')==='material'?' selected':''}>Material</option>
          <option value="labour"${item.item_type==='labour'?' selected':''}>Labour</option>
          <option value="split"${item._split?' selected':''}>S&amp;I Split</option>
        </select>
      </td>
      <td style="font-size:10px;font-weight:700;color:${confColor}">
        ${(item.classification_confidence||'high').toUpperCase()}
      </td>
      <td>${flags.join(' ')}</td>`;
    tbody.appendChild(tr);
  });

  excludedRows.forEach((row, idx) => {
    const tr = document.createElement('tr');
    tr.dataset.excIdx = String(idx);
    const typeLabel = {
      summary:'Summary / Total', section_heading:'Section Heading',
      subsection_heading:'Subsection Heading', narrative:'Narrative / Note',
    }[row.row_type] || row.row_type || 'Unknown';
    tr.innerHTML = `
      <td><span class="item-no">${esc(row.item_no||'')}</span></td>
      <td style="font-size:12px">${esc((row.description||'').substring(0,80))}</td>
      <td><span class="excluded-badge">${esc(typeLabel)}</span></td>
      <td style="font-size:10px;font-weight:700;color:var(--green)">${(row.classification_confidence||'high').toUpperCase()}</td>
      <td><button class="promote-btn" onclick="promoteExcludedRow(${idx})">Promote →</button></td>`;
    excludedTbody.appendChild(tr);
  });

  const cb  = document.getElementById('review-confirmed');
  const btn = document.getElementById('proceed-btn');
  if (cb)  cb.checked  = false;
  if (btn) btn.disabled = true;

  setStage('stage-review');
}

function toggleSearchBtn() {
  const cb  = document.getElementById('review-confirmed');
  const btn = document.getElementById('proceed-btn');
  if (btn) btn.disabled = !cb?.checked;
}

function switchReviewTab(tab, btn) {
  document.querySelectorAll('.review-tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.review-tab-panel').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('rtab-' + tab).classList.add('active');
}

function promoteExcludedRow(excIdx) {
  const row = excludedRows[excIdx];
  if (!row) return;
  const lm = detectLabour(row.description || '');
  const promoted = {
    no:row.item_no||String(boqItems.length+1), desc:row.description||'', description:row.description||'',
    unit:row.unit||'', qty:parseFloat(row.quantity)||0, quantity:parseFloat(row.quantity)||0,
    rate:row.rate||null, price:row.price||null,
    cat:detectCategoryClient(row.description||''), category:detectCategoryClient(row.description||''),
    item_type:lm.isLabour?'labour':'material', incomplete:true, _split:false,
    section_name:row.section_name||'', subsection_name:row.subsection_name||'', context_note:row.context_note||'',
    classification_confidence:'low', ...lm,
  };
  boqItems.push(promoted);
  excludedRows.splice(excIdx, 1);
  renderReviewTable(boqItems, excludedRows);
  toast(`Promoted "${(row.description||'').substring(0,40)}" to line items`);
}

function proceedToAnalysis() { runAnalysis(); }
