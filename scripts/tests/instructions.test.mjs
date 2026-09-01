/**
 * `instructions` — the workflow printed by the tool itself (TL-74).
 *
 * WHAT HAS TO BE PROVED, and why each part needs its own control:
 *
 *   1. THE TEXT CARRIES NO PROJECT'S VOCABULARY. This is the claim the whole
 *      task rests on, and it is the one a reader cannot check by eye: a status
 *      written out as a literal renders identically to one substituted from the
 *      configuration. So the fixture backlog is given a DELIBERATELY UNUSUAL
 *      vocabulary — no status, priority, type, estimate or id prefix of it is a
 *      default — and the rendered guides are searched for the DEFAULTS. A literal
 *      in the source is then the only way a default word can appear.
 *   2. THE SEARCH HAS TEETH. A scan that finds nothing is worth nothing until it
 *      is shown to find something, so the same scan is run over a sentence with a
 *      default status in it and asserted to catch it. Without that, deleting the
 *      guides would make this file green.
 *   3. THE SUBSTITUTION REALLY HAPPENED. Absence of the defaults is also what you
 *      get from an empty page. The fixture's OWN words are therefore asserted to
 *      be present — the positive half of the same measurement.
 *   4. `overview` IS A SWITCHBOARD. It has to name every phase guide and say that
 *      reading it is required; it must NOT carry their procedure. Measured by the
 *      command invocations that belong to those guides being absent from it.
 *   5. THE POINTER IS INSTALLED, PRESERVING, AND REFRESHABLE. A block written
 *      into somebody's agent file must not destroy what was there, must not be
 *      appended twice, and an OLDER version must be replaced in place — that is
 *      the entire reason it carries a version.
 *
 * WHAT IS DELIBERATELY MASKED BEFORE THE VOCABULARY SCAN: command names and flag
 * names. `done` is the name of a command and `--blocked-by` the name of a flag —
 * they are the CODE's shape, ours to spell however we like, and they do not
 * change when a project renames its statuses. Leaving them in would make the scan
 * fail on text that is correct.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { COMMANDS } from "../cli.mjs";
import { DEFAULTS, loadConfig } from "../config.mjs";
import { DEFAULT_TASK_ID_PREFIX } from "../task-id.mjs";
import { PRODUCT_NAME } from "../product.mjs";
import {
  NUDGE_VERSION,
  NUDGE_CLOSE,
  NUDGE_OPEN_PREFIX,
  TOPICS,
  TOPIC_NAMES,
  topicText,
  vocabulary,
} from "../instructions.mjs";
import { REPO_ROOT, SCRIPTS_DIR } from "./_repo.mjs";

const CLI = join(SCRIPTS_DIR, "cli.mjs");

let counter = 0;
function run(args, cwd) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    cwd, encoding: "utf8", timeout: 60_000, env: { ...process.env, NO_COLOR: "1" },
  });
}

/**
 * A backlog whose vocabulary shares NOTHING with the defaults — that is the
 * whole point of the fixture. Every value below is chosen so that finding a
 * default word in the output can only mean a literal in the source.
 */
const OWN = {
  project: "Cartography",
  prefix: "ZZ",
  statuses: ["icebox", "surveying", "parked", "charted", "abandoned"],
  archived: ["charted", "abandoned"],
  progress: "surveying",
  priorities: ["urgent", "ordinary", "someday"],
  types: ["survey", "expedition"],
  estimates: ["15m", "3h", "5d"],
  reasonRequired: ["parked", "abandoned"],
};

const CONFIG_YAML = `project_name: "${OWN.project}"
task_id_prefix: "${OWN.prefix}"
statuses: [${OWN.statuses.join(", ")}]
archived_statuses: [${OWN.archived.join(", ")}]
in_progress_status: ${OWN.progress}
reason_required_statuses: [${OWN.reasonRequired.join(", ")}]
dashboard_open_statuses: [${OWN.statuses.filter((s) => OWN.archived.indexOf(s) < 0).join(", ")}]
priorities: [${OWN.priorities.join(", ")}]
types: [${OWN.types.join(", ")}]
estimates: [${OWN.estimates.join(", ")}]
`;

/** A backlog inside a real git repository, with the unusual vocabulary in place.
 *  `agent` names an agent file to create first, so the nudge has something to
 *  append to. */
