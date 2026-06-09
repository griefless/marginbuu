# Morambol Supplies — BOQ Price Intelligence System (v3)

A professional tender pricing system for Morambol Supplies.  
Upload any South African client BOQ in any format → multi-format parsing engine → row classifier → hierarchy tree → live web scraping loop → Labour Rate Engine → full competitive report.

> **v3 change:** Multi-format intake (PDF, DOCX, image OCR, paste), 9-category detection,
> supply-and-install auto-splitting, row classifier with hierarchy tree, two-tab review table
> with promote-to-line-items workflow, and expanded report summary added.
> The Labour Rate Engine (MBSA / BIBC / CETA / DoEL / PSIRA / ECSA) is fully integrated.

---

## Architecture

```
BOQ Input (xlsx · xls · csv · pdf · docx · txt · jpg · png · paste)
        ↓
  ┌─────────────────────────────────────────────────────────────────┐
  │  SECTION A — INTAKE ROUTER                                     │
  │    Detects file type → routes to correct parser                │
  │                                                                 │
  │  SECTION B — PARSERS                                            │
  │    B1  XLSX / XLS / CSV  (xlsx library)                        │
  │    B2  DOCX              (mammoth)                             │
  │    B3  Text PDF          (pdf-parse)                           │
  │    B4  Scanned PDF/Image (pdfjs-dist → sharp → tesseract.js)  │
  │    B5  Plain text paste  (raw string)                          │
  │                                                                 │
  │  SECTION C — COLUMN STRUCTURE DETECTOR                         │
  │    Header row detection · synonym map · data-type inference    │
  │                                                                 │
  │  SECTION D — LINE ITEM EXTRACTOR                               │
  │    Unit normalisation · category detection · spec extraction   │
  │    Labour detection · supply-and-install splitting             │
  └─────────────────────────────────────────────────────────────────┘
        ↓  normalised line items
  Line Item Review Table (user can correct before search)
        ↓  confirmed items
  ┌─────────────────────────────────────────────────────────────────┐
  │  Netlify Function: search-prices.js                            │
  │                                                                 │
  │  SECTION E — SEARCH                                            │
  │    Serper API → Google ZA → 7+ SA supplier URLs                │
  │                                                                 │
  │  SECTION F — SCRAPE (parallel)                                 │
  │    Direct fetch (browser UA) → HTML                            │
  │    Cloudflare detected? → FlareSolverr → HTML                  │
  │                                                                 │
  │  SECTION G — EXTRACT (4-strategy cascade)                      │
  │    1. JSON-LD schema.org Product/Offer                         │
  │    2. meta itemprop / data-price attrs                         │
  │    3. Embedded JSON blobs (Shopify/Woo/Magento)                │
  │    4. ZAR regex on body text                                   │
  └─────────────────────────────────────────────────────────────────┘
        ↓
  Labour Rate Engine (Phase 3 — client-side, no API call)
    MBSA · BIBC · CETA · DoEL/NMW · PSIRA · ECSA
        ↓
  Report: Summary · BOQ Overview · Supplier Prices · Best-Price Quote
          Labour & Installation · SA Compliance
```

---

## Project structure

```
morambol-boq/
├── netlify.toml          ← Netlify config (timeout = 26s, env var docs)
├── package.json          ← npm dependencies
├── index.html            ← Full front-end SPA (single file)
└── search-prices.js      ← Netlify serverless function (Sections A–H)
```

---

## Environment Variables

Set in: **Netlify Dashboard → Your site → Site configuration → Environment variables**

| Variable | Required | Purpose |
|---|---|---|
| `SERPER_API_KEY` | ✅ Required | Google ZA search. Free key at https://serper.dev (2,500/month) |
| `FLARESOLVERR_URL` | Optional | Cloudflare bypass. e.g. `http://your-vps:8191` |
| `MISTRAL_API_KEY` | Optional | Cloud OCR fallback for scanned PDFs. https://console.mistral.ai |
| `OPENAI_API_KEY` | Optional | Alternative cloud OCR fallback. https://platform.openai.com |

