/**
 * `resume` on a task held by the reserved actor `unknown` (TL-671).
 *
 * WHAT IS AT RISK. `isValidActor()` accepts `unknown`, because history readers
 * and `reconcile()` record it, so `resume` (scripts/resume-task.mjs) reads
 * `owner: unknown` as a claim and refuses every other actor. Its ordinary
 * remedy is "resume as them with `--actor <them>`" — and since TL-628 every
 * writing command, `resume` included, refuses a stated `unknown` as a usage
 * error. The successor was handed a way out that the next invocation rejects.
 *
 * WHAT IS ASSERTED. Not the wording of the remedy, but that it WORKS: every
 * command the refusal prints is run as printed, none of them is a usage error,
 * and after them the successor's own `resume` is a briefing. A remedy that is
 * merely different from `--actor unknown` would pass a wording test and still
 * leave the successor with nothing to do.
 *
 * TWO SHAPES OF THE SAME CLAIM. `owner: unknown` in the file (a `take --actor
 * unknown` from before TL-628, or a hand edit), and a parked task whose file
 * names nobody while its log's last owner change names `unknown` — the case
 * `claimant()` consults the log for.
 *
 * THE POSITIVE CONTROLS. The old remedy is proved dead (`--actor unknown` is a
 * usage error), and a stranger is proved refused before the remedy runs;
 * without them, "the remedy works" would be satisfied by a `resume` that
 * refused nobody, or by a tool that had started accepting `unknown` again.
 *
 * `TASK` ids and both actors are this fixture's, never this repository's.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fixtureDir } from "./_fixture-dir.mjs";
import { SCRIPTS_DIR, isolateHome, plainOutput } from "./_repo.mjs";

isolateHome("resume-unknown");
plainOutput();

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const FIRST = "agent:one";
const SUCCESSOR = "agent:two";
const RESERVED = "unknown";

function cli(f, args) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: f.root, encoding: "utf8", timeout: 60_000, input: "",
    env: { ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: f.state },
  });
  return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "", all: (r.stdout || "") + (r.stderr || "") };
}

function git(root, args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 60_000 });
  assert.equal(r.status, 0, "git " + args.join(" ") + ": " + r.stderr);
}

/** A task taken by FIRST, with `--no-verify` contracts irrelevant to the run. */
function fixture() {
  const f = {
    root: fixtureDir(join(tmpdir(), "branchling-resume-unknown-")),
    state: fixtureDir(join(tmpdir(), "branchling-resume-unknown-state-")),
  };
  git(f.root, ["init", "-q", "-b", "main", "."]);
  git(f.root, ["config", "user.email", "fixture@example.invalid"]);
  git(f.root, ["config", "user.name", "fixture"]);
  assert.equal(cli(f, ["init", "--dir", ".", "--no-example"]).code, 0);
  const created = cli(f, ["new", "--dir", ".", "--title", "A task somebody unnamed holds"]);
  assert.equal(created.code, 0, created.all);
  f.id = (created.all.match(/[A-Z]+-\d+/) || [])[0];
  assert.ok(f.id, "no id in: " + created.all);
  f.file = join(f.root, "tasks", readdirSync(join(f.root, "tasks")).find((n) => n.startsWith(f.id)));
  git(f.root, ["add", "-A"]);
  git(f.root, ["commit", "-q", "-m", "the backlog"]);
  git(f.root, ["checkout", "-q", "-b", "work"]);
  const taken = cli(f, ["take", f.id, "--dir", ".", "--actor", FIRST]);
  assert.equal(taken.code, 0, taken.all);
  return f;
}

function setOwner(f, value) {
  const text = readFileSync(f.file, "utf8");
  const next = text.replace(/^owner:.*$/m, "owner: " + value);
  assert.notEqual(next, text, "the fixture's task has no `owner:` line to set");
  writeFileSync(f.file, next, "utf8");
}

