/**
 * A test reads a script's SOURCE TEXT through `scriptSource()` (TL-711).
 *
 * WHY. Inside a mutation run the modules under `scripts/` are Stryker's
 * instrumented copies: every string literal is wrapped in a mutant switch, so
 * a regex or a substring check over that text can fail the initial test run,
 * which then judges no mutant at all (TL-653). `scriptSource()` and
 * `sourceRoot()` in `_repo.mjs` read the tree the run started in. TL-702 routed
 * every source-text read through them; this guard keeps the next test from
 * being written the old way, which nothing else would notice until a mutation
 * run happened to instrument a literal that its pattern spans.
 *
 * HOW. Statically, by evaluating paths. Every `.mjs` file under
 * `scripts/tests/` is lexed, and the path argument of each `readFileSync` call
 * is evaluated against a virtual checkout: `SCRIPTS_DIR`, `REPO_ROOT` and
 * `sourceRoot` imported from `_repo.mjs`, `import.meta`, `join`, `resolve`,
 * `dirname`, `fileURLToPath`, `pathToFileURL`, `new URL(…)`, `+`, template
 * literals and array literals. Names resolve by block scope to the file's own
 * `const`, `let` and `var` bindings, `for … of` loop variables, and function
 * parameters, which take their default and, for a named function, the argument
 * of every call to it in the same file. A value with several alternatives keeps
 * them all. A call whose path lands in `scripts/` outside `scripts/tests/`, or
 * in `bin/`, is a direct read and fails: `mutation-run.mjs` mutates both
 * directories (TL-722). `sourceRoot()` evaluates to a different root, so a
 * directory walk that joins onto it passes, as `_repo.mjs` documents it should.
 * A `readdirSync` of either directory is not judged: a listing carries no
 * instrumented text, and the files a walk then reads are judged at their own
 * `readFileSync`.
 *
 * WHY NOT A TRACE. TL-702 found the reads with a preload that wrapped
 * `readFileSync` and ran the whole suite. As a guard that would run the suite a
 * second time inside the first, and a sample of it would miss every file
 * outside the sample. A static pass reads each file once.
 *
 * WHAT IT CANNOT SEE. A path that passes through an object literal, a
 * destructured binding, the parameter of an anonymous callback, a value
 * returned from a function, or a call it does not model has no value here, and
 * the call is not judged. A known root joined with such a value is judged with a
 * wildcard segment: `join(SCRIPTS_DIR, name)` is a read of `scripts/*`, which is
 * what it is. Measured on the tree before TL-702: it reports 42 read sites in 27
 * files, 26 of them among the 33 test files that commit changed. Of the other
 * seven, three read through a stack of paths a walk pops, one through an
 * object-literal map, one through an anonymous callback over a list, one
 * through a helper's return value, and one read `bin/`, which this guard did
 * not judge until TL-722.
 *
 * THE MARKER. A read that must come from the copy under test, because it
 * executes the module rather than matching its text, carries a line comment
 * beginning `source-read: allow` on the line of the call, with the reason after
 * it. A marker on a line the guard would not report fails as well, so a stale
 * one cannot sit there waiting to excuse the next direct read.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { isolateHome } from "./_repo.mjs";

isolateHome("script-source-reads");

const HERE = dirname(fileURLToPath(import.meta.url));

const REPO = "/repo";
const SOURCE = "/source";
const SCRIPTS = REPO + "/scripts/";
const TESTS = REPO + "/scripts/tests";
const BIN = REPO + "/bin/";

/** Whether `path` names code a mutation run instruments: `scripts/` but not its tests, or `bin/`. */
function isMutatedSource(path) {
  if (path.startsWith(BIN)) return true;
  return path.startsWith(SCRIPTS) && path !== TESTS && !path.startsWith(TESTS + "/");
}
/** One path segment whose value the scan cannot know. */
const WILD = "\u0000";
const UNKNOWN = Symbol("unknown");
const FAIL = Symbol("unparsed");
const MARKER = /^\s*source-read: allow\b/;
/** Beyond this many combinations of alternatives a value is given up on. */
const MAX_ALTERNATIVES = 64;

const REPO_VALUES = {
  SCRIPTS_DIR: REPO + "/scripts",
  REPO_ROOT: REPO,
  BACKLOG_DIR: REPO + "/backlog",
  TASKS_DIR: REPO + "/backlog/tasks",
};
const PATH_FUNCTIONS = new Set(["join", "resolve", "dirname", "basename"]);
const URL_FUNCTIONS = new Set(["fileURLToPath", "pathToFileURL"]);
const REGEX_AFTER_WORD = new Set([
  "return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "instanceof", "yield", "await",
]);
const OPENS = new Map([["(", ")"], ["[", "]"], ["{", "}"]]);
const opens = (t) => Boolean(t) && t.t === "punc" && OPENS.has(t.v);