> If neither `MISTRAL_API_KEY` nor `OPENAI_API_KEY` is set, local Tesseract.js OCR is used.
> If both are set, `MISTRAL_API_KEY` takes priority.

---

## Supported Input Formats

| Format | Extension | Parser | Notes |
|---|---|---|---|
| Excel (modern) | `.xlsx` | xlsx (client-side) | Full column detection, merged cells |
| Excel (legacy) | `.xls` | xlsx (client-side) | All sheet versions |
| Spreadsheet | `.csv` | xlsx (client-side) | Comma or tab separated |
| Word Document | `.docx` | mammoth (server) | Table and paragraph extraction |
| Digital PDF | `.pdf` | pdf-parse (server) | Text layer extraction |
| Scanned PDF | `.pdf` | pdfjs-dist + Tesseract.js (server) | OCR, 2–8s per page |
| Image | `.jpg`, `.jpeg`, `.png` | sharp + Tesseract.js (server) | Pre-processed before OCR |
| Plain text | `.txt` or paste | regex parser (client) | Tab/space/comma separated |

> **OCR note:** Tesseract.js is ~15 MB. For BOQs with more than ~10 scanned pages,
> consider moving the OCR to a Netlify Background Function (`ocr-intake.js`) for the
> 15-minute timeout. See `netlify.toml` for full documentation.

---

## 9 Supported Categories

| Category | Trigger keywords (examples) |
|---|---|
| Civil & Construction | concrete, rebar, formwork, earthworks, filling, backfill, excavat, brick, block, mortar, screed, plaster, paving |
| Plumbing & Drainage | pipe, fitting, valve, sanitary, basin, toilet, sewer, drain, uPVC, HDPE, PPR, copper tube, tap, cistern |
| Electrical & LV Systems | cable, conduit, DB, MCB, RCCB, isolator, socket, light, switch, busbar, earthing, armoured, switchgear |
| Mechanical & HVAC | duct, fan, AHU, chiller, VRF, pump, compressor, refrigerant, insulation, diffuser, grille, damper |
| Fencing & Security | fence, palisade, razor wire, gate, CCTV, access control, boom, barrier, electric fence, mesh |
| General Supplies & PPE | gloves, helmet, vest, boot, goggles, tape, consumable, hardware, fastener, bolt, nut, washer |
| Health & Medical | bandage, first aid, stretcher, medication, sanitiser, PPE kit, medical |
| Electronics & ICT | switch, router, server, UPS, structured cabling, fibre, patch panel, rack, CCTV, IP camera |
| Labour & Installation | install, erect, lay, fix, weld, connect, terminate, commission, test, paint, demolish, excavate |

Items matching no category are flagged as **Unclassified** for manual review.

---

## Unit Normalisation

| Input variants | Normalised output |
|---|---|
| m, metre, meters, lin m, linear metre, LM, L/M | `lm` |
| m2, sqm, sq m, square metre, m², SQM | `m²` |
| m3, cum, cubic metre, m³, CUM | `m³` |
| ea, each, item, no, nr, pc, pcs, unit | `each` |
| h, hr, hour, hrs, man-hour, MH | `hr` |
| kg, kilo, kilogram | `kg` |
| t, ton, tonne, MT | `t` |
| day, days | `day` |
| ls, sum, lot, lump sum | `ls` |

---

## Labour Rate Engine

Regulated South African labour rates — all client-side, no API call required.

| Trade Code | Authority | Rate/hr (mid-band) | Source |
|---|---|---|---|
| ELEC_ARTISAN | BIBC | R 100.00 | BIBC Wage Schedule 2024/25 |
| ELEC_APPRENTICE | BIBC | R 62.50 | BIBC Wage Schedule 2024/25 |
| CIVIL_FOREMAN | MBSA | R 112.50 | MBSA Regional Agreement 2024 |
| CIVIL_ARTISAN | MBSA | R 82.50 | MBSA Regional Agreement 2024 |
| CIVIL_LABOURER | DoEL | R 28.79 | National Minimum Wage 2024 |
| MECH_ARTISAN | CETA | R 90.00 | CETA Artisan Benchmarks 2024 |
| SECURITY_GUARD | PSIRA | R 31.00 | PSIRA Grade C/D Rates 2024 |
| PROF_ENGINEER | ECSA | R 875.00 | ECSA Fee Guideline 2023 |
| GENERAL_LABOURER | DoEL | R 28.79 | NMW Fallback |

