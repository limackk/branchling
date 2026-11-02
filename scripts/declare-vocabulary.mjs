#!/usr/bin/env node
/**
 * `declare` — adding one entry to `releases:` or `deploy_targets:` in
 * config.yaml (TL-522).
 *
 * WHAT WAS MISSING. Both vocabularies are read by `new`, `query`, `deploy
 * status` and `check --release`, and nothing wrote them except `init`, which
 * writes the first file. An interface built on the CLI contract could plan a
 * task for a release and could not create the release.
 *
 * THE DECISION: TWO KEYS, AND ONLY APPENDING. The third law says the code knows
 * the SHAPE of a field and config.yaml knows the VALUES; it does not say only a
 * text editor may write a value. What separates these two keys from the rest of
 * the file is that adding to them is an act in the project's life rather than a
 * decision about its vocabulary: a release is planned, a deployable appears, and
 * both happen many times over a project's lifetime. Every other key — the
 * statuses, the priorities, the boards, the policies — is the project's
 * grammar, changed rarely and deliberately, and a change to it reshapes every
 * task already written in it. A general editor would make that grammar as cheap
 * to change as a release is to plan, and a renamed status is not an append: it
 * strands the tasks still carrying the old word. So:
 *
 *   - the keys are `WRITABLE_KEYS` and nothing else; any other key is refused
 *     BY NAME, saying it stays a hand edit;
 *   - the only operation is appending one new entry. Renaming, removing and
 *     reordering are not offered: the order of `releases:` is chronological and
 *     a release is the CURRENT one by its position (TL-515), so moving an entry
 *     changes which release blocks the last stage — a hand edit somebody reviews.
 *     Marking a release shipped (`{name, ref}`) on an existing entry is the same
 *     kind of change and stays a hand edit; `--ref` is accepted only for a
 *     release declared already shipped;
 *   - a deploy target is written in the two shapes a command line can carry
 *     whole: in another repository (`--repository`), or observed here
 *     (`--stage`, with `--paths` unless the whole repository is the target). A stage marked `recorded: true` is not offered
 *     — it is the shape whose refs the tool itself writes, and `deploy record`
 *     depends on every rule of `scripts/deploy-targets.mjs` holding for it; a
 *     person declares that one by hand, where the rules are read beside it.
 *
 * WHY THE TEXT AND NOT THE PARSE — the reasoning of `plan-write.mjs`. Parsing
 * config.yaml and writing it back would delete every comment, and the comments
 * in this file are the argument for each value. So this module edits LINES,
 * leaves the form a list was written in alone, and refuses a form it cannot
 * edit safely (a multi-line flow list, a scalar) instead of normalising it.
 *
 * WHY THE PARSE IS STILL THE AUTHORITY. The result is parsed again by the same
 * reader `loadConfig` uses, and refused unless every other key reads exactly as
 * it did and the edited key reads as before plus the one new entry. In the
 * command the whole configuration is then loaded strictly from the written
 * file, and the original bytes are restored if that fails. Refusal is total.
 *
 * WHERE THE REASON GOES. `--reason` is required and is written as a comment
 * directly above the new entry. `backlog/history/` is keyed by a task, and a
 * release is not a task — TL-213 settled the same question for `plan.yaml`: the
 * record of a configuration change is the diff of this one file, with the
 * sentence the writer preserves in it.
 *
 * Tests: `node --test scripts/tests/release-vocabulary-write.test.mjs`
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { ConfigError, loadConfig, parseConfigYaml } from "./config.mjs";
import { NAME_SHAPE, REPOSITORY_SHAPE, isGlob } from "./deploy-targets.mjs";
import { printJson } from "./json-envelope.mjs";
import { backlogPaths, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { RELEASE_SHAPE, normalizeReason, reasonRefusal, stripComment } from "./task-fields.mjs";
import { MARK, color, failure, refusal } from "./ui.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The keys a command may append to. Everything else in config.yaml is the
 *  project's grammar and stays a hand edit — see the header. */
