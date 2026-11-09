/**
 * `plan` names a wave held shut by tasks no unattended run will take (TL-645).
 *
 * WHAT WAS MEASURED. On 2026-11-07 the active wave's only open task sat in
 * `awaiting_vouch`. `plan` printed it as "next up", while `run --dry-run
 * --plan` answered that nothing would run and stopped at that wave; every
 * pending task behind it was unreachable. Another wave's only task was a claim
 * `audit` already reported as parked, and `plan` showed it as plain work in
 * progress. A stalled plan read exactly like a plan with work in it.
 *
 * WHAT EACH CASE PROVES:
 *
 *   the control       — the same fixture with both tasks pending is NOT held,
 *                       lists both as next up, and the projection walks past
 *                       it. Without it every "held" assertion below would be
 *                       green against a `plan` that calls every wave held.
 *   the held wave     — an awaiting-vouch task and a parked claim: `plan` and
 *                       `plan --json` say the wave is held, name one reason
 *                       per task, list no next up, and stop where `run
 *                       --dry-run --plan` stops, with the same sentences.
 *   parked is audit's — the claim `plan` calls parked is the one `audit`
 *                       reports as parked, in the same tree.
 *   the predicate     — `unattendedHold` against the dispatcher's rules: a
 *                       discharged protected status, an abandoned claim and a
 *                       plain pending task are not holds; a person-only task is
 *                       a hold and still next up. A status that releases a task
 *                       releases it to the person-only and over-size gates, not
 *                       past them, because `selectCandidates` applies those to
 *                       every record before it reads a status.
 *   withheld, named   — a task left out of next up is named with its hold in
 *                       every active wave, held or not, and the empty next-up
 *                       line does not blame a blocker for a hold.
 *   the edges         — the day a claim turns parked or abandoned, a history
 *                       entry newer than `updated:`, a question or a park that
 *                       a later write superseded, a closed task inside a held
 *                       wave: each case a mutation run showed no assertion
 *                       above would notice.
 *
 * EVERY CASE RUNS ON A FIXTURE TREE whose vocabulary it writes itself, never on
 * this repository's own plan (AGENTS.md: do not assert another project's values).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fixtureDir } from "./_fixture-dir.mjs";
import { isolateHome, plainOutput, SCRIPTS_DIR } from "./_repo.mjs";
import { describeHold, planState, projectionWall, unattendedHold } from "../plan.mjs";
import { renderPlan } from "../plan-report.mjs";
import { FIELD_COMMENT, FIELD_DECISION } from "../task-fields.mjs";

isolateHome("plan-held-wave");
plainOutput();

const CLI = join(SCRIPTS_DIR, "cli.mjs");
let counter = 0;

function cli(args, env) {
  const r = spawnSync(process.execPath, [CLI].concat(args), { encoding: "utf8", timeout: 30_000, env });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

function taskPath(backlog, id) {
  const file = readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-"));
  assert.ok(file, "no file for " + id);
  return join(backlog, "tasks", file);
}

function setField(backlog, id, field, value) {
  const path = taskPath(backlog, id);
  const text = readFileSync(path, "utf8");
  const next = text.replace(new RegExp("^" + field + ":.*$", "m"), field + ": " + value);
  assert.notEqual(next, text, "the fixture has no `" + field + ":` line to set");
  writeFileSync(path, next, "utf8");
}

/**
 * Wave 1 holds two tasks, wave 2 one. The vocabulary is the fixture's own: it
 * declares an awaiting-vouch status and a staleness window, which `init` does
 * not, so the test does not depend on anybody's defaults.
 */
