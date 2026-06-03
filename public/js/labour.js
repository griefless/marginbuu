'use strict';

/* ── Labour Rate Engine Constants ─────────────────────────────────── */
const LABOUR_RATES = {
  ELEC_ARTISAN: {
    authority:'BIBC', authorityFull:'Bargaining Council for the Building Industry Cape',
    regulation:'BIBC Wage Schedule 2025/26', ratePerHour:115.00, ratePerDay:920.00,
    overtimeFactor:1.5, regionalNote:'Cape Metro rate — add ~8% for Gauteng, ~5% for KZN',
    effectiveDate:'2025-03-01', source_url:'https://www.bibc.co.za',
  },
  ELEC_APPRENTICE: {
    authority:'BIBC', authorityFull:'Bargaining Council for the Building Industry Cape',
    regulation:'BIBC Wage Schedule 2025/26 — Apprentice Grade', ratePerHour:72.00, ratePerDay:576.00,
    overtimeFactor:1.5, regionalNote:'Cape Metro rate',
    effectiveDate:'2025-03-01', source_url:'https://www.bibc.co.za',
  },
  CIVIL_FOREMAN: {
    authority:'MBSA', authorityFull:'Master Builders South Africa',
    regulation:'MBSA Regional Wage Agreement 2025', ratePerHour:130.00, ratePerDay:1040.00,
    overtimeFactor:1.5, regionalNote:'National average — Gauteng rate; apply -5% for other regions',
    effectiveDate:'2025-03-01', source_url:'https://www.masterbuilders.co.za',
  },
  CIVIL_ARTISAN: {
    authority:'MBSA', authorityFull:'Master Builders South Africa',
    regulation:'MBSA Regional Wage Agreement 2025', ratePerHour:95.00, ratePerDay:760.00,
    overtimeFactor:1.5, regionalNote:'National average — bricklayer, carpenter, steel fixer',
    effectiveDate:'2025-03-01', source_url:'https://www.masterbuilders.co.za',
  },
  CIVIL_LABOURER: {
    authority:'DoEL', authorityFull:'Department of Employment and Labour',
    regulation:'National Minimum Wage Act 9 of 2018 — NMW Notice 2025', ratePerHour:30.22, ratePerDay:241.76,
    overtimeFactor:1.5, regionalNote:'National Minimum Wage applies nationally',
    effectiveDate:'2025-03-01', source_url:'https://www.labour.gov.za/national-minimum-wage',
  },
  MECH_ARTISAN: {
    authority:'CETA', authorityFull:'Construction Education and Training Authority',
    regulation:'CETA Artisan Benchmark Rates 2025', ratePerHour:105.00, ratePerDay:840.00,
    overtimeFactor:1.5, regionalNote:'Applies to fitters, boilermakers, millwrights, plant operators',
    effectiveDate:'2025-01-01', source_url:'https://www.ceta.org.za',
  },
  SECURITY_GUARD: {
    authority:'PSIRA', authorityFull:'Private Security Industry Regulatory Authority',
    regulation:'PSIRA Wage Determination 2025 — Grade C/D', ratePerHour:33.25, ratePerDay:266.00,
    overtimeFactor:1.5, regionalNote:'Grade C/D mid-range; Grade A/B higher rates apply',
    effectiveDate:'2025-02-01', source_url:'https://www.psira.co.za',
  },
  PROF_ENGINEER: {
    authority:'ECSA', authorityFull:'Engineering Council of South Africa',
    regulation:'ECSA Guideline on Fees for Engineering Services 2025', ratePerHour:975.00, ratePerDay:7800.00,
    overtimeFactor:1.0, regionalNote:'Mid-range of R650–R1400/hr; discipline-specific rates apply',
    effectiveDate:'2025-01-01', source_url:'https://www.ecsa.co.za',
  },
  GENERAL_LABOURER: {
    authority:'DoEL', authorityFull:'Department of Employment and Labour',
    regulation:'National Minimum Wage Act 9 of 2018 — NMW Notice 2025', ratePerHour:30.22, ratePerDay:241.76,
    overtimeFactor:1.5, regionalNote:'Applies nationally — no regional variation',
    effectiveDate:'2025-03-01', source_url:'https://www.labour.gov.za/national-minimum-wage',
  },
};

const LABOUR_RATE_FALLBACK = {
  authority:'DoEL', authorityFull:'Department of Employment and Labour',
  regulation:'National Minimum Wage Act 9 of 2018 — NMW Notice 2025', ratePerHour:30.22, ratePerDay:241.76,
  overtimeFactor:1.5, regionalNote:'Applies nationally — fallback rate',
  effectiveDate:'2025-03-01', source_url:'https://www.labour.gov.za/national-minimum-wage',
};

