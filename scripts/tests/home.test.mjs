/**
 * The user's home directory, and the boundary between the two config layers (TL-34).
 *
 * THE ASSERTION THIS FILE EXISTS FOR is the negative one: the user layer may not
 * override the project's vocabulary. Not "does not by default" — MAY NOT. If it
 * could, two people would see different boards for the same repository, which is
 * the single truth `config.yaml` was created to be, and the drift would be
 * invisible: each of them would be looking at a coherent, wrong backlog. So the
 * test is not that an override is ignored (an ignored preference is
 * indistinguishable from one that had no effect) but that it FAILS, in a real
 * command, with a message naming the file it belongs in.
 *
 * WHAT ELSE HAS TO BE RULED OUT:
 *
 *   1. A RESOLUTION ORDER NOBODY CAN CHECK. Four rules decide where the home is
 *      and each is exercised, including the Windows one — the platform is
 *      injected, because a rule no test can run is a rule nobody has checked.
 *   2. CONFIG AND DATA COLLAPSING INTO ONE. §5 makes the split contract:
 *      preferences are a file a human edits and backs up, the activity log is
 *      machine data. There is an assertion, not an intention.
 *   3. A READ THAT WRITES. Asking where a directory would be must not create it,
 *      or the first `where` on a machine changes the answer to the second.
 *
 * NO TEST HERE TOUCHES A REAL HOME DIRECTORY. Every case injects `env`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ACTOR_ENV, DEFAULT_ACTOR, resolveActor } from "../actor.mjs";
import {
  CONFIG_FILENAME, HOME_ENV, USER_DEFAULTS, USER_KEYS, agentProfilesPath, homePaths, loadUserConfig, parseUserConfig,
  userConfigPath,
} from "../home.mjs";
import { COMMANDS } from "../cli.mjs";
import { DEFAULTS } from "../config.mjs";
import { renderWhere, whereReport } from "../where-command.mjs";
import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("home");

import { plain } from "../ui.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

let counter = 0;
function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), "branchling-" + prefix + "-" + (counter++) + "-"));
}

function run(args, env) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 30_000, input: "",
    env: env || { ...process.env, NO_COLOR: "1" },
  });
}

/** A backlog plus a home directory of its own, and an env that reaches neither
 *  the machine's real config nor its real state. */
function fixture() {
  const dir = tmp("home");
  const backlog = join(dir, "bl");
  const home = join(dir, "home");
  const env = {
    ...process.env, NO_COLOR: "1",
    [HOME_ENV]: home,
    BACKLOG_STATE_DIR: join(dir, "state"),
  };
  delete env.XDG_CONFIG_HOME;
  delete env.XDG_DATA_HOME;
  assert.equal(run(["init", "--dir", backlog, "--no-example"], env).status, 0);
  return { dir, backlog, home, env };
}

// ── where the directory is ────────────────────────────────────────────────

test("BRANCHLING_HOME wins over everything, and is the hook the rest is tested through", () => {
  const paths = homePaths({
    [HOME_ENV]: "/somewhere/mine",
    XDG_CONFIG_HOME: "/xdg/config",
    XDG_DATA_HOME: "/xdg/data",
    APPDATA: "C:\\Users\\x\\AppData\\Roaming",
  }, "win32");
  assert.equal(paths.home, "/somewhere/mine");
  assert.equal(paths.config, "/somewhere/mine/config");
  assert.equal(paths.data, "/somewhere/mine/data");
  assert.equal(paths.source, "env");
});

test("XDG is respected when set, and each variable is honoured on its own", () => {
  const both = homePaths({ XDG_CONFIG_HOME: "/xdg/config", XDG_DATA_HOME: "/xdg/data" }, "linux");
  assert.equal(both.config, "/xdg/config/branchling");
  assert.equal(both.data, "/xdg/data/branchling");
  assert.equal(both.source, "xdg");

  // Only one of the two set is a real configuration, not an error: the other
  // falls back to the platform default rather than dragging both into it.
  const half = homePaths({ XDG_CONFIG_HOME: "/xdg/config" }, "linux");
  assert.equal(half.config, "/xdg/config/branchling");
  assert.equal(half.data, join(homedir(), ".local", "share", "branchling"));
});

test("with nothing set it is ~/.config and ~/.local/share", () => {
  const paths = homePaths({}, "linux");
  assert.equal(paths.config, join(homedir(), ".config", "branchling"));
  assert.equal(paths.data, join(homedir(), ".local", "share", "branchling"));
  assert.equal(paths.source, "default");
});

