/* KHUTHADZO SUPPLIES — Navigation controller (load LAST) */
(function (g) {
  "use strict";
  const ZONES = [
    { z: 1, file: "zone-1-intake.html", label: "Intake" },
    { z: 2, file: "zone-2-classify.html", label: "Classify" },
    { z: 3, file: "zone-3-research.html", label: "Research" },
    { z: 4, file: "zone-4-review.html", label: "Review" },
    { z: 5, file: "zone-5-output.html", label: "Output" },
    { z: 6, file: "zone-6-knowledge.html", label: "Knowledge" }
  ];

  function currentZoneFromPath() {
    const m = location.pathname.match(/zone-(\d)/);
    return m ? parseInt(m[1], 10) : 1;
  }

  function renderNav() {
    const cur = currentZoneFromPath();
    const st = KH_STATE.get().zoneStatus;
    const nav = document.querySelector("nav.kh-nav");
    if (!nav) return;
    nav.innerHTML = "";
    ZONES.forEach(zd => {
      const status = zd.z === cur ? "active" : (st[zd.z] || "locked");
      const a = KH_UTILS.el("a", { class: status, href: status === "locked" ? "#" : zd.file },
        [KH_UTILS.el("span", { class: "num", html: String(zd.z) }), zd.label]);
      nav.appendChild(a);
    });
  }

  // Explicit forward confirmation (no auto-redirect)
  function confirmAdvance(fromZone, toFile) {
    KH_STATE.completeZone(fromZone);
    location.href = toFile;
  }

  g.KH_APP = { ZONES, renderNav, confirmAdvance, currentZoneFromPath };
  document.addEventListener("DOMContentLoaded", () => {
    KH_STATE.enterZone(currentZoneFromPath());
    renderNav();
    // 90-day freshness banner at start of session
    const kb = KH_STATE.knowledge.read();
    const stale = Object.entries(kb.freshness).filter(([k, v]) => !v || (Date.now() - new Date(v)) > 90 * 864e5);
    if (stale.length) {
      const b = document.querySelector("#freshness-banner");
      if (b) b.innerHTML = `<div class="warn">⚠ Pricing reference data may be outdated (${stale.map(s => s[0]).join(", ")}). Rates may not reflect current market conditions — refresh in Zone 6.</div>`;
    }
  });
})(window);