export const WRITABLE_KEYS = Object.freeze(["releases", "deploy_targets"]);

const VALUE_FLAGS = ["--reason", "--ref", "--repository", "--paths", "--stage"];
const FLAGS = VALUE_FLAGS.concat(["--json"]);

/** A scalar written plain when the reader would read it back unchanged, and in
 *  double quotes otherwise. A value no quoting carries is refused upstream. */
function scalar(v) {
  return /^[A-Za-z0-9._/@+*-]+$/.test(v) ? v : JSON.stringify(v);
}

function flowList(values) {
  return "[" + values.map(scalar).join(", ") + "]";
}

/** A value this writer can put on one YAML line and read back verbatim. */
function writable(v) {
  return typeof v === "string" && v.trim() === v && v !== "" && !/[\n\r"\\]/.test(v);
}

/**
 * PURE — the entry the flags describe, validated, or the refusal.
 *
 * @param {{key: string, name: string, ref?: string|null, repository?: string|null,
 *          paths?: string[]|null, stages?: {name: string, refs: string[]}[]}} spec
 * @returns {{ok: true, entry: object} | {ok: false, message: string, details: string[]}}
 */
export function buildEntry(spec) {
  const no = (message, details = []) => ({ ok: false, message, details });
  const { key, name } = spec;
  if (key === "releases") {
    for (const f of ["repository", "paths", "stages"]) {
      if (spec[f] && (!Array.isArray(spec[f]) || spec[f].length)) {
        return no("`--" + (f === "stages" ? "stage" : f) + "` describes a deploy target, not a release");
      }
    }
    if (!RELEASE_SHAPE.test(name)) {
      return no("`" + name + "` is not a release name", [
        "expecting a lowercase slug: a letter or digit, then letters/digits/`.`/`_`/`-`",
      ]);
    }
    if (spec.ref === null || spec.ref === undefined) return { ok: true, entry: { name, ref: null } };
    if (!writable(spec.ref) || /\s/.test(spec.ref)) return no("`--ref` must be one ref name or tag");
    if (isGlob(spec.ref)) {
      return no("`--ref " + spec.ref + "` is a pattern — a release ends at one point, so name one ref or tag");
    }
    return { ok: true, entry: { name, ref: spec.ref } };
  }

  // deploy_targets
  if (spec.ref !== null && spec.ref !== undefined) {
    return no("`--ref` marks a shipped release; a stage's ref is written `--stage <name>=<ref>`");
  }
  if (!NAME_SHAPE.test(name)) {
    return no("`" + name + "` is not a deploy target name", ["expecting a letter or digit, then letters/digits/`.`/`_`/`-`"]);
  }
  const paths = spec.paths || [];
  const stages = spec.stages || [];
  if (spec.repository !== null && spec.repository !== undefined) {
    if (paths.length || stages.length) {
      return no("a target in another repository takes neither `--paths` nor `--stage`", [
        "both are read against THIS repository's git: a path would assign this repository's",
        "commits to the other one, and a stage ref would be resolved in the wrong repository",
      ]);
    }
    if (!REPOSITORY_SHAPE.test(spec.repository)) {
      return no("`--repository " + spec.repository + "` is not a repository name", [
        "expecting a letter or digit, then letters/digits/`.`/`_`/`-`",
      ]);
    }
    return { ok: true, entry: { name, repository: spec.repository } };
  }
  if (!stages.length) {
    return no("a deploy target needs `--repository`, or at least one `--stage`", [
      "--repository <name>                          its code lives in another repository",
      "--stage <name>=<ref>[,<ref>] [--paths <p>,…]   it is observed in this repository's git;",
      "                                             without --paths the whole repository is the target",
    ]);
  }
  for (const p of paths) if (!writable(p)) return no("`--paths` carries `" + p + "`, which is not one path or pattern");
  const seen = new Set();
  for (const s of stages) {
    if (!NAME_SHAPE.test(s.name)) return no("`--stage` names `" + s.name + "`, which is not a stage name");
    if (seen.has(s.name)) return no("the stage `" + s.name + "` is given twice");
    seen.add(s.name);
    if (!s.refs.length) return no("the stage `" + s.name + "` names no ref (`--stage " + s.name + "=<ref>`)");
    for (const r of s.refs) if (!writable(r) || /\s/.test(r)) return no("the stage `" + s.name + "` carries `" + r + "`, which is not one ref");
  }
  return { ok: true, entry: { name, paths, stages } };
}

/** The entry as YAML lines at `indent`, the item marker included. */
function renderEntry(key, entry, indent) {
  const pad = " ".repeat(indent);
  if (key === "releases") {
    return [pad + "- " + (entry.ref ? "{ name: " + scalar(entry.name) + ", ref: " + scalar(entry.ref) + " }" : scalar(entry.name))];
  }
  if (entry.repository) return [pad + "- name: " + scalar(entry.name), pad + "  repository: " + scalar(entry.repository)];
  return [
    pad + "- name: " + scalar(entry.name),
    ...(entry.paths.length ? [pad + "  paths: " + flowList(entry.paths)] : []),
    pad + "  stages:",
    ...entry.stages.map((s) =>
      pad + "    - { name: " + scalar(s.name) + ", " +
        (s.refs.length === 1 ? "ref: " + scalar(s.refs[0]) : "refs: " + flowList(s.refs)) + " }"),
  ];
}

/** The same entry as one flow item, for a list written `[a, b]`. */
function flowEntry(entry) {
  return entry.ref ? "{ name: " + scalar(entry.name) + ", ref: " + scalar(entry.ref) + " }" : scalar(entry.name);
}

function names(key, values) {
  return (values[key] || []).map((e) => (typeof e === "string" ? e : e.name));
}

/** What the reader makes of one key, as a comparable string. */
function readBack(key, values) {
  if (key === "deploy_targets") {
    return JSON.stringify((values[key] || []).map((t) => ({
      name: t.name, repository: t.repository || null, paths: t.paths || [],
      stages: (t.stages || []).map((s) => ({ name: s.name, refs: s.refs || (s.ref ? [s.ref] : []) })),
    })));
  }
  return JSON.stringify(values[key] === undefined ? null : values[key]);
}

/**
 * PURE — config.yaml with one entry appended to `key`, or the refusal. Nothing
 * else in the text changes.
 *
 * @returns {{ok: true, text: string} | {ok: false, kind: string, message: string, details: string[]}}
 */
export function appendEntryText(text, key, entry, reason) {
  const no = (kind, message, details = []) => ({ ok: false, kind, message, details });
  const before = parseConfigYaml(text);
  if (before.problems.length) {
    return no("unreadable", "config.yaml cannot be read, so it cannot be edited safely", before.problems);
  }
  if (names(key, before.values).indexOf(entry.name) >= 0) {
    return no("duplicate", "`" + entry.name + "` is already declared in `" + key + "`", [
      "an entry is added once; changing one that exists is a hand edit of config.yaml",
    ]);
  }

  const eol = /\r\n/.test(text) ? "\r\n" : "\n";
  const lines = String(text).split(/\r?\n/);
  const at = lines.findIndex((l) => new RegExp("^" + key + ":(\\s|$)").test(stripComment(l)));
  let out;

  if (at < 0) {
    // Absent: a block of its own at the end, the newest thing in the file.
    const body = lines.slice();
    while (body.length && body[body.length - 1] === "") body.pop();
    out = body.concat(body.length ? [""] : [], [key + ":", "  # " + reason], renderEntry(key, entry, 2), [""]);
  } else {
    const head = stripComment(lines[at]);
    const comment = lines[at].slice(head.length);
    const inline = head.slice(key.length + 1).trim();
    let end = at + 1;
    for (; end < lines.length; end++) {
      const s = stripComment(lines[end]);
      if (s.trim() && !/^\s/.test(s)) break;
    }
    const hasBody = lines.slice(at + 1, end).some((l) => stripComment(l).trim());

    if (inline === "" || (inline === "[]" && !hasBody)) {
      // A block list (or an empty one): the new item after the last item line,
      // at the indentation the list already uses.
      let last = at;
      let indent = 2;
      let indentSeen = false;
      for (let k = at + 1; k < end; k++) {
        const s = stripComment(lines[k]);
        if (!s.trim()) continue;
        last = k;
        if (!indentSeen && /^\s+-(\s|$)/.test(s)) { indent = s.match(/^\s*/)[0].length; indentSeen = true; }
      }
      const keyLine = inline === "[]" ? key + ":" + comment : lines[at];
      out = lines.slice(0, at).concat(
        [keyLine], lines.slice(at + 1, last + 1),
        [" ".repeat(indent) + "# " + reason], renderEntry(key, entry, indent),
        lines.slice(last + 1),
      );
    } else if (key === "releases" && inline.startsWith("[") && inline.endsWith("]") && !hasBody) {
      // A one-line flow list keeps its form; the sentence goes above the key,
      // naming the entry it explains, because a flow item has no line of its own.
      const items = inline.slice(1, -1).trim();
      const newHead = key + ": [" + (items ? items + ", " : "") + flowEntry(entry) + "]";
      out = lines.slice(0, at).concat(["# " + entry.name + ": " + reason, newHead + comment], lines.slice(at + 1));
    } else {
      return no("form", "`" + key + "` is written in a form this command does not edit", [
        "line " + (at + 1) + ": " + lines[at].trim(),
        "it edits a block list (`- item` lines) and, for releases, a one-line `[a, b]`;",
        "rewriting any other form would change lines nobody asked it to touch — edit it by hand",
      ]);
    }
  }

  const next = out.join(eol);
  const after = parseConfigYaml(next);
  if (after.problems.length) return no("invalid", "the entry would make config.yaml unreadable", after.problems);
  const keys = new Set(Object.keys(before.values).concat(Object.keys(after.values)));
  for (const k of keys) {
    if (k === key) continue;
    if (readBack(k, before.values) !== readBack(k, after.values)) {
      return no("disturbed", "the edit would change `" + k + "` as well, so nothing was written");
    }
  }
  const expected = {};
  if (key === "releases") {
    expected.releases = (before.values.releases || []).concat([{ name: entry.name, ref: entry.ref || null }]);
  } else {
    expected.deploy_targets = (before.values.deploy_targets || []).concat([{
      name: entry.name, repository: entry.repository || null, paths: entry.paths || [],
      stages: (entry.stages || []).map((s) => ({ name: s.name, refs: s.refs })),
    }]);
  }
  if (readBack(key, expected) !== readBack(key, after.values)) {
    return no("disturbed", "the edit would not read back as the one entry it adds, so nothing was written");
  }
  return { ok: true, text: next };
}

/** Flags into a spec, or a usage error. */
export function parseDeclareArgs(argv) {
  const avail = FLAGS.join(" ") + " --dir <path>";
  const opts = { positionals: [], reason: null, ref: null, repository: null, paths: null, stages: [], json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") { opts.json = true; continue; }
    if (VALUE_FLAGS.indexOf(a) >= 0) {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error("`" + a + "` with no value\n" + avail);
      if (a === "--stage") {
        const m = v.match(/^([^=]+)=(.*)$/);
        if (!m) throw new Error("`--stage " + v + "` — expecting <name>=<ref>[,<ref>]\n" + avail);
        opts.stages.push({ name: m[1].trim(), refs: m[2].split(",").map((s) => s.trim()).filter(Boolean) });
      } else if (a === "--paths") {
        opts.paths = v.split(",").map((s) => s.trim()).filter(Boolean);
      } else {
        opts[a.slice(2)] = v;
      }
      continue;
    }
    if (a.startsWith("-")) throw new Error("unknown flag: " + a + "\n" + avail);
    opts.positionals.push(a);
  }
  return opts;
}

export function run(argv) {
  const cmd = N + " declare";
  const dirFlag = takeDirFlag(argv);
  const wantsJson = dirFlag.argv.includes("--json");
  const refuse = (message, details, code, kind, extra = {}) => {
    if (wantsJson) printJson("vocabulary-declare", { ok: false, ...extra, refusalKind: kind, refusal: message, details });
    else console.error(failure(cmd, message, details, [cmd + " --help"]));
    return code;
  };
  let opts;
  try { opts = parseDeclareArgs(dirFlag.argv); }
  catch (e) {
    const [head, avail] = e.message.split("\n");
    if (wantsJson) return refuse(head, ["available: " + avail], 2, "usage");
    console.error(refusal(cmd, head, avail));
    return 2;
  }
  const [key, name, ...extra] = opts.positionals;
  if (!key) return refuse("no key — which vocabulary gets the entry?", ["writable: " + WRITABLE_KEYS.join(", ")], 2, "usage");
  if (WRITABLE_KEYS.indexOf(key) < 0) {
    return refuse("`" + key + "` is not written by a command", [
      "writable: " + WRITABLE_KEYS.join(", "),
      "every other key in config.yaml is the project's grammar: changing it reshapes the",
      "tasks already written in it, so it stays a hand edit somebody reviews",
    ], 2, "undeclared-key", { key });
  }
  if (!name) return refuse("no name for the new entry of `" + key + "`", [], 2, "usage", { key });
  if (extra.length) return refuse("unexpected argument: " + extra[0] + " — one entry per call", [], 2, "usage", { key, name });

  const why = reasonRefusal(opts.reason === null ? "" : opts.reason, "--reason");
  if (why) {
    const [head, ...rest] = why.split("\n");
    return refuse(head, rest, 2, "usage", { key, name });
  }
  const reason = normalizeReason(opts.reason);

  const built = buildEntry({ key, name, ref: opts.ref, repository: opts.repository, paths: opts.paths, stages: opts.stages });
  if (!built.ok) return refuse(built.message, built.details, 2, "malformed", { key, name, reason });

  let root;
  try { root = resolveBacklogDir({ dir: dirFlag.dir || undefined, moduleDir: HERE }).root; }
  catch (e) { return refuse(e.message, [], 2, "usage", { key, name, reason }); }
  const file = backlogPaths(root).configPath;
  const original = existsSync(file) ? readFileSync(file, "utf8") : "";

  const edit = appendEntryText(original, key, built.entry, reason);
  if (!edit.ok) return refuse(edit.message, edit.details, 1, edit.kind, { key, name, reason, file });

  writeFileSync(file, edit.text, "utf8");
  // The whole configuration, strictly, from the bytes on disk: a check between
  // vocabularies the line reader does not make must not be discovered by the
  // next command instead.
  try {
    loadConfig(root);
  } catch (e) {
    if (original === "" && !existsSync(file)) throw e;
    writeFileSync(file, original, "utf8");
    if (!(e instanceof ConfigError)) throw e;
    return refuse("the entry would make the configuration inconsistent, so nothing was written",
      (e.problems || [e.message]).slice(), 1, "invalid", { key, name, reason, file });
  }

  if (wantsJson) {
    printJson("vocabulary-declare", { ok: true, key, name, entry: built.entry, reason, file });
    return 0;
  }
  console.log(color.ok(MARK.ok) + " " + key + ": `" + name + "` declared");
  console.log("  reason: " + reason);
  console.log("  " + file + " — the change is the diff of this one file; the comments are kept");
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("declare-vocabulary.mjs")) {
  process.exitCode = run(process.argv.slice(2));
}
