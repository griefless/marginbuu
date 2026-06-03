'use strict';

function bestTotal() {
  return boqItems.reduce((sum, item) => {
    const d = priceData[item.no];
    if (!d?.suppliers?.length) return sum;
    const b = d.suppliers[d.bestIdx];
    return sum + (b ? b.price * item.qty : 0);
  }, 0);
}

function fmtR(v) {
  return 'R\u00a0' + Number(v).toLocaleString('en-ZA', { minimumFractionDigits:2, maximumFractionDigits:2 });
}

function esc(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function catColors(cat) {
  const MAP = {
    'Civil & Construction':   { bg:'#fef3e2', fg:'#7a4d0a' },
    'Civil':                  { bg:'#fef3e2', fg:'#7a4d0a' },
    'Plumbing & Drainage':    { bg:'#eeedfe', fg:'#3a2aaa' },
    'Plumbing':               { bg:'#eeedfe', fg:'#3a2aaa' },
    'Electrical & LV Systems':{ bg:'#e8f0fb', fg:'#1a4a8a' },
    'Electrical':             { bg:'#e8f0fb', fg:'#1a4a8a' },
    'Mechanical & HVAC':      { bg:'#eaf3de', fg:'#1a5c32' },
    'Mechanical':             { bg:'#eaf3de', fg:'#1a5c32' },
    'Fencing & Security':     { bg:'#fdecea', fg:'#8b1a1a' },
    'Fencing':                { bg:'#fdecea', fg:'#8b1a1a' },
    'General Supplies & PPE': { bg:'#f5f0e8', fg:'#5c4a1a' },
    'General Supplies':       { bg:'#f5f0e8', fg:'#5c4a1a' },
    'Health & Medical':       { bg:'#fce8ee', fg:'#7a1a3a' },
    'Electronics & ICT':      { bg:'#e8f5fe', fg:'#1a3a7a' },
    'Labour & Installation':  { bg:'#fff8e1', fg:'#7a5c00' },
    'Labour':                 { bg:'#fff8e1', fg:'#7a5c00' },
    'Structural':             { bg:'#fdecea', fg:'#8b1a1a' },
    'Earthworks':             { bg:'#fef3e2', fg:'#7a4d0a' },
    'Unclassified':           { bg:'#f0f0ea', fg:'#56564f' },
    'Other':                  { bg:'#f0f0ea', fg:'#56564f' },
  };
  return MAP[cat] || { bg:'#f0f0ea', fg:'#56564f' };
}

function filterBOQ() {
  const q   = document.getElementById('boq-q').value.toLowerCase();
  const cat = document.getElementById('boq-cat').value;
  document.querySelectorAll('#boq-tbody tr').forEach(tr => {
    if (tr.classList.contains('sec-hdr')) { tr.style.display = ''; return; }
    const ok = (!q || (tr.dataset.desc||'').includes(q)) && (!cat || tr.dataset.cat === cat);
    tr.style.display = ok ? '' : 'none';
  });
}

function showTab(id, btn) {
  document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (btn) btn.classList.add('active');
}

function setStage(id) {
  document.querySelectorAll('.stage').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function setProg(pct, phase) {
  document.getElementById('big-fill').style.width  = pct + '%';
  document.getElementById('prog-pct').textContent  = pct + '%';
  if (phase) document.getElementById('prog-phase').textContent = phase;
}

function setProcSub(t) { document.getElementById('proc-sub').textContent = t; }
function clearLog()    { document.getElementById('item-log').innerHTML = ''; }

function addLog(id, text, status) {
  const row = document.createElement('div');
  row.className = 'log-row';
  row.id = 'lr-' + id.replace(/[^a-z0-9]/gi,'_');
  row.innerHTML = `
    <div class="log-dot d-${status}" id="ld-${id.replace(/[^a-z0-9]/gi,'_')}"></div>
    <div class="log-desc">${esc(text)}</div>
    <div class="log-status${status==='done'?' done':status==='err'?' err':''}" id="ls-${id.replace(/[^a-z0-9]/gi,'_')}">${status==='active'?'Searching…':''}</div>`;
  document.getElementById('item-log').appendChild(row);
  document.getElementById('item-log').scrollTop = 9999;
}

function updateLog(id, msg, status) {
  const safe = id.replace(/[^a-z0-9]/gi,'_');
  const dot = document.getElementById('ld-'+safe);
  const st  = document.getElementById('ls-'+safe);
  if (dot) dot.className = 'log-dot d-'+status;
  if (st)  { st.textContent = msg; st.className = 'log-status' + (status==='done'?' done':status==='err'?' err':status==='warn'?' warn':''); }
}

function setStatus(text, cls) {
  const el = document.getElementById('status-pill');
  el.textContent = text;
  el.className   = 'status-pill' + (cls ? ' '+cls : '');
}

function toast(msg, dur = 3500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), dur);
}

function downloadCSV() {
  if (!boqItems.length) return;
  const rows = [['Item No','Description','Unit','Qty','Best Supplier','Unit Rate (R)','Total (R)','vs BOQ','Supplier URL']];

  boqItems.forEach(item => {
    if (item.isLabour && !/supply/i.test(item.desc)) return;
    const d = priceData[item.no];
    if (!d?.suppliers?.length) return;
    const b = d.suppliers[d.bestIdx];
    const lt = +(b.price * item.qty).toFixed(2);
    const bl = item.price || (item.rate ? item.rate * item.qty : 0);
    rows.push([item.no, item.desc, item.unit, item.qty, b.name, b.price.toFixed(2), lt.toFixed(2), bl ? ((lt-bl)/bl*100).toFixed(1)+'%' : 'N/A', b.url]);
  });

  const matSub = bestTotal();
  const labSub = labourTotal();
  const labourItems = boqItems.filter(i => i.isLabour);
  const hasLabour = labourItems.length > 0;

  rows.push(['']);
  rows.push(['LABOUR & INSTALLATION — Regulated SA Rates','','','','','','','','']);
  rows.push(['Item No','Description','Trade','Authority','Regulation','Rate/hr (R)','Estimated Hrs','Oncost %','Line Total (R)']);

  if (hasLabour) {
    labourItems.forEach(item => {
      const d = labourData[item.no];
      if (!d) return;
      rows.push([item.no, item.desc, item.tradeCode||'', d.authority||'', d.regulation||'',
        (d.hourlyRate||0).toFixed(2),
        d.qtyHours != null ? d.qtyHours.toFixed(1) : 'unmapped',
        '25', d.totalCost != null ? d.totalCost.toFixed(2) : '0.00']);
    });
  }

  rows.push(['']);
  if (hasLabour) {
    rows.push(['','','','','','Materials Subtotal (excl VAT)', matSub.toFixed(2),'','']);
    rows.push(['','','','','','Labour Subtotal (excl VAT)', labSub.toFixed(2),'','']);
    rows.push(['','','','','','Combined Subtotal (excl VAT)', (matSub+labSub).toFixed(2),'','']);
    rows.push(['','','','','','VAT 15%', ((matSub+labSub)*0.15).toFixed(2),'','']);
    rows.push(['','','','','','TOTAL incl VAT', ((matSub+labSub)*1.15).toFixed(2),'','']);
  } else {
    rows.push(['','','','','','Subtotal excl VAT', matSub.toFixed(2),'','']);
    rows.push(['','','','','','VAT 15%', (matSub*0.15).toFixed(2),'','']);
    rows.push(['','','','','','TOTAL incl VAT', (matSub*1.15).toFixed(2),'','']);
  }

  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(csv);
  a.download = 'morambol_best_price_quote.csv';
  a.click();
}
