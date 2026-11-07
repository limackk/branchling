/**
 * A declared deploy ref reaches every clone, or `doctor` says why (TL-508).
 *
 * WHAT IS PROVEN.
 *   1. The pure pieces: which declared refs need a refspec at all, what
 *      namespace each lies in, and whether a list of fetch refspecs brings a
 *      ref in UNDER ITS OWN NAME — a refspec that fetches it elsewhere, or a
 *      negative refspec that excludes it, does not count.
 *   2. End to end through `doctor --json`, against a real clone of a real
 *      bare remote: the row is red with the exact `git config --add` line when
 *      the refspec is missing, and green once that very line has been run —
 *      the positive control and the proof the printed fix works.
 *   3. Doctor fixes nothing: the remote's configuration is unchanged by a run.
 *   4. A project that declares nothing outside git's own namespaces gets no
 *      row, and a clone with no remote gets INFO, not a false verdict.
 *   5. A SHORT name (TL-510) is judged by what it resolves to in the clone:
 *      `deploys/web/production` warns in a fresh clone, where it resolves to
 *      nothing, and is checked as `refs/deploys/web/production` in a clone
 *      that has that ref; `origin/main` beside it is never reported.
 *
 * The deploy namespace in the fixtures is `refs/deploys/`, the shape
 * `docs/release-tracking.md` §2 uses; it is a fixture value, not something the
 * code knows.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseConfigYaml } from "../config.mjs";
import {
  classifyShortRef, declaredForeignRefs, declaredShortRefs, fixCommand, fixRefspec, refNamespace,
  refspecsCover,
} from "../deploy-fetch.mjs";

import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

isolateHome("release-fetch-refspec");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
let counter = 0;

function git(dir, ...args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
}

function run(cwd, args) {
  return spawnSync(process.execPath, [CLI].concat(args), { cwd, encoding: "utf8", timeout: 120_000 });
}

function targets(yaml) {
  const parsed = parseConfigYaml(yaml);
  assert.deepEqual(parsed.problems, []);
  return parsed.values.deploy_targets;
}

const DEPLOYS = `deploy_targets:
  - name: web
    stages:
      - { name: test, ref: origin/main }
      - { name: staging, ref: refs/deploys/web/staging }
      - name: production
        refs: [refs/deploys/web/production-eu, refs/deploys/web/production-us]
  - name: desktop
    stages:
      - { name: tagged, ref: "refs/tags/desktop-v*" }
`;

const BRANCHES_ONLY = `deploy_targets:
  - name: web
    stages:
      - { name: test, ref: origin/main }
      - { name: tagged, ref: "refs/tags/v*" }
`;

const DEFAULT_REFSPEC = "+refs/heads/*:refs/remotes/origin/*";

// ── 1. The pure pieces ────────────────────────────────────────────────────

test("only full refs outside heads, remotes and tags need a refspec", () => {
  const declared = declaredForeignRefs(targets(DEPLOYS));
  assert.deepEqual(declared.map((d) => d.spec),
    ["refs/deploys/web/staging", "refs/deploys/web/production-eu", "refs/deploys/web/production-us"]);
  assert.deepEqual([...new Set(declared.map((d) => d.namespace))], ["refs/deploys/*"]);
  assert.deepEqual(declaredForeignRefs(targets(BRANCHES_ONLY)), []);
  assert.deepEqual(declaredForeignRefs([]), []);
});

test("a namespace is computed from the raw spec, never from a sample of a glob", () => {
  assert.equal(refNamespace("refs/deploys/web/production"), "refs/deploys/*");
  assert.equal(refNamespace("refs/deploys/desktop-v*"), "refs/deploys/*");
  assert.equal(refNamespace("refs/deploys/[ab]?"), "refs/deploys/*");
  assert.equal(refNamespace("refs/released"), "refs/released");
  // A glob in the first component: a one-star glob is itself a refspec pattern;
  // `?` and `[…]` cannot be written in one, so the literal prefix plus `*`.
  assert.equal(refNamespace("refs/release-v*"), "refs/release-v*");
  assert.equal(refNamespace("refs/release-v?"), "refs/release-v*");
  assert.equal(refNamespace("refs/release-[0-9]*"), "refs/release-*");
  // Nothing narrower than refs/* covers it — no fix is printed.
  assert.equal(refNamespace("refs/[ab]x"), null);
  assert.equal(refNamespace("refs/*-deploy"), null);
  assert.equal(fixCommand("origin", null), null);
});

test("a glob is covered only when EVERY ref it matches is, not when a sample is", () => {
  // The defect this guards: a refspec as narrow as one sample of the glob.
  assert.equal(refspecsCover(["+refs/release-vx:refs/release-vx"], "refs/release-v*"), false);
  assert.equal(refspecsCover(["+refs/release-vx:refs/release-vx"], "refs/release-v?"), false);
  // Positive controls: the printed fixes, and a broader same-name refspec.
  assert.equal(refspecsCover([fixRefspec(refNamespace("refs/release-v*"))], "refs/release-v*"), true);
  assert.equal(refspecsCover([fixRefspec(refNamespace("refs/release-v?"))], "refs/release-v?"), true);
  assert.equal(refspecsCover([fixRefspec("refs/deploys/*")], "refs/deploys/desktop-v*"), true);
  assert.equal(refspecsCover(["+refs/*:refs/*"], "refs/release-v*"), true);
  // A narrower pattern, another name, a source-only one, a negative that may
  // cut into the glob.
  assert.equal(refspecsCover(["+refs/release-v1*:refs/release-v1*"], "refs/release-v*"), false);
  assert.equal(refspecsCover(["+refs/release-v*:refs/remotes/origin/release-v*"], "refs/release-v*"), false);
  assert.equal(refspecsCover(["refs/release-v*"], "refs/release-v*"), false);
  assert.equal(refspecsCover(["+refs/*:refs/*", "^refs/release-v2"], "refs/release-v*"), false);
  assert.equal(refspecsCover(["+refs/*:refs/*", "^refs/other/*"], "refs/release-v*"), true);
});

test("a short name is left to the clone: declaredForeignRefs skips it, declaredShortRefs lists it", () => {
  const t = [{ name: "web", stages: [
    { name: "production", refs: ["deploys/web/production"] },
    { name: "test", refs: ["origin/main"] },
    { name: "tagged", refs: ["refs/tags/v*"] },
  ] }];
  assert.deepEqual(declaredForeignRefs(t), []);
  assert.deepEqual(declaredShortRefs(t).map((d) => d.spec), ["deploys/web/production", "origin/main"]);
});

test("a short name is classified in git's own resolution order", () => {
  const remotes = ["origin"];
  // The defect: in a fresh clone nothing exists under either name, and only
  // the first component tells a remote-tracking branch from a deploy ref.
  assert.deepEqual(classifyShortRef("deploys/web/production", [], remotes), { kind: "unresolved", full: null });
  assert.deepEqual(classifyShortRef("origin/main", [], remotes), { kind: "git", full: null });
  // Where the ref exists, refs/<name> wins over every git namespace, as in rev-parse.
  assert.deepEqual(classifyShortRef("deploys/web/production",
    ["refs/deploys/web/production", "refs/heads/deploys/web/production"], remotes),
  { kind: "foreign", full: "refs/deploys/web/production" });
  // Positive controls: a branch, a tag, a remote-tracking branch, a pseudo-ref.
  assert.deepEqual(classifyShortRef("main", ["refs/heads/main"], remotes), { kind: "git", full: "refs/heads/main" });
  assert.deepEqual(classifyShortRef("v1", ["refs/tags/v1"], remotes), { kind: "git", full: "refs/tags/v1" });
  assert.deepEqual(classifyShortRef("origin/main", ["refs/remotes/origin/main"], remotes),
    { kind: "git", full: "refs/remotes/origin/main" });
  assert.deepEqual(classifyShortRef("origin", ["refs/remotes/origin/HEAD"], remotes),
    { kind: "git", full: "refs/remotes/origin/HEAD" });
  assert.deepEqual(classifyShortRef("HEAD", [], remotes), { kind: "git", full: null });
  // A bare name that exists nowhere is not excused by happening to equal a remote.
  assert.deepEqual(classifyShortRef("release", [], remotes), { kind: "unresolved", full: null });
});

test("a refspec covers a ref only when it maps the ref onto its own name", () => {
  const ref = "refs/deploys/web/staging";
  // Positive controls: the fix itself, a narrower one, an exact one, a mirror.
  assert.equal(refspecsCover([DEFAULT_REFSPEC, fixRefspec("refs/deploys/*")], ref), true);
  assert.equal(refspecsCover(["+refs/deploys/web/*:refs/deploys/web/*"], ref), true);
  assert.equal(refspecsCover([ref + ":" + ref], ref), true);
  assert.equal(refspecsCover(["+refs/*:refs/*"], ref), true);
  // The default refspec, one that fetches it under another name, a source-only
  // refspec, and a negative refspec excluding it — none brings it in.
  assert.equal(refspecsCover([DEFAULT_REFSPEC], ref), false);
  assert.equal(refspecsCover(["+refs/deploys/*:refs/remotes/origin/deploys/*"], ref), false);
  assert.equal(refspecsCover(["refs/deploys/*"], ref), false);
  assert.equal(refspecsCover(["+refs/*:refs/*", "^refs/deploys/*"], ref), false);
  assert.equal(refspecsCover(["+refs/deploys/other/*:refs/deploys/other/*"], ref), false);
  assert.equal(refspecsCover([], ref), false);
});

test("the fix is a forced, same-name refspec quoted against the shell", () => {
  assert.equal(fixCommand("origin", "refs/deploys/*"),
    "git config --add remote.origin.fetch '+refs/deploys/*:refs/deploys/*'");
});

// ── 2–4. End to end through doctor ────────────────────────────────────────

/** A bare remote and a clone of it whose backlog declares `yaml`. */
function cloneWithBacklog(yaml) {
  const base = fixtureDir(join(tmpdir(), "branchling-fetch-" + counter++ + "-"));
  const remote = join(base, "remote.git");
  const seed = join(base, "seed");
  git(base, "init", "-q", "--bare", "-b", "main", remote);
  git(base, "init", "-q", "-b", "main", seed);
  git(seed, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "seed");
  git(seed, "push", "-q", remote, "main");
  const clone = join(base, "clone");
  git(base, "clone", "-q", remote, clone);
  const init = run(clone, ["init", "--dir", "."]);
  assert.equal(init.status, 0, init.stderr);
  if (yaml) appendFileSync(join(clone, "config.yaml"), "\n" + yaml, "utf8");
  return clone;
}