/**
 * The code tokens and the line comments of a JavaScript source. The code of a
 * `${…}` substitution is lexed into the template token that holds it; the text
 * of a string or a template is a value, never code, so a fixture that spells a
 * call inside quotes is not a call.
 */
function tokenize(src, from = 0, inSubstitution = false) {
  const tokens = [];
  const comments = [];
  let i = from;
  let braces = 0;
  const regexAllowed = () => {
    const p = tokens[tokens.length - 1];
    if (!p) return true;
    if (p.t === "id") return REGEX_AFTER_WORD.has(p.v);
    return p.t === "punc" && p.v !== ")" && p.v !== "]";
  };
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "/" && src[i + 1] === "/") {
      let end = src.indexOf("\n", i);
      if (end < 0) end = src.length;
      comments.push({ pos: i, text: src.slice(i + 2, end) });
      i = end;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let value = "";
      while (j < src.length && src[j] !== c && src[j] !== "\n") {
        if (src[j] === "\\") { value += src[j + 1]; j += 2; } else value += src[j++];
      }
      tokens.push({ t: "str", v: value, pos: i });
      i = j + 1;
      continue;
    }
    if (c === "`") {
      const quasis = [];
      const exprs = [];
      let j = i + 1;
      let part = "";
      while (j < src.length && src[j] !== "`") {
        if (src[j] === "\\") { part += src[j + 1]; j += 2; continue; }
        if (src[j] === "$" && src[j + 1] === "{") {
          quasis.push(part);
          part = "";
          const inner = tokenize(src, j + 2, true);
          exprs.push(inner.tokens);
          comments.push(...inner.comments);
          j = inner.end + 1;
          continue;
        }
        part += src[j++];
      }
      quasis.push(part);
      tokens.push({ t: "tpl", quasis, exprs, pos: i });
      i = j + 1;
      continue;
    }
    if (c === "/" && regexAllowed()) {
      // A misjudged division ends at the line break, so it can cost one line
      // of tokens and never the rest of the file.
      let j = i + 1;
      let inClass = false;
      while (j < src.length && src[j] !== "\n" && (inClass || src[j] !== "/")) {
        if (src[j] === "\\") j++;
        else if (src[j] === "[") inClass = true;
        else if (src[j] === "]") inClass = false;
        j++;
      }
      j++;
      while (j < src.length && /[a-z]/i.test(src[j])) j++;
      tokens.push({ t: "re", pos: i });
      i = j;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[\w$]/.test(src[j])) j++;
      tokens.push({ t: "id", v: src.slice(i, j), pos: i });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[\w.]/.test(src[j])) j++;
      tokens.push({ t: "num", pos: i });
      i = j;
      continue;
    }
    if (inSubstitution && c === "{") braces++;
    if (inSubstitution && c === "}") {
      if (braces === 0) return { tokens, comments, end: i };
      braces--;
    }
    tokens.push({ t: "punc", v: c, pos: i });
    i++;
  }
  return { tokens, comments, end: i };
}

const isPunc = (t, v) => Boolean(t) && t.t === "punc" && t.v === v;
const isWord = (t, v) => Boolean(t) && t.t === "id" && t.v === v;
const isDeclaration = (t) => isWord(t, "const") || isWord(t, "let") || isWord(t, "var");

/** `import … from "…"` declarations as `{ from, imported, local }` triples. */
function importsOf(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!isWord(tokens[i], "import") || isPunc(tokens[i - 1], ".")) continue;
    if (isPunc(tokens[i + 1], "(") || isPunc(tokens[i + 1], ".")) continue;
    let j = i + 1;
    while (j < tokens.length && !isWord(tokens[j], "from") && tokens[j].t !== "str") j++;
    if (!isWord(tokens[j], "from") || !tokens[j + 1] || tokens[j + 1].t !== "str") continue;
    const from = tokens[j + 1].v;
    const spec = tokens.slice(i + 1, j);
    let braced = false;
    for (let k = 0; k < spec.length; k++) {
      const s = spec[k];
      if (isPunc(s, "{")) braced = true;
      else if (isPunc(s, "}")) braced = false;
      else if (isPunc(s, "*") && isWord(spec[k + 1], "as") && spec[k + 2]) {
        out.push({ from, imported: "*", local: spec[k + 2].v });
        k += 2;
      } else if (s.t === "id" && isWord(spec[k + 1], "as") && spec[k + 2]) {
        out.push({ from, imported: s.v, local: spec[k + 2].v });
        k += 2;
      } else if (s.t === "id") {
        out.push({ from, imported: braced ? s.v : "default", local: s.v });
      }
    }
  }
  return out;
}

