/**
 * Every command for agents is named by a guide (TL-589).
 *
 * The packaged skill and the agent pointer hold no procedure; they send an
 * agent to `instructions`. What no rendered guide names, an agent does not
 * use — on 2026-11-06 that was `show`, `set`, `body`, `release` and `plan`,
 * among others, while TL-584 was adding `deploy status` to the guides by hand.
 * So the decision is moved to the moment a command is ADDED: its entry in the
 * command table says who it is for, and an `agent` command no guide names
 * fails here. WHAT HAS TO BE PROVED:
 *
 *   1. EVERY ENTRY SAYS WHO IT IS FOR, with a value of `COMMAND_AUDIENCES`. A
 *      missing audience is not read as "not for agents": that default would be
 *      the silent opt-out this file exists to remove.
 *   2. THE PREDICATE HAS TEETH. It is shown to find a command that is named, to
 *      report one that is not, to read a name broken across a line the way a
 *      reader does, and not to mistake `plan-from` for `plan`.
 *   3. THE RENDERED GUIDES NAME EVERY `agent` COMMAND. Rendered, not the source:
 *      two commands are named only by paragraphs the configuration switches on,
 *      so the fixture declares a deploy target and a release, and a second,
 *      bare fixture shows that without them exactly those two go unnamed.
 *   4. REMOVING ONE SUCH LINE FAILS. For the commands this task gave a line,
 *      the line is deleted from the guide's source and the guard reports that
 *      command and no other. An invocation wrapped across two source lines
 *      loses both (TL-602), and a fixture proves the helper does that.
 *
 * The command name is matched as `<product> <command>`, which is how every
 * guide invokes one; a bare word such as `set` or `plan` is ordinary English
 * and would make the guard pass on prose that teaches nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { COMMANDS, COMMAND_AUDIENCES } from "../cli.mjs";
import { loadConfig } from "../config.mjs";
import { PRODUCT_NAME } from "../product.mjs";
import { TOPICS, TOPIC_NAMES, render, vocabulary } from "../instructions.mjs";
import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

isolateHome("instructions-coverage");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
let counter = 0;

const DECLARED_YAML = `deploy_targets:
  - name: lighthouse
    stages:
      - { name: quay, ref: main }
releases: [spring-tide]
`;

function fixture(extra) {
  const repo = mkdtempSync(join(tmpdir(), "branchling-instructions-coverage-" + counter++ + "-"));
  execFileSync("git", ["init", "-q", "-b", "main", "."], { cwd: repo, stdio: "ignore" });
  const dir = join(repo, "backlog");
  const r = spawnSync(process.execPath, [CLI, "init", "--dir", dir, "--no-example", "--no-nudge"], {
    cwd: repo, encoding: "utf8", timeout: 60_000, env: { ...process.env, NO_COLOR: "1" },
  });
  assert.equal(r.status, 0, "init failed: " + r.stderr);
  if (extra) appendFileSync(join(dir, "config.yaml"), "\n" + extra, "utf8");
  return loadConfig(dir);
}

/**
 * Every topic rendered against `config`, from `texts` (the guides' source by
 * default). The measured placeholders are computed once per configuration:
 * `context-budget` runs the CLI to fill them, and the removal controls below
 * render the same configuration many times.
 */
