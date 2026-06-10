/* KHUTHADZO SUPPLIES — Regulatory & bargaining council logic */
(function (g) {
  "use strict";
  const COUNCILS = ["BIBC (Cape)", "BCCEI National", "MEIBC", "NBCEI Electrical", "Plumbing PIRB", "SEIFSA"];
  const EXPOSURES = ["standard", "coastal/marine", "national park/protected", "industrial", "high-humidity"];

  // Premiums applied to all-in rate based on procurement context flags
  const FLAG_PREMIUM = {
    coastal:  { pct: 0.12, note: "Marine exposure: corrosion-resistant material & coating premium" },
    park:     { pct: 0.08, note: "Protected area: access restriction & environmental compliance allowance" },
    "24hr":   { pct: 0.10, note: "24-hour facility: after-hours & overtime premium" },
    remote:   { pct: 0.15, note: "Remote location: transport & accommodation premium" }
  };

  function premiumFor(flags) {
    let total = 0; const notes = [];
    (flags || []).forEach(f => { const p = FLAG_PREMIUM[f]; if (p) { total += p.pct; notes.push(p.note); } });
    return { multiplier: 1 + total, notes };
  }

  g.KH_COMPLIANCE = { COUNCILS, EXPOSURES, FLAG_PREMIUM, premiumFor };
})(window);