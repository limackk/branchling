#!/usr/bin/env node
/**
 * `resume <ID>` — one briefing for a session that died mid-task (TL-151).
 *
 * WHAT IT IS FOR. A successor has none of the previous session's conversation.
 * Everything that session left behind is already reachable — the task file, the
 * history log, the branch, the closing contract — but only as four separate
 * questions it has to remember to ask, and each of them is a chance to miss one.
 * This command is the composition, and a composition is judged on the two
 * properties none of the parts has on its own: the ORDER they are read in, and
 * whether the verification result is CURRENT.
 *
 * THE ORDER IS THE PRODUCT. The briefing is read top-down by an agent that acts
 * on the first thing it understands, so the sequence is fixed here and nowhere
 * else: (1) the open question or the decision that answered it — a successor
 * that starts work on a task still waiting for an answer has wasted the whole
 * session; (2) the Goal, which says what "done" means; (3) what changed since
 * the take, WITH ACTORS, so an answer that must be honoured can be told from a
 * change that may be undone; (4) the branch's work, which is the code; (5) the
 * contract, which says how far it got. A briefing carrying every part in the
 * wrong order is a wrong briefing.
 *
 * IT COMPOSES READS AND WRITES NOTHING (law 2, law 4). No status moves, no lock
 * is taken, no file is touched — deleting nothing has to be possible, because
 * nothing was written. In particular it does NOT re-take the task: `take` under
 * the same actor is idempotent, but it is still a writing command, and a
 * briefing that moved a claim would be a second, quieter takeover path.
 *
 * THE DIFF IS AGAINST THE MERGE BASE, NOT THE BASE'S TIP. The base branch moved
 * while the session was dead; a two-dot diff would report somebody else's
 * commits as this session's work, which is the one thing the diff is read to
 * find out.
 *
 * AND THE WORKING TREE IS THE SECOND HALF OF THAT SECTION (TL-272). The session
 * being resumed DID NOT CHOOSE THE MOMENT IT STOPPED — it was killed — so the
 * most recent thing it wrote is exactly the thing least likely to be in a
 * commit. Reporting only the committed range answered `No commit on this branch
 * since the merge base.` to a tree holding an hour of edits, and the successor
 * believed it was starting from nothing. The committed range is NOT replaced:
 * it remains the right answer to "what has this branch done that the base has
 * not", it is printed FIRST, and the uncommitted half is labelled so that an
 * edit which a `git checkout` would destroy is never read as landed work.
 *
 * FOUR STATES, NOT TWO. Committed work; a tracked file edited and never
 * committed; a file created and never added, which no `git diff` reports at
 * all; and a clean tree — which is itself two different facts, clean because
 * everything landed and clean because nothing was ever written. One sentence
 * for the last two would tell a successor with an hour of landed work behind it
 * the same thing it tells one starting from scratch.
 *
 * THE CONTRACT IS RE-RUN, NOT RECALLED. The last recorded result is stale by
 * definition — the tree has moved on — and a stale verdict printed as if it were
 * current is worse than none, because it is the one thing the successor acts on.
 * `--no-verify` skips the run and says so before the briefing starts; it never
 * prints an old result in its place. Silence is the only honest answer there.
 *
 * A DIFFERENT ACTOR IS REFUSED. Taking an abandoned claim over is a decision
 * with a stated window (`abandoned_after_days`) and it already has a command;
 * this one points at it rather than becoming a second route to the same effect.
 *
 * Tests: `node --test scripts/tests/resume-briefing.test.mjs`
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveActor } from "./actor.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { parseVerification } from "./criteria.mjs";
import { contractProblem, findTaskFile, repoRootFor, runContract } from "./done-task.mjs";
import { ACTOR_NAMESPACES, isValidActor, readHistory } from "./history.mjs";
import { printJson } from "./json-envelope.mjs";
import { backlogPaths, resolveBacklogDirOrExit } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import {
  FIELD_COMMENT, FIELD_DECISION, extractMeta, historyEntryKind, isQuestion, openQuestions, splitFrontmatter,
} from "./task-fields.mjs";
import { MARK, failure } from "./ui.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const RESUME_FLAGS = ["--dir", "--actor", "--base", "--no-verify", "--json"];

/** The default base is the same one `pr-summary` compares against: a branch is
 *  read against what it will be merged into, and that is not something this tool
 *  may discover from whichever ref happens to exist. */
