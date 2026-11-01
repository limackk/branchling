/**
 * `release record` — a deployment stage git cannot observe, recorded as a ref
 * (TL-506).
 *
 * WHAT HAS TO BE PROVED, against real fixture repositories, because the claim
 * is about what lands in git:
 *
 *   1. `recorded: true` is accepted on a stage whose refs the tool can write,
 *      and refused on a glob, a short name, or a ref in git's own namespaces —
 *      with a positive control that the same refs pass without the flag.
 *   2. A record moves only a declared recorded stage and requires a reason.
 *   3. A commit missing from the previous stage, or a previous stage that does
 *      not resolve, is refused and nothing is written.
 *   4. The ref points at an annotated tag object carrying actor, time and
 *      reason; a backwards move is accepted and named, and the tag says where
 *      the ref stood before.
 *   5. A stage of parallel refs needs `--ref`.
 *   6. `release status` shows who recorded a stage, when and why.
 *   7. The record prints the push command, and the ref it wrote is one the
 *      fetch-refspec row of `doctor` (TL-508) judges.
 *
 * The fixture backlogs are created by `init` with the generic prefix, so no id
 * here refers into this repository's backlog.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readDeployTargets } from "../deploy-targets.mjs";
import { declaredForeignRefs } from "../deploy-fetch.mjs";
import { parseRecordArgs, parseRecordTag, recordTagObject, selectRecordedRef } from "../release-record.mjs";
import { RELEASE_SUBCOMMANDS } from "../release-task.mjs";

import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

isolateHome("release-record");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const ACTOR = "agent:record-test";
let counter = 0;

function git(dir, args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
}

function tryGit(dir, args) {
  return spawnSync("git", args, { cwd: dir, encoding: "utf8" });
}

function run(dir, args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, cwd: dir, env: { ...process.env, NO_COLOR: "1" },
  });
}

function commit(dir, message, file) {
  writeFileSync(join(dir, file), message + "\n", "utf8");
  git(dir, ["add", "-A"]);
  git(dir, ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", message]);
  return git(dir, ["rev-parse", "HEAD"]);
}

const TARGETS = `
deploy_targets:
  - name: app
    stages:
      - { name: tagged, ref: "refs/tags/app-v*" }
      - { name: review, ref: refs/deploys/app/review, recorded: true }
      - name: installed
        refs: [refs/deploys/app/customer-a, refs/deploys/app/customer-b]
        recorded: true
`;

/** A repository with a backlog, the targets above, and two commits: `c1`
 *  tagged `app-v1`, `c2` after it and not yet tagged. */
function recordRepo(dir = null) {
  if (!dir) {
    dir = mkdtempSync(join(tmpdir(), "branchling-release-record-" + counter++ + "-"));
    git(dir, ["init", "-q", "-b", "main", "."]);
  }
  const init = run(dir, ["init", "--dir", "backlog", "--no-example"]);
  assert.equal(init.status, 0, init.stderr);
  appendFileSync(join(dir, "backlog", "config.yaml"), TARGETS, "utf8");
  const c1 = commit(dir, "first", "a.txt");
  git(dir, ["-c", "user.name=t", "-c", "user.email=t@example.com", "tag", "-a", "-m", "v1", "app-v1"]);
  const c2 = commit(dir, "second", "b.txt");
  return { dir, c1, c2 };
}

function record(dir, ...args) {
  return run(dir, ["release", "record", "--dir", "backlog", "--actor", ACTOR, "--json", ...args]);
}

function recordOk(dir, ...args) {
  const r = record(dir, ...args);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.kind, "release-record");
  return parsed;
}

function refused(r, code, kind) {
  assert.equal(r.status, code, r.stdout + r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.refusalKind, kind, parsed.refusal);
  return parsed;
}

function refExists(dir, ref) {
  return tryGit(dir, ["rev-parse", "--verify", "--quiet", ref]).status === 0;
}

// ── 1. The configuration ─────────────────────────────────────────────────

function validate(yaml) {
  const lines = yaml.split("\n").filter((l) => l.trim() && !l.startsWith("deploy_targets:"));
  return readDeployTargets("", lines);
}

