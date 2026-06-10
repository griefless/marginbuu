/* KHUTHADZO SUPPLIES — Zone 3 Research & Pricing core */
(function (g) {
  "use strict";

  // Heuristic block parser (used client-side preview; server mirrors it)
  function heuristicParse(text) {
    const m = String(text).match(/(each|m)(\d+)/i);
    if (!m) return null;
    if (m[1].toLowerCase() === "each") return { quantity: 1, unit: "each" };
    const digits = m[2];
    if (digits.length >= 3) return { quantity: parseInt(digits.slice(1), 10), unit: "square metre" };
    return { quantity: parseInt(digits, 10), unit: "linear metre" };
  }

  // Item splitting (supply/install/painting)
  function splitItem(item) {
    const d = (item.description || "").toLowerCase();
    const installVerb = /(installed|fixed|laid|erected|secured)/.test(d);
    const coating = /(paint|painted|colour|coat)/.test(d);
    if (!installVerb) return [item];
    const children = [];
    children.push(Object.assign({}, item, { id: KH_UTILS.uid(), parentId: item.id, tag: "[SUPPLY]", pricingType: "Material Only" }));
    children.push(Object.assign({}, item, { id: KH_UTILS.uid(), parentId: item.id, tag: "[INSTALL]", pricingType: "Labour Only" }));
    if (coating) children.push(Object.assign({}, item, { id: KH_UTILS.uid(), parentId: item.id, tag: "[PAINTING]", pricingType: "Labour Only", trade: "Painter" }));
    return children;
  }

  async function researchItem(item) {
    const cleaned = KH_UTILS.cleanQuery(item.description);
    item.cleanedQuery = cleaned;
    item.fallbackLinks = KH_UTILS.fallbackLinks(cleaned);

    let material = null, source = null, url = null;
    try {
      const res = await fetch("/.netlify/functions/search-prices", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: cleaned, item })
      });
      const d = await res.json();
      if (d.price) { material = d.price; source = d.source; url = d.url; }
    } catch (e) { /* fall through to fallback links */ }

    const p = KH_STATE.get().parameters;
    const labour = KH_LABOUR.unitRate(item.trade, item.unit, item.description);
    const prem = KH_COMPLIANCE.premiumFor(p.workingFlags);

    let allIn = 0;
    if (item.pricingType === "Material Only") allIn = (material || 0);
    else if (item.pricingType === "Labour Only") allIn = labour.rate;
    else allIn = (material || 0) + labour.rate;
    allIn *= prem.multiplier;

    item.build = {
      material, materialSource: source, materialUrl: url, retrieved: new Date().toISOString(),
      labourRate: labour.rate, labourBasis: labour.basis, trade: item.trade,
      council: p.bargainingCouncil, premiums: prem.notes, allIn
    };
    item.confidence = material ? "high" : "low";
    item.status = material ? "priced" : "unresolved";
    item.stale = false;

    // Knowledge base price log
    if (material) KH_STATE.knowledge.logPrice(cleaned, p.location, material);
    return item;
  }

  async function runResearch() {
    const s = KH_STATE.get();
    // expand splits
    let expanded = [];
    s.items.forEach(it => { expanded = expanded.concat(splitItem(it)); });
    s.items = expanded;
    KH_STATE.set({ items: expanded });
    renderProgress();

    for (const item of s.items) {
      if (item.status === "incomplete") continue;
      item.status = "researching"; renderProgress();
      await researchItem(item);
      KH_STATE.upsertItem(item);
      renderProgress();
    }
    const unresolved = s.items.filter(i => i.status === "unresolved" || i.status === "incomplete");
    document.querySelector("#to-review").disabled = unresolved.length > 0;
    document.querySelector("#research-note").textContent =
      unresolved.length ? `${unresolved.length} item(s) require manual rate before Zone 4.` : "All items priced. You may proceed to Review.";
  }

  function renderProgress() {
    const body = document.querySelector("#research-body");
    if (!body) return;
    body.innerHTML = "";
    KH_STATE.get().items.forEach(it => {
      const tr = KH_UTILS.el("tr");
      tr.appendChild(KH_UTILS.el("td", { html: (it.tag || "") + " " + (it.description || "").slice(0, 60) }));
      tr.appendChild(KH_UTILS.el("td", { html: it.status }));
      tr.appendChild(KH_UTILS.el("td", { html: it.cleanedQuery || "—" }));
      tr.appendChild(KH_UTILS.el("td", { html: it.build && it.build.material ? KH_UTILS.money(it.build.material) : (it.status === "unresolved" ? "no price found" : "—") }));
      tr.appendChild(KH_UTILS.el("td", { html: it.confidence || "—" }));
      const td = KH_UTILS.el("td");
      if (it.status === "unresolved" || it.status === "incomplete") {
        const b = KH_UTILS.el("button", { class: "btn btn-ghost" }, ["Enter rate"]);
        b.onclick = () => manualRate(it.id);
        td.appendChild(b);
      } else if (it.fallbackLinks) {
        it.fallbackLinks.forEach(l => { td.appendChild(KH_UTILS.el("a", { href: l.url, target: "_blank" }, [l.name])); td.appendChild(document.createTextNode(" ")); });
      }
      tr.appendChild(td);
      body.appendChild(tr);
    });
  }

  function manualRate(id) {
    const it = KH_STATE.get().items.find(x => x.id === id);
    const v = prompt("Enter manual all-in unit rate (R):");
    if (v == null) return;
    it.build = it.build || {};
    it.build.allIn = KH_UTILS.num(v); it.build.material = it.build.material || KH_UTILS.num(v);
    it.confidence = "moderate"; it.status = "priced"; it.stale = false;
    KH_STATE.upsertItem(it); renderProgress();
    document.querySelector("#to-review").disabled = KH_STATE.get().items.some(i => i.status === "unresolved" || i.status === "incomplete");
  }

  g.KH_PROCESSING = { runResearch, renderProgress, splitItem, heuristicParse };
})(window);