function tree() {
  const dir = fixtureDir(join(tmpdir(), "branchling-held-wave-" + counter++ + "-"));
  const backlog = join(dir, "bl");
  const env = { ...process.env, BACKLOG_STATE_DIR: join(dir, "state"), NO_COLOR: "1" };
  assert.equal(cli(["init", "--dir", backlog, "--no-example"], env).code, 0);
  const configPath = join(backlog, "config.yaml");
  const config = readFileSync(configPath, "utf8");
  const statuses = config.replace(/^statuses:.*$/m,
    "statuses: [pending, in_progress, awaiting_vouch, blocked, done, cancelled]");
  assert.notEqual(statuses, config, "the fixture config has no `statuses:` line");
  writeFileSync(configPath, statuses + "\nawaiting_vouch_status: awaiting_vouch\naudit_stale_days: 14\n", "utf8");

  const ids = {};
  for (const [key, title] of [
    ["vouch", "Finished work a person has to vouch for"],
    ["claim", "A claim nobody has touched for months"],
    ["behind", "The work waiting behind the held wave"],
  ]) {
    const r = cli(["new", "--dir", backlog, "--title", title], env);
    assert.equal(r.code, 0, r.err);
    ids[key] = (r.out.match(/([A-Z]+-\d+)/) || [])[1];
    assert.ok(ids[key], "the fixture task got no id: " + r.out);
  }
  writeFileSync(join(backlog, "plan.yaml"), [
    "updated: 2026-11-07", 'rationale: "fixture"', "waves:",
    '  - name: "Held"', "    tasks: [" + ids.vouch + ", " + ids.claim + "]",
    '  - name: "Behind"', "    tasks: [" + ids.behind + "]", "",
  ].join("\n"), "utf8");
  return { backlog, env, ids };
}

/** Put the wave-1 tasks into the state measured on 2026-11-07. */
function hold(f) {
  setField(f.backlog, f.ids.vouch, "status", "awaiting_vouch");
  setField(f.backlog, f.ids.claim, "status", "in_progress");
  setField(f.backlog, f.ids.claim, "owner", "agent:gone");
  setField(f.backlog, f.ids.claim, "updated", "2026-01-05");
  // `audit` reads the last recorded change from the history as well as from
  // `updated:`, and `new` recorded today. The log is rewritten to one old entry.
  writeFileSync(join(f.backlog, "history", f.ids.claim + ".jsonl"), JSON.stringify({
    id: "01M0000000000000000000000A", ts: "2026-01-05T09:00:00.000Z", task: f.ids.claim,
    field: "status", from: "pending", to: "in_progress", actor: "agent:gone", source: "next", reason: "unknown",
  }) + "\n", "utf8");
}

function planJson(f) {
  const r = cli(["plan", "--dir", f.backlog, "--json"], f.env);
  assert.equal(r.code, 0, r.out + r.err);
  return JSON.parse(r.out);
}

function dryRun(f, json) {
  const args = ["run", "--dir", f.backlog, "--dry-run", "--plan", "--actor", "agent:mine"];
  if (json) args.push("--json");
  const r = cli(args, f.env);
  assert.equal(r.code, 0, r.out + r.err);
  return json ? JSON.parse(r.out) : r.out;
}

test("POSITIVE CONTROL: a wave a run can take is not held, and the projection walks past it", () => {
  const f = tree();
  const state = planJson(f);
  assert.equal(state.activeWave, 0);
  assert.equal(state.waves[0].held, false, "a wave of two pending tasks was called held");
  assert.deepEqual(state.nextUp.map((e) => e.ids[0]), [f.ids.vouch, f.ids.claim]);
  assert.doesNotMatch(cli(["plan", "--dir", f.backlog], f.env).out, /\bheld\b/);

  const dry = dryRun(f, true);
  assert.deepEqual(dry.order.map((o) => o.id), [f.ids.vouch, f.ids.claim, f.ids.behind]);
  assert.equal(dry.stoppedAt, null);
});

test("plan --json says the wave is held, why for each task, and lists no next up", () => {
  const f = tree();
  hold(f);
  const state = planJson(f);
  assert.equal(state.activeWave, 0);
  const wave = state.waves[0];
  assert.equal(wave.held, true, JSON.stringify(wave));
  assert.deepEqual(state.nextUp, [], "next up lists a task `next --plan` hands out to nobody");
  const kinds = Object.fromEntries(wave.tasks.map((e) => [e.id, e.hold && e.hold.kind]));
  assert.deepEqual(kinds, { [f.ids.vouch]: "awaiting-vouch", [f.ids.claim]: "parked-claim" });
  const claim = wave.tasks.find((e) => e.id === f.ids.claim).hold;
  assert.equal(claim.owner, "agent:gone");
  assert.equal(claim.lastChange, "2026-01-05");
  assert.equal(claim.staleDays, 14);
  assert.ok(claim.days > 14, JSON.stringify(claim));
  // The later wave is not held: it is merely behind the held one.
  assert.equal(state.waves[1].held, false);
});