test("`recorded: true` is accepted on a writable ref, and refused on a glob, a short name or git's own namespaces", () => {
  const good = validate(TARGETS);
  assert.deepEqual(good.problems, []);
  assert.deepEqual(good.targets[0].stages.map((s) => [s.name, s.recorded]), [["tagged", false], ["review", true], ["installed", true]]);

  const stage = (ref, recorded) => validate(`deploy_targets:
  - name: app
    stages:
      - { name: s, ref: ${JSON.stringify(ref)}${recorded === undefined ? "" : ", recorded: " + recorded} }
`);
  for (const ref of ["refs/deploys/app/v*", "deploys/app/s", "origin/main", "refs/heads/release", "refs/remotes/origin/main", "refs/tags/app-v1"]) {
    // POSITIVE CONTROL: the same ref is a valid OBSERVED stage, so the refusal
    // below is about `recorded`, not about the ref.
    assert.deepEqual(stage(ref).problems, [], ref);
    const bad = stage(ref, "true");
    assert.equal(bad.problems.length, 1, ref + ": " + bad.problems.join("; "));
    assert.match(bad.problems[0], /recorded stage/);
  }
  assert.match(stage("refs/deploys/app/s", "yes").problems.join(";"), /`recorded` = `yes`/);
  assert.deepEqual(stage("refs/deploys/app/s", "false").problems, []);
});

test("every ref a recorded stage may declare is one the doctor's fetch-refspec row judges", () => {
  const { targets } = validate(TARGETS);
  const judged = declaredForeignRefs(targets).map((d) => d.spec);
  const recorded = targets.flatMap((t) => t.stages.filter((s) => s.recorded).flatMap((s) => s.refs));
  assert.equal(recorded.length, 3, "positive control: the fixture declares recorded refs");
  for (const r of recorded) assert.ok(judged.includes(r), r + " escapes the doctor row");
});

// ── 2. What may be recorded ──────────────────────────────────────────────