function fixture({ agent = null, agentBody = "" } = {}) {
  const repo = mkdtempSync(join(tmpdir(), "worktrail-instructions-" + counter++ + "-"));
  execFileSync("git", ["init", "-q", "-b", "main", "."], { cwd: repo, stdio: "ignore" });
  if (agent) writeFileSync(join(repo, agent), agentBody, "utf8");
  const dir = join(repo, "backlog");
  const r = run(["init", "--dir", dir, "--no-example", "--no-nudge"]);
  assert.equal(r.status, 0, "init failed: " + r.stderr);
  writeFileSync(join(dir, "config.yaml"), CONFIG_YAML, "utf8");
  return { repo, dir };
}

// ── The vocabulary scan, and its own controls ─────────────────────────────

/** Command invocations and flag names removed — see the header. */
function maskShape(text) {
  let out = String(text);
  for (const name of Object.keys(COMMANDS)) out = out.split(PRODUCT_NAME + " " + name).join(" ");
  out = out.split("--blocked-by").join(" ");
  // The shell's own block keywords, where they terminate an indented sample
  // (TL-104). `done` closing a `while` loop is the SHELL's word, the same class
  // of false positive as the command name masked above and as `task` excluded
  // from the list below — and the guide that shows how to drive this tool from a
  // loop cannot print a loop without it. Anchored to an indented line of its own
  // so that a default status in prose, wherever it stands, is still caught.
  out = out.replace(/^[ \t]+(done|do|fi|then|esac)\b/gm, " ");
  return out;
}

/**
 * Default vocabulary values that must never appear. `task` is excluded on
 * purpose: it is the default `types` value AND this domain's ordinary noun, so
 * its presence is not evidence of anything.
 */
const FORBIDDEN = [
  ...DEFAULTS.statuses,
  ...DEFAULTS.priorities,
  ...DEFAULTS.types,
  ...DEFAULTS.estimates,
  ...DEFAULTS.owners,
].filter((w) => w !== "task");

function defaultsFoundIn(text) {
  const masked = maskShape(text);
  const hits = FORBIDDEN.filter((w) => new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(masked));
  if (masked.includes(DEFAULT_TASK_ID_PREFIX + "-")) hits.push(DEFAULT_TASK_ID_PREFIX + "-");
  return hits;
}

test("positive control: there are topics, they all render, and the scan can catch a literal", () => {
  // Every assertion below iterates over the topics. An empty table would make
  // the whole file green without asking anything.
  assert.ok(TOPIC_NAMES.length >= 4, "expecting a switchboard and a guide per phase");
  assert.deepEqual(TOPIC_NAMES, Object.keys(TOPICS));

  // The scan itself: shown to FIND something before it is trusted to find
  // nothing. Both halves matter — a default status is caught, and a command name
  // spelled the same way is not.
  assert.deepEqual(defaultsFoundIn("set the status to " + DEFAULTS.statuses[0]), [DEFAULTS.statuses[0]]);
  assert.deepEqual(defaultsFoundIn("run " + PRODUCT_NAME + " done <ID> to close it"), []);
  // The shell mask has the same two halves: a loop terminator is not a status,
  // and a status indented under a heading still is.
  assert.deepEqual(defaultsFoundIn("  while x; do y\n  done"), []);
  assert.deepEqual(defaultsFoundIn("  the status is " + DEFAULTS.statuses[3]), [DEFAULTS.statuses[3]]);
  assert.ok(maskShape(TOPICS.overview.text).length > 500, "masking must not blank the text it is checking");
});

test("no topic carries a default status, priority, estimate or id prefix", () => {
  const fx = fixture();
  const config = loadConfig(fx.dir);
  for (const name of TOPIC_NAMES) {
    const text = topicText(name, config);
    assert.deepEqual(defaultsFoundIn(text), [], name + ": this backlog's own words are not in the output");
  }
});