const PRODUCTIVITY_FACTORS = {
  'm':0.5,'lm':0.5,'m2':0.25,'m²':0.25,
  'm3':2.0,'m³':2.0,
  'nr':1.0,'no':1.0,'ea':1.0,'each':1.0,'item':1.0,
  'sum':8.0,'ls':8.0,'lot':8.0,
  'kg':0.1,'t':80.0,
};

const TRADE_REG_MAP = {
  ELEC_ARTISAN:'BIBC', ELEC_APPRENTICE:'BIBC',
  CIVIL_FOREMAN:'MBSA', CIVIL_ARTISAN:'MBSA',
  CIVIL_LABOURER:'DoEL', MECH_ARTISAN:'CETA',
  SECURITY_GUARD:'PSIRA', PROF_ENGINEER:'ECSA',
  GENERAL_LABOURER:'DoEL',
};

/* ── Labour Detection ─────────────────────────────────────────────── */
function detectLabour(desc) {
  if (!desc) return { isLabour:false, labourTypes:[], tradeCode:null, regSource:null };
  const d = desc.toLowerCase();
  const labourTypes = [];

  const INSTALLATION = /\b(install|terminate|connect|commission|erect|lay|pull|glue|compact|reinforce|pour|strip|formwork|joint|fix|weld|solder|mount|hang)\b/;
  const TRADE        = /\b(electrician|artisan|plumber|bricklayer|carpenter|steel.?fixer|scaffolding|operator|labourer|foreman|welder|fitter|boilermaker|millwright)\b/;
  const SECURITY     = /\b(security|guard|psira|armed.?response|access.?control.?officer)\b/;
  const PROFESSIONAL = /\b(engineer|design|supervision|inspection|ecsa|architect|project.?manager|consulting)\b/;

  if (INSTALLATION.test(d)) labourTypes.push('installation');
  if (TRADE.test(d))        labourTypes.push('trade');
  if (SECURITY.test(d))     labourTypes.push('security');
  if (PROFESSIONAL.test(d)) labourTypes.push('professional');

  if (!labourTypes.length) return { isLabour:false, labourTypes:[], tradeCode:null, regSource:null };

  let tradeCode = 'GENERAL_LABOURER';
  if (/\belectrician\b|\bartisan\b/.test(d))                       tradeCode = 'ELEC_ARTISAN';
  else if (/\bapprentice\b/.test(d))                               tradeCode = 'ELEC_APPRENTICE';
  else if (/\bforeman\b/.test(d))                                  tradeCode = 'CIVIL_FOREMAN';
  else if (/\bbricklayer\b|\bcarpenter\b|\bsteel.?fixer\b/.test(d)) tradeCode = 'CIVIL_ARTISAN';
  else if (/\bfitter\b|\bboilermaker\b|\bmillwright\b|\boperator\b/.test(d)) tradeCode = 'MECH_ARTISAN';
  else if (/\bsecurity\b|\bguard\b|\bpsira\b|\barmed.?response\b|\baccess.?control\b/.test(d)) tradeCode = 'SECURITY_GUARD';
  else if (/\bengineer\b|\becsa\b|\bsupervision\b|\binspection\b|\barchitect\b|\bconsult/.test(d)) tradeCode = 'PROF_ENGINEER';
  else if (/\blabourer\b|\bcompact\b|\bexcavat\b/.test(d))         tradeCode = 'CIVIL_LABOURER';

  return { isLabour:true, labourTypes, tradeCode, regSource: TRADE_REG_MAP[tradeCode] || 'DoEL' };
}