function doctorRow(dir) {
  const r = run(dir, ["doctor", "--json"]);
  const parsed = JSON.parse(r.stdout);
  return { status: r.status, row: parsed.checks.find((c) => c.id === "deploy-fetch") };
}

test("doctor names a missing refspec with the fixing command, and is green once it is run", () => {
  const dir = cloneWithBacklog(DEPLOYS);
  const before = git(dir, "config", "--get-all", "remote.origin.fetch");

  const red = doctorRow(dir);
  assert.ok(red.row, "no deploy-fetch row although refs/deploys/ is declared");
  assert.equal(red.row.status, "error");
  assert.equal(red.status, 1);
  assert.match(red.row.detail, /`origin`/);
  assert.match(red.row.detail, /refs\/deploys\/\*/);
  assert.match(red.row.detail, /refs\/deploys\/web\/staging/);
  assert.equal(red.row.fix, "git config --add remote.origin.fetch '+refs/deploys/*:refs/deploys/*'");

  // Doctor fixes nothing.
  assert.equal(git(dir, "config", "--get-all", "remote.origin.fetch"), before);

  // Apply exactly the printed fix, through a shell, as a person would.
  const applied = spawnSync("sh", ["-c", red.row.fix], { cwd: dir, encoding: "utf8" });
  assert.equal(applied.status, 0, applied.stderr);

  const green = doctorRow(dir);
  assert.equal(green.row.status, "ok", JSON.stringify(green.row));
  assert.equal(green.row.fix, null);
  assert.match(green.row.detail, /refs\/deploys\/\*/);
});

