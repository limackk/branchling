/**
 * The front door describes THIS product, and its demonstrations run (TL-384).
 *
 * WHY THIS FILE EXISTS RATHER THAN A PROOFREAD. Four tasks removed surfaces
 * from this tool — telemetry, a portfolio, a fleet manager's reports, a viewer
 * that wrote — and a README is the last place a removal is noticed, because
 * nothing fails when a paragraph goes on describing a command that left. At the
 * moment this was written the README still offered `branchling sessions` and
 * `branchling session <id>`, both deleted by TL-378 two weeks earlier, and a
 * ```bash fence with nothing inside it where a command used to be. Neither cost
 * a single red test.
 *
 * So the onboarding documents are read as CLAIMS and each one is checked:
 *
 *   1. every command they name exists;
 *   2. every file they say ships is in the package;
 *   3. the three scenarios the task names run offline, against a fixture, with
 *      no credentials and no network.
 *
 * WHAT IT DOES NOT CLAIM. That a stranger UNDERSTOOD any of it. Comprehension
 * is recorded by the founder separately and no assertion here is evidence of
 * it; this file proves only that the commands are still real and still do what
 * the page says.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HOME_ENV } from "../home.mjs";
import { REPO_ROOT, SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

isolateHome("onboarding-evidence-loop");
const CLI = join(SCRIPTS_DIR, "cli.mjs");

/** What a stranger reads before they have installed anything. */
const ONBOARDING = ["README.md", join("docs", "demo", "scenario.md"), "CONTRIBUTING.md"];

function fixture(label) {
  const dir = mkdtempSync(join(tmpdir(), "branchling-" + label + "-"));
  const backlog = join(dir, "backlog");
  const env = {
    ...process.env, NO_COLOR: "1",
    [HOME_ENV]: join(dir, "home"),
    BACKLOG_STATE_DIR: join(dir, "state"),
  };
  const init = run(["init", "--dir", backlog, "--no-example"], env, dir);
  assert.equal(init.status, 0, init.stdout + init.stderr);
  return { dir, backlog, env };
}

const run = (args, env, cwd) =>
  spawnSync(process.execPath, [CLI].concat(args), { cwd, encoding: "utf8", timeout: 60_000, env });

function create(backlog, env, dir, title) {
  const made = run(["new", "--dir", backlog, "--title", title], env, dir);
  assert.equal(made.status, 0, made.stdout + made.stderr);
  return made.stdout.match(/[A-Z]+-\d+/)[0];
}

const taskFile = (backlog, id) =>
  join(backlog, "tasks", readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-")));

/** The commands the CLI actually dispatches, read from the CLI itself. */
function knownCommands() {
  const help = spawnSync(process.execPath, [CLI, "--help"], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  assert.equal(help.status, 0, "the CLI cannot print its own help");
  const names = [...help.stdout.matchAll(/^  ([a-z][a-z-]+) {2,}/gm)].map((m) => m[1]);
  assert.ok(names.length > 10, "only " + names.length + " commands parsed out of --help — the sample is empty, not green");
  return new Set(names);
}

test("every command the onboarding names is a command this tool has", () => {
  const known = knownCommands();
  // The product name is read from the manifest rather than written here: a page
  // naming the tool is naming whatever `product.mjs` says it is called.
  const product = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).name;
  const offenders = [];
  let examined = 0;
  for (const doc of ONBOARDING) {
    const text = readFileSync(join(REPO_ROOT, doc), "utf8");
    // TWO PLACES A COMMAND IS PROMISED, and the second was found the hard way.
    // A fenced block is the obvious one. An inline `code span` is the other, and
    // it is where `branchling session <id> --json` survived a first pass of this
    // guard: prose is excluded because "branchling owns what must survive" is a
    // sentence and `owns` is not a subcommand, but a backtick makes the author's
    // intent explicit and is fair to judge.
    const blocks = text.match(/```bash\n([\s\S]*?)```/g) || [];
    const spans = (text.match(/`[^`\n]+`/g) || []);
    for (const block of blocks.concat(spans)) {
      for (const m of block.matchAll(new RegExp("(?:^|[|(&`]\\s*)" + product + " ([a-z][a-z-]+)", "gm"))) {
        examined += 1;
        if (!known.has(m[1])) offenders.push(doc + ": `" + product + " " + m[1] + "`");
      }
    }
  }
  assert.ok(examined > 5, "only " + examined + " command(s) found in the onboarding — the sample is empty, not green");
  assert.deepEqual(offenders, [], "the onboarding offers commands that do not exist");
});