export const DEFAULT_BASE = "main";

/**
 * The headings, in the order the briefing fixes them. ONE list, so the text and
 * the JSON cannot disagree about the sequence — which is the deliverable.
 */
export const SECTIONS = [
  "## Open questions and decisions",
  "## Goal",
  "## Since the take",
  // ONE heading for BOTH halves, and it names both (TL-272). Three ranges under
  // three headings would be a section the reader has to reconcile; a heading
  // saying only "diff" would hide that half of what is under it is in no commit.
  "## The branch's work — committed, and not yet committed",
  "## Verification",
];

/** PURE — resolves `resume`'s arguments. Throws on a usage error. */
export function parseResumeArgs(args) {
  const plan = { id: null, dir: null, actor: null, base: DEFAULT_BASE, verify: true, json: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") { plan.json = true; continue; }
    if (a === "--no-verify") { plan.verify = false; continue; }
    if (a === "--dir" || a === "--actor" || a === "--base") {
      const value = args[++i] || null;
      if (!value) throw new Error("`" + a + "` with no value");
      plan[a.slice(2)] = value;
      continue;
    }
    if (a.startsWith("-")) {
      throw new Error("unknown flag: " + a + "\navailable: " + RESUME_FLAGS.join(" "));
    }
    if (plan.id) throw new Error("two task ids given: " + plan.id + " and " + a + " — one briefing is about one task");
    plan.id = a;
  }
  if (!plan.id) throw new Error("no task id\nusage: " + N + " resume <ID> [--actor <ns:name>]");
  return plan;
}

// ──────────────────────────────────────────────────────────────────────────
// The parts
// ──────────────────────────────────────────────────────────────────────────

function git(cwd, args) {
  const r = spawnSync("git", args, {
    cwd, encoding: "utf8",
    // A branch's whole diff is the payload here, and Node's 1 MB default would
    // turn a large one into a briefing that silently lost its code section.
    maxBuffer: 64 * 1024 * 1024,
  });
  return { ok: r.status === 0, stdout: r.stdout || "", stderr: r.stderr || "" };
}

/**
 * The branch's own work, against the MERGE BASE with `base`. `null` when the
 * range cannot be computed, and then `reason` says why — an empty diff and a
 * range nobody could resolve are opposite facts and must not read alike.
 *
 * @returns {{base: string, mergeBase: string|null, branch: string|null,
 *            patch: string|null, reason: string|null}}
 */
