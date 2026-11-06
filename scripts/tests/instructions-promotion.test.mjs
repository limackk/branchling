/**
 * The guides point at the promotion state where there is one (TL-584).
 *
 * The packaged skill holds no procedure and sends the agent to `instructions`,
 * so a feature the guides never name is a feature an agent falls back to
 * reading task files for. WHAT HAS TO BE PROVED:
 *
 *   1. A backlog that declares `deploy_targets` and `releases:` is shown
 *      `deploy status` and `--release`, with ITS target and release names —
 *      the names are the positive half: a guide that printed a fixed sentence
 *      would pass a needle on the command and fail on the names.
 *   2. A backlog that declares neither is shown none of it, in ANY topic. The
 *      same predicate is first shown to find the lines in the declaring
 *      fixture, so its silence over the other fixture has evidential force.
 *   3. Each half follows its own key: targets alone offer no `--release`, which
 *      would refuse there; releases alone offer no target list.
 *   4. The placeholder vanishes without a gap, and where it renders the next
 *      paragraph still starts after a blank line.
 *   5. The commands the guide offers are callable in the backlog it was
 *      rendered for — otherwise the guide teaches a refusal.
 *   6. Where every target declares `repository:`, the guide does not promise
 *      stages computed from git, which that backlog can never observe, and
 *      says what `deploy status` reports instead (TL-597). A backlog with a
 *      local target — alone or beside a foreign one — is the positive control
 *      that the same predicate still finds the claim where it is true.
 *   7. task-creation names `target:` and `new --target` exactly where a target
 *      declares `repository:`, listing only those targets, and the offered
 *      call succeeds there (TL-598). With only local targets, or none, the
 *      paragraph is absent, and the refusal it would teach there is shown to
 *      be real.
 *
 * Release and target names are deliberately unlike this repository's
 * vocabulary, so a literal in the source is the only way they could match.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../config.mjs";
import { PRODUCT_NAME } from "../product.mjs";
import { TOPIC_NAMES, promotionState, releasePlanning, targetPlanning, topicText } from "../instructions.mjs";
import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

isolateHome("instructions-promotion");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
let counter = 0;

const TARGETS = ["lighthouse", "harbour"];
const RELEASES = ["spring-tide", "neap-tide"];

const DEPLOY_YAML = `deploy_targets:
  - name: ${TARGETS[0]}
    stages:
      - { name: quay, ref: main }
      - { name: open-sea, ref: open-sea }
  - name: ${TARGETS[1]}
    stages:
      - { name: quay, ref: main }
`;
const RELEASES_YAML = `releases: [${RELEASES.join(", ")}]\n`;
/** Every target in another repository: nothing about them is in this git. */
const FOREIGN_YAML = `deploy_targets:
  - name: ${TARGETS[0]}
    repository: beacon-repo
  - name: ${TARGETS[1]}
    repository: jetty-repo
`;
/** One target here, one elsewhere: the local one makes the git claim true. */
const MIXED_YAML = `deploy_targets:
  - name: ${TARGETS[0]}
    stages:
      - { name: quay, ref: main }
  - name: ${TARGETS[1]}
    repository: jetty-repo
`;

function run(cwd, args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    cwd, encoding: "utf8", timeout: 60_000, env: { ...process.env, NO_COLOR: "1" },
  });
}

/** A backlog in a real repository with one commit, its config extended by
 *  `extra`. The commit is there so `deploy status` has a trunk to read. */
function fixture(extra) {
  const repo = mkdtempSync(join(tmpdir(), "branchling-instructions-promotion-" + counter++ + "-"));
  execFileSync("git", ["init", "-q", "-b", "main", "."], { cwd: repo, stdio: "ignore" });
  const dir = join(repo, "backlog");
  const r = run(repo, ["init", "--dir", dir, "--no-example", "--no-nudge"]);
  assert.equal(r.status, 0, "init failed: " + r.stderr);
  if (extra) appendFileSync(join(dir, "config.yaml"), "\n" + extra, "utf8");
  writeFileSync(join(repo, "a.txt"), "a\n", "utf8");
  execFileSync("git", ["add", "-A"], { cwd: repo });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-q", "-m", "first"], { cwd: repo });
  return { repo, dir, config: loadConfig(dir) };
}

function guides(config) {
  const out = {};
  for (const name of TOPIC_NAMES) out[name] = topicText(name, config);
  return out;
}

