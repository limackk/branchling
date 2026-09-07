/** Named profiles route roles without making provider choices repository data (TL-291). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HOME_ENV } from "../home.mjs";
import { activityEntry } from "../activity.mjs";
import { listExecutionRecords } from "../execution-records.mjs";
import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("run-agent-profiles");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
function cli(args, env, cwd) {
  return spawnSync(process.execPath, [CLI].concat(args), { cwd, encoding: "utf8", timeout: 120_000, env });
}
function taskFile(backlog, id) {
  return join(backlog, "tasks", readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-")));
}
function status(backlog, id) {
  return (readFileSync(taskFile(backlog, id), "utf8").match(/^status: (\w+)/m) || [])[1];
}

function profileAttributionFixture() {
  const root = mkdtempSync(join(tmpdir(), "branchling-profile-attribution-"));
  const repo = join(root, "repo");
  const backlog = join(repo, "backlog");
  const env = { ...process.env, NO_COLOR: "1", [HOME_ENV]: join(root, "home"), BACKLOG_STATE_DIR: join(root, "state") };
  mkdirSync(repo, { recursive: true });
  assert.equal(cli(["init", "--dir", backlog, "--no-example"], env, repo).status, 0);
  const created = cli(["new", "--dir", backlog, "--title", "Profile attribution"], env, repo);
  assert.equal(created.status, 0, created.stderr);
  const id = created.stdout.match(/[A-Z]+-\d+/)[0];
  const file = taskFile(backlog, id);
  writeFileSync(file, readFileSync(file, "utf8")
    .replace(/verification:[\s\S]*?\n---/, 'verification:\n  - id: it-runs\n    bash: "true"\n---')
    .replace(/\[proof:[^\]]*\]/g, "[proof: it-runs]"), "utf8");
  const adapter = join(root, "codex-adapter.sh");
  writeFileSync(adapter, "#!/bin/sh\ncat >/dev/null\nprintf 'worked\\n'\n", "utf8");
  chmodSync(adapter, 0o755);
  const profile = cli(["profile", "create", "codex-dev-terra", "--adapter", adapter,
    "--model", "gpt-5.6-terra", "--prompt", "Implement from evidence."], env, repo);
  assert.equal(profile.status, 0, profile.stderr);
  assert.equal(cli(["build", "--dir", backlog], env, repo).status, 0);
  return { root, repo, backlog, env, id };
}

test("a profile run defaults attribution to its selected profile, while an explicit actor wins", () => {
  const first = profileAttributionFixture();
  try {
    const result = cli(["run", "--dir", first.backlog, "--profile", "codex-dev-terra", "--max-attempts", "1", "--json"], first.env, first.repo);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(status(first.backlog, first.id), "done");
    const records = listExecutionRecords(first.backlog, first.env);
    assert.deepEqual(records.filter((record) => record.kind === "run").map((record) => record.actor), ["agent:codex-dev-terra"]);
    assert.deepEqual(records.filter((record) => record.kind === "attempt").map((record) => record.actor), ["agent:codex-dev-terra"]);
    assert.match(readFileSync(join(first.backlog, "history", first.id + ".jsonl"), "utf8"), /"actor":"agent:codex-dev-terra"/);
  } finally { rmSync(first.root, { recursive: true, force: true }); }

  const second = profileAttributionFixture();
  try {
    const result = cli(["run", "--dir", second.backlog, "--profile", "codex-dev-terra", "--actor", "agent:operator", "--max-attempts", "1", "--json"], second.env, second.repo);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const records = listExecutionRecords(second.backlog, second.env);
    assert.deepEqual(records.filter((record) => record.kind === "run").map((record) => record.actor), ["agent:operator"]);
    assert.deepEqual(records.filter((record) => record.kind === "attempt").map((record) => record.actor), ["agent:operator"]);
  } finally { rmSync(second.root, { recursive: true, force: true }); }
});

test("profile-for routes each role through its named local profile and labelled context", () => {
  const root = mkdtempSync(join(tmpdir(), "branchling-profile-routing-"));
  const repo = join(root, "repo");
  const backlog = join(repo, "backlog");
  const env = { ...process.env, NO_COLOR: "1", [HOME_ENV]: join(root, "home"), BACKLOG_STATE_DIR: join(root, "state"), BACKLOG_SESSION: "profile-run" };
  try {
    assert.equal(cli(["init", "--dir", backlog, "--no-example"], env, root).status, 0);
    const config = join(backlog, "config.yaml");
    writeFileSync(config, readFileSync(config, "utf8") + "\nroles: [dev, review]\n", "utf8");
    const roles = join(backlog, "roles");
    mkdirSync(roles, { recursive: true });
    writeFileSync(join(roles, "dev.md"), "Implement only the requested behaviour.\n", "utf8");
    writeFileSync(join(roles, "review.md"), "Challenge every unsupported claim.\n", "utf8");

    const add = (title, role) => {
      const created = cli(["new", "--dir", backlog, "--title", title], env, repo);
      assert.equal(created.status, 0, created.stderr);
      const id = created.stdout.match(/[A-Z]+-\d+/)[0];
      const file = taskFile(backlog, id);
      writeFileSync(file, readFileSync(file, "utf8")
        .replace(/^role: .*$/m, "role: " + role)
        .replace(/verification:[\s\S]*?\n---/, 'verification:\n  - id: it-runs\n    bash: "true"\n---')
        .replace(/\[proof:[^\]]*\]/g, "[proof: it-runs]"), "utf8");
      return id;
    };
    const dev = add("Development stage", "dev");
    const review = add("Review stage", "review");
    assert.equal(cli(["build", "--dir", backlog], env, repo).status, 0);

    const adapter = (name, witness) => {
      const path = join(root, name);
      writeFileSync(path, [
        "#!/bin/sh",
        "cat > " + JSON.stringify(witness),
        "printf '%s|%s|%s|%s\\n' \"$BRANCHLING_PROFILE\" \"$BRANCHLING_MODEL\" \"$BRANCHLING_EFFORT\" \"$BRANCHLING_ROLE\" >> " + JSON.stringify(witness),
      ].join("\n") + "\n", "utf8");
      chmodSync(path, 0o755);
      return path;
    };
    const devInput = join(root, "dev-input.md");
    const reviewInput = join(root, "review-input.md");
    const made = cli(["profile", "create", "developer", "--adapter", adapter("developer-adapter", devInput),
      "--model", "model-dev", "--effort", "high", "--prompt", "Write maintainable changes."], env, repo);
    assert.equal(made.status, 0, made.stderr);
    const reviewed = cli(["profile", "create", "reviewer", "--adapter", adapter("reviewer-adapter", reviewInput),
      "--model", "model-review", "--effort", "careful", "--prompt", "Review from evidence."], env, repo);
    assert.equal(reviewed.status, 0, reviewed.stderr);

    const result = cli(["run", "--dir", backlog, "--actor", "agent:fleet", "--max-attempts", "1", "--json",
      "--profile-for", "dev=developer", "--profile-for", "review=reviewer"], env, repo);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(status(backlog, dev), "done");
    assert.equal(status(backlog, review), "done");
    assert.match(readFileSync(devInput, "utf8"), /## Role brief \(repository\)[\s\S]*Implement only/);
    assert.match(readFileSync(devInput, "utf8"), /## Profile prompt \(local\)[\s\S]*Write maintainable/);
    assert.match(readFileSync(devInput, "utf8"), /## Task/);
    assert.match(readFileSync(devInput, "utf8"), /developer\|model-dev\|high\|dev/);
    assert.match(readFileSync(reviewInput, "utf8"), /reviewer\|model-review\|careful\|review/);

    const receipts = report.tasks.flatMap((task) => task.provenance);
    assert.equal(receipts.length, 2);
    assert.deepEqual(receipts.map((receipt) => [receipt.profile, receipt.requested.model, receipt.requested.effort]).sort(), [
      ["developer", "model-dev", "high"],
      ["reviewer", "model-review", "careful"],
    ]);
    for (const receipt of receipts) {
      assert.equal(receipt.version, 1);
      assert.match(receipt.adapter.fingerprint, /^sha256:/);
      assert.equal(receipt.confirmed.model, null);
      assert.equal(receipt.confirmed.effort, null);
    }

    const session = cli(["session", "profile-run", "--dir", backlog, "--json"], env, repo);
    assert.equal(session.status, 0, session.stderr);
    const localTrace = JSON.parse(session.stdout).session.executions;
    assert.equal(localTrace.length, 2);
    const traceText = JSON.stringify(localTrace);
    assert.doesNotMatch(traceText, /Write maintainable changes|Review from evidence|test-only-secret/);
    assert.doesNotMatch(readFileSync(taskFile(backlog, dev), "utf8"), /model-dev|developer/,
      "local profile choice must not become task frontmatter");
    const rendered = cli(["session", "profile-run", "--dir", backlog], env, repo);
    assert.equal(rendered.status, 0, rendered.stderr);
    assert.match(rendered.stdout, /agent executions/);
    assert.match(rendered.stdout, /not confirmed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("execution receipts reject a claimed provider confirmation", () => {
  assert.throws(() => activityEntry({
    task: "TL-1", kind: "execution", actor: "agent:fleet", session: "s-1", attribution: "declared",
    provenance: {
      version: 1, provider: "untrusted-adapter", profile: "developer", adapter: { fingerprint: null },
      task: "TL-1", role: "dev", attempt: 1,
      requested: { model: "model-dev", effort: "medium" },
      confirmed: { model: "model-dev", effort: null },
    },
  }), /cannot claim provider confirmation/);
});

test("bad profile routing fails before it can claim a task", () => {
  const root = mkdtempSync(join(tmpdir(), "branchling-profile-refusal-"));
  const backlog = join(root, "backlog");
  const env = { ...process.env, NO_COLOR: "1", [HOME_ENV]: join(root, "home"), BACKLOG_STATE_DIR: join(root, "state") };
  try {
    assert.equal(cli(["init", "--dir", backlog, "--no-example"], env, root).status, 0);
    const config = join(backlog, "config.yaml");
    writeFileSync(config, readFileSync(config, "utf8") + "\nroles: [dev]\n", "utf8");
    const created = cli(["new", "--dir", backlog, "--title", "Pending work"], env, root);
    const id = created.stdout.match(/[A-Z]+-\d+/)[0];
    const file = taskFile(backlog, id);
    writeFileSync(file, readFileSync(file, "utf8").replace(/^role: .*$/m, "role: dev"), "utf8");
    assert.equal(cli(["build", "--dir", backlog], env, root).status, 0);

    const missing = cli(["run", "--dir", backlog, "--actor", "agent:fleet", "--profile-for", "dev=missing"], env, root);
    assert.equal(missing.status, 1, missing.stdout + missing.stderr);
    assert.match(missing.stderr, /cannot use profile `missing`/);
    assert.equal(status(backlog, id), "pending");

    const unknown = cli(["run", "--dir", backlog, "--actor", "agent:fleet", "--profile-for", "review=missing"], env, root);
    assert.equal(unknown.status, 2, unknown.stdout + unknown.stderr);
    assert.match(unknown.stderr, /does not declare: review/);
    assert.equal(status(backlog, id), "pending");

    const ambiguous = cli(["run", "--dir", backlog, "--actor", "agent:fleet",
      "--agent-for", "dev=false", "--profile-for", "dev=missing"], env, root);
    assert.equal(ambiguous.status, 2, ambiguous.stdout + ambiguous.stderr);
    assert.match(ambiguous.stderr, /two hands named for role `dev`/);
    assert.equal(status(backlog, id), "pending");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function delegationFixture(control) {
  const root = mkdtempSync(join(tmpdir(), "branchling-delegation-"));
  const repo = join(root, "repo");
  const backlog = join(repo, "backlog");
  const env = { ...process.env, NO_COLOR: "1", [HOME_ENV]: join(root, "home"), BACKLOG_STATE_DIR: join(root, "state") };
  mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", "."], { cwd: repo });
  assert.equal(cli(["init", "--dir", backlog, "--no-example"], env, repo).status, 0);
  const config = join(backlog, "config.yaml");
  writeFileSync(config, readFileSync(config, "utf8") + "\nroles: [dev]\n", "utf8");
  const created = cli(["new", "--dir", backlog, "--title", "Delegated work"], env, repo);
  assert.equal(created.status, 0, created.stderr);
  const id = created.stdout.match(/[A-Z]+-\d+/)[0];
  const file = taskFile(backlog, id);
  writeFileSync(file, readFileSync(file, "utf8")
    .replace(/^role: .*$/m, "role: dev")
    .replace(/verification:[\s\S]*?\n---/, 'verification:\n  - id: it-runs\n    bash: "true"\n---')
    .replace(/\[proof:[^\]]*\]/g, "[proof: it-runs]"), "utf8");
  const adapter = join(root, "adapter.sh");
  writeFileSync(adapter, "#!/bin/sh\ncat >/dev/null\nprintf '%s|%s\\n' \"$BRANCHLING_DELEGATION\" \"$BRANCHLING_DELEGATION_ENFORCEMENT\"\n", "utf8");
  chmodSync(adapter, 0o755);
  const args = ["profile", "create", "developer", "--adapter", adapter, "--prompt", "Work."];
  if (control) args.push("--delegation-control", control);
  const profile = cli(args, env, repo);
  assert.equal(profile.status, 0, profile.stderr);
  assert.equal(cli(["build", "--dir", backlog], env, repo).status, 0);
  return { root, repo, backlog, env, id };
}

test("an unmanaged profile fleet is refused before a Branchling claim", () => {
  const fx = delegationFixture(null);
  try {
    const result = cli(["run", "--dir", fx.backlog, "--actor", "agent:fleet", "--max-attempts", "1",
      "--delegation", "branchling", "--profile-for", "dev=developer"], fx.env, fx.repo);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /needs a controlled profile adapter/);
    assert.match(result.stderr, /unsupported: developer/);
    assert.equal(status(fx.backlog, fx.id), "pending");
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

test("a controlled fleet records its Branchling delegation policy", () => {
  const fx = delegationFixture("enforced");
  try {
    const result = cli(["run", "--dir", fx.backlog, "--actor", "agent:fleet", "--max-attempts", "1", "--json",
      "--delegation", "branchling", "--profile-for", "dev=developer"], fx.env, fx.repo);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(status(fx.backlog, fx.id), "done");
    const receipt = JSON.parse(result.stdout).tasks[0].provenance[0];
    assert.deepEqual(receipt.delegation, { requested: "branchling", enforcement: "enforced" });
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

function stderrEvidenceFixture(name, adapterBody) {
  const root = mkdtempSync(join(tmpdir(), "branchling-profile-evidence-"));
  const repo = join(root, "repo");
  const backlog = join(repo, "backlog");
  const env = { ...process.env, NO_COLOR: "1", [HOME_ENV]: join(root, "home"), BACKLOG_STATE_DIR: join(root, "state") };
  mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", "."], { cwd: repo });
  assert.equal(cli(["init", "--dir", backlog, "--no-example"], env, repo).status, 0);
  const created = cli(["new", "--dir", backlog, "--title", name], env, repo);
  assert.equal(created.status, 0, created.stderr);
  const id = created.stdout.match(/[A-Z]+-\d+/)[0];
  const file = taskFile(backlog, id);
  writeFileSync(file, readFileSync(file, "utf8")
    .replace(/verification:[\s\S]*?\n---/, 'verification:\n  - id: deliberate-red\n    bash: "false"\n---')
    .replace(/\[proof:[^\]]*\]/g, "[proof: deliberate-red]"), "utf8");
  const adapter = join(root, "adapter.sh");
  writeFileSync(adapter, "#!/bin/sh\ncat >/dev/null\n" + adapterBody + "\n", "utf8");
  chmodSync(adapter, 0o755);
  const profile = cli(["profile", "create", "evidence", "--adapter", adapter, "--prompt", "Work."], env, repo);
  assert.equal(profile.status, 0, profile.stderr);
  return { root, repo, backlog, env, id };
}

test("a profile adapter's stderr transcript proves its attempt ran", () => {
  const fx = stderrEvidenceFixture("stderr evidence", "printf 'adapter transcript\\n' >&2");
  try {
    const result = cli(["run", "--dir", fx.backlog, "--actor", "agent:profile", "--profile", "evidence", "--max-attempts", "1", "--json"], fx.env, fx.repo);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(status(fx.backlog, fx.id), "blocked", "stderr-only profile work was released as never started");
    assert.equal(JSON.parse(result.stdout).tasks[0].outcome, "exhausted");
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

test("a silent unchanged profile adapter is still released as never started", () => {
  const fx = stderrEvidenceFixture("silent profile", "true");
  try {
    const result = cli(["run", "--dir", fx.backlog, "--actor", "agent:profile", "--profile", "evidence", "--max-attempts", "1", "--json"], fx.env, fx.repo);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(status(fx.backlog, fx.id), "pending");
    assert.equal(JSON.parse(result.stdout).tasks[0].outcome, "agent-never-ran");
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});
