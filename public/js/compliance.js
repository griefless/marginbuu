'use strict';

function generateCompliance(items) {
  const cats = new Set(items.map(i => i.cat || i.category || 'Unclassified'));
  const hasElec  = cats.has('Electrical & LV Systems') || cats.has('Electrical');
  const hasCivil = cats.has('Civil & Construction') || cats.has('Civil') || cats.has('Earthworks');
  const hasDesc  = t => items.some(i => new RegExp(t,'i').test(i.desc || i.description || ''));

  const checks = [
    { title:'CIDB Contractor Registration', status:'pass', reg:'CIDB Act 38 of 2000',
      detail:`Morambol Supplies must be registered on the CIDB e-register at cidb.org.za before submitting any tender. The CIDB grading required depends on total contract value — verify the applicable grade (e.g. 2CE/3CE for civil + electrical up to R3M). Non-compliant contractors are disqualified from public-sector awards.` },
    { title:'SARS VAT Registration (15%)', status:'pass', reg:'VAT Act 89 of 1991',
      detail:`All supply prices must include 15% VAT as mandated by SARS. Morambol must be a registered VAT vendor to charge VAT on invoices and reclaim input VAT on procurement. VAT registration number must appear on all quotations and invoices.` },
  ];

  if (hasElec) {
    checks.push({ title:'Certificate of Compliance (CoC)', status:'pass', reg:'OHS Act 85/1993 — Electrical Installation Regs 2009',
      detail:`Upon completion, a valid CoC must be issued by a registered electrical contractor (registered with DoEL). Required per the Electrical Installation Regulations. The CoC covers all wiring, earthing, protective devices, and switchgear installed on site.` });
    checks.push({ title:'SANS Cable Standards', status:'pass', reg:'SANS 1507 / SANS 60227',
      detail:`All cables must bear the SABS mark and comply with SANS 1507 series (PVC-insulated cables) or SANS 60227/60228 as applicable. SWA-armoured cable for underground/direct burial must comply with SANS 1507-3.` });
  }

  if (hasDesc('hdpe|sleeve|duct')) {
    checks.push({ title:'HDPE Ducting — SANS 1808', status:'pass', reg:'SANS 1808 / SANS 10142-1',
      detail:`Underground HDPE conduit / sleeve piping must comply with SANS 1808 (high-density polyethylene pipes for buried cable protection). Confirm SANS 1808 certification on supplier delivery note.` });
  }
  if (hasDesc('mccb|mcb|circuit.?breaker|switchgear')) {
    checks.push({ title:'Switchgear SABS Approval', status:'pass', reg:'SANS 60947-2 / SANS 61008 / IEC 61643-11',
      detail:`MCCBs, MCBs, and Earth Leakage units must be SABS-approved and comply with SANS 60947-2 (circuit breakers) and SANS 61008 (RCDs). Surge Arrestors must comply with IEC 61643-11 / DEHN specification.` });
  }
  if (hasElec) {
    checks.push({ title:'Earthing & Earth Continuity (SANS 10142-1)', status:'pass', reg:'SANS 10142-1',
      detail:`All earthing conductors (bare copper), earth electrodes, and bonding must comply with SANS 10142-1 Wiring Code. Earth continuity must be tested and recorded before CoC is issued.` });
  }
  if (hasCivil) {
    checks.push({ title:'Construction Regulations (OHS Act)', status:'pass', reg:'OHS Act 85/1993 — Construction Regs 2014',
      detail:`All civil excavation and sitework activities require a Health & Safety Plan submitted to the principal contractor/client before commencement. A Construction Health & Safety Manager must be appointed per Construction Regulation 5.` });
  }
  if (hasDesc('concrete')) {
    checks.push({ title:'Concrete Mix & Specification', status:'pass', reg:'SANS 10100-1 / SARMA',
      detail:`Concrete must comply with SANS 10100-1 (Structural use of concrete) and the project specification. Ready-mix must come from a SARMA-certified plant. Slump test and cube test records must be retained.` });
  }

  checks.push({ title:'BBBEE Supplier Compliance', status:'warn', reg:'BBBEE Act 53 of 2003 / PPPFA',
    detail:`Public sector procurement requires preference for BBBEE Level 1–4 suppliers. Verify valid BBBEE certificates from all recommended suppliers before issuing purchase orders. Morambol's own BBBEE certificate must be current.` });
  checks.push({ title:'CIPC Company Registration', status:'pass', reg:'Companies Act 71 of 2008 / National Treasury CSD',
    detail:`Morambol Supplies must have a valid CIPC registration, a Tax Clearance Certificate (Good Standing) from SARS, and a Central Supplier Database (CSD) registration to submit tenders to government entities.` });

  // ── Labour compliance checks ──
  const labourItems = items.filter(i => i.isLabour);
  const hasLabour   = Object.keys(labourData).length > 0;

  if (hasLabour) {
    const nmwBreaches = Object.entries(labourData).filter(([,d]) => d?.hourlyRate && d.hourlyRate < 30.22);
    checks.push({ title:'National Minimum Wage Compliance', reg:'National Minimum Wage Act 9 of 2018 — NMW Notice 2025',
      status: nmwBreaches.length ? 'fail' : 'pass',
      detail: nmwBreaches.length
        ? `WARNING: ${nmwBreaches.length} labour item(s) have rates below the NMW of R30.22/hr (effective 1 March 2025). Non-compliant items: ${nmwBreaches.map(([k])=>k).join(', ')}.`
        : `All labour rates applied in this BOQ are at or above the National Minimum Wage of R30.22/hr (effective 1 March 2025).` });

    const oncostOk = Object.values(labourData).every(d => !d || d.oncostMultiplier >= 1.25);
    checks.push({ title:'UIF & SDL Obligations', reg:'Unemployment Insurance Act 63 of 2001 / Skills Development Levies Act 9 of 1999',
      status: oncostOk ? 'pass' : 'fail',
      detail: oncostOk
        ? `The oncost multiplier of 1.25 applied to all labour rates confirms that UIF (1% employee + 1% employer) and SDL (1% of payroll) contributions are included in the quoted labour cost.`
        : `Some labour rates were applied without the full 1.25 oncost multiplier. UIF and SDL obligations may not be covered.` });

    const mbsaItems = labourItems.filter(i => i.regSource === 'MBSA');
    if (mbsaItems.length) {
      const mbsaBreaches = mbsaItems.filter(i => { const d = labourData[i.no]; const min = LABOUR_RATES[i.tradeCode]?.ratePerHour || 0; return d && d.hourlyRate < min; });
      checks.push({ title:'MBSA Wage Compliance', reg:'MBSA Regional Wage Agreement 2024',
        status: mbsaBreaches.length ? 'fail' : 'pass',
        detail: mbsaBreaches.length
          ? `Rates for ${mbsaBreaches.map(i=>i.no).join(', ')} are below the MBSA minimum wage schedule.`
          : `All building trade (MBSA) rates in this BOQ meet or exceed the MBSA regional minimum wage schedule for 2024.` });
    }

    const bibcItems = labourItems.filter(i => i.regSource === 'BIBC');
    if (bibcItems.length) {
      checks.push({ title:'BIBC Registration Required', status:'warn', reg:'Labour Relations Act 66 of 1995 — BIBC Main Agreement',
        detail:`This BOQ includes electrical / building trades covered by the Bargaining Council for the Building Industry Cape (BIBC). The contractor must be registered with the Bargaining Council. Confirm BIBC registration before submitting this tender.` });
    }

    const annualPayroll = labourTotal() * 12;
    if (annualPayroll > 500000) {
      checks.push({ title:'CETA Skills Development Levy', status:'warn', reg:'Skills Development Levies Act 9 of 1999 / CETA SETA',
        detail:`Estimated annual labour payroll exceeds R500,000 (estimated at ${fmtR(annualPayroll)}/year). Companies with payroll above this threshold must pay a CETA Skills Development Levy of 1% of total payroll.` });
    }

    const securityItems = labourItems.filter(i => i.tradeCode === 'SECURITY_GUARD');
    if (securityItems.length) {
      checks.push({ title:'PSIRA Grade Compliance', status:'warn', reg:'Private Security Industry Regulation Act 56 of 2001 / PSIRA',
        detail:`This BOQ includes security guard labour. All security personnel must hold a valid PSIRA registration certificate at the appropriate grade (Grade A–E).` });
    }

    const engItems = labourItems.filter(i => i.tradeCode === 'PROF_ENGINEER');
    if (engItems.length) {
      const ecsaBreaches = engItems.filter(i => { const d = labourData[i.no]; return d && (d.hourlyRate < 550 || d.hourlyRate > 1200); });
      checks.push({ title:'ECSA Professional Fee Compliance', reg:'ECSA Guideline on Fees for Engineering Services 2023',
        status: ecsaBreaches.length ? 'warn' : 'pass',
        detail: ecsaBreaches.length
          ? `Professional engineering fees for ${ecsaBreaches.map(i=>i.no).join(', ')} fall outside the ECSA guideline range of R550–R1200/hr.`
          : `Professional engineering fee rates applied in this BOQ fall within the ECSA recommended fee guideline range (R550–R1200/hr).` });
    }
  }

  return checks;
}
