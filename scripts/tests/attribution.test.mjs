/**
 * Which task did this minute belong to? (TL-28)
 *
 * WHY THIS FILE IS LONGER THAN THE CLUSTERING ONE. Attribution to the wrong
 * task looks exactly like attribution to the right one — there is no downstream
 * check that can tell them apart, no report that comes out obviously broken, and
 * no user who will notice. Everything that can be wrong has to be wrong HERE or
 * it is never caught, so each of the five legs of §8's chain gets its own case
 * and each one is paired with the signal that must NOT reach it.
 *
 * THE ONE ASSERTION THIS FILE EXISTS FOR is the negative one: the chain must not
 * consult the global `in_progress` state. That question has no single answer
 * across a repository — this backlog has had dozens of tasks in progress at once
 * — so a chain that asked it would be confidently wrong rather than honestly
 * `unknown`, which is the failure §8.1 is written to prevent. The test builds
 * TWO sessions on TWO tasks and requires that neither sees the other's.
 *
 * THE STATE DIRECTORY IS REDIRECTED IN EVERY CASE. The focus pointer and the
 * throttle window live outside the repository (that is the point), so a suite
 * writing to the user's real state directory would leak a focus into a real
 * session and silently misattribute somebody's actual work.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ATTRIBUTIONS } from "../activity.mjs";
import { ATTRIBUTION_CHAIN, attribute, taskFromBranch, taskFromPath } from "../attribution.mjs";
import { readFocus, sessionId, writeFocus } from "../focus.mjs";
import { parseRecordArgs, signalsFromPayload } from "../activity-command.mjs";
import { parseFocusArgs } from "../focus-command.mjs";
import { taskIdPatterns } from "../task-id.mjs";
import { REPO_ROOT } from "./_repo.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");
const PATTERNS = taskIdPatterns("TL");

let counter = 0;
function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), "worktrail-" + prefix + "-" + (counter++) + "-"));
}

function run(args, env, opts = {}) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 30_000,
    env: env || { ...process.env, NO_COLOR: "1" },
    input: opts.input === undefined ? "" : opts.input,
  });
}

/** A backlog with `n` tasks, its own state directory, and no git repository —
 *  so the branch leg has nothing to answer with unless a test supplies one. */
function fixture(n = 1) {
  const dir = tmp("attrib");
  const backlog = join(dir, "bl");
  const state = join(dir, "state");
  const env = { ...process.env, BACKLOG_STATE_DIR: state, NO_COLOR: "1", BACKLOG_ACTOR: "local:me" };
  delete env.BACKLOG_SESSION;
  delete env.BACKLOG_TASK;
  assert.equal(run(["init", "--dir", backlog, "--no-example"], env).status, 0);
  const ids = [];
  for (let i = 0; i < n; i++) {
    const r = run(["new", "--dir", backlog, "--title", "Task number " + (i + 1)], env);
    assert.equal(r.status, 0, r.stderr);
    ids.push((r.stdout.match(/([A-Z]+-\d+)/) || [])[1]);
  }
  return { dir, backlog, state, env, ids };
}