const isObject = (v) => Boolean(v) && typeof v === "object";
const alternativesOf = (v) => (isObject(v) && v.any ? v.any : [v]);

/** One value standing for every known value in `values`; an unknown one adds nothing. */
function oneOf(values) {
  const out = [];
  for (const v of values.flatMap(alternativesOf)) {
    if (v === UNKNOWN || out.some((o) => o === v)) continue;
    out.push(v);
  }
  if (!out.length) return UNKNOWN;
  return out.length === 1 ? out[0] : { any: out };
}

/** `f` applied to every combination of the alternatives its arguments carry. */
function lifted(f, args) {
  let combos = [[]];
  for (const a of args) {
    const next = [];
    for (const c of combos) for (const v of alternativesOf(a)) next.push([...c, v]);
    if (next.length > MAX_ALTERNATIVES) return UNKNOWN;
    combos = next;
  }
  return oneOf(combos.map((c) => f(...c)));
}

/** A path the call would read, or null when the scan cannot know it. */
function toPath(v) {
  const href = typeof v === "string" && v.startsWith("file:") ? v : isObject(v) && v.url ? v.url : null;
  if (href !== null) {
    try { return decodeURIComponent(new URL(href).pathname); } catch { return null; }
  }
  return typeof v === "string" ? posix.resolve(REPO, v) : null;
}

const asText = (v) => (typeof v === "string" ? v : isObject(v) && v.url ? v.url : null);
const pathArgs = (args) => args.map((a) => (typeof a === "string" ? a : WILD));

function callOne(f, args) {
  if (!isObject(f) || !f.fn) return UNKNOWN;
  const [first] = args;
  switch (f.fn) {
    case "join":
      return typeof first === "string" ? posix.join(...pathArgs(args)) : UNKNOWN;
    case "resolve":
      return typeof first === "string" ? posix.resolve(REPO, ...pathArgs(args)) : UNKNOWN;
    case "dirname":
      return typeof first === "string" ? posix.dirname(first) : UNKNOWN;
    case "basename":
      return typeof first === "string" ? posix.basename(first) : UNKNOWN;
    case "sourceRoot":
      return SOURCE;
    case "fileURLToPath":
      return (typeof first === "string" && first.startsWith("file:")) || (isObject(first) && first.url) ? toPath(first) : UNKNOWN;
    case "pathToFileURL":
      return typeof first === "string" && first.startsWith("/") ? { url: "file://" + first } : UNKNOWN;
  }
  return UNKNOWN;
}

function newUrlOne(relative, ...rest) {
  if (typeof relative !== "string") return UNKNOWN;
  const base = rest.length ? asText(rest[0]) : undefined;
  if (base === null) return UNKNOWN;
  try {
    return { url: new URL(relative, base).href };
  } catch {
    return UNKNOWN;
  }
}

function concatOne(left, right) {
  const text = asText(left);
  return text === null ? UNKNOWN : text + (asText(right) ?? WILD);
}

/**
 * Every `readFileSync` call in `src` whose path lands in `scripts/` outside
 * `scripts/tests/`, for a file at `rel` (relative to the repository root).
 *
 * @returns {{ sites: number, resolved: number,
 *   findings: { line: number, path: string, allowed: boolean }[], markers: number[] }}
 */
