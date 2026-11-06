/**
 * A refused actor names the part that is wrong (TL-590).
 *
 * WHAT IS AT RISK. Every writing command used to answer any actor that failed
 * the shape check with "has no valid namespace", copied by hand into each of
 * them. An agent actor carrying uppercase letters in its name was refused that
 * way although its `agent:` namespace was right, and the hint listed the three
 * namespaces — so the caller's first retry changed the half that was fine.
 *
 * Three layers are asked:
 *   1. `actorRefusal()` itself, one case per cause, each with its own message;
 *   2. every writing command, end to end through the CLI, under a right
 *      namespace with a wrong name AND under a missing namespace — the second
 *      run is the positive control proving that the argument vector reaches the
 *      actor check at all, so the absence of "namespace" in the first is not
 *      the absence of any actor refusal;
 *   3. the sources: the old sentence lives in one module, not in a copy.
 *
 * Every fixture is its own throwaway backlog; no value of this repository's
 * configuration is asserted.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HOME_ENV } from "../home.mjs";
import {
  ACTOR_CAUSE_EMPTY_NAME, ACTOR_CAUSE_LONG_NAME, ACTOR_CAUSE_NAME_CHARACTERS, ACTOR_CAUSE_NAME_START,
  ACTOR_CAUSE_NO_NAMESPACE, ACTOR_CAUSE_UNKNOWN_NAMESPACE, actorRefusal,
} from "../task-fields.mjs";
import { actorRefusal as actorRefusalFromHistory } from "../history.mjs";
import { loadConfig, validateConfig } from "../config.mjs";
import { parseImportArgs } from "../import-github.mjs";
import { parseSeedArgs } from "../seed-backlog.mjs";
import { isolateHome, REPO_ROOT, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("actor-shape-diagnosis");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const UPPERCASE = "agent:impl-TL-584"; // renumber: allow
const NO_NAMESPACE = "nobody";
const UNKNOWN_NAMESPACE = "robot:r2d2";

const TEMP = [];
test.after(() => { for (const d of TEMP) rmSync(d, { recursive: true, force: true }); });

// ── 1. The diagnosis ──────────────────────────────────────────────────────

test("a valid actor and `unknown` are not refused", () => {
  for (const a of ["agent:impl-tl-584", "local:a", "user:abc-123", "agent:a.b_c-d", "unknown"]) {
    assert.equal(actorRefusal(a), null, a);
  }
  assert.equal(actorRefusal("agent:" + "a".repeat(63)), null, "63 characters is the limit, not past it");
});

test("the six causes are six distinct, non-empty values a caller can switch on", () => {
  const causes = [ACTOR_CAUSE_NO_NAMESPACE, ACTOR_CAUSE_UNKNOWN_NAMESPACE, ACTOR_CAUSE_EMPTY_NAME,
    ACTOR_CAUSE_LONG_NAME, ACTOR_CAUSE_NAME_CHARACTERS, ACTOR_CAUSE_NAME_START];
  for (const c of causes) assert.ok(typeof c === "string" && c.length > 0, JSON.stringify(c));
  assert.equal(new Set(causes).size, causes.length);
});

test("history.mjs re-exports the same diagnosis the writers import", () => {
  assert.equal(actorRefusalFromHistory, actorRefusal);
});

test("an uppercase name under a right namespace is refused for the NAME", () => {
  const r = actorRefusal(UPPERCASE);
  assert.equal(r.cause, ACTOR_CAUSE_NAME_CHARACTERS);
  assert.equal(r.namespace, false);
  assert.equal(r.refusal,
    "the actor `" + UPPERCASE + "` has an invalid name — `impl-TL-584` carries `T`, `L`, " + // renumber: allow
    "outside a-z, 0-9, `.`, `_` and `-`");
  assert.doesNotMatch(r.refusal + r.hint, /no valid namespace|Use one of/);
  assert.match(r.hint, /^The namespace `agent:` is right; the name after it is 1 to 63 characters/);
  assert.match(r.hint, /for example `agent:impl-tl-584`$/, "the lowercased name is valid, so it is offered");
});

test("an unknown namespace is refused for the namespace, naming it", () => {
  const r = actorRefusal(UNKNOWN_NAMESPACE);
  assert.equal(r.cause, ACTOR_CAUSE_UNKNOWN_NAMESPACE);
  assert.equal(r.namespace, true);
  assert.equal(r.refusal, "the actor `robot:r2d2` has no valid namespace — `robot` is not one of local, agent, user");
  assert.equal(r.hint, "Use one of: local:<name> | agent:<name> | user:<name>");
});

test("a missing namespace is refused for the namespace, with its own message", () => {
  for (const a of [NO_NAMESPACE, ":nobody", "", undefined, 42]) {
    const r = actorRefusal(a);
    assert.equal(r.cause, ACTOR_CAUSE_NO_NAMESPACE, String(a));
    assert.equal(r.namespace, true);
    assert.equal(r.hint, "Use one of: local:<name> | agent:<name> | user:<name>");
  }
  assert.equal(actorRefusal(NO_NAMESPACE).refusal,
    "the actor `nobody` has no valid namespace — no `<namespace>:` comes before the name");
  assert.equal(actorRefusal(undefined).refusal.indexOf("the actor ``"), 0);
  assert.equal(actorRefusal(42).refusal.indexOf("the actor `42`"), 0);
});

test("the three causes the task names carry three different messages", () => {
  const messages = [UPPERCASE, UNKNOWN_NAMESPACE, NO_NAMESPACE].map((a) => actorRefusal(a).refusal.replace(a, ""));
  assert.equal(new Set(messages).size, 3, messages.join("\n"));
});

test("an empty, a too long and a badly started name each say so", () => {
  const empty = actorRefusal("user:");
  assert.equal(empty.cause, ACTOR_CAUSE_EMPTY_NAME);
  assert.equal(empty.namespace, false);
  assert.equal(empty.refusal, "the actor `user:` has an empty name after `user:`");
  assert.doesNotMatch(empty.hint, /for example/);

  const long = actorRefusal("local:" + "a".repeat(64));
  assert.equal(long.cause, ACTOR_CAUSE_LONG_NAME);
  assert.equal(long.namespace, false);
  assert.match(long.refusal, /has a name of 64 characters, and at most 63 are allowed$/);
  assert.match(long.hint, /^The namespace `local:` is right/);

  // At exactly the limit the length is fine, so the fault is the character.
  const atLimit = actorRefusal("local:A" + "a".repeat(62));
  assert.equal(atLimit.cause, ACTOR_CAUSE_NAME_CHARACTERS);
  assert.match(atLimit.hint, /for example `local:a{63}`$/);

  for (const start of ["-", ".", "_"]) {
    const r = actorRefusal("agent:" + start + "x");
    assert.equal(r.cause, ACTOR_CAUSE_NAME_START, start);
    assert.equal(r.namespace, false);
    assert.equal(r.refusal, "the actor `agent:" + start + "x` has an invalid name — `" + start +
      "x` begins with `" + start + "`, not a letter or digit");
  }
});

test("each character outside the set is named once, and an unrepairable name gets no example", () => {
  const r = actorRefusal("agent:A b:AB");
  assert.equal(r.cause, ACTOR_CAUSE_NAME_CHARACTERS);
  assert.match(r.refusal, /carries `A`, ` `, `:`, `B`, outside/);
  assert.doesNotMatch(r.hint, /for example/, "lowercasing does not repair a space, so nothing is offered");
  assert.doesNotMatch(actorRefusal("agent:-X").hint, /for example/, "lowercased `-x` still starts badly");
});

test("config validation reports a wrong NAME in `actors` as a name, and a namespace as before", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "branchling-actor-shape-config-"));
  TEMP.push(sandbox);
  writeFileSync(join(sandbox, "config.yaml"), "project_name: \"Test\"\n");
  const base = loadConfig(sandbox, { strict: false });
  const problems = validateConfig(Object.assign({}, base, { actors: [UPPERCASE, NO_NAMESPACE, UNKNOWN_NAMESPACE] }));
  const name = problems.find((p) => p.includes(UPPERCASE));
  const ns = problems.find((p) => p.includes("`" + NO_NAMESPACE + "`"));
  const unknown = problems.find((p) => p.includes(UNKNOWN_NAMESPACE));
  assert.ok(name && ns && unknown, problems.join("\n"));
  assert.equal(name, "`actors` contains " + actorRefusal(UPPERCASE).refusal + " — " + actorRefusal(UPPERCASE).hint);
  assert.equal(ns, "`actors` contains `nobody` with no valid namespace — use local:nobody / agent:nobody / user:nobody");
  // The suggestion keeps the name and drops only the wrong namespace.
  assert.equal(unknown, "`actors` contains `robot:r2d2` with no valid namespace — use local:r2d2 / agent:r2d2 / user:r2d2");
});

// ── 2. Every writing command ──────────────────────────────────────────────

function run(cwd, args) {
  const env = { ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: join(cwd, ".state") };
  delete env.BACKLOG_ACTOR;
  env[HOME_ENV] = join(cwd, ".home");
  return spawnSync(process.execPath, [CLI].concat(args), { cwd, encoding: "utf8", timeout: 60_000, env, input: "" });
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-actor-shape-"));
  TEMP.push(dir);
  assert.equal(spawnSync("git", ["init", "-q", "-b", "main", "."], { cwd: dir }).status, 0);
  const init = run(dir, ["init", "--dir", "backlog", "--no-example"]);
  assert.equal(init.status, 0, init.stderr);
  const created = run(dir, ["new", "--dir", "backlog", "--title", "One", "--actor", "local:fixture", "--json"]);
  assert.equal(created.status, 0, created.stderr);
  return { dir, id: JSON.parse(created.stdout).id };
}

/** Each writer, with the arguments it needs to reach its actor check. */
function writers(id) {
  return {
    take: ["take", id],
    next: ["next"],
    handoff: ["handoff", id, "--to-owner", "agent:x", "--reason", "r"],
    body: ["body", id, "--reason", "r"],
    release: ["release", id, "--reason", "r"],
    set: ["set", id, "priority", "P1"],
    resume: ["resume", id],
    decide: ["decide", id, "--reason", "r"],
    ask: ["ask", id, "--question", "q"],
    done: ["done", id],
    new: ["new", "--title", "Two"],
    seed: ["seed", "--from", "x"],
    import: ["import", "--from", "github"],
    run: ["run"],
    history: ["history"],
    "migrate-prefix": ["migrate-prefix", "--to", "XX"],
    renumber: ["renumber"],
    "deploy record": ["deploy", "record", "HEAD", "--target", "t", "--stage", "s", "--reason", "r"],
  };
}

