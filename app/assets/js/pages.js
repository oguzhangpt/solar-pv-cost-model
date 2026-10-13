/*
 * Page renderers. Every number comes from App.model (workbook formulas);
 * pages only arrange, label and chart it.
 */
(function () {
  "use strict";
  var App = window.App, PM = window.PVModel, AN = window.PVAnalysis, F = App.fmt, esc = App.esc;
  var model = App.model;
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  App.ui = {
    country: { selected: null, ref: null, sourcing: "domestic", target: null },
    lab: { param: "", pct: 10, compare: [], name: "" },
    sens: { pct: 10, top: 15, sweep: "" },
    exp: { q: "", cls: "", stage: "", tech: "active", status: "" },
    inputs: { q: "", advanced: false }
  };

  var STAGE_LABEL = { poly: "Polysilicon", wafer: "Ingot & wafer", cell: "Solar cell", module: "Module assembly", purchased: "Purchased intermediate", all: "All stages" };
  var MODE_INFO = {
    workbook: { label: "A · Integrated chain (workbook method)", tag: "wb", text: "Each stage is either produced domestically (full cost build-up) or replaced by the workbook's import price for that stage. Stage costs are additive conversion costs, so nothing is counted twice. This is the IRENA workbook's own calculation." },
    wafer: { label: "B · Purchased wafers (extension)", tag: "ext", text: "You buy finished wafers at an all-in price (polysilicon + wafering included). The polysilicon and wafer stages are removed and replaced by that single price; cell and module stages are calculated by the workbook. Default price = the workbook's own polysilicon + wafer cost for this configuration." },
    cell: { label: "C · Module assembly from purchased cells (extension)", tag: "ext", text: "You buy finished cells at an all-in price. Polysilicon, wafer and cell stages are removed and replaced by that price; only module assembly is calculated by the workbook. Default price = the workbook's own polysilicon + wafer + cell cost for this configuration." }
  };

  // ======================================================== shared helpers
  function notices(cur, st) {
    var out = [];
    var anyImp = ["poly", "wafer", "cell"].some(function (k) { return st.sources[st.tech][k] !== "Domestic"; });
    if (anyImp && st.year < PM.FIRST_IMPORT_YEAR)
      out.push(["warn", "The workbook applies the import options only for 2025–2030. For " + st.year + " every stage is calculated as domestic production, whatever sourcing is selected."]);
    if (st.mode !== "workbook")
      out.push(["ext", "<b>Extension mode active:</b> " + MODE_INFO[st.mode].text + " This mode is not part of the IRENA workbook."]);
    if (cur.stages.some(function (s) { return s.imported; }))
      out.push(["info", "Imported stages use hardcoded import prices from the workbook (Country_Index tables, no source documented). They are stage-only prices and cannot be broken into materials, energy or labour."]);
    if (st.edits["global.margin"]) out.push(["info", "The operating-profit mark-up has been changed from the workbook's hardcoded 15%."]);
    return out.map(function (n) { return '<div class="notice ' + n[0] + '"><span class="ico">' + (n[0] === "warn" ? "!" : "i") + "</span><div>" + n[1] + "</div></div>"; }).join("");
  }

  function configSummary(st) {
    var src = st.sources[st.tech], origin = model.importOrigin(st.country);
    var parts = ["poly", "wafer", "cell"].map(function (k) { return STAGE_LABEL[k] + ": " + (src[k] === "Domestic" ? "domestic" : "imported from " + src[k]); });
    return esc(st.country) + " · " + PM.TECH[st.tech].label + " · " + st.year + "<br><span class='muted small'>" + parts.join(" · ") + " · Module: domestic" + (origin ? "" : " (no import options in workbook for " + esc(st.country) + ")") + "</span>";
  }

  function paramValue(p, st) {
    var e = st.edits[p.id], ev = model.editValue(p, e, st);
    return { cur: ev.value, base: ev.base, edited: !!(e && e.value !== null && e.value !== "" && !isNaN(e.value)), edit: e };
  }

  function paramControl(p, st, compact) {
    var pv = paramValue(p, st), u = F.unit(p);
    if (!p.editable) return '<span class="num">' + F.num(F.disp(p, pv.cur), p.unit) + "</span> " + App.tag("fix", p.noEffect ? "No effect in model" : "Fixed");
    if (p.kind === "import" && !model.isImported(st, st.tech, p.stage))
      return '<span class="num muted">' + (isFinite(pv.base) ? F.num(pv.base) : "n/a") + "</span> " + App.tag("fix", "Inactive — stage is domestic");
    if (p.deltaOnly) return '<div class="param-ctrl"><span class="small muted">+/−</span><input type="number" step="0.5" value="' + Number(pv.cur.toPrecision(8)) + '" data-bind="param-abs" data-id="' + p.id + '" data-focus="abs:' + p.id + '" aria-label="' + esc(p.label) + '">' +
      (pv.edited ? '<button class="btn small ghost" data-action="reset-param" data-id="' + p.id + '" title="Reset">↺</button>' : "") + "</div>";
    var pct = pv.edited ? (pv.cur / pv.base - 1) * 100 : 0;
    var step = Math.abs(F.disp(p, pv.base)) > 0 ? Math.pow(10, Math.floor(Math.log10(Math.abs(F.disp(p, pv.base)))) - 2) : 0.01;
    return '<div class="param-ctrl">' +
      '<input type="number" step="' + step + '" value="' + Number(F.disp(p, pv.cur).toPrecision(8)) + '" data-bind="param-abs" data-id="' + p.id + '" data-focus="abs:' + p.id + '" aria-label="' + esc(p.label) + ' value in ' + esc(u) + '">' +
      (compact ? "" : '<input type="range" min="-50" max="50" step="1" value="' + Math.max(-50, Math.min(50, Math.round(pct))) + '" data-bind="param-pct" data-id="' + p.id + '" aria-label="Change in percent">') +
      '<input class="pct" type="number" step="1" value="' + (pv.edited ? Number(pct.toFixed(2)) : 0) + '" data-bind="param-pct" data-id="' + p.id + '" data-focus="pct:' + p.id + '" aria-label="Change versus baseline in percent"><span class="muted small">%</span>' +
      (pv.edited ? '<button class="btn small ghost" data-action="reset-param" data-id="' + p.id + '" title="Reset to workbook value">↺</button>' : "") +
      "</div>";
  }

  App.binds["param-abs"] = function (v, el) {
    var p = PM.PARAM_BY_ID[el.getAttribute("data-id")], val = parseFloat(v);
    if (!p || isNaN(val)) return;
    val = F.undisp(p, val);
    App.set(function (s) {
      var base = model.baselineValue(p, s);
      if (Math.abs(val - base) <= 1e-12 * Math.max(1, Math.abs(base))) { delete s.edits[p.id]; return; }
      if (p.deltaOnly) s.edits[p.id] = { mode: "abs", value: val };
      else if (p.kind === "series" || p.kind === "import") s.edits[p.id] = { mode: "pct", value: (val / base - 1) * 100 };
      else s.edits[p.id] = { mode: "abs", value: val };
    });
  };
  App.binds["param-pct"] = function (v, el) {
    var p = PM.PARAM_BY_ID[el.getAttribute("data-id")], val = parseFloat(v);
    if (!p || isNaN(val)) return;
    App.set(function (s) { if (val === 0) delete s.edits[p.id]; else s.edits[p.id] = { mode: "pct", value: val }; });
  };
  App.actions["reset-param"] = function (el) { var id = el.getAttribute("data-id"); App.set(function (s) { delete s.edits[id]; }); };

  function stageTableRows(cur, base) {
    var rows = "";
    cur.stages.forEach(function (s, i) {
      var b = base.stages[i], inc = s.included, bInc = b.included;
      var v = inc ? s.value : 0, bv = bInc ? b.value : 0;
      rows += "<tr" + (inc ? "" : ' class="dim"') + '><td><span class="swatch" style="background:' + App.stageColor(i) + '"></span>' + s.label +
        (s.imported ? " " + App.tag("imp", "Imported · " + s.source) : "") + (inc ? "" : " " + App.tag("fix", "Excluded — purchased")) + "</td>" +
        '<td class="num">' + F.wp(v) + '</td><td class="num">' + F.wp(bv) + '</td><td class="num">' + F.delta(v - bv, bv) + '</td><td class="num">' + F.pct(v / cur.total) + "</td></tr>";
    });
    if (cur.purchased || base.purchased) {
      var pv = cur.purchased ? cur.purchased.value : 0, pb = base.purchased ? base.purchased.value : 0;
      rows += '<tr><td><span class="swatch" style="background:' + App.color("--s5") + '"></span>' + (cur.purchased || base.purchased).label + " " + App.tag("ext", "Extension") + '</td><td class="num">' + F.wp(pv) + '</td><td class="num">' + F.wp(pb) + '</td><td class="num">' + F.delta(pv - pb, pb) + '</td><td class="num">' + F.pct(pv / cur.total) + "</td></tr>";
    }
    rows += '<tr class="total"><td>Total module cost (incl. ESG)</td><td class="num">' + F.wp(cur.total) + '</td><td class="num">' + F.wp(base.total) + '</td><td class="num">' + F.delta(cur.total - base.total, base.total) + '</td><td class="num">100%</td></tr>';
    return rows;
  }

  function waterfallData(cur, base) {
    var x = [], y = [], m = [], text = [];
    if (cur.purchased) { x.push(cur.purchased.label.replace(" (all-in price)", "")); y.push(cur.purchased.value); m.push("relative"); text.push(F.wp(cur.purchased.value)); }
    cur.stages.forEach(function (s) { if (s.included) { x.push(s.label + (s.imported ? " (imp.)" : "")); y.push(s.value); m.push("relative"); text.push("+" + F.wp(s.value)); } });
    x.push("Total"); y.push(0); m.push("total"); text.push(F.wp(cur.total));
    var data = [{
      type: "waterfall", x: x, y: y, measure: m, text: text, textposition: "outside", cliponaxis: false,
      name: "Scenario", connector: { line: { color: App.color("--axis"), width: 1 } },
      increasing: { marker: { color: App.color("--c1") } }, totals: { marker: { color: App.color("--s4") } },
      hovertemplate: "%{x}<br>%{y:.4f} USD/Wp<extra></extra>"
    }, {
      type: "scatter", mode: "markers", x: ["Total"], y: [base.total], name: "Baseline total",
      marker: { symbol: "line-ew-open", size: 44, color: App.color("--c2"), line: { width: 3, color: App.color("--c2") } },
      hovertemplate: "Baseline: %{y:.4f} USD/Wp<extra></extra>"
    }];
    return data;
  }

  function categoryByStageData(out) {
    var stages = out.stages.filter(function (s) { return s.included; });
    var ylab = stages.map(function (s) { return s.label; });
    if (out.purchased) ylab.unshift(out.purchased.label.replace(" (all-in price)", ""));
    return App.GROUPS.map(function (g) {
      var xs = stages.map(function (s) {
        return s.comps.filter(function (c) { return g.cats.indexOf(c.cat) >= 0; }).reduce(function (a, c) { return a + c.value; }, 0);
      });
      if (out.purchased) xs.unshift(g.id === "bought" ? out.purchased.value : 0);
      return { type: "bar", orientation: "h", name: g.label, y: ylab, x: xs, marker: { color: App.color(g.v), line: { color: App.color("--surface"), width: 1 } },
        hovertemplate: "%{y} · " + g.label + "<br>%{x:.4f} USD/Wp<extra></extra>" };
    }).filter(function (t) { return t.x.some(function (v) { return v > 0; }); });
  }

  // ======================================================== DASHBOARD
  App.register("dashboard", {
    title: "Executive dashboard", icon: "◧", section: "Detailed analysis",
    render: function () {
      var st = App.state, cur = App.current(), base = App.baseline(), bs = App.baselineState();
      var groups = App.groupTotals(cur.categories), bgroups = App.groupTotals(base.categories);
      function g(id, arr) { return arr.filter(function (x) { return x.g.id === id; })[0].value; }
      var shares = [
        ["Materials & consumables", g("materials", groups), g("materials", bgroups), "--c1", "Silicon, silver, other materials and module bill-of-materials (excl. imported stages)."],
        ["Electricity", g("energy", groups), g("energy", bgroups), "--c2", "Electricity cost of all domestically produced stages."],
        ["Labour", g("labour", groups), g("labour", bgroups), "--c3", "Workers per unit × country salary."],
        ["Capital-related", g("capital", groups), g("capital", bgroups), "--c4", "Equipment & building depreciation plus maintenance (straight-line, no financing cost in the workbook)."]
      ];
      var importedShare = (cur.categories.imported + cur.categories.purchased) / cur.total;
      var h = '<div class="page-head"><div><h1>Executive dashboard</h1><p>Levelised manufacturing cost of a crystalline-silicon PV module along the value chain, calculated live from the IRENA workbook. ' +
        "Scenario = your current inputs; baseline = <b>" + esc(bs.name) + "</b>.</p></div>" +
        '<div class="chips">' + App.tag("wb", "Workbook data") + App.tag("mod", "User-modified") + App.tag("der", "Derived") + App.tag("ext", "Extension") + "</div></div>";
      h += notices(cur, st);
      h += '<div class="grid g4">' +
        kpi("Module cost (LCOP)", F.wp(cur.total), "USD/Wp", "Baseline " + F.wp(base.total) + " · " + F.delta(cur.total - base.total, base.total),
          "Total of the four stages incl. ESG certification, overheads and the workbook's 15% operating profit — the workbook's 'Total Module Cost with ESG'. Cell: " + cur.totalCell) +
        kpi("Cost per module", F.usd(cur.usdPerModule), "USD/module", F.num(cur.modulePowerW) + " W module · baseline " + F.usd(base.usdPerModule) + " " + F.delta(cur.usdPerModule - base.usdPerModule, base.usdPerModule, 2),
          "USD/Wp × module power rating (" + (st.tech === "topcon" ? "66 cells × wafer power" : "66 cells × area × efficiency") + ", from the workbook).") +
        kpi("Cost excl. operating profit", F.wp(cur.totalExMargin), "USD/Wp", "Operating profit lines: " + F.wp(cur.categories.margin) + " (" + F.pct(cur.categories.margin / cur.total) + ")",
          "Derived: total minus the 15% operating-profit lines of domestically produced stages. Imported/purchased prices already include the supplier's margin.") +
        '<div class="card kpi"><div class="label">Configuration ' + App.info("Change country, technology and year in the top bar; sourcing and mode in the Input control center.") + '</div><div style="margin-top:6px;font-weight:600">' + configSummary(st) + "</div>" +
        '<div class="foot">' + App.tag(MODE_INFO[st.mode].tag, MODE_INFO[st.mode].label) + "</div></div>" +
        "</div>";
      h += '<div class="grid g4 section">' + shares.map(function (s) {
        var sh = s[1] / cur.total, bsh = s[2] / base.total;
        return '<div class="card kpi"><div class="label"><span class="swatch" style="background:' + App.color(s[3]) + '"></span>' + s[0] + " share " + App.info(s[4]) + '</div><div class="value">' + F.pct(sh) +
          '<span class="unit">' + F.wp(s[1]) + ' USD/Wp</span></div><div class="share-bar"><i style="width:' + Math.min(100, sh * 100) + "%;background:" + App.color(s[3]) + '"></i></div>' +
          '<div class="foot">Baseline ' + F.pct(bsh) + " · " + F.signed((sh - bsh) * 100, 1) + " pp</div></div>";
      }).join("") + "</div>";
      if (importedShare > 0.0005) h += '<p class="small muted" style="margin-top:6px">' + F.pct(importedShare) + " of the cost is an imported/purchased stage price that the workbook does not break down into materials, energy, labour or capital.</p>";
      h += '<div class="grid g2 section"><div class="card"><div class="card-head"><h2>Cost build-up along the value chain</h2><span class="sub">USD/Wp · ' + st.year + ' · orange bar = baseline total</span></div><div id="ch-waterfall" class="chart"></div></div>' +
        '<div class="card"><div class="card-head"><h2>Cost by stage</h2><span class="sub">USD/Wp</span></div><div class="table-wrap"><table class="data"><thead><tr><th>Stage</th><th class="num">Scenario</th><th class="num">Baseline</th><th class="num">Δ</th><th class="num">Share</th></tr></thead><tbody>' +
        stageTableRows(cur, base) + "</tbody></table></div>" +
        '<p class="small muted" style="margin-top:10px">Each stage is a <b>conversion cost</b>: the wafer stage does not contain the polysilicon cost, the cell stage does not contain the wafer cost, so the sum is not double counted.</p></div></div>';
      h += '<div class="grid g2 section"><div class="card"><div class="card-head"><h2>What the cost is made of</h2><span class="sub">USD/Wp by stage and cost type</span></div><div id="ch-cats" class="chart"></div></div>' +
        '<div class="card"><div class="card-head"><h2>Cost trajectory 2020–2030</h2><span class="sub">Workbook projections · USD/Wp</span></div><div id="ch-traj" class="chart"></div></div></div>';
      return h;
    },
    after: function () {
      var st = App.state, cur = App.current(), base = App.baseline();
      App.plot("ch-waterfall", waterfallData(cur, base), { showlegend: false, yaxis: { title: { text: "USD/Wp" }, rangemode: "tozero" }, margin: { t: 24 } });
      App.plot("ch-cats", categoryByStageData(cur), { barmode: "stack", xaxis: { title: { text: "USD/Wp" } }, yaxis: { autorange: "reversed" }, margin: { l: 110 } });
      var traj = model.trajectory(st, st.tech), btraj = model.trajectory(App.baselineState(), st.tech);
      App.plot("ch-traj", [
        { type: "scatter", mode: "lines+markers", name: "Scenario", x: PM.YEARS, y: traj.map(function (o) { return o.total; }), line: { color: App.color("--c1"), width: 2 }, marker: { size: 7 },
          hovertemplate: "%{x}: %{y:.4f} USD/Wp<extra>Scenario</extra>" },
        { type: "scatter", mode: "lines", name: "Baseline", x: PM.YEARS, y: btraj.map(function (o) { return o.total; }), line: { color: App.color("--c2"), width: 2, dash: "dot" },
          hovertemplate: "%{x}: %{y:.4f} USD/Wp<extra>Baseline</extra>" }
      ], { yaxis: { title: { text: "USD/Wp" } }, xaxis: { dtick: 1 },
        shapes: [{ type: "line", x0: st.year, x1: st.year, yref: "paper", y0: 0, y1: 1, line: { color: App.color("--axis"), width: 1, dash: "dash" } }] });
    }
  });

  function kpi(label, value, unit, foot, tip) {
    return '<div class="card kpi"><div class="label">' + label + " " + (tip ? App.info(tip) : "") + '</div><div class="value">' + value + '<span class="unit">' + unit + '</span></div><div class="foot">' + foot + "</div></div>";
  }

  // ======================================================== BREAKDOWN
  App.register("breakdown", {
    title: "Cost breakdown", icon: "▤", section: "Detailed analysis",
    render: function () {
      var st = App.state, cur = App.current(), base = App.baseline();
      var h = '<div class="page-head"><div><h1>Manufacturing cost breakdown</h1><p>Drill into each value-chain stage: cost components, how each is calculated (with the original Excel formula and cell), and the assumptions that drive it. ' +
        PM.TECH[st.tech].longLabel + ", " + esc(st.country) + ", " + st.year + ".</p></div></div>";
      h += notices(cur, st);
      h += '<div class="card"><div class="card-head"><h2>Value chain</h2><span class="sub">USD/Wp — conversion cost added at each stage</span></div><div class="flow">';
      if (cur.purchased) h += '<div class="node"><div class="t">' + cur.purchased.label + '</div><div class="v">' + F.wp(cur.purchased.value) + "</div>" + App.tag("ext", "Extension") + '</div><div class="arrow">→</div>';
      cur.stages.forEach(function (s, i) {
        h += '<div class="node' + (s.included ? "" : " excluded") + '"><div class="t">' + (i + 1) + ". " + s.label + '</div><div class="v">' + (s.included ? F.wp(s.value) : "—") + "</div>" +
          (s.imported ? App.tag("imp", "Imported · " + s.source) : s.included ? App.tag("wb", "Domestic") : App.tag("fix", "In purchased price")) + "</div>" + '<div class="arrow">' + (i < 3 ? "→" : "=") + "</div>";
      });
      h += '<div class="node" style="background:var(--accent-soft)"><div class="t">Module cost</div><div class="v">' + F.wp(cur.total) + "</div>" + F.delta(cur.total - base.total, base.total) + "</div></div></div>";
      h += '<div class="card section"><div class="card-head"><h2>All cost components</h2><span class="sub">USD/Wp, coloured by cost type</span></div><div id="ch-comps" class="chart tall"></div></div>';
      h += '<div class="section">';
      cur.stages.forEach(function (s, i) { h += stageCard(s, i, cur, base.stages[i], base); });
      h += "</div>";
      return h;
    },
    after: function () {
      var cur = App.current(), ys = [], xs = [], cols = [], hov = [];
      cur.stages.forEach(function (s) {
        if (!s.included) return;
        s.comps.slice().sort(function (a, b) { return a.value - b.value; }).forEach(function (c) {
          ys.push(s.short + " · " + c.label); xs.push(c.value);
          var g = App.groupOfCat(c.cat); cols.push(App.color(g.v)); hov.push(g.label);
        });
      });
      var used = {};
      var traces = [{ type: "bar", orientation: "h", y: ys, x: xs, marker: { color: cols }, customdata: hov, showlegend: false,
        hovertemplate: "%{y}<br>%{x:.5f} USD/Wp · %{customdata}<extra></extra>" }];
      cur.stages.forEach(function (s) { s.comps.forEach(function (c) { used[App.groupOfCat(c.cat).id] = true; }); });
      App.GROUPS.forEach(function (g) { if (used[g.id]) traces.push({ type: "bar", x: [null], y: [null], name: g.label, marker: { color: App.color(g.v) }, showlegend: true, hoverinfo: "skip" }); });
      App.plot("ch-comps", traces, { margin: { l: 250 }, xaxis: { title: { text: "USD/Wp" } }, yaxis: { automargin: true, tickfont: { size: 11 } }, height: Math.max(380, ys.length * 17 + 90) });
    }
  });

  function stageCard(s, i, cur, b, base) {
    var st = App.state, total = cur.total;
    var h = '<details class="stage"' + (i === 0 || s.imported ? " open" : "") + "><summary>" +
      '<div class="stage-num" style="background:' + App.stageColor(i) + (i < 2 ? ";color:#0b0b0b" : "") + '">' + (i + 1) + "</div>" +
      "<div><h3>" + s.label + ' <span class="chev">▸</span></h3><div class="stage-meta"><span>' + s.plain + "</span></div>" +
      '<div class="stage-meta"><span>Source: <b>' + (s.imported ? "Imported from " + esc(s.source) : "Domestic (" + esc(st.country) + ")") + "</b></span>" +
      "<span>Share of module cost: <b>" + (s.included ? F.pct(s.value / total) : "excluded") + "</b></span>" +
      (s.perKg ? "<span>Per unit of output: <b>" + F.wp(s.perKg, 3) + " USD/kg</b> polysilicon</span>" : "") +
      "<span>vs baseline: " + F.delta(s.value - b.value, b.value) + "</span></div></div>" +
      '<div class="stage-val">' + F.wp(s.value) + '<div class="small muted" style="font-weight:400">USD/Wp</div></div></summary><div class="stage-body">';
    if (!s.included) h += '<div class="notice ext"><span class="ico">i</span><div>This stage is covered by the purchased ' + (cur.purchased ? cur.purchased.kind : "") + " price (extension mode) and is not added to the total — preventing double counting. Values below are shown for reference only.</div></div>";
    h += '<div class="table-wrap"><table class="data"><thead><tr><th>Component</th><th>Cost type</th><th class="num">USD/Wp</th>' + (i === 0 && !s.imported ? '<th class="num">USD/kg poly</th>' : "") +
      '<th class="num">Share of stage</th><th class="num">Δ vs baseline</th><th>Calculation</th></tr></thead><tbody>';
    s.comps.forEach(function (c, j) {
      var bc = b.comps[j] && b.comps[j].id === c.id ? b.comps[j].value : NaN, g = App.groupOfCat(c.cat), f = model.engine.formulaOf(c.cell);
      h += '<tr><td><span class="swatch" style="background:' + App.color(g.v) + '"></span>' + c.label + '</td><td class="small">' + PM.CATEGORIES[c.cat].label + '</td><td class="num">' + F.wp(c.value, 5) + "</td>" +
        (i === 0 && !s.imported ? '<td class="num">' + F.wp(c.native, 4) + "</td>" : "") +
        '<td class="num">' + F.pct(c.value / s.value) + '</td><td class="num">' + (isFinite(bc) ? F.delta(c.value - bc, null, 5) : "–") + "</td>" +
        '<td class="small" style="min-width:260px">' + esc(c.how) + '<details class="formula"><summary>Excel: <code>' + esc(c.cell) + "</code></summary><pre>" + esc(f || "(constant value)") + "</pre></details></td></tr>";
    });
    h += '<tr class="total"><td>Stage total</td><td></td><td class="num">' + F.wp(s.value, 5) + "</td>" + (i === 0 && !s.imported ? '<td class="num">' + F.wp(s.perKg, 4) + "</td>" : "") +
      '<td class="num">100%</td><td class="num">' + F.delta(s.value - b.value, b.value, 5) + '</td><td class="small">Excel: <code>' + esc(s.totalCell) + "</code>" +
      (i === 0 && !s.imported ? " = USD/kg × g/W ÷ 1000" : "") + "</td></tr></tbody></table></div>";
    // stage assumptions
    var ps = PM.paramsForTech(st.tech).filter(function (p) { return p.stage === s.id || (s.id === "wafer" && (p.id.indexOf(".elecPrice") > 0 || p.id.indexOf(".salary") > 0)) || (s.id === "cell" && (p.id.indexOf(".elecPrice") > 0 || p.id.indexOf(".salary") > 0 || p.id.indexOf(".efficiency") > 0)) || (s.id === "module" && (p.id.indexOf(".elecPrice") > 0 || p.id.indexOf(".salary") > 0)); });
    if (s.id !== "poly") ps = ps.filter(function (p) { return !(p.kind === "import" && p.stage !== s.id); });
    h += '<h4 style="margin:16px 0 6px">Drivers & assumptions for this stage (' + st.year + ")</h4>" + paramTable(ps, st, true);
    h += "</div></details>";
    return h;
  }

  function paramTable(ps, st, compact) {
    var h = '<div class="table-wrap"><table class="data"><thead><tr><th>Input</th><th>Value / control</th><th>Unit</th><th class="num">Workbook value</th><th>Source</th></tr></thead><tbody>';
    ps.forEach(function (p) {
      var pv = paramValue(p, st);
      h += '<tr class="param-row' + (pv.edited ? " edited" : "") + '"><td><div class="pname">' + esc(p.label) + " " + App.info(p.effect) + "</div>" +
        (pv.edited ? App.tag("mod", "User-modified") : p.editable ? App.tag("wb", "Workbook") : App.tag("fix", p.noEffect ? "Not used by cost" : "Fixed")) +
        (p.countrySpecific ? " " + App.tag("der", "Country-specific") : "") + (p.kind === "global" ? " " + App.tag("ext", "Parameterised constant") : "") + "</td>" +
        "<td>" + paramControl(p, st, compact) + "</td><td class='small'>" + esc(F.unit(p)) + (p.kind === "series" ? "<div class='muted'>value for " + st.year + "</div>" : "") + "</td>" +
        '<td class="num">' + (isFinite(pv.base) ? F.num(F.disp(p, pv.base), p.unit) : "n/a") + '</td><td class="psrc"><code>' + esc(p.source) + "</code></td></tr>";
    });
    return h + "</tbody></table></div>";
  }
  App.paramTable = paramTable;

  // ======================================================== COUNTRIES
  function countrySources(c, mode, st) {
    var origin = model.importOrigin(c);
    if (mode === "domestic" || !origin) return { poly: "Domestic", wafer: "Domestic", cell: "Domestic" };
    if (mode === "imported") return { poly: origin, wafer: origin, cell: origin };
    var s = clone(st.sources[st.tech]);
    ["poly", "wafer", "cell"].forEach(function (k) { if (model.sourceOptions(c).indexOf(s[k]) < 0) s[k] = "Domestic"; });
    return s;
  }
  function countryState(c, ui) {
    var s = clone(App.state);
    s.country = c; s.sources[s.tech] = countrySources(c, ui.sourcing, App.state);
    return model.normalise(s);
  }

  App.register("countries", {
    title: "Country comparison", icon: "◍", section: "Detailed analysis",
    render: function () {
      var st = App.state, ui = App.ui.country, all = model.countries();
      if (!ui.selected) ui.selected = all.slice();
      if (!ui.ref || all.indexOf(ui.ref) < 0) ui.ref = st.country;
      var rows = ui.selected.map(function (c) { var s = countryState(c, ui); return { c: c, st: s, out: model.compute(s) }; });
      var refRow = rows.filter(function (r) { return r.c === ui.ref; })[0] || { out: model.compute(countryState(ui.ref, ui)), c: ui.ref, st: countryState(ui.ref, ui) };
      rows.sort(function (a, b) { return a.out.total - b.out.total; });
      App.ui.country._rows = rows; App.ui.country._ref = refRow;
      if (!ui.target || ui.target === ui.ref) ui.target = (rows.filter(function (r) { return r.c !== ui.ref; }).slice(-1)[0] || {}).c || null;
      var T = PM.TECH[st.tech];
      var h = '<div class="page-head"><div><h1>Country comparison</h1><p>Same technology, year and assumptions — only the workbook\'s country-specific inputs (electricity price, salaries, CAPEX, capacity) and the selected sourcing differ. Your scenario edits are applied to every country.</p></div></div>';
      h += '<div class="card"><div class="grid g3"><div><h4>Countries</h4><div class="chips" style="margin-top:6px">' + all.map(function (c) {
        return '<label class="chip ' + (ui.selected.indexOf(c) >= 0 ? "on" : "") + '"><input type="checkbox" data-bind="cmp-country" value="' + c + '"' + (ui.selected.indexOf(c) >= 0 ? " checked" : "") + ">" + c + "</label>";
      }).join("") + "</div></div>" +
        '<label><h4>Reference country</h4><select style="margin-top:6px" data-bind="cmp-ref">' + all.map(function (c) { return "<option" + (c === ui.ref ? " selected" : "") + ">" + c + "</option>"; }).join("") + "</select></label>" +
        '<label><h4>Sourcing compared</h4><select style="margin-top:6px" data-bind="cmp-sourcing">' +
        [["domestic", "All stages domestic (like-for-like)"], ["imported", "Import poly, wafer & cell where the workbook allows"], ["current", "Use my current sourcing where valid"]].map(function (o) {
          return '<option value="' + o[0] + '"' + (o[0] === ui.sourcing ? " selected" : "") + ">" + o[1] + "</option>";
        }).join("") + "</select></label></div>" +
        '<p class="small muted" style="margin:10px 0 0">Comparing <b>' + T.longLabel + "</b>, year <b>" + st.year + "</b>, calculation mode <b>" + MODE_INFO[st.mode].label + "</b>" + (App.editCount() ? ", with <b>" + App.editCount() + " modified input(s)</b>" : ", workbook inputs") +
        ". Import options in the workbook: China for Germany, India, Australia and Vietnam; Vietnam for the US; none for China." + (st.year < PM.FIRST_IMPORT_YEAR ? " <b>Imports only apply from 2025.</b>" : "") + "</p></div>";
      h += '<div class="grid g-21 section"><div class="card"><div class="card-head"><h2>Module cost ranking</h2><span class="sub">USD/Wp, lowest first · stacked by stage</span></div><div id="ch-country" class="chart"></div></div>' +
        '<div class="card"><div class="card-head"><h2>Ranking</h2><span class="sub">vs ' + esc(ui.ref) + "</span></div><table class='data'><thead><tr><th>#</th><th>Country</th><th class='num'>USD/Wp</th><th class='num'>vs ref.</th></tr></thead><tbody>" +
        rows.map(function (r, i) { return "<tr" + (r.c === ui.ref ? ' class="total"' : "") + "><td>" + (i + 1) + "</td><td>" + r.c + '</td><td class="num">' + F.wp(r.out.total) + '</td><td class="num">' + (r.c === ui.ref ? "reference" : F.delta(r.out.total - refRow.out.total, refRow.out.total)) + "</td></tr>"; }).join("") +
        "</tbody></table></div></div>";
      // detailed table
      function inp(r, key) { var p = PM.PARAM_BY_ID[st.tech + "." + key]; return paramValue(p, r.st).cur; }
      var cols = [
        ["Module cost (USD/Wp)", function (r) { return F.wp(r.out.total); }],
        ["Δ vs reference (USD/Wp)", function (r) { return r.c === ui.ref ? "–" : F.delta(r.out.total - refRow.out.total, null); }],
        ["Δ vs reference (%)", function (r) { return r.c === ui.ref ? "–" : F.signedPct(r.out.total / refRow.out.total - 1); }],
        ["USD per module", function (r) { return F.usd(r.out.usdPerModule); }]
      ].concat(PM.STAGES.map(function (s, i) { return [s.label + " (USD/Wp)", function (r) { var x = r.out.stages[i]; return F.wp(x.value) + (x.imported ? " " + App.tag("imp", "imp.") : ""); }]; }))
        .concat([
          ["Electricity price — poly (USD/kWh)", function (r) { return F.num(inp(r, "polyElecPrice")); }],
          ["Electricity price — wafer/cell/module (USD/kWh)", function (r) { return F.num(inp(r, "elecPrice")); }],
          ["Engineer salary (USD/yr)", function (r) { return F.num(inp(r, "salary")); }],
          ["Equipment CAPEX wafer+cell+module (USD/kW)", function (r) { return F.num(inp(r, "eqWafer") + inp(r, "eqCell") + inp(r, "eqModule")); }],
          ["Building CAPEX wafer+cell+module (USD/kWp)", function (r) { return F.num(inp(r, "bldWafer") + inp(r, "bldCell") + inp(r, "bldModule")); }],
          ["Poly equipment + building (USD/kg)", function (r) { return F.num(inp(r, "polyEquip") + inp(r, "polyBld")); }],
          ["Installed capacity " + (st.year >= 2028 ? "2030" : "2025"), function (r) { return F.num(inp(r, st.year >= 2028 ? "capacity2030" : "capacity2025"), "Wp"); }],
          ["Capacity utilisation", function () { return '<span class="muted">not in workbook</span>'; }],
          ["Sourcing (poly / wafer / cell)", function (r) { var s = r.st.sources[st.tech]; return [s.poly, s.wafer, s.cell].map(function (x) { return x === "Domestic" ? "Dom." : x; }).join(" / "); }]
        ]);
      h += '<div class="card section"><div class="card-head"><h2>Detailed comparison</h2><div><button class="btn small" data-action="export-countries">⤓ Export CSV</button></div></div><div class="table-wrap"><table class="data"><thead><tr><th>Indicator</th>' +
        rows.map(function (r) { return '<th class="num">' + r.c + (r.c === ui.ref ? " ★" : "") + "</th>"; }).join("") + "</tr></thead><tbody>" +
        cols.map(function (c) { return "<tr><td>" + c[0] + "</td>" + rows.map(function (r) { return '<td class="num">' + c[1](r) + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table></div></div>";
      // drivers
      var others = rows.filter(function (r) { return r.c !== ui.ref; });
      h += '<div class="card section"><div class="card-head"><h2>Why is the cost different?</h2><label class="small">Explain <select data-bind="cmp-target">' +
        others.map(function (r) { return "<option" + (r.c === ui.target ? " selected" : "") + ">" + r.c + "</option>"; }).join("") + "</select> vs " + esc(ui.ref) + "</label></div>";
      if (ui.target && others.length) {
        var ex = AN.explainCountry(model, App.state, ui.ref, ui.target, function (c) { return countrySources(c, ui.sourcing, App.state); });
        App.ui.country._ex = ex;
        var sorted = ex.steps.slice().sort(function (a, b) { return Math.abs(b.delta) - Math.abs(a.delta); }).filter(function (s) { return Math.abs(s.delta) > 1e-9; });
        h += '<div class="grid g2"><div><div id="ch-drivers" class="chart short"></div></div><div><p><b>' + esc(ui.target) + "</b> is " + F.wp(Math.abs(ex.delta)) + " USD/Wp (" + F.pct(Math.abs(ex.delta) / ex.from.total) + ") <b>" + (ex.delta >= 0 ? "more expensive" : "cheaper") + "</b> than " + esc(ui.ref) + " in the model. The difference comes only from inputs the workbook varies by country:</p><ul class='clean'>" +
          sorted.map(function (s) {
            var detail = "";
            if (s.ids) {
              detail = s.ids.map(function (id, k) { var p = PM.PARAM_BY_ID[id]; return esc(p.label.replace(/ — .*/, "") + (p.label.indexOf("—") > 0 ? " (" + p.label.split("— ")[1] + ")" : "")) + ": " + F.num(s.from[k], p.unit) + " → " + F.num(s.to[k], p.unit) + (p.unit === "Wp" ? "" : " " + esc(p.unit)); }).join("; ");
            }
            return "<li><b>" + esc(s.label) + "</b>: " + F.delta(s.delta, null) + " USD/Wp" + (detail ? '<div class="small muted">' + detail + "</div>" : "") + "</li>";
          }).join("") + "</ul>" +
          '<p class="small muted">Sequential substitution: each input group is switched from the reference to the target country\'s workbook value in turn; the steps add up exactly to the total difference. Overheads and operating profit are proportional to stage cost, so they move with each driver. Taxes, subsidies, tariffs and logistics are not modelled separately (they may be embedded in the hardcoded import prices, which the workbook does not document).</p></div></div>';
      }
      h += "</div>";
      return h;
    },
    after: function () {
      var rows = App.ui.country._rows, st = App.state;
      var y = rows.map(function (r) { return r.c; });
      var traces = PM.STAGES.map(function (s, i) {
        return { type: "bar", orientation: "h", name: s.label, y: y, x: rows.map(function (r) { var x = r.out.stages[i]; return x.included ? x.value : 0; }),
          marker: { color: App.stageColor(i), line: { color: App.color("--surface"), width: 1 } },
          customdata: rows.map(function (r) { return r.out.stages[i].imported ? "imported from " + r.out.stages[i].source : "domestic"; }),
          hovertemplate: "%{y} · " + s.label + " (%{customdata})<br>%{x:.4f} USD/Wp<extra></extra>" };
      });
      if (rows.some(function (r) { return r.out.purchased; })) traces.unshift({ type: "bar", orientation: "h", name: "Purchased (extension)", y: y, x: rows.map(function (r) { return r.out.purchased ? r.out.purchased.value : 0; }), marker: { color: App.color("--s5") } });
      App.plot("ch-country", traces, { barmode: "stack", xaxis: { title: { text: "USD/Wp" } }, margin: { l: 80 },
        annotations: rows.map(function (r) { return { x: r.out.total, y: r.c, text: F.wp(r.out.total), xanchor: "left", showarrow: false, xshift: 4, font: { size: 11, color: App.color("--ink-2") } }; }) });
      var ex = App.ui.country._ex;
      if (ex && document.getElementById("ch-drivers")) {
        var steps = ex.steps.filter(function (s) { return Math.abs(s.delta) > 1e-9; });
        App.plot("ch-drivers", [{ type: "bar", orientation: "h", y: steps.map(function (s) { return s.label.replace(" (destination-specific import tables)", "").replace(" (ESG certification scaling)", " (ESG)"); }), x: steps.map(function (s) { return s.delta; }),
          marker: { color: steps.map(function (s) { return s.delta > 0 ? App.color("--inc") : App.color("--dec"); }) }, hovertemplate: "%{y}<br>%{x:+.4f} USD/Wp<extra></extra>",
          text: steps.map(function (s) { return F.signed(s.delta); }), textposition: "auto" }],
          { margin: { l: 200 }, xaxis: { title: { text: "Δ USD/Wp (" + App.ui.country.target + " − " + App.ui.country.ref + ")" } }, yaxis: { autorange: "reversed" }, showlegend: false });
      }
      void st;
    }
  });
  App.binds["cmp-country"] = function (v, el) {
    var ui = App.ui.country, c = el.value;
    if (el.checked) { if (ui.selected.indexOf(c) < 0) ui.selected.push(c); } else ui.selected = ui.selected.filter(function (x) { return x !== c; });
    if (!ui.selected.length) ui.selected = [c];
    App.render();
  };
  App.binds["cmp-ref"] = function (v) { App.ui.country.ref = v; if (App.ui.country.selected.indexOf(v) < 0) App.ui.country.selected.push(v); App.render(); };
  App.binds["cmp-sourcing"] = function (v) { App.ui.country.sourcing = v; App.render(); };
  App.binds["cmp-target"] = function (v) { App.ui.country.target = v; App.render(); };
  App.actions["export-countries"] = function () {
    var rows = App.ui.country._rows, st = App.state;
    var out = [["Country", "Technology", "Year", "Sourcing poly", "Sourcing wafer", "Sourcing cell", "Module cost USD/Wp", "Polysilicon", "Ingot & wafer", "Solar cell", "Module assembly", "USD per module", "Module W"]];
    rows.forEach(function (r) { var s = r.st.sources[st.tech]; out.push([r.c, PM.TECH[st.tech].label, st.year, s.poly, s.wafer, s.cell, r.out.total].concat(r.out.stages.map(function (x) { return x.value; })).concat([r.out.usdPerModule, r.out.modulePowerW])); });
    App.download("country_comparison_" + st.tech + "_" + st.year + ".csv", App.csv(out), "text/csv");
  };

  // ======================================================== INPUTS
  var CORE = ["polyPrice", "polyElecPrice", "elecPrice", "polySalary", "salary", "siPrice", "silverPrice", "moduleOther", "efficiency", "gPerW", "polyEquip", "eqWafer", "eqCell", "eqModule", "capacity2025", "import.poly", "import.wafer", "import.cell"];
  App.register("inputs", {
    title: "Input control center", icon: "⚙", section: "Configure",
    render: function () {
      var st = App.state, ui = App.ui.inputs, T = PM.TECH[st.tech], opts = model.sourceOptions(st.country), cur = App.current();
      var h = '<div class="page-head"><div><h1>Input control center</h1><p>Change any input the workbook\'s calculation actually uses. Values are entered in the workbook\'s own units; the % box changes a value relative to the original workbook value. Every change recalculates all pages.</p></div>' +
        '<div class="chips"><button class="btn" data-action="inspect">☰ Inspect active assumptions</button><button class="btn" data-action="save-scenario-prompt">＋ Save as scenario</button><button class="btn" data-action="export-results">⤓ Export results (CSV)</button><button class="btn" data-action="export-current">⤓ Export scenario (JSON)</button><button class="btn" data-action="reset-all">↺ Reset to workbook</button></div></div>';
      // 1-3: country, technology, supply chain
      h += '<div class="grid g3"><div class="card"><h4>1 · Country & location</h4><select style="margin-top:8px;width:100%" data-bind="country">' + model.countries().map(function (c) { return "<option" + (c === st.country ? " selected" : "") + ">" + c + "</option>"; }).join("") + "</select>" +
        '<p class="small muted" style="margin-top:8px">Loads the workbook\'s country-specific defaults (Country_Index sheet): electricity prices, salaries, CAPEX and capacity. Your % changes are kept relative to the new country\'s values.</p></div>' +
        '<div class="card"><h4>2 · Manufacturing technology</h4><div class="seg" style="margin-top:8px">' + ["topcon", "mono"].map(function (t) { return '<button data-action="set-tech" data-tech="' + t + '" class="' + (st.tech === t ? "on" : "") + '">' + PM.TECH[t].label + "</button>"; }).join("") + "</div>" +
        '<p class="small muted" style="margin-top:8px">' + T.longLabel + ". The workbook calculates both technologies in parallel with separate input blocks; edits apply to the technology shown.</p></div>" +
        '<div class="card"><h4>3 · Supply-chain configuration</h4><table class="data" style="margin-top:6px"><tbody>' + ["poly", "wafer", "cell"].map(function (k) {
          return "<tr><td>" + STAGE_LABEL[k] + "</td><td><select data-bind=\"source\" data-stage=\"" + k + "\"" + (opts.length < 2 ? " disabled" : "") + ">" + opts.map(function (o) { return "<option value=\"" + o + "\"" + (st.sources[st.tech][k] === o ? " selected" : "") + ">" + (o === "Domestic" ? "Domestic" : "Imported from " + o) + "</option>"; }).join("") + "</select></td></tr>";
        }).join("") + "<tr><td>Module assembly</td><td class='muted small'>Always domestic</td></tr></tbody></table>" +
        '<p class="small muted" style="margin-top:6px">Options come from the workbook\'s dropdown lists (' + esc(st.country) + ": " + opts.join(", ") + "). Imports apply 2025–2030.</p></div></div>";
      // calculation mode
      h += '<div class="card section"><div class="card-head"><h2>Calculation mode</h2><span class="sub">How purchased intermediate products are treated</span></div><div class="grid g3">' +
        ["workbook", "wafer", "cell"].map(function (m) {
          var on = st.mode === m, extra = "";
          if (m !== "workbook" && on) {
            var pd = cur.purchased;
            extra = '<div style="margin-top:8px"><label class="small">All-in purchased ' + m + ' price (USD/Wp)<div class="param-ctrl" style="margin-top:4px"><input type="number" step="0.001" data-bind="purchased" data-kind="' + m + '" data-focus="purch:' + m + '" value="' + (pd ? Number(pd.value.toPrecision(6)) : "") + '">' +
              (pd && !pd.isDefault ? '<button class="btn small ghost" data-action="reset-purchased" data-kind="' + m + '">↺</button>' : "") + "</div></label>" +
              '<div class="small muted">' + (pd && pd.isDefault ? App.tag("der", "Derived default") + " = workbook upstream cost " + F.wp(pd.derivedDefault) : App.tag("mod", "User-supplied price") + " · workbook upstream cost would be " + F.wp(pd.derivedDefault)) + "</div></div>";
          }
          return '<div class="card" style="box-shadow:none;' + (on ? "border-color:var(--accent);background:var(--accent-soft)" : "") + '"><label class="toggle" style="font-weight:600;color:var(--ink)"><input type="radio" name="mode" data-bind="mode" value="' + m + '"' + (on ? " checked" : "") + "> " + MODE_INFO[m].label + "</label>" +
            '<p class="small" style="margin-top:6px;color:var(--ink-2)">' + MODE_INFO[m].text + "</p>" + extra + "</div>";
        }).join("") + "</div></div>";
      // parameter groups
      h += '<div class="section" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:12px"><input type="search" placeholder="Search inputs…" data-bind="inp-q" data-focus="inp-q" value="' + esc(ui.q) + '" style="min-width:260px">' +
        '<label class="toggle"><input type="checkbox" data-bind="inp-adv"' + (ui.advanced ? " checked" : "") + "> Show advanced engineering assumptions</label>" +
        '<span class="small muted">' + (ui.advanced ? "All inputs used by the calculation are shown." : "Showing the main cost drivers. Tick 'advanced' for lifetimes, labour intensity, overhead rates, embedded constants, etc.") + "</span></div>";
      var params = PM.paramsForTech(st.tech).filter(function (p) {
        var short = p.id.replace(/^(topcon|mono|global)\./, "");
        if (!ui.advanced && CORE.indexOf(short) < 0 && !st.edits[p.id]) return false;
        if (ui.q) return (p.label + " " + p.effect + " " + p.source + " " + p.unit).toLowerCase().indexOf(ui.q.toLowerCase()) >= 0;
        return true;
      });
      var num = { capacity: 4, energy: 6, labour: 7, materials: 8, yield: 9, capex: 10, depreciation: 11, supply: "3b", other: 12 };
      PM.PARAM_GROUPS.forEach(function (g) {
        var ps = params.filter(function (p) { return p.group === g.id; });
        var extra = "";
        if (g.id === "capacity") extra = '<div class="notice info" style="margin:8px"><span class="ico">5</span><div><b>Capacity utilisation</b> is not an input of the workbook. A hardcoded 0.9 factor appears in the overhead formulas (capacity × 0.9 ÷ capacity) but cancels capacity out, so utilisation cannot be simulated without extending the model.</div></div>';
        if (!ps.length && !extra) return;
        var nEdit = ps.filter(function (p) { return paramValue(p, st).edited; }).length;
        h += '<details class="pgroup" open><summary><span>' + num[g.id] + " · " + g.label + "</span><span>" + (nEdit ? App.tag("mod", nEdit + " modified") : "") + ' <span class="muted small">' + ps.length + " inputs</span></span></summary><div class=\"pgroup-body\">" + extra + (ps.length ? paramTable(ps, st, false) : "") + "</div></details>";
      });
      if (!params.length) h += '<div class="empty">No inputs match your search.</div>';
      return h;
    }
  });
  App.binds.source = function (v, el) { var k = el.getAttribute("data-stage"); App.set(function (s) { s.sources[s.tech][k] = v; }); };
  App.binds.mode = function (v) { App.set(function (s) { s.mode = v; }); };
  App.binds.purchased = function (v, el) {
    var k = el.getAttribute("data-kind"), x = parseFloat(v);
    App.set(function (s) { s.purchased = s.purchased || {}; s.purchased[k] = isNaN(x) ? null : x; });
  };
  App.actions["reset-purchased"] = function (el) { var k = el.getAttribute("data-kind"); App.set(function (s) { s.purchased[k] = null; }); };
  App.binds["inp-q"] = function (v) { App.ui.inputs.q = v; App.render(); };
  App.binds["inp-adv"] = function (v) { App.ui.inputs.advanced = v; App.render(); };

  function activeAssumptionRows(st) {
    var rows = [];
    PM.paramsForTech(st.tech).forEach(function (p) {
      var pv = paramValue(p, st);
      rows.push({ p: p, cur: pv.cur, base: pv.base, edited: pv.edited });
    });
    return rows;
  }
  App.actions.inspect = function () {
    var st = App.state, rows = activeAssumptionRows(st), cur = App.current();
    var h = '<div class="modal-head"><h2>Active assumptions</h2><button class="btn ghost" data-action="close-modal">✕</button></div>' +
      '<p class="small">' + configSummary(st) + "<br>Mode: " + MODE_INFO[st.mode].label + (cur.purchased ? " · purchased price " + F.wp(cur.purchased.value) + " USD/Wp (" + (cur.purchased.isDefault ? "derived default" : "user-supplied") + ")" : "") + "</p>" +
      '<table class="data"><thead><tr><th>Input</th><th class="num">Active value</th><th class="num">Workbook value</th><th>Unit</th><th>Status</th></tr></thead><tbody>' +
      rows.sort(function (a, b) { return (b.edited ? 1 : 0) - (a.edited ? 1 : 0); }).map(function (r) {
        return "<tr" + (r.edited ? ' class="edited"' : "") + "><td>" + esc(r.p.label) + '</td><td class="num">' + F.num(F.disp(r.p, r.cur), r.p.unit) + '</td><td class="num">' + F.num(F.disp(r.p, r.base), r.p.unit) + "</td><td class='small'>" + esc(F.unit(r.p)) + (r.p.kind === "series" ? " (" + st.year + ")" : "") + "</td><td>" +
          (r.edited ? App.tag("mod", "User-modified") : r.p.editable ? App.tag("wb", "Workbook") : App.tag("fix", "Fixed")) + "</td></tr>";
      }).join("") + "</tbody></table>";
    App.modal(h);
  };
  App.actions["export-results"] = function () {
    var st = App.state, cur = App.current(), base = App.baseline(), out = [];
    out.push(["IRENA Solar PV Manufacturing Cost Model — results export"]);
    out.push(["Country", st.country], ["Technology", PM.TECH[st.tech].longLabel], ["Year", st.year], ["Calculation mode", MODE_INFO[st.mode].label], ["Baseline", App.baselineState().name], []);
    out.push(["Stage", "Component", "Cost type", "Scenario USD/Wp", "Baseline USD/Wp", "Excel cell", "Included in total"]);
    cur.stages.forEach(function (s, i) {
      s.comps.forEach(function (c, j) { var b = base.stages[i].comps[j]; out.push([s.label, c.label, PM.CATEGORIES[c.cat].label, c.value, b && b.id === c.id ? b.value : "", c.cell, s.included ? "yes" : "no"]); });
      out.push([s.label, "STAGE TOTAL", "", s.value, base.stages[i].value, s.totalCell, s.included ? "yes" : "no"]);
    });
    if (cur.purchased) out.push([cur.purchased.label, "", "Purchased (extension)", cur.purchased.value, base.purchased ? base.purchased.value : "", "", "yes"]);
    out.push(["TOTAL", "Module cost incl. ESG", "", cur.total, base.total, cur.totalCell, ""], ["TOTAL", "USD per module", "", cur.usdPerModule, base.usdPerModule, "", ""], []);
    out.push(["Input", "Active value", "Workbook value", "Unit", "Status", "Source"]);
    activeAssumptionRows(st).forEach(function (r) { out.push([r.p.label, r.cur, r.base, r.p.unit + (r.p.kind === "series" ? " (" + st.year + ")" : ""), r.edited ? "user-modified" : "workbook", r.p.source]); });
    App.download("pv_cost_results_" + st.country + "_" + st.tech + "_" + st.year + ".csv", App.csv(out), "text/csv");
  };
  App.actions["export-current"] = function () {
    App.download("pv_scenario.json", JSON.stringify({ app: "IRENA Solar PV Cost Intelligence", version: 1, scenarios: [{ name: "Exported scenario", state: App.state }] }, null, 2), "application/json");
  };
  App.actions["save-scenario-prompt"] = function () {
    var name = window.prompt("Scenario name", defaultScenarioName());
    if (name) saveScenario(name);
  };

  // ======================================================== SCENARIO LAB
  function defaultScenarioName() {
    var st = App.state;
    return st.country + " " + PM.TECH[st.tech].label + " " + st.year + (App.editCount() ? " (" + App.editCount() + " edits)" : "");
  }
  function saveScenario(name) {
    App.scenarios.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name, created: new Date().toISOString(), state: clone(App.state) });
    App.saveScenarios(); App.render(); App.toast("Scenario “" + name + "” saved");
  }

  var EXPERIMENTS = [
    { id: "elec", label: "Electricity price +20%", ids: ["polyElecPrice", "elecPrice"], pct: 20 },
    { id: "labour", label: "Labour cost +10%", ids: ["polySalary", "salary"], pct: 10 },
    { id: "si", label: "Metal silicon price −15%", ids: ["siPrice"], pct: -15, note: "The workbook has no purchased-polysilicon price for domestic production; metal silicon is the polysilicon raw material." },
    { id: "polyimp", label: "Imported polysilicon price −15%", ids: ["import.poly"], pct: -15, needs: "poly" },
    { id: "waferimp", label: "Wafer price +8%", ids: ["import.wafer"], pct: 8, needs: "wafer", purchased: "wafer" },
    { id: "yield", label: "Silicon yield +5% (conversion ratio −5%)", ids: ["siRatio"], pct: -5 },
    { id: "eff", label: "Cell efficiency +4% (relative)", ids: ["efficiency"], pct: 4 },
    { id: "cap", label: "Production capacity +50%", ids: ["capacity2025", "capacity2030"], pct: 50, note: "In the workbook capacity only scales ESG certification cost." },
    { id: "capex", label: "Equipment CAPEX −20%", ids: ["polyEquip", "eqWafer", "eqCell", "eqModule"], pct: -20 },
    { id: "silver", label: "Silver price +25%", ids: ["silverPrice"], pct: 25 }
  ];
  function expAvailable(x, st) {
    if (x.purchased && st.mode === x.purchased) return true;
    if (x.needs) return model.isImported(st, st.tech, x.needs);
    return true;
  }
  App.actions.exp = function (el) {
    var x = EXPERIMENTS.filter(function (e) { return e.id === el.getAttribute("data-exp"); })[0], st = App.state;
    if (!expAvailable(x, st)) { App.toast("Not applicable: " + STAGE_LABEL[x.needs] + " is not imported in this configuration"); return; }
    if (x.purchased && st.mode === x.purchased) {
      var cur = App.current();
      App.set(function (s) { s.purchased[x.purchased] = cur.purchased.value * (1 + x.pct / 100); });
    } else {
      App.set(function (s) { x.ids.forEach(function (id) { s.edits[(id.indexOf("import.poly") === 0 ? "topcon." : s.tech + ".") + id] = { mode: "pct", value: x.pct }; }); });
    }
    App.toast("Applied: " + x.label);
  };
  App.actions["remove-edit"] = function (el) { var id = el.getAttribute("data-id"); App.set(function (s) { delete s.edits[id]; }); };
  App.actions["lab-apply"] = function () {
    var ui = App.ui.lab, p = PM.PARAM_BY_ID[ui.param], v = parseFloat(ui.pct);
    if (!p || isNaN(v)) { App.toast("Choose an input and a % change"); return; }
    App.set(function (s) { if (v === 0) delete s.edits[p.id]; else s.edits[p.id] = { mode: "pct", value: v }; });
  };
  App.binds["lab-param"] = function (v) { App.ui.lab.param = v; };
  App.binds["lab-pct"] = function (v) { App.ui.lab.pct = v; };
  App.binds["lab-name"] = function (v) { App.ui.lab.name = v; };
  App.actions["lab-save"] = function () {
    var name = (App.ui.lab.name || "").trim() || defaultScenarioName();
    App.ui.lab.name = ""; saveScenario(name);
  };
  function findScn(el) { var id = el.getAttribute("data-id"); return App.scenarios.filter(function (x) { return x.id === id; })[0]; }
  App.actions["scn-load"] = function (el) { var s = findScn(el); App.set(function (st) { Object.assign(st, clone(s.state)); }); App.toast("Loaded “" + s.name + "”"); };
  App.actions["scn-dup"] = function (el) { var s = findScn(el); App.scenarios.push({ id: Date.now().toString(36), name: s.name + " (copy)", created: new Date().toISOString(), state: clone(s.state) }); App.saveScenarios(); App.render(); };
  App.actions["scn-del"] = function (el) {
    var s = findScn(el);
    if (!window.confirm("Delete scenario “" + s.name + "”?")) return;
    App.scenarios = App.scenarios.filter(function (x) { return x !== s; });
    if (App.baselineRef === "scn:" + s.id) App.setBaselineRef("defaults");
    App.saveScenarios(); App.render();
  };
  App.actions["scn-base"] = function (el) { var s = findScn(el); App.setBaselineRef("scn:" + s.id); App.toast("“" + s.name + "” is now the baseline"); };
  App.actions["scn-rename"] = function (el) { var s = findScn(el); var n = window.prompt("Rename scenario", s.name); if (n) { s.name = n; App.saveScenarios(); App.render(); } };
  App.binds["scn-cmp"] = function (v, el) {
    var id = el.getAttribute("data-id"), ui = App.ui.lab;
    if (el.checked) ui.compare.push(id); else ui.compare = ui.compare.filter(function (x) { return x !== id; });
    App.render();
  };
  App.actions["scn-export"] = function () { App.download("pv_scenarios.json", JSON.stringify({ app: "IRENA Solar PV Cost Intelligence", version: 1, scenarios: App.scenarios }, null, 2), "application/json"); };
  App.actions["scn-import"] = function () { document.getElementById("file-import").click(); };

  App.register("scenarios", {
    title: "Scenario lab", icon: "⚗", section: "Simulate",
    render: function () {
      var st = App.state, ui = App.ui.lab, cur = App.current(), base = App.baseline(), bs = App.baselineState();
      var h = '<div class="page-head"><div><h1>Scenario simulation lab</h1><p>Build what-if scenarios by changing one or several inputs, then save, duplicate and compare them. Percentages are applied to the original workbook value (baseline). Example percentages are <b>illustrative experiments, not forecasts</b>.</p></div></div>';
      h += '<div class="grid g-12"><div>';
      h += '<div class="card"><div class="card-head"><h2>Quick experiments</h2>' + App.tag("ill", "Illustrative") + '</div><div class="chips">' +
        EXPERIMENTS.map(function (x) {
          var ok = expAvailable(x, st);
          return '<button class="btn small" data-action="exp" data-exp="' + x.id + '"' + (ok ? "" : ' disabled title="Applies only when this stage is imported (or in the purchased-wafer mode)"') + ">" + x.label + "</button>";
        }).join("") + '</div><p class="small muted" style="margin-top:8px">Experiments overwrite any existing change of the same input. Country and technology switches: use the top bar.</p></div>';
      var opts = AN.sensitivityParams(model, st);
      h += '<div class="card section"><h2>Custom change</h2><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><select data-bind="lab-param" style="flex:1;min-width:200px"><option value="">Choose an input…</option>' +
        PM.PARAM_GROUPS.map(function (g) {
          var ps = opts.filter(function (p) { return p.group === g.id; });
          return ps.length ? '<optgroup label="' + esc(g.label) + '">' + ps.map(function (p) { return '<option value="' + p.id + '"' + (ui.param === p.id ? " selected" : "") + ">" + esc(p.label) + "</option>"; }).join("") + "</optgroup>" : "";
        }).join("") + '</select><input type="number" class="pct" value="' + esc(ui.pct) + '" data-bind="lab-pct"><span class="small muted" style="align-self:center">%</span><button class="btn primary" data-action="lab-apply">Apply</button></div></div>';
      var edits = Object.keys(st.edits);
      h += '<div class="card section"><div class="card-head"><h2>Active changes</h2><span class="sub">' + edits.length + "</span></div>" + (edits.length ? '<table class="data"><tbody>' + edits.map(function (id) {
        var p = PM.PARAM_BY_ID[id]; if (!p) return "";
        var pv = paramValue(p, st);
        return "<tr><td>" + esc(p.label) + '<div class="small muted">' + F.num(F.disp(p, pv.base), p.unit) + " → " + F.num(F.disp(p, pv.cur), p.unit) + " " + esc(F.unit(p)) + '</div></td><td class="num">' + (p.deltaOnly ? F.signed(pv.cur, 2) + " " + esc(p.unit) : F.signedPct(pv.cur / pv.base - 1)) + '</td><td><button class="btn small ghost" data-action="remove-edit" data-id="' + id + '">✕</button></td></tr>';
      }).join("") + "</tbody></table>" : '<p class="muted small">No inputs changed — the scenario equals the workbook for this configuration.</p>') +
        (st.mode !== "workbook" ? '<p class="small" style="margin-top:8px">' + App.tag("ext", MODE_INFO[st.mode].label) + "</p>" : "") + "</div>";
      h += '<div class="card section"><h2>Save scenario</h2><div style="display:flex;gap:8px;margin-top:10px"><input type="text" placeholder="' + esc(defaultScenarioName()) + '" value="' + esc(ui.name) + '" data-bind="lab-name" style="flex:1"><button class="btn primary" data-action="lab-save">Save</button></div>' +
        '<p class="small muted" style="margin-top:6px">Scenarios are stored in this browser (localStorage). Use Export/Import to move them between computers.</p></div>';
      h += "</div><div>";
      // results
      h += '<div class="grid g4">' +
        kpi("Baseline", F.wp(base.total), "USD/Wp", esc(bs.name)) +
        kpi("Scenario", F.wp(cur.total), "USD/Wp", configSummary(st).split("<br>")[0]) +
        kpi("Change", F.signed(cur.total - base.total), "USD/Wp", F.delta(cur.usdPerModule - base.usdPerModule, null, 2) + " USD/module") +
        kpi("Change", F.signedPct(cur.total / base.total - 1), "", "relative to baseline") + "</div>";
      var at = AN.attribute(model, bs, st);
      App.ui.lab._at = at;
      h += '<div class="card section"><div class="card-head"><h2>Which variables explain the difference?</h2><span class="sub">Sequential attribution — steps add up exactly</span></div>' +
        (at.steps.length ? '<div id="ch-attr" class="chart short"></div><table class="data"><thead><tr><th>Step</th><th class="num">Δ USD/Wp</th><th class="num">Share of change</th>' + PM.STAGES.map(function (s) { return '<th class="num">' + s.short + "</th>"; }).join("") + "</tr></thead><tbody>" +
          at.steps.map(function (s) { return "<tr><td>" + esc(s.label) + '</td><td class="num">' + F.delta(s.delta, null) + '</td><td class="num">' + (Math.abs(at.delta) > 1e-12 ? F.pct(s.delta / at.delta) : "–") + "</td>" + PM.STAGES.map(function (x) { return '<td class="num small">' + F.signed(s.stages[x.id] || 0, 5) + "</td>"; }).join("") + "</tr>"; }).join("") +
          '<tr class="total"><td>Total change</td><td class="num">' + F.delta(at.delta, null) + '</td><td class="num">100%</td>' + PM.STAGES.map(function (x) { return '<td class="num small">' + F.signed(at.steps.reduce(function (a, s) { return a + (s.stages[x.id] || 0); }, 0), 5) + "</td>"; }).join("") + "</tr></tbody></table>"
          : '<p class="muted">The scenario is identical to the baseline. Apply an experiment or change an input.</p>') + "</div>";
      // stage & component changes
      var compRows = [];
      cur.stages.forEach(function (s, i) { s.comps.forEach(function (c, j) { var b = base.stages[i].comps[j]; if (b && b.id === c.id) compRows.push({ s: s, c: c, d: (s.included ? c.value : 0) - (base.stages[i].included ? b.value : 0), b: b.value }); }); });
      compRows = compRows.filter(function (r) { return Math.abs(r.d) > 1e-10; }).sort(function (a, b) { return Math.abs(b.d) - Math.abs(a.d); });
      h += '<div class="grid g2 section"><div class="card"><h2>Change by stage</h2><div class="table-wrap"><table class="data" style="margin-top:8px"><thead><tr><th>Stage</th><th class="num">Scenario</th><th class="num">Baseline</th><th class="num">Δ</th><th class="num">Share</th></tr></thead><tbody>' + stageTableRows(cur, base) + "</tbody></table></div></div>" +
        '<div class="card"><h2>Change by cost component</h2>' + (compRows.length ? '<table class="data" style="margin-top:8px"><thead><tr><th>Component</th><th class="num">Δ USD/Wp</th><th class="num">Δ %</th></tr></thead><tbody>' +
          compRows.slice(0, 14).map(function (r) { return "<tr><td>" + r.s.short + " · " + esc(r.c.label) + '</td><td class="num">' + F.delta(r.d, null, 5) + '</td><td class="num">' + (r.b ? F.signedPct(r.d / r.b) : "–") + "</td></tr>"; }).join("") + "</tbody></table>" : '<p class="muted small" style="margin-top:8px">No component changed (or components are not comparable across configurations).</p>') + "</div></div>";
      h += "</div></div>";
      // saved scenarios
      h += '<div class="card section"><div class="card-head"><h2>Saved scenarios</h2><div class="chips"><button class="btn small" data-action="scn-import">⤒ Import JSON</button><button class="btn small" data-action="scn-export"' + (App.scenarios.length ? "" : " disabled") + ">⤓ Export all</button></div></div>";
      if (!App.scenarios.length) h += '<p class="muted">No saved scenarios yet. Save the current inputs above to compare scenarios side by side.</p>';
      else {
        var all = [{ id: "__base", name: "Baseline: " + bs.name, out: base, fixed: true }, { id: "__cur", name: "Current (unsaved)", out: cur, fixed: true }]
          .concat(App.scenarios.map(function (s) { return { id: s.id, name: s.name, s: s, out: model.compute(s.state) }; }));
        App.ui.lab._all = all;
        h += '<div class="table-wrap"><table class="data"><thead><tr><th>Compare</th><th>Scenario</th><th>Configuration</th><th class="num">USD/Wp</th><th class="num">Δ vs baseline</th>' + PM.STAGES.map(function (s) { return '<th class="num">' + s.short + "</th>"; }).join("") + '<th class="num">USD/module</th><th></th></tr></thead><tbody>' +
          all.map(function (r) {
            var st2 = r.s ? r.s.state : r.id === "__cur" ? st : bs, on = r.fixed || ui.compare.indexOf(r.id) >= 0;
            return "<tr><td>" + (r.fixed ? '<span class="muted small">always</span>' : '<input type="checkbox" data-bind="scn-cmp" data-id="' + r.id + '"' + (on ? " checked" : "") + ">") + "</td><td><b>" + esc(r.name) + "</b>" + (App.baselineRef === "scn:" + r.id ? " " + App.tag("der", "baseline") : "") + "</td>" +
              '<td class="small">' + esc(st2.country) + " · " + PM.TECH[st2.tech].label + " · " + st2.year + " · " + App.editCount(st2) + " edits" + (st2.mode !== "workbook" ? " · " + st2.mode + " mode" : "") + "</td>" +
              '<td class="num">' + F.wp(r.out.total) + '</td><td class="num">' + F.delta(r.out.total - base.total, base.total) + "</td>" +
              r.out.stages.map(function (s) { return '<td class="num small">' + (s.included ? F.wp(s.value) : "—") + "</td>"; }).join("") + '<td class="num">' + F.usd(r.out.usdPerModule) + "</td>" +
              "<td class='nowrap'>" + (r.s ? '<button class="btn small ghost" data-action="scn-load" data-id="' + r.id + '">Load</button><button class="btn small ghost" data-action="scn-dup" data-id="' + r.id + '">Duplicate</button><button class="btn small ghost" data-action="scn-rename" data-id="' + r.id + '">Rename</button><button class="btn small ghost" data-action="scn-base" data-id="' + r.id + '">Set baseline</button><button class="btn small ghost danger" data-action="scn-del" data-id="' + r.id + '">Delete</button>' : "") + "</td></tr>";
          }).join("") + "</tbody></table></div>" +
          '<div id="ch-scn" class="chart section"></div>';
      }
      h += "</div>";
      return h;
    },
    after: function () {
      var at = App.ui.lab._at;
      if (at && at.steps.length && document.getElementById("ch-attr")) {
        var labels = ["Baseline"].concat(at.steps.map(function (s) { return s.label.length > 38 ? s.label.slice(0, 36) + "…" : s.label; })).concat(["Scenario"]);
        App.plot("ch-attr", [{ type: "waterfall", orientation: "v", x: labels, y: [at.from.total].concat(at.steps.map(function (s) { return s.delta; })).concat([0]),
          measure: ["absolute"].concat(at.steps.map(function () { return "relative"; })).concat(["total"]),
          increasing: { marker: { color: App.color("--inc") } }, decreasing: { marker: { color: App.color("--dec") } }, totals: { marker: { color: App.color("--s4") } },
          connector: { line: { color: App.color("--axis"), width: 1 } }, hovertemplate: "%{x}<br>%{y:.5f} USD/Wp<extra></extra>" }],
          { showlegend: false, yaxis: { title: { text: "USD/Wp" }, range: [Math.min(at.from.total, at.to.total) * 0.9, Math.max(at.from.total, at.to.total, at.steps.reduce(function (a, s, i, arr) { var run = at.from.total; for (var k = 0; k <= i; k++) run += arr[k].delta; return Math.max(a, run); }, 0)) * 1.04] }, xaxis: { tickangle: -20 } });
      }
      var all = App.ui.lab._all, ui = App.ui.lab;
      if (all && document.getElementById("ch-scn")) {
        var shown = all.filter(function (r) { return r.fixed || ui.compare.indexOf(r.id) >= 0; });
        var names = shown.map(function (r) { return r.name; });
        var tr = PM.STAGES.map(function (s, i) {
          return { type: "bar", name: s.label, x: names, y: shown.map(function (r) { return r.out.stages[i].included ? r.out.stages[i].value : 0; }), marker: { color: App.stageColor(i), line: { color: App.color("--surface"), width: 1 } }, hovertemplate: "%{x}<br>" + s.label + ": %{y:.4f} USD/Wp<extra></extra>" };
        });
        if (shown.some(function (r) { return r.out.purchased; })) tr.unshift({ type: "bar", name: "Purchased (extension)", x: names, y: shown.map(function (r) { return r.out.purchased ? r.out.purchased.value : 0; }), marker: { color: App.color("--s5") } });
        App.plot("ch-scn", tr, { barmode: "stack", yaxis: { title: { text: "USD/Wp" } },
          annotations: shown.map(function (r) { return { x: r.name, y: r.out.total, text: F.wp(r.out.total), showarrow: false, yshift: 10, font: { size: 11, color: App.color("--ink-2") } }; }) });
      }
    }
  });

  // ======================================================== SENSITIVITY
  App.register("sensitivity", {
    title: "Sensitivity & drivers", icon: "⇋", section: "Simulate",
    render: function () {
      var st = App.state, ui = App.ui.sens;
      var sens = AN.sensitivity(model, st, ui.pct);
      App.ui.sens._s = sens;
      var rows = sens.rows.filter(function (r) { return r.range > 1e-12; });
      var zero = sens.rows.filter(function (r) { return r.range <= 1e-12; });
      if (!ui.sweep || !PM.PARAM_BY_ID[ui.sweep] || AN.sensitivityParams(model, st).indexOf(PM.PARAM_BY_ID[ui.sweep]) < 0) ui.sweep = rows.length ? rows[0].param.id : "";
      var h = '<div class="page-head"><div><h1>Sensitivity & cost-driver analysis</h1><p>Each input is moved down and up by the chosen percentage while all other inputs stay at their current scenario values; the full workbook is recalculated for every case (no linear shortcut). ' +
        '<b>These are model-calculated sensitivities, not historical market correlations.</b></p></div>' +
        '<div style="display:flex;gap:10px;align-items:flex-end"><label class="field small">Variation ±<select data-bind="sens-pct">' + [5, 10, 20, 30, 50].map(function (p) { return "<option" + (p === ui.pct ? " selected" : "") + ">" + p + "</option>"; }).join("") + "</select> %</label>" +
        '<label class="field small">Show top <select data-bind="sens-top">' + [10, 15, 25, 50].map(function (p) { return "<option" + (p === ui.top ? " selected" : "") + ">" + p + "</option>"; }).join("") + "</select></label></div></div>";
      h += '<p class="small muted">' + configSummary(st) + " · base cost " + F.wp(sens.base.total) + " USD/Wp" + (st.mode !== "workbook" ? " · " + MODE_INFO[st.mode].label : "") + "</p>";
      h += '<div class="grid g-21"><div class="card"><div class="card-head"><h2>Tornado — impact on module cost</h2><span class="sub">Δ USD/Wp for input −' + ui.pct + "% / +" + ui.pct + '%</span></div><div id="ch-tornado" class="chart tall"></div></div>' +
        '<div class="card"><h2>How to read this</h2><ul class="clean small" style="margin-top:8px"><li>Bars to the right raise the module cost, bars to the left lower it.</li><li><b>Elasticity</b> = % change in module cost for a 1% change in the input (local, ±1% central difference). An elasticity of 0.10 means +10% input → about +1% cost.</li><li>Inputs marked <b>non-linear</b> (e.g. cell efficiency, lifetimes) have asymmetric impacts; the tornado shows the exact recalculated values.</li><li>Inputs of stages that are imported or purchased have zero impact and are listed at the bottom.</li><li>Overheads and operating profit are proportional to each stage\'s cost, so every driver also moves them.</li></ul></div></div>';
      h += '<div class="card section"><div class="card-head"><h2>Sensitivity ranking</h2><button class="btn small" data-action="export-sens">⤓ Export CSV</button></div><div class="table-wrap"><table class="data"><thead><tr><th>#</th><th>Input</th><th>Stage</th><th class="num">Current value</th><th class="num">Cost at −' + ui.pct + '%</th><th class="num">Cost at +' + ui.pct + '%</th><th class="num">Δ at +' + ui.pct + '%</th><th class="num">% impact</th><th class="num">Elasticity</th><th>Direction</th></tr></thead><tbody>' +
        rows.map(function (r, i) {
          var p = r.param;
          return "<tr><td>" + (i + 1) + "</td><td>" + esc(p.label) + (r.nonlinear ? " " + App.tag("der", "non-linear") : "") + "</td><td class='small'>" + STAGE_LABEL[p.stage] + '</td><td class="num">' + F.num(F.disp(p, r.current), p.unit) + " <span class='muted small'>" + esc(F.unit(p)) + '</span></td><td class="num">' + F.wp(r.low) + '</td><td class="num">' + F.wp(r.high) + '</td><td class="num">' + F.delta(r.dHigh, null, 5) + '</td><td class="num">' + F.signedPct(r.dHigh / sens.base.total, 2) + '</td><td class="num">' + r.elasticity.toFixed(3) + "</td><td class='small'>" + (r.elasticity > 0 ? "↑ input → ↑ cost" : "↑ input → ↓ cost") + "</td></tr>";
        }).join("") + "</tbody></table></div>" +
        (zero.length ? '<p class="small muted" style="margin-top:8px"><b>No effect in this configuration:</b> ' + zero.map(function (r) { return esc(r.param.label); }).join(", ") + ".</p>" : "") + "</div>";
      var top = rows.slice(0, 12);
      h += '<div class="card section"><div class="card-head"><h2>Stage-level sensitivity</h2><span class="sub">Δ USD/Wp by stage when the input rises ' + ui.pct + "%</span></div><div class=\"table-wrap\"><table class='data'><thead><tr><th>Input</th>" + PM.STAGES.map(function (s) { return '<th class="num">' + s.label + "</th>"; }).join("") + (sens.base.purchased ? '<th class="num">Purchased</th>' : "") + '<th class="num">Total</th></tr></thead><tbody>' +
        top.map(function (r) { return "<tr><td>" + esc(r.param.label) + "</td>" + PM.STAGES.map(function (s) { var d = r.stageDelta[s.id] ? r.stageDelta[s.id].hi : 0; return '<td class="num small">' + (Math.abs(d) > 1e-12 ? F.signed(d, 5) : "·") + "</td>"; }).join("") + (sens.base.purchased ? '<td class="num small">' + F.signed(r.stageDelta.purchased ? r.stageDelta.purchased.hi : 0, 5) + "</td>" : "") + '<td class="num">' + F.signed(r.dHigh, 5) + "</td></tr>"; }).join("") + "</tbody></table></div></div>";
      var sp = PM.PARAM_BY_ID[ui.sweep];
      h += '<div class="card section"><div class="card-head"><h2>One-variable sweep</h2><label class="small">Input <select data-bind="sens-sweep">' + rows.map(function (r) { return '<option value="' + r.param.id + '"' + (r.param.id === ui.sweep ? " selected" : "") + ">" + esc(r.param.label) + "</option>"; }).join("") + "</select></label></div>" +
        (sp ? '<div id="ch-sweep" class="chart"></div><p class="small muted">Module cost recalculated at 21 points from −50% to +50% of the current value of <b>' + esc(sp.label) + "</b>. A straight line means the input acts linearly in the workbook.</p>" : "") + "</div>";
      return h;
    },
    after: function () {
      var sens = App.ui.sens._s, ui = App.ui.sens;
      var rows = sens.rows.filter(function (r) { return r.range > 1e-12; }).slice(0, ui.top).reverse();
      var y = rows.map(function (r) { return r.param.label; });
      App.plot("ch-tornado", [
        { type: "bar", orientation: "h", name: "Input −" + ui.pct + "%", y: y, x: rows.map(function (r) { return r.dLow; }), marker: { color: App.color("--c1") }, customdata: rows.map(function (r) { return r.low; }), hovertemplate: "%{y}<br>input −" + ui.pct + "%: %{x:+.5f} USD/Wp (cost %{customdata:.4f})<extra></extra>" },
        { type: "bar", orientation: "h", name: "Input +" + ui.pct + "%", y: y, x: rows.map(function (r) { return r.dHigh; }), marker: { color: App.color("--c2") }, customdata: rows.map(function (r) { return r.high; }), hovertemplate: "%{y}<br>input +" + ui.pct + "%: %{x:+.5f} USD/Wp (cost %{customdata:.4f})<extra></extra>" }
      ], { barmode: "overlay", margin: { l: 260 }, height: Math.max(380, rows.length * 26 + 90), xaxis: { title: { text: "Δ module cost, USD/Wp" }, zeroline: true, zerolinewidth: 2 }, yaxis: { tickfont: { size: 11 } } });
      if (ui.sweep && document.getElementById("ch-sweep")) {
        var p = PM.PARAM_BY_ID[ui.sweep], sw = AN.sweep(model, App.state, ui.sweep, -50, 50, 20);
        App.plot("ch-sweep", [{ type: "scatter", mode: "lines+markers", name: "Module cost", x: sw.map(function (r) { return r.pct; }), y: sw.map(function (r) { return r.total; }),
          customdata: sw.map(function (r) { return F.num(F.disp(p, r.value), p.unit) + " " + F.unit(p); }), line: { color: App.color("--c1"), width: 2 }, marker: { size: 7 },
          hovertemplate: "%{x:+.0f}% → %{customdata}<br>%{y:.4f} USD/Wp<extra></extra>" }],
          { showlegend: false, xaxis: { title: { text: "Change in " + p.label + " (%)" }, ticksuffix: "%", zeroline: true }, yaxis: { title: { text: "Module cost, USD/Wp" } } });
      }
    }
  });
  App.binds["sens-pct"] = function (v) { App.ui.sens.pct = parseInt(v, 10); App.render(); };
  App.binds["sens-top"] = function (v) { App.ui.sens.top = parseInt(v, 10); App.render(); };
  App.binds["sens-sweep"] = function (v) { App.ui.sens.sweep = v; App.render(); };
  App.actions["export-sens"] = function () {
    var s = App.ui.sens._s, st = App.state;
    var out = [["Rank", "Input", "Stage", "Current value", "Unit", "Cost at -" + s.pct + "%", "Cost at +" + s.pct + "%", "Delta low", "Delta high", "Elasticity", "Source"]];
    s.rows.forEach(function (r, i) { out.push([i + 1, r.param.label, STAGE_LABEL[r.param.stage], r.current, r.param.unit, r.low, r.high, r.dLow, r.dHigh, r.elasticity, r.param.source]); });
    App.download("sensitivity_" + st.country + "_" + st.tech + "_" + st.year + ".csv", App.csv(out), "text/csv");
  };

  // ======================================================== EXPLORER
  var FUTURE = [
    ["Aluminium (frames, cell rear contacts)", "Raw material", "module"], ["Copper (ribbons, cables)", "Raw material", "module"],
    ["Solar glass", "Intermediate product", "module"], ["EVA / POE encapsulant", "Consumable / process chemical", "module"],
    ["Junction box & connectors", "Intermediate product", "module"], ["Backsheet", "Intermediate product", "module"],
    ["Capacity utilisation", "Production / yield parameter", "all"], ["Cost of capital / WACC (financing)", "Equipment / capital expenditure", "all"],
    ["Tariffs, duties and subsidies (explicit)", "Country-specific assumption", "all"], ["Freight & logistics (explicit)", "Other operating cost", "all"],
    ["Currency exchange rates / inflation", "Country-specific assumption", "all"]
  ];
  var CLASSES = ["Raw material", "Intermediate product", "Consumable / process chemical", "Energy", "Labour", "Equipment / capital expenditure", "Production / yield parameter", "Country-specific assumption", "Other operating cost"];

  function unusedWorkbookItems() {
    if (App._unused) return App._unused;
    var eng = model.engine, reach = {}, stack = [];
    PM.YEAR_COLS.forEach(function (c) { [96, 192, 77, 173].forEach(function (r) { stack.push(PM.CALC + "!" + c + r); }); });
    while (stack.length) { var k = stack.pop(); if (reach[k]) continue; reach[k] = 1; eng.precedents(k).forEach(function (p) { stack.push(p); }); }
    var out = [];
    Object.keys(eng.cells).forEach(function (k) {
      var m = /^Assumptions!([DE])(\d+)$/.exec(k);
      if (!m || typeof eng.cells[k].v !== "number" || reach[k]) return;
      var lab = eng.cells["Assumptions!B" + m[2]], unit = eng.cells["Assumptions!C" + m[2]];
      out.push({ label: (lab ? lab.v : k).trim(), tech: m[1] === "D" ? "TOPCon" : "Mono PERC", cell: k, value: eng.cells[k].v, unit: unit ? unit.v : "" });
    });
    App._unused = out;
    return out;
  }

  App.register("explorer", {
    title: "Input explorer", icon: "⌕", section: "Configure",
    render: function () {
      var st = App.state, ui = App.ui.exp;
      var rows = [];
      PM.PARAMS.forEach(function (p) {
        var techs = p.tech === "both" ? [st.tech] : [p.tech];
        techs.forEach(function (t) {
          if (ui.tech === "active" && t !== st.tech && p.tech !== "both") return;
          var s2 = clone(st); s2.tech = t;
          var pv = paramValue(p, s2);
          var status = !p.editable ? (p.noEffect ? "No effect" : "Fixed") : pv.edited ? "User-modified" : "Editable";
          rows.push({ name: p.label, cls: p.countrySpecific ? p.cls + " · Country-specific assumption" : p.cls, stage: p.stage, tech: p.tech === "both" ? "Both" : PM.TECH[t].label,
            value: F.num(F.disp(p, pv.cur), p.unit), unit: F.unit(p) + (p.kind === "series" ? " (" + st.year + ")" : ""), source: p.source, status: status, effect: p.effect, kind: "param" });
        });
      });
      unusedWorkbookItems().forEach(function (u) {
        rows.push({ name: u.label, cls: "—", stage: "", tech: u.tech, value: F.num(u.value), unit: u.unit, source: u.cell, status: "In workbook, not used", effect: "Listed on the Assumptions sheet but not referenced by any cost formula (the calculation uses its own hardcoded row instead).", kind: "unused" });
      });
      FUTURE.forEach(function (f) {
        rows.push({ name: f[0], cls: f[1], stage: f[2], tech: "—", value: "—", unit: "", source: "Not in workbook", status: "Future extension", effect: "Not part of the IRENA workbook. Shown as a recommended extension only; it does not enter any calculation.", kind: "future" });
      });
      var q = ui.q.toLowerCase();
      var filtered = rows.filter(function (r) {
        if (q && (r.name + " " + r.cls + " " + r.source + " " + r.effect).toLowerCase().indexOf(q) < 0) return false;
        if (ui.cls && r.cls.indexOf(ui.cls) < 0) return false;
        if (ui.stage && r.stage !== ui.stage) return false;
        if (ui.status && r.status !== ui.status) return false;
        return true;
      });
      var stTags = { "Editable": "wb", "User-modified": "mod", "Fixed": "fix", "No effect": "fix", "In workbook, not used": "ill", "Future extension": "ext" };
      var h = '<div class="page-head"><div><h1>Material & manufacturing input explorer</h1><p>Searchable inventory of every input of the model: what it is, where it comes from in the workbook, whether you can change it, and what it affects. Silver is the only individually modelled metal; other module materials are a lump sum in the workbook.</p></div></div>';
      h += '<div class="card"><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center"><input type="search" placeholder="Search name, source cell, description…" value="' + esc(ui.q) + '" data-bind="exp-q" data-focus="exp-q" style="min-width:280px;flex:1">' +
        '<select data-bind="exp-cls"><option value="">All classes</option>' + CLASSES.map(function (c) { return "<option" + (c === ui.cls ? " selected" : "") + ">" + c + "</option>"; }).join("") + "</select>" +
        '<select data-bind="exp-stage"><option value="">All stages</option>' + ["poly", "wafer", "cell", "module", "all"].map(function (s) { return '<option value="' + s + '"' + (s === ui.stage ? " selected" : "") + ">" + STAGE_LABEL[s] + "</option>"; }).join("") + "</select>" +
        '<select data-bind="exp-status"><option value="">Any status</option>' + Object.keys(stTags).map(function (s) { return "<option" + (s === ui.status ? " selected" : "") + ">" + s + "</option>"; }).join("") + "</select>" +
        '<select data-bind="exp-tech"><option value="active"' + (ui.tech === "active" ? " selected" : "") + ">Active technology (" + PM.TECH[st.tech].label + ')</option><option value="all"' + (ui.tech === "all" ? " selected" : "") + ">Both technologies</option></select>" +
        '<span class="small muted">' + filtered.length + " of " + rows.length + " items</span></div></div>";
      h += '<div class="card section"><div class="table-wrap"><table class="data"><thead><tr><th>Input</th><th>Classification</th><th>Stage</th><th>Technology</th><th class="num">Value</th><th>Unit</th><th>Source</th><th>Status</th><th>Effect on outputs</th></tr></thead><tbody>' +
        filtered.map(function (r) {
          return "<tr" + (r.kind !== "param" ? ' class="dim"' : "") + "><td><b>" + esc(r.name) + "</b></td><td class='small'>" + esc(r.cls) + "</td><td class='small'>" + esc(STAGE_LABEL[r.stage] || "") + "</td><td class='small'>" + esc(r.tech) + '</td><td class="num">' + r.value + "</td><td class='small'>" + esc(r.unit) + "</td><td class='small'><code>" + esc(r.source) + "</code></td><td>" + App.tag(stTags[r.status], r.status) + "</td><td class='small' style='min-width:260px'>" + esc(r.effect) + "</td></tr>";
        }).join("") + "</tbody></table></div></div>";
      return h;
    }
  });
  ["q", "cls", "stage", "tech", "status"].forEach(function (k) { App.binds["exp-" + k] = function (v) { App.ui.exp[k] = v; App.render(); }; });

  // ======================================================== METHODOLOGY
  var LIMITATIONS = [
    ["Operating profit inside 'cost'", "Every stage adds a hardcoded 15% operating profit, and overheads are computed on the price incl. that profit. The workbook's 'Total Module Cost' is therefore closer to an ex-works price than a pure manufacturing cost. The app shows both (KPI 'Cost excl. operating profit') and exposes the 15% as a documented parameter."],
    ["No cost of capital", "CAPEX is depreciated straight-line (CAPEX ÷ lifetime) with no discount rate/WACC, despite the 'levelised' label. Financing costs are not modelled."],
    ["Capacity does not drive unit cost", "Installed capacity cancels out of the overhead formula (capacity × 0.9 ÷ capacity). Its only effect is on ESG certification, which is computed as 0.0006 × capacity in GW — so a larger factory shows a HIGHER ESG cost per Wp (5 GW → 0.003 USD/Wp; 10 GW → 0.006). This looks like a unit error (fixed cost should be divided by capacity), but it is reproduced as-is and flagged. Polysilicon capacity has no effect at all; Mono PERC polysilicon capacity inputs (Inputs!F41:F42) are not referenced."],
    ["No capacity utilisation input", "A hardcoded 0.9 factor appears in each overhead formula, possibly intended as 90% utilisation, but it only scales overheads (effective overhead = 9% of stage price)."],
    ["Import prices undocumented", "Import options use hardcoded USD/Wp tables (Country_Index rows 54–96) for 2025–2030 with no source or method. They are stage-only prices (e.g. China→Vietnam cell 0.0412 vs China's own cell stage 0.0403 USD/Wp in 2025), not full purchased-component prices. Imports are not available before 2025."],
    ["Two different totals for import scenarios", "The calculation sheet total (rows 96/192, used here as headline) always adds all four stages. The Output_Visualization waterfall drops the polysilicon stage when wafers or cells are imported and the wafer stage when cells are imported. Because the import tables are stage-only prices, that chart convention under-counts upstream cost; the app reports both and uses the calculation-sheet total."],
    ["Overheads for 2020–2023 reference 2024", "Overhead formulas in columns D–G use the 2024 stage price ($H$ anchors). For Mono PERC, polysilicon, wafer and module overheads in 2020–2023 even reference the TOPCon 2024 price. Reproduced exactly; affects historic years only."],
    ["Hardcoded series and unused assumptions", "Many yearly series (electricity use, silicon price, efficiencies, silver loading, cell 'other material', module 'other material' from 2025) are typed into the calculation sheet; 15 cells on the Assumptions sheet (e.g. polysilicon electricity 40 kWh/kg, metal silicon price, wafer thickness, Mono silver price) are not referenced by any formula. TOPCon's silver price (row 56) is not linked to Assumptions!D36, while Mono's is. Module 'other materials' from 2025 is 0.055 USD/Wp for both technologies although the Assumptions sheet lists 0.057 / 0.0513."],
    ["Mono PERC efficiency inconsistency", "Mono watt-peak per wafer uses one efficiency series (row 129: 23.7% in 2025) while the module rating uses another (row 150: 25.3%). The Mono module area is hardcoded (0.182 × 0.182 m) and not linked to the wafer-area assumption. The app scales both efficiency series together."],
    ["Unit labels", "Silver 'consumption' (rows 55/151) is labelled kg/Wp but evaluates to USD/Wp; module electricity is labelled kWh/module but used as kWh/W; Mono 'Cell (wafer) area' is labelled cm² but holds m²."],
    ["Country data", "China's TOPCon polysilicon electricity price (0.065 USD/kWh) differs from the Mono PERC and wafer/cell/module value (0.08). Germany's 2025 capacity is entered as =0.2×10^9. No tariffs, subsidies, taxes, logistics or FX are modelled explicitly."],
    ["Materials coverage", "Silver is the only itemised metal. Aluminium, copper, glass, encapsulants (EVA/POE), junction boxes and backsheets are inside the lump-sum 'other module materials' and cannot be varied individually (listed as future extensions in the Input explorer)."]
  ];
  App.LIMITATIONS = LIMITATIONS;

  App.register("methodology", {
    title: "Methodology & data quality", icon: "ⓘ", section: "Reference",
    render: function () {
      var wb = window.PV_WORKBOOK, meta = wb.meta, st = App.state;
      // live reconciliation
      if (!App._recon) {
        var r = model.engine.evaluate(), n = 0, bad = 0, maxd = 0, t0 = performance.now();
        Object.keys(wb.cells).forEach(function (k) {
          var c = wb.cells[k]; if (!c.f) return; n++;
          var v = r.get(k);
          if (typeof c.v === "number") { var d = Math.abs(v - c.v) / Math.max(1e-12, Math.abs(c.v)); maxd = Math.max(maxd, d); if (!(d < 1e-9)) bad++; }
          else if (String(v) !== String(c.v)) bad++;
        });
        App._recon = { n: n, bad: bad, maxd: maxd, ms: performance.now() - t0 };
      }
      var R = App._recon;
      var h = '<div class="page-head"><div><h1>Model methodology & data quality</h1><p>How the numbers are produced, how they reconcile with the original Excel model, and where the workbook has gaps or quirks.</p></div></div>';
      h += '<div class="grid g2"><div class="card"><h2>Original workbook</h2><dl class="kv" style="margin-top:10px">' +
        "<dt>File</dt><dd><code>" + esc(meta.file) + "</code></dd><dt>Model</dt><dd>IRENA Solar PV Manufacturing Cost Model v1 — CEM Transforming Solar Supply Chains (TSSC), with the Government of Australia (DCCEEW)</dd>" +
        "<dt>SHA-256</dt><dd><code>" + meta.sha256.slice(0, 32) + "…</code></dd><dt>Size</dt><dd>" + (meta.bytes / 1e6).toFixed(2) + " MB</dd><dt>Extracted</dt><dd>" + esc(meta.extracted_utc) + "</dd>" +
        "<dt>Protection</dt><dd>Workbook structure and 5 sheets password-protected (read-only parsing; file never modified)</dd><dt>Calculation</dt><dd>Automatic (" + esc(meta.calcPr || "") + "); no circular references; cached results verified below</dd>" +
        "<dt>Scope</dt><dd>6 countries (China, Vietnam, India, Germany, US, Australia) · 2 technologies (TOPCon, Mono PERC) · years 2020–2030 · all values in USD</dd></dl></div>" +
        '<div class="card"><h2>Formula reconciliation (live)</h2><div class="grid g2" style="margin-top:10px">' +
        kpi("Formula cells recomputed", R.n, "", "in " + R.ms.toFixed(0) + " ms in your browser") +
        kpi("Mismatches vs Excel", R.bad, "", "max relative difference " + R.maxd.toExponential(1)) + "</div>" +
        '<p class="small" style="margin-top:10px">' + (R.bad === 0 ? App.tag("der", "✓ Reconciled") + " Every workbook formula, recomputed from raw inputs by this app's engine, equals the value Excel stored when the file was saved." : App.tag("ill", "Check") + " Some cells differ.") +
        ' The offline validation suite also compares 18 other country/sourcing/input configurations against independent LibreOffice recalculations (20,736 values, all within 5×10⁻¹⁵) — see <code>docs/VALIDATION_REPORT.md</code>.</p></div></div>';
      h += '<div class="card section"><h2>Calculation methodology</h2><div class="grid g2" style="margin-top:10px"><div><ol class="small" style="padding-left:18px;margin:0">' +
        "<li><b>Inputs</b> — the selected country pulls defaults from <code>Country_Index</code> via INDEX/MATCH into <code>Inputs!D</code>; a user value in <code>Inputs!E</code> overrides it (<code>F = IF(ISNUMBER(E), E, D)</code>). The app writes your edits into that same override column.</li>" +
        "<li><b>Polysilicon</b> (USD/kg): electricity (kWh/kg × price) + silicon metal (price × conversion ratio) + other materials + equipment & building depreciation (CAPEX ÷ lifetime) + maintenance (% × CAPEX) + labour (workers/kg × salary) → +15% operating profit → + overheads (rate × 0.9 × price). Converted to USD/Wp × g/W ÷ 1000.</li>" +
        "<li><b>Ingot & wafer</b> (USD/Wp): per-wafer electricity and materials ÷ watt-peak per wafer (area × efficiency × 1000 W/m²) + CAPEX/1000 ÷ lifetime + maintenance + labour (workers/W × salary) → profit → overheads.</li>" +
        "<li><b>Cell</b>: electricity (kWh/W) + other materials and silver (mass per cell × silver price ÷ W per wafer) + capital, maintenance, labour → profit → overheads.</li>" +
        "<li><b>Module</b>: electricity + other module materials (lump sum) + capital, maintenance, labour + ESG certification → profit → overheads.</li>" +
        "<li><b>Total</b> = sum of the four stage values (rows 96/192). Each stage is a conversion cost, so the sum does not double count.</li></ol></div><div>" +
        '<h4>Units & conversions</h4><ul class="clean small"><li>All money in USD (no FX, no inflation); outputs in USD/Wp and USD/module.</li><li>Polysilicon USD/kg → USD/Wp: × g/W ÷ 1000.</li><li>CAPEX in USD/kW(p) → USD/Wp: ÷ 1000.</li><li>Labour: workers per unit of annual output × USD/year salary.</li><li>Module power = cells per module × W per cell (TOPCon) or area × 1000 × cells × efficiency (Mono).</li></ul>' +
        '<h4 style="margin-top:12px">Sourcing & calculation modes</h4><ul class="clean small"><li><b>A (workbook):</b> per stage domestic or imported (import table price replaces the stage, 2025–2030).</li><li><b>B / C (extensions):</b> an all-in purchased wafer or cell price replaces all upstream stages; upstream inputs then have zero effect (verified: no double counting).</li></ul></div></div></div>';
      h += '<div class="card section"><h2>Data labels used in this app</h2><div class="chips" style="margin-top:10px">' +
        App.tag("wb", "Workbook data — original IRENA values") + App.tag("mod", "User-modified — changed by you") + App.tag("der", "Derived — calculated from workbook data") +
        App.tag("ext", "Extension — beyond the workbook, documented") + App.tag("ill", "Illustrative — example experiment, not a forecast") + App.tag("imp", "Imported — hardcoded import price table") + "</div>" +
        '<p class="small muted" style="margin-top:8px">No external market data is used anywhere in the application. All defaults come from the workbook.</p></div>';
      h += '<div class="card section"><h2>Extensions beyond the original workbook</h2><ul class="clean small" style="margin-top:8px">' +
        "<li><b>Operating-profit parameter:</b> the hardcoded <code>×0.15</code> in the 8 operating-profit rows is replaced by one parameter (default 0.15 → identical results).</li>" +
        "<li><b>Calculation modes B and C:</b> purchased wafer / purchased cell at an all-in price. Defaults are derived from the workbook's own upstream cost, so they reproduce mode A until you enter a price.</li>" +
        "<li><b>Percentage scaling of yearly series:</b> hardcoded yearly rows (e.g. electricity use, silver loading) are scaled by a multiplier so the workbook trajectory is preserved.</li>" +
        "<li><b>Scenario attribution, country-driver explanation, sensitivity & sweeps:</b> analytical layers that re-run the unmodified workbook formulas.</li>" +
        "<li><b>Cost categories:</b> grouping of workbook rows into materials, electricity, labour, capital, maintenance, overheads, ESG and operating profit.</li></ul></div>";
      h += '<div class="card section"><h2>Limitations, quirks & missing data</h2><table class="data" style="margin-top:8px"><tbody>' +
        LIMITATIONS.map(function (l) { return "<tr><td style='width:240px'><b>" + esc(l[0]) + "</b></td><td class='small'>" + esc(l[1]) + "</td></tr>"; }).join("") + "</tbody></table></div>";
      h += '<div class="card section"><h2>Worksheet inventory</h2><div class="table-wrap"><table class="data" style="margin-top:8px"><thead><tr><th>Sheet</th><th>Visibility</th><th>Range</th><th class="num">Populated cells</th><th class="num">Formulas</th><th class="num">Charts</th><th>Role</th></tr></thead><tbody>' +
        meta.sheets.map(function (s) {
          var role = { "Title": "Cover image", "About": "Description, navigation, disclaimer", "Inputs": "Country, sourcing selection and country-default inputs with user override column", "Output_Visualization": "4 waterfall tables (2025/2030 × technology) + 13 charts", "Cost Model_Calculations": "Full calculation engine 2020–2030 for both technologies", "Assumptions": "Technical assumptions with sources (NREL, ITRPV, …)", "Country_Index": "Country default data and import price tables", "Dropdown_Lists": "Allowed sourcing options per country" }[s.name] || "";
          return "<tr><td><b>" + esc(s.name) + "</b></td><td>" + (s.state === "hidden" ? App.tag("ill", "hidden") : "visible") + '</td><td class="small"><code>' + s.dimensions + '</code></td><td class="num">' + s.populated_cells + '</td><td class="num">' + s.formula_cells + '</td><td class="num">' + s.charts + "</td><td class='small'>" + role + "</td></tr>";
        }).join("") + "</tbody></table></div><p class='small muted' style='margin-top:6px'>Charts: " + wb.charts.length / 1 + " chart parts (9 stacked bars of stage components + 4 waterfalls). No hidden rows or columns.</p></div>";
      // country data
      var T = PM.TECH[st.tech], countries = model.countries(), r0 = model._baselineEval("China");
      var keys = Object.keys(T.inputRows);
      h += '<div class="card section"><h2>Country data (' + T.label + ")</h2><div class=\"table-wrap\"><table class='data' style='margin-top:8px'><thead><tr><th>Input</th><th>Unit</th>" + countries.map(function (c) { return '<th class="num">' + c + "</th>"; }).join("") + "</tr></thead><tbody>" +
        keys.map(function (k) {
          var row = T.inputRows[k], lab = wb.cells["Inputs!B" + row].v + (row < 20 || (row > 35 && row < 50) ? " (polysilicon)" : ""), unit = wb.cells["Inputs!C" + row].v;
          return "<tr><td>" + esc(lab) + "</td><td class='small'>" + esc(unit) + "</td>" + countries.map(function (c) { return '<td class="num">' + F.num(model._baselineEval(c).num("Inputs!D" + row), unit) + "</td>"; }).join("") + "</tr>";
        }).join("") + "</tbody></table></div><p class='small muted'>Source: Country_Index sheet via Inputs!D" + T.inputRows.polyCap25 + ":D" + T.inputRows.bldM + ".</p></div>";
      void r0;
      // import tables
      var imp = [["Polysilicon", 56], ["Ingot & wafer (" + T.label + ")", T.importBase.wafer], ["Solar cell (" + T.label + ")", T.importBase.cell]];
      h += '<div class="card section"><h2>Import price tables (USD/Wp)</h2>' + App.tag("imp", "Hardcoded in workbook — source not documented") + '<div class="table-wrap"><table class="data" style="margin-top:8px"><thead><tr><th>Stage</th><th>Route</th>' + [2025, 2026, 2027, 2028, 2029, 2030].map(function (y) { return '<th class="num">' + y + "</th>"; }).join("") + "</tr></thead><tbody>" +
        imp.map(function (t) {
          var out = "";
          for (var r = t[1]; r <= t[1] + 4; r++) out += "<tr><td>" + t[0] + "</td><td>" + wb.cells["Country_Index!B" + r].v + " → " + wb.cells["Country_Index!C" + r].v + "</td>" + "DEFGHI".split("").map(function (c) { return '<td class="num">' + F.wp(wb.cells["Country_Index!" + c + r].v) + "</td>"; }).join("") + "</tr>";
          return out;
        }).join("") + "</tbody></table></div></div>";
      return h;
    }
  });
  // navigation order (pages are registered above in code order)
  App.order = ["dashboard", "breakdown", "countries", "inputs", "explorer", "scenarios", "sensitivity", "methodology"];
})();
