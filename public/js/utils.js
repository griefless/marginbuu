/* KHUTHADZO SUPPLIES — Shared utilities (load AFTER state.js) */
(function (g) {
  "use strict";
  const U = {
    uid() { return "it-" + Math.random().toString(36).slice(2, 9); },
    encode(s) { return encodeURIComponent((s || "").trim()); },
    money(n) { return "R " + (Number(n) || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
    num(v) { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, "")); return isNaN(n) ? 0 : n; },
    el(tag, attrs, children) {
      const e = document.createElement(tag);
      if (attrs) for (const k in attrs) { if (k === "class") e.className = attrs[k]; else if (k === "html") e.innerHTML = attrs[k]; else e.setAttribute(k, attrs[k]); }
      (children || []).forEach(c => e.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
      return e;
    },
    /* Search-query cleaner used in Zone 3 */
    cleanQuery(desc) {
      let q = (desc || "").split(".")[0];                       // truncate at first full stop
      q = q.replace(/\b(supply|install|installed|fix|fixed|lay|laid|erect|erected|secure|secured|paint|painted|coat)\b/gi, ""); // strip verbs
      q = q.replace(/\s+/g, " ").trim();
      return q + " price South Africa";                         // SA merchant anchor
    },
    fallbackLinks(query) {
      const e = U.encode(query);
      return [
        { name: "Builders Warehouse", url: "https://www.builders.co.za/search/?text=" + e },
        { name: "Voltex", url: "https://www.voltex.co.za/catalogsearch/result/?q=" + e },
        { name: "Takealot", url: "https://www.takealot.com/all?qsearch=" + e },
        { name: "RS Components SA", url: "https://za.rs-online.com/web/c/?searchTerm=" + e }
      ];
    }
  };
  g.KH_UTILS = U;
})(window);