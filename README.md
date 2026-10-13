# Solar PV Manufacturing Cost Intelligence Platform

An interactive application built on the **IRENA TSSC Solar PV Manufacturing Cost Model v1** (`IRENA_TSSC_Solar_PV_Manufacturing_Cost_Model_v1.xlsx`). Every figure is computed live from the workbook's **own formulas**. There are no hardcoded results and no external data.

---

## 🇹🇷 Hızlı başlangıç (kurulum gerekmez)

1. Depoyu indirin: GitHub'da **Code → Download ZIP**, ardından ZIP'i bir klasöre açın.
2. **`Uygulamayi_Ac.html`** dosyasına çift tıklayın (veya `app/index.html`).
3. Uygulama tarayıcıda açılır: Chrome, Edge, Firefox veya Safari. **İnternet bağlantısı, Python ya da kurulum gerekmez**; tüm dosyalar `app/` klasöründedir.

Sadece `app/` klasörünü kopyalamanız da yeterlidir; klasör kendi başına çalışır.

**Sayfalar:**

| Sayfa | Ne yapar |
|---|---|
| Executive dashboard | Toplam maliyet (USD/Wp ve USD/modül), aşama bazında şelale grafiği, maliyet payları, 2020–2030 trendi |
| Cost breakdown | Polisilikon → wafer → hücre → modül; her kalemin Excel formülü ve hücresi |
| Country comparison | 6 ülkenin sıralaması, detay tablo, "neden daha pahalı?" açıklaması |
| Input control center | Hesapta gerçekten kullanılan tüm girdiler; ülke, teknoloji, tedarik ve hesap modu |
| Scenario lab | Hazır deneyler (elektrik +%20 vb.), senaryo kaydetme, kopyalama, karşılaştırma, JSON içe/dışa aktarma |
| Sensitivity & drivers | Tornado grafiği, elastikiyet, aşama bazında duyarlılık, tek değişken taraması |
| Input explorer | Tüm girdilerin aranabilir envanteri |
| Methodology | Excel ile canlı mutabakat, kısıtlar, veri tabloları |

Senaryolar tarayıcıda (localStorage) saklanır; başka bir bilgisayara taşımak için *Export/Import JSON* kullanın.

---

## Quick start (English)

**No installation.** Open `Uygulamayi_Ac.html` or `app/index.html` in any modern browser. Everything the app needs, including the Plotly charting library, is bundled in `app/`, so it also works offline from a USB stick or shared drive.

### Re-building from the workbook (developers only)

Tools needed: Python 3 + `openpyxl`; Node.js ≥ 18; optionally LibreOffice for the independent cross-check.

```bash
python3 tools/extract_workbook.py        # workbook → app/data/model_data.js (all cells, formulas, cached values)
python3 tools/libreoffice_recalc.py      # optional: reference recalculations → validation/fixtures/
node validation/run_validation.js        # 156 checks → docs/VALIDATION_REPORT.md (exit code ≠ 0 on failure)
node tools/generate_docs.js              # → docs/INPUT_OUTPUT_MAP.md
```

## Architecture

```
IRENA_TSSC_..._v1.xlsx            original workbook (read-only, never modified)
tools/extract_workbook.py         ingestion & audit layer  → app/data/model_data.js
app/assets/js/formula.js          Excel formula parser/evaluator (IF, AND, OR, INDEX, MATCH, SUM, …)
app/assets/js/engine.js           workbook cell graph: evaluation under user "patches", dependency tracing
app/assets/js/model.js            semantic layer: stages, components, cost categories, parameters, modes
app/assets/js/analysis.js         scenarios, attribution, sensitivity, sweeps, country-driver explanation
app/assets/js/app.js, pages.js    user interface (state, routing, charts, 8 pages)
validation/                       validation suite + LibreOffice reference fixtures
docs/                             audit, input/output/formula map, validation report, limitations
```

The engine **executes the workbook's own formulas** rather than a re-typed approximation. A user edit is applied the same way a workbook user would apply it:

- country-specific inputs go into the `Inputs!E` "User Input" column;
- assumptions are written to their cells;
- yearly series are scaled.

So the methodology is preserved by construction.

## Validation summary

See [`docs/VALIDATION_REPORT.md`](docs/VALIDATION_REPORT.md). **156 / 156 checks pass:**

- All **1,506** workbook formulas are recomputed from raw inputs and **equal Excel's cached results exactly**.
- **18 configurations** were checked against independent **LibreOffice** recalculations: 6 countries × domestic / imported / mixed sourcing, a +20 % electricity case and a capacity override. That is 20,736 values, all within 5×10⁻¹⁵.
- Mandatory scenarios:
  - unchanged baseline: China TOPCon 2025 = **0.1810 USD/Wp**, Mono PERC = 0.1795;
  - single input change: electricity +20 % → 0.1859;
  - country comparison: Germany 0.2808, US 0.2601, India-imported 0.1596, …
- Every editable control changes the result; non-editable items are verified to have no effect.
- No double counting in the purchased-wafer and purchased-cell modes.
- Scenario and country attributions sum exactly to the difference they explain.

## Documentation

- [`docs/WORKBOOK_AUDIT.md`](docs/WORKBOOK_AUDIT.md): worksheet inventory, calculation structure, countries, technologies, sourcing rules, hardcoded values and issues found.
- [`docs/INPUT_OUTPUT_MAP.md`](docs/INPUT_OUTPUT_MAP.md): every output, component and parameter with its cell, formula, upstream inputs and unit (generated).
- [`docs/VALIDATION_REPORT.md`](docs/VALIDATION_REPORT.md): baseline reconciliation and scenario tests (generated).
- [`docs/LIMITATIONS_AND_EXTENSIONS.md`](docs/LIMITATIONS_AND_EXTENSIONS.md): limitations and recommended model extensions.

## Data provenance and disclaimer

All default values are original IRENA workbook data. Values you change are labelled *User-modified*; extension features are labelled *Extension*; example experiments are labelled *Illustrative*. Example percentages are not forecasts. The workbook is provided by IRENA "as is" (see its About sheet); this application does not change its methodology, and the findings in the workbook audit describe the workbook as published.

Plotly.js 2.35.2 is bundled under the MIT licence (`app/assets/vendor/plotly-LICENSE.txt`).
