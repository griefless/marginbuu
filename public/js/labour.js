/* KHUTHADZO SUPPLIES — South African Labour Rate Engine */
(function (g) {
  "use strict";
  const ONCOST = 1.25; // leave pay, UIF, SDL, employer contributions

  const BASE = {                 // R / hour (pre-oncost)
    "Electrical Artisan": 115.00,
    "Civil Artisan": 95.00,
    "General Labourer": 30.22,
    "Painter": 95.00,
    "Tiler": 95.00,
    "Plasterer": 95.00,
    "Plumber": 95.00,
    "Electrician": 115.00
  };

  const SPEED_AREA = { "Painter": 3, "Tiler": 1.5, "Plasterer": 2, "General Labourer": 8 };       // m²/hr
  const SPEED_LINEAR = { "Painter": 0.5, "Tiler": 2, "Electrician": 15, "Plumber": 5, "General Labourer": 10 }; // lm/hr
  const SPEED_VOLUME = { "General Labourer": 0.75 };                                              // m³/hr
  const TASK_HOURS = { "db": 6, "geyser": 6, "light switch": 0.5 };
  const DEFAULT_TASK = 2;

  function hourly(trade) { return (BASE[trade] || 95.00) * ONCOST; }

  function unitRate(trade, unit, description) {
    const u = (unit || "").toLowerCase().trim();
    const r = hourly(trade);
    if (["m2", "m²", "sqm", "sq.m"].includes(u)) {
      const s = SPEED_AREA[trade] || SPEED_AREA["General Labourer"]; return { rate: r / s, basis: `${trade} @ ${s} m²/hr` };
    }
    if (["m", "lm", "rm", "linear metre"].includes(u)) {
      const s = SPEED_LINEAR[trade] || SPEED_LINEAR["General Labourer"]; return { rate: r / s, basis: `${trade} @ ${s} lm/hr` };
    }
    if (["m3", "m³", "cum"].includes(u)) {
      const s = SPEED_VOLUME["General Labourer"]; return { rate: r / s, basis: `Labourer @ ${s} m³/hr` };
    }
    // each / item-based
    const desc = (description || "").toLowerCase();
    let hrs = DEFAULT_TASK;
    for (const k in TASK_HOURS) if (desc.includes(k)) { hrs = TASK_HOURS[k]; break; }
    return { rate: r * hrs, basis: `${trade} ${hrs}h task @ ${KH_UTILS.money(r)}/hr` };
  }

  g.KH_LABOUR = { ONCOST, BASE, hourly, unitRate };
})(window);