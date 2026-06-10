/* KHUTHADZO SUPPLIES — Zone 1 Intake logic */
(function (g) {
  "use strict";
  async function ingest(payload) {
    const status = document.querySelector("#intake-status");
    status.textContent = "Parsing…";
    const res = await fetch("/.netlify/functions/parse", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
    });
    const data = await res.json();

    // Background OCR path
    if (data.background && data.jobId) { return pollOCR(data.jobId); }

    applyIntelligence(data);
    status.textContent = "Interpretation ready — review below.";
  }

  async function pollOCR(jobId) {
    const status = document.querySelector("#intake-status");
    const bar = document.querySelector("#ocr-bar > span");
    return new Promise(resolve => {
      const t = setInterval(async () => {
        const r = await fetch("/.netlify/functions/parse?job=" + jobId);
        const d = await r.json();
        if (bar) bar.style.width = (d.progress || 0) + "%";
        status.textContent = "OCR processing… " + (d.progress || 0) + "%";
        if (d.done) { clearInterval(t); applyIntelligence(d.result); status.textContent = "OCR complete — review below."; resolve(); }
      }, 2000);
    });
  }

  function applyIntelligence(data) {
    const s = KH_STATE.get();
    s.document.raw = data.raw || null;
    s.document.format = data.format || "unknown";
    s.document.structure = data.structure || null;
    s.document.intelligence = data.intelligence || {};
    s.items = (data.items || []).map(i => Object.assign({
      id: KH_UTILS.uid(), classification: i.classification || "line_item",
      pricingType: "Supply and Install", trade: i.trade || "General Building",
      stale: false, status: "pending", build: null, override: null
    }, i));
    s.excludedRows = data.excluded || [];
    KH_STATE.set({ document: s.document, items: s.items, excludedRows: s.excludedRows });
    renderReport(data.intelligence || {});
  }

  function renderReport(intel) {
    const c = document.querySelector("#intelligence-report");
    if (!c) return;
    const flag = (arr) => (arr && arr.length) ? arr.map(x => `<li>${x}</li>`).join("") : "<li>None detected</li>";
    c.innerHTML = `
      <h3>1. Detected Document Structure</h3>
      <p><strong>${KH_STATE.get().document.format}</strong> ${intel.uncertain ? "<em>(uncertain — please correct)</em>" : ""}</p>
      <h3>2. Trade Disciplines Identified</h3><ul>${flag(intel.trades)}</ul>
      <h3>3. Extracted Procurement Context</h3><ul>${flag((intel.context || []).map(f => `<span class="flag flag-${f}">${f}</span>`))}</ul>
      <h3>4. Specified Product Flags</h3>
      <ul>${flag((intel.products || []).map(p => `<span class="flag flag-${p.type}">${p.type}</span> ${p.name}`))}</ul>`;
    document.querySelector("#confirm-intake").disabled = false;
  }

  function confirmIntake() {
    const s = KH_STATE.get();
    s.document.confirmed = true;
    // carry context flags into parameters as working flags
    s.parameters.workingFlags = (s.document.intelligence.context || []).slice();
    KH_STATE.set({ document: s.document, parameters: s.parameters });
    KH_APP.confirmAdvance(1, "zone-2-classify.html");
  }

  g.KH_INTAKE = { ingest, confirmIntake };
})(window);