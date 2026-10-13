/*
 * Application core: state, persistence, routing, formatting and chart helpers.
 * Page renderers live in pages.js and register themselves in App.pages.
 */
(function () {
  "use strict";
  var PM = window.PVModel;
  var model = new PM.Model(window.PV_WORKBOOK);

  var LS_STATE = "pvcip.state.v1", LS_SCEN = "pvcip.scenarios.v1", LS_BASE = "pvcip.baseline.v1", LS_THEME = "pvcip.theme";

  function lsGet(k) { try { return JSON.parse(window.localStorage.getItem(k)); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function validState(s) {
    return s && typeof s === "object" && s.country && s.tech && s.year && s.sources && s.sources.topcon && s.sources.mono && s.edits;
  }

  var App = {
    model: model,
    pages: {},
    order: [],
    state: null,
    scenarios: [],
    baselineRef: "defaults",
    _cache: {}
  };
  window.App = App;

  // ------------------------------------------------------------ state
  App.init = function () {
    var saved = lsGet(LS_STATE);
    App.state = validState(saved) ? saved : model.workbookState();
    if (!App.state.purchased) App.state.purchased = { wafer: null, cell: null };
    if (!App.state.mode) App.state.mode = "workbook";
    model.normalise(App.state);
    var sc = lsGet(LS_SCEN);
    App.scenarios = Array.isArray(sc) ? sc.filter(function (x) { return x && validState(x.state); }) : [];
    App.baselineRef = lsGet(LS_BASE) || "defaults";
    var theme = lsGet(LS_THEME);
    if (theme) document.documentElement.setAttribute("data-theme", theme);
  };

  App.set = function (mutate, opts) {
    mutate(App.state);
    model.normalise(App.state);
    App._cache = {};
    lsSet(LS_STATE, App.state);
    App.render(opts);
  };

  App.saveScenarios = function () { lsSet(LS_SCEN, App.scenarios); };
  App.setBaselineRef = function (ref) { App.baselineRef = ref; lsSet(LS_BASE, ref); App._cache = {}; App.render(); };

  /** Baseline state for comparisons (same tech/year as the current state unless a saved scenario). */
  App.baselineState = function () {
    var s = App.state, b;
    if (App.baselineRef === "original") {
      b = model.workbookState(); b.tech = s.tech; b.year = s.year; b.name = "Original workbook (China, all domestic)";
    } else if (App.baselineRef && App.baselineRef.indexOf("scn:") === 0) {
      var sc = App.scenarios.filter(function (x) { return "scn:" + x.id === App.baselineRef; })[0];
      if (sc) { b = clone(sc.state); b.name = sc.name; }
    }
    if (!b) {
      b = clone(s); b.edits = {}; b.purchased = { wafer: null, cell: null };
      b.name = "Workbook defaults (same configuration)";
    }
    return model.normalise(b);
  };

  App.current = function () {
    if (!App._cache.cur) App._cache.cur = model.compute(App.state);
    return App._cache.cur;
  };
  App.baseline = function () {
    if (!App._cache.base) App._cache.base = model.compute(App.baselineState());
    return App._cache.base;
  };
  App.editCount = function (s) {
    s = s || App.state;
    return Object.keys(s.edits).filter(function (k) { var e = s.edits[k]; return e && e.value !== null && e.value !== "" && !isNaN(e.value); }).length;
  };

  // ------------------------------------------------------------ format
  var F = App.fmt = {
    wp: function (v, d) { return isFinite(v) ? v.toFixed(d === undefined ? 4 : d) : "–"; },
    usd: function (v, d) { return isFinite(v) ? "$" + v.toLocaleString("en-US", { minimumFractionDigits: d === undefined ? 2 : d, maximumFractionDigits: d === undefined ? 2 : d }) : "–"; },
    pct: function (v, d) { return isFinite(v) ? (v * 100).toFixed(d === undefined ? 1 : d) + "%" : "–"; },
    num: function (v, unit) {
      if (!isFinite(v)) return "–";
      var a = Math.abs(v);
      if (unit === "Wp" && a >= 1e6) return (v / 1e9).toLocaleString("en-US", { maximumFractionDigits: 2 }) + " GW";
      if (unit === "kg" && a >= 1000) return (v / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 }) + " t";
      if (a !== 0 && (a < 1e-3 || a >= 1e7)) return v.toExponential(3);
      if (a >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
      if (a >= 10) return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
      return Number(v.toPrecision(4)).toString();
    },
    signed: function (v, d) { if (!isFinite(v)) return "–"; var s = v.toFixed(d === undefined ? 4 : d); return (v > 0 ? "+" : v < 0 ? "" : "±") + s; },
    signedPct: function (v, d) { if (!isFinite(v)) return "–"; return (v > 0 ? "+" : "") + (v * 100).toFixed(d === undefined ? 1 : d) + "%"; },
    delta: function (v, base, d) {
      var cls = Math.abs(v) < 5e-7 ? "zero" : v > 0 ? "up" : "down";
      var pct = base ? " (" + F.signedPct(v / base) + ")" : "";
      return '<span class="delta ' + cls + '">' + F.signed(v, d) + pct + "</span>";
    },
    // value of a parameter in display units (percent-display params ×100)
    disp: function (p, v) { return p.display === "pct" ? v * 100 : v; },
    undisp: function (p, v) { return p.display === "pct" ? v / 100 : v; },
    unit: function (p) { return p.display === "pct" ? "%" : p.unit; }
  };

  App.esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  };
  App.info = function (tip) { return '<i class="hint" tabindex="0" data-tip="' + App.esc(tip) + '">i</i>'; };
  App.tag = function (kind, text) { return '<span class="tag ' + kind + '">' + App.esc(text) + "</span>"; };

  // ------------------------------------------------------------ colours & charts
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  App.color = cssVar;
  App.GROUPS = [
    { id: "materials", label: "Materials & consumables", cats: ["materials"], v: "--c1" },
    { id: "energy", label: "Electricity", cats: ["energy"], v: "--c2" },
    { id: "labour", label: "Labour", cats: ["labour"], v: "--c3" },
    { id: "capital", label: "Capital & maintenance", cats: ["capital", "maintenance"], v: "--c4" },
    { id: "overhead", label: "Overheads & ESG", cats: ["overhead", "esg"], v: "--c5" },
    { id: "margin", label: "Operating profit", cats: ["margin"], v: "--c6" },
    { id: "bought", label: "Imported / purchased stage", cats: ["imported", "purchased"], v: "--c7" }
  ];
  App.groupOfCat = function (cat) { return App.GROUPS.filter(function (g) { return g.cats.indexOf(cat) >= 0; })[0]; };
  App.groupTotals = function (cats) {
    return App.GROUPS.map(function (g) { return { g: g, value: g.cats.reduce(function (a, c) { return a + (cats[c] || 0); }, 0) }; });
  };
  App.stageColor = function (i) { return cssVar("--s" + (i + 1)); };

  App.layout = function (extra) {
    var ink = cssVar("--ink-2"), grid = cssVar("--grid"), axis = cssVar("--axis");
    var base = {
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: "system-ui, -apple-system, Segoe UI, sans-serif", size: 12, color: ink },
      margin: { l: 56, r: 16, t: 36, b: 44 },
      xaxis: { gridcolor: grid, linecolor: axis, zerolinecolor: axis, tickfont: { color: ink }, automargin: true },
      yaxis: { gridcolor: grid, linecolor: axis, zerolinecolor: axis, tickfont: { color: ink }, automargin: true },
      legend: { orientation: "h", y: 1.02, yanchor: "bottom", x: 0, font: { size: 12 } },
      hoverlabel: { font: { family: "system-ui, sans-serif", size: 12 } },
      bargap: 0.28
    };
    return deepMerge(base, extra || {});
  };
  function deepMerge(a, b) {
    Object.keys(b).forEach(function (k) {
      if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && a[k] && typeof a[k] === "object") deepMerge(a[k], b[k]);
      else a[k] = b[k];
    });
    return a;
  }
  App.plot = function (id, data, layout, config) {
    var el = document.getElementById(id);
    if (!el || !window.Plotly) return;
    window.Plotly.react(el, data, App.layout(layout), Object.assign({ displaylogo: false, responsive: true,
      modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d"] }, config || {}));
  };

  // ------------------------------------------------------------ UI helpers
  App.toast = function (msg) {
    var t = document.getElementById("toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(App._toastT); App._toastT = setTimeout(function () { t.classList.remove("show"); }, 2400);
  };
  App.modal = function (html) {
    document.getElementById("modal-body").innerHTML = html;
    document.getElementById("modal").classList.add("open");
  };
  App.closeModal = function () { document.getElementById("modal").classList.remove("open"); };
  App.download = function (name, text, type) {
    var blob = new Blob([text], { type: type || "text/plain" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };
  App.csv = function (rows) {
    return rows.map(function (r) {
      return r.map(function (c) { var s = c == null ? "" : String(c); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(",");
    }).join("\n");
  };

  // ------------------------------------------------------------ routing
  App.register = function (id, def) { App.pages[id] = def; App.order.push(id); };
  App.route = function () {
    var h = (location.hash || "").replace(/^#\/?/, "");
    return App.pages[h] ? h : "dashboard";
  };

  App.render = function (opts) {
    var route = App.route(), page = App.pages[route];
    renderNav(route);
    renderTopbar();
    var content = document.getElementById("content");
    var keepScroll = opts && opts.keepScroll !== false;
    var y = window.scrollY;
    // preserve focus on inputs that triggered the re-render
    var active = document.activeElement, focusKey = active && active.getAttribute && active.getAttribute("data-focus");
    try {
      content.innerHTML = page.render();
      if (page.after) page.after();
    } catch (e) {
      console.error(e);
      content.innerHTML = '<div class="notice warn"><span class="ico">!</span><div><b>Rendering error:</b> ' + App.esc(e.message) + "</div></div>";
    }
    if (keepScroll) window.scrollTo(0, y);
    if (focusKey) {
      var el = content.querySelector('[data-focus="' + focusKey + '"]');
      if (el) { el.focus(); if (el.select && el.type !== "range") try { el.select(); } catch (e2) { /* ignore */ } }
    }
  };

  function renderNav(route) {
    var html = "", lastSec = null;
    App.order.forEach(function (id) {
      var p = App.pages[id];
      if (p.section !== lastSec) { html += '<div class="nav-sep">' + p.section + "</div>"; lastSec = p.section; }
      html += '<a href="#' + id + '" class="' + (id === route ? "active" : "") + '"><span class="nav-ico">' + p.icon + "</span>" + p.title + "</a>";
    });
    document.getElementById("nav").innerHTML = html;
  }

  function renderTopbar() {
    var s = App.state, countries = model.countries(), years = PM.YEARS;
    var baseOpts = [["defaults", "Workbook defaults (same configuration)"], ["original", "Original workbook (China, all domestic)"]]
      .concat(App.scenarios.map(function (x) { return ["scn:" + x.id, "Saved: " + x.name]; }));
    var modeLabel = { workbook: "Integrated chain (workbook)", wafer: "Purchased wafer (extension)", cell: "Module assembly from purchased cells (extension)" }[s.mode];
    var n = App.editCount();
    var html =
      '<label class="field"><span>Manufacturing country</span><select data-bind="country">' +
      countries.map(function (c) { return "<option" + (c === s.country ? " selected" : "") + ">" + c + "</option>"; }).join("") + "</select></label>" +
      '<div class="field"><span>Technology</span><div class="seg">' +
      ["topcon", "mono"].map(function (t) { return '<button data-action="set-tech" data-tech="' + t + '" class="' + (s.tech === t ? "on" : "") + '">' + PM.TECH[t].label + "</button>"; }).join("") +
      "</div></div>" +
      '<label class="field"><span>Year</span><select data-bind="year">' +
      years.map(function (y) { return "<option" + (y === s.year ? " selected" : "") + ">" + y + "</option>"; }).join("") + "</select></label>" +
      '<label class="field"><span>Compare against (baseline)</span><select data-bind="baseline">' +
      baseOpts.map(function (o) { return '<option value="' + App.esc(o[0]) + '"' + (o[0] === App.baselineRef ? " selected" : "") + ">" + App.esc(o[1]) + "</option>"; }).join("") +
      "</select></label>" +
      '<div class="spacer"></div>' +
      '<div class="field"><span>Active configuration</span><div class="chips">' +
      App.tag("der", "Mode: " + modeLabel) + " " +
      (n ? App.tag("mod", n + " input" + (n > 1 ? "s" : "") + " modified") : App.tag("wb", "Original workbook inputs")) +
      "</div></div>" +
      '<div class="field"><span>&nbsp;</span><button class="btn" data-action="reset-all" ' + (n || s.mode !== "workbook" ? "" : "disabled") + ">↺ Reset to workbook</button></div>";
    document.getElementById("topbar").innerHTML = html;
  }

  // ------------------------------------------------------------ global events
  App.actions = {
    "set-tech": function (el) { App.set(function (s) { s.tech = el.getAttribute("data-tech"); }); },
    "reset-all": function () {
      App.set(function (s) { s.edits = {}; s.mode = "workbook"; s.purchased = { wafer: null, cell: null }; });
      App.toast("All inputs reset to the original workbook values");
    },
    "toggle-theme": function () {
      var cur = document.documentElement.getAttribute("data-theme");
      var dark = cur ? cur === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
      var next = dark ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      lsSet(LS_THEME, next);
      App.render();
    },
    "close-modal": function () { App.closeModal(); }
  };
  App.binds = {
    country: function (v) { App.set(function (s) { s.country = v; }); },
    year: function (v) { App.set(function (s) { s.year = parseInt(v, 10); }); },
    baseline: function (v) { App.setBaselineRef(v); }
  };

  document.addEventListener("click", function (ev) {
    var el = ev.target.closest("[data-action]");
    if (!el) {
      if (ev.target.id === "modal") App.closeModal();
      return;
    }
    var fn = App.actions[el.getAttribute("data-action")];
    if (fn) { ev.preventDefault(); fn(el, ev); }
  });
  document.addEventListener("change", function (ev) {
    var el = ev.target, b = el.getAttribute && el.getAttribute("data-bind");
    if (b && App.binds[b]) App.binds[b](el.type === "checkbox" ? el.checked : el.value, el, ev);
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") App.closeModal();
    var el = ev.target;
    if (ev.key === "Enter" && el.getAttribute && el.getAttribute("data-bind") && el.tagName === "INPUT") el.blur();
  });
  window.addEventListener("hashchange", function () { App.render({ keepScroll: false }); window.scrollTo(0, 0); });
  document.getElementById("file-import").addEventListener("change", function (ev) {
    var f = ev.target.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      try { App.importJSON(JSON.parse(r.result)); } catch (e) { App.toast("Import failed: " + e.message); }
      ev.target.value = "";
    };
    r.readAsText(f);
  });

  App.importJSON = function (obj) {
    var list = obj && obj.scenarios ? obj.scenarios : obj && obj.state ? [obj] : null;
    if (!list) throw new Error("No scenarios found in file");
    var added = 0;
    list.forEach(function (x) {
      if (!validState(x.state)) return;
      var st = model.normalise(clone(x.state));
      Object.keys(st.edits).forEach(function (k) { if (!PM.PARAM_BY_ID[k]) delete st.edits[k]; });
      App.scenarios.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: String(x.name || "Imported scenario"), created: new Date().toISOString(), state: st });
      added++;
    });
    App.saveScenarios(); App.render();
    App.toast(added + " scenario" + (added === 1 ? "" : "s") + " imported");
  };

  window.addEventListener("DOMContentLoaded", function () {
    App.init();
    App.render();
  });
})();