test("`record` is a subcommand of `release`, never read as a task id", () => {
  assert.ok(RELEASE_SUBCOMMANDS.includes("record"));
  const r = run(tmpdir(), ["release", "--frobnicate"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /record \(subcommand\)|status, record/);
  assert.throws(() => parseRecordArgs(["--stage", "s", "abc"]), /`--target` is required/);
  assert.throws(() => parseRecordArgs(["--target", "t", "--stage", "s"]), /no commit or tag/);
  assert.throws(() => parseRecordArgs(["--target", "t", "--stage", "s", "a", "b"]), /two commits/);
  assert.throws(() => parseRecordArgs(["--target", "t", "--stage", "s", "--bogus", "a"]), /unknown flag: --bogus/);
});

test("a stage git observes cannot be recorded, and nothing is written", () => {
  const { dir, c1 } = recordRepo();
  const before = git(dir, ["for-each-ref"]);
  const r = refused(record(dir, "--target", "app", "--stage", "tagged", "--reason", "store approved", c1), 1, "not-recorded");
  assert.match(r.refusal, /not a recorded stage/);
  assert.match(r.details.join("\n"), /review, installed/);
  assert.equal(git(dir, ["for-each-ref"]), before);
  refused(record(dir, "--target", "nope", "--stage", "review", "--reason", "x", c1), 2, "usage");
  refused(record(dir, "--target", "app", "--stage", "nope", "--reason", "x", c1), 2, "usage");
});

test("a record without a reason, or with a reserved one, is refused", () => {
  const { dir } = recordRepo();
  refused(record(dir, "--target", "app", "--stage", "review", "app-v1"), 2, "usage");
  refused(record(dir, "--target", "app", "--stage", "review", "--reason", "   ", "app-v1"), 2, "usage");
  refused(record(dir, "--target", "app", "--stage", "review", "--reason", "unknown", "app-v1"), 2, "usage");
  assert.equal(refExists(dir, "refs/deploys/app/review"), false);
  // POSITIVE CONTROL: the same invocation with a reason is accepted.
  recordOk(dir, "--target", "app", "--stage", "review", "--reason", "store approved", "app-v1");
});

// ── 3. Ordering ──────────────────────────────────────────────────────────

test("a commit missing from the previous stage is refused, and nothing is written", () => {
  const { dir, c2 } = recordRepo();
  const r = refused(record(dir, "--target", "app", "--stage", "review", "--reason", "store approved", c2), 1, "not-in-previous-stage");
  assert.match(r.refusal, /not in the previous stage `app\/tagged`/);
  assert.equal(refExists(dir, "refs/deploys/app/review"), false);
  refused(record(dir, "--target", "app", "--stage", "review", "--reason", "x", "no-such-commit"), 2, "usage");
});

test("a previous stage that does not resolve refuses the record — unknown is not yes", () => {
  const { dir, c1 } = recordRepo();
  const r = refused(record(dir, "--target", "app", "--stage", "installed", "--ref", "customer-a", "--reason", "installed", c1), 1, "previous-unknown");
  assert.match(r.refusal, /refs\/deploys\/app\/review/);
  assert.equal(refExists(dir, "refs/deploys/app/customer-a"), false);
});

// ── 4. What is written ──────────────────────────────────────────────────

test("the ref points at an annotated tag object with actor, time and reason; a backwards move is accepted and named", () => {
  const { dir, c1, c2 } = recordRepo();
  const t0 = Math.floor(Date.now() / 1000);
  const first = recordOk(dir, "--target", "app", "--stage", "review", "--reason", "store approved build 1", "app-v1");
  assert.equal(first.ok, true);
  assert.equal(first.commit, c1);
  assert.equal(first.direction, "first");
  assert.equal(first.previous, null);
  assert.equal(git(dir, ["cat-file", "-t", "refs/deploys/app/review"]), "tag");
  assert.equal(git(dir, ["rev-parse", "refs/deploys/app/review"]), first.tag);
  assert.equal(git(dir, ["rev-parse", "refs/deploys/app/review^{commit}"]), c1);
  // No tag ref is created: the record lives in the deploy ref alone.
  assert.equal(git(dir, ["tag", "--list"]), "app-v1");
  const rec = parseRecordTag(git(dir, ["cat-file", "tag", "refs/deploys/app/review"]));
  assert.equal(rec.actor, ACTOR);
  assert.equal(rec.reason, "store approved build 1");
  assert.equal(rec.commit, c1);
  assert.equal(rec.previous, null);
  const at = Date.parse(rec.at) / 1000;
  assert.ok(at >= t0 - 1 && at <= Math.floor(Date.now() / 1000) + 1, rec.at);
  assert.equal(git(dir, ["for-each-ref", "--format=%(taggername)", "refs/deploys/app/review"]), ACTOR);

  git(dir, ["tag", "app-v2", c2]);
  const forward = recordOk(dir, "--target", "app", "--stage", "review", "--reason", "store approved build 2", "app-v2");
  assert.equal(forward.direction, "forward");
  assert.equal(forward.previous, c1);

  const back = recordOk(dir, "--target", "app", "--stage", "review", "--reason", "rollout halted, crash on start", c1);
  assert.equal(back.direction, "backward");
  assert.equal(back.previous, c2);
  assert.equal(git(dir, ["rev-parse", "refs/deploys/app/review^{commit}"]), c1);
  const backRec = parseRecordTag(git(dir, ["cat-file", "tag", "refs/deploys/app/review"]));
  assert.equal(backRec.previous, c2);
  assert.equal(backRec.reason, "rollout halted, crash on start");

  // The text answer names the direction too.
  const text = run(dir, ["release", "record", "--dir", "backlog", "--actor", ACTOR, "--target", "app", "--stage", "review", "--reason", "re-approved", c2]);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /app\/review recorded at [0-9a-f]{12} \(forward from [0-9a-f]{12}\)/);
  assert.match(text.stdout, /reason: re-approved/);
});

test("a tag the record format does not describe is not read as a record", () => {
  const object = recordTagObject({ commit: "a".repeat(40), target: "t", stage: "s", ref: "refs/deploys/t/s", actor: "agent:x", reason: "why", source: "v1", previous: null, epochSeconds: 0 });
  assert.equal(parseRecordTag(object).reason, "why");
  assert.equal(parseRecordTag("object " + "a".repeat(40) + "\ntype commit\ntag v1\ntagger t <t@x> 0 +0000\n\nrelease v1\n"), null);
  assert.equal(parseRecordTag(object.replace("Commit: " + "a".repeat(40), "Commit: " + "b".repeat(40))), null);
});

