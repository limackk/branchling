/**
 * Every `exit:` line in `--help` that lists 2 also says that no backlog exits
 * 1, in the words docs/external-consumers.md uses (TL-549).
 *
 * WHAT WAS BROKEN. TL-546 made both resolution refusals — no backlog found,
 * and a directory named that is not one — exit 1 from every command. The help
 * texts went on listing only each command's own outcomes (`0 taken · 1 refused
 * · 2 usage error`), so a reader of `--help` could not learn that 1 also means
 * "there is no backlog here", and the contract a consumer reads said something
 * the help never did.
 *
 * THREE PLACES, ONE ANSWER. The clause lives in `BACKLOG_DIR_REFUSAL_HELP`
 * (scripts/paths.mjs), built from the same `BACKLOG_DIR_REFUSAL_EXIT` the
 * commands exit with. This file compares that constant with every help text,
 * with the sentence in docs/external-consumers.md that states the contract,
 * and with a live process, so none of the three can name a different code.
 *
 * EVERY COMMAND HAS ONE (TL-572). The clause above was guarded only where an
 * `exit:` line already existed, and fourteen entries of the command table
 * printed none through the dispatcher, so the guard could ask nothing of them
 * and docs/external-consumers.md promised a line they did not have. Now an
 * entry whose help does not END with an exit line listing 2 fails here —
 * 2 because every command refuses an unknown flag with it — which puts every
 * entry in the scope of the clause test below.
 *
 * THE EXEMPTIONS ARE NAMED AND PROVED. A command that never resolves a backlog
 * never meets the state, and a help line claiming it would be false. Each one
 * is run outside a backlog below; the day one of them starts resolving one, it
 * refuses there and its exemption fails. The same list is the one the
 * contract document prints, and the two are compared.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { COMMANDS, commandHelpText } from "../cli.mjs";
import { USAGE as AUDIT_USAGE } from "../audit.mjs";
import { USAGE as DOCS_DRIFT_USAGE } from "../docs-drift.mjs";
import {
  BACKLOG_DIR_REFUSAL_EXIT,
  BACKLOG_DIR_REFUSAL_HELP,
  BACKLOG_DIR_REFUSAL_PHRASE,
} from "../paths.mjs";

import { isolateHome, REPO_ROOT, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("help-exit-lines");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const DOC = join(REPO_ROOT, "docs", "external-consumers.md");

/** A directory with git and no backlog: where every probe below runs. */
const NOWHERE = fixtureDir(join(tmpdir(), "help-exit-lines-"));
spawnSync("git", ["init", "-q", "."], { cwd: NOWHERE });
writeFileSync(join(NOWHERE, "message.txt"), "TL-1 A message that is accepted\n");

/** The stderr shape of both resolution refusals. */
const REFUSAL = /no backlog here|is not a backlog/;

/**
 * Commands whose `exit:` line lists 2 and deliberately omits the clause, with
 * an invocation valid enough to reach past flag validation outside a backlog
 * and the reason the clause would be false there.
 */
const EXEMPT = {
  where: {
    argv: ["where"],
    why: "it reports a missing backlog rather than refusing on it (TL-547 owns its exit line)",
    reports: true,
  },
  hooks: { argv: ["hooks", "print"], why: "it writes git hooks and never resolves a backlog" },
  "commit-message": {
    argv: ["commit-message", "message.txt"],
    why: "it judges a message file and never resolves a backlog",
  },
  profile: { argv: ["profile", "list"], why: "it reads the user's profiles, not a project's backlog" },
  conformance: {
    argv: ["conformance", "--adapter", "./no-such-adapter"],
    why: "it judges an adapter executable and never resolves a backlog",
  },
  init: {
    argv: ["init", "--dir", "fresh-backlog", "--no-gitignore", "--no-nudge", "--no-example"],
    why: "it creates a backlog in the directory it is given and never resolves one",
  },
  mcp: {
    argv: ["mcp"],
    why: "the server resolves nothing itself; each call that meets no backlog answers inside the stream",
  },
  "regen-hook": {
    argv: ["regen-hook"],
    why: "the backlog comes from the edited file's own path, never from resolution",
  },
};

/** The `exit:` block — the last line naming exit codes and its continuations —
 *  with whitespace collapsed, so wrapping a help line cannot change the verdict. */
function exitBlock(text) {
  const located = locateExitBlock(text);
  return located ? located.block : null;
}

/** The exit block and the non-blank help lines that follow it — none, when the
 *  help ENDS with its exit line. */
function locateExitBlock(text) {
  const lines = String(text).split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) if (/\bexit( code)?:/.test(lines[i])) start = i;
  if (start < 0) return null;
  const block = [];
  let i = start;
  for (; i < lines.length && lines[i].trim(); i++) block.push(lines[i].trim());
  return { block: block.join(" ").replace(/\s+/g, " "), after: lines.slice(i).filter((l) => l.trim()) };
}

const listsTwo = (block) => /(?<![\w-])2(?![\w-])/.test(block.replace(/^.*?\bexit( code)?:/, ""));

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The clause attributed to the refusal's code: `1 no backlog…` or `1 = no backlog…`. */
const CLAUSE = new RegExp("(?<![\\w-])" + BACKLOG_DIR_REFUSAL_EXIT + "(?: =)? " + escape(BACKLOG_DIR_REFUSAL_PHRASE));

