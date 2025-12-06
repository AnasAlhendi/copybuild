'use strict';

// Minimal match-filter evaluator supporting:
//  - key (exists)
//  - !key (not exists)
//  - key > N, >=, <, <=, =, != (numeric compare where possible)
//  - key = 'literal' (string compare)
//  - a & b (AND)

function tokenize(expr) {
  return expr.match(/'[^']*'|"[^"]*"|[()&|]|!=|>=|<=|[=<>!]|[A-Za-z0-9_\.]+|\S+/g) || [];
}

function parse(expr) {
  const tokens = tokenize(String(expr));
  return tokens;
}

function get(info, key) {
  return info && Object.prototype.hasOwnProperty.call(info, key) ? info[key] : undefined;
}

function evalFilter(tokens, info) {
  let i = 0;
  function next() { return tokens[i++]; }
  function peek() { return tokens[i]; }
  function parseExpr() {
    let left = parseAnd();
    while (peek() === '|') { next(); left = left || parseAnd(); }
    return left;
  }
  function parseAnd() {
    let left = parseTerm();
    while (peek() === '&') { next(); left = left && parseTerm(); }
    return left;
  }
  function parseTerm() {
    let key = next();
    if (!key) return true;
    if (key === '&' || key === '|') return parseTerm();
    if (key === '(') {
      const val = parseExpr();
      const closing = next();
      if (closing !== ')') return false;
      return val;
    }
    if (key.startsWith('!') && key.length > 1) {
      const k = key.slice(1);
      const v = get(info, k);
      return v === undefined || v === null || v === '' || v === false;
    }
    const op = peek();
    if (op === '&' || op === undefined) {
      const v = get(info, key);
      return v !== undefined && v !== null && v !== '';
    }
    next();
    let rhs = next();
    if (!rhs) return false;
    if ((rhs.startsWith("'") && rhs.endsWith("'")) || (rhs.startsWith('"') && rhs.endsWith('"'))) {
      rhs = rhs.slice(1, -1);
    }
    const v = get(info, key);
    const numV = typeof v === 'number' ? v : parseFloat(v);
    const numR = parseFloat(rhs);
    switch (op) {
      case '=': return String(v) === String(rhs);
      case '!=': return String(v) !== String(rhs);
      case '>': return numV > numR;
      case '>=': return numV >= numR;
      case '<': return numV < numR;
      case '<=': return numV <= numR;
      default: return false;
    }
  }
  return !!parseExpr();
}

function matchFilter(expr, info) {
  try {
    const tokens = parse(expr);
    return evalFilter(tokens, info);
  } catch (_) {
    return false;
  }
}

module.exports = { matchFilter };