// ── 5. Parallel refs ─────────────────────────────────────────────────────

test("a stage of parallel refs needs `--ref`, which moves exactly one of them", () => {
  const { dir, c1, c2 } = recordRepo();
  recordOk(dir, "--target", "app", "--stage", "review", "--reason", "approved", c1);
  const r = refused(record(dir, "--target", "app", "--stage", "installed", "--reason", "installed", c1), 2, "usage");
  assert.match(r.refusal, /parallel refs/);
  assert.match(r.details.join(" "), /customer-a, refs\/deploys\/app\/customer-b/);
  refused(record(dir, "--target", "app", "--stage", "installed", "--ref", "customer-z", "--reason", "x", c1), 2, "usage");
  const ok = recordOk(dir, "--target", "app", "--stage", "installed", "--ref", "customer-a", "--reason", "customer A upgraded", c1);
  assert.equal(ok.ref, "refs/deploys/app/customer-a");
  assert.equal(refExists(dir, "refs/deploys/app/customer-a"), true);
  assert.equal(refExists(dir, "refs/deploys/app/customer-b"), false);
  // The previous stage is `review`, which holds c1 and not c2.
  refused(record(dir, "--target", "app", "--stage", "installed", "--ref", "refs/deploys/app/customer-b", "--reason", "x", c2), 1, "not-in-previous-stage");

  const { targets } = validate(TARGETS);
  const sel = selectRecordedRef({ targets, target: "app", stage: "review", ref: null });
  assert.equal(sel.ok, true);
  assert.equal(sel.previous.name, "tagged");
});

// ── 6. release status ────────────────────────────────────────────────────

test("`release status` names who recorded a stage, when and why", () => {
  const { dir, c1 } = recordRepo();
  const rec = recordOk(dir, "--target", "app", "--stage", "review", "--reason", "store approved build 1", c1);
  const r = run(dir, ["release", "status", "--dir", "backlog", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.deepEqual(report.records, [{
    target: "app", stage: "review", spec: "refs/deploys/app/review", sha: c1,
    actor: ACTOR, at: rec.recordedAt, reason: "store approved build 1",
  }]);
  const text = run(dir, ["release", "status", "--dir", "backlog"]);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, new RegExp("recorded by " + ACTOR + " at " + rec.recordedAt.replace(/[.]/g, "\\.") + " — store approved build 1"));
  // A ref of a recorded stage moved by something else carries no record and is
  // not described as one.
  git(dir, ["update-ref", "refs/deploys/app/review", c1]);
  const plain = JSON.parse(run(dir, ["release", "status", "--dir", "backlog", "--json"]).stdout);
  assert.deepEqual(plain.records, []);
});

// ── 7. Sharing ──────────────────────────────────────────────────────────

test("a record prints the push command and never pushes; doctor names the refspec other clones need", () => {
  const base = mkdtempSync(join(tmpdir(), "branchling-release-record-remote-" + counter++ + "-"));
  const remote = join(base, "remote.git");
  git(base, ["init", "-q", "--bare", "-b", "main", remote]);
  const clone = join(base, "clone");
  git(base, ["init", "-q", "-b", "main", clone]);
  git(clone, ["remote", "add", "origin", remote]);
  const { c1 } = recordRepo(clone);
  git(clone, ["push", "-q", "origin", "main", "--tags"]);

  const r = recordOk(clone, "--target", "app", "--stage", "review", "--reason", "approved", c1);
  assert.equal(r.remote, "origin");
  assert.equal(r.push, "git push origin '+refs/deploys/app/review:refs/deploys/app/review'");
  assert.match(r.fetchFix, /remote\.origin\.fetch '\+refs\/deploys\/\*:refs\/deploys\/\*'/);
  assert.equal(git(remote, ["for-each-ref", "refs/deploys/"]), "", "the record was pushed");

  const doctor = JSON.parse(run(clone, ["doctor", "--dir", "backlog", "--json"]).stdout);
  const row = doctor.checks.find((c) => c.id === "deploy-fetch");
  assert.equal(row.status, "error");
  assert.match(JSON.stringify(row), /refs\/deploys\/\*/);
});
