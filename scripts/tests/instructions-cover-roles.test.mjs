/**
 * The autonomous-loop guide knows that roles exist (TL-263).
 *
 * WHAT IS BEING GUARDED. `instructions autonomous-loop` is the tool's own answer
 * to "how do I run this unattended", and `--update-nudge` points at it from
 * other people's agent files — so it is the first and often the only text a
 * caller reads before building a loop. The role machinery (`run --agent-for`,
 * `--profile-for`, `next --role`, `--role-strict`, `handoff --to-role`) shipped
 * without reaching that text, and nothing noticed: a guide that is internally
 * consistent and merely OMITS a feature produces no drift signal. The cost is
 * measurable rather than aesthetic — a single generalist built from that guide
 * either hands a role's task to the wrong brief or leaves it waiting for a hand
 * nobody was told to name, and the run reports that as tasks waiting for a role.
 *
 * THE SHAPE OF THE GUARD. Two halves that fail for different reasons:
 *
 *   1. THE GUIDE NAMES THE MACHINERY. Needles on the THESIS, not on wording —
 *      an assertion on a whole sentence is edited every time somebody improves
 *      the prose, and a test edited to stay green guards nothing.
 *   2. THE MACHINERY IS STILL THE CODE'S. Each flag the needles demand is taken
 *      from the parser's own flag list, so removing a flag from the code fails
 *      HERE as well, at the sentence that would otherwise go on promising it.
 *
 * A ZERO SAMPLE MUST NOT BE GREEN. Every "the text contains X" test passes
 * against an empty page, so the topic's existence and size are asserted, and the
 * needle function is run over an empty text and over one with each mention
 * stripped — both must report.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../config.mjs";
import { ENV_PREFIX, TOPICS, topicText } from "../instructions.mjs";
import { HANDOFF_FLAGS } from "../handoff-task.mjs";
import { NEXT_FLAGS } from "../next-task.mjs";
import { RUN_FLAGS, agentEnvironment } from "../run-loop.mjs";
import { PRODUCT_NAME } from "../product.mjs";
import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("instructions-cover-roles");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const TOPIC = "autonomous-loop";

let counter = 0;
function run(args, cwd) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    cwd, encoding: "utf8", timeout: 60_000, env: { ...process.env, NO_COLOR: "1" },
  });
}

/**
 * A backlog that declares the roles it is given. The values are this fixture's
 * own invention: a guide rendered for a project may name THAT project's roles
 * and no other's, which is only measurable when the test establishes the
 * vocabulary itself.
 */
function fixture(roles) {
  const repo = mkdtempSync(join(tmpdir(), "branchling-loop-roles-" + counter++ + "-"));
  execFileSync("git", ["init", "-q", "-b", "main", "."], { cwd: repo, stdio: "ignore" });
  const dir = join(repo, "backlog");
  const r = run(["init", "--dir", dir, "--no-example", "--no-nudge"]);
  assert.equal(r.status, 0, "init failed: " + r.stderr);
  appendFileSync(join(dir, "config.yaml"), "\nroles: [" + roles.join(", ") + "]\n", "utf8");
  const config = loadConfig(dir);
  assert.deepEqual(config.roles, roles, "the fixture's roles did not reach the configuration");
  return { repo, dir, config };
}

/** The flags the guide has to name, each one read from the parser that accepts
 *  it — so a flag deleted from the code fails here too, rather than leaving the
 *  guide promising it. */
const FLAGS = [
  ["--agent-for", RUN_FLAGS, "run"],
  ["--profile-for", RUN_FLAGS, "run"],
  ["--role", NEXT_FLAGS, "next"],
  ["--to-role", HANDOFF_FLAGS, "handoff"],
];

/**
 * What the topic may not stop saying. PURE, and it takes the text rather than
 * reading it, so the controls below can feed it a stripped one.
 *
 * @returns {string[]} problems; empty means the guide still covers roles
 */
function rolesCovered(text) {
  const problems = [];
  // Flattened first: the guide is wrapped at about 78 columns, so a needle that
  // cannot survive a line break would be measuring the typesetting.
  const flat = String(text).replace(/\s+/g, " ");
  const need = (re, what) => { if (!re.test(flat)) problems.push(what); };

  for (const [flag] of FLAGS) need(new RegExp(flag.replace(/-/g, "\\-")), "does not name `" + flag + "`");
  need(/--role-strict/, "does not name `--role-strict`");
  need(new RegExp(PRODUCT_NAME + " handoff <ID> --to-role"),
    "does not show how a hand ends its stage and passes the task on");
  need(/`role:`/, "never says what a task's `role:` field is");
  need(/`executor:`/, "does not separate the role from the executor — they are different questions");
  need(/roles:/, "does not name `roles:` in the configuration as the vocabulary");
  need(/waits|waiting/, "does not say what happens to a role no hand was given");
  return problems;
}