/** Every activity row for one task, or `[]` when the file was never created. */
function rows(backlog, id) {
  const file = join(backlog, "activity", id + ".jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

// ── the two closed sets have to agree ─────────────────────────────────────

test("the storage layer accepts exactly the legs the chain can produce", () => {
  // `attribution.mjs` decides and `activity.mjs` validates, and they hold the
  // list separately so the store keeps no dependency on the chain. A repetition
  // nothing checks is how a closed set silently opens: a leg added to the chain
  // and not to the store would fail at the append, in a hook, silently.
  for (const leg of ATTRIBUTION_CHAIN) {
    assert.ok(ATTRIBUTIONS.includes(leg), "the store refuses a leg the chain returns: " + leg);
  }
  assert.deepEqual(
    ATTRIBUTIONS.filter((a) => !ATTRIBUTION_CHAIN.includes(a)),
    ["declared"],
    "`declared` is the only value belonging to no leg — a caller's own statement"
  );
});

// ── leg 1: focus ──────────────────────────────────────────────────────────

test("leg 1 — BACKLOG_TASK in the environment settles it, and outranks everything", () => {
  const decided = attribute({
    env: { BACKLOG_TASK: "TL-7" },
    focus: { task: "TL-9", origin: "focus" },
    filePath: "/x/tasks/TL-11-a.md",
    branch: "tl-12-b",
  }, PATTERNS);
  assert.deepEqual(decided, { task: "TL-7", attribution: "focus" });
});

test("leg 1 — a focus a person set reads as `focus`", () => {
  const decided = attribute({ focus: { task: "TL-9", origin: "focus" } }, PATTERNS);
  assert.deepEqual(decided, { task: "TL-9", attribution: "focus" });
});

// ── leg 2: this session's own `in_progress` write ─────────────────────────

test("leg 2 — a focus left by a take reads as `session-state`, not as `focus`", () => {
  // The two are the same file and must not collapse into one answer: §8 weighs
  // a pointer somebody typed differently from one a status write left behind,
  // and the log has to be able to say afterwards which it was.
  const decided = attribute({ focus: { task: "TL-9", origin: "session-state" } }, PATTERNS);
  assert.deepEqual(decided, { task: "TL-9", attribution: "session-state" });
});

// ── leg 3: the edited file ────────────────────────────────────────────────

test("leg 3 — a task file names its task; a file merely mentioning one does not", () => {
  assert.equal(taskFromPath("/repo/backlog/tasks/TL-28-heartbeats.md", PATTERNS), "TL-28");
  assert.equal(taskFromPath("/repo/docs/TL-28-notes.md", PATTERNS), null,
    "a document ABOUT a task is not evidence of work on it");
  assert.equal(taskFromPath("/repo/backlog/tasks/README.md", PATTERNS), null);
  assert.equal(taskFromPath("", PATTERNS), null);

  const decided = attribute({ filePath: "/repo/backlog/tasks/TL-28-x.md" }, PATTERNS);
  assert.deepEqual(decided, { task: "TL-28", attribution: "path" });
});

// ── leg 4: the branch or worktree ─────────────────────────────────────────

test("leg 4 — the branch leg reads a lowercase branch and answers in the canonical case", () => {
  // The rule in CLAUDE.md names branches `tl-<number>-<slug>` while the prefix
  // is `TL`. A case-sensitive match made this leg dead in the repository that
  // wrote it, which §8.1 recorded as an observation rather than as the defect
  // it is.
  assert.equal(taskFromBranch("tl-28-activity-heartbeats", PATTERNS), "TL-28");
  assert.equal(taskFromBranch("feature/TL-28", PATTERNS), "TL-28");
  assert.equal(taskFromBranch("claude/task-something", PATTERNS), null);
  assert.equal(taskFromBranch("xtl-28-a", PATTERNS), null, "an id has to be whole");
  assert.equal(taskFromBranch("tl-281-a", PATTERNS), "TL-281", "…and greedy about its digits");

  const decided = attribute({ branch: "tl-28-x" }, PATTERNS);
  assert.deepEqual(decided, { task: "TL-28", attribution: "branch" });
});

// ── leg 5: unknown is an answer ───────────────────────────────────────────

test("leg 5 — with nothing to go on the answer is `unknown`, not a guess", () => {
  const decided = attribute({ branch: "main", filePath: "/repo/scripts/cluster.mjs" }, PATTERNS);
  assert.deepEqual(decided, { task: null, attribution: "unknown" });
});

test("the legs are tried in the documented order", () => {
  const all = {
    focus: { task: "TL-1", origin: "focus" },
    filePath: "/x/tasks/TL-2-a.md",
    branch: "tl-3-b",
  };
  assert.equal(attribute(all, PATTERNS).task, "TL-1");
  assert.equal(attribute({ ...all, focus: null }, PATTERNS).task, "TL-2");
  assert.equal(attribute({ ...all, focus: null, filePath: null }, PATTERNS).task, "TL-3");
});

// ── the negative test the whole design turns on ───────────────────────────

test("two sessions on two tasks do not mix — no global `in_progress` is consulted", () => {
  const { backlog, env, ids } = fixture(2);
  const [first, second] = ids;

  const a = { ...env, BACKLOG_SESSION: "session-a" };
  const b = { ...env, BACKLOG_SESSION: "session-b" };

  assert.equal(run(["take", first, "--dir", backlog, "--actor", "local:a"], a).status, 0);
  assert.equal(run(["take", second, "--dir", backlog, "--actor", "local:b"], b).status, 0);

  // Both tasks are now `in_progress` in the SAME tree. A chain reading global
  // state would have to pick one, and would be wrong for one of the two.
  assert.equal(run(["activity", "record", "--dir", backlog, "--actor", "local:a"], a).status, 0);
  assert.equal(run(["activity", "record", "--dir", backlog, "--actor", "local:b"], b).status, 0);

  const firstRows = rows(backlog, first);
  const secondRows = rows(backlog, second);
  assert.equal(firstRows.length, 1, "session a wrote exactly one row, for its own task");
  assert.equal(secondRows.length, 1, "session b wrote exactly one row, for its own task");
  assert.equal(firstRows[0].session, "session-a");
  assert.equal(secondRows[0].session, "session-b");
  assert.equal(firstRows[0].attribution, "session-state");
  assert.equal(secondRows[0].attribution, "session-state");
});

test("a take sets THIS session's focus, and leaves another session's alone", () => {
  const { backlog, env, ids } = fixture(2);
  const a = { ...env, BACKLOG_SESSION: "session-a" };
  const b = { ...env, BACKLOG_SESSION: "session-b" };

  assert.equal(readFocus(backlog, { env: a }), null, "the control: nothing is focused yet");
  assert.equal(run(["take", ids[0], "--dir", backlog, "--actor", "local:a"], a).status, 0);

  const focused = readFocus(backlog, { env: a });
  assert.equal(focused.task, ids[0]);
  assert.equal(focused.origin, "session-state", "an automatic focus is not a typed one");
  assert.equal(readFocus(backlog, { env: b }), null, "the other session must be untouched");
});

test("a session that takes a second task moves to it — the latest write wins", () => {
  const { backlog, env, ids } = fixture(2);
  const a = { ...env, BACKLOG_SESSION: "session-a" };
  assert.equal(run(["take", ids[0], "--dir", backlog, "--actor", "local:a"], a).status, 0);
  assert.equal(run(["take", ids[1], "--dir", backlog, "--actor", "local:a"], a).status, 0);
  assert.equal(readFocus(backlog, { env: a }).task, ids[1]);

  // …and the first task's rows keep the attribution they were written with. The
  // log is append-only; we do not rewrite backwards.
  const r = run(["activity", "record", "--dir", backlog, "--actor", "local:a"], a);
  assert.equal(r.status, 0);
  assert.equal(rows(backlog, ids[0]).length, 0);
  assert.equal(rows(backlog, ids[1]).length, 1);
});

// ── the throttle (§7) ─────────────────────────────────────────────────────

test("N tool calls inside one window produce ONE row, not N", () => {
  const { backlog, env, ids } = fixture();
  const a = { ...env, BACKLOG_SESSION: "session-a" };
  assert.equal(run(["focus", ids[0], "--dir", backlog], a).status, 0);

  for (let i = 0; i < 5; i++) {
    const r = run(["activity", "record", "--dir", backlog, "--actor", "local:me"], a);
    assert.equal(r.status, 0, "a throttled call SUCCEEDS — an error would be a banner over an edit");
  }
  assert.equal(rows(backlog, ids[0]).length, 1);

  // The positive control: without the window the same five calls are five rows,
  // so this test cannot pass against a recorder that writes nothing at all.
  for (let i = 0; i < 4; i++) {
    assert.equal(run(["activity", "record", "--dir", backlog, "--no-throttle", "--actor", "local:me"], a).status, 0);
  }
  assert.equal(rows(backlog, ids[0]).length, 5);
});

test("the window is per kind — a commit row is not swallowed by a stream of tool rows", () => {
  const { backlog, env, ids } = fixture();
  const a = { ...env, BACKLOG_SESSION: "session-a" };
  assert.equal(run(["focus", ids[0], "--dir", backlog], a).status, 0);
  assert.equal(run(["activity", "record", "--dir", backlog, "--actor", "local:me"], a).status, 0);
  assert.equal(run(["activity", "record", "--dir", backlog, "--kind", "commit", "--actor", "local:me"], a).status, 0);
  assert.deepEqual(rows(backlog, ids[0]).map((r) => r.kind), ["tool", "commit"]);
});

test("two sessions are throttled independently", () => {
  const { backlog, env, ids } = fixture();
  const a = { ...env, BACKLOG_SESSION: "session-a", BACKLOG_TASK: ids[0] };
  const b = { ...env, BACKLOG_SESSION: "session-b", BACKLOG_TASK: ids[0] };
  assert.equal(run(["activity", "record", "--dir", backlog, "--actor", "local:a"], a).status, 0);
  assert.equal(run(["activity", "record", "--dir", backlog, "--actor", "local:b"], b).status, 0);
  assert.equal(rows(backlog, ids[0]).length, 2, "one session's window must not silence another's");
});

// ── the core works without any host ───────────────────────────────────────

test("`activity record` writes a row from the command line alone", () => {
  // §7's constraint: the core must not require an adapter. No hook, no payload,
  // no editor — just the CLI and a stated task.
  const { backlog, env, ids } = fixture();
  const r = run(["activity", "record", "--dir", backlog, "--task", ids[0], "--kind", "tool",
    "--actor", "local:founder"], env);
  assert.equal(r.status, 0, r.stderr);
  const written = rows(backlog, ids[0]);
  assert.equal(written.length, 1);
  assert.equal(written[0].actor, "local:founder");
  assert.equal(written[0].attribution, "declared", "a task the caller stated is a statement, not an inference");
});

test("an unknown flag fails instead of being ignored", () => {
  const { backlog, env } = fixture();
  const r = run(["activity", "record", "--dir", backlog, "--frobnicate"], env);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown flag/);
});

test("an unknown kind and an actor with no namespace are both refused", () => {
  const { backlog, env, ids } = fixture();
  assert.equal(run(["activity", "record", "--dir", backlog, "--task", ids[0], "--kind", "vibes"], env).status, 2);
  const bad = run(["activity", "record", "--dir", backlog, "--task", ids[0], "--actor", "nobody"], env);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /namespace/);
  assert.equal(rows(backlog, ids[0]).length, 0, "nothing may be appended before the row is valid");
});