/**
 * The writers whose namespace refusal also explains what a namespace is worth,
 * with the two lines of that explanation. A name refusal must carry neither.
 */
const AGENT_WORTH = [/namespace says how much the attribution is worth/, /agent: automated, user: an authenticated account/];
const EXPLAINS_NAMESPACE = {
  take: AGENT_WORTH, next: AGENT_WORTH, handoff: AGENT_WORTH, seed: AGENT_WORTH,
  history: [/\(or `unknown`, when the author really is not known\)/].concat(AGENT_WORTH),
  done: [/the namespace says how much a vouching is worth/, /thing `manual:` can offer instead of a command/],
  decide: [/A decision is the one row where WHO decided is the point/, /only the namespace tells them apart/],
};
/** The writers that end a refusal with a pointer to their own `--help`. */
const POINTS_TO_HELP = new Set(["take", "next", "handoff", "body", "release", "set", "decide", "ask",
  "seed", "import", "run", "deploy record"]);
/** Lines a writer prints under every actor refusal, whatever its cause. */
const ALWAYS_EXTRA = { ask: 1 };

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("every writing command refuses a wrong name for the name, and a missing namespace for the namespace", () => {
  const { dir, id } = fixture();
  const before = readdirSync(join(dir, "backlog", "tasks")).sort();
  const cases = writers(id);
  assert.ok(Object.keys(cases).length >= 18, "the list of writers shrank");
  for (const [name, args] of Object.entries(cases)) {
    const bad = run(dir, args.concat(["--dir", "backlog", "--actor", UPPERCASE]));
    const out = bad.stdout + bad.stderr;
    assert.equal(bad.status, 2, name + ": " + out);
    assert.match(out, /has an invalid name — `impl-TL-584` carries `T`, `L`/, name + ": " + out); // renumber: allow
    assert.match(out, /The namespace `agent:` is right/, name + ": " + out);
    assert.doesNotMatch(out, /namespace says how much|namespace tells them apart|no valid namespace|Use one of|or `unknown`/i, name + ": " + out);
    // The shape: the summary names the command, the remedy is its own line,
    // and nothing else is printed but the pointer to `--help`.
    const lines = out.split("\n").filter((l) => l.trim());
    const body = lines.filter((l) => !/^\s*→ /.test(l));
    assert.match(body[0], new RegExp(escapeRe(name) + ": the actor `" + escapeRe(UPPERCASE) + "` has an invalid name"), name + ": " + out);
    assert.equal(body[1].trim(), actorRefusal(UPPERCASE).hint, name + ": " + out);
    assert.equal(body.length, 2 + (ALWAYS_EXTRA[name] || 0), name + ": " + out);
    assert.equal(lines.length - body.length, POINTS_TO_HELP.has(name) ? 1 : 0, name + ": " + out);
    if (POINTS_TO_HELP.has(name)) assert.match(out, new RegExp("→ \\S+ " + escapeRe(name) + " --help"), name + ": " + out);

    // POSITIVE CONTROL: the same arguments reach the actor check — a refusal
    // for a missing namespace still names the namespace.
    const missing = run(dir, args.concat(["--dir", "backlog", "--actor", NO_NAMESPACE]));
    const missingOut = missing.stdout + missing.stderr;
    assert.equal(missing.status, 2, name + ": " + missingOut);
    assert.match(missingOut, /the actor `nobody` has no valid namespace — no `<namespace>:` comes before/, name + ": " + missingOut);
    assert.match(missingOut, /local:<name> \| agent:<name> \| user:<name>/, name + ": " + missingOut);
    // What a namespace is worth is explained where the namespace is the fault,
    // and only there: the first run above asserted its absence.
    for (const line of EXPLAINS_NAMESPACE[name] || []) assert.match(missingOut, line, name + ": " + missingOut);
    // The remedy is a line of its own, not run together with what follows;
    // `history` alone continues it on the same line, by design.
    const missingLines = missingOut.split("\n").map((l) => l.trim());
    if (name !== "history") {
      assert.ok(missingLines.includes(actorRefusal(NO_NAMESPACE).hint), name + ": " + missingOut);
    }

    const unknown = run(dir, args.concat(["--dir", "backlog", "--actor", UNKNOWN_NAMESPACE]));
    const unknownOut = unknown.stdout + unknown.stderr;
    assert.equal(unknown.status, 2, name + ": " + unknownOut);
    assert.match(unknownOut, /`robot` is not one of local, agent, user/, name + ": " + unknownOut);
  }
  assert.deepEqual(readdirSync(join(dir, "backlog", "tasks")).sort(), before, "a refused write changed the tree");

  // The writers that answer a refusal as data say the same thing there.
  for (const name of ["release", "deploy record"]) {
    const r = run(dir, cases[name].concat(["--dir", "backlog", "--actor", UPPERCASE, "--json"]));
    assert.equal(r.status, 2, name + ": " + r.stdout + r.stderr);
    const doc = JSON.parse(r.stdout);
    assert.equal(doc.ok, false, name);
    assert.equal(doc.refusalKind, "usage", name);
    assert.equal(doc.refusal, actorRefusal(UPPERCASE).refusal, name);
    assert.deepEqual(doc.details, [actorRefusal(UPPERCASE).hint], name);
  }
});

