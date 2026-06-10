/* KHUTHADZO SUPPLIES — Zone 4 review + Zone 5 output */
(function (g) {
  "use strict";

  /* ---------- ZONE 4 ---------- */
  function renderReview() {
    const body = document.querySelector("#review-body");
    if (!body) return;
    body.innerHTML = "";
    KH_STATE.get().items.forEach(it => {
      const conf = it.confidence === "high" ? "conf-high" : it.confidence === "moderate" ? "conf-mod" : "conf-low";
      const tr = KH_UTILS.el("tr", { class: conf + (it.override ? " override-row" : "") });
      const amount = (it.build ? it.build.allIn : 0) * KH_UTILS.num(it.quantity);
      tr.appendChild(KH_UTILS.el("td", { html: (it.tag || "") + " " + (it.description || "") }));
      tr.appendChild(KH_UTILS.el("td", { html: it.unit || "" }));
      tr.appendChild(KH_UTILS.el("td", { html: String(it.quantity || "") }));
      const rateTd = KH_UTILS.el("td", { html: it.build ? KH_UTILS.money(it.build.allIn) : "—" });
      rateTd.style.cursor = "pointer"; rateTd.title = "Click to override";
      rateTd.onclick = () => override(it.id);
      tr.appendChild(rateTd);
      tr.appendChild(buildPanelCell(it));
      tr.appendChild(KH_UTILS.el("td", { html: it.confidence || "—" }));
      tr.appendChild(KH_UTILS.el("td", { html: KH_UTILS.money(amount) }));
      body.appendChild(tr);
    });
    renderPrelims();
  }

  function buildPanelCell(it) {
    const td = KH_UTILS.el("td");
    if (!it.build) { td.textContent = "—"; return td; }
    const b = it.build;
    const det = KH_UTILS.el("details");
    det.appendChild(KH_UTILS.el("summary", { html: "build-up" }));
    det.appendChild(KH_UTILS.el("div", { html:
      `Material: ${b.material ? KH_UTILS.money(b.material) : "n/a"}<br>` +
      `Source: ${b.materialSource || "—"} ${b.materialUrl ? `(<a href="${b.materialUrl}" target="_blank">link</a>)` : ""}<br>` +
      `Retrieved: ${b.retrieved || "—"}<br>` +
      `Labour: ${KH_UTILS.money(b.labourRate)} — ${b.labourBasis}<br>` +
      `Council: ${b.council || "—"}<br>` +
      `Premiums: ${(b.premiums || []).join("; ") || "none"}` +
      (it.override ? `<br><strong>Override rationale:</strong> ${it.override.rationale}` : "") }));
    td.appendChild(det);
    return td;
  }

  function override(id) {
    const it = KH_STATE.get().items.find(x => x.id === id);
    const v = prompt("Override unit rate (R):", it.build ? it.build.allIn : 0);
    if (v == null) return;
    const rationale = prompt("Mandatory: basis/rationale for this override:");
    if (!rationale) { alert("Override cancelled — rationale required."); return; }
    const original = it.build ? it.build.allIn : 0;
    it.override = { original, rate: KH_UTILS.num(v), rationale, ts: new Date().toISOString() };
    it.build.allIn = KH_UTILS.num(v);
    it.confidence = "moderate";
    KH_STATE.upsertItem(it);
    KH_STATE.addAudit({ itemId: id, original, override: KH_UTILS.num(v), rationale });
    KH_STATE.knowledge.logOverride(it.trade + "|" + it.unit, original, KH_UTILS.num(v));
    renderReview();
  }

  function renderPrelims() {
    const c = document.querySelector("#prelim-body");
    if (!c) return;
    const s = KH_STATE.get();
    if (!s.preliminaries.length)
      s.preliminaries = [
        { id: KH_UTILS.uid(), description: "Site establishment", fixed: 0, valueRelated: 0, timeRelated: 0 },
        { id: KH_UTILS.uid(), description: "Insurances & guarantees", fixed: 0, valueRelated: 0, timeRelated: 0 },
        { id: KH_UTILS.uid(), description: "Site supervision & temporary services", fixed: 0, valueRelated: 0, timeRelated: 0 }
      ];
    c.innerHTML = "";
    s.preliminaries.forEach(p => {
      const tr = KH_UTILS.el("tr");
      tr.appendChild(KH_UTILS.el("td", { html: p.description }));
      ["fixed", "valueRelated", "timeRelated"].forEach(f => {
        const td = KH_UTILS.el("td", { contenteditable: "true", html: String(p[f]) });
        td.onblur = () => { p[f] = KH_UTILS.num(td.textContent); KH_STATE.set({ preliminaries: s.preliminaries }); };
        tr.appendChild(td);
      });
      c.appendChild(tr);
    });
    KH_STATE.set({ preliminaries: s.preliminaries });
  }

  function approveOutput() {
    const s = KH_STATE.get();
    if (s.items.some(i => i.status === "unresolved" || i.status === "incomplete")) { alert("Resolve all items first."); return; }
    s.output.status = "approved";
    KH_STATE.set({ output: s.output });
    KH_APP.confirmAdvance(4, "zone-5-output.html");
  }

  /* ---------- ZONE 5 ---------- */
  async function generateOutput() {
    const s = KH_STATE.get();
    if (s.output.status !== "approved") { alert("Zone 4 approval required before output."); return; }
    const res = await fetch("/.netlify/functions/report", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: s.items, parameters: s.parameters, preliminaries: s.preliminaries, format: s.document.format, contingencyPct: s.parameters.contingencyPct, audit: s.audit })
    });
    const d = await res.json();
    renderPricedBOQ(d);
    bindCsvExport(d.substantiationCsv);
    renderVariance(d.variance);
  }

  function subtotal() {
    return KH_STATE.get().items.reduce((t, i) => t + ((i.build ? i.build.allIn : 0) * KH_UTILS.num(i.quantity)), 0);
  }

  function renderPricedBOQ(d) {
    const c = document.querySelector("#priced-boq");
    if (!c) return;
    const sub = subtotal();
    const cont = sub * (KH_STATE.get().parameters.contingencyPct / 100);
    const vat = (sub + cont) * 0.15;
    let rows = KH_STATE.get().items.map(i => `<tr>
      <td>${i.item_no || ""}</td><td>${(i.tag || "")} ${i.description || ""}</td>
      <td>${i.unit || ""}</td><td>${i.quantity || ""}</td>
      <td>${i.build ? KH_UTILS.money(i.build.allIn) : ""}</td>
      <td>${KH_UTILS.money((i.build ? i.build.allIn : 0) * KH_UTILS.num(i.quantity))}</td></tr>`).join("");
    c.innerHTML = `<table class="kh-table">
      <thead><tr><th>Item</th><th>Description</th><th>Unit</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
      <tbody>${rows}
      <tr><td colspan="5"><strong>Sub-total</strong></td><td><strong>${KH_UTILS.money(sub)}</strong></td></tr>
      <tr><td colspan="5">Contingency (${KH_STATE.get().parameters.contingencyPct}%)</td><td>${KH_UTILS.money(cont)}</td></tr>
      <tr><td colspan="5">VAT @ 15%</td><td>${KH_UTILS.money(vat)}</td></tr>
      <tr><td colspan="5"><strong>GRAND TOTAL</strong></td><td><strong>${KH_UTILS.money(sub + cont + vat)}</strong></td></tr>
      </tbody></table>`;
  }

  function bindCsvExport(csv) {
    const btn = document.querySelector("#export-csv");
    if (!btn) return;
    btn.onclick = () => {
      const blob = new Blob([csv], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "rate-substantiation.csv"; a.click();
    };
  }

  function renderVariance(v) {
    const c = document.querySelector("#variance-dash");
    if (!c || !v) return;
    c.innerHTML = `<h3>Variance & Risk Analysis</h3>
      <p>Low-confidence items: <strong>${v.lowConfidence}</strong></p>
      <p>Commodity-linked items flagged: <strong>${v.commodity.join(", ") || "none"}</strong></p>
      <p>Cost by trade:</p><ul>${Object.entries(v.byTrade).map(([t, a]) => `<li>${t}: ${KH_UTILS.money(a)}</li>`).join("")}</ul>`;
  }

  g.KH_REPORT = { renderReview, approveOutput, generateOutput };
})(window);