export function branchDiff(cwd, base, run = git) {
  const branch = run(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const merge = run(cwd, ["merge-base", base, "HEAD"]);
  const out = { base, mergeBase: null, branch: branch.ok ? branch.stdout.trim() : null, patch: null, reason: null };
  if (!merge.ok) {
    out.reason = "`git merge-base " + base + " HEAD` failed — is `" + base +
      "` a ref this clone has? Name another with `--base <ref>`.";
    return out;
  }
  out.mergeBase = merge.stdout.trim();
  const patch = run(cwd, ["diff", out.mergeBase, "HEAD"]);
  if (!patch.ok) {
    out.reason = (patch.stderr || "`git diff` failed").trim();
    return out;
  }
  out.patch = patch.stdout;
  return out;
}

/**
 * WHAT IS ON DISK AND IN NO COMMIT (TL-272). Two collections, because they are
 * two states a successor has to act on differently.
 *
 * `patch` is `git diff HEAD` — every tracked file that differs from the last
 * commit, STAGED OR NOT. The index is deliberately not a third range: a dead
 * session's `git add` says nothing about whether the work is finished, and a
 * successor asking "what is not in a commit" is not asking "what did it intend
 * to commit".
 *
 * `untracked` is a list of PATHS, and only paths. Showing their contents would
 * mean `git add --intent-to-add`, and this command writes nothing — not even
 * to the index (law 2). Naming them is also the honest limit of what git knows
 * about them: git has never seen these files, so it cannot say what changed in
 * one, only that it exists. The successor reads them with the editor it already
 * has.
 *
 * `null` for either collection means it could not be computed, and `reason`
 * says why. An empty tree and a tree nobody could read are opposite facts.
 *
 * @returns {{patch: string|null, untracked: string[]|null, reason: string|null}}
 */
export function workingTree(cwd, run = git) {
  const out = { patch: null, untracked: null, reason: null };
  const patch = run(cwd, ["diff", "HEAD"]);
  if (!patch.ok) {
    out.reason = (patch.stderr || "`git diff HEAD` failed").trim();
    return out;
  }
  out.patch = patch.stdout;
  // `ls-files --others --exclude-standard` is the untracked set `status
  // --porcelain` reports, without the directory collapsing: a session that
  // created `src/parser/` with four files in it must have all four named, or
  // the briefing hides three of them behind a trailing slash.
  const others = run(cwd, ["ls-files", "--others", "--exclude-standard"]);
  if (!others.ok) {
    out.reason = (others.stderr || "`git ls-files --others` failed").trim();
    return out;
  }
  out.untracked = others.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  return out;
}

/**
 * The `## Goal` of the task file, as written. PURE.
 *
 * Only the Goal, and not the whole body: the briefing already carries the
 * decisions, the history and the contract from their own sources, and printing
 * the file whole would put a second, older copy of each beside them.
 */
export function goalOf(body) {
  const lines = String(body || "").split("\n");
  const at = lines.findIndex((l) => /^##\s+Goal\s*$/.test(l));
  if (at < 0) return "";
  const rest = lines.slice(at + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
}

/**
 * A NAME IN `owner:` THAT SOMEBODY COULD BE ASKED FOR. PURE.
 *
 * A PRESENCE CHECK IS NOT ENOUGH, because the field is never empty on an
 * untouched task: the template writes a word for "nobody" into it, so every task
 * the tool ever created would look held. Which word that is belongs to the
 * project's vocabulary (`owners:` in config.yaml) and is not something this file
 * may name — but its SHAPE is the tool's own, and the tool already draws that
 * line for `--actor`: a claim is held by an ACTOR, in a namespace, and anything
 * else is a placeholder however the project spells it.
 *
 * The boundary is the same one the refusal has to live inside. Turning a
 * successor away is only useful when it can say WHO to ask, and it says so by
 * handing back `--actor <them>`; a word that this predicate would let through
 * but `isValidActor` would not is a remedy the next invocation rejects as a
 * usage error, which leaves the successor with nothing to do at all.
 */
function isClaim(owner) {
  return isValidActor(String(owner || ""));
}

/**
 * WHOSE SESSION LEFT THIS BEHIND. PURE.
 *
 * NOT `owner:` ALONE, and the reason is the case this command exists for. A
 * session that stopped on a question is parked: `ask` clears the owner while the
 * task waits, and `decide` puts the status back without handing the claim to the
 * person who answered. So the task most in need of a briefing is exactly the one
 * whose `owner:` is empty, and reading only the field would let anybody resume
 * it — a takeover in all but name.
 *
 * The field still WINS where it carries a claim: it is the durable one and it
 * travels with the branch. The log is consulted only for the second question,
 * "who last took this", which is what a parked task has instead of an owner —
 * and it is read through the same predicate, since a reconciled hand-edit can
 * put the placeholder into a recorded `owner` change as readily as into a file.
 *
 * @returns {{actor: string, held: boolean}|null} `null` when nobody ever claimed it
 */
export function claimant(entries, owner) {
  if (isClaim(owner)) return { actor: owner, held: true };
  for (let i = (entries || []).length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e && e.field === "owner" && isClaim(e.to)) return { actor: String(e.to), held: false };
  }
  return null;
}

/**
 * Where the CURRENT claim began, and everything the log recorded after it.
 * PURE.
 *
 * The take is found as the last entry that put the file's owner in place. That
 * is the event the successor's question is asked from — "what happened while I
 * was not looking" is not "what ever happened to this task", and a briefing that
 * replayed the whole log would bury the two entries that matter.
 *
 * With no such entry — a task that was never taken through the tool — the whole
 * history is returned rather than nothing: an unrecognised take is a reason to
 * show more, never a reason to show less.
 */
export function sinceTheTake(entries, owner) {
  const list = entries || [];
  if (!owner) return { take: null, since: list };
  let at = -1;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e && e.field === "owner" && String(e.to || "") === owner) at = i;
  }
  if (at < 0) return { take: null, since: list };
  return { take: list[at], since: list.slice(at + 1) };
}

