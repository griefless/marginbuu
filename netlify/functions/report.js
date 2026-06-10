/* KHUTHADZO SUPPLIES — Output generation endpoint */
function money(n) { return (Number(n) || 0).toFixed(2); }

export default async (req) => {
  const { items, parameters, preliminaries, format, contingencyPct, audit } = await req.json();

  // Rate substantiation CSV (Deliverable 2)
  const header = ["Item No", "Description", "Unit", "Qty", "All-in Rate", "Amount", "Material Source", "Source URL", "Retrieved", "Wage Grade", "Council", "Labour Basis", "Override Rationale"];
  const rows = items.map(i => {
    const rate = i.build ? i.build.allIn : 0;
    return [
      i.item_no, `"${(i.description || "").replace(/"/g, "'")}"`, i.unit, i.quantity, money(rate),
      money(rate * (parseFloat(i.quantity) || 0)),
      i.build?.materialSource || "", i.build?.materialUrl || "", i.build?.retrieved || "",
      i.trade || "", i.build?.council || "", `"${i.build?.labourBasis || ""}"`,
      i.override ? `"${i.override.rationale}"` : ""
    ].join(",");
  });
  const substantiationCsv = [header.join(","), ...rows].join("\n");

  // Variance & Risk (Deliverable 3)
  const byTrade = {};
  items.forEach(i => { const a = (i.build ? i.build.allIn : 0) * (parseFloat(i.quantity) || 0); byTrade[i.trade || "Other"] = (byTrade[i.trade || "Other"] || 0) + a; });
  const commodity = items.filter(i => /copper|steel|aluminium/i.test(i.description || "")).map(i => (i.description || "").slice(0, 30));
  const lowConfidence = items.filter(i => i.confidence === "low").length;

  const subtotal = items.reduce((t, i) => t + ((i.build ? i.build.allIn : 0) * (parseFloat(i.quantity) || 0)), 0);
  const prelimTotal = (preliminaries || []).reduce((t, p) => t + p.fixed + p.valueRelated + p.timeRelated, 0);
  const cont = (subtotal + prelimTotal) * ((contingencyPct || 0) / 100);
  const vat = (subtotal + prelimTotal + cont) * 0.15;

  return Response.json({
    format,
    totals: { subtotal, prelimTotal, contingency: cont, vat, grandTotal: subtotal + prelimTotal + cont + vat },
    substantiationCsv,
    variance: { byTrade, commodity, lowConfidence },
    auditEntries: audit || []
  });
};

export const config = { path: "/.netlify/functions/report", method: "POST" };