test("the loop guide covers the role machinery", () => {
  const fx = fixture(["alpha-hand", "beta-hand"]);
  assert.deepEqual(rolesCovered(topicText(TOPIC, fx.config)), []);
});

test("POSITIVE CONTROL: a missing, empty or role-less topic is NOT green", () => {
  // The topic exists and is worth reading. Without this, deleting it would make
  // the needles above unreachable rather than failing.
  assert.ok(TOPICS[TOPIC], "the `" + TOPIC + "` topic is gone");
  const fx = fixture(["alpha-hand"]);
  const text = topicText(TOPIC, fx.config);
  assert.ok(text.length > 1000, "the topic prints nothing worth reading");

  // A zero sample fails on every needle it owns, not on none of them.
  assert.ok(rolesCovered("").length >= 8, "an empty topic passed the guard");

  // And the realistic regression: the text is there, the roles are not.
  const stripped = text.replace(/--agent-for/g, "--agent").replace(/--role-strict/g, "");
  const problems = rolesCovered(stripped);
  assert.ok(problems.some((p) => /--agent-for/.test(p)), "removing `--agent-for` was not noticed");
  assert.ok(problems.some((p) => /--role-strict/.test(p)), "removing `--role-strict` was not noticed");
});

test("every flag the guide promises is one its parser still accepts", () => {
  for (const [flag, flags, command] of FLAGS) {
    assert.ok(flags.includes(flag), "`" + command + "` no longer accepts `" + flag + "`");
  }
  // `--role-strict` is parsed before the flag table, so the only honest proof is
  // the refusal it gives: about the missing `--role`, never "unknown flag".
  const fx = fixture(["alpha-hand"]);
  const r = run(["next", "--role-strict", "--dir", fx.dir], fx.repo);
  assert.equal(r.status, 2, "`next --role-strict` no longer refuses on its own");
  assert.match(r.stderr + r.stdout, /--role-strict/);
  assert.doesNotMatch(r.stderr + r.stdout, /unknown flag/, "`--role-strict` is no longer a flag at all");
});

test("the environment names the guide prints are the ones a hand is launched with", () => {
  // The guide cannot import them: `run-loop` reads the instructions module for
  // role briefs, so the dependency only goes one way and the prefix is derived
  // twice. This is the seam where the two are made to agree.
  const env = agentEnvironment({ actor: "agent:x", root: "/d", cwd: "/r" }, { id: "ZZ-1", role: "alpha-hand" });
  for (const suffix of ["_ACTOR", "_ROLE", "_TASK", "_DIR", "_REPOSITORY"]) {
    assert.ok(ENV_PREFIX + suffix in env, "a hand is not given " + ENV_PREFIX + suffix);
  }
  const fx = fixture(["alpha-hand"]);
  assert.match(topicText(TOPIC, fx.config), new RegExp(ENV_PREFIX + "_ACTOR"),
    "the guide prints an environment prefix nothing sets");
});

test("the topic names the READING project's roles, and no other's", () => {
  const mine = fixture(["alpha-hand", "beta-hand"]);
  const theirs = fixture(["gamma-hand"]);
  const here = topicText(TOPIC, mine.config);
  const there = topicText(TOPIC, theirs.config);

  assert.match(here, /alpha-hand/, "the reading project's roles are not substituted in");
  assert.doesNotMatch(here, /gamma-hand/, "a foreign project's role reached the text");
  assert.match(there, /gamma-hand/);
  assert.doesNotMatch(there, /alpha-hand/, "a role value is a literal in the source");
});

test("a backlog that declares no roles is told so rather than shown a gap", () => {
  const none = fixture([]);
  assert.equal((none.config.roles || []).length, 0, "the fixture stopped being a roles-less backlog");
  const text = topicText(TOPIC, none.config);
  assert.match(text, /\(none declared\)/, "an empty `roles:` leaves a gap the reader has to interpret");
  // The machinery is still described: the guide is one text, and a project that
  // adds a role tomorrow must not have to find a different page.
  assert.deepEqual(rolesCovered(text), []);
});
