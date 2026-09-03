/**
 * The viewer can be pointed at another WORKTREE, and cannot write to it (TL-188).
 *
 * WHY THIS FILE BUILDS REAL WORKTREES. The defect is a page showing a still
 * image while work happens in another tree, and every part of the mechanism is
 * about trees that really disagree: git's own `worktree list` supplies the
 * allowlist, each tree carries its OWN backlog/ (law 1), and the guarantee under
 * test is that reading one of them never turns into writing it. A fixture that
 * faked the git layer would be asserting that our mock agrees with itself.
 *
 * THE CONTROLS ARE THE POINT. "Selecting the second tree shows different
 * statuses" proves nothing on its own — an implementation that ignored the
 * parameter entirely and always answered from the server's tree would pass it if
 * the two trees happened to agree. So every claim here is paired: the same
 * request without `?worktree=` MUST come back with the other answer, and the
 * write that names the foreign tree MUST leave its file byte-identical.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_TASK_ID_PREFIX as P } from "../task-id.mjs";
import { describeWorktrees, resolveWorktree } from "../viewer-worktrees.mjs";
import { readWorktreeParam, withWorktree } from "../viewer-url.mjs";
import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it.
isolateHome("viewer-worktree-switcher");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const SERVER = join(SCRIPTS_DIR, "serve-backlog.mjs");
const LISTENING = /serve: http:\/\/127\.0\.0\.1:(\d+)\//;

const ID = P + "-1";
const TASK_FILE = ID + "-a-task-two-trees-disagree-about.md";

// ──────────────────────────────────────────────────────────────────────────
// The pure half: keys, labels, and the allowlist
// ──────────────────────────────────────────────────────────────────────────

test("the switcher offers only trees that carry this backlog", () => {
  const entries = describeWorktrees(
    [
      { path: "/repo", branch: "refs/heads/main" },
      { path: "/repo/.worktrees/fleet", branch: "refs/heads/claude/fleet" },
      { path: "/repo/.worktrees/unrelated", branch: "refs/heads/other" },
    ],
    {
      selfPath: "/repo",
      backlogRel: "backlog",
      // A worktree made for something else is a normal thing to have; offering
      // it would promise a view that must then fail.
      hasBacklog: (dir) => dir !== "/repo/.worktrees/unrelated/backlog",
    }
  );
  assert.deepEqual(entries.map((e) => e.key), ["repo", "fleet"]);
  assert.equal(entries[0].isSelf, true, "the server's own tree comes first — it is the only writable one");
  assert.equal(entries[1].isSelf, false);
  assert.equal(entries[0].backlogDir, join("/repo", "backlog"));
});

test("the branch is dropped from the label only when the directory already says it", () => {
  const entries = describeWorktrees(
    [
      { path: "/repo", branch: "refs/heads/main" },
      { path: "/w/fleet", branch: "refs/heads/claude/fleet" },
      { path: "/w/detached", branch: null },
    ],
    { selfPath: "/repo", backlogRel: "", hasBacklog: () => true }
  );
  const label = (k) => entries.find((e) => e.key === k).label;
  assert.equal(label("repo"), "repo — main", "a branch the name does not carry has to show");
  assert.equal(label("fleet"), "fleet", "`claude/fleet` in a directory called fleet is said twice");
  assert.equal(label("detached"), "detached", "a detached HEAD has no branch to name");
});

test("two trees with the same directory name still get distinct, stable keys", () => {
  const trees = [
    { path: "/a/backlog-work", branch: "refs/heads/one" },
    { path: "/b/backlog-work", branch: "refs/heads/two" },
  ];
  const opts = { selfPath: "/a/backlog-work", backlogRel: "", hasBacklog: () => true };
  const keys = describeWorktrees(trees, opts).map((e) => e.key);
  assert.equal(new Set(keys).size, 2, "one key for two trees would send a link to whichever sorted first");
  // Stable: the same paths produce the same keys, so a link keeps working.
  assert.deepEqual(describeWorktrees(trees, opts).map((e) => e.key), keys);
});

test("resolveWorktree is an allowlist: an unknown key is null, never the server's tree", () => {
  const entries = describeWorktrees(
    [{ path: "/repo", branch: "refs/heads/main" }, { path: "/w/fleet", branch: "refs/heads/fleet" }],
    { selfPath: "/repo", backlogRel: "", hasBacklog: () => true }
  );
  assert.equal(resolveWorktree(entries, "fleet").path, "/w/fleet");
  assert.equal(resolveWorktree(entries, "").path, "/repo", "no key means the server's own tree");
  assert.equal(resolveWorktree(entries, null).path, "/repo");
  // The traversal shapes and the plain typo both have to end in the same place:
  // nothing. A fallback to the server's tree would answer about the wrong
  // backlog and look exactly like a correct answer.
  for (const bad of ["nope", "../../etc", "/etc/passwd", "fleet/../repo", "FLEET"]) {
    assert.equal(resolveWorktree(entries, bad), null, "`" + bad + "` resolved to something");
  }
});

// ──────────────────────────────────────────────────────────────────────────
// The link: switching trees must not cost the view
// ──────────────────────────────────────────────────────────────────────────
//
// These run against `viewer-url.mjs`, which the page carries as PASTED SOURCE —
// so this is the same code the browser executes, not a second copy of it.

test("switching worktree keeps the view: the hash and the other parameters survive", () => {
  const loc = {
    pathname: "/",
    search: "?worktree=fleet&debug=1",
    hash: "#tasks?board=main&status=blocked&id=" + ID,
  };
  const href = withWorktree(loc, "other", "repo");
  assert.match(href, /#tasks\?board=main&status=blocked&id=/, "the filters and the open task were dropped");
  assert.match(href, /debug=1/, "a parameter this module knows nothing about was eaten");
  assert.equal(readWorktreeParam(href.split("#")[0].split("?")[1] || ""), "other");
});

test("the served tree is spelled by ABSENCE, so one view has one link", () => {
  const loc = { pathname: "/", search: "?worktree=fleet", hash: "#tasks?board=main" };
  assert.equal(withWorktree(loc, "repo", "repo"), "/#tasks?board=main",
    "naming the default tree makes a second link for a view that already had one");
  assert.equal(withWorktree(loc, null, "repo"), "/#tasks?board=main");
  assert.equal(readWorktreeParam(""), null, "no parameter must mean the served tree, not the empty string");
});

// ──────────────────────────────────────────────────────────────────────────
// The served half: a real repository with two trees that disagree
// ──────────────────────────────────────────────────────────────────────────

function vcs(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function taskText(status) {
  return [
    "---",
    "id: " + ID,
    'title: "A task two trees disagree about"',
    "type: task",
    "labels: []",
    "board: main",
    "priority: P1",
    "status: " + status,
    "owner: unassigned",
    "estimate: 2h",
    "created: 2026-01-01",
    "updated: 2026-01-01",
    "blocked_by: []",
    "---",
    "",
    "## Goal",
    "",
    "Something to be done.",
    "",
  ].join("\n");
}

/**
 * A repository whose task is `pending` in the main checkout and `in_progress`
 * in a linked worktree — the situation the switcher exists for: a run driving
 * the task somewhere the served page could not see.
 */
