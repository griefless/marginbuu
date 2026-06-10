/* KHUTHADZO SUPPLIES — Zone 2 Classification logic */
(function (g) {
  "use strict";

  // Row classification rules
  function classifyRow(row) {
    const d = (row.description || "").toLowerCase();
    const u = (row.unit || "").toString().toLowerCase();
    const hasItemNo = row.item_no != null && String(row.item_no).trim() !== "";
    const qty = KH_UTILS.num(row.quantity);
    if (/carried forward|brought forward|sub-total|subtotal|vat at/.test(d) || ["page", "page-", "pg"].includes(u))
      return "summary";
    if (hasItemNo && !String(row.item_no).includes(".") && !row.unit && !row.quantity)
      return "section_heading";
    if (!hasItemNo && !row.unit && !row.quantity && (row.description || "").length > 15)
      return "narrative";
    if (row.unit && qty > 0) return "line_item";
    return "narrative";
  }

  function renderTables() {
    const s = KH_STATE.get();
    const active = s.items;
    const excluded = s.excludedRows;

    const ta = document.querySelector("#active-body");
    ta.innerHTML = "";
    active.forEach(it => {
      const tr = KH_UTILS.el("tr", it.stale ? { class: "stale" } : {});
      const cells = [
        cell(it, "item_no"), cell(it, "description"), cell(it, "unit"), cell(it, "quantity"),
        tradeCell(it), pricingCell(it)
      ];
      cells.forEach(c => tr.appendChild(c));
      ta.appendChild(tr);
    });

    const te = document.querySelector("#excluded-body");
    te.innerHTML = "";
    excluded.forEach((row, idx) => {
      const tr = KH_UTILS.el("tr");
      ["item_no", "description", "unit", "quantity"].forEach(f => tr.appendChild(KH_UTILS.el("td", { html: row[f] != null ? String(row[f]) : "" })));
      tr.appendChild(KH_UTILS.el("td", { html: row.classification || classifyRow(row) }));
      const btn = KH_UTILS.el("button", { class: "btn btn-accent" }, ["Promote"]);
      btn.onclick = () => promote(idx);
      tr.appendChild(KH_UTILS.el("td", {}, [btn]));
      te.appendChild(tr);
    });
  }

  function cell(it, field) {
    const td = KH_UTILS.el("td", { contenteditable: "true", html: it[field] != null ? String(it[field]) : "" });
    td.addEventListener("blur", () => { it[field] = td.textContent.trim(); KH_STATE.markStaleFrom(it.id); });
    return td;
  }
  function tradeCell(it) {
    const td = KH_UTILS.el("td", { contenteditable: "true", html: it.trade || "" });
    td.addEventListener("blur", () => { it.trade = td.textContent.trim(); KH_STATE.markStaleFrom(it.id); });
    return td;
  }
  function pricingCell(it) {
    const td = KH_UTILS.el("td");
    const sel = KH_UTILS.el("select");
    ["Material Only", "Labour Only", "Supply and Install"].forEach(o => {
      const opt = KH_UTILS.el("option", { value: o, html: o }); if (it.pricingType === o) opt.selected = true; sel.appendChild(opt);
    });
    sel.onchange = () => { it.pricingType = sel.value; KH_STATE.markStaleFrom(it.id); };
    td.appendChild(sel);
    return td;
  }

  function promote(idx) {
    const s = KH_STATE.get();
    const row = s.excludedRows.splice(idx, 1)[0];
    const item = {
      id: KH_UTILS.uid(), item_no: row.item_no || "", description: row.description || "",
      unit: row.unit || "", quantity: row.quantity || "",
      trade: "General Building", pricingType: "Supply and Install",
      classification: "line_item_low_confidence", confidence: "low",
      stale: false, status: "incomplete", build: null, override: null
    };
    s.items.push(item);
    KH_STATE.set({ items: s.items, excludedRows: s.excludedRows });
    renderTables();
    alert("Promoted. Please supply missing quantity & unit in the Active Items tab before research.");
  }

  function saveParameters() {
    const s = KH_STATE.get();
    s.parameters.location = document.querySelector("#p-location").value;
    s.parameters.bargainingCouncil = document.querySelector("#p-council").value;
    s.parameters.exposure = document.querySelector("#p-exposure").value;
    s.parameters.contingencyPct = KH_UTILS.num(document.querySelector("#p-contingency").value);
    s.parameters.confirmed = true;
    KH_STATE.set({ parameters: s.parameters });
  }

  function beginResearch() {
    saveParameters();
    const s = KH_STATE.get();
    if (!s.parameters.location || !s.parameters.bargainingCouncil) { alert("Confirm Project Location and Bargaining Council first."); return; }
    s.items.forEach(i => { if (i.status !== "incomplete") i.status = "queued"; });
    KH_STATE.set({ items: s.items });
    KH_APP.confirmAdvance(2, "zone-3-research.html");
  }

  function initParams() {
    const s = KH_STATE.get();
    const sel = document.querySelector("#p-council");
    KH_COMPLIANCE.COUNCILS.forEach(c => sel.appendChild(KH_UTILS.el("option", { value: c, html: c })));
    const ex = document.querySelector("#p-exposure");
    KH_COMPLIANCE.EXPOSURES.forEach(c => ex.appendChild(KH_UTILS.el("option", { value: c, html: c })));
    document.querySelector("#p-location").value = s.parameters.location || "";
    document.querySelector("#p-contingency").value = s.parameters.contingencyPct || 0;
    if (s.parameters.exposure) ex.value = s.parameters.exposure;
  }

  g.KH_REVIEW = { classifyRow, renderTables, beginResearch, initParams };
})(window);