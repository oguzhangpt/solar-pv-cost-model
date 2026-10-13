/*
 * Semantic model layer.
 *
 * Maps the workbook's cells to business concepts -- value-chain stages, cost
 * components, cost categories and user-editable parameters -- and turns an
 * application "state" (country, technology, year, sourcing, parameter edits,
 * calculation mode) into a patch for the workbook engine and a structured
 * result. Every number shown in the UI comes from the workbook formulas
 * evaluated by PVEngine; this layer only selects, labels and aggregates.
 */
(function (root) {
  "use strict";
  var Engine = root.PVEngine || (typeof require !== "undefined" ? require("./engine.js") : null);

  var CALC = "Cost Model_Calculations";
  var YEARS = [2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030];
  var YEAR_COLS = "DEFGHIJKLMN".split("");
  var IMPORT_COLS = "DEFGHI".split(""); // Country_Index import tables: 2025..2030
  var FIRST_IMPORT_YEAR = 2025;
  var COUNTRIES = ["China", "Vietnam", "India", "Germany", "US", "Australia"];
  var IMPORT_DEST_OFFSET = { Vietnam: 0, India: 1, Australia: 2, Germany: 3, US: 4 };

  function yc(year) { return YEAR_COLS[YEARS.indexOf(year)]; }
  function cc(row, year) { return CALC + "!" + yc(year) + row; }
  function rowCells(row) { return YEAR_COLS.map(function (c) { return CALC + "!" + c + row; }); }

  // Cost categories used for shares and charts.
  var CATEGORIES = {
    materials: { label: "Materials & consumables", color: "#2a78d6" },
    energy: { label: "Electricity", color: "#e8a33c" },
    labour: { label: "Labour", color: "#1f9e89" },
    capital: { label: "Capital (equipment & buildings depreciation)", color: "#7a5cc8" },
    maintenance: { label: "Maintenance", color: "#9aa5b1" },
    overhead: { label: "Overheads", color: "#c4708a" },
    esg: { label: "ESG certification", color: "#5fae4e" },
    margin: { label: "Operating profit (15% mark-up)", color: "#5b6573" },
    imported: { label: "Imported stage (purchased price)", color: "#d1495b" },
    purchased: { label: "Purchased intermediate (extension mode)", color: "#8c2f39" }
  };

  // --------------------------------------------------------- technologies
  // Row numbers refer to the workbook ('Cost Model_Calculations' unless noted).
  var TECH = {
    topcon: {
      id: "topcon", label: "TOPCon", longLabel: "TOPCon (n-type, G12R 182×210 mm wafer)", col: "D",
      inputRows: { polyCap25: 11, polyCap30: 12, polyElec: 13, polySalary: 14, polyEquip: 15, polyBld: 16,
                   cap25: 23, cap30: 24, eqW: 25, eqC: 26, eqM: 27, elec: 28, salary: 29, bldW: 30, bldC: 31, bldM: 32 },
      sourceCells: { poly: "Inputs!C8", wafer: "Inputs!C19", cell: "Inputs!C20" },
      totalWithEsg: 96, totalNoEsg: 95, modulePower: 77, gPerW: 10, waferPower: 35,
      importBase: { poly: 56, wafer: 66, cell: 74 },
      vizRows: { 2025: [199, 203], 2030: [215, 219] },
      stages: {
        poly: { total: 26, perKg: 25, comps: [[15, "electricity"], [20, "silicon"], [21, "polyOther"], [17, "equipment"], [16, "building"], [18, "maintenance"], [19, "labour"], [14, "overhead"], [23, "margin"]] },
        wafer: { total: 48, comps: [[39, "electricity"], [44, "waferOther"], [41, "equipment"], [40, "building"], [42, "maintenance"], [43, "labour"], [38, "overhead"], [46, "margin"]] },
        cell: { total: 69, comps: [[60, "electricity"], [55, "silver"], [52, "cellOther"], [62, "equipment"], [61, "building"], [63, "maintenance"], [64, "labour"], [59, "overhead"], [67, "margin"]] },
        module: { total: 92, comps: [[82, "electricity"], [87, "moduleOther"], [84, "equipment"], [83, "building"], [85, "maintenance"], [86, "labour"], [88, "esg"], [81, "overhead"], [90, "margin"]] }
      },
      series: { polyElecUse: 6, siPrice: 7, siRatio: 9, gPerW: 10, polyOther: 11, waferElecUse: 29, waferOther: 30,
                efficiency: [33], cellElecUse: 51, cellOther: 52, silverLoad: 55, silverPrice: 56,
                moduleElecUse: 72, moduleOther: 87, cellsPerModule: 73 },
      profitRows: [23, 46, 67, 90]
    },
    mono: {
      id: "mono", label: "Mono PERC", longLabel: "Monocrystalline p-type PERC (M10 182×182 mm wafer)", col: "E",
      inputRows: { polyCap25: 41, polyCap30: 42, polyElec: 43, polySalary: 44, polyEquip: 45, polyBld: 46,
                   cap25: 53, cap30: 54, eqW: 55, eqC: 56, eqM: 57, elec: 58, salary: 59, bldW: 60, bldC: 61, bldM: 62 },
      sourceCells: { poly: "Inputs!C38", wafer: "Inputs!C49", cell: "Inputs!C50" },
      totalWithEsg: 192, totalNoEsg: 191, modulePower: 173, gPerW: 106, waferPower: 131,
      importBase: { poly: 56, wafer: 84, cell: 92 },
      vizRows: { 2025: [207, 211], 2030: [223, 227] },
      stages: {
        poly: { total: 122, perKg: 121, comps: [[111, "electricity"], [116, "silicon"], [117, "polyOther"], [113, "equipment"], [112, "building"], [114, "maintenance"], [115, "labour"], [110, "overhead"], [119, "margin"]] },
        wafer: { total: 144, comps: [[135, "electricity"], [140, "waferOther"], [137, "equipment"], [136, "building"], [138, "maintenance"], [139, "labour"], [134, "overhead"], [142, "margin"]] },
        cell: { total: 165, comps: [[156, "electricity"], [151, "silver"], [148, "cellOther"], [158, "equipment"], [157, "building"], [159, "maintenance"], [160, "labour"], [155, "overhead"], [163, "margin"]] },
        module: { total: 188, comps: [[178, "electricity"], [183, "moduleOther"], [180, "equipment"], [179, "building"], [181, "maintenance"], [182, "labour"], [184, "esg"], [177, "overhead"], [186, "margin"]] }
      },
      series: { polyElecUse: 102, siPrice: 103, siRatio: 105, gPerW: 106, polyOther: 107, waferElecUse: 125, waferOther: 126,
                efficiency: [129, 150], cellElecUse: 147, cellOther: 148, silverLoad: 151, silverPrice: 152,
                moduleElecUse: 168, moduleOther: 183, cellsPerModule: 169 },
      profitRows: [119, 142, 163, 186]
    }
  };

  var STAGES = [
    { id: "poly", label: "Polysilicon", short: "Poly", plain: "Refining metallurgical silicon into high-purity polysilicon (costed per kg, converted to USD/Wp)." },
    { id: "wafer", label: "Ingot & wafer", short: "Wafer", plain: "Growing silicon ingots and slicing them into wafers (conversion cost only — the polysilicon is costed in the stage before)." },
    { id: "cell", label: "Solar cell", short: "Cell", plain: "Turning wafers into solar cells, incl. silver contacts (conversion cost only — the wafer is costed in the stage before)." },
    { id: "module", label: "Module assembly", short: "Module", plain: "Assembling cells into the finished module: other bill-of-materials, ESG certification (conversion cost only)." }
  ];

  // Component types: label, category, plain-language explanation.
  var COMP = {
    electricity: { label: "Electricity", cat: "energy", how: "Electricity consumption per unit × electricity price of the manufacturing country." },
    silicon: { label: "Silicon metal (raw material)", cat: "materials", how: "Metal silicon price (China) × silicon-to-polysilicon conversion ratio (kg of metal per kg of poly)." },
    polyOther: { label: "Other materials & chemicals", cat: "materials", how: "Other polysilicon process materials, USD per kg of polysilicon (hardcoded series)." },
    waferOther: { label: "Other materials (crucibles, wire, etc.)", cat: "materials", how: "Other wafering materials in USD per wafer ÷ watt-peak per wafer." },
    cellOther: { label: "Other cell materials & chemicals", cat: "materials", how: "Fixed USD-per-cell constant embedded in the formula ÷ watt-peak per wafer." },
    silver: { label: "Silver paste", cat: "materials", how: "Silver mass per cell (constant embedded in the formula, kg) × silver price ÷ watt-peak per wafer. Note: the workbook labels this row 'kg/Wp' but the result is USD/Wp." },
    moduleOther: { label: "Other module materials (glass, frame, encapsulant, …)", cat: "materials", how: "Lump-sum module bill-of-materials (excl. cells) in USD/Wp — not itemised in the workbook." },
    equipment: { label: "Equipment depreciation", cat: "capital", how: "Equipment CAPEX ÷ equipment lifetime (straight-line, no financing cost)." },
    building: { label: "Buildings & facilities", cat: "capital", how: "Building & facilities CAPEX ÷ building lifetime (straight-line)." },
    maintenance: { label: "Maintenance", cat: "maintenance", how: "Maintenance % × (equipment CAPEX + building CAPEX)." },
    labour: { label: "Labour", cat: "labour", how: "Workers required per unit × average engineer salary of the country." },
    esg: { label: "ESG certification", cat: "esg", how: "ESG certification assumption × installed capacity (GW). The workbook scales this with capacity, so larger factories show a HIGHER cost per Wp — flagged as a likely formula issue." },
    overhead: { label: "Overheads", cat: "overhead", how: "Overhead % × 0.9 × stage price (incl. operating profit). Installed capacity cancels out of this formula." },
    margin: { label: "Operating profit", cat: "margin", how: "15% mark-up on the stage's direct costs (hardcoded in the workbook; editable here as a documented parameter)." }
  };

  // ------------------------------------------------------------ parameters
  // kinds:
  //   input  -> country-specific value on the Inputs sheet; edit writes the "User Input" column (E)
  //   scalar -> single Assumptions cell
  //   series -> a row of yearly values (scaled by a multiplier, trajectory preserved)
  //   import -> a block of the Country_Index import-price tables (scaled)
  //   global -> application-level parameter replacing a hardcoded formula constant
  var PARAM_GROUPS = [
    { id: "capacity", label: "Production capacity" },
    { id: "energy", label: "Electricity & energy" },
    { id: "labour", label: "Labour" },
    { id: "materials", label: "Material & consumable prices" },
    { id: "yield", label: "Material consumption, efficiency & yield" },
    { id: "capex", label: "Capital expenditure & equipment" },
    { id: "depreciation", label: "Depreciation & equipment lifetime" },
    { id: "supply", label: "Supply chain — imported stage prices" },
    { id: "other", label: "Other manufacturing assumptions" }
  ];

  function buildParams(t) {
    var T = TECH[t], P = [], R = T.inputRows, S = T.series, col = T.col;
    function inp(key, id, label, group, unit, stage, cls, effect, extra) {
      P.push(Object.assign({ id: t + "." + id, tech: t, kind: "input", cell: "Inputs!F" + R[key], inputCell: "Inputs!E" + R[key],
        defaultCell: "Inputs!D" + R[key], label: label, group: group, unit: unit, stage: stage, cls: cls,
        countrySpecific: true, effect: effect, editable: true, source: "Inputs!D" + R[key] + " ← Country_Index" }, extra || {}));
    }
    function sc(row, id, label, group, unit, stage, cls, effect, extra) {
      P.push(Object.assign({ id: t + "." + id, tech: t, kind: "scalar", cell: "Assumptions!" + col + row, label: label, group: group,
        unit: unit, stage: stage, cls: cls, effect: effect, editable: true, source: "Assumptions!" + col + row }, extra || {}));
    }
    function se(rows, id, label, group, unit, stage, cls, effect, extra) {
      rows = [].concat(rows);
      var cells = [];
      rows.forEach(function (r) { cells = cells.concat(rowCells(r)); });
      P.push(Object.assign({ id: t + "." + id, tech: t, kind: "series", cells: cells, row: rows[0], label: label, group: group,
        unit: unit, stage: stage, cls: cls, effect: effect, editable: true,
        source: rows.map(function (r) { return CALC + "!D" + r + ":N" + r; }).join(" + ") }, extra || {}));
    }
    function im(stage, label, extra) {
      var base = T.importBase[stage], cells = [];
      for (var r = base; r <= base + 4; r++) IMPORT_COLS.forEach(function (c) { cells.push("Country_Index!" + c + r); });
      P.push(Object.assign({ id: t + ".import." + stage, tech: stage === "poly" ? "both" : t, kind: "import", cells: cells, stage: stage,
        label: label, group: "supply", unit: "USD/Wp", cls: "Intermediate product", editable: true,
        effect: "Only used when this stage is sourced as 'Imported' (years 2025–2030). Replaces the domestic stage cost.",
        source: "Country_Index!D" + base + ":I" + (base + 4) }, extra || {}));
    }

    // Capacity
    inp("cap25", "capacity2025", "Installed wafer/cell/module capacity (2025)", "capacity", "Wp", "module", "Production / yield parameter",
      "Used for 2020–2027. In the workbook it cancels out of overheads and only scales the ESG certification cost (higher capacity → higher ESG cost per Wp).");
    inp("cap30", "capacity2030", "Projected wafer/cell/module capacity (2030)", "capacity", "Wp", "module", "Production / yield parameter",
      "Used for 2028–2030. Same behaviour as the 2025 capacity (ESG certification only).");
    inp("polyCap25", "polyCapacity2025", "Installed polysilicon capacity (2025)", "capacity", "kg", "poly", "Production / yield parameter",
      "Referenced by the polysilicon overhead formula but cancels out mathematically (capacity × 0.9 ÷ capacity) — no effect on cost.",
      { editable: false, noEffect: true });
    // Energy
    inp("polyElec", "polyElecPrice", "Electricity price — polysilicon", "energy", "USD/kWh", "poly", "Energy",
      "Multiplies polysilicon electricity use (kWh/kg). Polysilicon is the most electricity-intensive stage.");
    inp("elec", "elecPrice", "Electricity price — wafer, cell & module", "energy", "USD/kWh", "wafer", "Energy",
      "Multiplies electricity use of the wafer, cell and module stages.");
    se(S.polyElecUse, "polyElecUse", "Polysilicon electricity consumption", "energy", "kWh/kg", "poly", "Energy",
      "Electricity needed per kg of polysilicon (workbook trajectory 2020–2030).");
    se(S.waferElecUse, "waferElecUse", "Ingot & wafer electricity consumption", "energy", "kWh/wafer", "wafer", "Energy",
      "Electricity per wafer, divided by watt-peak per wafer.");
    se(S.cellElecUse, "cellElecUse", "Cell electricity consumption", "energy", "kWh/W", "cell", "Energy", "Electricity per watt of cells.");
    se(S.moduleElecUse, "moduleElecUse", "Module electricity consumption", "energy", "kWh/W", "module", "Energy",
      "Electricity per watt of modules (workbook unit label says kWh/module; the formula treats it as kWh/W).");
    // Labour
    inp("polySalary", "polySalary", "Average engineer salary — polysilicon", "labour", "USD/year", "poly", "Labour",
      "Multiplied by workers per kg of polysilicon.");
    inp("salary", "salary", "Average engineer salary — wafer, cell & module", "labour", "USD/year", "wafer", "Labour",
      "Multiplied by workers per W in the wafer, cell and module stages.");
    sc(9, "polyWorkers", "Labour intensity — polysilicon", "labour", "workers per kg", "poly", "Labour", "Workers needed per kg of annual polysilicon output.");
    sc(27, "waferWorkers", "Labour intensity — wafer", "labour", "workers per W", "wafer", "Labour", "Workers per W of annual wafer output.");
    sc(38, "cellWorkers", "Labour intensity — cell", "labour", "workers per W", "cell", "Labour", "Workers per W of annual cell output.");
    sc(48, "moduleWorkers", "Labour intensity — module", "labour", "workers per W", "module", "Labour", "Workers per W of annual module output.");
    // Materials
    se(S.siPrice, "siPrice", "Metal silicon price (China)", "materials", "USD/kg", "poly", "Raw material",
      "Price of metallurgical-grade silicon, the raw material for polysilicon.");
    se(S.polyOther, "polyOther", "Other polysilicon materials", "materials", "USD/kg", "poly", "Consumable / process chemical",
      "Other process materials per kg of polysilicon.");
    se(S.waferOther, "waferOther", "Other wafer materials", "materials", "USD/wafer", "wafer", "Consumable / process chemical",
      "Other materials per wafer (workbook header row says USD/Wp for the Assumptions source; the calculation uses it per wafer).");
    se(S.silverPrice, "silverPrice", "Silver price", "materials", "USD/kg", "cell", "Raw material",
      t === "topcon" ? "Silver price used for cell metallisation (TOPCon: hardcoded yearly series, not linked to the Assumptions sheet)." :
        "Silver price used for cell metallisation (Mono: linked to Assumptions!D36).");
    se(S.cellOther, "cellOther", "Other cell materials (embedded constant)", "materials", "USD/cell", "cell", "Consumable / process chemical",
      "A USD-per-cell constant written inside the formula (e.g. =0.035/D35). Scaling it scales the row result.");
    se(S.moduleOther, "moduleOther", "Other module materials (BOM excl. cells)", "materials", "USD/Wp", "module", "Intermediate product",
      "Lump-sum non-cell module materials (glass, frame, encapsulant, junction box are NOT itemised in the workbook).");
    // Consumption / yield
    se(S.siRatio, "siRatio", "Silicon-to-polysilicon conversion ratio", "yield", "kg Si / kg poly", "poly", "Production / yield parameter",
      "kg of metal silicon needed per kg of polysilicon (material yield). Lower = less silicon lost.");
    se(S.gPerW, "gPerW", "Polysilicon consumption per watt", "yield", "g/W", "poly", "Production / yield parameter",
      "Grams of polysilicon per watt of modules; converts the polysilicon cost from USD/kg to USD/Wp.");
    se(S.silverLoad, "silverLoad", "Silver loading per cell (embedded constant)", "yield", "kg/cell", "cell", "Production / yield parameter",
      "Silver mass per cell written inside the formula (e.g. 0.00013 kg in 2025). Scaling it scales the silver cost.");
    se(S.efficiency, "efficiency", "Solar cell efficiency", "yield", "%", "wafer", "Production / yield parameter",
      t === "topcon" ? "Sets watt-peak per wafer (area × efficiency × 1000 W/m²). Higher efficiency spreads per-wafer costs over more watts and raises module wattage." :
        "Sets watt-peak per wafer (row 129) and module rating (row 150). The workbook uses two different efficiency series for Mono PERC; both are scaled together.",
      { display: "pct" });
    sc(19, "waferArea", "Wafer area", "yield", "m²", "wafer", "Production / yield parameter",
      t === "topcon" ? "Wafer size (G12R). Drives watt-peak per wafer and module wattage." :
        "Wafer size (M10). Drives watt-peak per wafer. Note: the Mono module rating uses a separate hardcoded area (0.182×0.182).");
    se(S.cellsPerModule, "cellsPerModule", "Cells per module", "yield", "cells/module", "module", "Production / yield parameter",
      "Only affects module wattage (and so USD/module); USD/Wp is unchanged.");
    // CAPEX
    inp("polyEquip", "polyEquip", "Equipment CAPEX — polysilicon", "capex", "USD/kg", "poly", "Equipment / capital expenditure",
      "Investment per kg/year of capacity; depreciated over the equipment lifetime and drives maintenance.");
    inp("polyBld", "polyBld", "Building & facilities CAPEX — polysilicon", "capex", "USD/kg", "poly", "Equipment / capital expenditure",
      "Depreciated over the building lifetime and drives maintenance.");
    inp("eqW", "eqWafer", "Equipment CAPEX — wafer", "capex", "USD/kW", "wafer", "Equipment / capital expenditure", "Depreciated over the wafer equipment lifetime.");
    inp("eqC", "eqCell", "Equipment CAPEX — cell", "capex", "USD/kW", "cell", "Equipment / capital expenditure", "Depreciated over the cell equipment lifetime.");
    inp("eqM", "eqModule", "Equipment CAPEX — module", "capex", "USD/kW", "module", "Equipment / capital expenditure", "Depreciated over the module equipment lifetime.");
    inp("bldW", "bldWafer", "Building & facilities CAPEX — wafer", "capex", "USD/kWp", "wafer", "Equipment / capital expenditure", "Depreciated over the building lifetime.");
    inp("bldC", "bldCell", "Building & facilities CAPEX — cell", "capex", "USD/kWp", "cell", "Equipment / capital expenditure", "Depreciated over the building lifetime.");
    inp("bldM", "bldModule", "Building & facilities CAPEX — module", "capex", "USD/kWp", "module", "Equipment / capital expenditure", "Depreciated over the building lifetime.");
    sc(8, "polyMaint", "Maintenance — polysilicon", "capex", "% of CAPEX", "poly", "Other operating cost", "Annual maintenance as % of equipment + building CAPEX.");
    sc(23, "waferMaint", "Maintenance — wafer", "capex", "% of CAPEX", "wafer", "Other operating cost", "Annual maintenance as % of CAPEX.");
    sc(34, "cellMaint", "Maintenance — cell", "capex", "% of CAPEX", "cell", "Other operating cost", "Annual maintenance as % of CAPEX.");
    sc(44, "moduleMaint", "Maintenance — module", "capex", "% of CAPEX", "module", "Other operating cost", "Annual maintenance as % of CAPEX.");
    // Lifetimes
    sc(6, "polyEqLife", "Equipment lifetime — polysilicon", "depreciation", "years", "poly", "Equipment / capital expenditure", "Longer lifetime → lower annual depreciation.");
    sc(7, "polyBldLife", "Building lifetime — polysilicon", "depreciation", "years", "poly", "Equipment / capital expenditure", "Longer lifetime → lower annual depreciation.");
    sc(21, "waferEqLife", "Equipment lifetime — wafer", "depreciation", "years", "wafer", "Equipment / capital expenditure", "Longer lifetime → lower annual depreciation.");
    sc(22, "waferBldLife", "Building lifetime — wafer", "depreciation", "years", "wafer", "Equipment / capital expenditure", "Longer lifetime → lower annual depreciation.");
    sc(32, "cellEqLife", "Equipment lifetime — cell", "depreciation", "years", "cell", "Equipment / capital expenditure", "Longer lifetime → lower annual depreciation.");
    sc(33, "cellBldLife", "Building lifetime — cell", "depreciation", "years", "cell", "Equipment / capital expenditure", "Longer lifetime → lower annual depreciation.");
    sc(42, "moduleEqLife", "Equipment lifetime — module", "depreciation", "years", "module", "Equipment / capital expenditure", "Longer lifetime → lower annual depreciation.");
    sc(43, "moduleBldLife", "Building lifetime — module", "depreciation", "years", "module", "Equipment / capital expenditure", "Longer lifetime → lower annual depreciation.");
    // Imports
    im("poly", "Imported polysilicon price (all routes)");
    im("wafer", "Imported ingot & wafer price (all routes)");
    im("cell", "Imported solar cell price (all routes)");
    // Other
    sc(13, "polyOverhead", "Overhead rate — polysilicon", "other", "%", "poly", "Other operating cost", "Overheads = rate × 0.9 × stage price.", { display: "pct" });
    sc(26, "waferOverhead", "Overhead rate — wafer", "other", "%", "wafer", "Other operating cost", "Overheads = rate × 0.9 × stage price.", { display: "pct" });
    sc(37, "cellOverhead", "Overhead rate — cell", "other", "%", "cell", "Other operating cost", "Overheads = rate × 0.9 × stage price.", { display: "pct" });
    sc(47, "moduleOverhead", "Overhead rate — module", "other", "%", "module", "Other operating cost", "Overheads = rate × 0.9 × stage price.", { display: "pct" });
    sc(49, "esg", "ESG certification cost factor", "other", "USD/W per GW", "module", "Other operating cost",
      "Multiplied by installed capacity in GW (see limitation on ESG scaling).");
    sc(28, "irradiance", "Irradiance (standard test conditions)", "other", "W/m²", "wafer", "Production / yield parameter",
      "Standard test condition constant (1000 W/m²) used to convert efficiency to watt-peak. Fixed by definition.",
      { editable: false });
    return P;
  }

  var GLOBAL_PARAMS = [{
    id: "global.margin", tech: "both", kind: "global", cell: "Params!B1", label: "Operating profit mark-up (all stages)",
    group: "other", unit: "%", display: "pct", stage: "all", cls: "Other operating cost", editable: true, baseline: 0.15,
    effect: "Hardcoded as ×0.15 in every 'Operating profit' row of the workbook; exposed here as one documented parameter. Overheads are computed on the price incl. this mark-up.",
    source: CALC + " rows 23, 46, 67, 90, 119, 142, 163, 186 (constant 0.15)"
  }];

  var PARAMS = buildParams("topcon").concat(buildParams("mono")).filter(function (p, i, arr) {
    // the polysilicon import table is shared by both technologies — keep one entry
    return !(p.id === "mono.import.poly");
  }).concat(GLOBAL_PARAMS);
  var PARAM_BY_ID = {};
  PARAMS.forEach(function (p) { PARAM_BY_ID[p.id] = p; });

  function paramsForTech(t) {
    return PARAMS.filter(function (p) { return p.tech === t || p.tech === "both"; });
  }

  // ------------------------------------------------------------- the model
  function Model(workbook) {
    this.engine = new Engine(workbook);
    this.wb = workbook;
    this._sourceOptions = this._readSourceOptions();
    // Rewrite the hardcoded 15% operating profit into a parameter cell.
    var formulas = {}, self = this;
    ["topcon", "mono"].forEach(function (t) {
      TECH[t].profitRows.forEach(function (r) {
        rowCells(r).forEach(function (k) {
          var f = self.engine.formulaOf(k);
          if (!/\*0\.15$/.test(f)) throw new Error("Unexpected operating profit formula at " + k + ": " + f);
          formulas[k] = f.replace(/\*0\.15$/, "*Params!B1");
        });
      });
    });
    this._baseFormulas = formulas;
    this._baselineCache = {};
  }

  Model.prototype._readSourceOptions = function () {
    var out = {}, names = this.wb.definedNames, F = root.PVFormula || require("./formula.js");
    Object.keys(names).forEach(function (n) {
      var m = /^(.+)_SourceOptions$/.exec(n);
      if (!m) return;
      var ref = names[n].split("!");
      var cells = F.expandRange(ref[0], ref[1].replace(/\$/g, "").split(":")[0], ref[1].replace(/\$/g, "").split(":")[1]);
      out[m[1]] = cells.map(function (k) { return this.wb.cells[k].v; }, this);
    }, this);
    return out;
  };

  Model.prototype.countries = function () {
    var cells = this.wb.cells, list = [];
    "DEFGHI".split("").forEach(function (c) { list.push(cells["Country_Index!" + c + "5"].v); });
    return list;
  };
  Model.prototype.sourceOptions = function (country) { return this._sourceOptions[country] || ["Domestic"]; };
  Model.prototype.importOrigin = function (country) {
    var o = this.sourceOptions(country).filter(function (x) { return x !== "Domestic"; });
    return o[0] || null;
  };

  /** Default application state = the workbook as saved. */
  Model.prototype.workbookState = function () {
    var c = this.wb.cells;
    return {
      name: "Original workbook (as saved)",
      country: c["Inputs!C3"].v,
      tech: "topcon",
      year: 2025,
      mode: "workbook",
      sources: {
        topcon: { poly: c["Inputs!C8"].v, wafer: c["Inputs!C19"].v, cell: c["Inputs!C20"].v },
        mono: { poly: c["Inputs!C38"].v, wafer: c["Inputs!C49"].v, cell: c["Inputs!C50"].v }
      },
      edits: {},          // paramId -> { mode: "pct"|"abs", value }
      purchased: { wafer: null, cell: null } // extension modes: null = derived default
    };
  };

  // Baseline (un-edited) value of a parameter for a given country/year.
  Model.prototype.baselineValue = function (p, state, year) {
    year = year || state.year;
    if (p.kind === "global") return p.baseline;
    var res = this._baselineEval(state.country);
    if (p.kind === "input") return res.num(p.defaultCell);
    if (p.kind === "scalar") return res.num(p.cell);
    if (p.kind === "series") return res.num(CALC + "!" + yc(year) + p.row);
    if (p.kind === "import") {
      var dest = IMPORT_DEST_OFFSET[state.country];
      if (dest === undefined || year < FIRST_IMPORT_YEAR) return NaN;
      return res.num("Country_Index!" + IMPORT_COLS[year - FIRST_IMPORT_YEAR] + (TECH[p.tech === "both" ? "topcon" : p.tech].importBase[p.stage] + dest));
    }
    return NaN;
  };

  Model.prototype._baselineEval = function (country) {
    if (!this._baselineCache[country]) {
      this._baselineCache[country] = this.engine.evaluate({ values: { "Inputs!C3": country, "Params!B1": 0.15 }, formulas: this._baseFormulas });
    }
    return this._baselineCache[country];
  };

  /** Multiplier and absolute value implied by an edit. */
  Model.prototype.editValue = function (p, edit, state) {
    var base = this.baselineValue(p, state);
    if (!edit) return { factor: 1, value: base, base: base };
    if (edit.mode === "pct") return { factor: 1 + edit.value / 100, value: base * (1 + edit.value / 100), base: base };
    return { factor: base ? edit.value / base : NaN, value: edit.value, base: base };
  };

  /** Build the engine patch for a state. */
  Model.prototype.patch = function (state) {
    var values = { "Inputs!C3": state.country, "Params!B1": 0.15 }, scale = {}, self = this;
    ["topcon", "mono"].forEach(function (t) {
      var sc = TECH[t].sourceCells, src = state.sources[t];
      values[sc.poly] = src.poly; values[sc.wafer] = src.wafer; values[sc.cell] = src.cell;
    });
    Object.keys(state.edits || {}).forEach(function (id) {
      var p = PARAM_BY_ID[id], e = state.edits[id];
      if (!p || !p.editable || !e || e.value === null || e.value === "" || isNaN(e.value)) return;
      var ev = self.editValue(p, e, state);
      if (p.kind === "input") values[p.inputCell] = ev.value;
      else if (p.kind === "scalar") values[p.cell] = ev.value;
      else if (p.kind === "global") values["Params!B1"] = ev.value;
      else if (p.kind === "series" || p.kind === "import") p.cells.forEach(function (k) { scale[k] = (scale[k] || 1) * ev.factor; });
    });
    return { values: values, scale: scale, formulas: this._baseFormulas };
  };

  Model.prototype.isImported = function (state, tech, stage, year) {
    if (stage === "module") return false;
    return (year || state.year) >= FIRST_IMPORT_YEAR && state.sources[tech][stage] !== "Domestic";
  };

  /**
   * Compute the full structured result for a state (one technology, one year).
   * Returns stage values, components, category totals, totals and module data.
   */
  Model.prototype.compute = function (state, opts) {
    opts = opts || {};
    var tech = opts.tech || state.tech, year = opts.year || state.year;
    var T = TECH[tech], res = opts.res || this.engine.evaluate(this.patch(state)), self = this;
    var gw = res.num(cc(T.gPerW, year)) / 1000; // g/W -> kg/W
    var stages = STAGES.map(function (st) {
      var spec = T.stages[st.id], imported = self.isImported(state, tech, st.id, year);
      var value = res.num(cc(spec.total, year));
      var comps;
      if (imported) {
        var origin = state.sources[tech][st.id], dest = IMPORT_DEST_OFFSET[state.country];
        comps = [{ id: "imported", label: "Imported " + st.label.toLowerCase() + " (from " + origin + ")", cat: "imported", value: value,
          cell: "Country_Index!" + IMPORT_COLS[year - FIRST_IMPORT_YEAR] + (T.importBase[st.id] + dest),
          how: "Hardcoded import price from the Country_Index table (" + origin + " → " + state.country + "). Replaces the domestic stage cost; source of these prices is not documented in the workbook." }];
      } else {
        comps = spec.comps.map(function (c) {
          var key = cc(c[0], year), raw = res.num(key), def = COMP[c[1]];
          var v = st.id === "poly" ? raw * gw : raw;
          return { id: c[1], label: def.label, cat: def.cat, value: v, native: raw, nativeUnit: st.id === "poly" ? "USD/kg" : "USD/Wp",
            cell: key, row: c[0], how: def.how };
        });
      }
      return { id: st.id, label: st.label, short: st.short, plain: st.plain, value: value, imported: imported,
        source: state.sources[tech][st.id], comps: comps, totalCell: cc(spec.total, year),
        perKg: st.id === "poly" && !imported ? res.num(cc(spec.perKg, year)) : null };
    });

    var workbookTotal = res.num(cc(T.totalWithEsg, year));
    var mode = state.mode || "workbook", purchased = null;
    var derivedWafer = stages[0].value + stages[1].value, derivedCell = derivedWafer + stages[2].value;
    var included = { poly: true, wafer: true, cell: true, module: true };
    if (mode === "wafer" || mode === "cell") {
      var defaultPrice = mode === "wafer" ? derivedWafer : derivedCell;
      var pe = state.purchased && state.purchased[mode];
      var price = pe == null || pe === "" || isNaN(pe) ? defaultPrice : Number(pe);
      purchased = { kind: mode, label: mode === "wafer" ? "Purchased wafer (all-in price)" : "Purchased cell (all-in price)",
        value: price, derivedDefault: defaultPrice, isDefault: pe == null || pe === "" || isNaN(pe) };
      included.poly = false; included.wafer = false;
      if (mode === "cell") included.cell = false;
    }

    var cats = {}, total = 0;
    Object.keys(CATEGORIES).forEach(function (k) { cats[k] = 0; });
    stages.forEach(function (s) {
      s.included = included[s.id];
      if (!s.included) return;
      s.comps.forEach(function (c) { cats[c.cat] += c.value; });
      total += s.value;
    });
    if (purchased) { cats.purchased += purchased.value; total += purchased.value; }

    var esg = stages[3].comps.filter(function (c) { return c.id === "esg"; })[0];
    var power = res.num(cc(T.modulePower, year));
    var vizTotal = null;
    if (T.vizRows[year]) vizTotal = res.num("Output_Visualization!C" + T.vizRows[year][1]);
    // Output_Visualization convention generalised to any year
    var vizConv = (stages[1].imported || stages[2].imported ? 0 : stages[0].value) + (stages[2].imported ? 0 : stages[1].value) + stages[2].value + stages[3].value;

    return {
      tech: tech, year: year, country: state.country, mode: mode,
      stages: stages, purchased: purchased, categories: cats,
      total: total,                                   // headline (mode-aware)
      workbookTotal: workbookTotal,                   // 'Total Module Cost with ESG' cell
      workbookTotalNoEsg: res.num(cc(T.totalNoEsg, year)),
      totalNoEsg: total - (esg && stages[3].included ? esg.value : 0),
      totalExMargin: total - cats.margin,
      modulePowerW: power,
      usdPerModule: total * power,
      waferPowerW: res.num(cc(T.waferPower, year)),
      vizTotal: vizTotal, vizConvention: vizConv,
      totalCell: cc(T.totalWithEsg, year),
      res: res
    };
  };

  /** Totals for all years (trajectory) for a state. */
  Model.prototype.trajectory = function (state, tech) {
    var res = this.engine.evaluate(this.patch(state)), self = this;
    return YEARS.map(function (y) { return self.compute(state, { tech: tech, year: y, res: res }); });
  };

  /** Sanitise a state so that sources are valid for the chosen country. */
  Model.prototype.normalise = function (state) {
    var opts = this.sourceOptions(state.country);
    ["topcon", "mono"].forEach(function (t) {
      ["poly", "wafer", "cell"].forEach(function (s) {
        if (opts.indexOf(state.sources[t][s]) < 0) state.sources[t][s] = "Domestic";
      });
    });
    return state;
  };

  root.PVModel = {
    Model: Model, TECH: TECH, STAGES: STAGES, COMP: COMP, CATEGORIES: CATEGORIES, PARAMS: PARAMS,
    PARAM_BY_ID: PARAM_BY_ID, PARAM_GROUPS: PARAM_GROUPS, paramsForTech: paramsForTech,
    YEARS: YEARS, YEAR_COLS: YEAR_COLS, FIRST_IMPORT_YEAR: FIRST_IMPORT_YEAR, CALC: CALC, cc: cc
  };
  if (typeof module !== "undefined" && module.exports) module.exports = root.PVModel;
})(typeof window !== "undefined" ? window : globalThis);
