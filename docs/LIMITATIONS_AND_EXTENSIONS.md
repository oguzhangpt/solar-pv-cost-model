# Limitations and Recommended Model Extensions

## Limitations of the application (inherited from the workbook)

The full list of workbook issues, with cell references, is in [`WORKBOOK_AUDIT.md` §5](WORKBOOK_AUDIT.md#5-issues-inconsistencies-and-limitations). The application reproduces the workbook exactly and **does not silently correct** any of them; each one is flagged in the app's *Methodology & data quality* page.

| # | Limitation | Consequence for users | How the app handles it |
|---|---|---|---|
| 1 | 15 % operating profit included in every stage | "Cost" is closer to an ex-works price | Separate KPI "cost excl. operating profit"; margin exposed as a parameter |
| 2 | Capacity only drives ESG certification, which rises with capacity | Capacity expansion scenarios raise cost/Wp slightly | Flagged in tooltips, explorer and methodology; polysilicon capacity marked "no effect" |
| 3 | No capacity utilisation or cost of capital | Cannot simulate under-utilised plants or financing costs | Listed as "not in workbook" in inputs, country table and explorer |
| 4 | Import prices hardcoded, undocumented, 2025–2030 only | Imported-stage results rest on unexplained numbers | Tagged "Imported — hardcoded"; warning when year < 2025 |
| 5 | Output_Visualization waterfall drops upstream stages when imported | Two different totals for import configurations | Calculation-sheet total used as headline; chart convention computed and validated |
| 6 | Unused / unlinked assumptions, Mono efficiency inconsistency, unit-label errors | Editing the Assumptions sheet in Excel may have no effect | The app only offers inputs that the formulas actually use (verified by the validation suite) |
| 7 | Materials other than silver are a lump sum | Glass, aluminium, copper, encapsulant and junction-box price shocks cannot be simulated individually | Shown as future extensions in the Input explorer; not added to the engine |
| 8 | Sensitivities are model-based | They do not reflect historical market co-movements | Stated on the Sensitivity page |

## Recommended extensions (not implemented in the cost engine)

1. **Itemised module bill of materials.** Split "other module materials" into glass, aluminium frame, encapsulant (EVA/POE), backsheet, junction box, ribbons and copper, with consumption per W and prices. Keep the total reconcilable to the workbook's 0.055 USD/Wp at default values.
2. **Capacity utilisation and fixed/variable cost split.** Fixed costs (depreciation, maintenance, overheads) ÷ (capacity × utilisation).
3. **Cost of capital.** Replace straight-line depreciation with a capital recovery factor (WACC, lifetime), per country.
4. **Fix the ESG certification formula.** Make it a fixed annual cost ÷ capacity, or a constant USD/W.
5. **Documented import prices.** Derive import prices from the origin country's modelled stage cost plus explicit freight, duties/tariffs and margin, and extend them to all years and routes.
6. **Policy levers.** Explicit tariffs, local-content incentives, tax credits (e.g. per-W manufacturing credits) and subsidies by country. The About sheet lists these as the model's intended use, but the formulas do not contain them.
7. **Consistency fixes.** Link hardcoded series to the Assumptions sheet (silver price, module other material, Mono efficiency and module area), remove unused assumptions and correct unit labels.
8. **Market data layer.** An optional, clearly labelled feed of external spot prices (polysilicon, wafer, cell, silver), kept separate from the IRENA defaults.

The application already contains these extensions, all labelled in the UI:

- an operating-profit parameter;
- purchased-wafer and purchased-cell calculation modes;
- percentage scaling of yearly series;
- scenario attribution, country-driver explanations, sensitivity and sweeps.