Oncost multiplier: **1.25** (UIF 1% + SDL 1% + employer burden 23%)

### Labour Detection Keywords

`install`, `terminate`, `connect`, `commission`, `erect`, `lay`, `pull`, `glue`, `compact`,
`reinforce`, `pour`, `strip`, `formwork`, `joint`, `fix`, `weld`, `solder`, `mount`, `hang`,
`electrician`, `artisan`, `plumber`, `bricklayer`, `carpenter`, `steel fixer`, `scaffolding`,
`operator`, `labourer`, `foreman`, `welder`, `fitter`, `boilermaker`, `millwright`,
`security`, `guard`, `PSIRA`, `armed response`, `access control officer`,
`engineer`, `design`, `supervision`, `inspection`, `ECSA`, `architect`, `consulting`

### Supply-and-Install Auto-Splitting

Descriptions containing `supply and install`, `supply & install`, `S&I`, or
`supply, deliver and install` (case-insensitive) are automatically split into two child items:

- `1.1a` — `[SUPPLY]` — item_type: material → price searched via web scraping
- `1.1b` — `[INSTALL]` — item_type: labour → rate resolved from Labour Rate Engine

---

## npm Dependencies

| Package | Version | Purpose |
|---|---|---|
| `xlsx` | 0.18.5 | XLSX/XLS/CSV parsing (client + server) |
| `mammoth` | 1.7.2 | DOCX → plain text extraction |
| `pdf-parse` | 1.1.1 | Text-layer extraction from digital PDFs |
| `pdfjs-dist` | 4.3.136 | Render scanned PDF pages to PNG for OCR |
| `sharp` | 0.33.4 | Image pre-processing (greyscale + contrast) before OCR |
| `tesseract.js` | 5.1.0 | OCR for scanned PDFs and JPG/PNG images |

> `tesseract.js` adds ~15 MB to the function bundle. If Netlify's 50 MB limit is hit,
> move OCR to a dedicated Background Function.

---

## Deploy to Netlify

### Option A — Netlify Drop

1. Go to **https://app.netlify.com/drop**
2. Drag the `system/` folder onto the page
3. Add environment variables in Site config

### Option B — Netlify CLI

```bash
npm install -g netlify-cli
netlify login
cd /Users/imagineit/Downloads/system
npm install
netlify env:set SERPER_API_KEY your_key_here
netlify deploy --prod
```

---

## Local Development

```bash
npm install
netlify dev  # http://localhost:8888
```

Create a `.env` file:
```
SERPER_API_KEY=your_key_here
FLARESOLVERR_URL=http://localhost:8191
```

---

## SA Compliance Covered

**Materials:**
CIDB Act 38/2000 · OHS Act 85/1993 · Electrical Installation Regs 2009 ·
SANS 1507 / SANS 60227 · SANS 1808 · SANS 60947-2 / SANS 61008 ·
SANS 10142-1 · SANS 10100-1 · VAT Act 89/1991 · BBBEE Act 53/2003 ·
Companies Act 71/2008

**Labour:**
National Minimum Wage Act 9/2018 · MBSA Regional Wage Agreement 2024 ·
BIBC Main Agreement · CETA SDL Act 9/1999 · PSIRA Act 56/2001 ·
ECSA Fee Guideline 2023 · UIF Act 63/2001

---

## How the Parser Works

### Row Classification

Every row extracted from a BOQ file passes through `classifyRow()` before any line item is priced. The classifier assigns one of five `row_type` values using five ordered rules:

