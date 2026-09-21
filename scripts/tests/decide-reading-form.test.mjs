/**
 * Every invocation `decide --help` prints can be RUN, and the read it used to
 * promise is answered by the command that reads (TL-396).
 *
 * THE DEFECT. `decide --help` advertised three usages and the command refused
 * the third: `decide <ID> [--json]` came back with exit 2 and a sentence about
 * `--reason`, the flag a caller of that form deliberately did not pass. A
 * contract naming an invocation nobody can run is the family of defect TL-234
 * wired into `check`, and this one sat in the help of the tool itself.
 *
 * WHY THE LINE WENT RATHER THAN THE REFUSAL. `decide` WRITES. The only thing
 * that could have selected a reading mode is the ABSENCE of `--reason`, so a
 * reason dropped by a shell would have stopped refusing and started printing,
 * exit 0, with nothing recorded. TL-256 had already rejected `history --show`
 * on the general form of that rule — one name may not mean both a read and a
 * write — so the promise moved to `log <ID> --decisions`.
 *
 * WHY THE GUARD READS THE USAGE BLOCK. A test naming the two surviving forms
 * by hand would be a second copy of the help, green on the day it was written
 * and silent the next time a line is added. It takes the lines from
 * `COMMANDS.decide.usage`, so a fourth form that cannot run fails here.
 *
 * WHAT AN OPTIONAL GROUP MEANS. `[…]` is what a caller MAY pass, so the guard
 * strips those and runs what is left: the form's required core. A line whose
 * core is refused is a line nobody can follow, whatever is bracketed on it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { COMMANDS } from "../cli.mjs";
import { PRODUCT_NAME } from "../product.mjs";
import { SCRIPTS_DIR, isolateHome, plainOutput } from "./_repo.mjs";

isolateHome("decide-reading-form");
plainOutput();

const CLI = join(SCRIPTS_DIR, "cli.mjs");

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8", timeout: 60_000, input: "", env: { ...process.env, NO_COLOR: "1" },
  });
}

/** A backlog with one task that has already been asked a question. */
function fixture() {
  const repo = mkdtempSync(join(tmpdir(), "branchling-decide-"));
  execFileSync("git", ["init", "-q", "-b", "main", "."], { cwd: repo, stdio: "ignore" });
  const dir = join(repo, "backlog");
  assert.equal(run(["init", "--dir", dir, "--no-example"]).status, 0, "init failed");
  const made = run(["new", "--dir", dir, "--title", "A task with something to settle"]);
  assert.equal(made.status, 0, made.stderr);
  const id = JSON.parse(run(["query", "--dir", dir, "--json"]).stdout).tasks[0].id;
  const asked = run(["ask", id, "--dir", dir, "--actor", "agent:test", "--json",
    "--question", "which of the two shapes does this take",
    "--option", "the first — it is the smaller change",
    "--option", "the second — it survives more cases",
    "--recommend", "2"]);
  assert.equal(asked.status, 0, asked.stderr);
  const question = JSON.parse(asked.stdout).question.id;
  assert.ok(question, "the question carries no event id");
  return { repo, dir, id, question };
}

/**
 * One usage line as argv. PURE apart from the substitutions it is handed.
 *
 * The placeholders are taken apart before the split on whitespace, because
 * `<event id>` and `"…"` are ONE argument each and contain a space or a quote
 * that a naive split would break into two.
 */
export function invocationOf(line, values) {
  const core = line.replace(/\[[^\]]*\]/g, " ").trim();
  const argv = [];
  const re = /<[^>]+>|"[^"]*"|\S+/g;
  let m;
  while ((m = re.exec(core)) !== null) {
    const token = m[0];
    if (token === PRODUCT_NAME) continue;
    const value = Object.prototype.hasOwnProperty.call(values, token) ? values[token] : token;
    argv.push(value);
  }
  return argv;
}

/** The invocation lines of a command's usage — the forms, not the prose. */
function formsOf(name) {
  return COMMANDS[name].usage.split("\n").filter((l) => l.startsWith(PRODUCT_NAME + " " + name + " "));
}

// ── The guard ─────────────────────────────────────────────────────────────

test("positive control: decide advertises more than one form, and they are read from the help", () => {
  // Without this the loop below could iterate over nothing — green, and proving
  // that a usage block nobody found has no unrunnable line in it.
  const forms = formsOf("decide");
  assert.ok(forms.length >= 2, "expecting decide to advertise at least two forms, got " + forms.length);
  for (const line of forms) assert.match(line, /decide <ID>/);
});

test("every form decide advertises runs", () => {
  for (const line of formsOf("decide")) {
    const fx = fixture();
    const argv = invocationOf(line, {
      "<ID>": fx.id,
      '"…"': "the smaller change is enough here",
      "<event id>": fx.question,
      "<n>": "1",
      "<ns:name>": "agent:test",
    });
    const r = run([...argv, "--dir", fx.dir]);
    assert.notEqual(r.status, 2,
      "a form the help prints is a usage error:\n  " + line + "\n" + (r.stderr || ""));
    assert.equal(r.status, 0, "`" + line + "` did not record a decision:\n" + (r.stderr || ""));
  }
});