test("the fixture's OWN words reach the output — the substitution really ran", () => {
  const fx = fixture();
  const config = loadConfig(fx.dir);
  const all = TOPIC_NAMES.map((n) => topicText(n, config)).join("\n");
  for (const word of [
    OWN.prefix + "-", OWN.progress, OWN.priorities[0], OWN.types[0],
    OWN.estimates[0], OWN.statuses[0], OWN.archived[0], OWN.reasonRequired[0],
  ]) {
    assert.ok(all.includes(word), "the rendered guides never mention `" + word + "`");
  }
  // The closing status is named on its own, and the OTHER archived statuses are
  // named separately — a guide that listed all of them would be telling the
  // reader that closing normally needs a stated reason, which is false.
  const closing = topicText("task-finalization", config);
  assert.ok(closing.includes("`" + OWN.archived[0] + "`"), "the closing status is not named");
  assert.ok(closing.includes("`" + OWN.archived[1] + "`"), "the other archived statuses are not named");
});

/**
 * What the phase guides may not stop saying (TL-101).
 *
 * The needles are the THESIS, not the wording. An assertion on a whole sentence
 * would have to be edited every time somebody improves the prose, and a test
 * that is edited to stay green is the first one loosened until it guards
 * nothing. What is pinned here is: the primitives are NAMED, doing it by hand is
 * REFUSED, and the by-hand route that does exist is the one that records itself.
 *
 * PURE, and it takes the texts rather than reading them, so the control below
 * can feed it a guide with the sentence removed.
 *
 * @returns {string[]} problems; empty means the guides still say it
 */
