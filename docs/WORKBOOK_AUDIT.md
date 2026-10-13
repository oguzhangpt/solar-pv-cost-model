# Workbook Audit — `IRENA_TSSC_Solar_PV_Manufacturing_Cost_Model_v1.xlsx`

Phase 1 audit, performed before building the application. Every finding comes from the workbook itself, read with openpyxl (formulas + cached values) and the raw sheet XML for chart and validation extensions. Findings were then confirmed by executing all formulas (`tools/extract_workbook.py`, `app/assets/js/engine.js`). The cell-level map of inputs, outputs and formulas is in [`INPUT_OUTPUT_MAP.md`](INPUT_OUTPUT_MAP.md). Reconciliation results are in [`VALIDATION_REPORT.md`](VALIDATION_REPORT.md).

| Item | Finding |
|---|---|
| File | 1.61 MB, SHA-256 `0006407fad4fe2fc9a98887705b7ab0ac1288193e2f280f5746e9d14f795e884` |
| Purpose (About sheet) | IRENA decision-support tool under the CEM *Transforming Solar Supply Chains* initiative, supported by the Government of Australia (DCCEEW). It models the levelised cost of production (LCOP, USD/Wp) of crystalline-silicon modules from polysilicon to module. |
| Protection | Workbook structure plus the Title, About, Inputs, Output_Visualization and Calculations sheets are password-protected. Parsing is read-only; the original file is never modified. |
| Calculation settings | Automatic (`calcId=191028`). No circular references. Cached results are reliable: all 1,506 formulas recomputed independently equal the cached values exactly. |
| Currency / units | USD throughout. No FX, inflation or discounting. Outputs are in USD/Wp, with polysilicon in USD/kg. |
| Time base | Yearly columns 2020–2030 (Calculations columns D–N). Import options apply only to 2025–2030. |

## 1. Worksheet inventory

| Sheet | Visible | Range | Cells | Formulas | Charts | Content |
|---|---|---|---:|---:|---:|---|
| Title | yes | — | 0 | 0 | 0 | Cover image only |
| About | yes | A1:R42 | 2 | 0 | 0 | Description, navigation steps, disclaimer, acknowledgements |
| Inputs | yes | A1:Z63 | 171 | 64 | 0 | Country selector (C3), sourcing selectors per stage and technology (C8, C19, C20 for TOPCon; C38, C49, C50 for Mono). Parameter blocks with *Default* (D, from Country_Index), *User Input* (E, empty) and *Final* (F = `IF(ISNUMBER(E),E,D)`). |
| Output_Visualization | yes | A1:I227 | 77 | 20 | 9 drawings (13 chart parts) | 4 waterfall tables (2025/2030 × TOPCon/Mono), 9 stacked-bar charts of stage components, 4 waterfall charts |
| Cost Model_Calculations | yes | A1:AB193 | 2,172 | 1,414 | 0 | The calculation engine: TOPCon rows 3–96, Mono PERC rows 99–192 |
| Assumptions | **hidden** | A1:K54 | 261 | 6 | 0 | Technical assumptions per technology, with year and source (NREL, ITRPV, pv magazine, IEA PVPS, IRENA calculations) |
| Country_Index | **hidden** | A1:R112 | 546 | 2 | 0 | Country default inputs (6 countries × 2 technologies) and import price tables (USD/Wp, 2025–2030) |
| Dropdown_Lists | **hidden** | A1:I12 | 19 | 0 | 0 | Allowed sources per country (named ranges `<Country>_SourceOptions`) |

There are no hidden rows or columns. Named ranges: six `*_SourceOptions` lists plus 12 hidden `_xlchart.*` names used by the waterfall charts. Data validation: `Inputs!C3` lists `Country_Index!D5:I5` (x14 extension), and the source cells use `INDIRECT($C$3 & "_SourceOptions")`.

## 2. Supported countries, technologies and configurations (verified)

- **Countries** (Country_Index header): Vietnam, Australia, China, Germany, India, US.
- **Technologies**: TOPCon (G12R wafer, 182×210 mm) and Monocrystalline p-type PERC (M10 wafer, 182×182 mm). Both are calculated in parallel. The "Technology Type" cells on the Inputs sheet are labels, not selectors.
- **Sourcing** (Dropdown_Lists):

| Manufacturing country | Options for polysilicon / wafer / cell |
|---|---|
| China | Domestic only |
| Germany, India, Australia, Vietnam | Domestic or China |
| US | Domestic or Vietnam |

Module assembly is always domestic. An imported stage is valued with the Country_Index import price for that origin→destination route and year (2025–2030 only).

## 3. Calculation engine (per technology, per year)

| Stage | Unit | Components (row, TOPCon) | Stage price |
|---|---|---|---|
| Polysilicon | USD/kg → USD/Wp | electricity (15) = kWh/kg × price; silicon metal (20) = Si price × conversion ratio; other material (21); building (16) = CAPEX/20 y; equipment (17) = CAPEX/10 y; maintenance (18) = 4 % × CAPEX; labour (19) = workers/kg × salary | (Σ + 15 % profit + overheads) × g/W ÷ 1000 → row 26 |
| Ingot & wafer | USD/Wp | electricity (39) = kWh/wafer ÷ W/wafer × price; other material (44) = USD/wafer ÷ W/wafer; building (40); equipment (41, 7 y); maintenance (42); labour (43) = workers/W × salary | row 48 |
| Cell | USD/Wp | electricity (60); other material (52) + silver (55) = row 65; building (61); equipment (62, 5 y); maintenance (63); labour (64) | row 69 |
| Module | USD/Wp | electricity (82); other material (87); building (83); equipment (84, 5 y); maintenance (85); labour (86); ESG certification (88) | row 92 |
| **Total** | USD/Wp | row 96 = 26 + 48 + 69 + 92 (row 95 = total excluding ESG) | |