/**
 * Where in the rendered guides the promotion features are mentioned. PURE, and
 * it takes the texts, so the positive control can feed it the declaring
 * fixture before it is trusted over the silent one.
 */
function mentions(texts) {
  const hits = [];
  for (const [name, text] of Object.entries(texts)) {
    for (const needle of ["deploy status", "--release", "release:", "deploy targets"]) {
      if (text.includes(needle)) hits.push(name + ": " + needle);
    }
  }
  return hits;
}

const BOTH = fixture(DEPLOY_YAML + RELEASES_YAML);
const NEITHER = fixture("");

test("with both declared, overview routes to `deploy status` and `--release`, naming this backlog's targets and releases", () => {
  const overview = topicText("overview", BOTH.config);
  assert.ok(overview.includes(PRODUCT_NAME + " deploy status "), "overview does not name `deploy status`");
  assert.ok(overview.includes(PRODUCT_NAME + " deploy status --release <name>"), "overview does not name `--release`");
  assert.ok(overview.includes("  deploy targets  `" + TARGETS[0] + "`, `" + TARGETS[1] + "`"),
    "overview does not list the declared targets");
  assert.ok(overview.includes("  releases        `" + RELEASES[0] + "`, `" + RELEASES[1] + "`"),
    "overview does not list the declared releases");
  // Whole lines, so the indentation that makes them a command table is held
  // too, and the table stands apart from the prose that introduces it.
  assert.match(overview, new RegExp("board is not:\\n\\n {2}" + PRODUCT_NAME + " deploy status {20}what each stage does not hold yet\\n"));
  assert.ok(overview.includes("\n  " + PRODUCT_NAME + " deploy status --release <name>   a release's plan against what shipped\n"),
    "the `--release` line is not a line of the command table");
  // The context rule is the reason the line exists: the answer is asked for,
  // and it is fresher than a board.
  const flat = overview.replace(/\s+/g, " ");
  assert.match(flat, /not for the task files/, "the paragraph no longer says to ask rather than read");
  assert.match(flat, /computed from git on every call/, "the paragraph no longer says why the answer is current");
});

test("with releases declared, task-creation says a task may carry `release:` and where the plan is asked", () => {
  const creation = topicText("task-creation", BOTH.config);
  const flat = creation.replace(/\s+/g, " ");
  assert.match(flat, /`release:` names the release a task is planned for/, "task-creation does not name the field");
  assert.ok(creation.includes("\n  releases  `" + RELEASES[0] + "`, `" + RELEASES[1] + "`\n"),
    "task-creation does not list the releases on a line of their own");
  assert.match(creation, /not a reading:\n\n {2}\S/, "the command table is not set apart from the prose");
  assert.match(flat, /undeclared name FAILS/, "task-creation no longer says an undeclared release fails");
  // The refusal is named together with the way out of it; without it the
  // agent's next move is editing config.yaml by hand.
  assert.ok(creation.includes("  " + PRODUCT_NAME + " declare releases <name> --reason \"…\"   add a release to plan for"),
    "task-creation does not say how a release is declared");
  assert.ok(creation.includes("  " + PRODUCT_NAME + " deploy status --release <name>         what that release still lacks"),
    "task-creation does not say where the plan is asked");
});

test("POSITIVE CONTROL, then the guard: with neither declared, no topic mentions the promotion features", () => {
  const found = mentions(guides(BOTH.config));
  for (const expected of ["overview: deploy status", "overview: --release", "overview: deploy targets",
    "task-creation: release:", "task-creation: --release"]) {
    assert.ok(found.includes(expected), "the predicate does not find `" + expected + "` where it is rendered");
  }

  assert.equal((NEITHER.config.deployTargets || []).length, 0, "the silent fixture started declaring targets");
  assert.equal((NEITHER.config.releases || []).length, 0, "the silent fixture started declaring releases");
  assert.deepEqual(mentions(guides(NEITHER.config)), []);
  assert.equal(promotionState(NEITHER.config), "");
  assert.equal(releasePlanning(NEITHER.config), "");
});

