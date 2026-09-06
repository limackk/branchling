/** Local profile preflight and its explicit live probe (TL-294). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { HOME_ENV } from "../home.mjs";
import { PROFILE_PROBE_ENV } from "../agent-contract.mjs";
import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

isolateHome("agent-check");
const CLI = join(SCRIPTS_DIR, "cli.mjs");
const run = (args, env, cwd) => spawnSync(process.execPath, [CLI].concat(args), { cwd, encoding: "utf8", timeout: 120_000, env });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "branchling-agent-check-"));
  const home = join(root, "home");
  const env = { ...process.env, NO_COLOR: "1", [HOME_ENV]: home, BACKLOG_STATE_DIR: join(root, "state") };
  return { root, home, env };
}
function adapter(root, body) {
  const path = join(root, "adapter");
  writeFileSync(path, "#!/bin/sh\n" + body + "\n", "utf8");
  chmodSync(path, 0o755);
  return path;
}

test("default profile check is local, finds unavailable adapters and never starts them", () => {
  const { root, env } = fixture();
  try {
    const marker = join(root, "started");
    const path = adapter(root, "touch " + JSON.stringify(marker));
    assert.equal(run(["profile", "create", "local", "--adapter", path, "--prompt", "work"], env, root).status, 0);
    const ok = run(["profile", "check", "local", "--json"], env, root);
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(JSON.parse(ok.stdout).results[0].state, "ready");
    assert.equal(existsSync(marker), false, "a local check started the adapter");

    assert.equal(run(["profile", "create", "gone", "--adapter", "definitely-not-installed", "--prompt", "work"], env, root).status, 0);
    const unavailable = run(["profile", "check", "gone", "--json"], env, root);
    assert.equal(unavailable.status, 1);
    const report = JSON.parse(unavailable.stdout);
    assert.equal(report.kind, "profile-check");
    assert.equal(report.results[0].state, "adapter-unavailable");

    const incompatible = run(["profile", "create", "old-contract", "--adapter", path, "--prompt", "work", "--protocol-version", "2"], env, root);
    assert.equal(incompatible.status, 1, "an incompatible protocol declaration was accepted");
    assert.match(incompatible.stderr, /protocol_version must be 1/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("missing credentials are named without disclosing values, and run refuses before a claim", () => {
  const { root, env } = fixture();
  try {
    const path = adapter(root, "cat >/dev/null");
    assert.equal(run(["profile", "create", "guarded", "--adapter", path, "--prompt", "work", "--secret-env", "API_TOKEN"], env, root).status, 0);
    const checked = run(["profile", "check", "guarded", "--json"], { ...env, API_TOKEN: "never-print-this" }, root);
    assert.equal(checked.status, 0, checked.stderr);
    assert.equal(checked.stdout.includes("never-print-this"), false);

    const repo = join(root, "repo"); const backlog = join(repo, "backlog");
    assert.equal(run(["init", "--dir", backlog, "--no-example"], env, root).status, 0);
    const created = run(["new", "--dir", backlog, "--title", "No invalid profile claim"], env, repo);
    const id = created.stdout.match(/[A-Z]+-\d+/)[0];
    const refused = run(["run", "--dir", backlog, "--actor", "agent:check", "--profile", "guarded", "--dry-run"], env, repo);
    assert.equal(refused.status, 1, refused.stderr);
    const task = readFileSync(join(backlog, "tasks", readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-"))), "utf8");
    assert.match(task, /^status: pending/m, "a profile setup failure claimed work");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a live probe is opt-in and returns a stable provider outcome", () => {
  const { root, env } = fixture();
  try {
    const path = adapter(root, 'if [ "$' + PROFILE_PROBE_ENV + '" = 1 ]; then printf \'{"version":1,"outcome":"authentication-refused"}\\n\'; exit 0; fi; exit 1');
    assert.equal(run(["profile", "create", "probe", "--adapter", path, "--prompt", "work"], env, root).status, 0);
    const local = run(["profile", "check", "probe", "--json"], env, root);
    assert.equal(local.status, 0);
    assert.equal(JSON.parse(local.stdout).results[0].live, null);
    const live = run(["profile", "check", "probe", "--live", "--json"], env, root);
    assert.equal(live.status, 1);
    const report = JSON.parse(live.stdout);
    assert.equal(report.live, true);
    assert.equal(report.results[0].live.outcome, "authentication-refused");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