/** One history entry as a line of prose. PURE. */
export function describeEntry(e) {
  const text = (s) => String(s == null ? "" : s).split("\n").map((l) => l.trim()).filter(Boolean).join(" · ");
  if (e.field === FIELD_DECISION) return "decision: " + text(e.to);
  if (e.field === FIELD_COMMENT) return "comment: " + text(e.to);
  if (historyEntryKind(e) === "event") return e.field.replace(/^__|__$/g, "") + (e.to ? ": " + text(e.to) : "");
  return e.field + ": " + (text(e.from) || "(none)") + " " + MARK.arrow + " " + (text(e.to) || "(none)");
}

/**
 * The questions and the answers, as a successor needs them: an answered pair is
 * a decision to honour, an unanswered one is work that must not start. PURE.
 */
export function decisionsOf(entries) {
  const questions = new Set((entries || []).filter(isQuestion).map((e) => e.id));
  const answered = new Map();
  for (const e of entries || []) {
    if (e && e.field === FIELD_DECISION && typeof e.resolves === "string" && questions.has(e.resolves)) answered.set(e.resolves, e);
  }
  const out = [];
  for (const q of entries || []) {
    if (!isQuestion(q) || !answered.has(q.id)) continue;
    const a = answered.get(q.id);
    out.push({ open: false, id: q.id, question: q.to, askedBy: q.actor, answer: a.to, answeredBy: a.actor });
  }
  for (const q of openQuestions(entries)) {
    out.push({
      open: true, id: q.id, question: q.to, askedBy: q.actor, answer: null, answeredBy: null,
      options: Array.isArray(q.options) ? q.options : [], recommend: q.recommend || null,
    });
  }
  // A decision recorded without a question to point at is still a decision the
  // successor is bound by, and it has nowhere else in this section to appear.
  for (const e of entries || []) {
    if (!e || e.field !== FIELD_DECISION) continue;
    if (typeof e.resolves === "string" && e.resolves && answered.has(e.resolves)) continue;
    out.push({ open: false, id: e.id, question: null, askedBy: null, answer: e.to, answeredBy: e.actor });
  }
  return out;
}

/**
 * Run the closing contract NOW. Nothing is recorded: this is a reading of the
 * tree, not a closing, and `done` remains the only thing that writes a verdict.
 */
export function runVerification(frontmatter, cwd) {
  const { entries, problems } = parseVerification(frontmatter);
  const problem = contractProblem(entries, problems);
  if (problem) return { entries: [], problem, failed: null };
  const { results, failed } = runContract(entries, cwd, { capture: true });
  // The entries the stop-at-first-failure never reached. Named, because a
  // contract of four whose second entry broke has told the reader nothing about
  // the other two, and a briefing that listed only what ran would look complete.
  for (const e of entries.slice(results.length)) {
    results.push({ id: e.id, kind: e.manual ? "manual" : "bash", command: e.bash || e.manual, ok: null, exitCode: null, ms: 0, ran: false });
  }
  return { entries: results, problem: null, failed };
}

// ──────────────────────────────────────────────────────────────────────────
// The briefing
// ──────────────────────────────────────────────────────────────────────────