test("each half follows its own key: targets alone offer no `--release`, releases alone list no targets", () => {
  const targetsOnly = { deployTargets: [{ name: TARGETS[0] }], releases: [] };
  const state = promotionState(targetsOnly);
  assert.ok(state.includes(PRODUCT_NAME + " deploy status "), "targets alone lost the plain `deploy status` line");
  assert.ok(state.includes("deploy targets  `" + TARGETS[0] + "`"));
  assert.ok(!state.includes("--release"), "`--release` is offered where no release is declared");
  assert.ok(!state.includes("releases "), "a release list is printed where none is declared");
  assert.equal(releasePlanning(targetsOnly), "", "task-creation offers `release:` where the field would FAIL");

  const releasesOnly = { deployTargets: [], releases: [RELEASES[1]] };
  const plan = promotionState(releasesOnly);
  assert.ok(plan.includes(PRODUCT_NAME + " deploy status --release <name>"));
  assert.ok(plan.includes("releases        `" + RELEASES[1] + "`"));
  assert.ok(!plan.includes("deploy targets"), "a target list is printed where none is declared");
  assert.ok(!plan.includes("what each stage does not hold yet"), "the per-stage line is printed with no stage declared");
  assert.ok(releasePlanning(releasesOnly).includes("`" + RELEASES[1] + "`"));

  // A config object without the keys at all — what a caller holding a partial
  // configuration passes — is the same as declaring neither, not a throw.
  assert.equal(promotionState({}), "");
  assert.equal(releasePlanning({}), "");
});