function twoTrees() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "branchling-wt-switch-")));
  const repoRoot = join(base, "repo");
  const backlogDir = join(repoRoot, "backlog");
  const init = spawnSync(process.execPath, [CLI, "init", "--dir", backlogDir, "--no-example"], {
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(init.status, 0, "init did not pass: " + init.stderr);

  vcs(repoRoot, ["init", "-q", "-b", "main"]);
  writeFileSync(join(backlogDir, "tasks", TASK_FILE), taskText("pending"), "utf8");
  vcs(repoRoot, ["add", "-A"]);
  vcs(repoRoot, ["commit", "-qm", "seed"]);

  const fleet = join(base, "fleet");
  vcs(repoRoot, ["worktree", "add", "-q", "-b", "fleet", fleet]);
  const fleetTask = join(fleet, "backlog", "tasks", TASK_FILE);
  writeFileSync(fleetTask, taskText("in_progress"), "utf8");

  return { base, repoRoot, backlogDir, fleet, fleetTask };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function startServer(dir, port) {
  const proc = spawn(process.execPath, [SERVER, "--dir", dir, "--port", String(port), "--no-open"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  proc.stdout.setEncoding("utf8");
  proc.stderr.setEncoding("utf8");
  proc.stdout.on("data", (c) => { out += c; });
  proc.stderr.on("data", (c) => { err += c; });
  const bound = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("the server did not report a port in 20s\n" + out + "\n" + err)),
      20_000
    );
    const check = () => {
      const m = out.match(LISTENING);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    };
    proc.stdout.on("data", check);
    proc.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error("the server exited (" + code + ") instead of listening\n" + out + "\n" + err));
    });
    check();
  });
  return { proc, bound, stdout: () => out, stderr: () => err };
}

