/**
 * Caller text reaches the task file literally, replacement tokens included
 * (TL-527).
 *
 * WHAT WAS BROKEN. `new` filled the template with
 * `text.replace(pattern, "key: " + value)`. A replacement STRING is not
 * literal in JavaScript: `$'` inserts everything after the match, `` $` ``
 * everything before it, `$&` the match itself, `$1` a capture group and `$$`
 * a single dollar sign. A verification command such as `grep -q x$' f` — a
 * pattern anchored at the end of a line, closed by a single quote — spliced
 * the whole template body into the frontmatter. `new` exited 0 and `check`
 * passed; only `done` noticed, much later, that criteria and verification no
 * longer agreed.
 *
 * WHAT IS PROVED HERE. Every token, in every field `new` fills, is written
 * byte for byte, and the template body appears exactly once. The CLI case
 * covers what a person can type (title, epic, verification); the library case
 * covers what `seed`, `import` and `docs-drift` hand `createTask` directly,
 * which skips the configured vocabulary and so can carry a token in labels,
 * related docs, release, target and the scalar fields too.
 *
 * The positive control is the count of values found: a reader that found no
 * field at all would pass every "is it literal" assertion.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseVerification } from "../criteria.mjs";
import { loadConfig } from "../config.mjs";
import { createTask } from "../new-task.mjs";
import { splitFrontmatter } from "../task-fields.mjs";
import { isolateHome, isolateState, plainOutput, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("new-literal-replacement");
isolateState("new-literal-replacement");
plainOutput();

const CLI = join(SCRIPTS_DIR, "cli.mjs");

// Every special sequence a JavaScript replacement string interprets.
const TOKENS = ["$'", "$`", "$&", "$1", "$$", "$<name>"];

function run(args, opts = {}) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, env: { ...process.env, NO_COLOR: "1" }, ...opts,
  });
}

function freshBacklog() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-literal-"));
  const r = run(["init", "--dir", dir, "--no-example"]);
  assert.equal(r.status, 0, r.stderr);
  return dir;
}

/**
 * The configuration with a vocabulary that admits the token-bearing values.
 * The closed fields (owner, release, target) are judged against `config.yaml`
 * before the write; a project is free to declare such a value, so the writer
 * owes it the same literal treatment, and the fixture establishes the
 * vocabulary rather than assuming one.
 */
function vocabularyAdmitting(dir, t) {
  const config = loadConfig(dir);
  return {
    ...config,
    owners: [...config.owners, "local:own" + t],
    releases: [...config.releases, "rel" + t],
    externalTargets: [...(config.externalTargets || []), "tgt" + t],
  };
}

function onlyTask(dir) {
  const files = readdirSync(join(dir, "tasks")).filter((f) => f.endsWith(".md"));
  assert.equal(files.length, 1, files.join(", "));
  return readFileSync(join(dir, "tasks", files[0]), "utf8");
}

/** The body of the template appears once — nothing was spliced in a second time. */
function assertNoSplice(text) {
  const goals = text.split(/^## Goal$/m).length - 1;
  assert.equal(goals, 1, "`## Goal` appears " + goals + " times:\n" + text);
  const fences = text.split(/^---$/m).length - 1;
  assert.equal(fences, 2, "the frontmatter fence appears " + fences + " times:\n" + text);
}

test("the reported case: a verification command ending in $' is written literally", () => {
  const dir = freshBacklog();
  const bash = "grep -q x$' f";
  const doc = join(dir, "doc.json");
  writeFileSync(doc, JSON.stringify({
    goal: "The goal.",
    verification: [{ id: "the-name", bash, proves: "It holds." }],
  }));
  const r = run(["new", "--dir", dir, "--title", "Reported case", "--body-file", doc], { input: "" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const text = onlyTask(dir);
  assertNoSplice(text);
  const parsed = parseVerification(splitFrontmatter(text).frontmatter).entries;
  assert.deepEqual(parsed.map((v) => v.bash), [bash]);
});

test("every token in the title, the epic and each verification command is written literally", () => {
  const dir = freshBacklog();
  const title = "Title " + TOKENS.join(" ");
  const epic = "Epic " + TOKENS.join(" ");
  const verification = TOKENS.map((t, i) => ({ id: "v" + i, bash: "echo a" + t + "b", proves: "Entry " + i + " holds." }));
  const doc = join(dir, "doc.json");
  writeFileSync(doc, JSON.stringify({ goal: "The goal.", verification }));
  const r = run(["new", "--dir", dir, "--title", title, "--epic", epic, "--body-file", doc], { input: "" });
  assert.equal(r.status, 0, r.stdout + r.stderr);

  const text = onlyTask(dir);
  assertNoSplice(text);
  const { frontmatter } = splitFrontmatter(text);
  assert.ok(frontmatter.includes('title: "' + title + '"'), frontmatter);
  assert.ok(frontmatter.includes('epic: "' + epic + '"'), frontmatter);
  const parsed = parseVerification(frontmatter).entries;
  // Positive control: one entry read back per token.
  assert.equal(parsed.length, TOKENS.length, frontmatter);
  assert.deepEqual(parsed.map((v) => v.bash), verification.map((v) => v.bash));
});

test("createTask writes every caller-filled field literally, as seed and import call it", () => {
  const dir = freshBacklog();
  const t = TOKENS.join("");
  const config = vocabularyAdmitting(dir, t);
  const fields = {
    title: "Library " + t,
    epic: "epic" + t,
    release: "rel" + t,
    target: ["tgt" + t],
    labels: ["lab" + t],
    related_docs: ["docs/a" + t + ".md"],
    owner: "local:own" + t,
    estimate: "2h" + t,
    verification: [{ id: "lib", bash: "echo " + t }],
  };
  createTask({ root: dir, config, board: "main", slug: "library", fields, body: "## Goal\n\nThe goal.\n" });

  const text = onlyTask(dir);
  assertNoSplice(text);
  const { frontmatter } = splitFrontmatter(text);
  const expected = [
    'title: "Library ' + t + '"',
    'epic: "epic' + t + '"',
    "release: rel" + t,
    "target: [tgt" + t + "]",
    "labels: [lab" + t + "]",
    "  - docs/a" + t + ".md",
    "owner: local:own" + t,
    "estimate: 2h" + t,
  ];
  for (const line of expected) {
    assert.ok(frontmatter.split("\n").includes(line), "missing `" + line + "` in:\n" + frontmatter);
  }
  assert.deepEqual(parseVerification(frontmatter).entries.map((v) => v.bash), ["echo " + t]);
});

test("createTask inserts release and target literally into a template that predates them", () => {
  const dir = freshBacklog();
  const tpl = join(dir, "_template.md");
  const old = readFileSync(tpl, "utf8").replace(/^release:.*\n/m, "").replace(/^target:.*\n/m, "");
  writeFileSync(tpl, old);
  const t = TOKENS.join("");
  const config = vocabularyAdmitting(dir, t);
  createTask({
    root: dir, config, board: "main", slug: "old-template",
    fields: { title: "Old template", release: "rel" + t, target: ["tgt" + t], verification: [] },
    body: "## Goal\n\nThe goal.\n",
  });
  const text = onlyTask(dir);
  assertNoSplice(text);
  const lines = splitFrontmatter(text).frontmatter.split("\n");
  // Positive control: the template really lacked both lines before the write.
  assert.ok(!/^release:/m.test(old) && !/^target:/m.test(old));
  assert.ok(lines.includes("release: rel" + t), lines.join("\n"));
  assert.ok(lines.includes("target: [tgt" + t + "]"), lines.join("\n"));
});