test("plan prints the wave as held with one reason per task, and agrees with run --dry-run --plan", () => {
  const f = tree();
  hold(f);
  const text = cli(["plan", "--dir", f.backlog], f.env).out;
  const section = text.slice(text.indexOf("next up"), text.indexOf("in progress:"));
  assert.match(section, /next up \(wave 1 — Held\):\n\s+none — no open task of this wave is one `next` hands out/, section);
  assert.match(section, /held — no unattended run will take any open task of this wave/, section);

  const dry = dryRun(f, true);
  assert.deepEqual(dry.order, [], "the projection listed work behind a held wave");
  assert.equal(dry.stoppedAt.wave, 1, "plan and the projection disagree about where it stops");
  assert.equal(dry.stoppedAt.held, true);
  assert.deepEqual(dry.stoppedAt.holds.map((h) => h.id).sort(), [f.ids.claim, f.ids.vouch].sort());

  // ONE WORDING: every reason the projection gives is the line `plan` prints.
  for (const h of dry.stoppedAt.holds) {
    assert.ok(section.includes(h.id + "  " + h.reason), "plan does not say what the run says about " +
      h.id + ": " + h.reason + "\n" + section);
  }
  assert.match(dry.stoppedAt.holds.find((h) => h.id === f.ids.vouch).reason, /awaiting a person's vouch/);
  assert.match(dry.stoppedAt.holds.find((h) => h.id === f.ids.claim).reason,
    /claim parked for \d+ day\(s\) by agent:gone — no recorded change since 2026-01-05/);

  const plain = dryRun(f, false);
  for (const h of dry.stoppedAt.holds) assert.ok(plain.includes(h.id + "  " + h.reason), plain);
});

test("the claim plan calls parked is the claim audit reports as parked", () => {
  const f = tree();
  hold(f);
  const r = cli(["audit", "--dir", f.backlog, "--json"], f.env);
  const parked = JSON.parse(r.out).parked.map((p) => p.task);
  assert.deepEqual(parked, [f.ids.claim], r.out);
  const claim = planJson(f).waves[0].tasks.find((e) => e.id === f.ids.claim).hold;
  assert.equal(claim.kind, "parked-claim");
});

// ── The predicate against the dispatcher's own rules ──────────────────────

const CONFIG = {
  archivedStatuses: ["done", "cancelled"],
  inProgressStatus: "in_progress",
  awaitingVouchStatus: "awaiting_vouch",
  reasonRequiredStatuses: ["blocked", "cancelled"],
  auditStaleDays: 7,
  abandonedAfterDays: 0,
  estimates: ["30m", "2h", "1d", "1w"],
  maxUnattendedEstimate: "1d",
  now: Date.parse("2026-11-08T12:00:00Z"),
};
const t = (id, fields = {}) => ({ id, status: "pending", blocked_by: [], history: [], ...fields });
const index = (tasks) => new Map(tasks.map((x) => [x.id.toUpperCase(), x]));

test("a protected status is a hold unless its named blockers have discharged it", () => {
  const done = t("TL-1", { status: "done" });
  const open = t("TL-2");
  const byId = index([done, open]);
  assert.equal(unattendedHold(t("TL-3", { status: "blocked", blocked_by: ["TL-1"] }), byId, CONFIG), null);
  const nothing = unattendedHold(t("TL-4", { status: "blocked" }), byId, CONFIG);
  assert.equal(nothing.kind, "protected-status");
  assert.match(describeHold(nothing), /nothing is named in `blocked_by`/);
  assert.deepEqual(unattendedHold(t("TL-5", { status: "blocked", blocked_by: ["TL-2"] }), byId, CONFIG).blockedBy, ["TL-2"]);
  const parked = unattendedHold(t("TL-6", {
    status: "blocked", blocked_by: ["TL-1"],
    history: [{ field: "status", to: "blocked", park: true, ts: "2026-11-01T00:00:00Z" }],
  }), byId, CONFIG);
  assert.equal(parked.kind, "protected-status", "a run's park was read as a discharged block");
});

test("a claim is a hold until it is abandoned, and parked only past audit_stale_days", () => {
  const byId = index([]);
  const fresh = unattendedHold(t("TL-1", { status: "in_progress", owner: "agent:a", updated: "2026-11-07" }), byId, CONFIG);
  assert.equal(fresh.kind, "claimed");
  const old = unattendedHold(t("TL-2", { status: "in_progress", owner: "agent:a", updated: "2026-10-01" }), byId, CONFIG);
  assert.equal(old.kind, "parked-claim");
  assert.equal(old.days, 38);
  const abandoned = { ...CONFIG, abandonedAfterDays: 30 };
  assert.equal(unattendedHold(t("TL-3", { status: "in_progress", updated: "2026-10-01" }), byId, abandoned), null,
    "a claim `next` reclaims was called a hold");
  const unclocked = { ...CONFIG, now: undefined };
  assert.equal(unattendedHold(t("TL-4", { status: "in_progress", updated: "2026-01-01" }), byId, unclocked).kind, "claimed");
});

test("a person-only or over-size task is a hold and still next up; a plain one is neither", () => {
  const human = t("TL-1", { executor: "human" });
  const big = t("TL-2", { estimate: "1w" });
  const plain = t("TL-3", { estimate: "2h" });
  const vouch = t("TL-4", { status: "awaiting_vouch" });
  const tasks = [human, big, plain, vouch];
  const byId = index(tasks);
  assert.equal(unattendedHold(plain, byId, CONFIG), null);
  assert.equal(unattendedHold(human, byId, CONFIG).kind, "person-only");
  assert.equal(unattendedHold(big, byId, CONFIG).kind, "over-size");

  const state = planState({ waves: [{ name: "w", tasks: tasks.map((x) => x.id), together: [] }] }, tasks, CONFIG);
  assert.deepEqual(state.nextUp.map((e) => e.ids[0]), ["TL-1", "TL-2", "TL-3"]);
  assert.equal(state.waves[0].held, false, "a wave with a plain pending task is not held");

  const allHeld = [human, big, vouch];
  const shut = planState({ waves: [{ name: "w", tasks: allHeld.map((x) => x.id), together: [] }] }, allHeld, CONFIG);
  assert.equal(shut.waves[0].held, true);
  assert.deepEqual(shut.nextUp.map((e) => e.ids[0]), ["TL-1", "TL-2"]);
});

test("a status that releases a task releases it to the person-only and over-size gates", () => {
  const done = t("TL-1", { status: "done" });
  const byId = index([done]);
  // Each of these is dropped by `selectCandidates` for an agent caller before
  // any status is read, so a run never takes it: it must not come back null.
  const dischargedHuman = unattendedHold(t("TL-2", { status: "blocked", blocked_by: ["TL-1"], executor: "human" }), byId, CONFIG);
  assert.equal(dischargedHuman && dischargedHuman.kind, "person-only");
  const dischargedBig = unattendedHold(t("TL-3", { status: "blocked", blocked_by: ["TL-1"], estimate: "1w" }), byId, CONFIG);
  assert.equal(dischargedBig && dischargedBig.kind, "over-size");
  assert.equal(dischargedBig.estimate, "1w");
  assert.equal(dischargedBig.limit, "1d");
  const abandoned = { ...CONFIG, abandonedAfterDays: 30 };
  const reclaimHuman = unattendedHold(t("TL-4", { status: "in_progress", updated: "2026-09-01", executor: "human" }), byId, abandoned);
  assert.equal(reclaimHuman && reclaimHuman.kind, "person-only");
  const reclaimBig = unattendedHold(t("TL-5", { status: "in_progress", updated: "2026-09-01", estimate: "1w" }), byId, abandoned);
  assert.equal(reclaimBig && reclaimBig.kind, "over-size");
  // A status hold still outranks the record gates: a claim is not startable.
  const claimedHuman = unattendedHold(t("TL-6", { status: "in_progress", updated: "2026-11-07", executor: "human" }), byId, CONFIG);
  assert.equal(claimedHuman.kind, "claimed");
});

test("the size gate holds only an estimate later than the threshold, both in the vocabulary", () => {
  const byId = index([]);
  assert.equal(unattendedHold(t("TL-1", { estimate: "1d" }), byId, CONFIG), null, "the threshold itself was held");
  assert.equal(unattendedHold(t("TL-2", { estimate: "3mo" }), byId, CONFIG), null, "an unknown estimate was held");
  assert.equal(unattendedHold(t("TL-3", { estimate: "1w" }), byId, { ...CONFIG, maxUnattendedEstimate: "" }), null);
  assert.equal(unattendedHold(t("TL-4", { estimate: "1w" }), byId, { ...CONFIG, maxUnattendedEstimate: "9y" }), null);
});

test("every hold has its own sentence, naming the key that decided it", () => {
  const cases = [
    [{ kind: "awaiting-vouch", status: "awaiting_vouch" }, "awaiting a person's vouch (status `awaiting_vouch`)"],
    [{ kind: "protected-status", status: "blocked", blockedBy: [], asked: true, parkedByRun: true },
      "in `blocked`, a status `reason_required_statuses` protects — an open question is waiting for a decision"],
    [{ kind: "protected-status", status: "blocked", blockedBy: ["TL-2"], asked: false, parkedByRun: true },
      "in `blocked`, a status `reason_required_statuses` protects — a run parked it there"],
    [{ kind: "protected-status", status: "blocked", blockedBy: ["TL-2", "TL-3"], asked: false, parkedByRun: false },
      "in `blocked`, a status `reason_required_statuses` protects — waiting on TL-2, TL-3"],
    [{ kind: "parked-claim", days: 40, owner: "agent:a", lastChange: "2026-09-29", staleDays: 14 },
      "claim parked for 40 day(s) by agent:a — no recorded change since 2026-09-29 (`audit_stale_days` is 14)"],
    [{ kind: "parked-claim", days: 40, owner: "", lastChange: "2026-09-29", staleDays: 14 },
      "claim parked for 40 day(s) by nobody — no recorded change since 2026-09-29 (`audit_stale_days` is 14)"],
    [{ kind: "claimed", owner: "agent:a", lastChange: "2026-11-07" }, "claimed by agent:a — work in flight, last change 2026-11-07"],
    [{ kind: "claimed", owner: "", lastChange: null }, "claimed by nobody — work in flight"],
    [{ kind: "person-only" }, "asks for an executor an unattended run is not (human)"],
    [{ kind: "over-size", estimate: "1w", limit: "1d" }, "estimate 1w is above `max_unattended_estimate` (1d)"],
    [{ kind: "something-new" }, "something-new"],
  ];
  for (const [hold, sentence] of cases) assert.equal(describeHold(hold), sentence);
  assert.equal(describeHold(null), "");
});

// ── What plan prints for a task it leaves out of next up ──────────────────

const PLAIN = new Proxy({}, { get: () => (s) => String(s) });
const RENDER = { ...CONFIG, projectName: "Fixture", statuses: ["pending", "in_progress", "awaiting_vouch", "blocked", "done", "cancelled"] };

function rendered(tasks, outside = []) {
  const plan = { waves: [{ name: "One", tasks: tasks.map((x) => x.id), together: [] }] };
  const state = planState(plan, tasks.concat(outside), RENDER);
  const text = renderPlan(state, RENDER, { color: PLAIN, columns: 120 });
  return { state, section: text.slice(text.indexOf("next up"), text.indexOf("in progress:")) };
}

test("an empty next up caused by a claim names the claim, not a blocker", () => {
  const { state, section } = rendered([
    t("TL-2", { status: "in_progress", owner: "agent:a", updated: "2026-11-07" }),
    t("TL-3", { blocked_by: ["TL-2"] }),
  ]);
  assert.equal(state.waves[0].held, false, "TL-3 has no hold, so the wave is not held");
  assert.deepEqual(state.nextUp, []);
  assert.doesNotMatch(section, /every open task of this wave is waiting on a blocker/, section);
  assert.match(section, /none — `next` hands out the tasks named below to nobody now, and the rest wait on a blocker/, section);
  assert.match(section, /withheld — `next` hands these out to nobody now:\n {4}TL-2 {2}claimed by agent:a — work in flight, last change 2026-11-07\n/, section);
  assert.doesNotMatch(section, /TL-3 {2}/, "a task waiting on a blocker was named as withheld");
});

test("an empty next up caused by a vouch names the vouch, not a blocker", () => {
  const { section } = rendered([t("TL-2", { status: "awaiting_vouch" }), t("TL-3", { blocked_by: ["TL-2"] })]);
  assert.doesNotMatch(section, /every open task of this wave is waiting on a blocker/, section);
  assert.match(section, /withheld — [^\n]*\n {4}TL-2 {2}awaiting a person's vouch \(status `awaiting_vouch`\)/, section);
});

test("a wave that is not held still names the tasks it withholds beside its next up", () => {
  const { state, section } = rendered([
    t("TL-2", { status: "awaiting_vouch" }),
    t("TL-3", { status: "blocked" }),
    t("TL-4"),
  ]);
  assert.equal(state.waves[0].held, false);
  assert.deepEqual(state.nextUp.map((e) => e.ids), [["TL-4"]]);
  assert.doesNotMatch(section, /none —/, section);
  assert.doesNotMatch(section, /\bheld\b/, section);
  const lines = section.split("\n");
  const at = lines.findIndex((l) => /withheld — /.test(l));
  assert.ok(at > 0, section);
  assert.equal(lines[at], "  withheld — `next` hands these out to nobody now:");
  assert.deepEqual(lines.slice(at + 1, at + 3), [
    "    TL-2  awaiting a person's vouch (status `awaiting_vouch`)",
    "    TL-3  in `blocked`, a status `reason_required_statuses` protects — nothing is named in `blocked_by`",
  ]);
});

test("a wave with no hold names nothing as withheld and keeps the blocker sentence", () => {
  const { section } = rendered([t("TL-2", { blocked_by: ["TL-9"] })], [t("TL-9")]);
  assert.match(section, /none — every open task of this wave is waiting on a blocker/, section);
  assert.doesNotMatch(section, /withheld|held —/, section);
});

// ── The edges a mutation run found unasserted ─────────────────────────────

const MIDNIGHT = { ...CONFIG, now: Date.parse("2026-11-08T00:00:00Z") };
const claim = (id, fields = {}) => t(id, { status: "in_progress", owner: "agent:a", ...fields });

test("a claim is abandoned from the day abandoned_after_days says, and not one day before", () => {
  const byId = index([]);
  const window = { ...MIDNIGHT, abandonedAfterDays: 30 };
  assert.equal(unattendedHold(claim("TL-1", { updated: "2026-10-09" }), byId, window), null,
    "a claim exactly abandoned_after_days old is reclaimed by `next`");
  const younger = unattendedHold(claim("TL-2", { updated: "2026-10-20" }), byId, window);
  assert.equal(younger && younger.kind, "parked-claim", "a claim younger than the window was released");
  const fresh = unattendedHold(claim("TL-3", { updated: "2026-11-07" }), byId, window);
  assert.equal(fresh && fresh.kind, "claimed");
  const undated = unattendedHold(claim("TL-4", { updated: "someday" }), byId, window);
  assert.equal(undated && undated.kind, "claimed", "no date was read as an old date");
});

test("a claim is parked only past audit_stale_days, counted from its last recorded change", () => {
  const byId = index([]);
  // Cutoff 2026-11-01: a change ON that day is not older than it.
  const edge = unattendedHold(claim("TL-1", { updated: "2026-11-01" }), byId, CONFIG);
  assert.equal(edge.kind, "claimed", "the cutoff day itself was called parked");
  const past = unattendedHold(claim("TL-2", { updated: "2026-10-31" }), byId, CONFIG);
  assert.deepEqual([past.kind, past.days, past.lastChange], ["parked-claim", 8, "2026-10-31"]);

  // The later of `updated:` and the history, in either order.
  const touched = unattendedHold(claim("TL-3", {
    updated: "2026-10-01",
    history: [{ field: "owner", ts: "2026-09-01T10:00:00Z" }, { field: "owner", ts: "2026-11-07T10:00:00Z" }],
  }), byId, CONFIG);
  assert.deepEqual([touched.kind, touched.lastChange], ["claimed", "2026-11-07"]);
  const older = unattendedHold(claim("TL-4", {
    updated: "2026-11-07", history: [{ field: "owner", ts: "2026-09-01T10:00:00Z" }],
  }), byId, CONFIG);
  assert.deepEqual([older.kind, older.lastChange], ["claimed", "2026-11-07"]);

  const unset = unattendedHold(claim("TL-5", { updated: "2026-01-01" }), byId, { ...CONFIG, auditStaleDays: undefined });
  assert.equal(unset.kind, "claimed", "a project with no staleness window called a claim parked");
  const nulled = unattendedHold(claim("TL-7", { updated: "2026-01-01" }), byId, { ...CONFIG, auditStaleDays: null });
  assert.equal(nulled.kind, "claimed", "an empty `audit_stale_days` was read as a window of zero days");
  const undated = unattendedHold(claim("TL-6", { owner: "  agent:b  " }), byId, CONFIG);
  assert.deepEqual([undated.kind, undated.lastChange, undated.owner], ["claimed", null, "agent:b"]);
  const ownerless = unattendedHold(t("TL-8", { status: "in_progress", updated: "2026-11-07" }), byId, CONFIG);
  assert.equal(ownerless.owner, "");
  assert.equal(describeHold(ownerless), "claimed by nobody — work in flight, last change 2026-11-07");
});

test("a protected status reads its question and its park from the latest record", () => {
  const done = t("TL-1", { status: "done" });
  const byId = index([done]);
  const unnamed = unattendedHold({ id: "TL-2", status: "blocked", history: [] }, byId, CONFIG);
  assert.deepEqual([unnamed.kind, unnamed.named, unnamed.blockedBy], ["protected-status", 0, []]);

  const question = { id: "Q1", field: FIELD_COMMENT, source: "ask", ts: "2026-11-01T00:00:00Z" };
  const asked = unattendedHold(t("TL-3", { status: "blocked", blocked_by: ["TL-1"], history: [question] }), byId, CONFIG);
  assert.equal(asked && asked.asked, true, "a discharged block with an open question was released");
  assert.match(describeHold(asked), /an open question is waiting for a decision/);
  const decided = { id: "D1", field: FIELD_DECISION, resolves: "Q1", ts: "2026-11-02T00:00:00Z" };
  assert.equal(unattendedHold(t("TL-4", { status: "blocked", blocked_by: ["TL-1"], history: [question, decided] }), byId, CONFIG), null);

  const park = { field: "status", from: "in_progress", to: "blocked", park: true, ts: "2026-11-01T00:00:00Z" };
  const later = unattendedHold(t("TL-5", {
    status: "blocked", blocked_by: ["TL-1"], history: [park, { field: "owner", ts: "2026-11-02T00:00:00Z" }],
  }), byId, CONFIG);
  assert.equal(later && later.parkedByRun, true, "a write after the park hid it");
  const redeclared = [park, { field: "status", from: "blocked", to: "pending", ts: "2026-11-02T00:00:00Z" },
    { field: "status", from: "pending", to: "blocked", ts: "2026-11-03T00:00:00Z" }];
  assert.equal(unattendedHold(t("TL-6", { status: "blocked", blocked_by: ["TL-1"], history: redeclared }), byId, CONFIG), null,
    "a person's later declaration was read as the run's earlier park");
});

test("nothing closed or missing carries a hold, and the record gates read trimmed values", () => {
  const byId = index([]);
  assert.equal(unattendedHold(null, byId, CONFIG), null);
  assert.equal(unattendedHold(t("TL-1", { status: "done", executor: "human", estimate: "1w" }), byId, CONFIG), null);
  assert.deepEqual(unattendedHold(t("TL-2", { executor: " human " }), byId, CONFIG),
    { kind: "person-only", startable: true, executor: "human" });
  const big = unattendedHold(t("TL-3", { estimate: " 1w " }), byId, { ...CONFIG, maxUnattendedEstimate: " 1d " });
  assert.deepEqual([big.kind, big.estimate, big.limit], ["over-size", "1w", "1d"]);
  const smallest = unattendedHold(t("TL-4", { estimate: "2h" }), byId, { ...CONFIG, maxUnattendedEstimate: "30m" });
  assert.equal(smallest && smallest.kind, "over-size", "the first estimate of the vocabulary was not a threshold");
});

test("planState reads blockers by the dispatcher's ids, and a closed task neither holds nor opens a wave", () => {
  const blocker = t("TL-1", { status: "done" });
  const discharged = t("TL-2", { status: "blocked", blocked_by: ["tl-1"] });
  const open = planState({ waves: [{ name: "w", tasks: ["TL-2"], together: [] }] }, [blocker, discharged], CONFIG);
  assert.equal(open.waves[0].tasks[0].hold, null, "a block its blocker discharged was called a hold");
  assert.deepEqual(open.nextUp.map((e) => e.ids), [["TL-2"]]);
  assert.equal(open.waves[0].held, false);

  const vouch = t("TL-3", { status: "awaiting_vouch" });
  const tasks = [blocker, vouch];
  const plan = { waves: [{ name: "Done", tasks: ["TL-1"], together: [] }, { name: "Held", tasks: ["TL-1", "TL-3"], together: [] }] };
  const state = planState(plan, tasks, RENDER);
  assert.equal(state.waves[0].held, false, "a finished wave was called held");
  assert.equal(state.waves[1].held, true, "a closed task kept a held wave open");
  const wall = projectionWall(state.waves[1], 0);
  assert.deepEqual(wall.holds.map((h) => h.id), ["TL-3"]);
  assert.equal(wall.held, true);

  const text = renderPlan(state, RENDER, { color: PLAIN, columns: 120 });
  const section = text.slice(text.indexOf("next up"), text.indexOf("in progress:"));
  assert.match(section, /\n {2}held — [^\n]*\n {4}TL-3 {2}awaiting a person's vouch[^\n]*\n(?! {4}TL-1)/, section);
  assert.doesNotMatch(section, /TL-1 {2}/, "a closed task was named as holding the wave");
});

test("a wall that a run's own filter built is not called held", () => {
  const state = planState({ waves: [{ name: "w", tasks: ["TL-1", "TL-2"], together: [] }] },
    [t("TL-1"), t("TL-2")], CONFIG);
  const wall = projectionWall(state.waves[0], 1);
  assert.deepEqual([wall.left, wall.held, wall.holds], [1, false, []]);
});

test("a together group names only its own withheld members, and a whole group carries no mark", () => {
  // `rendered` writes no groups, so this case builds its own plan. TL-4 is
  // withheld outside both groups and must be named beside neither.
  const tasks = [
    t("TL-2"),
    t("TL-3", { status: "in_progress", owner: "agent:a", updated: "2026-11-07" }),
    t("TL-4", { status: "awaiting_vouch" }),
    t("TL-5"),
    t("TL-6"),
  ];
  const plan = { waves: [{ name: "One", tasks: tasks.map((x) => x.id), together: [["TL-2", "TL-3"], ["TL-5", "TL-6"]] }] };
  const text = renderPlan(planState(plan, tasks, RENDER), RENDER, { color: PLAIN, columns: 120 });
  const rows = text.slice(text.indexOf("next up"), text.indexOf("in progress:")).split("\n");
  assert.ok(rows.includes("  together: TL-2  — with TL-3, which `next` hands out to nobody now"), rows.join("\n"));
  assert.ok(rows.includes("  together: TL-5, TL-6"), rows.join("\n"));
});