test("every writing command lets a valid actor past the actor check", () => {
  // NEGATIVE CONTROL for the refusals above: a writer that refused every actor
  // would pass them all. Each command may still stop later for its own
  // reasons; what may not appear is a refusal of the actor. `run`,
  // `migrate-prefix` and `renumber` are asked for their dry runs, and `import`
  // through its parser, because the real run would reach the network.
  const { dir, id } = fixture();
  const valid = "agent:impl-tl-584"; // renumber: allow
  const cases = writers(id);
  delete cases.import;
  cases.run = ["run", "--dry-run"];
  cases["migrate-prefix"] = ["migrate-prefix", "--to", "XX", "--dry-run"];
  cases.renumber = ["renumber", "--dry-run"];
  for (const [name, args] of Object.entries(cases)) {
    const r = run(dir, args.concat(["--dir", "backlog", "--actor", valid]));
    const out = r.stdout + r.stderr;
    assert.doesNotMatch(out, /the actor `|has no valid namespace|has an invalid name|has an empty name|TypeError/, name + ": " + out);
  }
  assert.equal(parseImportArgs(["--from", "github", "--actor", valid]).actor, valid);
  assert.equal(parseSeedArgs(["--from", "x", "--actor", valid]).actor, valid);
  // An absent actor is not a refused one: these resolve it later.
  assert.equal(parseImportArgs(["--from", "github"]).actor, null);
  assert.equal(parseSeedArgs(["--from", "x"]).actor, null);
});

// ── 3. One copy of the sentence ───────────────────────────────────────────

test("the namespace refusal is written in one module, not copied into the writers", () => {
  const OLD = /has no valid namespace|must use a declared namespace/;
  const roots = [SCRIPTS_DIR, join(REPO_ROOT, "bin")];
  const holders = [];
  let scanned = 0;
  for (const root of roots) {
    let names;
    try { names = readdirSync(root); } catch { continue; }
    for (const f of names.filter((n) => n.endsWith(".mjs"))) {
      scanned++;
      const src = readFileSync(join(root, f), "utf8");
      // Comments may name the sentence; only code that prints it counts.
      const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");
      if (OLD.test(code)) holders.push(f);
    }
  }
  assert.ok(scanned > 20, "the scan read " + scanned + " modules — the guard would pass on nothing");
  // POSITIVE CONTROL: the diagnosis itself does hold the sentence, so the
  // pattern and the comment filter can see it.
  assert.deepEqual(holders, ["task-fields.mjs"], "the old refusal is printed outside the diagnosis: " + holders.join(", "));
});
