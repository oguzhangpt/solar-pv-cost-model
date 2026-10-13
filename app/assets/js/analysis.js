/*
 * Scenario & sensitivity layer.
 *
 * All analyses re-run the full workbook calculation for each variant (no
 * linearisation), so non-linear relationships (e.g. cell efficiency, overheads
 * computed on the stage price) are captured exactly.
 */
(function (root) {
  "use strict";
  var PM = root.PVModel || (typeof require !== "undefined" ? require("./model.js") : null);

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function stageVector(out) {
    var v = {};
    out.stages.forEach(function (s) { v[s.id] = s.included ? s.value : 0; });
    if (out.purchased) v.purchased = out.purchased.value;
    return v;
  }

  /** Parameters that can be meaningfully varied for the active state. */
  function sensitivityParams(model, state) {
    return PM.paramsForTech(state.tech).filter(function (p) {
      if (!p.editable || p.deltaOnly) return false;
      if (p.kind === "import") return model.isImported(state, state.tech, p.stage);
      return true;
    });
  }

  /**
   * One-at-a-time sensitivity: each parameter moved by -pct / +pct from its
   * current value (incl. existing scenario edits), everything else constant.
   */
  function sensitivity(model, state, pct) {
    var base = model.compute(state), rows = [];
    sensitivityParams(model, state).forEach(function (p) {
      var cur = state.edits[p.id];
      function variant(delta) {
        var s = clone(state);
        // compose with any existing edit: new value = current value × (1 + delta)
        var ev = model.editValue(p, cur, state);
        s.edits[p.id] = { mode: "abs", value: ev.value * (1 + delta / 100) };
        return model.compute(s);
      }
      var lo = variant(-pct), hi = variant(pct), e1 = variant(1), e0 = variant(-1);
      var elasticity = ((e1.total - e0.total) / base.total) / 0.02;
      var sv = stageVector(base), slo = stageVector(lo), shi = stageVector(hi), stageDelta = {};
      Object.keys(sv).forEach(function (k) { stageDelta[k] = { lo: slo[k] - sv[k], hi: shi[k] - sv[k] }; });
      rows.push({
        param: p, current: model.editValue(p, cur, state).value,
        low: lo.total, high: hi.total, dLow: lo.total - base.total, dHigh: hi.total - base.total,
        range: Math.abs(hi.total - lo.total), elasticity: elasticity, stageDelta: stageDelta,
        nonlinear: Math.abs((hi.total - base.total) + (lo.total - base.total)) > 1e-9 * base.total
      });
    });
    rows.sort(function (a, b) { return b.range - a.range; });
    return { base: base, rows: rows, pct: pct };
  }

  /** Sweep one parameter across a range of % changes (non-linear evaluation). */
  function sweep(model, state, paramId, from, to, steps) {
    var p = PM.PARAM_BY_ID[paramId], out = [], cur = state.edits[paramId];
    var ev = model.editValue(p, cur, state);
    for (var i = 0; i <= steps; i++) {
      var d = from + (to - from) * i / steps, s = clone(state);
      s.edits[paramId] = { mode: "abs", value: ev.value * (1 + d / 100) };
      var o = model.compute(s);
      out.push({ pct: d, value: ev.value * (1 + d / 100), total: o.total, stages: stageVector(o) });
    }
    return out;
  }

  /**
   * Sequential attribution of the difference between two states A → B.
   * Steps are applied one after another, so the step effects sum exactly to
   * total(B) − total(A). Order: technology, country, year, sourcing, mode,
   * then each differing parameter edit.
   */
  function attribute(model, A, B) {
    var steps = [], cur = clone(A), prev = model.compute(cur);
    function step(label, kind, mutate) {
      mutate(cur);
      model.normalise(cur);
      var o = model.compute(cur);
      steps.push({ label: label, kind: kind, delta: o.total - prev.total, stages: diffStages(prev, o) });
      prev = o;
    }
    if (A.tech !== B.tech) step("Technology: " + PM.TECH[A.tech].label + " → " + PM.TECH[B.tech].label, "config", function (s) { s.tech = B.tech; });
    if (A.country !== B.country) step("Country: " + A.country + " → " + B.country + " (country-specific inputs and import routes)", "config", function (s) { s.country = B.country; });
    if (A.year !== B.year) step("Year: " + A.year + " → " + B.year + " (workbook trajectories)", "config", function (s) { s.year = B.year; });
    if (JSON.stringify(A.sources) !== JSON.stringify(B.sources)) step("Sourcing configuration", "config", function (s) { s.sources = clone(B.sources); });
    if (A.mode !== B.mode || JSON.stringify(A.purchased) !== JSON.stringify(B.purchased))
      step("Calculation mode / purchased prices", "config", function (s) { s.mode = B.mode; s.purchased = clone(B.purchased); });
    var ids = {};
    Object.keys(A.edits || {}).concat(Object.keys(B.edits || {})).forEach(function (k) { ids[k] = true; });
    Object.keys(ids).forEach(function (id) {
      if (JSON.stringify(A.edits[id]) === JSON.stringify(B.edits[id])) return;
      var p = PM.PARAM_BY_ID[id];
      step(p ? p.label : id, "edit", function (s) { if (B.edits[id]) s.edits[id] = clone(B.edits[id]); else delete s.edits[id]; });
    });
    var a = model.compute(A), b = model.compute(B);
    return { steps: steps, from: a, to: b, delta: b.total - a.total };
  }

  function diffStages(o1, o2) {
    var a = stageVector(o1), b = stageVector(o2), d = {};
    Object.keys(Object.assign({}, a, b)).forEach(function (k) { d[k] = (b[k] || 0) - (a[k] || 0); });
    return d;
  }

  /** Country-specific input groups used to explain country differences. */
  function countryDriverGroups(tech) {
    var t = tech + ".";
    return [
      { label: "Electricity prices", ids: [t + "polyElecPrice", t + "elecPrice"] },
      { label: "Labour cost (engineer salaries)", ids: [t + "polySalary", t + "salary"] },
      { label: "Equipment CAPEX", ids: [t + "polyEquip", t + "eqWafer", t + "eqCell", t + "eqModule"] },
      { label: "Buildings & facilities CAPEX", ids: [t + "polyBld", t + "bldWafer", t + "bldCell", t + "bldModule"] },
      { label: "Installed capacity (ESG certification scaling)", ids: [t + "capacity2025", t + "capacity2030"] }
    ];
  }

  /**
   * Explain why country B differs from reference country A using the
   * workbook's own country-specific inputs: each input group is switched from
   * A's to B's default value in turn; the remaining difference (import price
   * tables for the destination) is reported separately. Scenario edits to
   * country-specific inputs are cleared so the comparison uses workbook data.
   */
  function explainCountry(model, state, refCountry, country, sourcesFor) {
    var A = clone(state), groups = countryDriverGroups(state.tech);
    A.country = refCountry;
    if (sourcesFor) A.sources[state.tech] = sourcesFor(refCountry);
    groups.forEach(function (g) { g.ids.forEach(function (id) { delete A.edits[id]; }); });
    model.normalise(A);
    var bState = clone(A); bState.country = country;
    if (sourcesFor) bState.sources[state.tech] = sourcesFor(country);
    model.normalise(bState);
    var cur = clone(A), prev = model.compute(cur), steps = [];
    groups.forEach(function (g) {
      var fromVals = [], toVals = [];
      g.ids.forEach(function (id) {
        var p = PM.PARAM_BY_ID[id];
        var vb = model.baselineValue(p, bState);
        fromVals.push(model.baselineValue(p, A)); toVals.push(vb);
        cur.edits[id] = { mode: "abs", value: vb };
      });
      var o = model.compute(cur);
      steps.push({ label: g.label, delta: o.total - prev.total, from: fromVals, to: toVals, ids: g.ids, stages: diffStages(prev, o) });
      prev = o;
    });
    // switch the country itself (same input values now) → remaining effect =
    // sourcing configuration and destination-specific import price tables
    var fin = clone(bState);
    var o2 = model.compute(fin);
    steps.push({ label: "Sourcing & import price route (destination-specific import tables)", delta: o2.total - prev.total, stages: diffStages(prev, o2) });
    var oa = model.compute(A);
    return { steps: steps, from: oa, to: o2, delta: o2.total - oa.total };
  }

  var api = { sensitivity: sensitivity, sweep: sweep, attribute: attribute, explainCountry: explainCountry,
    stageVector: stageVector, countryDriverGroups: countryDriverGroups, sensitivityParams: sensitivityParams };
  root.PVAnalysis = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