const doc = readFileSync(DOC, "utf8").replace(/\s+/g, " ");

const inScope = Object.entries(COMMANDS)
  .map(([name, spec]) => ({ name, block: exitBlock(commandHelpText(name, spec)) }))
  .filter(({ block }) => block && listsTwo(block));

for (const [name, spec] of Object.entries(COMMANDS)) {
  test("`" + name + " --help` ends with an exit line that lists 2", () => {
    const located = locateExitBlock(commandHelpText(name, spec));
    assert.ok(located, "`" + name + " --help` prints no `exit:` line — a reader cannot learn its exit codes");
    assert.deepEqual(located.after, [], "`" + name + " --help` goes on after its exit line instead of ending with it");
    assert.ok(listsTwo(located.block), "`" + name + "` exit line does not list 2, the code of a usage error:\n  " + located.block);
  });
}

test("the guard has something to judge — a zero sample would pass on nothing", () => {
  const carrying = inScope.filter(({ name }) => !(name in EXEMPT));
  assert.ok(carrying.length >= 20, "only " + carrying.length + " help texts list 2 — the exit-line scan stopped finding them");
});

for (const { name, block } of inScope) {
  if (name in EXEMPT) continue;
  test("`" + name + " --help` says that no backlog exits " + BACKLOG_DIR_REFUSAL_EXIT, () => {
    assert.match(block, CLAUSE, "the exit line lists 2 but not the no-backlog case:\n  " + block);
  });
}

test("what `--help` prints is the text judged here", () => {
  const r = spawnSync(process.execPath, [CLI, "take", "--help"], { encoding: "utf8", timeout: 30_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(exitBlock(r.stdout), CLAUSE, r.stdout);
});

for (const [name, spec] of Object.entries(EXEMPT)) {
  test("`" + name + "` is exempt because " + spec.why, () => {
    const entry = inScope.find((c) => c.name === name);
    assert.ok(entry, "`" + name + "` no longer lists 2 in its exit line — remove it from EXEMPT and from the contract document");
    assert.doesNotMatch(entry.block, CLAUSE, "`" + name + "` carries the clause although it is exempt");
    const r = spawnSync(process.execPath, [CLI, ...spec.argv],
      { cwd: NOWHERE, encoding: "utf8", timeout: 30_000, input: "", env: { ...process.env, BACKLOG_STATE_DIR: join(NOWHERE, ".state") } });
    if (spec.reports) {
      assert.equal(r.status, 0, "`" + spec.argv.join(" ") + "` no longer reports a missing backlog:\n" + r.stdout + r.stderr);
    } else {
      assert.doesNotMatch(r.stderr, REFUSAL, "`" + spec.argv.join(" ") + "` now resolves a backlog, so its help must carry the clause:\n" + r.stderr);
    }
  });
}

test("the help texts a script prints when it is run directly carry the clause too", () => {
  const direct = {
    "audit.mjs USAGE": AUDIT_USAGE,
    "docs-drift.mjs USAGE": DOCS_DRIFT_USAGE,
  };
  for (const script of ["renumber.mjs", "query.mjs", "doctor.mjs"]) {
    const r = spawnSync(process.execPath, [join(SCRIPTS_DIR, script), "--help"], { encoding: "utf8", timeout: 30_000 });
    assert.equal(r.status, 0, script + " --help: " + r.stderr);
    direct[script + " --help"] = r.stdout;
  }
  for (const [where, text] of Object.entries(direct)) {
    const block = exitBlock(text);
    assert.ok(block && listsTwo(block), where + " has no exit line listing 2: " + block);
    assert.match(block, CLAUSE, where + " lists 2 but not the no-backlog case:\n  " + block);
  }
});

test("docs/external-consumers.md states the same code in the same words", () => {
  const stated = BACKLOG_DIR_REFUSAL_PHRASE[0].toUpperCase() + BACKLOG_DIR_REFUSAL_PHRASE.slice(1) +
    ", is `" + BACKLOG_DIR_REFUSAL_EXIT + "` from every command";
  assert.ok(doc.includes(stated), "the contract no longer says: " + stated);
  assert.ok(doc.includes("`· " + BACKLOG_DIR_REFUSAL_HELP + "`"),
    "the contract does not quote the help clause `· " + BACKLOG_DIR_REFUSAL_HELP + "`");
});

test("the commands the contract names as leaving the clause out are exactly the exempt ones", () => {
  const m = doc.match(/The lines that leave it out (.*?) which reports it\./);
  assert.ok(m, "the contract no longer names the commands whose help leaves the clause out");
  const named = [...m[1].matchAll(/`([a-z-]+)`/g)].map((x) => x[1]).sort();
  assert.deepEqual(named, Object.keys(EXEMPT).sort());
});

test("a command exits with the code its help names when there is no backlog", () => {
  for (const argv of [["stats"], ["take", "X-1", "--actor", "agent:a"]]) {
    const r = spawnSync(process.execPath, [CLI, ...argv],
      { cwd: NOWHERE, encoding: "utf8", timeout: 30_000, input: "", env: { ...process.env, BACKLOG_STATE_DIR: join(NOWHERE, ".state") } });
    assert.equal(r.status, BACKLOG_DIR_REFUSAL_EXIT, argv.join(" ") + ":\n" + r.stderr);
    assert.match(r.stderr, REFUSAL, argv.join(" ") + ":\n" + r.stderr);
  }
});