function directSourceReads(src, rel) {
  const { tokens, comments } = tokenize(src);
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (pos) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= pos) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
  const metaUrl = "file://" + REPO + "/" + rel;

  const known = new Map();
  const readers = new Set(["readFileSync"]);
  for (const { from, imported, local } of importsOf(tokens)) {
    if (/(^|\/)_repo\.mjs$/.test(from)) {
      if (Object.hasOwn(REPO_VALUES, imported)) known.set(local, REPO_VALUES[imported]);
      else if (imported === "sourceRoot") known.set(local, { fn: "sourceRoot" });
    } else if (from === "node:path" || from === "path") {
      if (imported === "*" || imported === "default" || imported === "posix") known.set(local, { ns: true });
      else if (PATH_FUNCTIONS.has(imported)) known.set(local, { fn: imported });
    } else if (from === "node:url" || from === "url") {
      if (URL_FUNCTIONS.has(imported)) known.set(local, { fn: imported });
    } else if ((from === "node:fs" || from === "fs") && imported === "readFileSync") {
      readers.add(local);
    }
  }

  // Bracket pairs, and the `{` each token sits inside (-1 at module level).
  const match = new Array(tokens.length).fill(-1);
  const block = new Array(tokens.length).fill(-1);
  const open = [];
  const braces = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    block[i] = braces.length ? braces[braces.length - 1] : -1;
    if (t.t !== "punc") continue;
    if (OPENS.has(t.v)) {
      open.push(i);
      if (t.v === "{") braces.push(i);
    } else if (")]}".includes(t.v) && open.length && OPENS.get(tokens[open[open.length - 1]].v) === t.v) {
      const o = open.pop();
      match[o] = i;
      match[i] = o;
      if (t.v === "}") braces.pop();
    }
  }
  const END = src.length;
  const posAt = (i) => (i >= 0 && i < tokens.length ? tokens[i].pos : END);
  const blockScope = (i) => (block[i] < 0 ? [0, END] : [tokens[block[i]].pos, posAt(match[block[i]])]);
  /** The last token of the expression or statement starting at `k`. */
  const extentFrom = (k) => {
    if (isPunc(tokens[k], "{")) return match[k] < 0 ? tokens.length - 1 : match[k];
    let j = k;
    while (j < tokens.length) {
      const t = tokens[j];
      if (opens(t)) {
        if (match[j] < 0) return tokens.length - 1;
        j = match[j] + 1;
        continue;
      }
      if (t.t === "punc" && ",;)]}".includes(t.v)) return j - 1;
      j++;
    }
    return tokens.length - 1;
  };

  const bindings = new Map();
  const bind = (name, pos, scope, compute) => {
    if (!bindings.has(name)) bindings.set(name, []);
    bindings.get(name).push({ pos, scope, compute });
  };
  const calls = new Map();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.t === "id" && isPunc(tokens[i + 1], "(") && !isPunc(tokens[i - 1], ".") && !isWord(tokens[i - 1], "function")) {
      if (!calls.has(t.v)) calls.set(t.v, []);
      calls.get(t.v).push(i);
    }
  }

  for (let i = 0; i + 3 < tokens.length; i++) {
    if (!isDeclaration(tokens[i]) || tokens[i + 1].t !== "id") continue;
    if (isPunc(tokens[i + 2], "=") && !isPunc(tokens[i + 3], "=")) {
      const start = i + 3;
      bind(tokens[i + 1].v, tokens[i + 1].pos, blockScope(i), () => evaluate(tokens, start, endsStatement));
    } else if (isWord(tokens[i + 2], "of") && isPunc(tokens[i - 1], "(") && isWord(tokens[i - 2], "for") && match[i - 1] > 0) {
      const head = match[i - 1];
      const start = i + 3;
      const scope = [tokens[i - 1].pos, posAt(extentFrom(head + 1))];
      bind(tokens[i + 1].v, tokens[i + 1].pos, scope, () =>
        oneOf(alternativesOf(evaluate(tokens, start, (p) => p.i === head)).flatMap((v) => (isObject(v) && v.arr ? v.arr : []))));
    }
  }

  // A function's name, when it is declared with one or assigned to one.
  const nameBefore = (k) => {
    if (isWord(tokens[k - 1], "async")) k--;
    return isPunc(tokens[k - 1], "=") && tokens[k - 2] && tokens[k - 2].t === "id" && isDeclaration(tokens[k - 3]) ? tokens[k - 2].v : null;
  };
  const bindParameters = (name, from, to, bodyStart, bodyEnd) => {
    const scope = [tokens[bodyStart].pos, posAt(bodyEnd) + 1];
    let index = 0;
    let s = from;
    while (s <= to) {
      let e = s;
      while (e <= to && !isPunc(tokens[e], ",")) e = opens(tokens[e]) && match[e] > 0 ? match[e] + 1 : e + 1;
      const t = tokens[s];
      if (t.t === "id" && (e === s + 1 || isPunc(tokens[s + 1], "="))) {
        const position = index;
        const fallback = isPunc(tokens[s + 1], "=") ? s + 2 : -1;
        bind(t.v, t.pos, scope, () => {
          const values = fallback < 0 ? [] : [evaluate(tokens, fallback, endsArgument)];
          for (const at of (name && calls.get(name)) || []) {
            try {
              values.push(argList({ toks: tokens, i: at + 1 })[position] ?? UNKNOWN);
            } catch (err) {
              if (err !== FAIL) throw err;
            }
          }
          return oneOf(values);
        });
      }
      index++;
      s = e + 1;
    }
  };
  for (let i = 0; i < tokens.length; i++) {
    if (isWord(tokens[i], "function")) {
      let j = i + 1;
      if (isPunc(tokens[j], "*")) j++;
      let name = null;
      if (tokens[j] && tokens[j].t === "id" && isPunc(tokens[j + 1], "(")) name = tokens[j++].v;
      if (!isPunc(tokens[j], "(") || match[j] < 0 || !isPunc(tokens[match[j] + 1], "{")) continue;
      const body = match[j] + 1;
      bindParameters(name || nameBefore(i), j + 1, match[j] - 1, body, match[body]);
    } else if (isPunc(tokens[i], "=") && isPunc(tokens[i + 1], ">") && tokens[i + 1].pos === tokens[i].pos + 1 && tokens[i + 2]) {
      const body = i + 2;
      const end = extentFrom(body);
      if (isPunc(tokens[i - 1], ")") && match[i - 1] >= 0) {
        bindParameters(nameBefore(match[i - 1]), match[i - 1] + 1, i - 2, body, end);
      } else if (tokens[i - 1] && tokens[i - 1].t === "id") {
        bindParameters(nameBefore(i - 1), i - 1, i - 1, body, end);
      }
    }
  }

  const cache = new Map();
  const active = new Set();
  const endsStatement = (p) => {
    const t = p.toks[p.i];
    return !t || t.t === "id" || (t.t === "punc" && ";,)]}:".includes(t.v));
  };
  const endsArgument = (p) => isPunc(p.toks[p.i], ",") || isPunc(p.toks[p.i], ")");
  const endsTokens = (p) => p.i === p.toks.length;

  function evaluate(toks, start, isEnd) {
    const p = { toks, i: start };
    try {
      const v = expr(p);
      return isEnd(p) ? v : UNKNOWN;
    } catch (e) {
      if (e === FAIL) return UNKNOWN;
      throw e;
    }
  }

  // The innermost binding in scope at `pos`; within one scope, the last one
  // declared before it. An assignment after the declaration is not followed.
  function lookup(name, pos) {
    const visible = (bindings.get(name) || []).filter((b) => b.scope[0] <= pos && pos <= b.scope[1]);
    if (!visible.length) return known.has(name) ? known.get(name) : UNKNOWN;
    const inner = Math.max(...visible.map((b) => b.scope[0]));
    const candidates = visible.filter((b) => b.scope[0] === inner);
    let pick = candidates[0];
    for (const b of candidates) if (b.pos < pos) pick = b;
    if (cache.has(pick)) return cache.get(pick);
    if (active.has(pick)) return UNKNOWN;
    active.add(pick);
    const v = pick.compute();
    active.delete(pick);
    cache.set(pick, v);
    return v;
  }

  function expr(p) {
    let v = postfix(p);
    while (isPunc(p.toks[p.i], "+")) {
      p.i++;
      v = lifted(concatOne, [v, postfix(p)]);
    }
    return v;
  }

  function postfix(p) {
    let v = primary(p);
    for (;;) {
      if (isPunc(p.toks[p.i], ".")) {
        const name = p.toks[p.i + 1];
        if (!name || name.t !== "id") throw FAIL;
        p.i += 2;
        v = lifted((one) => member(one, name.v), [v]);
      } else if (isPunc(p.toks[p.i], "(")) {
        const args = argList(p);
        v = lifted((f, ...rest) => callOne(f, rest), [v, ...args]);
      } else {
        return v;
      }
    }
  }

  function primary(p) {
    const t = p.toks[p.i++];
    if (!t) throw FAIL;
    if (t.t === "str") return t.v;
    if (t.t === "num") return UNKNOWN;
    if (t.t === "tpl") return template(t);
    if (isPunc(t, "(")) {
      const v = expr(p);
      if (!isPunc(p.toks[p.i++], ")")) throw FAIL;
      return v;
    }
    if (isPunc(t, "[")) {
      p.i--;
      return { arr: argList(p, "[", "]") };
    }
    if (t.t !== "id") throw FAIL;
    if (t.v === "new") {
      if (!isWord(p.toks[p.i++], "URL")) throw FAIL;
      return lifted(newUrlOne, argList(p));
    }
    if (t.v === "import") {
      if (!isPunc(p.toks[p.i], ".") || !isWord(p.toks[p.i + 1], "meta")) throw FAIL;
      p.i += 2;
      return { meta: true };
    }
    return lookup(t.v, t.pos);
  }

  function argList(p, opener = "(", closer = ")") {
    if (!isPunc(p.toks[p.i], opener)) throw FAIL;
    p.i++;
    const args = [];
    while (!isPunc(p.toks[p.i], closer)) {
      if (p.i >= p.toks.length) throw FAIL;
      const start = p.i;
      let v;
      try {
        v = expr(p);
        if (!isPunc(p.toks[p.i], ",") && !isPunc(p.toks[p.i], closer)) throw FAIL;
      } catch (e) {
        if (e !== FAIL) throw e;
        p.i = start;
        skipArgument(p);
        v = UNKNOWN;
      }
      args.push(v);
      if (isPunc(p.toks[p.i], ",")) p.i++;
    }
    p.i++;
    return args;
  }

  function skipArgument(p) {
    let depth = 0;
    for (; p.i < p.toks.length; p.i++) {
      const t = p.toks[p.i];
      if (t.t !== "punc") continue;
      if (OPENS.has(t.v)) depth++;
      else if (")]}".includes(t.v)) {
        if (depth === 0) return;
        depth--;
      } else if (t.v === "," && depth === 0) return;
    }
  }

  function member(v, name) {
    if (isObject(v)) {
      if (v.meta) {
        const path = toPath(metaUrl);
        if (name === "url") return metaUrl;
        if (name === "filename") return path;
        if (name === "dirname") return posix.dirname(path);
      }
      if (v.ns) {
        if (PATH_FUNCTIONS.has(name)) return { fn: name };
        if (name === "posix") return v;
      }
      if (v.url && name === "href") return v.url;
      if (v.url && name === "pathname") return new URL(v.url).pathname;
    }
    return UNKNOWN;
  }

  function template(t) {
    const parts = t.exprs.map((e) => evaluate(e, 0, endsTokens));
    return lifted((...values) => {
      let text = t.quasis[0];
      for (let k = 0; k < values.length; k++) {
        const part = asText(values[k]);
        if (part === null && text === "") return UNKNOWN;
        text += (part ?? WILD) + t.quasis[k + 1];
      }
      return text;
    }, parts);
  }

  let sites = 0;
  let resolved = 0;
  const found = [];
  const scan = (toks) => {
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.t === "tpl") { t.exprs.forEach(scan); continue; }
      if (t.t !== "id" || !readers.has(t.v) || !isPunc(toks[i + 1], "(")) continue;
      if (isWord(toks[i - 1], "function")) continue;
      if (t.v !== "readFileSync" && isPunc(toks[i - 1], ".")) continue;
      sites++;
      let first;
      try {
        [first] = argList({ toks, i: i + 1 });
      } catch (e) {
        if (e !== FAIL) throw e;
        first = UNKNOWN;
      }
      const paths = alternativesOf(first).map(toPath).filter((path) => path !== null);
      if (!paths.length) continue;
      resolved++;
      for (const path of new Set(paths)) {
        if (!isMutatedSource(path)) continue;
        found.push({ line: lineOf(t.pos), path: path.slice(REPO.length + 1).split(WILD).join("*") });
      }
    }
  };
  scan(tokens);

  const markers = comments.filter((c) => MARKER.test(c.text)).map((c) => lineOf(c.pos));
  const findings = found.map((f) => ({ ...f, allowed: markers.includes(f.line) }));
  return { sites, resolved, findings, markers };
}