/** Splits one printed command line into arguments, honouring double quotes. */
function argv(line) {
  return (line.match(/"[^"]*"|\S+/g) || []).map((t) => t.replace(/^"(.*)"$/, "$1"));
}

/**
 * Runs every command the refusal prints, as printed, and returns the briefing
 * the successor gets afterwards. The program name is dropped and the CLI
 * entry point put in its place; nothing else in the line is rewritten.
 */
function followRemedy(f) {
  const refused = cli(f, ["resume", f.id, "--dir", ".", "--actor", SUCCESSOR, "--no-verify", "--json"]);
  assert.equal(refused.code, 1, "a stranger was not refused, so no remedy is measured:\n" + refused.all);
  const answer = JSON.parse(refused.stdout);
  assert.equal(answer.refusalKind, "other-owner", refused.stdout);
  assert.match(answer.refusal, new RegExp("\\b" + RESERVED + "\\b"), "the refusal does not name the holder:\n" + refused.stdout);

  assert.ok(!answer.details.some((l) => l.includes("--actor " + RESERVED)),
    "the refusal still hands back `--actor " + RESERVED + "`:\n" + answer.details.join("\n"));

  const commands = answer.details
    .map((l) => l.trim())
    .filter((l) => /^\S+ (take|resume) /.test(l))
    .map((l) => argv(l).slice(1));
  // The route ENDS in the briefing the successor asked for: a remedy that
  // stopped at the takeover would leave the last step to be guessed.
  assert.deepEqual(commands.map((a) => a[0]), ["take", "resume"],
    "the remedy is not a takeover followed by the resume:\n" + answer.details.join("\n"));
  // WHY there is nobody to ask has to be said, or the takeover reads as the
  // first resort it is not.
  assert.ok(answer.details.some((l) => l.includes("`" + RESERVED + "`")),
    "the remedy does not say why `" + RESERVED + "` cannot be asked:\n" + answer.details.join("\n"));

  let last = null;
  for (const args of commands) {
    last = cli(f, [...args, "--dir", ".", ...(args[0] === "resume" ? ["--no-verify"] : [])]);
    assert.notEqual(last.code, 2, "the remedy `" + args.join(" ") + "` is itself a usage error:\n" + last.all);
    assert.equal(last.code, 0, "the remedy `" + args.join(" ") + "` was refused:\n" + last.all);
  }
  assert.match(last.stdout, /^## Goal\s*$/m, "the remedy's resume is not a briefing:\n" + last.stdout);
}

test("POSITIVE CONTROL: the old remedy, `--actor unknown`, is a usage error", () => {
  const f = fixture();
  setOwner(f, RESERVED);
  const r = cli(f, ["resume", f.id, "--dir", ".", "--actor", RESERVED, "--no-verify"]);
  assert.equal(r.code, 2, "`resume --actor " + RESERVED + "` is accepted, so a remedy naming it was never dead:\n" + r.all);
});

test("owner: unknown in the file — the refusal's remedy leads to a briefing", () => {
  const f = fixture();
  setOwner(f, RESERVED);
  followRemedy(f);
});

test("a parked task whose log last handed it to unknown — the remedy leads to a briefing", () => {
  const f = fixture();
  // The file names nobody — the shape `ask` leaves — and the log's last owner
  // change is one the tool OBSERVED, written as `reconcile()` writes it.
  setOwner(f, '""');
  appendFileSync(join(f.root, "history", f.id + ".jsonl"), JSON.stringify({
    id: "01M70DR0GBKF3N4P1WTZ5NKZZZ", ts: new Date().toISOString(), task: f.id,
    field: "owner", from: FIRST, to: RESERVED, actor: RESERVED, source: "external", reason: "unknown",
  }) + "\n", "utf8");
  followRemedy(f);
});

test("POSITIVE CONTROL: a claim held by a named actor keeps the ordinary remedy", () => {
  // The takeover route is for the one holder nobody can be asked. A named
  // holder CAN be asked, and handing every refusal the takeover would turn a
  // question into a crossing.
  const f = fixture();
  const r = cli(f, ["resume", f.id, "--dir", ".", "--actor", SUCCESSOR, "--no-verify", "--json"]);
  assert.equal(r.code, 1, r.all);
  const details = JSON.parse(r.stdout).details.join("\n");
  assert.match(details, new RegExp("--actor " + FIRST), "a named holder is no longer offered:\n" + details);
  assert.doesNotMatch(details, /--take-over/, "a named holder's refusal offers the takeover:\n" + details);
});