test("nothing is written when no leg names a task", () => {
  const { backlog, env } = fixture();
  const r = run(["activity", "record", "--dir", backlog, "--actor", "local:me", "--branch", "main"], env);
  assert.equal(r.status, 0, "an unattributed heartbeat is not an error");
  assert.equal(existsSync(join(backlog, "activity")), false, "…and it is not a file either");
});

// ── the host's payload is a hint ──────────────────────────────────────────

test("a hook payload fills in what the caller did not say, and never overrides it", () => {
  const payload = {
    session_id: "abc123", tool_name: "Bash", cwd: "/somewhere",
    tool_input: { file_path: "/repo/backlog/tasks/TL-5-x.md" },
  };
  assert.deepEqual(signalsFromPayload(payload), {
    session: "abc123", file: "/repo/backlog/tasks/TL-5-x.md", cwd: "/somewhere", tool: "Bash",
  });
  assert.deepEqual(signalsFromPayload(null), { session: null, file: null, cwd: null, tool: null });
});

test("a payload on stdin attributes the row through the file it names", () => {
  const { backlog, env, ids } = fixture();
  const file = join(backlog, "tasks",
    readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(ids[0] + "-")));
  const payload = JSON.stringify({
    session_id: "hook-session", tool_name: "Edit", tool_input: { file_path: file },
  });
  const r = run(["activity", "record", "--dir", backlog, "--actor", "agent:claude"], env, { input: payload });
  assert.equal(r.status, 0, r.stderr);
  const written = rows(backlog, ids[0]);
  assert.equal(written.length, 1);
  assert.equal(written[0].attribution, "path");
  assert.equal(written[0].session, "hook-session");
  assert.equal(written[0].source, "hook");
});

