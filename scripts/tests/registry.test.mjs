/**
 * The project registry, and the four ways an index turns into a truth (TL-34).
 *
 * THE CASE THIS FILE WAS WRITTEN FOR is the multi-repository workspace (§8 of
 * docs/worktrail-global-tool.md). The workspace this tool grew up in is a
 * repository with no remote holding `backlog/`, with nine separate repositories
 * inside it. A registry whose unit is the git repository produces ten entries
 * there, nine of them with no tasks — and every count across projects is then
 * wrong in a way that looks like a real answer. So the unit is the BACKLOG
 * directory, and the fixture below is that layout.
 *
 * THE OTHER THREE:
 *
 *   1. LAW 2. Deleting `projects.yaml` must cost nothing but the cross-project
 *      view. Every command run inside a repository has to keep working, and the
 *      test runs several of them with the file removed — if deleting it ever
 *      hurts, the index has become a truth it was never meant to be.
 *   2. A MISSING PATH SILENTLY SKIPPED. "You moved the repository" would then
 *      read as "that project has no tasks", which is the same shape of defect as
 *      a CLI flag that is quietly ignored: the answer looks like an answer.
 *   3. ONE BACKLOG, TWO ENTRIES. The path is the identity, so registering the
 *      same directory twice must rename rather than duplicate — otherwise every
 *      count across projects double-counts a project somebody re-registered.
 *
 * Every case injects `WORKTRAIL_HOME`; none of them can reach a real registry.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { HOME_ENV, registryPath } from "../home.mjs";
import {
  addProject, defaultName, parseRegistry, readRegistry, removeProject, serializeRegistry,
} from "../registry.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

let counter = 0;
function tmp(prefix) {
  // `realpathSync` because macOS resolves /var to /private/var, and every path
  // the tool reports has been through `resolve`/`realpath` already: comparing a
  // reported path against an unresolved fixture path fails on a difference the
  // user never sees.
  return realpathSync(mkdtempSync(join(tmpdir(), "worktrail-" + prefix + "-" + (counter++) + "-")));
}

function run(args, env, cwd) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 30_000, input: "", cwd,
    env: env || { ...process.env, NO_COLOR: "1" },
  });
}

function homeEnv(dir) {
  const env = { ...process.env, NO_COLOR: "1", [HOME_ENV]: join(dir, "home"),
    BACKLOG_STATE_DIR: join(dir, "state") };
  delete env.BACKLOG_DIR;
  delete env.XDG_CONFIG_HOME;
  delete env.XDG_DATA_HOME;
  return env;
}

// ── the parser ────────────────────────────────────────────────────────────

test("a registry round-trips, and an unreadable line is REPORTED not dropped", () => {
  const projects = [{ name: "a", path: "/x/a/backlog" }, { name: "b", path: "/x/b/backlog" }];
  assert.deepEqual(parseRegistry(serializeRegistry(projects)).projects, projects);

  // A registry that quietly drops what it could not parse gets shorter every
  // time somebody hand-edits it, and nobody is told.
  const broken = parseRegistry("projects:\n  - name: a\n    path: /x\n  - nonsense\n");
  assert.equal(broken.problems.length, 1);
  assert.equal(broken.projects.length, 1);

  const stray = parseRegistry("projects:\n  - name: a\n    colour: red\n    path: /x\n");
  assert.match(stray.problems[0], /unknown field/);
});

test("the file says, in its own text, that deleting it is harmless", () => {
  // A person who opens this file has to learn the one thing about it that is
  // not obvious: it is an index. Leaving that in a design document means the
  // person editing the file never reads it.
  const text = serializeRegistry([]);
  assert.match(text, /HARMLESS/);
  assert.match(text, /BACKLOG directory, not the git repository/);
});

test("a default name is the directory the backlog sits IN, not `backlog`", () => {
  assert.equal(defaultName("/x/acme-api/backlog"), "acme-api");
  assert.equal(defaultName("/x/acme-api"), "acme-api");
  // Otherwise every project on a machine would be called `backlog` and the
  // registry would be useless on its second entry.
  assert.notEqual(defaultName("/x/acme-api/backlog"), "backlog");
});

// ── the multi-repository workspace (§8) ───────────────────────────────────

test("a workspace of nine repositories around one backlog is ONE project", () => {
  const dir = tmp("workspace");
  const env = homeEnv(dir);
  const workspace = join(dir, "workspace");
  assert.equal(run(["init", "--dir", join(workspace, "backlog"), "--no-example"], env).status, 0);

  // Nine sub-repositories, each with its own `.git`, none with a backlog —
  // exactly the layout that makes "one repo = one project" produce ten answers.
  for (let i = 0; i < 9; i++) {
    const sub = join(workspace, "repo-" + i);
    mkdirSync(join(sub, ".git"), { recursive: true });
    writeFileSync(join(sub, "README.md"), "sub\n", "utf8");
  }

  const listed = JSON.parse(run(["project", "list", "--json"], env).stdout);
  assert.equal(listed.projects.length, 1, "nine repositories without a backlog are not nine projects");
  assert.equal(listed.projects[0].path, join(workspace, "backlog"));

  // And a command run from INSIDE a sub-repository still finds the workspace's
  // backlog, by walking upwards — which the registry must never contradict.
  const fromSub = run(["where", "--json"], env, join(workspace, "repo-3"));
  assert.equal(fromSub.status, 0, fromSub.stderr);
  const report = JSON.parse(fromSub.stdout);
  assert.equal(report.backlog.root, join(workspace, "backlog"));
  assert.equal(report.backlog.source, "discovery");
  assert.equal(report.backlog.registeredAs, listed.projects[0].name);
});

// ── Law 2: deleting it is harmless ────────────────────────────────────────

test("with the registry deleted, every command inside a repository still works", () => {
  const dir = tmp("law2");
  const env = homeEnv(dir);
  const backlog = join(dir, "bl");
  assert.equal(run(["init", "--dir", backlog, "--no-example"], env).status, 0);
  assert.equal(existsSync(registryPath(env)), true, "the control: init registered it");

  rmSync(registryPath(env), { force: true });

  for (const args of [
    ["query", "--count", "--dir", backlog],
    ["stats", "--json", "--dir", backlog],
    ["build", "--dir", backlog],
    ["next-id", "--dir", backlog],
    ["where", "--json", "--dir", backlog],
    ["check", "--dir", backlog],
  ]) {
    const r = run(args, env);
    assert.equal(r.status, 0, args.join(" ") + " broke without the registry:\n" + r.stderr);
  }

  // What IS lost is the cross-project view, and it says so rather than
  // pretending the machine has no projects.
  const listed = run(["project", "list"], env);
  assert.equal(listed.status, 0);
  assert.match(listed.stdout, /no registry yet/);
});

test("nothing recreates the registry behind the user's back", () => {
  const dir = tmp("nore");
  const env = homeEnv(dir);
  const backlog = join(dir, "bl");
  assert.equal(run(["init", "--dir", backlog, "--no-example"], env).status, 0);
  rmSync(registryPath(env), { force: true });

  run(["query", "--count", "--dir", backlog], env);
  run(["where", "--json", "--dir", backlog], env);
  assert.equal(existsSync(registryPath(env)), false,
    "a read that writes turns `I deleted that` into `it came back`");
});

// ── a path that is gone ───────────────────────────────────────────────────

test("an entry whose path no longer exists is REPORTED, never skipped", () => {
  const dir = tmp("missing");
  const env = homeEnv(dir);
  const backlog = join(dir, "bl");
  assert.equal(run(["init", "--dir", backlog, "--no-example"], env).status, 0);

  // Add a second project and then move it out from under the registry.
  const other = join(dir, "other", "backlog");
  assert.equal(run(["init", "--dir", other, "--no-example"], env).status, 0);
  assert.equal(readRegistry(env).projects.length, 2, "the control: both were registered");

  rmSync(join(dir, "other"), { recursive: true, force: true });

  const registry = readRegistry(env);
  assert.equal(registry.projects.length, 1);
  assert.equal(registry.missing.length, 1, "a silent skip would read as `that project has no tasks`");
  assert.equal(registry.missing[0].path, other);

  const listed = run(["project", "list"], env);
  assert.equal(listed.status, 0);
  assert.match(listed.stdout, /not a backlog any more/);
  assert.ok(listed.stdout.includes(other), "the path a person has to go and look at is printed");
});

test("a directory that exists but is not a backlog is not registered", () => {
  const dir = tmp("notbl");
  const env = homeEnv(dir);
  const plain = join(dir, "just-a-folder");
  mkdirSync(plain, { recursive: true });
  const r = run(["project", "add", plain], env);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /does not look like a backlog/);
  assert.equal(existsSync(registryPath(env)), false, "and nothing was written");
});

// ── the path is the identity ──────────────────────────────────────────────

test("registering one backlog twice renames it, and never duplicates it", () => {
  const dir = tmp("dup");
  const env = homeEnv(dir);
  const backlog = join(dir, "bl");
  assert.equal(run(["init", "--dir", backlog, "--no-example"], env).status, 0);

  const again = addProject(backlog, { name: "renamed", env });
  assert.equal(again.ok, true);
  assert.equal(again.renamed.name, "bl");
  const registry = readRegistry(env);
  assert.equal(registry.projects.length, 1, "one directory is one project, whatever it is called");
  assert.equal(registry.projects[0].name, "renamed");

  // Idempotent under the same name, so a script may call it in a loop.
  const third = addProject(backlog, { name: "renamed", env });
  assert.equal(third.already, true);
  assert.equal(readRegistry(env).projects.length, 1);
});

test("two different backlogs may not share a label", () => {
  const dir = tmp("clash");
  const env = homeEnv(dir);
  const a = join(dir, "a", "backlog");
  const b = join(dir, "b", "backlog");
  assert.equal(run(["init", "--dir", a, "--no-example"], env).status, 0);
  assert.equal(run(["init", "--dir", b, "--no-example"], env).status, 0);

  const r = run(["project", "add", a, "--name", "b"], env);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /already points at/);
  // Both keep the names they had — a refused rename may not half-apply.
  const names = readRegistry(env).projects.map((p) => p.name).sort();
  assert.deepEqual(names, ["a", "b"]);
});

test("removing something never registered says so instead of succeeding quietly", () => {
  const dir = tmp("rm");
  const env = homeEnv(dir);
  const backlog = join(dir, "bl");
  assert.equal(run(["init", "--dir", backlog, "--no-example"], env).status, 0);

  const typo = run(["project", "remove", "blog"], env);
  assert.equal(typo.status, 1, "a silent success leaves you believing a typo was removed");
  assert.equal(readRegistry(env).projects.length, 1);

  // The control: the real name does remove it, and by path as well as by name.
  assert.equal(removeProject("bl", { env }).ok, true);
  assert.equal(readRegistry(env).projects.length, 0);
});

test("removing a project does not touch the backlog itself", () => {
  const dir = tmp("rmsafe");
  const env = homeEnv(dir);
  const backlog = join(dir, "bl");
  assert.equal(run(["init", "--dir", backlog, "--no-example"], env).status, 0);
  assert.equal(run(["project", "remove", "bl"], env).status, 0);
  assert.equal(existsSync(join(backlog, "config.yaml")), true, "an index entry is not the data");
  assert.equal(run(["query", "--count", "--dir", backlog], env).status, 0);
});

// ── init registers, but registration never blocks init ────────────────────

test("init registers the backlog it creates, and says so", () => {
  const dir = tmp("initreg");
  const env = homeEnv(dir);
  const r = run(["init", "--dir", join(dir, "proj", "backlog"), "--no-example"], env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /registered as `proj`/);
  assert.match(r.stdout, /harmless/, "the message has to say the index is not a truth");
});

test("init still succeeds when the home directory cannot be written", () => {
  // Creating a backlog is what the user asked for; putting it in an index is
  // the tool's convenience, and the second may not fail the first.
  const dir = tmp("initro");
  const blocker = join(dir, "blocked");
  writeFileSync(blocker, "not a directory\n", "utf8");
  const env = { ...process.env, NO_COLOR: "1", [HOME_ENV]: blocker };
  const r = run(["init", "--dir", join(dir, "bl"), "--no-example"], env);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(join(dir, "bl", "config.yaml")), true);
  assert.equal(r.stdout.includes("registered as"), false, "it did not register, and did not pretend to");
});

test("the registry file a person would edit is the one the tool reads", () => {
  const dir = tmp("path");
  const env = homeEnv(dir);
  assert.equal(run(["init", "--dir", join(dir, "bl"), "--no-example"], env).status, 0);
  const text = readFileSync(registryPath(env), "utf8");
  assert.match(text, /projects:/);
  assert.ok(text.includes(join(dir, "bl")));
});