test("the paragraph vanishes without a gap, and where it renders the next one still starts after a blank line", () => {
  for (const [label, config] of [["neither", NEITHER.config], ["both", BOTH.config]]) {
    for (const [name, text] of Object.entries(guides(config))) {
      assert.ok(!/\n\n\n/.test(text), label + " / " + name + ": the placeholder left an empty paragraph");
    }
  }
  const neither = topicText("overview", NEITHER.config);
  assert.match(neither, /what an answer costs a session\n\nTHIS BACKLOG'S OWN WORDS/);
  assert.match(topicText("task-creation", NEITHER.config), /`[^`]+`\.\n\nBefore you commit:/);

  const both = topicText("overview", BOTH.config);
  assert.match(both, /what an answer costs a session\n\nWHAT IS WAITING/);
  assert.match(both, /`\n\nTHIS BACKLOG'S OWN WORDS/);
  // The command table and the name list are two blocks, not one run of lines.
  assert.match(both, /what shipped\n\n {2}deploy targets/);
  const creation = topicText("task-creation", BOTH.config);
  assert.match(creation, /still lacks\n\n {2}releases {2}`/);
  assert.match(creation, /\n {2}releases {2}[^\n]*`\n\nBefore you commit:/);
});

test("the commands the guides offer are callable in the backlog they were rendered for", () => {
  // Each half on its own as well as together: the halves are rendered
  // independently, so each has to be callable without the other's key.
  const targetsOnly = fixture(DEPLOY_YAML);
  const releasesOnly = fixture(RELEASES_YAML);
  for (const [label, fx] of [["both", BOTH], ["targets only", targetsOnly]]) {
    assert.ok(topicText("overview", fx.config).includes(PRODUCT_NAME + " deploy status "), label + ": not offered");
    const plain = run(fx.repo, ["deploy", "status", "--count", "--dir", fx.dir]);
    assert.equal(plain.status, 0, label + ": `deploy status` refuses where the guide offers it: " + plain.stderr);
  }
  for (const [label, fx] of [["both", BOTH], ["releases only", releasesOnly]]) {
    assert.ok(topicText("overview", fx.config).includes("--release <name>"), label + ": not offered");
    for (const release of fx.config.releases) {
      const r = run(fx.repo, ["deploy", "status", "--release", release, "--count", "--dir", fx.dir]);
      assert.equal(r.status, 0, label + ": `deploy status --release " + release + "` refuses where the guide offers it: " + r.stderr);
    }
  }
  // Run last and in its own fixture: it writes config.yaml.
  const declared = run(releasesOnly.repo, ["declare", "releases", "slack-water", "--reason", "fixture", "--dir", releasesOnly.dir]);
  assert.equal(declared.status, 0, "`declare releases` refuses where the guide offers it: " + declared.stderr);
  assert.ok(loadConfig(releasesOnly.dir).releases.includes("slack-water"), "`declare releases` did not declare the release");
  // The other direction is why the paragraph is conditional: in the silent
  // backlog the flag the guide would have offered is a refusal.
  const silent = run(NEITHER.repo, ["deploy", "status", "--release", RELEASES[0], "--dir", NEITHER.dir]);
  assert.notEqual(silent.status, 0, "`--release` no longer refuses without `releases:` — the condition may be obsolete");
});

/** What the paragraph claims about where its answer comes from. PURE, so the
 *  same predicate is shown to find the claim before its absence is trusted. */
function gitClaims(text) {
  const flat = text.replace(/\s+/g, " ");
  const hits = [];
  if (/computed from git on every call/.test(flat)) hits.push("computed from git");
  if (flat.includes("what each stage does not hold yet")) hits.push("per-stage line");
  return hits;
}

test("POSITIVE CONTROL, then the guard: with every target in another repository, overview claims no stages computed from git", () => {
  const mixed = fixture(MIXED_YAML);
  for (const [label, config] of [["both", BOTH.config], ["mixed", mixed.config]]) {
    assert.deepEqual(gitClaims(topicText("overview", config)), ["computed from git", "per-stage line"],
      label + ": the predicate does not find the claim where a local target makes it true");
  }

  for (const [label, extra] of [["foreign only", FOREIGN_YAML], ["foreign with releases", FOREIGN_YAML + RELEASES_YAML]]) {
    const fx = fixture(extra);
    assert.equal(fx.config.deployTargets.length, 2, label + ": the fixture lost its targets");
    assert.ok(fx.config.deployTargets.every((t) => t.repository), label + ": a fixture target stopped being foreign");
    const overview = topicText("overview", fx.config);
    assert.deepEqual(gitClaims(overview), [], label + ": overview promises what this backlog cannot observe");
    // The command stays offered — it answers there — with what it does answer.
    assert.ok(overview.includes("\n  " + PRODUCT_NAME + " deploy status                    each target's tasks, unobservable here\n"),
      label + ": the `deploy status` line does not say what it reports for foreign targets");
    const flat = overview.replace(/\s+/g, " ");
    assert.match(flat, /It is not computed from git: every deploy target here declares `repository:`/,
      label + ": the paragraph does not say why git is not read");
    assert.match(flat, /joins such a target by its own `target:` field and is reported as unobservable here/,
      label + ": the paragraph does not name the field a task uses instead");
    assert.match(flat, /computed on every call, so it is current where a board is not/,
      label + ": the paragraph lost the reason to ask rather than read");
    assert.ok(overview.includes("  deploy targets  `" + TARGETS[0] + "`, `" + TARGETS[1] + "`"),
      label + ": the declared targets are no longer listed");
    assert.ok(!/\n\n\n/.test(overview), label + ": the paragraph left an empty one behind");
    assert.match(overview, /unobservable here, never as deployed:\n\n {2}\S/, label + ": the command table is not set apart");
    // What the guide says is what the command does: it answers, and says why.
    const r = run(fx.repo, ["deploy", "status", "--dir", fx.dir]);
    assert.equal(r.status, 0, label + ": `deploy status` refuses where the guide offers it: " + r.stderr);
    assert.match(r.stdout, /unobservable here/, label + ": `deploy status` no longer reports foreign targets as unobservable");
  }

  // Releases alone hold no target either, so the git claim follows the same
  // predicate; the foreign explanation is not offered where nothing is foreign.
  const releasesOnly = topicText("overview", fixture(RELEASES_YAML).config);
  assert.deepEqual(gitClaims(releasesOnly), [], "releases alone: overview claims git where no target is declared");
  assert.ok(!releasesOnly.includes("`repository:`"), "releases alone: the foreign-target explanation is printed");
  assert.ok(!releasesOnly.includes("unobservable here"), "releases alone: a foreign-target line is printed");
  assert.match(releasesOnly, /current where a board is not:\n\n {2}\S/, "releases alone: the command table is not set apart");
  // Whole sentence, across the wrap: the reason to ask rather than read is the
  // half of the paragraph that stays true without git.
  assert.match(releasesOnly, /is a question\nfor the tool, not for the task files\. The answer is computed on every call, so\nit is current/,
    "releases alone: the paragraph lost the reason to ask rather than read");
});

/** Where task-creation teaches `target:`. PURE, so it is shown to find the
 *  paragraph in a foreign fixture before its silence elsewhere is trusted. */
function targetTeaching(text) {
  const hits = [];
  if (text.includes("`target:` names the deploy targets")) hits.push("field");
  if (text.includes(" new --title \"…\" --target ")) hits.push("command");
  if (text.includes("  foreign targets  ")) hits.push("names");
  return hits;
}

test("POSITIVE CONTROL, then the guard: task-creation names `target:` only where a target declares `repository:`", () => {
  const foreign = fixture(FOREIGN_YAML);
  const mixed = fixture(MIXED_YAML + RELEASES_YAML);
  const localOnly = fixture(DEPLOY_YAML);

  // Foreign only: the field, the command and every foreign name, as a table
  // set apart from the prose and followed by a blank line.
  const creation = topicText("task-creation", foreign.config);
  assert.deepEqual(targetTeaching(creation), ["field", "command", "names"], "foreign: the paragraph is not rendered");
  const flat = creation.replace(/\s+/g, " ");
  assert.match(flat, /when their code lives in another repository \(`repository:`\)\. Git here holds no commit of them, so the field is the only thing that joins the task to them\. Name them when the task is created:/,
    "foreign: the paragraph does not say why the field is needed");
  assert.ok(!flat.includes("A target of this repository"), "foreign: the local-target sentence is printed with no local target");
  assert.match(creation, /Name them when the task is created:\n\n {2}\S/, "foreign: the command table is not set apart");
  assert.ok(creation.includes("\n  " + PRODUCT_NAME + " new --title \"…\" --target <name,…>   a task that ships from there\n"),
    "foreign: the `new --target` line is not a line of the command table");
  assert.ok(creation.includes("\n  foreign targets  `" + TARGETS[0] + "`, `" + TARGETS[1] + "`\n\nBefore you commit:"),
    "foreign: the foreign targets are not listed on a line of their own before the next paragraph");
  // The command table and the name list are two blocks, not one run of lines.
  assert.match(creation, /ships from there\n\n {2}foreign targets {2}`/, "foreign: the name list runs into the command table");
  assert.ok(!/\n\n\n/.test(creation), "foreign: the paragraph left an empty one behind");

  // Mixed: only the foreign name, and the reason the local one is missing.
  const mixedText = topicText("task-creation", mixed.config);
  assert.deepEqual(targetTeaching(mixedText), ["field", "command", "names"], "mixed: the paragraph is not rendered");
  assert.ok(mixedText.includes("\n  foreign targets  `" + TARGETS[1] + "`\n\n"), "mixed: the list is not the foreign target alone");
  assert.ok(!mixedText.includes("`" + TARGETS[0] + "`"), "mixed: the local target is offered for `target:`");
  const mixedFlat = mixedText.replace(/\s+/g, " ");
  assert.match(mixedFlat, /joins the task to them\. A target of this repository is not named there: its tasks are computed from the paths their commits touch, and `new --target` refuses it\. Name the others when the task is created:/,
    "mixed: the paragraph does not say why the local target is not listed");
  assert.match(mixedText, /Name the others when the task is created:\n\n {2}\S/, "mixed: the command table is not set apart");
  // Beside releases both paragraphs stand, each followed by a blank line.
  assert.match(mixedText, /`\n\nPLANNING IT FOR A RELEASE/, "mixed: the release paragraph does not follow after a blank line");
  assert.ok(!/\n\n\n/.test(mixedText), "mixed: a paragraph left an empty one behind");

  // Only local targets, or none at all: silent, in every topic.
  for (const [label, config] of [["local only", localOnly.config], ["local with releases", BOTH.config], ["neither", NEITHER.config]]) {
    for (const [name, text] of Object.entries(guides(config))) {
      assert.deepEqual(targetTeaching(text), [], label + " / " + name + ": `target:` is taught where `new --target` refuses");
    }
    assert.equal(targetPlanning(config), "", label + ": the paragraph is not empty");
  }
  assert.equal(targetPlanning({}), "", "a partial configuration is not the same as declaring nothing");

  // What the guide offers is what the command does. A NEW fixture per call:
  // `new` writes a task into it.
  for (const [label, fx] of [["foreign", fixture(FOREIGN_YAML)], ["mixed", fixture(MIXED_YAML)]]) {
    const names = fx.config.deployTargets.filter((t) => t.repository).map((t) => t.name);
    const r = run(fx.repo, ["new", "--title", "Ships elsewhere", "--target", names.join(","), "--dir", fx.dir, "--json"]);
    assert.equal(r.status, 0, label + ": `new --target` refuses where the guide offers it: " + r.stderr);
    const written = readFileSync(JSON.parse(r.stdout).file, "utf8");
    assert.match(written, new RegExp("^target: \\[" + names.join(", ") + "\\]", "m"),
      label + ": the task does not carry the target it was created with");
  }
  // The other direction is why the paragraph is conditional: where every target
  // is local, the call it would offer is a refusal.
  const refused = run(localOnly.repo, ["new", "--title", "Ships here", "--target", TARGETS[0], "--dir", localOnly.dir]);
  assert.notEqual(refused.status, 0, "`new --target` accepts a local target — the condition may be obsolete");
});