/** Every `.mjs` file under `dir`, relative to it, subdirectories included. */
function modulesUnder(dir, rel = "") {
  const out = [];
  for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const path = rel ? rel + "/" + entry.name : entry.name;
    if (entry.isDirectory()) out.push(...modulesUnder(dir, path));
    else if (entry.isFile() && entry.name.endsWith(".mjs")) out.push(path);
  }
  return out.sort();
}

// The fixtures name a module that does not exist, so that this file names no
// real one and a mutation run never selects it for one.
const PRELUDE = [
  'import { readFileSync } from "node:fs";',
  'import { dirname, join } from "node:path";',
  'import { fileURLToPath } from "node:url";',
  'import { REPO_ROOT, SCRIPTS_DIR, scriptSource, sourceRoot } from "./_repo.mjs";',
  "const HERE = dirname(fileURLToPath(import.meta.url));",
  "",
].join("\n");

const reported = (body, at = "scripts/tests/fixture.test.mjs", prelude = PRELUDE) =>
  directSourceReads(prelude + body, at).findings.map((f) => f.path);

test("a direct read of a script's source is reported, whatever shape builds its path", () => {
  const cases = [
    'readFileSync(join(SCRIPTS_DIR, "some-module.mjs"), "utf8");',
    'const SCRIPTS = join(HERE, "..");\nconst text = readFileSync(join(SCRIPTS, "some-module.mjs"), "utf8");',
    'const SOURCE = join(SCRIPTS_DIR, "some-module.mjs")\nconst text = readFileSync(SOURCE, "utf8")',
    'readFileSync(join(REPO_ROOT, "scripts", "some-module.mjs"), "utf8");',
    'readFileSync(new URL("../some-module.mjs", import.meta.url), "utf8");',
    'readFileSync(fileURLToPath(new URL("../some-module.mjs", import.meta.url)), "utf8");',
    'readFileSync(SCRIPTS_DIR + "/some-module.mjs", "utf8");',
    "readFileSync(`${SCRIPTS_DIR}/some-module.mjs`, \"utf8\");",
    'readFileSync(join(import.meta.dirname, "..", "some-module.mjs"), "utf8");',
    'test("x", () => {\n  const text = readFileSync(join(SCRIPTS_DIR, "some-module.mjs"), "utf8");\n});',
    'const re = /["\'`]\\/x/g;\nreadFileSync(join(SCRIPTS_DIR, "some-module.mjs"), "utf8");',
    'function read(rel) { return readFileSync(join(REPO_ROOT, rel), "utf8"); }\nread("scripts/some-module.mjs");',
    'const read = (name) => readFileSync(join(SCRIPTS_DIR, name), "utf8");\nread("some-module.mjs");',
    'function audit(root = REPO_ROOT) {\n  return readFileSync(join(root, "scripts", "some-module.mjs"), "utf8");\n}',
    'const roots = [SCRIPTS_DIR, join(REPO_ROOT, "docs")];\nfor (const root of roots) readFileSync(join(root, "some-module.mjs"), "utf8");',
    'for (const file of ["scripts/some-module.mjs"]) {\n  readFileSync(join(REPO_ROOT, file), "utf8");\n}',
  ];
  for (const body of cases) assert.deepEqual(reported(body), ["scripts/some-module.mjs"], body);

  assert.deepEqual(reported('const source = (name) => readFileSync(join(SCRIPTS_DIR, name), "utf8");'), ["scripts/*"],
    "a module named by a parameter nothing passes is still a read of scripts/");
  assert.deepEqual(
    reported('readFileSync(join(HERE, "..", "..", "some-module.mjs"), "utf8");', "scripts/tests/nested/x.test.mjs"),
    ["scripts/some-module.mjs"], "a nested test reaches scripts/ through one more ..");
  for (const body of [
    'readFileSync(join(REPO_ROOT, "bin", "some-entry.mjs"), "utf8");',
    'readFileSync(join(SCRIPTS_DIR, "..", "bin", "some-entry.mjs"), "utf8");',
    'readFileSync(new URL("../../bin/some-entry.mjs", import.meta.url), "utf8");',
  ]) assert.deepEqual(reported(body), ["bin/some-entry.mjs"], "bin/ is mutated as well (TL-722): " + body);

  const aliased = 'import { readFileSync as read } from "node:fs";\nimport { SCRIPTS_DIR as S } from "./_repo.mjs";\n' +
    'import * as path from "node:path";\nread(path.join(S, "some-module.mjs"), "utf8");';
  assert.deepEqual(reported(aliased, undefined, ""), ["scripts/some-module.mjs"], "renamed imports are followed");
  const namespace = 'import fs from "node:fs";\nimport { SCRIPTS_DIR } from "./_repo.mjs";\nimport { join } from "node:path";\n' +
    'fs.readFileSync(join(SCRIPTS_DIR, "some-module.mjs"), "utf8");';
  assert.deepEqual(reported(namespace, undefined, ""), ["scripts/some-module.mjs"], "fs.readFileSync is a read too");
});