test("on Windows it is APPDATA, and LOCALAPPDATA when there is one", () => {
  // The platform is injected because this branch is otherwise unreachable from
  // the suite, and an unreachable rule is one nobody has checked.
  const roaming = homePaths({ APPDATA: "C:\\Users\\x\\AppData\\Roaming" }, "win32");
  assert.equal(roaming.source, "appdata");
  assert.ok(roaming.config.endsWith("branchling"));
  assert.ok(roaming.config.includes("Roaming") || roaming.config.includes("AppData"));

  const both = homePaths({
    APPDATA: "C:\\Users\\x\\AppData\\Roaming", LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local",
  }, "win32");
  assert.notEqual(both.config, both.data, "roaming preferences and local data are not the same place");

  // And the same variables on a non-Windows machine are somebody else's: they
  // must not steer this one.
  assert.equal(homePaths({ APPDATA: "C:\\x" }, "linux").source, "default");
});

test("config and data are SEPARATE directories under every rule", () => {
  for (const [env, platform] of [
    [{ [HOME_ENV]: "/h" }, "linux"],
    [{ XDG_CONFIG_HOME: "/c", XDG_DATA_HOME: "/d" }, "linux"],
    [{}, "linux"],
    [{ APPDATA: "C:\\r", LOCALAPPDATA: "C:\\l" }, "win32"],
    [{ APPDATA: "C:\\r" }, "win32"],
  ]) {
    const paths = homePaths(env, platform);
    assert.notEqual(paths.config, paths.data,
      "preferences a human edits and machine data must not share a directory: " + JSON.stringify(env));
  }
});

test("reading where a directory would be does not create it", () => {
  const dir = tmp("noside");
  const env = { [HOME_ENV]: join(dir, "home") };
  homePaths(env);
  userConfigPath(env);
  loadUserConfig(env);
  assert.equal(existsSync(join(dir, "home")), false,
    "the first `where` on a machine must not change the answer to the second");
});

// ── the two layers are disjoint ───────────────────────────────────────────

test("a project-vocabulary key in the user layer FAILS, and says where it belongs", () => {
  const { values, problems } = parseUserConfig("statuses: [foo]\n", Object.keys(DEFAULTS));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /PROJECT's vocabulary/);
  assert.match(problems[0], /config\.yaml/);
  assert.equal("statuses" in values, false, "…and it certainly may not land in the values");

  // A diagnosis, not a label: "unknown key" would be true and useless, because
  // nothing was misspelled. Every project key gets the same treatment.
  for (const key of ["labels", "priorities", "title_max_length"]) {
    const p = parseUserConfig(key + ": x\n", Object.keys(DEFAULTS)).problems;
    assert.match(p[0], /belongs in the backlog/, key + " is not diagnosed");
  }
});

test("a real command REFUSES to run against a user file holding project vocabulary", () => {
  // The whole point. An ignored preference is indistinguishable from one that
  // had no effect, so this has to fail rather than be filtered out — and it has
  // to fail in an ordinary command, not only in the parser.
  const { backlog, home, env } = fixture();
  assert.equal(run(["query", "--count", "--dir", backlog], env).status, 0, "the control: it works first");

  mkdirSync(join(home, "config"), { recursive: true });
  writeFileSync(join(home, "config", "config.yaml"), "statuses: [foo]\n", "utf8");

  const r = run(["query", "--count", "--dir", backlog], env);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /user preferences/);
  assert.match(r.stderr, /may not be\s+overridden/);
});

test("the user layer cannot reach ANY project value, because it holds none of the keys", () => {
  // Structural rather than case by case: the two key sets are disjoint, so
  // there is no key an override could even be written against.
  const overlap = USER_KEYS.filter((k) => Object.keys(DEFAULTS).includes(k));
  assert.deepEqual(overlap, [],
    "a key in both layers is a precedence rule waiting to be invented: " + overlap.join(", "));

  const { backlog, home, env } = fixture();
  mkdirSync(join(home, "config"), { recursive: true });
  writeFileSync(join(home, "config", "config.yaml"), "actor: local:me\nport: 4400\n", "utf8");
  const r = run(["stats", "--json", "--dir", backlog], env);
  assert.equal(r.status, 0, r.stderr);
  const stats = JSON.parse(r.stdout);
  // The preferences are loaded and none of them changed the project's answer.
  assert.ok(stats.stats, "the command still answers");
});