/** The whole document, in the fixed order. PURE — a test reads it without a
 *  terminal, and without running anybody's contract. */
export function renderBriefing(model) {
  const out = [];
  if (!model.verified) {
    out.push(MARK.warn + " --no-verify: the closing contract was NOT run, and no earlier");
    out.push("  result is shown in its place — a recalled verdict is the one thing a");
    out.push("  successor would act on. Run `" + N + " done " + model.id + " --dry-run` to learn where it stands.");
    out.push("");
  }
  out.push(model.id + " — resume briefing for " + model.actor);
  const where = [];
  if (model.diff.branch) where.push("branch " + model.diff.branch);
  if (model.diff.mergeBase) where.push("merge base " + model.diff.mergeBase.slice(0, 12) + " with " + model.diff.base);
  if (where.length) out.push("(" + where.join(", ") + ")");

  out.push("");
  out.push(SECTIONS[0]);
  out.push("");
  if (!model.decisions.length) out.push("  Nothing was asked and nothing was decided.");
  for (const d of model.decisions) {
    if (d.open) {
      out.push("  " + MARK.warn + " OPEN (" + d.askedBy + ", `" + d.id + "`): " + d.question);
      (d.options || []).forEach((text, i) => {
        out.push("      " + (i + 1) + ". " + text + (i + 1 === d.recommend ? "  (recommended)" : ""));
      });
      out.push("      Answer it with `" + N + " decide " + model.id + " --resolves " + d.id + "` before starting work.");
    } else if (d.question) {
      out.push("  Q (" + d.askedBy + "): " + d.question);
      out.push("  A (" + d.answeredBy + "): " + d.answer);
    } else {
      out.push("  Decided (" + d.answeredBy + "): " + d.answer);
    }
  }

  out.push("");
  out.push(SECTIONS[1]);
  out.push("");
  out.push(model.goal ? model.goal.split("\n").map((l) => (l ? "  " + l : l)).join("\n") : "  The task file states no Goal.");

  out.push("");
  out.push(SECTIONS[2]);
  out.push("");
  if (model.take) out.push("  taken " + model.take.ts + " by " + model.take.actor);
  if (!model.history.length) out.push("  Nothing was recorded after the take.");
  for (const e of model.history) out.push("  " + e.ts + "  " + e.actor + "  " + e.text);

  out.push("");
  out.push(SECTIONS[3]);
  out.push("");
  out.push(...renderWork(model));

  out.push("");
  out.push(SECTIONS[4]);
  out.push("");
  out.push(...renderVerification(model));
  return out.join("\n");
}

/** One file, or n files. Spelled once, because two call sites got it wrong. */
function files(n) {
  return n + (n === 1 ? " file" : " files");
}

/**
 * THE FOURTH SECTION: what this branch has done, in TWO HALVES (TL-272).
 *
 * THE COMMITTED HALF COMES FIRST AND IS UNCHANGED — the merge-base range
 * TL-151 built, which is the right answer to "what has this branch done that
 * the base has not" and is not being replaced by anything here.
 *
 * THE LABELS ARE THE PRODUCT OF THE SECOND HALF. A successor that mistook an
 * uncommitted edit for a landed one would be wrong in the expensive direction:
 * the first is destroyed by a `git checkout` and the second is not. So each
 * half opens with a bulleted label, at the prose indent the rest of the
 * briefing uses, and the patches stay flush left where a patch belongs — an
 * indented diff is no longer a diff anybody can pipe into `git apply`.
 *
 * A CLEAN TREE IS TWO DIFFERENT FACTS and gets two different sentences. Clean
 * because everything landed in a commit is a successor's starting point; clean
 * because nothing was ever written is a different session entirely. One
 * sentence for both would be the same silence this task was filed to remove.
 */