const measuredFor = new Map();
function rendered(config, texts = {}) {
  if (!measuredFor.has(config)) {
    const measured = {};
    for (const name of TOPIC_NAMES) {
      if (TOPICS[name].measure) Object.assign(measured, TOPICS[name].measure(config));
    }
    measuredFor.set(config, { ...vocabulary(config), ...measured });
  }
  const vocab = measuredFor.get(config);
  return TOPIC_NAMES.map((name) => render(texts[name] ?? TOPICS[name].text, vocab));
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether `text` invokes `command`. Whitespace is collapsed first, because a
 *  wrapped paragraph breaks an invocation across lines and a reader still
 *  reads it; a following `-` or word character is another command's name. */
function names(text, command) {
  const flat = String(text).replace(/\s+/g, " ");
  return new RegExp("(?<![\\w-])" + escape(PRODUCT_NAME + " " + command) + "(?![\\w-])").test(flat);
}

/** The `agent` commands of `commands` that none of `texts` names. PURE. */
function unnamedAgentCommands(commands, texts) {
  const all = texts.join("\n");
  return Object.keys(commands).filter((c) => commands[c].audience === "agent" && !names(all, c));
}

/**
 * `text` without every line that invokes `{{tool}} <command>`, and how many
 * lines went. PURE. The match runs on the whole text rather than line by line,
 * because a guide paragraph wraps where its width says, not where an
 * invocation ends: `{{tool}}` closing one line and the command name opening
 * the next is still one invocation, and both lines go. A single-line needle
 * left `resume` out of the deletion control for exactly that reason (TL-602).
 */
function withoutInvocations(text, command) {
  const needle = new RegExp("\\{\\{tool\\}\\}(?:[ \\t]+|[ \\t]*\\n[ \\t]*)" + escape(command) + "(?![\\w-])", "g");
  const lines = text.split("\n");
  const lineAt = [];
  lines.forEach((line, i) => { for (let k = 0; k <= line.length; k++) lineAt.push(i); });
  const doomed = new Set();
  for (const match of text.matchAll(needle)) {
    const first = lineAt[match.index];
    const last = lineAt[match.index + match[0].length - 1];
    for (let i = first; i <= last; i++) doomed.add(i);
  }
  return { text: lines.filter((_, i) => !doomed.has(i)).join("\n"), removed: doomed.size };
}

/** The entries that do not say who they are for. PURE. */
function audienceProblems(commands) {
  return Object.entries(commands)
    .filter(([, spec]) => !Object.prototype.hasOwnProperty.call(COMMAND_AUDIENCES, spec.audience))
    .map(([name, spec]) => name + ": " + (spec.audience === undefined ? "no audience" : "unknown audience `" + spec.audience + "`"));
}

const DECLARED = fixture(DECLARED_YAML);

// ── 1. Every entry says who it is for ──────────────────────────────────────

test("every command table entry declares an audience from COMMAND_AUDIENCES", () => {
  assert.deepEqual(audienceProblems(COMMANDS), []);
  assert.deepEqual(Object.keys(COMMAND_AUDIENCES).sort(), ["agent", "person", "program"]);
  // The value is the decision; the description is what a person adding a
  // command reads to make it. A vocabulary whose words are not explained
  // leaves the classification to guesswork.
  for (const [audience, meaning] of Object.entries(COMMAND_AUDIENCES)) {
    assert.ok(typeof meaning === "string" && meaning.trim().length > 20, audience + " does not say who it means");
  }
  // Positive control: the check reports both ways an entry can fail it, and
  // an inherited key such as `toString` is not an audience.
  assert.deepEqual(audienceProblems({
    a: { audience: "agent" }, b: {}, c: { audience: "robot" }, d: { audience: "toString" },
  }), ["b: no audience", "c: unknown audience `robot`", "d: unknown audience `toString`"]);
});

test("the table holds commands of every audience, so the guard below has a sample", () => {
  const counts = {};
  for (const spec of Object.values(COMMANDS)) counts[spec.audience] = (counts[spec.audience] || 0) + 1;
  for (const audience of Object.keys(COMMAND_AUDIENCES)) {
    assert.ok(counts[audience] > 0, "no command is marked `" + audience + "`");
  }
  // The commands a session cannot work without are the ones a wrong
  // classification would hide from it; they are pinned, not counted.
  for (const name of ["next", "take", "done", "show", "set", "release"]) {
    assert.equal(COMMANDS[name].audience, "agent", name + " is not marked for agents");
  }
  // And a person's setup is not something the guides are obliged to teach.
  for (const name of ["init", "hooks", "renumber"]) {
    assert.notEqual(COMMANDS[name].audience, "agent", name + " is marked for agents");
  }
});

// ── 2. The predicate has teeth ─────────────────────────────────────────────

test("positive control: the predicate finds a named command and reports an unnamed one", () => {
  const table = { next: { audience: "agent" }, plan: { audience: "agent" }, init: { audience: "person" } };
  assert.deepEqual(unnamedAgentCommands(table, ["  " + PRODUCT_NAME + " next --actor <ns:name>"]), ["plan"]);
  // A wrapped invocation is still an invocation.
  assert.deepEqual(unnamedAgentCommands(table, ["`" + PRODUCT_NAME + "\nnext` and `" + PRODUCT_NAME + " plan`"]), []);
  // `plan-from` is another command, and `planning` is a word.
  assert.deepEqual(unnamedAgentCommands(table, [PRODUCT_NAME + " next, " + PRODUCT_NAME + " plan-from, " + PRODUCT_NAME + " planning"]), ["plan"]);
  // The bare word is prose, not an invocation.
  assert.deepEqual(unnamedAgentCommands(table, [PRODUCT_NAME + " next; then plan the work"]), ["plan"]);
  // A command for somebody else is never demanded.
  assert.deepEqual(unnamedAgentCommands(table, [""]), ["next", "plan"]);
  // And the real guides do name a command the guard depends on.
  assert.ok(names(rendered(DECLARED).join("\n"), "next"), "the rendered guides do not name `next`");
});

// ── 3. The rendered guides name every agent command ────────────────────────

test("every command marked for agents is named by at least one rendered guide", () => {
  const missing = unnamedAgentCommands(COMMANDS, rendered(DECLARED));
  assert.deepEqual(missing, [],
    "no guide names these commands, which are marked `audience: \"agent\"` in scripts/cli.mjs. " +
    "Add a line to the guide that owns the question each one answers, or mark it for " +
    "`person` or `program` if agents are not meant to use it");
});

test("the two paragraphs the configuration switches on are what name `deploy` and `declare`", () => {
  // Why the fixture declares a target and a release: without them the guides
  // rightly stay silent about commands that would refuse, and a guard rendered
  // against a bare backlog would demand lines that must not be there.
  assert.deepEqual(unnamedAgentCommands(COMMANDS, rendered(fixture(""))), ["deploy", "declare"]);
});

// ── 4. Removing one such line fails ────────────────────────────────────────

test("positive control: the deletion helper removes a wrapped invocation's two lines and nothing else", () => {
  const guide = [
    "keep: an opening line",
    "a sentence that ends with `{{tool}}",
    "resume <ID>`: and goes on here",
    "  {{tool}} resume --json   a single-line invocation",
    "keep: {{tool}} resume-all is another command",
    "keep: {{tool}}resume, with no space, is not an invocation",
    "keep: {{tool}}",
    "resumed is a word, not the command",
    "keep: {{tool}} next, then resume by hand",
    "keep: a closing line",
  ].join("\n");
  const result = withoutInvocations(guide, "resume");
  assert.deepEqual(result.text.split("\n"), [
    "keep: an opening line",
    "keep: {{tool}} resume-all is another command",
    "keep: {{tool}}resume, with no space, is not an invocation",
    "keep: {{tool}}",
    "resumed is a word, not the command",
    "keep: {{tool}} next, then resume by hand",
    "keep: a closing line",
  ]);
  assert.equal(result.removed, 3);
  // A command no line invokes leaves the text exactly as it was.
  assert.deepEqual(withoutInvocations(guide, "plan"), { text: guide, removed: 0 });
});

test("deleting a command's line from its guide makes the guard report that command, and only it", () => {
  // `resume` is the one whose only invocation wraps across two source lines.
  const added = ["show", "log", "set", "body", "release", "plan", "vocabulary", "pr-summary", "follow", "resume"];
  for (const command of added) {
    const texts = {};
    let removed = 0;
    for (const name of TOPIC_NAMES) {
      const result = withoutInvocations(TOPICS[name].text, command);
      removed += result.removed;
      texts[name] = result.text;
    }
    assert.ok(removed > 0, command + ": no guide line names it, so there was nothing to remove");
    assert.deepEqual(unnamedAgentCommands(COMMANDS, rendered(DECLARED, texts)), [command],
      command + ": removing its line was not reported as exactly that command");
  }
});