test("a malformed payload does not fail the tool call it rode in on", () => {
  const { backlog, env, ids } = fixture();
  const r = run(["activity", "record", "--dir", backlog, "--task", ids[0], "--actor", "local:me"],
    env, { input: "{not json" });
  assert.equal(r.status, 0, "the host's payload is the host's problem");
  assert.equal(rows(backlog, ids[0]).length, 1);
});

// ── the adapter ───────────────────────────────────────────────────────────

test("the PostToolUse matcher covers every tool, not Edit|Write|MultiEdit", () => {
  // The gate the acceptance criteria ask for, as a test as well as a command:
  // a matcher over a subset undercounts in a way CORRELATED with the kind of
  // work, which looks like signal and goes straight into calibration.
  const settings = JSON.parse(readFileSync(join(REPO_ROOT, ".claude", "settings.json"), "utf8"));
  const hooks = settings.hooks.PostToolUse;
  const activity = hooks.filter((h) =>
    JSON.stringify(h).includes("activity-hook") || JSON.stringify(h).includes("activity record"));
  assert.equal(activity.length, 1, "exactly one entry feeds the activity log");
  assert.ok(["", "*"].includes(activity[0].matcher) || activity[0].matcher.includes("Bash"),
    "the activity adapter does not see Bash: " + activity[0].matcher);
});