function renderWork(model) {
  const out = [];
  const d = model.diff;
  const w = model.working || { patch: null, untracked: null, reason: null };
  const committed = Boolean(d.patch && d.patch.trim());
  const dirty = Boolean(w.patch && w.patch.trim());
  const untracked = Array.isArray(w.untracked) ? w.untracked : [];
  const readable = d.patch !== null && w.patch !== null && w.untracked !== null;

  if (readable && !committed && !dirty && !untracked.length) {
    out.push("  " + MARK.bullet + " Nothing, in either sense: no commit on this branch since the merge");
    out.push("    base, and nothing on disk that git does not already have. This branch");
    out.push("    has not been written on — you are not resuming work, you are starting it.");
    return out;
  }

  if (d.patch === null) {
    out.push("  " + MARK.warn + " " + d.reason);
  } else if (!committed) {
    out.push("  " + MARK.bullet + " Committed since the merge base: nothing. No commit on this branch.");
  } else {
    out.push("  " + MARK.bullet + " Committed since the merge base — this is what would land in " +
      d.base + ":");
    out.push("");
    out.push(d.patch.replace(/\n$/, ""));
    out.push("");
  }

  if (w.patch === null || w.untracked === null) {
    out.push("  " + MARK.warn + " the working tree could not be read: " + (w.reason || "unknown"));
    return out;
  }

  if (!dirty && !untracked.length) {
    out.push("  " + MARK.bullet + " Not yet committed: nothing. Everything this branch wrote is in the");
    out.push("    commit range above, and a fresh clone of the branch would hold all of it.");
    return out;
  }

  if (dirty) {
    out.push("  " + MARK.bullet + " Not yet committed — tracked files that differ from HEAD, staged or not.");
    out.push("    No commit carries these lines; a `git checkout` would destroy them:");
    out.push("");
    out.push(w.patch.replace(/\n$/, ""));
    out.push("");
  } else {
    out.push("  " + MARK.bullet + " Not yet committed: no tracked file differs from HEAD.");
  }

  if (untracked.length) {
    const it = untracked.length === 1 ? "it" : "them";
    out.push("  " + MARK.bullet + " Untracked — " + files(untracked.length) + " git has never seen, so no diff");
    out.push("    can describe " + it + ". Named and not quoted: showing the content would");
    out.push("    mean `git add -N`, and this command writes nothing, not even the index:");
    for (const f of untracked) out.push("      " + f);
  } else {
    out.push("  " + MARK.bullet + " Untracked: none. Every file on disk is one git already tracks.");
  }
  return out;
}

/** The last section, and the last thing on the page. Kept separate because
 *  NOTHING may follow it: a reader who stops here has read the verdict. */
function renderVerification(model) {
  const out = [];
  if (!model.verified) {
    out.push("  Not run (`--no-verify`). The state of the contract is unknown, not green.");
    return out;
  }
  if (model.contractProblem) {
    for (const line of model.contractProblem.split("\n")) out.push("  " + MARK.warn + " " + line);
    return out;
  }
  for (const r of model.verification) {
    if (r.ok === true) out.push("  " + MARK.ok + " " + r.id + "  passed (" + r.ms + " ms)");
    else if (r.ok === false) out.push("  " + MARK.err + " " + r.id + "  " + verdictWord(r));
    else if (r.ran === false) out.push("  " + MARK.bullet + " " + r.id + "  not reached — an entry before it stopped the run");
    else out.push("  " + MARK.bullet + " " + r.id + "  manual, and nothing here can re-run it");
  }
  if (model.failedOutput) {
    out.push("");
    for (const line of String(model.failedOutput).replace(/\n$/, "").split("\n")) out.push("  " + line);
  }
  return out;
}

/** Spelled once, so the green branch above cannot accidentally carry the word. */
function verdictWord(r) {
  return "FAILED (exit " + r.exitCode + ")";
}

// ──────────────────────────────────────────────────────────────────────────
// The command
// ──────────────────────────────────────────────────────────────────────────

function refuse(plan, headline, details, kind) {
  if (plan.json) {
    printJson("resume", { ok: false, id: plan.id, refusalKind: kind, refusal: headline, details });
    return 1;
  }
  console.error(failure(N + " resume", headline, details));
  return 1;
}