const RELEASE_GLOB = `deploy_targets:
  - name: web
    stages:
      - { name: released, ref: "refs/release-v*" }
`;

test("a glob in the first component under refs/: the printed fix really fetches a matching ref", () => {
  const dir = cloneWithBacklog(RELEASE_GLOB);
  const remote = git(dir, "config", "--get", "remote.origin.url");
  git(remote, "update-ref", "refs/release-v2", git(remote, "rev-parse", "main"));

  const red = doctorRow(dir);
  assert.equal(red.row.status, "error");
  assert.equal(red.row.fix, "git config --add remote.origin.fetch '+refs/release-v*:refs/release-v*'");

  const applied = spawnSync("sh", ["-c", red.row.fix], { cwd: dir, encoding: "utf8" });
  assert.equal(applied.status, 0, applied.stderr);
  const refspecs = git(dir, "config", "--get-all", "remote.origin.fetch").split("\n");
  assert.equal(refspecsCover(refspecs, "refs/release-v2"), true);

  assert.equal(doctorRow(dir).row.status, "ok");
  // And git agrees: an ordinary fetch now brings the concrete ref in by name.
  git(dir, "fetch", "-q");
  assert.equal(git(dir, "rev-parse", "refs/release-v2"), git(remote, "rev-parse", "main"));
});