In every stage: *Operating profit* = 0.15 × Σ components (hardcoded), and *Overheads* = (capacity × 0.9 × final price ÷ capacity) × overhead rate (10 %).

Watt-peak per wafer = wafer area × cell efficiency × 1000 W/m² (row 35). Module power = 66 × W per wafer (TOPCon row 77) or 0.182² × 1000 × 66 × efficiency (Mono row 173). Mono PERC mirrors the same structure in rows 99–192.

What each cost component is, in the prompt's terms:

- **Purchased input prices**: metal silicon, silver and electricity.
- **Consumption per unit**: kWh, g/W, kg of silver per cell, workers per unit.
- **Conversion costs**: the stage rows themselves.
- **Capital**: depreciation of equipment and building CAPEX.
- **Operating costs**: electricity, labour, maintenance and overheads.
- **"Price" elements**: the 15 % operating profit and the import price tables.

The workbook contains no market quotations or delivered procurement costs beyond the import tables.

**Double counting.** Each stage is a *conversion* increment: the wafer stage contains no polysilicon cost, the cell stage no wafer cost. The import tables are stage-level prices too (e.g. China→Vietnam cell 2025 = 0.0412 USD/Wp vs. China's own cell stage at 0.0403). Replacing a stage with its import price therefore never double counts. The application adds two documented extension modes for *all-in* purchased wafers or cells. These remove all upstream stages; validation confirms upstream inputs then have zero effect.

## 4. Hardcoded values (embedded in the calculation sheet)

- Operating profit factor `0.15` (8 rows) and overhead factor `0.9` (8 rows).
- Yearly series typed in directly:
  - polysilicon electricity use, metal silicon price, conversion ratio (2028–30) and g/W (2026–30);
  - wafer electricity use, cell efficiencies and cell electricity use (2026–30);
  - silver price (TOPCon row 56) and silver mass per cell (inside the row 55/151 formulas);
  - cell "other material" constants (inside the row 52/148 formulas);
  - module electricity (2030), cells per module (66) and module other material (0.055 from 2025);
  - Mono module area (0.182²).
- Import price tables in Country_Index rows 54–96: no source given.

## 5. Issues, inconsistencies and limitations

1. **Operating profit is inside "cost".** "Total Module Cost" includes a 15 % mark-up per stage, and overheads are computed on the price including that mark-up. The app shows the cost excluding operating profit separately and exposes the 15 % as a parameter.
2. **Capacity has almost no economic role.** It cancels out of overheads. Its only effect is ESG certification = 0.0006 × capacity (GW) USD/W, so a bigger factory gets a *higher* cost per Wp. This is a probable unit error, reproduced as-is and flagged. Polysilicon capacity has no effect at all, and the Mono polysilicon capacity inputs (F41:F42) are not referenced.
3. **No capacity utilisation** input exists. The 0.9 overhead factor is the only trace of one.
4. **No cost of capital.** Depreciation is straight-line with no WACC, despite the "levelised" label.
5. **Two different totals when stages are imported.** The calculation sheet (rows 96/192) always sums all four stages. The Output_Visualization waterfall zeroes polysilicon when wafers or cells are imported, and zeroes wafers when cells are imported. With stage-level import prices, the chart convention under-counts. The app uses rows 96/192 as the headline and validates both.
6. **Overheads 2020–2023** use the 2024 price (`$H$` anchors). For Mono PERC, the polysilicon, wafer and module overheads in 2020–2023 reference *TOPCon* 2024 prices. Only historic years are affected.
7. **15 Assumptions cells are not used** by any formula, for example polysilicon electricity 40 kWh/kg, metal silicon price, wafer thickness, wafer electricity and the Mono silver price. The TOPCon silver price is not linked to the Assumptions sheet. Module other material uses 0.055 for both technologies from 2025, whereas Assumptions lists 0.057 / 0.0513.
8. **Mono PERC efficiency.** Watt-peak per wafer uses row 129 (23.7 % in 2025), but module power uses row 150 (25.3 %). TOPCon rows 54, 74 and 75 are unused.
9. **Unit labels.** Silver "kg/Wp" is actually USD/Wp. Module electricity "kWh/module" is used as kWh/W. Mono "Cell (wafer) area" is labelled cm² but holds m².
10. **Country data.** China's TOPCon polysilicon electricity price (0.065) differs from all other China electricity entries (0.08). Germany's 2025 capacity is a formula (`=0.2*10^9`).
11. **Not modelled:** tariffs, subsidies, taxes, logistics, FX and inflation (unless embedded in the undocumented import prices). Materials other than silver are not itemised: glass, aluminium, copper, EVA/POE, junction box and backsheet sit inside one lump-sum module material line.
12. **Imports only for 2025–2030.** Earlier years are always domestic.

## 6. Charts in the workbook

- 9 clustered bar charts: domestic stage components for 2025 and 2030, per technology.
- 1 bar chart: total module cost 2025–2030 for both technologies.
- 4 waterfalls: module cost composition for 2025 and 2030, per technology, using the Output_Visualization convention.

The application reproduces these views for any year, country and configuration.