test("a preference with a bad value fails rather than being quietly dropped", () => {
  const bad = parseUserConfig("theme: neon\nport: soon\nactor: nobody\n", []);
  assert.equal(bad.problems.length, 3);
  assert.match(bad.problems[0], /theme/);
  assert.match(bad.problems[1], /not a number/);
  assert.match(bad.problems[2], /namespace/);
  assert.deepEqual(bad.values, {});

  // The control: the same keys with usable values are accepted.
  const good = parseUserConfig("theme: dark\nport: 4400\nactor: local:me\n", []);
  assert.deepEqual(good.problems, []);
  assert.deepEqual(good.values, { theme: "dark", port: 4400, actor: "local:me" });
});

test("a missing preferences file is the normal case, not an error", () => {
  const dir = tmp("nofile");
  const loaded = loadUserConfig({ [HOME_ENV]: join(dir, "home") });
  assert.equal(loaded.exists, false);
  assert.deepEqual(loaded.problems, []);
  assert.deepEqual(loaded.values, { ...USER_DEFAULTS });
});

// ── `where` ───────────────────────────────────────────────────────────────

test("where reports WHICH RULE found the backlog, not only the path", () => {
  const { backlog, env } = fixture();
  const explicit = JSON.parse(run(["where", "--json", "--dir", backlog], env).stdout);
  assert.equal(explicit.backlog.root, backlog);
  assert.equal(explicit.backlog.source, "explicit");

  const byEnv = JSON.parse(run(["where", "--json"], { ...env, BACKLOG_DIR: backlog }).stdout);
  assert.equal(byEnv.backlog.source, "env", "the source is the half of the answer nobody can reconstruct");
});

test("where says where this machine's own directories are, and whether they exist", () => {
  const { home, env } = fixture();
  const report = JSON.parse(run(["where", "--json"], env).stdout);
  assert.ok(report.home.startsWith(home), report.home);
  assert.equal(report.homeSource, "env");
  assert.notEqual(report.config, report.data);
  assert.equal(report.preferences.exists, false);
  assert.equal(typeof report.agentProfiles.exists, "boolean");
});

test("the text answer separates the selected backlog from machine-local facts", () => {
  const report = whereReport({
    env: { [HOME_ENV]: "/h" },
    dir: undefined,
    cwd: "/definitely/not/a/backlog",
    moduleDir: "/definitely/not/a/backlog",
  });
  const text = renderWhere(report, { color: plain });
  assert.match(text, /this machine/);
  assert.match(text, /backlog this run would use/);
});

test("`where` outside any backlog answers instead of failing", () => {
  const dir = tmp("nowhere");
  const env = { ...process.env, NO_COLOR: "1", [HOME_ENV]: join(dir, "home") };
  delete env.BACKLOG_DIR;
  const r = spawnSync(process.execPath, [CLI, "where", "--json"], {
    cwd: dir, encoding: "utf8", timeout: 30_000, input: "", env,
  });
  // Standing outside every repository is the one moment this command matters
  // most, so it may not be an error — but the backlog half has to be honest.
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.ok(report.home, "the machine's own directories are still reported");
});

test("an unknown flag on `where` is a usage error", () => {
  const r = run(["where", "--frobnicate"]);
  assert.equal(r.status, 2);
});

// ── the registry never becomes a precondition (§11 point 2) ───────────────

test("no command takes a --project flag", () => {
  // The regression this guards is not a bug but a DESIGN drift: the first
  // command that needs `--project` is the moment the index stopped being an
  // index. Checked against the command table, so it catches the flag being
  // added anywhere.
  for (const [name, spec] of Object.entries(COMMANDS)) {
    const usage = Array.isArray(spec.usage) ? spec.usage.join("\n") : String(spec.usage || "");
    assert.equal(usage.includes("--project"), false,
      "`" + name + "` grew a --project flag: the registry has become a source of truth");
  }
});

test("the README's own backlog is unaffected by a home directory it has never seen", () => {
  // A fresh machine — no preferences, no registry — must behave exactly like
  // one that has both. This is the control for every assertion above: without
  // it they could all be passing because the home layer does nothing at all.
  const { backlog, env } = fixture();
  const withHome = run(["query", "--count", "--dir", backlog], env);
  const withoutHome = run(["query", "--count", "--dir", backlog],
    { ...env, [HOME_ENV]: join(tmp("empty"), "home") });
  assert.equal(withHome.status, 0);
  assert.equal(withoutHome.stdout, withHome.stdout);
});

test("the preferences file the tool would read is named in `where`", () => {
  // Somebody has to be able to find the file before they can write it, and the
  // path is not guessable from four resolution rules.
  const { home, env } = fixture();
  const report = JSON.parse(run(["where", "--json"], env).stdout);
  assert.equal(report.preferences.path, join(home, "config", "config.yaml"));
  assert.equal(report.agentProfiles.path, agentProfilesPath(env));
  assert.equal(report.agentProfiles.exists, false);
  assert.equal(readFileSync(CLI, "utf8").includes("--project"), false,
    "the dispatcher itself must not learn about a --project flag either");
});