export function run(argv) {
  let plan;
  try {
    plan = parseResumeArgs(argv);
  } catch (e) {
    const [head, ...rest] = e.message.split("\n");
    console.error(failure(N + " resume", head, rest, [N + " resume --help"]));
    return 2;
  }

  const actor = resolveActor(plan.actor);
  if (!isValidActor(actor)) {
    console.error(failure(N + " resume", "the actor `" + actor + "` has no valid namespace",
      ["use one of: " + ACTOR_NAMESPACES.map((n) => n + ":<name>").join(" | ")]));
    return 2;
  }

  const root = resolveBacklogDirOrExit({ dir: plan.dir || undefined, moduleDir: __dirname }, N + " resume").root;
  const config = loadConfigOrExit(root);
  const paths = backlogPaths(root);

  const file = findTaskFile(paths.tasksDir, config, plan.id);
  if (!file) return refuse(plan, "there is no task " + plan.id + " in " + paths.tasksDir, [], "no-such-task");

  const raw = readFileSync(file, "utf8");
  const { frontmatter, body } = splitFrontmatter(raw);
  const meta = extractMeta(frontmatter);
  const id = meta.id || plan.id;

  // THE CLAIM IS NOT TOUCHED, IN EITHER DIRECTION. Under the same actor there is
  // nothing to change; under a different one this is a takeover, and a takeover
  // is a decision with a window somebody has to have judged.
  const entries = readHistory(root, id);
  const held = claimant(entries, meta.owner);
  if (held && held.actor !== actor) {
    return refuse(plan,
      id + (held.held ? " is held by " : " was taken by ") + held.actor + ", not by " + actor,
      [
        "A briefing does not change hands. Taking an abandoned claim over is a",
        "decision with a stated window — `abandoned_after_days` in config.yaml, which",
        "`" + N + " next` judges and which names the previous owner when it fires.",
        "Ask them, or resume as " + held.actor + " with `--actor " + held.actor + "`.",
      ],
      "other-owner");
  }

  const { take, since } = sinceTheTake(entries, held ? held.actor : null);
  const cwd = repoRootFor(root);

  const model = {
    id, file, actor, owner: meta.owner || null,
    verified: plan.verify,
    decisions: decisionsOf(entries),
    goal: goalOf(body),
    take: take ? { ts: take.ts, actor: take.actor } : null,
    history: since.map((e) => ({ ts: e.ts, actor: e.actor, field: e.field, text: describeEntry(e) })),
    diff: branchDiff(cwd, plan.base),
    working: workingTree(cwd),
    verification: [],
    contractProblem: null,
    failedOutput: null,
  };

  if (plan.verify) {
    const contract = runVerification(frontmatter, cwd);
    model.verification = contract.entries;
    model.contractProblem = contract.problem;
    model.failedOutput = contract.failed && contract.failed.output ? contract.failed.output : null;
  }

  if (plan.json) {
    printJson("resume", {
      ok: true, id, file, actor, owner: model.owner,
      base: model.diff.base, mergeBase: model.diff.mergeBase, verified: model.verified,
      decisions: model.decisions,
      goal: model.goal,
      history: model.history,
      diff: model.diff.patch,
      // The second half, as its own key rather than concatenated into `diff`
      // (TL-272): a consumer that could not tell a committed hunk from an
      // uncommitted one would reintroduce in JSON exactly the confusion the
      // text output was changed to remove.
      uncommitted: {
        patch: model.working.patch,
        untracked: model.working.untracked,
        reason: model.working.reason,
      },
      verification: model.verification,
    });
    return 0;
  }

  console.log(renderBriefing(model));
  // A BRIEFING IS A REPORT, NOT A GATE. A failing contract is the most important
  // thing it has to say, and a non-zero exit would make a successor treat the
  // report itself as a failure and throw it away.
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("resume-task.mjs")) {
  process.exit(run(process.argv.slice(2)));
}