test("positive control: the form that was removed IS caught by this guard", () => {
  // The line this task deleted, run through the same machinery. If the guard
  // ever stops noticing it, the defect can come back unseen.
  const fx = fixture();
  const argv = invocationOf(PRODUCT_NAME + " decide <ID> [--json] [--dir <path>]", { "<ID>": fx.id });
  assert.deepEqual(argv, ["decide", fx.id], "the optional groups were not stripped");
  const r = run([...argv, "--dir", fx.dir]);
  assert.equal(r.status, 2, "`decide <ID>` no longer refuses — a dropped --reason now writes or prints");
  assert.match(r.stderr, /--reason/);
});

test("the refusal sends the reader to the command that reads", () => {
  const fx = fixture();
  const r = run(["decide", fx.id, "--dir", fx.dir]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, new RegExp(PRODUCT_NAME + " log " + fx.id + " --decisions"),
    "the refusal names no way to read what was decided");
});

// ── The read the promise moved to ─────────────────────────────────────────

test("`log --decisions` answers what was decided and what is still open", () => {
  const fx = fixture();
  const decided = run(["decide", fx.id, "--dir", fx.dir, "--actor", "agent:test",
    "--reason", "the log is folded, not dumped"]);
  assert.equal(decided.status, 0, decided.stderr);

  const all = JSON.parse(run(["log", fx.id, "--dir", fx.dir, "--json"]).stdout);
  const only = JSON.parse(run(["log", fx.id, "--dir", fx.dir, "--decisions", "--json"]).stdout);

  assert.equal(only.decisions, true);
  assert.equal(only.total, all.total, "the filter changed how many exchanges the log holds");
  assert.ok(only.matched < all.total, "the filter kept everything — it is not filtering");
  assert.equal(only.exchanges.length, only.matched);

  const kinds = only.exchanges.flatMap((x) => x.messages.map((m) => m.kind));
  assert.deepEqual([...new Set(kinds)].sort(), ["decision", "question"],
    "the decisions view lost one of its two halves");
  // The QUESTION that is still open, and the decision that answers nothing.
  assert.equal(only.exchanges.length, 2);
  assert.ok(only.exchanges.some((x) => x.reason === "the log is folded, not dumped"));
});

test("an answered question drops out, because its answer carries the text", () => {
  const fx = fixture();
  const answered = run(["decide", fx.id, "--dir", fx.dir, "--actor", "agent:test",
    "--resolves", fx.question, "--choose", "2"]);
  assert.equal(answered.status, 0, answered.stderr);

  const only = JSON.parse(run(["log", fx.id, "--dir", fx.dir, "--decisions", "--json"]).stdout);
  const kinds = only.exchanges.flatMap((x) => x.messages.map((m) => m.kind));
  assert.deepEqual(kinds, ["decision"], "an answered question is still listed as open");
  assert.match(only.exchanges[0].reason, /it survives more cases/,
    "the chosen option's text is not what was recorded");
});

test("a task that decided nothing says so, and exits 0", () => {
  const fx = fixture();
  // The question above is open, so a task with NOTHING to show needs its own.
  const made = run(["new", "--dir", fx.dir, "--title", "A task nobody has settled anything about"]);
  assert.equal(made.status, 0, made.stderr);
  const fresh = JSON.parse(run(["query", "--dir", fx.dir, "--json"]).stdout)
    .tasks.map((t) => t.id).find((id) => id !== fx.id);
  assert.ok(fresh, "the second task was not created");

  const text = run(["log", fresh, "--dir", fx.dir, "--decisions"]);
  assert.equal(text.status, 0, "nothing decided was reported as a failure");
  assert.match(text.stdout, /no decision/);
  const json = JSON.parse(run(["log", fresh, "--dir", fx.dir, "--decisions", "--json"]).stdout);
  assert.equal(json.ok, true);
  assert.equal(json.matched, 0);
  assert.deepEqual(json.exchanges, []);
});

test("`--limit` slices the decisions, not the log it filtered", () => {
  const fx = fixture();
  for (const reason of ["the first thing settled", "the second thing settled"]) {
    const r = run(["decide", fx.id, "--dir", fx.dir, "--actor", "agent:test", "--reason", reason]);
    assert.equal(r.status, 0, r.stderr);
  }
  const one = JSON.parse(run(["log", fx.id, "--dir", fx.dir, "--decisions", "--limit", "1", "--json"]).stdout);
  assert.equal(one.exchanges.length, 1, "--limit 1 over the decisions returned something else");
  assert.equal(one.exchanges[0].reason, "the second thing settled",
    "the slice was taken before the filter — the newest decision is not the one kept");
  assert.equal(one.matched, 3, "the count of what matched was narrowed by the slice");
});