/* ── Labour Rate Resolution ───────────────────────────────────────── */
function getLabourRate(tradeCode, qty, unit) {
  const entry = LABOUR_RATES[tradeCode];
  const usedFallback     = !entry;
  const unknownTradeCode = !entry;
  const src = entry || LABOUR_RATE_FALLBACK;

  const hourlyRate = src.ratePerHour;
  if (!hourlyRate || hourlyRate <= 0) {
    return { hourlyRate:0, dailyRate:0, qtyHours:0, totalCost:0, overtimeAllowance:0,
      oncostMultiplier:1.25, authority:src.authority, authorityFull:src.authorityFull,
      regulation:src.regulation, effectiveDate:src.effectiveDate, source_url:src.source_url,
      tradeCode, usedFallback, unknownTradeCode, unmappedUnit:false, invalid:true,
      errorMessage:'Invalid hourlyRate in LABOUR_RATES' };
  }

  const u = (unit||'').toLowerCase().trim();
  let qtyHours = null;
  let unmappedUnit = false;

  if (u === 'hr' || u === 'hour' || u === 'hours') {
    qtyHours = qty;
  } else if (u === 'day' || u === 'days') {
    qtyHours = qty * 8;
  } else {
    const factor = PRODUCTIVITY_FACTORS[u];
    if (factor !== undefined) {
      qtyHours = qty * factor;
    } else {
      unmappedUnit = true;
    }
  }

  if (qtyHours === null) {
    return { hourlyRate, dailyRate:+(hourlyRate*8).toFixed(2), qtyHours:null, totalCost:null,
      overtimeAllowance:+(hourlyRate*0.5).toFixed(2), oncostMultiplier:1.25,
      authority:src.authority, authorityFull:src.authorityFull, regulation:src.regulation,
      effectiveDate:src.effectiveDate, source_url:src.source_url, tradeCode,
      usedFallback, unknownTradeCode, unmappedUnit:true, invalid:true,
      errorMessage:`Unit "${unit}" not in productivity table — hours could not be estimated` };
  }

  const totalCost = +(qtyHours * hourlyRate * 1.25).toFixed(2);
  return {
    hourlyRate, dailyRate:+(hourlyRate*8).toFixed(2), qtyHours:+qtyHours.toFixed(2),
    totalCost, overtimeAllowance:+(hourlyRate*0.5).toFixed(2), oncostMultiplier:1.25,
    authority:src.authority, authorityFull:src.authorityFull, regulation:src.regulation,
    effectiveDate:src.effectiveDate, source_url:src.source_url, tradeCode,
    usedFallback, unknownTradeCode, unmappedUnit:false, invalid:false, errorMessage:null,
  };
}

async function fetchLabourRateForItem(item) {
  if (!item.isLabour) return null;
  return getLabourRate(item.tradeCode, item.qty, item.unit);
}

function labourTotal() {
  return Object.values(labourData).reduce((s, d) => s + (d?.totalCost || 0), 0);
}

/* ── Productive Output Rate Editor ────────────────────────────────── */
const DEFAULT_OUTPUT_RATES = {
  'Painter·m²': 3, 'Painter·lm': 0.5,
  'Tiler·m²': 1.5, 'Tiler·lm': 2,
  'Plasterer·m²': 2, 'Plasterer·lm': 4,
  'Bricklayer·m²': 0.67,
  'Carpenter·m²': 0.5, 'Carpenter·lm': 2,
  'Electrician·lm': 15,
  'Plumber·lm': 5,
  'Welder·lm': 2,
  'General Labourer·m²': 8, 'General Labourer·lm': 10, 'General Labourer·m³': 0.75,
};

let _outputOverrides = {};

function loadOutputOverrides() {
  try {
    const saved = localStorage.getItem('morambol_output_overrides');
    _outputOverrides = saved ? JSON.parse(saved) : {};
  } catch { _outputOverrides = {}; }
}

function saveOutputOverrides() {
  const inputs = document.querySelectorAll('#output-editor-grid .output-field input');
  inputs.forEach(inp => {
    const key = inp.dataset.key;
    const val = parseFloat(inp.value);
    if (key && !isNaN(val) && val > 0) _outputOverrides[key] = val;
  });
  try {
    localStorage.setItem('morambol_output_overrides', JSON.stringify(_outputOverrides));
    toast('Output rate overrides saved');
  } catch { toast('Could not save to localStorage'); }
}

function resetOutputOverrides() {
  _outputOverrides = {};
  localStorage.removeItem('morambol_output_overrides');
  buildOutputEditor();
  toast('Output rates reset to defaults');
}

function buildOutputEditor() {
  loadOutputOverrides();
  const grid  = document.getElementById('output-editor-grid');
  const panel = document.getElementById('output-editor-panel');
  if (!grid || !panel) return;

  grid.innerHTML = Object.entries(DEFAULT_OUTPUT_RATES).map(([key, defaultVal]) => {
    const [trade, unit] = key.split('·');
    const current = _outputOverrides[key] ?? defaultVal;
    return `
      <div class="output-field">
        <label>${esc(trade)} <span class="unit-tag">${esc(unit)}</span></label>
        <input type="number" step="0.1" min="0.01" value="${current}"
          data-key="${esc(key)}" title="${esc(trade)} productive output (${esc(unit)}/hr)">
        <span style="font-size:10px;color:var(--text3)">${esc(unit)}/hr</span>
      </div>`;
  }).join('');

  panel.style.display = 'block';
}
