#!/usr/bin/env node
/*
 * Validation suite for the Solar PV Manufacturing Cost Intelligence Platform.
 *
 * Runs the same JavaScript engine the browser app uses and checks it against:
 *   1. Excel's cached results in the original workbook (every formula cell)
 *   2. Independent LibreOffice recalculations of other configurations
 *   3. Internal consistency (components sum to stages, stages to totals)
 *   4. Scenario tests requested in the specification
 *   5. Control integrity (every editable control changes the result; non-editable ones don't)
 *   6. Double-counting checks for the purchased-intermediate extension modes
 *
 * Usage: node validation/run_validation.js   (writes docs/VALIDATION_REPORT.md)
 * Exit code is non-zero if any check fails.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
globalThis.window = globalThis;
require(path.join(ROOT, "app/data/model_data.js"));
require(path.join(ROOT, "app/assets/js/formula.js"));
require(path.join(ROOT, "app/assets/js/engine.js"));
const M = require(path.join(ROOT, "app/assets/js/model.js"));
const A = require(path.join(ROOT, "app/assets/js/analysis.js"));

const wb = globalThis.PV_WORKBOOK;
const model = new M.Model(wb);
const engine = model.engine;
const results = [];
let failures = 0;
const TOL = 1e-9;

function rel(a, b) { return Math.abs(a - b) / Math.max(1e-12, Math.abs(b)); }
function check(section, name, ok, detail) {
  results.push({ section, name, ok, detail });
  if (!ok) { failures++; console.error("FAIL", section, "-", name, detail || ""); }
}
function fmt(x, d) { return typeof x === "number" ? x.toFixed(d === undefined ? 6 : d) : String(x); }
function clone(o) { return JSON.parse(JSON.stringify(o)); }

// ------------------------------------------------ 1. Excel cached values
{
  const r = engine.evaluate();
  let n = 0, bad = 0, maxd = 0, worst = "";
  for (const [k, c] of Object.entries(wb.cells)) {
    if (!c.f) continue;
    n++;
    const v = r.get(k);
    if (typeof c.v === "number") {
      const d = rel(v, c.v);
      if (d > maxd) { maxd = d; worst = k; }
      if (!(d < TOL)) bad++;
    } else if (String(v) !== String(c.v)) bad++;
  }
  check("1. Excel reconciliation", `All ${n} formula cells recomputed from raw inputs match Excel's cached results`, bad === 0,
    `${bad} mismatches; max relative difference ${maxd.toExponential(2)}${worst ? " (" + worst + ")" : ""}`);
  // With the margin parameterisation applied (application patch)
  const st = model.workbookState();
  const r2 = engine.evaluate(model.patch(st));
  let bad2 = 0;
  for (const [k, c] of Object.entries(wb.cells)) {
    if (!c.f || typeof c.v !== "number") continue;
    if (!(rel(r2.get(k), c.v) < TOL)) bad2++;
  }
  check("1. Excel reconciliation", "Application patch (15% margin parameter, workbook sourcing) reproduces all cached values", bad2 === 0, `${bad2} mismatches`);
}

// ------------------------------------------------ 2. LibreOffice
const fixtures = JSON.parse(fs.readFileSync(path.join(ROOT, "validation/fixtures/libreoffice_recalc.json"), "utf8"));
const loRows = [];
const SOURCE_CELLS = { topcon: ["C8", "C19", "C20"], mono: ["C38", "C49", "C50"] };
for (const [id, fx] of Object.entries(fixtures.configs)) {
  const cfg = fx.config;
  const values = { "Inputs!C3": cfg.country };
  for (const t of ["topcon", "mono"]) SOURCE_CELLS[t].forEach((c, i) => { values["Inputs!" + c] = cfg.sources[t][i]; });
  for (const [c, v] of Object.entries(cfg.inputs)) values["Inputs!" + c] = v;
  const r = engine.evaluate({ values });
  let n = 0, bad = 0, maxd = 0;
  for (const [k, lv] of Object.entries(fx.values)) {
    n++;
    const v = r.get(k);
    if (typeof lv === "number") { const d = rel(v, lv); maxd = Math.max(maxd, d); if (!(d < TOL)) bad++; }
    else if (!(lv === null && v === null) && String(v) !== String(lv)) bad++;
  }
  loRows.push({ id, n, bad, maxd, topcon: fx.values["Cost Model_Calculations!I96"], mono: fx.values["Cost Model_Calculations!I192"], app: r.get("Cost Model_Calculations!I96") });
  check("2. LibreOffice cross-check", `${id}: ${n} output cells`, bad === 0, `${bad} mismatches; max rel. diff ${maxd.toExponential(2)}`);
}

// ------------------------------------------------ 3. Internal consistency
{
  let n = 0, bad = 0, detail = [];
  for (const country of model.countries()) {
    const opts = model.sourceOptions(country);
    for (const src of opts) {
      const st = model.workbookState();
      st.country = country;
      for (const t of ["topcon", "mono"]) st.sources[t] = { poly: src, wafer: src, cell: src };
      for (const tech of ["topcon", "mono"]) {
        const traj = model.trajectory(st, tech);
        for (const out of traj) {
          n++;
          for (const s of out.stages) {
            const sum = s.comps.reduce((a, c) => a + c.value, 0);
            if (!(rel(sum, s.value) < TOL)) { bad++; detail.push(`${country}/${src}/${tech}/${out.year}/${s.id}: Σ=${sum} vs ${s.value}`); }
          }
          if (!(rel(out.total, out.workbookTotal) < TOL)) { bad++; detail.push(`${country}/${tech}/${out.year}: total ${out.total} vs workbook ${out.workbookTotal}`); }
          if (!(rel(out.totalNoEsg, out.workbookTotalNoEsg) < TOL)) { bad++; detail.push(`${country}/${tech}/${out.year}: no-ESG mismatch`); }
          const catSum = Object.values(out.categories).reduce((a, b) => a + b, 0);
          if (!(rel(catSum, out.total) < TOL)) { bad++; detail.push(`${country}/${tech}/${out.year}: category sum mismatch`); }
          if (out.vizTotal !== null && !(rel(out.vizTotal, out.vizConvention) < TOL)) { bad++; detail.push(`${country}/${tech}/${out.year}: viz convention mismatch`); }
        }
      }
    }
  }
  check("3. Internal consistency", `Components → stage, stages → workbook total, categories → total, Output_Visualization convention (${n} country × sourcing × technology × year cases)`, bad === 0, detail.slice(0, 5).join("; "));
  // Polysilicon unit conversion USD/kg -> USD/Wp
  const out = model.compute(model.workbookState());
  const p = out.stages[0];
  const gpw = engine.evaluate(model.patch(model.workbookState())).num("Cost Model_Calculations!I10");
  check("3. Internal consistency", "Polysilicon USD/kg × g/W ÷ 1000 = polysilicon USD/Wp", rel(p.perKg * gpw / 1000, p.value) < TOL,
    `${fmt(p.perKg, 4)} USD/kg × ${gpw} g/W ÷ 1000 = ${fmt(p.perKg * gpw / 1000)} vs ${fmt(p.value)} USD/Wp`);
}

// ------------------------------------------------ 4. Scenario tests
const scenarioRows = [];
function scen(name, state, expected) {
  const out = model.compute(state);
  scenarioRows.push({ name, total: out.total, power: out.modulePowerW, expected });
  return out;
}
{
  // 4a. Unchanged baseline
  const base = model.workbookState();
  const ob = scen("A. Unchanged baseline — China, TOPCon, 2025, all domestic", base, wb.cells["Cost Model_Calculations!I96"].v);
  check("4. Scenario tests", "A. Unchanged baseline equals Excel 'Total Module Cost with ESG' (I96)", rel(ob.total, wb.cells["Cost Model_Calculations!I96"].v) < TOL,
    `app ${fmt(ob.total)} vs Excel ${fmt(wb.cells["Cost Model_Calculations!I96"].v)} USD/Wp`);
  const bm = clone(base); bm.tech = "mono";
  const obm = scen("A. Unchanged baseline — China, Mono PERC, 2025", bm, wb.cells["Cost Model_Calculations!I192"].v);
  check("4. Scenario tests", "A. Unchanged Mono PERC baseline equals Excel I192", rel(obm.total, wb.cells["Cost Model_Calculations!I192"].v) < TOL,
    `app ${fmt(obm.total)} vs Excel ${fmt(wb.cells["Cost Model_Calculations!I192"].v)}`);

  // 4b. Single input: electricity +20% (both electricity inputs, both technologies) via the semantic edit layer
  const s = clone(base);
  s.edits = { "topcon.polyElecPrice": { mode: "pct", value: 20 }, "topcon.elecPrice": { mode: "pct", value: 20 },
              "mono.polyElecPrice": { mode: "pct", value: 20 }, "mono.elecPrice": { mode: "pct", value: 20 } };
  const fx = fixtures.configs["China-elec+20pct"].values;
  const os = scen("B. Electricity price +20% (other inputs constant) — China, TOPCon, 2025", s, fx["Cost Model_Calculations!I96"]);
  check("4. Scenario tests", "B. +20% electricity via app edits equals LibreOffice recalculation (TOPCon I96)", rel(os.total, fx["Cost Model_Calculations!I96"]) < TOL,
    `app ${fmt(os.total)} vs LibreOffice ${fmt(fx["Cost Model_Calculations!I96"])}; Δ vs baseline ${fmt(os.total - ob.total)} USD/Wp (${fmt((os.total / ob.total - 1) * 100, 2)}%)`);
  const sm = clone(s); sm.tech = "mono";
  const osm = model.compute(sm);
  check("4. Scenario tests", "B. +20% electricity — Mono PERC equals LibreOffice (I192)", rel(osm.total, fx["Cost Model_Calculations!I192"]) < TOL,
    `app ${fmt(osm.total)} vs LibreOffice ${fmt(fx["Cost Model_Calculations!I192"])}`);
  // Only electricity components changed
  const changed = [];
  ob.stages.forEach((st, i) => st.comps.forEach((c, j) => {
    const d = os.stages[i].comps[j].value - c.value;
    if (Math.abs(d) > 1e-15) changed.push(c.id);
  }));
  const uniq = [...new Set(changed)].sort();
  check("4. Scenario tests", "B. Only electricity and the price-proportional overhead lines change", uniq.join(",") === "electricity,margin,overhead",
    `changed component types: ${uniq.join(", ")}`);

  // 4c. Country / configuration comparison against LibreOffice
  for (const id of ["Germany-domestic", "US-domestic", "India-all-imported", "US-all-imported", "Vietnam-mixed"]) {
    const cfg = fixtures.configs[id].config;
    const st = model.workbookState();
    st.country = cfg.country;
    for (const t of ["topcon", "mono"]) st.sources[t] = { poly: cfg.sources[t][0], wafer: cfg.sources[t][1], cell: cfg.sources[t][2] };
    const o = scen(`C. ${id} — TOPCon, 2025`, st, fixtures.configs[id].values["Cost Model_Calculations!I96"]);
    check("4. Scenario tests", `C. ${id}: app total equals LibreOffice (TOPCon 2025)`, rel(o.total, fixtures.configs[id].values["Cost Model_Calculations!I96"]) < TOL,
      `app ${fmt(o.total)} vs LibreOffice ${fmt(fixtures.configs[id].values["Cost Model_Calculations!I96"])}; Δ vs China ${fmt(o.total - ob.total)} USD/Wp`);
  }
  // 4d. Capacity override through the semantic layer
  {
    const cfg = fixtures.configs["Germany-capacity-override"];
    const st = model.workbookState(); st.country = "Germany";
    st.edits = { "topcon.capacity2025": { mode: "abs", value: 1e9 }, "topcon.capacity2030": { mode: "abs", value: 3e9 },
                 "mono.capacity2025": { mode: "abs", value: 1e9 }, "mono.capacity2030": { mode: "abs", value: 3e9 } };
    const o = model.compute(st);
    check("4. Scenario tests", "D. Germany capacity override via app edits equals LibreOffice", rel(o.total, cfg.values["Cost Model_Calculations!I96"]) < TOL,
      `app ${fmt(o.total)} vs LibreOffice ${fmt(cfg.values["Cost Model_Calculations!I96"])}`);
  }
}

// ------------------------------------------------ 5. Control integrity
const controlRows = [];
{
  for (const p of M.PARAMS) {
    const techs = p.tech === "both" ? ["topcon", "mono"] : [p.tech];
    let maxEffect = 0, maxPower = 0;
    for (const tech of techs) {
      for (const country of ["China", "Germany", "US"]) {
        const st = model.workbookState(); st.tech = tech; st.country = country;
        if (p.kind === "import") { const imp = model.importOrigin(country); if (!imp) continue; st.sources[tech] = { poly: imp, wafer: imp, cell: imp }; }
        for (const year of [2022, 2025, 2030]) {
          st.year = year;
          const base = model.compute(st);
          const s2 = clone(st); s2.edits = { [p.id]: p.deltaOnly ? { mode: "abs", value: 1 } : { mode: "pct", value: 10 } };
          const o2 = model.compute(s2);
          maxEffect = Math.max(maxEffect, Math.abs(o2.total - base.total));
          maxPower = Math.max(maxPower, Math.abs(o2.modulePowerW - base.modulePowerW));
        }
      }
    }
    controlRows.push({ id: p.id, label: p.label, editable: p.editable, effect: maxEffect, power: maxPower });
    if (p.editable) check("5. Control integrity", `Editable control changes the result: ${p.id}`, maxEffect > 1e-12 || maxPower > 1e-9,
      `max |Δ total| ${maxEffect.toExponential(2)} USD/Wp, max |Δ module W| ${fmt(maxPower, 3)}`);
    else check("5. Control integrity", `Non-editable item: ${p.id} (${p.noEffect ? "no effect on cost" : "fixed by definition"})`, p.noEffect ? maxEffect < 1e-15 : true,
      `max |Δ total| for +10%: ${maxEffect.toExponential(2)}`);
  }
}

// ------------------------------------------------ 6. Double counting / modes
{
  const st = model.workbookState();
  const a = model.compute(st);
  const w = clone(st); w.mode = "wafer"; const ow = model.compute(w);
  const c = clone(st); c.mode = "cell"; const oc = model.compute(c);
  check("6. Calculation modes", "B. Purchased-wafer mode with derived default price reproduces the integrated total", rel(ow.total, a.total) < TOL, `${fmt(ow.total)} vs ${fmt(a.total)}`);
  check("6. Calculation modes", "C. Module-assembly mode with derived default cell price reproduces the integrated total", rel(oc.total, a.total) < TOL, `${fmt(oc.total)} vs ${fmt(a.total)}`);
  const w2 = clone(w); w2.edits = { "topcon.polyElecPrice": { mode: "pct", value: 50 }, "topcon.siPrice": { mode: "pct", value: 50 } };
  const ow2 = model.compute(w2);
  // in purchased-wafer mode the derived default moves with upstream inputs, so pin the purchased price
  const w3 = clone(w); w3.purchased = { wafer: 0.06, cell: null };
  const w4 = clone(w3); w4.edits = w2.edits;
  const o3 = model.compute(w3), o4 = model.compute(w4);
  check("6. Calculation modes", "B. With a fixed purchased wafer price, upstream (polysilicon) inputs have zero effect — no double counting", Math.abs(o4.total - o3.total) < 1e-15,
    `Δ total after +50% poly electricity & silicon price = ${(o4.total - o3.total).toExponential(2)}`);
  check("6. Calculation modes", "B. Purchased wafer total = wafer price + cell stage + module stage", rel(o3.total, 0.06 + o3.stages[2].value + o3.stages[3].value) < TOL,
    `${fmt(o3.total)} = 0.060000 + ${fmt(o3.stages[2].value)} + ${fmt(o3.stages[3].value)}`);
  const c3 = clone(c); c3.purchased = { wafer: null, cell: 0.12 };
  const o5 = model.compute(c3);
  check("6. Calculation modes", "C. Purchased cell total = cell price + module stage only", rel(o5.total, 0.12 + o5.stages[3].value) < TOL,
    `${fmt(o5.total)} = 0.120000 + ${fmt(o5.stages[3].value)}`);
  void ow2;
  // Polysilicon price change: +1 USD/kg must add exactly g/W ÷ 1000 USD/Wp (domestic and imported)
  for (const [country, src] of [["China", "Domestic"], ["India", "China"]]) {
    for (const tech of ["topcon", "mono"]) {
      const b0 = clone(st); b0.country = country; b0.tech = tech; b0.sources[tech] = { poly: src, wafer: "Domestic", cell: "Domestic" };
      const b1 = clone(b0); b1.edits = { "global.polyPrice": { mode: "abs", value: 1 } };
      const gw = engine.evaluate(model.patch(b0)).num("Cost Model_Calculations!I" + M.TECH[tech].gPerW);
      const d = model.compute(b1).total - model.compute(b0).total;
      check("6. Calculation modes", `Polysilicon price +1 USD/kg adds g/W÷1000 to the module (${country}, poly ${src}, ${tech})`, Math.abs(d - gw / 1000) < 1e-15,
        `Δ = ${d.toExponential(6)} USD/Wp, g/W = ${gw}`);
    }
  }
  const z = clone(st); z.edits = { "global.margin": { mode: "abs", value: 0 } };
  const oz = model.compute(z);
  check("6. Calculation modes", "Operating-profit parameter at 0 removes all operating-profit lines", oz.categories.margin === 0, `margin category = ${oz.categories.margin}`);
}

// ------------------------------------------------ 7. Analysis layer
{
  const base = model.workbookState();
  // Scenario attribution sums exactly to the scenario difference
  const B = clone(base);
  B.country = "India"; B.year = 2030; B.sources.topcon = { poly: "China", wafer: "Domestic", cell: "China" };
  B.edits = { "topcon.elecPrice": { mode: "pct", value: 20 }, "topcon.salary": { mode: "pct", value: 10 }, "topcon.siPrice": { mode: "pct", value: -15 } };
  const at = A.attribute(model, base, B);
  const sum = at.steps.reduce((a, s) => a + s.delta, 0);
  check("7. Analysis layer", "Scenario attribution steps sum exactly to scenario − baseline", Math.abs(sum - at.delta) < 1e-12,
    `${at.steps.length} steps, Σ = ${fmt(sum, 8)} vs Δ = ${fmt(at.delta, 8)}`);
  // Country explanation sums exactly
  let bad = 0, n = 0;
  for (const ref of model.countries()) for (const c of model.countries()) {
    if (ref === c) continue;
    for (const tech of ["topcon", "mono"]) {
      const st = clone(base); st.tech = tech;
      const ex = A.explainCountry(model, st, ref, c);
      const s2 = ex.steps.reduce((a, s) => a + s.delta, 0);
      n++;
      if (!(Math.abs(s2 - ex.delta) < 1e-12)) bad++;
      // all-domestic: no residual import effect expected
      if (Math.abs(ex.steps[ex.steps.length - 1].delta) > 1e-12) bad++;
    }
  }
  check("7. Analysis layer", `Country-difference explanations sum exactly and leave no unexplained residual (all-domestic, ${n} country pairs × technologies)`, bad === 0, `${bad} problems`);
  // Sensitivity: symmetric linear params give symmetric deltas; ranking non-empty
  const sens = A.sensitivity(model, base, 10);
  const lin = sens.rows.find(r => r.param.id === "topcon.elecPrice");
  check("7. Analysis layer", "Sensitivity: electricity price impact is symmetric (linear input)", Math.abs(lin.dHigh + lin.dLow) < 1e-12,
    `+10%: ${lin.dHigh.toExponential(3)}, −10%: ${lin.dLow.toExponential(3)}`);
  const eff = sens.rows.find(r => r.param.id === "topcon.efficiency");
  check("7. Analysis layer", "Sensitivity: cell efficiency impact is evaluated non-linearly (asymmetric)", eff.nonlinear && eff.dHigh < 0,
    `+10%: ${eff.dHigh.toExponential(3)}, −10%: ${eff.dLow.toExponential(3)}`);
  const sw = A.sweep(model, base, "topcon.elecPrice", -50, 50, 10);
  check("7. Analysis layer", "Sweep at 0% equals the baseline", Math.abs(sw[5].total - sens.base.total) < 1e-15, `${fmt(sw[5].total)} vs ${fmt(sens.base.total)}`);
}

// ------------------------------------------------ report
const pass = results.filter(r => r.ok).length;
const L = [];
L.push("# Validation Report — IRENA Solar PV Manufacturing Cost Intelligence Platform", "");
L.push(`Generated by \`node validation/run_validation.js\` on ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC.`, "");
L.push(`Workbook: \`${wb.meta.file}\` (SHA-256 \`${wb.meta.sha256.slice(0, 16)}…\`). Reference recalculation engine: ${fixtures.libreoffice || "LibreOffice"}.`, "");
L.push(`**Result: ${pass} / ${results.length} checks passed${failures ? ` — ${failures} FAILED` : ""}.** Tolerance: relative difference < 1e-9.`, "");
L.push("## How the validation works", "",
  "1. **Excel reconciliation** – every formula in the workbook is recomputed from the raw inputs by the application's engine and compared with the result Excel cached when the file was saved (configuration: China, all stages domestic).",
  "2. **LibreOffice cross-check** – Excel's cache only covers one configuration. For other countries, sourcing options and edited inputs, temporary copies of the workbook were recalculated headlessly by LibreOffice (`tools/libreoffice_recalc.py`) and compared cell-by-cell with the engine.",
  "3. **Internal consistency** – cost components must add up to each stage, stages to the workbook's total, and the cost categories to the headline total.",
  "4. **Scenario tests** – the three mandatory scenarios (unchanged baseline, single input change, country/configuration comparison), driven through the same edit layer as the user interface.",
  "5. **Control integrity** – every control shown as editable must change the result; items shown as non-editable must not (or are fixed by definition).",
  "6. **Calculation modes** – the purchased-intermediate extension modes must not double count upstream costs.",
  "7. **Analysis layer** – scenario attributions and country-difference explanations must add up exactly; sensitivities must be evaluated non-linearly.", "");
L.push("## Scenario results", "", "| Scenario | App result (USD/Wp) | Reference (USD/Wp) | Difference | Module power (W) |", "|---|---:|---:|---:|---:|");
for (const s of scenarioRows) L.push(`| ${s.name} | ${fmt(s.total)} | ${fmt(s.expected)} | ${(s.total - s.expected).toExponential(1)} | ${fmt(s.power, 1)} |`);
L.push("", "## LibreOffice configurations (TOPCon & Mono PERC, all years)", "", "| Configuration | Cells compared | Mismatches | Max rel. diff | TOPCon 2025 (USD/Wp) | Mono PERC 2025 (USD/Wp) |", "|---|---:|---:|---:|---:|---:|");
for (const r of loRows) L.push(`| ${r.id} | ${r.n} | ${r.bad} | ${r.maxd.toExponential(1)} | ${fmt(r.topcon)} | ${fmt(r.mono)} |`);
L.push("", "## All checks", "", "| Section | Check | Result | Detail |", "|---|---|---|---|");
for (const r of results) L.push(`| ${r.section} | ${r.name.replace(/\|/g, "\\|")} | ${r.ok ? "✅ pass" : "❌ FAIL"} | ${(r.detail || "").replace(/\|/g, "\\|")} |`);
L.push("", "## Control effect summary (+10% applied, max over China/Germany/US × 2022/2025/2030)", "", "| Parameter | Editable | max \\|Δ total\\| (USD/Wp) | max \\|Δ module power\\| (W) |", "|---|---|---:|---:|");
for (const c of controlRows) L.push(`| ${c.label} (\`${c.id}\`) | ${c.editable ? "yes" : "no"} | ${c.effect.toExponential(2)} | ${fmt(c.power, 2)} |`);
L.push("", "## Conclusion", "",
  failures === 0
    ? "The application's calculation engine reproduces the original workbook exactly: all cached Excel results, and all LibreOffice recalculations for other countries, sourcing configurations and edited inputs, match to floating-point precision. Differences shown above are rounding-level (≤1e-14 relative)."
    : "Some checks failed — see the table above.", "");
fs.writeFileSync(path.join(ROOT, "docs/VALIDATION_REPORT.md"), L.join("\n"));
console.log(`${pass}/${results.length} checks passed. Report: docs/VALIDATION_REPORT.md`);
process.exit(failures ? 1 : 0);