test("a read through scriptSource, sourceRoot or of anything outside scripts/ is not reported", () => {
  const cases = [
    'scriptSource("some-module.mjs");',
    'readFileSync(join(sourceRoot(), "scripts", "some-module.mjs"), "utf8");',
    'readFileSync(join(sourceRoot(), "bin", "some-entry.mjs"), "utf8");',
    'readFileSync(join(REPO_ROOT, "binaries", "notes.md"), "utf8");',
    'const sources = join(sourceRoot(), "scripts");\nfor (const f of names) readFileSync(join(sources, f), "utf8");',
    'readFileSync(join(SCRIPTS_DIR, "..", "_template.md"), "utf8");',
    'readFileSync(join(REPO_ROOT, "docs", "guide.md"), "utf8");',
    'readFileSync(join(HERE, "fixtures", "data.json"), "utf8");',
    'readFileSync(join(SCRIPTS_DIR, "tests", "fixtures", "data.json"), "utf8");',
    'readFileSync(fileURLToPath(import.meta.url), "utf8");',
    'readFileSync(join(dir, "backlog", "config.yaml"), "utf8");',
    'readFileSync(0, "utf8");',
    'const fixture = \'readFileSync(join(SCRIPTS_DIR, "some-module.mjs"), "utf8");\';',
    'const fixture = `readFileSync(join(SCRIPTS_DIR, "some-module.mjs"), "utf8");`;',
    '// readFileSync(join(SCRIPTS_DIR, "some-module.mjs"), "utf8");',
    '/* readFileSync(join(SCRIPTS_DIR, "some-module.mjs"), "utf8"); */',
    'function read(rel) { return readFileSync(join(REPO_ROOT, rel), "utf8"); }\nread("docs/guide.md");',
    'const root = SCRIPTS_DIR;\nfunction read(root) { return readFileSync(join(root, "x.json"), "utf8"); }\nread(sourceRoot());',
    'const file = join(SCRIPTS_DIR, "some-module.mjs");\nfunction other() { const file = join(REPO_ROOT, "README.md"); return readFileSync(file, "utf8"); }',
  ];
  for (const body of cases) assert.deepEqual(reported(body), [], body);
  assert.deepEqual(reported('readFileSync(join(HERE, "..", "some-module.mjs"), "utf8");', "scripts/tests/nested/x.test.mjs"), [],
    "from a nested test, one .. is still scripts/tests/");
});