| Rule | row_type | Condition |
|---|---|---|
| 1 | `summary` | Description contains a summary keyword (total, VAT, sub-total, etc.) |
| 2 | `section_heading` | item_no has no `.` AND no unit/qty — OR all-caps description with no item_no/unit/qty |
| 3 | `narrative` | No item_no, no unit, no qty, description > 15 chars |
| 4 | `subsection_heading` | item_no has exactly one `.` AND no unit/qty |
| 5 | `line_item` | item_no has at least one `.`, has unit and positive qty (confidence: high) — or partial match (confidence: low, incomplete: true) |

Summary patterns matched: `carried forward`, `carry forward`, `brought forward`, `total for bill`, `sub-total`, `subtotal`, `grand total`, `add : value added tax`, `add: vat`, `vat @`, `bill no.`

### Hierarchy Tree

After classification, `buildHierarchyTree()` walks every row in order and builds a context stack:

```
Section heading:     ELECTRICAL WORKS
  Subsection:        HV Distribution Cables
    Narrative:       All cables to be SANS 1507-3 armoured, installed in duct
      Line item 2.1.1  Supply 35mm² 4-core SWA cable   100  m
                       ↑ inherits:
                         section_name:    "ELECTRICAL WORKS"
                         subsection_name: "HV Distribution Cables"
                         context_note:    "All cables to be SANS 1507-3 armoured..."
      Line item 2.1.2  Supply 16mm² 4-core SWA cable    50  m
                       ↑ context_note cleared (narrative was consumed by 2.1.1)
  Subsection:        LV Distribution
    Line item 2.2.1  ...
```

Only `line_item` rows are passed to the price search loop. All other row types go into `excludedRows`.

### context_note Inheritance

A narrative row immediately before a line item has its text attached as `context_note` to that item. The context_note is:
- **Consumed** by the first line item that follows it (cleared after attachment)
- Used in **category detection** — the classifier scans `section + subsection + context_note + description` together, so a cable item under heading "ELECTRICAL WORKS" is correctly classified even if the description alone says only "35mm² cable"
- Used in **search query building** — first 60 characters appended to the Serper query for richer product matching
- **Displayed** in the review table as a tooltip on each row and as a sub-line in the BOQ Overview report tab

### Two-Tab Review Table

After parsing, before the price search runs, the system shows a review stage with two tabs:

**Tab 1 — Line Items**

Editable table of all priceable items with columns:
Item No · Section · Description · Context Note · Category · Unit · Qty · Type · Confidence · Flags

Each row is fully editable: Category (dropdown), Type (material/labour/S&I split), Unit, Qty.  
Rows are grouped visually by `section_name` (dark navy separator) and `subsection_name` (light separator).

**Tab 2 — Excluded Rows**

All rows classified as summary, section_heading, subsection_heading, or narrative. Columns:
Item No · Description · Classified As · Confidence · Action

Each excluded row has a **Promote → Line Items** button. Clicking it:
1. Moves the row from `excludedRows` into `boqItems` with `incomplete: true` and `classification_confidence: 'low'`
2. Re-renders both tabs with updated counts
3. Shows a toast confirmation

This lets users rescue any row the classifier got wrong — for example, a lump-sum item with no unit/qty that was classified as a narrative.

### Confirmation Gate

The **Search & Analyse Prices** button stays disabled until the user checks:
> "I have reviewed the parsed items and confirmed the line items are correct"

This prevents accidental Serper API calls on unreviewed data.

---

## Customisation

| What | Where |
|---|---|
| Add SA retailers | `RETAILER_MAP` in `search-prices.js` |
| Add category keywords | `CATEGORY_KEYWORDS` in `search-prices.js` Section D |
| Add unit synonyms | `UNIT_NORMALISE` in `search-prices.js` Section D |
| Update labour rates | `LABOUR_RATES` constant in `index.html` |
| Change VAT rate | `meta.vat = 0.15` in `index.html` |
| Change country | `gl: 'za'` in `serperSearch()` in `search-prices.js` |
| Tune scraping concurrency | `SCRAPE_CONCURRENCY` in `search-prices.js` |
| Company branding | `.topbar` section in `index.html` |
