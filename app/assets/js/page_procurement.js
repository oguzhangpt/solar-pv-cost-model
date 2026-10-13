/*
 * "Satınalma özeti" — simple procurement view (Turkish).
 * Same calculation state as the rest of the app; every impact figure is a
 * full recalculation of the workbook model with one input changed.
 */
(function () {
  "use strict";
  var App = window.App, PM = window.PVModel, AN = window.PVAnalysis, F = App.fmt, esc = App.esc, model = App.model;
  var OZ_PER_KG = 32.1507466; // troy ounces per kg
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  App.ui.proc = { steps: {} };
  var STAGE_TR = { poly: "Polisilikon", wafer: "Wafer (ingot + dilimleme)", cell: "Hücre", module: "Modül montajı" };
  var STAGE_SHORT = { poly: "Polisilikon", wafer: "Wafer", cell: "Hücre", module: "Modül" };

  // ---- helpers to build a variant state ---------------------------------
  function pid(st, short) { return short.indexOf("global.") === 0 ? short : st.tech + "." + short; }
  function addAbs(s, short, delta) {
    var id = pid(s, short), p = PM.PARAM_BY_ID[id], ev = model.editValue(p, s.edits[id], s);
    s.edits[id] = { mode: "abs", value: ev.value + delta };
  }
  function addPct(s, short, pct) {
    var id = pid(s, short), p = PM.PARAM_BY_ID[id];
    if (!p) return;
    var ev = model.editValue(p, s.edits[id], s);
    s.edits[id] = { mode: "abs", value: ev.value * (1 + pct / 100) };
  }
  function impactOf(mutate) {
    var s = clone(App.state);
    mutate(s);
    model.normalise(s);
    return model.compute(s).total - App.current().total;
  }
  function pv(short) {
    var st = App.state, p = PM.PARAM_BY_ID[pid(st, short)];
    return model.editValue(p, st.edits[p.id], st).value;
  }
  function comp(cur, id) {
    var v = 0;
    cur.stages.forEach(function (s) { if (s.included) s.comps.forEach(function (c) { if (c.id === id) v += c.value; }); });
    return v;
  }
  function stepOf(id, def) { var v = App.ui.proc.steps[id]; return v === undefined || v === "" || isNaN(v) ? def : Number(v); }
  function usd(v, d) { return "$" + F.wp(v, d === undefined ? 4 : d); }
  function money(v) { return (v >= 0 ? "+" : "−") + "$" + Math.abs(v).toFixed(2); }
  function sign(v, d) { return (v > 0 ? "+" : v < 0 ? "−" : "±") + "$" + Math.abs(v).toFixed(d === undefined ? 4 : d); }

  // ---- intermediate products (what a buyer purchases) -------------------
  function intermediates(cur) {
    var st = App.state, T = PM.TECH[st.tech], res = cur.res;
    var gw = res.num(PM.cc(T.gPerW, st.year)), wpw = cur.waferPowerW;
    var poly = cur.stages[0].value, wafer = cur.stages[1].value, cell = cur.stages[2].value;
    return [
      { id: "poly", label: "Polisilikon", stage: "Polisilikon",
        price: F.wp(poly / gw * 1000, 2) + " $/kg", priceNote: "modeldeki polisilikon maliyeti, " + F.num(gw) + " g/W",
        share: poly, unit: "$/kg", def: 1,
        impact: function (step) { return impactOf(function (s) { addAbs(s, "global.polyPrice", step); }); },
        how: "Polisilikon 1 $/kg artarsa modül " + F.num(gw) + " g/W × 1 $/kg ÷ 1000 = " + F.wp(gw / 1000, 4) + " $/Wp artar (dosyadaki dönüşüm oranı)." },
      { id: "wafer", label: "Wafer (adet)", stage: "Polisilikon + wafer",
        price: F.wp((poly + wafer) * wpw, 3) + " $/adet", priceNote: "polisilikon dahil, " + F.num(wpw) + " Wp/wafer",
        share: poly + wafer, unit: "$/adet", def: 0.01,
        impact: function (step) { return step / wpw; },
        how: "Hazır wafer alıyorsanız fiyat farkı modüle birebir yansır: adet başı fark ÷ " + F.num(wpw) + " Wp/wafer." },
      { id: "cell", label: "Hücre (adet)", stage: "Polisilikon + wafer + hücre",
        price: F.wp((poly + wafer + cell) * wpw, 3) + " $/adet", priceNote: "wafer ve polisilikon dahil",
        share: poly + wafer + cell, unit: "$/adet", def: 0.01,
        impact: function (step) { return step / wpw; },
        how: "Hazır hücre alıyorsanız fiyat farkı modüle birebir yansır: adet başı fark ÷ " + F.num(wpw) + " Wp/hücre." }
    ];
  }

  // ---- materials & inputs (shares add up to 100%) -----------------------
  function materials(cur) {
    var c = cur.categories, st = App.state;
    var silverKg = pv("silverPrice"), elec1 = pv("polyElecPrice"), elec2 = pv("elecPrice");
    var rows = [
      { id: "si", label: "Metal silikon", sub: "polisilikonun hammaddesi", stage: "Polisilikon",
        price: F.num(pv("siPrice")) + " $/kg", share: comp(cur, "silicon"), unit: "$/kg", def: 1,
        impact: function (step) { return impactOf(function (s) { addAbs(s, "siPrice", step); }); } },
      { id: "silver", label: "Gümüş", sub: "hücre kontakları (pasta)", stage: "Hücre",
        price: F.num(silverKg) + " $/kg ≈ " + F.wp(silverKg / OZ_PER_KG, 2) + " $/ons", share: comp(cur, "silver"), unit: "$/ons", def: 1,
        impact: function (step) { return impactOf(function (s) { addAbs(s, "silverPrice", step * OZ_PER_KG); }); } },
      { id: "bom", label: "Modül malzemeleri", sub: "cam, çerçeve, EVA/POE, bağlantı kutusu, arka levha — dosyada tek kalem", stage: "Modül",
        price: F.wp(pv("moduleOther"), 4) + " $/Wp", share: comp(cur, "moduleOther"), unit: "$/Wp", def: 0.01,
        impact: function (step) { return impactOf(function (s) { addAbs(s, "moduleOther", step); }); } },
      { id: "chem", label: "Proses malzemeleri", sub: "kimyasallar, pota, tel vb. (poli + wafer + hücre)", stage: "Poli · Wafer · Hücre",
        price: "—", share: comp(cur, "polyOther") + comp(cur, "waferOther") + comp(cur, "cellOther"), unit: "%", def: 10,
        impact: function (step) { return impactOf(function (s) { ["polyOther", "waferOther", "cellOther"].forEach(function (k) { addPct(s, k, step); }); }); } },
      { id: "elec", label: "Elektrik", sub: "en çok polisilikon aşamasında", stage: "Tüm aşamalar",
        price: F.num(elec1) + (elec1 !== elec2 ? " / " + F.num(elec2) : "") + " $/kWh", share: c.energy, unit: "$/kWh", def: 0.01,
        impact: function (step) { return impactOf(function (s) { addAbs(s, "polyElecPrice", step); addAbs(s, "elecPrice", step); }); } },
      { id: "labour", label: "İşçilik", sub: "mühendis maaşı × çalışan sayısı", stage: "Tüm aşamalar",
        price: "$" + F.num(pv("salary")) + "/yıl", share: c.labour, unit: "%", def: 10,
        impact: function (step) { return impactOf(function (s) { addPct(s, "polySalary", step); addPct(s, "salary", step); }); } },
      { id: "capex", label: "Yatırım (makine + bina)", sub: "amortisman ve bakım", stage: "Tüm aşamalar",
        price: "—", share: c.capital + c.maintenance, unit: "%", def: 10,
        impact: function (step) { return impactOf(function (s) { ["polyEquip", "eqWafer", "eqCell", "eqModule", "polyBld", "bldWafer", "bldCell", "bldModule"].forEach(function (k) { addPct(s, k, step); }); }); } },
      { id: "ovh", label: "Genel giderler + ESG", sub: "genel gider oranı %10, ESG sertifikası", stage: "Tüm aşamalar",
        price: "—", share: c.overhead + c.esg, unit: "%", def: 10,
        impact: function (step) { return impactOf(function (s) { ["polyOverhead", "waferOverhead", "cellOverhead", "moduleOverhead"].forEach(function (k) { addPct(s, k, step); }); }); } },
      { id: "margin", label: "Üretici kâr marjı", sub: "dosyada her aşamaya %15 ekleniyor", stage: "Tüm aşamalar",
        price: F.pct(pv("global.margin"), 0), share: c.margin, unit: "puan", def: 1,
        impact: function (step) { return impactOf(function (s) { addAbs(s, "global.margin", step / 100); }); } }
    ];
    if (c.imported > 0) rows.push({ id: "imp", label: "İthal aşama fiyatları", sub: "dosyadaki ithalat tablosu", stage: cur.stages.filter(function (s) { return s.imported; }).map(function (s) { return STAGE_SHORT[s.id]; }).join(", "),
      price: "—", share: c.imported, unit: "%", def: 10,
      impact: function (step) {
        return impactOf(function (s) {
          ["poly", "wafer", "cell"].forEach(function (k) {
            if (!model.isImported(s, s.tech, k)) return;
            if (k === "poly") { var p = PM.PARAM_BY_ID["topcon.import.poly"], ev = model.editValue(p, s.edits[p.id], s); s.edits[p.id] = { mode: "abs", value: ev.value * (1 + step / 100) }; }
            else addPct(s, "import." + k, step);
          });
        });
      } });
    if (c.purchased > 0) rows.push({ id: "pur", label: "Satın alınan " + (cur.purchased.kind === "wafer" ? "wafer" : "hücre"), sub: "girdiğiniz hazır alım fiyatı", stage: "—",
      price: F.wp(cur.purchased.value, 4) + " $/Wp", share: c.purchased, unit: "$/Wp", def: 0.01, impact: function (step) { return step; } });
    return rows;
  }

  function impactRow(r, total, power) {
    var step = stepOf(r.id, r.def), d = r.impact(step);
    return "<tr><td style='min-width:180px'><b>" + esc(r.label) + "</b>" + (r.how ? " " + App.info(r.how) : "") + (r.sub ? '<div class="small muted">' + esc(r.sub) + "</div>" : "") + "</td>" +
      "<td class='small'>" + esc(r.stage) + "</td><td class='num'>" + r.price + (r.priceNote ? '<div class="small muted">' + esc(r.priceNote) + "</div>" : "") + "</td>" +
      '<td class="num">' + usd(r.share) + "</td>" +
      '<td style="min-width:120px"><div class="num"><b>' + F.pct(r.share / total) + '</b></div><div class="share-bar"><i style="width:' + Math.min(100, r.share / total * 100) + '%;background:var(--c1)"></i></div></td>' +
      '<td class="nowrap"><span class="small muted">+</span><input type="number" class="pct" step="any" value="' + step + '" data-bind="proc-step" data-row="' + r.id + '" data-focus="step:' + r.id + '"> <span class="small">' + esc(r.unit) + "</span></td>" +
      '<td class="num"><b class="delta ' + (d > 1e-9 ? "up" : d < -1e-9 ? "down" : "zero") + '">' + sign(d, 5) + "</b></td>" +
      '<td class="num">' + money(d * power) + '</td><td class="num">' + F.signedPct(d / total, 2) + "</td></tr>";
  }
  App.binds["proc-step"] = function (v, el) { App.ui.proc.steps[el.getAttribute("data-row")] = parseFloat(v); App.render(); };

  // ---- quick price simulator (writes the shared scenario) ---------------
  var SIM = [
    { key: "poly", label: "Polisilikon fiyatı", unit: "$/kg (+/−)", id: "global.polyPrice", kind: "abs", step: 1 },
    { key: "silver", label: "Gümüş fiyatı", unit: "%", id: "silverPrice", kind: "pct", step: 5 },
    { key: "elec", label: "Elektrik fiyatı", unit: "%", ids: ["polyElecPrice", "elecPrice"], kind: "pct", step: 5 },
    { key: "bom", label: "Modül malzemeleri (cam, çerçeve…)", unit: "%", id: "moduleOther", kind: "pct", step: 5 }
  ];
  function simValue(x) {
    var st = App.state, id = pid(st, x.id || x.ids[0]), e = st.edits[id];
    if (!e) return 0;
    if (x.kind === "abs") return e.value;
    var p = PM.PARAM_BY_ID[id], ev = model.editValue(p, e, st);
    return Number(((ev.value / ev.base - 1) * 100).toFixed(2));
  }
  App.binds["proc-sim"] = function (v, el) {
    var x = SIM.filter(function (s) { return s.key === el.getAttribute("data-key"); })[0], val = parseFloat(v);
    if (isNaN(val)) val = 0;
    App.set(function (s) {
      (x.ids || [x.id]).forEach(function (short) {
        var id = pid(s, short);
        if (val === 0) delete s.edits[id]; else s.edits[id] = { mode: x.kind, value: val };
      });
    });
  };

  // ---- country overview --------------------------------------------------
  var DRIVER_TR = {
    "Electricity prices": "Elektrik fiyatı", "Labour cost (engineer salaries)": "İşçilik maliyeti", "Equipment CAPEX": "Makine yatırımı",
    "Buildings & facilities CAPEX": "Bina yatırımı", "Installed capacity (ESG certification scaling)": "Kapasite (ESG)",
    "Sourcing & import price route (destination-specific import tables)": "Tedarik / ithalat"
  };
  function countryRows() {
    var st = App.state;
    return model.countries().map(function (c) {
      var s = clone(st); s.country = c; s.sources[s.tech] = { poly: "Domestic", wafer: "Domestic", cell: "Domestic" }; model.normalise(s);
      var out = model.compute(s), drv = null;
      if (c !== "China") {
        var ex = AN.explainCountry(model, st, "China", c, function () { return { poly: "Domestic", wafer: "Domestic", cell: "Domestic" }; });
        drv = ex.steps.slice().sort(function (a, b) { return Math.abs(b.delta) - Math.abs(a.delta); })[0];
      }
      return { c: c, s: s, out: out, drv: drv };
    }).sort(function (a, b) { return a.out.total - b.out.total; });
  }

  App.register("ozet", {
    title: "Satınalma özeti", icon: "★", section: "Basit görünüm",
    render: function () {
      var st = App.state, cur = App.current(), base = App.baseline(), total = cur.total, power = cur.modulePowerW;
      var dTot = total - base.total;
      var h = '<div class="page-head"><div><h1>Satınalma özeti</h1><p>Bir panelin fiyatını oluşturan ana kalemler, hangi malzemenin yüzde kaç pay aldığı ve <b>bir fiyat artışının modüle ne kadar yansıdığı</b>. ' +
        "Rakamlar IRENA dosyasının kendi formüllerinden canlı hesaplanır. Ülke, teknoloji ve yılı üstten seçin.</p></div></div>";
      if (cur.stages.some(function (s) { return s.imported; }) || st.mode !== "workbook")
        h += '<div class="notice info"><span class="ico">i</span><div>Bu yapılandırmada ithal edilen ya da hazır alınan aşamalar var. Bu aşamaların fiyatı dosyada tek bir rakam olarak duruyor ve malzemelere ayrılamıyor.</div></div>';

      // KPIs
      h += '<div class="grid g4">' +
        card("Modül maliyeti", usd(total), "$/Wp", dTot !== 0 ? "Değiştirmeden önce " + usd(base.total) + " · " + F.delta(dTot, base.total) : esc(st.country) + " · " + PM.TECH[st.tech].label + " · " + st.year,
          "Dosyadaki “Total Module Cost with ESG”: dört aşamanın toplamı. Üreticinin %15 kâr marjı ve genel giderleri dahildir.") +
        card("Panel başına", "$" + (total * power).toFixed(2), "/ panel", F.num(power) + " W panel" + (dTot !== 0 ? " · " + money(dTot * power) : ""), "Modül maliyeti × panel gücü (dosyadaki 66 hücreli panel).") +
        card("Wafer eşdeğeri", "$" + ((cur.stages[0].value + cur.stages[1].value) * cur.waferPowerW).toFixed(3), "/ adet", "polisilikon dahil · " + F.num(cur.waferPowerW) + " Wp/wafer", "Modelin polisilikon + wafer maliyetinin wafer başına karşılığı. Piyasa teklifi değildir.") +
        card("Hücre eşdeğeri", "$" + ((cur.stages[0].value + cur.stages[1].value + cur.stages[2].value) * cur.waferPowerW).toFixed(3), "/ adet", "wafer ve polisilikon dahil", "Modelin polisilikon + wafer + hücre maliyetinin hücre başına karşılığı. Piyasa teklifi değildir.") +
        "</div>";

      // 1. Stage composition
      h += '<div class="card section"><div class="card-head"><h2>1 · Modül fiyatı hangi aşamalardan oluşuyor?</h2><span class="sub">pay ve $/Wp</span></div><div id="pr-stages" class="chart" style="min-height:120px;height:120px"></div><div class="grid g4" style="margin-top:8px">' +
        cur.stages.map(function (s, i) {
          return '<div class="card kpi" style="box-shadow:none"><div class="label"><span class="swatch" style="background:' + App.stageColor(i) + '"></span>' + STAGE_TR[s.id] + (s.imported ? " " + App.tag("imp", "ithal") : "") + '</div><div class="value">' + F.pct(s.included ? s.value / total : 0) +
            '<span class="unit">' + usd(s.value) + '/Wp</span></div><div class="foot">' + money(s.value * power) + " / panel</div></div>";
        }).join("") + "</div>" +
        '<p class="small muted" style="margin-top:8px">Her aşama yalnızca kendi eklediği maliyeti içerir. Wafer satırında polisilikon, hücre satırında wafer tekrar sayılmaz.</p></div>';

      // 2. Highlight cards (buyer questions)
      var inter = intermediates(cur), mats = materials(cur);
      var dPoly = inter[0].impact(1), dSilver = mats[1].impact(1), dElec = mats[4].impact(0.01), silverComp = mats[1].share, cellVal = cur.stages[2].value;
      h += '<div class="grid g3 section">' +
        callout("Polisilikon +1 $/kg", dPoly, power, total, "Modüle etkisi. Polisilikon payı: " + F.pct(cur.stages[0].value / total) + ".") +
        callout("Gümüş +1 $/ons", dSilver, power, total, "Gümüş hücre aşamasında: hücre maliyetinin " + F.pct(cellVal ? silverComp / cellVal : 0) + "’i, modülün " + F.pct(silverComp / total) + "’i.") +
        callout("Elektrik +1 cent/kWh", dElec, power, total, "Tüm aşamalarda. Elektrik payı: " + F.pct(cur.categories.energy / total) + ".") + "</div>";

      // 3. Intermediate products
      h += '<div class="card section"><div class="card-head"><h2>2 · Ara ürünler: fiyat artışı modüle ne kadar yansır?</h2><span class="sub">artış miktarını değiştirebilirsiniz</span></div>' + tableHead("Ara ürün", "İçerik") +
        inter.map(function (r) { return impactRow(r, total, power); }).join("") + "</tbody></table></div></div>";

      // 4. Materials
      h += '<div class="card section"><div class="card-head"><h2>3 · Malzemeler ve girdiler: modülün yüzde kaçı?</h2><span class="sub">paylar toplamı %100 · artış miktarını değiştirebilirsiniz</span></div>' +
        '<div id="pr-mats" class="chart" style="min-height:260px"></div>' + tableHead("Kalem", "Aşama") +
        mats.map(function (r) { return impactRow(r, total, power); }).join("") +
        '<tr class="total"><td>Toplam</td><td></td><td></td><td class="num">' + usd(mats.reduce(function (a, r) { return a + r.share; }, 0)) + '</td><td class="num">100%</td><td colspan="4"></td></tr></tbody></table></div>' +
        '<p class="small muted">Etki sütunu modeli artışla yeniden hesaplar. Üreticinin genel gideri ve %15 kâr marjı da artışla birlikte büyüdüğü için etki, malzemenin kendi payından biraz fazla çıkar. Gümüş dışındaki metaller (alüminyum, bakır) ve cam dosyada ayrı kalem değil; “Modül malzemeleri” içinde.</p></div>';

      // 5. Simulator
      h += '<div class="card section"><div class="card-head"><h2>4 · Hızlı fiyat senaryosu</h2><span class="sub">tüm sayfalara uygulanır</span></div><div class="grid g4">' +
        SIM.map(function (x) {
          return '<label class="field"><span class="small" style="font-weight:600">' + x.label + '</span><div class="param-ctrl" style="margin-top:4px"><input type="number" step="' + x.step + '" value="' + simValue(x) + '" data-bind="proc-sim" data-key="' + x.key + '" data-focus="sim:' + x.key + '"><span class="small muted">' + x.unit + "</span></div></label>";
        }).join("") + "</div>" +
        '<div style="margin-top:12px;display:flex;gap:18px;align-items:baseline;flex-wrap:wrap"><div><span class="muted small">Senaryo modül maliyeti</span><div style="font-size:24px;font-weight:650">' + usd(total) + ' <span class="small muted">$/Wp</span></div></div>' +
        "<div><span class='muted small'>Değişim</span><div style='font-size:20px;font-weight:650'>" + F.delta(dTot, base.total) + "</div></div><div><span class='muted small'>Panel başına</span><div style='font-size:20px;font-weight:650'>" + money(dTot * power) + "</div></div>" +
        (App.editCount() ? '<button class="btn" data-action="reset-all">↺ Sıfırla</button>' : "") + "</div></div>";

      // 6. Countries
      var rows = countryRows(), china = rows.filter(function (r) { return r.c === "China"; })[0];
      App.ui.proc._rows = rows;
      h += '<div class="card section"><div class="card-head"><h2>5 · Ülkelere göre modül maliyeti</h2><span class="sub">' + PM.TECH[st.tech].label + " · " + st.year + " · tüm aşamalar yerli üretim · Çin’e göre</span></div>" +
        '<div id="pr-countries" class="chart" style="min-height:280px"></div><div class="table-wrap"><table class="data"><thead><tr><th>Ülke</th><th class="num">$/Wp</th><th class="num">$/panel</th><th class="num">Çin’e göre</th><th class="num">Elektrik $/kWh</th><th class="num">Maaş $/yıl</th><th>En büyük fark nedeni</th></tr></thead><tbody>' +
        rows.map(function (r) {
          var ec = model.editValue(PM.PARAM_BY_ID[st.tech + ".elecPrice"], r.s.edits[st.tech + ".elecPrice"], r.s).value;
          var sal = model.editValue(PM.PARAM_BY_ID[st.tech + ".salary"], r.s.edits[st.tech + ".salary"], r.s).value;
          return "<tr" + (r.c === st.country ? ' class="total"' : "") + "><td><b>" + r.c + '</b></td><td class="num">' + usd(r.out.total) + '</td><td class="num">$' + (r.out.total * r.out.modulePowerW).toFixed(2) + '</td><td class="num">' +
            (r.c === "China" ? "referans" : F.delta(r.out.total - china.out.total, china.out.total)) + '</td><td class="num">' + F.num(ec) + '</td><td class="num">' + F.num(sal) + "</td><td class='small'>" +
            (r.drv ? (DRIVER_TR[r.drv.label] || r.drv.label) + " (" + sign(r.drv.delta) + ")" : "—") + "</td></tr>";
        }).join("") + "</tbody></table></div>" +
        '<p class="small muted">Ülkeler arasındaki fark yalnızca dosyadaki ülke verilerinden gelir: elektrik fiyatı, maaşlar ve yatırım maliyetleri. Gümrük vergisi, teşvik ve navlun ayrıca modellenmemiştir. Ayrıntı için “Country comparison” sayfasına bakın.</p></div>';

      // 7. Simple stage breakdown
      var cols = [["materials", "Malzeme"], ["energy", "Elektrik"], ["labour", "İşçilik"], ["capm", "Yatırım + bakım"], ["ovm", "Genel gider + kâr + ESG"], ["imported", "İthal fiyat"]];
      function catOf(c) { return c === "capital" || c === "maintenance" ? "capm" : c === "overhead" || c === "margin" || c === "esg" ? "ovm" : c; }
      h += '<div class="card section"><div class="card-head"><h2>6 · Basit kırılım: her aşamada ne var?</h2><span class="sub">$/Wp</span></div><div class="table-wrap"><table class="data"><thead><tr><th>Aşama</th><th class="num">Toplam</th><th class="num">Pay</th>' +
        cols.map(function (c) { return '<th class="num">' + c[1] + "</th>"; }).join("") + "</tr></thead><tbody>" +
        cur.stages.map(function (s, i) {
          var sums = {}; cols.forEach(function (c) { sums[c[0]] = 0; });
          s.comps.forEach(function (c) { sums[catOf(c.cat)] += c.value; });
          return '<tr><td><span class="swatch" style="background:' + App.stageColor(i) + '"></span><b>' + STAGE_TR[s.id] + "</b></td><td class='num'><b>" + usd(s.value) + "</b></td><td class='num'>" + F.pct(s.included ? s.value / total : 0) + "</td>" +
            cols.map(function (c) { return '<td class="num">' + (sums[c[0]] > 0 ? usd(sums[c[0]]) + '<div class="small muted">' + F.pct(sums[c[0]] / s.value, 0) + "</div>" : "·") + "</td>"; }).join("") + "</tr>";
        }).join("") +
        '<tr class="total"><td>Modül toplamı</td><td class="num">' + usd(total) + '</td><td class="num">100%</td>' + cols.map(function (c) {
          var v = 0; cur.stages.forEach(function (s) { if (s.included) s.comps.forEach(function (x) { if (catOf(x.cat) === c[0]) v += x.value; }); });
          return '<td class="num">' + (v > 0 ? usd(v) + '<div class="small muted">' + F.pct(v / total, 0) + "</div>" : "·") + "</td>";
        }).join("") + "</tr></tbody></table></div>" +
        '<p class="small muted">Her bileşenin formülü ve Excel hücresi için “Cost breakdown” sayfasına bakın.</p></div>';
      return h;
    },
    after: function () {
      var cur = App.current(), total = cur.total;
      App.plot("pr-stages", cur.stages.filter(function (s) { return s.included; }).map(function (s, i) {
        return { type: "bar", orientation: "h", y: [""], x: [s.value / total * 100], name: STAGE_SHORT[s.id], text: [STAGE_SHORT[s.id] + " " + F.pct(s.value / total, 0)], textposition: "inside", insidetextanchor: "middle",
          textfont: { color: i < 2 ? "#0b0b0b" : "#ffffff", size: 13 }, marker: { color: App.stageColor(PM.STAGES.map(function (x) { return x.id; }).indexOf(s.id)), line: { color: App.color("--surface"), width: 2 } },
          hovertemplate: STAGE_TR[s.id] + ": %{x:.1f}% · " + usd(s.value) + " $/Wp<extra></extra>" };
      }).concat(cur.purchased ? [{ type: "bar", orientation: "h", y: [""], x: [cur.purchased.value / total * 100], name: "Hazır alım", text: ["Hazır alım " + F.pct(cur.purchased.value / total, 0)], textposition: "inside", marker: { color: App.color("--s5") } }] : []),
        { barmode: "stack", showlegend: false, height: 120, margin: { l: 8, r: 8, t: 4, b: 28 }, xaxis: { range: [0, 100], ticksuffix: "%", showgrid: false }, yaxis: { visible: false } });
      var mats = materials(cur).slice().sort(function (a, b) { return a.share - b.share; });
      App.plot("pr-mats", [{ type: "bar", orientation: "h", y: mats.map(function (r) { return r.label; }), x: mats.map(function (r) { return r.share / total * 100; }),
        marker: { color: App.color("--c1") }, text: mats.map(function (r) { return F.pct(r.share / total); }), textposition: "outside", cliponaxis: false,
        hovertemplate: "%{y}: %{x:.1f}%<extra></extra>" }],
        { showlegend: false, margin: { l: 150, r: 40, t: 10 }, xaxis: { ticksuffix: "%", title: { text: "Modül maliyetindeki pay" } }, height: Math.max(260, mats.length * 26 + 60) });
      var rows = App.ui.proc._rows;
      App.plot("pr-countries", PM.STAGES.map(function (s, i) {
        return { type: "bar", orientation: "h", name: STAGE_SHORT[s.id], y: rows.map(function (r) { return r.c; }), x: rows.map(function (r) { return r.out.stages[i].value; }),
          marker: { color: App.stageColor(i), line: { color: App.color("--surface"), width: 1 } }, hovertemplate: "%{y} · " + STAGE_SHORT[s.id] + ": %{x:.4f} $/Wp<extra></extra>" };
      }), { barmode: "stack", xaxis: { title: { text: "$/Wp" } }, margin: { l: 80 },
        annotations: rows.map(function (r) { return { x: r.out.total, y: r.c, text: F.wp(r.out.total), xanchor: "left", showarrow: false, xshift: 4, font: { size: 11, color: App.color("--ink-2") } }; }) });
    }
  });

  function card(label, value, unit, foot, tip) {
    return '<div class="card kpi"><div class="label">' + label + " " + App.info(tip) + '</div><div class="value">' + value + '<span class="unit">' + unit + '</span></div><div class="foot">' + foot + "</div></div>";
  }
  function callout(title, d, power, total, note) {
    return '<div class="card kpi" style="border-left:4px solid var(--c2)"><div class="label">' + title + '</div><div class="value">' + sign(d, 5) + '<span class="unit">$/Wp</span></div>' +
      '<div class="foot"><b>' + money(d * power) + "</b> / panel · " + F.signedPct(d / total, 2) + " modül maliyeti</div><div class='foot'>" + note + "</div></div>";
  }
  function tableHead(a, b) {
    return '<div class="table-wrap"><table class="data"><thead><tr><th>' + a + "</th><th>" + b + '</th><th class="num">Güncel fiyat</th><th class="num">Modüldeki payı</th><th class="num">Pay</th><th>Fiyat artışı</th><th class="num">Modüle etkisi $/Wp</th><th class="num">$/panel</th><th class="num">Modül %</th></tr></thead><tbody>';
  }

  // put the simple view first and make it the start page
  App.order = ["ozet"].concat(App.order.filter(function (x) { return x !== "ozet"; }));
  App.defaultRoute = "ozet";
})();