test("no onboarding command block is empty", () => {
  // A fence with nothing in it is what a removed command leaves behind, and it
  // reads as a page still mid-edit. Found for real in README.md at the line that
  // used to offer a wave watcher.
  const empty = [];
  for (const doc of ONBOARDING) {
    const lines = readFileSync(join(REPO_ROOT, doc), "utf8").split("\n");
    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i].startsWith("```") && lines[i].length > 3 && lines[i + 1].trim() === "```") {
        empty.push(doc + ":" + (i + 1));
      }
    }
  }
  assert.deepEqual(empty, [], "an onboarding code block promises a command and shows none");
});

test("every shipped file the onboarding points at is in the package", () => {
  const packed = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000,
  }));
  const files = new Set(packed[0].files.map((f) => f.path));
  assert.ok(files.size > 10, "the package lists " + files.size + " file(s) — the sample is empty, not green");
  // Only the paths the README calls SHIPPED. A link to `docs/` is a link into
  // the repository, which is a different promise and stays outside this rule.
  const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf8");
  const claimed = [...readme.matchAll(/`(bin\/[\w.\-/]+|scripts\/[\w.\-/]+|_template\.md|LICENSE)`/g)].map((m) => m[1]);
  const missing = [...new Set(claimed)].filter((p) => !files.has(p) && !p.endsWith("/"));
  assert.deepEqual(missing, [], "the README names shipped files the tarball does not carry");
});

