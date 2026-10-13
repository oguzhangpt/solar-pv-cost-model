/*
 * Excel formula engine (subset) for the IRENA Solar PV Manufacturing Cost Model.
 *
 * Parses and evaluates the workbook's own formulas so that the application
 * reproduces the original calculation logic exactly. Supports every construct
 * that occurs in the workbook: arithmetic (+ - * / ^), comparison, string
 * concatenation (&), cell and range references (incl. quoted sheet names and
 * $-anchors), and the functions IF, AND, OR, INDEX, MATCH, COLUMNS, COLUMN,
 * ISNUMBER, NA and SUM. Anything else raises a clear "unsupported" error
 * instead of silently producing a value.
 *
 * Works in the browser (classic script, file:// friendly) and in Node.
 */
(function (root) {
  "use strict";

  // ---------------------------------------------------------------- errors
  function XlError(code) { this.code = code; }
  XlError.prototype.toString = function () { return this.code; };
  var NA = new XlError("#N/A");
  var DIV0 = new XlError("#DIV/0!");
  var VALUE = new XlError("#VALUE!");
  var REF = new XlError("#REF!");
  function isErr(v) { return v instanceof XlError; }

  // ------------------------------------------------------------- addresses
  function colToNum(col) {
    var n = 0;
    for (var i = 0; i < col.length; i++) n = n * 26 + (col.charCodeAt(i) - 64);
    return n;
  }
  function numToCol(n) {
    var s = "";
    while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }
  function parseAddr(a) {
    var m = /^\$?([A-Z]{1,3})\$?(\d+)$/.exec(a);
    if (!m) throw new Error("Bad address " + a);
    return { c: colToNum(m[1]), r: parseInt(m[2], 10) };
  }
  function addr(c, r) { return numToCol(c) + r; }

  // ------------------------------------------------------------- tokenizer
  var REF_RE = /^(?:(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!)?(\$?[A-Z]{1,3}\$?\d+)(?::(\$?[A-Z]{1,3}\$?\d+))?/;

  function tokenize(src) {
    var s = src.charAt(0) === "=" ? src.slice(1) : src;
    var toks = [], i = 0;
    while (i < s.length) {
      var ch = s.charAt(i);
      if (/\s/.test(ch)) { i++; continue; }
      var rest = s.slice(i);
      var m;
      if ((m = /^\d+(\.\d+)?([eE][+-]?\d+)?|^\.\d+/.exec(rest))) {
        toks.push({ t: "num", v: parseFloat(m[0]) }); i += m[0].length; continue;
      }
      if (ch === '"') {
        var j = i + 1, str = "";
        while (j < s.length) {
          if (s.charAt(j) === '"') { if (s.charAt(j + 1) === '"') { str += '"'; j += 2; continue; } break; }
          str += s.charAt(j); j++;
        }
        toks.push({ t: "str", v: str }); i = j + 1; continue;
      }
      // function name: identifier immediately followed by "(" (a cell
      // reference is never followed by "(" in Excel syntax)
      if ((m = /^([A-Za-z][A-Za-z0-9.]*)\s*\(/.exec(rest))) {
        toks.push({ t: "func", v: m[1].toUpperCase() }); i += m[0].length; continue;
      }
      if ((m = REF_RE.exec(rest))) {
        var sheet = m[1] !== undefined ? m[1].replace(/''/g, "'") : m[2];
        toks.push({ t: "ref", sheet: sheet || null, a: m[3].replace(/\$/g, ""), b: m[4] ? m[4].replace(/\$/g, "") : null });
        i += m[0].length; continue;
      }
      if ((m = /^(TRUE|FALSE)\b/i.exec(rest))) { toks.push({ t: "bool", v: m[1].toUpperCase() === "TRUE" }); i += m[0].length; continue; }
      if ((m = /^(<>|<=|>=|[-+*\/^&=<>(),%])/.exec(rest))) { toks.push({ t: "op", v: m[1] }); i += m[1].length; continue; }
      throw new Error("Unsupported token near: " + rest.slice(0, 20));
    }
    return toks;
  }

  // ---------------------------------------------------------------- parser
  // precedence (low→high): comparison, &, + -, * /, ^, unary -, postfix %
  function parse(src) {
    var toks = tokenize(src), p = 0;
    function peek() { return toks[p]; }
    function isOp(v) { var t = toks[p]; return t && t.t === "op" && t.v === v; }
    function expect(v) { if (!isOp(v)) throw new Error("Expected " + v + " in " + src); p++; }

    function cmp() {
      var l = concat();
      while (peek() && peek().t === "op" && /^(=|<>|<|>|<=|>=)$/.test(peek().v)) {
        var op = toks[p++].v; l = { k: "bin", op: op, l: l, r: concat() };
      }
      return l;
    }
    function concat() {
      var l = add();
      while (isOp("&")) { p++; l = { k: "bin", op: "&", l: l, r: add() }; }
      return l;
    }
    function add() {
      var l = mul();
      while (isOp("+") || isOp("-")) { var op = toks[p++].v; l = { k: "bin", op: op, l: l, r: mul() }; }
      return l;
    }
    function mul() {
      var l = pow();
      while (isOp("*") || isOp("/")) { var op = toks[p++].v; l = { k: "bin", op: op, l: l, r: pow() }; }
      return l;
    }
    function pow() {
      var l = unary();
      while (isOp("^")) { p++; l = { k: "bin", op: "^", l: l, r: unary() }; }
      return l;
    }
    function unary() {
      if (isOp("-")) { p++; return { k: "neg", e: unary() }; }
      if (isOp("+")) { p++; return unary(); }
      var e = primary();
      while (isOp("%")) { p++; e = { k: "bin", op: "/", l: e, r: { k: "num", v: 100 } }; }
      return e;
    }
    function primary() {
      var t = toks[p++];
      if (!t) throw new Error("Unexpected end of formula: " + src);
      if (t.t === "num") return { k: "num", v: t.v };
      if (t.t === "str") return { k: "str", v: t.v };
      if (t.t === "bool") return { k: "bool", v: t.v };
      if (t.t === "ref") return { k: "ref", sheet: t.sheet, a: t.a, b: t.b };
      if (t.t === "func") {
        var args = [];
        if (!isOp(")")) {
          args.push(cmp());
          while (isOp(",")) { p++; args.push(cmp()); }
        }
        expect(")");
        return { k: "call", fn: t.v, args: args };
      }
      if (t.t === "op" && t.v === "(") { var e = cmp(); expect(")"); return e; }
      throw new Error("Unexpected token " + JSON.stringify(t) + " in " + src);
    }
    var ast = cmp();
    if (p !== toks.length) throw new Error("Trailing tokens in formula: " + src);
    return ast;
  }

  // Collect references (precedents) of a parsed formula.
  function collectRefs(ast, homeSheet, out) {
    out = out || [];
    (function walk(n) {
      if (!n) return;
      if (n.k === "ref") out.push({ sheet: n.sheet || homeSheet, a: n.a, b: n.b });
      else if (n.k === "bin") { walk(n.l); walk(n.r); }
      else if (n.k === "neg") walk(n.e);
      else if (n.k === "call") n.args.forEach(walk);
    })(ast);
    return out;
  }

  function expandRange(sheet, a, b) {
    var p1 = parseAddr(a), p2 = parseAddr(b || a), keys = [];
    for (var r = Math.min(p1.r, p2.r); r <= Math.max(p1.r, p2.r); r++)
      for (var c = Math.min(p1.c, p2.c); c <= Math.max(p1.c, p2.c); c++)
        keys.push(sheet + "!" + addr(c, r));
    return keys;
  }

  // ------------------------------------------------------------- evaluator
  // ctx: { get(sheet, address) -> value, sheet: current sheet name }
  function toNum(v) {
    if (isErr(v)) return v;
    if (v === null || v === undefined || v === "") return 0;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "number") return v;
    var n = Number(v);
    return isNaN(n) ? VALUE : n;
  }
  function rangeObj(sheet, a, b) {
    var p1 = parseAddr(a), p2 = parseAddr(b || a);
    return { range: true, sheet: sheet, r1: Math.min(p1.r, p2.r), c1: Math.min(p1.c, p2.c), r2: Math.max(p1.r, p2.r), c2: Math.max(p1.c, p2.c) };
  }

  function evaluate(n, ctx) {
    switch (n.k) {
      case "num": case "str": case "bool": return n.v;
      case "ref": {
        var sh = n.sheet || ctx.sheet;
        if (n.b) return rangeObj(sh, n.a, n.b);
        return ctx.get(sh, n.a);
      }
      case "neg": { var v = toNum(scalar(evaluate(n.e, ctx), ctx)); return isErr(v) ? v : -v; }
      case "bin": return binop(n.op, scalar(evaluate(n.l, ctx), ctx), scalar(evaluate(n.r, ctx), ctx));
      case "call": return call(n, ctx);
    }
    throw new Error("Unknown node " + n.k);
  }

  function scalar(v, ctx) {
    if (v && v.range) {
      if (v.r1 === v.r2 && v.c1 === v.c2) return ctx.get(v.sheet, addr(v.c1, v.r1));
      return VALUE;
    }
    return v;
  }

  function binop(op, a, b) {
    if (isErr(a)) return a;
    if (isErr(b)) return b;
    if (op === "&") return String(a == null ? "" : a) + String(b == null ? "" : b);
    if (/^(=|<>|<|>|<=|>=)$/.test(op)) {
      var x = a, y = b;
      if (typeof x === "string" && typeof y === "string") { x = x.toLowerCase(); y = y.toLowerCase(); }
      if (x == null) x = typeof y === "string" ? "" : 0;
      if (y == null) y = typeof x === "string" ? "" : 0;
      switch (op) {
        case "=": return x === y;
        case "<>": return x !== y;
        case "<": return x < y;
        case ">": return x > y;
        case "<=": return x <= y;
        case ">=": return x >= y;
      }
    }
    var p = toNum(a), q = toNum(b);
    if (isErr(p)) return p;
    if (isErr(q)) return q;
    switch (op) {
      case "+": return p + q;
      case "-": return p - q;
      case "*": return p * q;
      case "/": return q === 0 ? DIV0 : p / q;
      case "^": return Math.pow(p, q);
    }
    throw new Error("Unknown operator " + op);
  }

  // Reference-taking functions (COLUMN, COLUMNS) need the reference itself,
  // not the value stored in a single referenced cell.
  function refOf(node, ctx) {
    if (node.k !== "ref") throw new Error("Function expects a cell reference");
    return rangeObj(node.sheet || ctx.sheet, node.a, node.b);
  }

  function truthy(v) {
    if (isErr(v)) return v;
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    if (v == null || v === "") return false;
    return VALUE;
  }

  function call(n, ctx) {
    var a = n.args;
    switch (n.fn) {
      case "IF": {
        var c = truthy(scalar(evaluate(a[0], ctx), ctx));
        if (isErr(c)) return c;
        if (c) return a.length > 1 ? scalar(evaluate(a[1], ctx), ctx) : true;
        return a.length > 2 ? scalar(evaluate(a[2], ctx), ctx) : false;
      }
      case "AND": case "OR": {
        var acc = n.fn === "AND";
        for (var i = 0; i < a.length; i++) {
          var t = truthy(scalar(evaluate(a[i], ctx), ctx));
          if (isErr(t)) return t;
          acc = n.fn === "AND" ? (acc && t) : (acc || t);
        }
        return acc;
      }
      case "NA": return NA;
      case "ISNUMBER": { var v = scalar(evaluate(a[0], ctx), ctx); return typeof v === "number"; }
      case "SUM": {
        var s = 0;
        for (var k = 0; k < a.length; k++) {
          var x = evaluate(a[k], ctx);
          if (x && x.range) {
            for (var r = x.r1; r <= x.r2; r++) for (var cc = x.c1; cc <= x.c2; cc++) {
              var cv = ctx.get(x.sheet, addr(cc, r));
              if (isErr(cv)) return cv;
              if (typeof cv === "number") s += cv;   // Excel SUM ignores text/blank in ranges
            }
          } else {
            var nx = toNum(x); if (isErr(nx)) return nx; s += nx;
          }
        }
        return s;
      }
      case "COLUMNS": { var rg = refOf(a[0], ctx); return rg.c2 - rg.c1 + 1; }
      case "COLUMN": {
        if (!a.length) throw new Error("COLUMN() without argument is not supported");
        return refOf(a[0], ctx).c1;
      }
      case "MATCH": {
        var look = scalar(evaluate(a[0], ctx), ctx);
        if (isErr(look)) return look;
        var arr = evaluate(a[1], ctx);
        var mt = a.length > 2 ? toNum(scalar(evaluate(a[2], ctx), ctx)) : 1;
        if (mt !== 0) throw new Error("MATCH: only exact match (0) is supported");
        var vals = [];
        for (var r2 = arr.r1; r2 <= arr.r2; r2++) for (var c2 = arr.c1; c2 <= arr.c2; c2++) vals.push(ctx.get(arr.sheet, addr(c2, r2)));
        for (var q = 0; q < vals.length; q++) {
          var w = vals[q];
          if (typeof w === "string" && typeof look === "string" ? w.toLowerCase() === look.toLowerCase() : w === look) return q + 1;
        }
        return NA;
      }
      case "INDEX": {
        var ar = evaluate(a[0], ctx);
        var ri = a.length > 1 ? toNum(scalar(evaluate(a[1], ctx), ctx)) : 1;
        var ci = a.length > 2 ? toNum(scalar(evaluate(a[2], ctx), ctx)) : 1;
        if (isErr(ri)) return ri;
        if (isErr(ci)) return ci;
        if (!ar.range) return REF;
        var nr = ar.r2 - ar.r1 + 1, nc = ar.c2 - ar.c1 + 1;
        if (nr === 1 && a.length === 2) { ci = ri; ri = 1; }
        if (ri < 1 || ci < 1 || ri > nr || ci > nc) return REF;
        return ctx.get(ar.sheet, addr(ar.c1 + ci - 1, ar.r1 + ri - 1));
      }
    }
    throw new Error("Unsupported Excel function: " + n.fn);
  }

  var api = {
    parse: parse, evaluate: evaluate, collectRefs: collectRefs, expandRange: expandRange,
    parseAddr: parseAddr, addr: addr, colToNum: colToNum, numToCol: numToCol,
    isErr: isErr, XlError: XlError, NA: NA
  };
  root.PVFormula = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