function primitivesPromised(guides) {
  const problems = [];
  // Flattened first: the guides are wrapped at 72 columns, so a sentence is
  // regularly cut in the middle by a newline. A needle that cannot survive the
  // line break would be measuring the typesetting.
  const flat = (name) => String(guides[name] || "").replace(/\s+/g, " ");
  const need = (name, re, what) => {
    if (!re.test(flat(name))) problems.push(name + ": " + what);
  };
  need("task-execution", new RegExp(PRODUCT_NAME + " take"), "does not name the command that claims a task");
  need("task-execution", new RegExp(PRODUCT_NAME + " next"), "does not name the dispatcher");
  need("task-execution", /(do not|don't|never)[^.]{0,60}by hand/i, "no longer refuses hand-editing to claim a task");
  need("task-execution", /history[^.]*--source manual/, "does not say how a hand edit is recorded");
  need("task-finalization", new RegExp(PRODUCT_NAME + " done"), "does not name the command that closes a task");
  need("task-finalization", /(do not|don't|never)[^.]{0,60}by hand/i, "no longer refuses closing a task by hand");
  return problems;
}

test("the guides tell an agent to use the primitives, not to edit fields", () => {
  // The sentence the whole direct mode rests on. It was true when TL-101 was
  // written and nothing measured it, so one commit could have removed it in
  // silence — which is what this test exists to stop, not to introduce.
  const fx = fixture();
  const config = loadConfig(fx.dir);
  const guides = {};
  for (const name of TOPIC_NAMES) guides[name] = topicText(name, config);
  assert.deepEqual(primitivesPromised(guides), []);
});

test("POSITIVE CONTROL: remove the sentence and the guard says which one went", () => {
  // Without this pair, the assertion above passes just as well against a check
  // that cannot fail — the failure mode of every "the text contains X" test.
  const fx = fixture();
  const config = loadConfig(fx.dir);
  const guides = {};
  for (const name of TOPIC_NAMES) guides[name] = topicText(name, config);

  const stripped = { ...guides, "task-execution": guides["task-execution"].replace(/by\s+hand/gi, "somehow") };
  const problems = primitivesPromised(stripped);
  assert.equal(problems.length, 1, "removing the prohibition was not noticed");
  assert.match(problems[0], /task-execution: no longer refuses hand-editing/);

  // And the other half: a guide that says nothing at all fails on every needle
  // it owns, rather than on none of them.
  assert.equal(primitivesPromised({ ...guides, "task-finalization": "" }).length, 2);
});

test("a placeholder nobody defined THROWS instead of being printed", () => {
  const fx = fixture();
  const config = loadConfig(fx.dir);
  const vocab = vocabulary(config);
  assert.ok(Object.keys(vocab).length > 5);
  // Every placeholder used in the templates is resolved by the loop above; this
  // is the other direction — an invented one must not reach a user's terminal.
  const bad = { ...TOPICS.overview, text: "{{no_such_key}}" };
  assert.throws(() => {
    const saved = TOPICS.overview;
    try { TOPICS.overview = bad; topicText("overview", config); } finally { TOPICS.overview = saved; }
  }, /unknown placeholder/);
});

// ── The command surface ───────────────────────────────────────────────────

test("no topic lists the topics; every topic prints; an unknown one FAILS", () => {
  const fx = fixture();

  const listing = run(["instructions", "--dir", fx.dir]);
  assert.equal(listing.status, 0, listing.stderr);
  for (const name of TOPIC_NAMES) {
    assert.ok(listing.stdout.includes(name), "the listing omits the topic `" + name + "`");
  }

  for (const name of TOPIC_NAMES) {
    const r = run(["instructions", name, "--dir", fx.dir]);
    assert.equal(r.status, 0, name + ": " + r.stderr);
    assert.ok(r.stdout.trim().length > 400, name + ": printed nothing worth reading");
  }

  const unknown = run(["instructions", "task-invention", "--dir", fx.dir]);
  assert.equal(unknown.status, 2, "an unknown topic must be a usage error");
  for (const name of TOPIC_NAMES) {
    assert.ok(unknown.stderr.includes(name), "the refusal does not list the topic `" + name + "`");
  }

  const flag = run(["instructions", "--overview", "--dir", fx.dir]);
  assert.equal(flag.status, 2, "an unknown flag must be a usage error");
});

test("`overview` is a switchboard: it routes, requires, and does not repeat the procedure", () => {
  const fx = fixture();
  const text = topicText("overview", loadConfig(fx.dir));

  for (const name of TOPIC_NAMES.filter((n) => n !== "overview")) {
    assert.ok(text.includes(PRODUCT_NAME + " instructions " + name), "overview does not route to `" + name + "`");
  }
  assert.match(text, /REQUIRED/, "overview does not say that reading the matching guide is required");
  assert.match(text, /do I have to think about HOW/, "the one question that decides whether to open a task is missing");

  // The procedure lives in the phase guides. These invocations are theirs.
  for (const owned of ["new --title", "done <ID>", "take <ID>", "--confirm-manual", "--dry-run"]) {
    assert.ok(!text.includes(owned), "overview repeats the procedure: `" + owned + "`");
  }
});

test("--json answers in the envelope, and always carries the whole topic list", () => {
  const fx = fixture();

  const listing = JSON.parse(run(["instructions", "--json", "--dir", fx.dir]).stdout);
  assert.equal(listing.kind, "instructions");
  assert.equal(listing.topic, null);
  assert.equal(listing.text, null);
  assert.deepEqual(listing.topics.map((t) => t.name), TOPIC_NAMES);
  assert.equal(listing.version, NUDGE_VERSION);

  const one = JSON.parse(run(["instructions", "overview", "--json", "--dir", fx.dir]).stdout);
  assert.equal(one.topic, "overview");
  assert.ok(one.text.includes(OWN.prefix + "-"), "the JSON text is not rendered with this backlog's vocabulary");
  assert.deepEqual(one.topics.map((t) => t.name), TOPIC_NAMES,
    "asking for one topic must not hide the others — a consumer would hard-code the list");
});

// ── One source ───────────────────────────────────────────────────────────

test("the editor skill POINTS at the command instead of repeating it", () => {
  // Two documents saying the same thing are two documents that will disagree.
  // The skill keeps its trigger description — that is what makes an editor load
  // it — and hands the procedure over to the command.
  const path = join(REPO_ROOT, ".claude", "skills", "backlog-workflow", "SKILL.md");
  assert.ok(existsSync(path), "the skill is gone — if that was deliberate, this test goes with it");
  const text = readFileSync(path, "utf8");
  const body = text.slice(text.indexOf("---", 3) + 3);

  assert.ok(body.includes("instructions overview"), "the skill does not send the reader to the command");
  assert.deepEqual(defaultsFoundIn(body), [],
    "the skill still spells out a vocabulary — that is the copy this task removed");
});

// ── The pointer in the agent file ────────────────────────────────────────

function agentFile(fx, name) {
  const p = join(fx.repo, name);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

test("`init` appends the pointer, keeps what was there, and does not append twice", () => {
  const body = "# Their repository\n\nTheir own guidance, which is not ours to touch.\n";
  const fx = fixture({ agent: "CLAUDE.md", agentBody: body });

  const first = run(["init", "--dir", fx.dir]);
  assert.equal(first.status, 0, first.stderr);
  const after = agentFile(fx, "CLAUDE.md");
  assert.ok(after.startsWith(body), "the pointer overwrote what was already in the file");
  assert.ok(after.includes(NUDGE_OPEN_PREFIX + " v" + NUDGE_VERSION), "no versioned pointer was written");
  assert.ok(after.includes(PRODUCT_NAME + " instructions overview"), "the pointer does not name the command");

  const second = run(["init", "--dir", fx.dir]);
  assert.equal(second.status, 0, second.stderr);
  const twice = agentFile(fx, "CLAUDE.md");
  assert.equal(twice, after, "a second init changed the file");
  assert.equal(twice.split(NUDGE_CLOSE).length - 1, 1, "the pointer was appended a second time");
});

test("with no agent file, exactly one is created — the editor-neutral one", () => {
  const fx = fixture();
  assert.equal(run(["init", "--dir", fx.dir]).status, 0);
  assert.equal(agentFile(fx, "CLAUDE.md"), null, "an editor-specific file was invented");
  assert.ok(String(agentFile(fx, "AGENTS.md")).includes(NUDGE_CLOSE), "no agent file was written at all");
});

test("`--no-nudge` writes nothing — and says so rather than passing over it", () => {
  const fx = fixture({ agent: "AGENTS.md", agentBody: "# Theirs\n" });
  const r = run(["init", "--dir", fx.dir, "--no-nudge"]);
  assert.equal(r.status, 0);
  assert.equal(agentFile(fx, "AGENTS.md"), "# Theirs\n", "the block was written despite --no-nudge");
  assert.match(r.stdout, /AGENTS\.md/, "a file left alone in silence reads like a file already in order");
  assert.ok(r.stdout.includes("--update-nudge"), "the report does not say how to write it after all");
});

test("a backlog that never said which status means `in progress` is told so", () => {
  // `vocabulary` is pure, so the awkward configuration can be handed to it
  // directly. `take` and `next` refuse in this state, and the guide is where a
  // reader finds out why.
  const bare = {
    taskIdPrefix: "QQ", projectName: "Bare", statuses: ["a", "b"], activeStatuses: ["a"],
    archivedStatuses: ["b"], reasonRequiredStatuses: ["b"], inProgressStatus: null,
    priorities: ["one"], types: ["t"], estimates: ["1h"], boards: [],
  };
  const vocab = vocabulary(bare);
  assert.match(vocab.progress, /in_progress_status/, "the empty value states no remedy");
  assert.equal(vocab.other_archived_statuses, "(none declared)",
    "an empty list must say it is empty, not leave a gap the reader interprets");
});

test("an OLDER pointer is replaced in place, not appended beside", () => {
  // This is the whole reason the marker carries a version. The block below is
  // what a previous release would have left behind.
  const stale = [
    "# Theirs",
    "",
    NUDGE_OPEN_PREFIX + " v0 -->",
    "Run the old command that no longer exists.",
    NUDGE_CLOSE,
    "",
    "Their closing paragraph.",
    "",
  ].join("\n");
  const fx = fixture({ agent: "CLAUDE.md", agentBody: stale });

  const r = run(["instructions", "--update-nudge", "--dir", fx.dir]);
  assert.equal(r.status, 0, r.stderr);
  const after = agentFile(fx, "CLAUDE.md");
  assert.equal(after.split(NUDGE_CLOSE).length - 1, 1, "the old block was left in place beside the new one");
  assert.ok(!after.includes("the old command that no longer exists"), "the stale text survived");
  assert.ok(after.includes(NUDGE_OPEN_PREFIX + " v" + NUDGE_VERSION), "the version was not refreshed");
  assert.ok(after.startsWith("# Theirs"), "their heading was lost");
  assert.ok(after.includes("Their closing paragraph."), "text AFTER the block was lost");

  // Idempotent: a second refresh has nothing to do and says so.
  const again = run(["instructions", "--update-nudge", "--dir", fx.dir]);
  assert.equal(again.status, 0);
  assert.equal(agentFile(fx, "CLAUDE.md"), after, "a refresh at the current version still rewrote the file");
});