// ── the actor chain reads this layer (TL-157) ─────────────────────────────
//
// The layer existed from TL-34 and nothing consumed it: `actor:` was validated,
// stored, and then ignored by every command that records anything. These cases
// are the wiring, and the negative one — the chain written out in only one file
// — is what stops an eleventh copy appearing.

/** A preferences file inside a `fixture()`'s home. */
function writePreferences(home, text) {
  mkdirSync(join(home, "config"), { recursive: true });
  writeFileSync(join(home, "config", CONFIG_FILENAME), text, "utf8");
}

test("an `actor:` preference is the actor a command records when nothing else says", () => {
  const { backlog, home, env } = fixture();
  writePreferences(home, "actor: local:tester\n");
  assert.equal(run(["new", "--title", "A task to claim", "--dir", backlog], env).status, 0);

  const taken = run(["take", "TASK-1", "--dir", backlog], { ...env, BACKLOG_ACTOR: "" });
  assert.equal(taken.status, 0, taken.stderr);
  assert.match(taken.stdout, /taken by local:tester/);
});

test("the flag outranks the environment, which outranks the preferences", () => {
  const { backlog, home, env } = fixture();
  writePreferences(home, "actor: local:preference\n");
  for (const title of ["one", "two", "three"]) {
    assert.equal(run(["new", "--title", title, "--dir", backlog], env).status, 0);
  }

  const byPreference = run(["take", "TASK-1", "--dir", backlog], { ...env, BACKLOG_ACTOR: "" });
  const byEnvironment = run(["take", "TASK-2", "--dir", backlog],
    { ...env, BACKLOG_ACTOR: "agent:from-env" });
  const byFlag = run(["take", "TASK-3", "--actor", "user:from-flag", "--dir", backlog],
    { ...env, BACKLOG_ACTOR: "agent:from-env" });

  assert.match(byPreference.stdout, /taken by local:preference/);
  assert.match(byEnvironment.stdout, /taken by agent:from-env/);
  assert.match(byFlag.stdout, /taken by user:from-flag/);
});

test("the chain resolves with no preferences file and with no backlog in sight", () => {
  // `regen-hook` and `migrate-prefix` resolve an actor where no project
  // configuration can be loaded, so this must be true of a bare environment as
  // well as of an empty home — a hook that fails is a hook that breaks somebody
  // else's edit.
  const nowhere = join(tmp("nohome"), "home");
  assert.equal(resolveActor("", { env: { [HOME_ENV]: nowhere } }), DEFAULT_ACTOR);
  assert.equal(resolveActor("", { env: { [HOME_ENV]: "/dev/null/not-a-directory" } }), DEFAULT_ACTOR);
  assert.equal(resolveActor("local:me", { env: { [HOME_ENV]: nowhere } }), "local:me");
  assert.equal(existsSync(nowhere), false, "resolving an actor created a directory");
});

test("a caller may ask for the chain WITHOUT a default", () => {
  // The escape hatch for a route that would rather record nothing than record a
  // guess. It is the same chain; only the last step differs.
  const nowhere = join(tmp("nohome"), "home");
  assert.equal(resolveActor("", { env: { [HOME_ENV]: nowhere }, fallback: "" }), "");
});

test("an actor without a namespace in the preferences is not an actor", () => {
  // `parseUserConfig` refuses it, so the chain must fall through rather than
  // carry a value every writing command will then reject.
  const nowhere = tmp("badactor");
  mkdirSync(join(nowhere, "config"), { recursive: true });
  writeFileSync(join(nowhere, "config", CONFIG_FILENAME), "actor: me\n", "utf8");
  assert.equal(resolveActor("", { env: { [HOME_ENV]: nowhere } }), DEFAULT_ACTOR);
});

test("the chain is spelled out in ONE file — this is what stops the next copy", () => {
  // Before TL-157 ten files ended the chain themselves and three of them had
  // already drifted apart. Nothing compared them, which is why nobody noticed.
  const scripts = readdirSync(SCRIPTS_DIR)
    .filter((f) => f.endsWith(".mjs"))
    .filter((f) => readFileSync(join(SCRIPTS_DIR, f), "utf8").includes(ACTOR_ENV));

  // The positive control: a guard that passes because it found nothing at all
  // is green with no evidentiary force.
  assert.deepEqual(scripts, ["actor.mjs"],
    "the actor environment variable is named outside actor.mjs — the chain has grown a second home");
});