test("the adapter stays silent and exits 0 when there is nothing to attribute", () => {
  const { backlog, env } = fixture();
  const script = join(HERE, "..", "activity-hook.sh");
  const r = spawnSync("sh", [script], {
    encoding: "utf8", timeout: 30_000,
    cwd: backlog,
    env: { ...env, BACKLOG_DIR: backlog, BACKLOG_SESSION: "hook-session" },
    input: JSON.stringify({ session_id: "hook-session", tool_name: "Bash", tool_input: {} }),
  });
  assert.equal(r.status, 0, "a hook that fails paints an error over an edit that worked");
  assert.equal(r.stdout, "", "silent on a miss — it fires after every tool call");
  assert.equal(r.stderr, "");
});

// ── the `focus` command ───────────────────────────────────────────────────

test("focus points, reports and clears — and refuses a task that does not exist", () => {
  const { backlog, env, ids } = fixture();
  const a = { ...env, BACKLOG_SESSION: "session-a" };

  const empty = run(["focus", "--dir", backlog, "--json"], a);
  assert.equal(empty.status, 0);
  assert.equal(JSON.parse(empty.stdout).focus, null);

  assert.equal(run(["focus", ids[0], "--dir", backlog], a).status, 0);
  const shown = JSON.parse(run(["focus", "--dir", backlog, "--json"], a).stdout);
  assert.equal(shown.focus.task, ids[0]);
  assert.equal(shown.focus.origin, "focus");

  const typo = run(["focus", "TL-99999", "--dir", backlog], a);
  assert.equal(typo.status, 1, "a pointer at a typo would send a whole session's measurement nowhere");
  assert.equal(JSON.parse(run(["focus", "--dir", backlog, "--json"], a).stdout).focus.task, ids[0],
    "…and it must not have moved the existing one");

  assert.equal(run(["focus", "--clear", "--dir", backlog], a).status, 0);
  assert.equal(JSON.parse(run(["focus", "--dir", backlog, "--json"], a).stdout).focus, null);
});

test("focus does not claim the task", () => {
  const { backlog, env, ids } = fixture();
  assert.equal(run(["focus", ids[0], "--dir", backlog], env).status, 0);
  const file = join(backlog, "tasks",
    readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(ids[0] + "-")));
  assert.match(readFileSync(file, "utf8"), /^status: pending$/m,
    "a pointer is a statement about this session, not about the backlog");
});

test("`--clear` and a task id contradict each other and are refused together", () => {
  assert.throws(() => parseFocusArgs(["TL-1", "--clear"]), /opposite/);
  assert.throws(() => parseFocusArgs(["TL-1", "TL-2"]), /one task/);
  assert.throws(() => parseFocusArgs(["--nope"]), /unknown flag/);
  assert.deepEqual(parseFocusArgs([]), { id: null, clear: false, actor: null, json: false });
});

test("`record`'s defaults are the ones the adapter relies on", () => {
  const plan = parseRecordArgs([]);
  assert.equal(plan.kind, "tool");
  assert.equal(plan.throttle, true);
  assert.equal(plan.task, null);
  assert.throws(() => parseRecordArgs(["--task"]), /with no value/);
  assert.throws(() => parseRecordArgs(["--kind", "vibes"]), /unknown kind/);
});

// ── the session key ───────────────────────────────────────────────────────

test("the session falls back to the worktree, and never to the process", () => {
  // A per-process id would look finer-grained and be worse: every command is
  // its own process, so every heartbeat would land in a session of one row and
  // every run would be a single — zero minutes, forever.
  const one = sessionId({ env: {}, root: "/repo/a" });
  const again = sessionId({ env: {}, root: "/repo/a" });
  const other = sessionId({ env: {}, root: "/repo/b" });
  assert.equal(one, again, "two processes in one tree are one session");
  assert.notEqual(one, other);
  assert.equal(sessionId({ env: { BACKLOG_SESSION: "given" }, root: "/repo/a" }), "given");
});

test("a focus with no task is refused rather than written empty", () => {
  const { backlog, env } = fixture();
  assert.throws(() => writeFocus(backlog, { task: "", origin: "focus" }, { env }), /no task/);
  assert.equal(readFocus(backlog, { env }), null);
});

test("a corrupt session file is dropped, not thrown at the caller", () => {
  const { backlog, env, ids } = fixture(1);
  const a = { ...env, BACKLOG_SESSION: "session-a" };
  assert.equal(run(["focus", ids[0], "--dir", backlog], a).status, 0);

  const dir = join(env.BACKLOG_STATE_DIR, "sessions");
  const scope = readdirSync(dir)[0];
  writeFileSync(join(dir, scope, "session-a.json"), "{ truncated", "utf8");
  assert.equal(readFocus(backlog, { env: a }), null);
  assert.equal(run(["focus", "--dir", backlog], a).status, 0, "session state is a cache, not a truth");
});