function stop(handle) {
  if (!handle || handle.proc.exitCode !== null || handle.proc.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    handle.proc.on("exit", () => resolve());
    handle.proc.kill("SIGKILL");
  });
}

function http(port, path, opts = {}) {
  return new Promise((resolve) => {
    const body = opts.body === undefined ? null : JSON.stringify(opts.body);
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: opts.method || "GET",
        timeout: 10_000,
        headers: body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {},
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { text += c; });
        res.on("end", () => {
          let json = null;
          try { json = JSON.parse(text); } catch { /* html */ }
          resolve({ status: res.statusCode, text, json });
        });
      }
    );
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, text: "", json: null }); });
    req.on("error", () => resolve({ status: 0, text: "", json: null }));
    if (body) req.write(body);
    req.end();
  });
}

/** The key the fixture's linked worktree is offered under. */
async function fleetKey(port) {
  const r = await http(port, "/api/worktrees");
  assert.equal(r.status, 200, "the switcher has no list to draw from");
  const foreign = (r.json.worktrees || []).find((w) => !w.isSelf);
  assert.ok(foreign, "the linked worktree is not offered: " + r.text);
  return foreign.key;
}

test("the served page can be pointed at another worktree, and shows THAT tree's status", async () => {
  const fx = twoTrees();
  const port = await freePort();
  const server = startServer(fx.backlogDir, port);
  try {
    const bound = await server.bound;
    const key = await fleetKey(bound);

    const foreign = await http(bound, "/api/tasks?worktree=" + encodeURIComponent(key));
    assert.equal(foreign.status, 200, foreign.text);
    const there = foreign.json.tasks.find((t) => t.id === ID);
    assert.equal(there.status, "in_progress", "the foreign tree's status did not reach the page");
    assert.equal(foreign.json.worktree.writable, false, "a foreign tree must announce itself read-only");

    // THE CONTROL. Without the parameter the same request has to give the OTHER
    // answer — otherwise "it showed in_progress" is just what this server always
    // says, and the switch is proving nothing.
    const home = await http(bound, "/api/tasks");
    assert.equal(home.status, 200, home.text);
    assert.equal(home.json.tasks.find((t) => t.id === ID).status, "pending",
      "the server's own tree answered with the other tree's status");
    assert.equal(home.json.worktree.writable, true);
  } finally {
    await stop(server);
    rmSync(fx.base, { recursive: true, force: true });
  }
});

test("the page carries the switcher, and says which tree it is showing", async () => {
  const fx = twoTrees();
  const port = await freePort();
  const server = startServer(fx.backlogDir, port);
  try {
    const bound = await server.bound;
    const key = await fleetKey(bound);

    const own = await http(bound, "/");
    assert.match(own.text, /id="worktreePicker"/, "the control is not on the page");
    assert.match(own.text, /const SUBJECT_WRITABLE = true/, "the server's own tree came out read-only");

    const foreign = await http(bound, "/?worktree=" + encodeURIComponent(key));
    assert.equal(foreign.status, 200);
    assert.match(foreign.text, /const SUBJECT_WRITABLE = false/,
      "a foreign tree was rendered as writable — the pens would offer an edit that must fail");
    assert.match(foreign.text, new RegExp('const WORKTREE = "' + key + '"'),
      "the page does not know which tree it is showing");
  } finally {
    await stop(server);
    rmSync(fx.base, { recursive: true, force: true });
  }
});