test("a glob no refspec narrower than refs/* covers: red, with no command to run", () => {
  const dir = cloneWithBacklog(`deploy_targets:
  - name: web
    stages:
      - { name: released, ref: "refs/[ab]-release" }
`);
  const r = doctorRow(dir);
  assert.equal(r.row.status, "error");
  assert.doesNotMatch(r.row.fix, /git config/);
  assert.match(r.row.fix, /refs\/\[ab\]-release/);
  assert.match(r.row.fix, /literal namespace/);
});

test("a refspec that fetches the refs under another name is still red", () => {
  const dir = cloneWithBacklog(DEPLOYS);
  git(dir, "config", "--add", "remote.origin.fetch", "+refs/deploys/*:refs/remotes/origin/deploys/*");
  assert.equal(doctorRow(dir).row.status, "error");
});

test("nothing declared outside git's namespaces: no row; no remote at all: INFO", () => {
  assert.equal(doctorRow(cloneWithBacklog(BRANCHES_ONLY)).row, undefined);
  assert.equal(doctorRow(cloneWithBacklog(null)).row, undefined);

  const dir = cloneWithBacklog(DEPLOYS);
  git(dir, "remote", "remove", "origin");
  const r = doctorRow(dir);
  assert.equal(r.row.status, "info");
  assert.match(r.row.detail, /no remote/);
});

test("several remotes: the branch's upstream is the one judged", () => {
  const dir = cloneWithBacklog(DEPLOYS);
  git(dir, "remote", "add", "mirror", git(dir, "config", "--get", "remote.origin.url"));
  git(dir, "config", "--add", "remote.mirror.fetch", "+refs/deploys/*:refs/deploys/*");
  // The upstream is origin, which lacks it — the other remote having it is no answer.
  const r = doctorRow(dir);
  assert.equal(r.row.status, "error");
  assert.match(r.row.fix, /remote\.origin\.fetch/);
});

test("several remotes and no upstream: a warning that names the choice, not a guessed verdict", () => {
  const dir = cloneWithBacklog(DEPLOYS);
  const url = git(dir, "config", "--get", "remote.origin.url");
  git(dir, "remote", "remove", "origin");
  git(dir, "remote", "add", "alpha", url);
  git(dir, "remote", "add", "beta", url);
  const r = doctorRow(dir);
  assert.equal(r.row.status, "warn");
  assert.match(r.row.detail, /alpha, beta/);
  assert.match(r.row.fix, /set-upstream-to/);
});

// ── 5. A short name (TL-510) ─────────────────────────────────────────────

const SHORT = `deploy_targets:
  - name: web
    stages:
      - { name: test, ref: origin/main }
      - { name: production, ref: deploys/web/production }
`;

test("a short deploy ref that resolves to nothing in a fresh clone warns, naming it and not origin/main", () => {
  const dir = cloneWithBacklog(SHORT);
  const remote = git(dir, "config", "--get", "remote.origin.url");
  // CI pushed the deploy ref to the remote; the default refspec never brings it here.
  git(remote, "update-ref", "refs/deploys/web/production", git(remote, "rev-parse", "main"));

  const r = doctorRow(dir);
  assert.ok(r.row, "no deploy-fetch row although a short deploy ref is declared");
  assert.equal(r.row.status, "warn");
  assert.match(r.row.detail, /deploys\/web\/production \(web\/production\)/);
  assert.doesNotMatch(r.row.detail, /origin\/main/);
  assert.match(r.row.fix, /`refs\/deploys\/web\/production`/);

  // Once a refspec brings the ref in under its own name, the short name reads
  // it — and the row is green, judged against that full name.
  git(dir, "config", "--add", "remote.origin.fetch", fixRefspec("refs/deploys/*"));
  git(dir, "fetch", "-q");
  const green = doctorRow(dir);
  assert.equal(green.row.status, "ok", JSON.stringify(green.row));
  assert.match(green.row.detail, /refs\/deploys\/\*/);
});

test("a short name that reads a ref no refspec fetches is red, with the same fix as its full name", () => {
  const dir = cloneWithBacklog(SHORT);
  // The clone that wrote the ref: it resolves here, and only here.
  git(dir, "update-ref", "refs/deploys/web/production", git(dir, "rev-parse", "HEAD"));
  const r = doctorRow(dir);
  assert.equal(r.row.status, "error");
  assert.match(r.row.detail, /refs\/deploys\/web\/production/);
  assert.equal(r.row.fix, "git config --add remote.origin.fetch '+refs/deploys/*:refs/deploys/*'");
});

test("positive control: origin/main as the only short name gives no row", () => {
  assert.equal(doctorRow(cloneWithBacklog(`deploy_targets:
  - name: web
    stages:
      - { name: test, ref: origin/main }
      - { name: trunk, ref: main }
`)).row, undefined);
});