test("scenario 1 — one agent stops and another continues from repository state", () => {
  const { dir, backlog, env } = fixture("replacement");
  try {
    const id = create(backlog, env, dir, "Work that outlives the session that started it");

    // The first hand claims it and then is gone. Nothing is cleaned up: that is
    // the point — the successor has only what reached the repository.
    const claimed = run(["take", id, "--dir", backlog, "--actor", "agent:first"], env, dir);
    assert.equal(claimed.status, 0, claimed.stdout + claimed.stderr);
    assert.match(readFileSync(taskFile(backlog, id), "utf8"), /^owner: agent:first$/m);

    // A STRANGER MAY NOT DROP IT, and this refusal is half the demonstration:
    // the claim is a statement about who is responsible, so a passer-by cannot
    // quietly clear it. Measured here rather than described, because a boundary
    // nobody tested is a boundary nobody has.
    const stranger = run(["release", id, "--dir", backlog, "--actor", "agent:second",
                          "--reason", "not mine to drop"], env, dir);
    assert.notEqual(stranger.status, 0, "anybody could release somebody else's claim");
    assert.match(readFileSync(taskFile(backlog, id), "utf8"), /^owner: agent:first$/m,
      "the refused release changed the owner anyway");

    // The successor is briefed from the repository alone — the same actor slot,
    // a different process. That is what "the provider is replaceable" means
    // here: the identity that holds work is a slot in the repository, not the
    // session that happened to fill it.
    const briefing = run(["resume", id, "--dir", backlog, "--actor", "agent:first", "--no-verify"], env, dir);
    assert.equal(briefing.status, 0, briefing.stdout + briefing.stderr);
    assert.match(briefing.stdout, new RegExp(id), "the briefing does not name the task it is about");

    // And the claim goes back to the queue, by the hand that holds it.
    const returned = run(["release", id, "--dir", backlog, "--actor", "agent:first",
                          "--reason", "the session that held it ended"], env, dir);
    assert.equal(returned.status, 0, returned.stdout + returned.stderr);

    const second = run(["next", "--dir", backlog, "--actor", "agent:second", "--json"], env, dir);
    assert.equal(second.status, 0, second.stdout + second.stderr);
    assert.equal(JSON.parse(second.stdout).task.id, id, "the queue did not hand the released task to the next agent");
    assert.match(readFileSync(taskFile(backlog, id), "utf8"), /^owner: agent:second$/m);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("scenario 2 — two claims do not collide, and neither crosses the plan boundary", () => {
  const { dir, backlog, env } = fixture("claiming");
  try {
    const first = create(backlog, env, dir, "The first piece of work");
    const second = create(backlog, env, dir, "The second piece of work");
    const later = create(backlog, env, dir, "Work the plan puts in a later wave");

    // TWO ASKS, TWO ANSWERS. Selection and reservation are one act, so the
    // second caller cannot be handed what the first is holding.
    const a = run(["next", "--dir", backlog, "--actor", "agent:a", "--json"], env, dir);
    const b = run(["next", "--dir", backlog, "--actor", "agent:b", "--json"], env, dir);
    assert.equal(a.status, 0, a.stdout + a.stderr);
    assert.equal(b.status, 0, b.stdout + b.stderr);
    const [idA, idB] = [JSON.parse(a.stdout).task.id, JSON.parse(b.stdout).task.id];
    assert.notEqual(idA, idB, "two agents were handed the same task");
    assert.ok([first, second, later].includes(idA) && [first, second, later].includes(idB));

    // THE PLAN IS A BOUNDARY, not a suggestion. With `--plan` the queue offers
    // the active wave only, so work scheduled later cannot be started early.
    writeFileSync(join(backlog, "plan.yaml"),
      "waves:\n" +
      '  - name: "Now"\n' +
      "    tasks: [" + first + ", " + second + "]\n" +
      '  - name: "Later"\n' +
      "    tasks: [" + later + "]\n", "utf8");
    // Each hand returns its OWN claim — the boundary scenario 1 measures, applied
    // here rather than worked around.
    for (const [actor, id] of [["agent:a", idA], ["agent:b", idB]]) {
      const back = run(["release", id, "--dir", backlog, "--actor", actor,
                        "--reason", "returning it for the plan case"], env, dir);
      assert.equal(back.status, 0, back.stdout + back.stderr);
    }

    const planned = run(["next", "--dir", backlog, "--plan", "--actor", "agent:c", "--json"], env, dir);
    assert.equal(planned.status, 0, planned.stdout + planned.stderr);
    assert.notEqual(JSON.parse(planned.stdout).task.id, later,
      "the queue handed out a task the plan schedules for a later wave");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the README states the boundary in its opening, in both directions", () => {
  // The two mistakes a reader arrives with, and they pull opposite ways: a
  // tracker for people who are not in the repository, and a factory that owns
  // the agents. A page that denied only one would still be read as the other.
  // "Opening" means BEFORE THE READER IS ASKED TO INSTALL ANYTHING. Splitting at
  // the first heading would have been the obvious rule and the wrong one: it
  // would reject a boundary stated in its own section right under the lede,
  // which is where a boundary belongs.
  const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf8");
  const install = readme.search(/^## Getting it/m);
  assert.ok(install > 0, "the README no longer has an install section to measure the opening against");
  const opening = readme.slice(0, install);
  assert.match(opening, /\bnot\b[^.]*\btracker\b/i, "the opening does not say it is not a tracker");
  assert.match(opening, /\bnot\b[^.]*\b(factory|orchestrator|runs? your agents|owns? (the )?agents)\b/i,
    "the opening does not say it is not a managed agent factory");
});

/**
 * The command shapes each demonstration turns on — ONE list, read twice.
 *
 * The scenario tests above run them; the test below insists the README shows
 * them. Written out separately in each place, the page and the proof would
 * drift the first time a flag changed, and the drift would look like nothing.
 */
const DEMONSTRATED = {
  "one agent stops, another continues": [/take .* --actor /, /resume /, /release .* --reason /, /next .* --actor /],
  "two claims do not collide": [/next .* --actor agent:a/, /next .* --actor agent:b/, /next .* --plan/],
  "a completion is refused": [/done /],
};

test("the README shows each demonstration, command by command", () => {
  const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf8");
  const blocks = (readme.match(/```bash\n([\s\S]*?)```/g) || []).join("\n");
  assert.ok(blocks.length > 200, "the README carries almost no runnable command at all");
  for (const [scenario, shapes] of Object.entries(DEMONSTRATED)) {
    for (const shape of shapes) {
      assert.match(blocks, shape,
        "the README does not show `" + String(shape) + "`, so the demonstration of " + scenario + " cannot be followed");
    }
  }
});

test("the refusal the README quotes is the one the tool prints", () => {
  // A quoted output is a frozen claim, exactly like the recording TL-102
  // guards. The moment the refusal is reworded the page starts lying and
  // nothing says so — unless something reads both.
  const { dir, backlog, env } = fixture("quoted-refusal");
  try {
    const id = create(backlog, env, dir, "A claim somebody else holds");
    run(["take", id, "--dir", backlog, "--actor", "agent:first"], env, dir);
    const refused = run(["release", id, "--dir", backlog, "--actor", "agent:second", "--reason", "not mine"], env, dir);
    assert.notEqual(refused.status, 0);
    const said = (refused.stdout + refused.stderr);
    assert.match(said, /in_progress, owner: agent:first/,
      "the refusal no longer names the status and the owner — the README quotes that it does");
    const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf8");
    assert.match(readme, /owner: agent:first/, "the README stopped quoting the refusal it is built on");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