test("a key no worktree answers to is refused, not quietly served from this tree", async () => {
  const fx = twoTrees();
  const port = await freePort();
  const server = startServer(fx.backlogDir, port);
  try {
    const bound = await server.bound;
    for (const bad of ["nope", "../../../etc", "/etc"]) {
      const r = await http(bound, "/api/tasks?worktree=" + encodeURIComponent(bad));
      assert.equal(r.status, 404, "`" + bad + "` was served instead of refused: " + r.text);
      assert.ok(Array.isArray(r.json.worktrees), "the refusal must say what there IS to pick");
    }
  } finally {
    await stop(server);
    rmSync(fx.base, { recursive: true, force: true });
  }
});

test("no write reaches another worktree — the request is refused and its file is untouched", async () => {
  const fx = twoTrees();
  const port = await freePort();
  const server = startServer(fx.backlogDir, port);
  try {
    const bound = await server.bound;
    const key = await fleetKey(bound);
    const before = readFileSync(fx.fleetTask, "utf8");
    const ownBefore = readFileSync(join(fx.backlogDir, "tasks", TASK_FILE), "utf8");

    for (const path of ["/api/field", "/api/status"]) {
      const r = await http(bound, path + "?worktree=" + encodeURIComponent(key), {
        method: "POST",
        body: { id: ID, field: "status", value: "done", status: "done", actor: "founder" },
      });
      assert.equal(r.status, 403, path + " accepted a write aimed at another worktree: " + r.text);
      assert.equal(r.json.kind, "foreign-worktree");
    }
    // The same refusal when the tree is named in the BODY rather than the query —
    // one of the two spellings left open is a write that silently lands here.
    const inBody = await http(bound, "/api/field", {
      method: "POST",
      body: { id: ID, field: "status", value: "done", actor: "founder", worktree: key },
    });
    assert.equal(inBody.status, 403, "a worktree named in the payload was ignored: " + inBody.text);

    assert.equal(readFileSync(fx.fleetTask, "utf8"), before,
      "the other worktree's task file changed");
    assert.equal(readFileSync(join(fx.backlogDir, "tasks", TASK_FILE), "utf8"), ownBefore,
      "the refused write landed in the SERVER's tree instead — the worst of the outcomes");

    // POSITIVE CONTROL: the same write with no worktree named DOES land, so the
    // assertions above measure the refusal and not a write path that is broken
    // for everyone.
    const ok = await http(bound, "/api/field", {
      method: "POST",
      body: { id: ID, field: "status", value: "done", actor: "founder" },
    });
    assert.equal(ok.status, 200, "the server's own tree cannot be written either: " + ok.text);
    assert.match(readFileSync(join(fx.backlogDir, "tasks", TASK_FILE), "utf8"), /^status: done/m);
    assert.equal(readFileSync(fx.fleetTask, "utf8"), before,
      "a write to this tree reached the other one");
  } finally {
    await stop(server);
    rmSync(fx.base, { recursive: true, force: true });
  }
});

test("history is read from the tree being shown, not from the server's", async () => {
  const fx = twoTrees();
  const port = await freePort();
  const server = startServer(fx.backlogDir, port);
  try {
    const bound = await server.bound;
    const key = await fleetKey(bound);
    // A change recorded HERE must not appear in the other tree's history.
    const wrote = await http(bound, "/api/field", {
      method: "POST",
      body: { id: ID, field: "priority", value: "P3", actor: "founder" },
    });
    assert.equal(wrote.status, 200, wrote.text);

    const own = await http(bound, "/api/history?id=" + ID);
    assert.equal(own.status, 200, own.text);
    assert.ok(own.json.entries.some((e) => e.field === "priority"),
      "the write this server made is missing from its own history");

    const foreign = await http(bound, "/api/history?worktree=" + encodeURIComponent(key) + "&id=" + ID);
    assert.equal(foreign.status, 200, foreign.text);
    assert.ok(!foreign.json.entries.some((e) => e.field === "priority"),
      "the other tree's history carries a change made in this one");
  } finally {
    await stop(server);
    rmSync(fx.base, { recursive: true, force: true });
  }
});