test("the marker excuses the one line it is on, and only as a line comment", () => {
  const read = 'readFileSync(join(SCRIPTS_DIR, "some-module.mjs"), "utf8");';
  const at = PRELUDE.split("\n").length;
  const marked = directSourceReads(PRELUDE + read + " // source-read: allow — executes the module\n", "scripts/tests/x.test.mjs");
  assert.deepEqual(marked.findings, [{ line: at, path: "scripts/some-module.mjs", allowed: true }]);
  assert.deepEqual(marked.markers, [at]);

  const above = directSourceReads(PRELUDE + "// source-read: allow\n" + read + "\n", "scripts/tests/x.test.mjs");
  assert.deepEqual(above.findings.map((f) => f.allowed), [false], "a marker on the line above excuses nothing");
  const inBlock = directSourceReads(PRELUDE + read + " /* source-read: allow */\n", "scripts/tests/x.test.mjs");
  assert.deepEqual(inBlock.findings.map((f) => f.allowed), [false], "a block comment is prose, not a marker");
});

test("no test under scripts/tests/ reads a script's source text except through scriptSource (TL-711)", () => {
  const files = modulesUnder(HERE);
  let sites = 0;
  let resolved = 0;
  const direct = [];
  const stale = [];
  for (const rel of files) {
    const result = directSourceReads(readFileSync(join(HERE, rel), "utf8"), "scripts/tests/" + rel);
    sites += result.sites;
    resolved += result.resolved;
    for (const f of result.findings) if (!f.allowed) direct.push(rel + ":" + f.line + " reads " + f.path);
    const reportedLines = new Set(result.findings.map((f) => f.line));
    for (const line of result.markers) if (!reportedLines.has(line)) stale.push(rel + ":" + line);
  }
  // A scan that resolved nothing would pass on any tree.
  assert.ok(files.includes("_repo.mjs") && files.length > 1, "the scan found no test modules under " + HERE);
  assert.ok(resolved > 0 && resolved <= sites, "no readFileSync path was resolved: " + resolved + " of " + sites);
  assert.deepEqual(direct, [],
    "a test reads a script's source text from the copy a mutation run instruments.\n" +
    "  Read it with scriptSource(name) from scripts/tests/_repo.mjs, or walk join(sourceRoot(), \"scripts\").\n" +
    "  A read that executes the module rather than matching its text carries `// source-read: allow — <why>` on that line.");
  assert.deepEqual(stale, [], "a source-read marker sits on a line that reads no script; remove it");
});
