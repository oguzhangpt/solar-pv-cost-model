/*
 * Workbook calculation engine.
 *
 * Holds every cell extracted from the original workbook and evaluates the
 * workbook formulas on demand under a "patch" of user changes:
 *
 *   patch = {
 *     values:   { "Sheet!A1": 123 },   // replace a cell's value (constant or formula)
 *     scale:    { "Sheet!A1": 1.1 },   // multiply a cell's own result (dependencies stay live)
 *     formulas: { "Sheet!A1": "=..." } // replace a formula (used for documented extensions)
 *   }
 *
 * The original workbook data are never mutated: each evaluation works on a
 * fresh memo, so baseline and scenario results can be computed side by side.
 */
(function (root) {
  "use strict";
  var F = root.PVFormula || (typeof require !== "undefined" ? require("./formula.js") : null);

  function splitKey(key) {
    var i = key.lastIndexOf("!");
    return { sheet: key.slice(0, i), a: key.slice(i + 1) };
  }

  function Engine(workbook) {
    this.wb = workbook;
    this.cells = workbook.cells;
    this._ast = {};
    this._precedents = null;
    this._dependents = null;
  }

  Engine.prototype.ast = function (key, formula) {
    var cacheKey = formula ? key + "\u0000" + formula : key;
    if (!this._ast[cacheKey]) this._ast[cacheKey] = F.parse(formula || this.cells[key].f);
    return this._ast[cacheKey];
  };

  Engine.prototype.formulaOf = function (key) {
    var c = this.cells[key];
    return c && c.f ? c.f : null;
  };

  Engine.prototype.cachedValue = function (key) {
    var c = this.cells[key];
    return c ? c.v : null;
  };

  /** Evaluate the workbook under a patch. Returns a lazy, memoised result. */
  Engine.prototype.evaluate = function (patch) {
    patch = patch || {};
    var self = this, memo = {}, stack = {};
    var values = patch.values || {}, scale = patch.scale || {}, formulas = patch.formulas || {};

    function getKey(key) {
      if (Object.prototype.hasOwnProperty.call(memo, key)) return memo[key];
      if (stack[key]) throw new Error("Circular reference detected at " + key);
      var v;
      if (Object.prototype.hasOwnProperty.call(values, key)) {
        v = values[key];
      } else {
        var f = formulas[key] || (self.cells[key] && self.cells[key].f);
        if (f) {
          stack[key] = true;
          var sk = splitKey(key);
          v = F.evaluate(self.ast(key, formulas[key]), { sheet: sk.sheet, get: get });
          if (v && v.range) v = new F.XlError("#VALUE!");
          delete stack[key];
        } else {
          v = self.cells[key] ? self.cells[key].v : null;
        }
      }
      if (scale[key] !== undefined && typeof v === "number") v = v * scale[key];
      memo[key] = v;
      return v;
    }
    function get(sheet, a) { return getKey(sheet + "!" + a); }

    return {
      get: getKey,
      num: function (key) { var v = getKey(key); return typeof v === "number" ? v : NaN; },
      engine: self,
      patch: patch
    };
  };

  /** Precedents (direct inputs) of each formula cell. */
  Engine.prototype.precedents = function (key) {
    if (!this._precedents) this._buildGraph();
    return this._precedents[key] || [];
  };
  Engine.prototype.dependents = function (key) {
    if (!this._dependents) this._buildGraph();
    return this._dependents[key] || [];
  };

  Engine.prototype._buildGraph = function () {
    var pre = {}, dep = {}, self = this;
    Object.keys(this.cells).forEach(function (key) {
      if (!self.cells[key].f) return;
      var sk = splitKey(key);
      var refs = F.collectRefs(self.ast(key), sk.sheet);
      var set = {};
      refs.forEach(function (r) {
        F.expandRange(r.sheet, r.a, r.b).forEach(function (k) { set[k] = true; });
      });
      pre[key] = Object.keys(set);
      pre[key].forEach(function (k) { (dep[k] = dep[k] || []).push(key); });
    });
    this._precedents = pre;
    this._dependents = dep;
  };

  /** All upstream non-formula cells feeding a cell (transitive). */
  Engine.prototype.upstreamInputs = function (key) {
    var seen = {}, out = [], self = this;
    (function walk(k) {
      if (seen[k]) return;
      seen[k] = true;
      var f = self.formulaOf(k);
      if (!f) { if (self.cells[k]) out.push(k); return; }
      self.precedents(k).forEach(walk);
    })(key);
    return out;
  };

  /** All downstream formula cells affected by a cell (transitive). */
  Engine.prototype.downstream = function (key) {
    var seen = {}, out = [], self = this;
    (function walk(k) {
      self.dependents(k).forEach(function (d) { if (!seen[d]) { seen[d] = true; out.push(d); walk(d); } });
    })(key);
    return out;
  };

  Engine.splitKey = splitKey;
  root.PVEngine = Engine;
  if (typeof module !== "undefined" && module.exports) module.exports = Engine;
})(typeof window !== "undefined" ? window : globalThis);
