#!/usr/bin/env node
/**
 * The `done <ID>` command — closing a task RUNS its verification (TL-82).
 *
 * WHAT THIS CHANGES. `verification:` has been written, validated and taught
 * since the beginning, and no script ever ran it: enforcement was a line in a
 * skill file, addressed to the same agent it was meant to police. That is a
 * convention of discipline wearing the clothes of a guarantee. After this
 * command "done" is an exit code, not a declaration by the party with the
 * strongest interest in the answer being yes.
 *
 * WHAT IT DELIBERATELY DOES NOT PROMISE. A task file is a text file, and anyone
 * can set `status: done` in an editor. This gate raises the COST of a lie; it
 * does not make one impossible. Saying otherwise would be the same species of
 * untruth the command exists to catch, so the README says it too.
 *
 * WHY THERE IS NO `--force`. The task asked for the decision either way, as long
 * as it was not silent. There is none, and the reason is that it would not add a
 * capability — hand-editing the file is already available and already honest
 * about being a bypass, because it leaves a diff a reviewer can see. A flag adds
 * something worse than capability: a SUPPORTED, scriptable bypass, one word long,
 * that ends up in a CI job where nobody reads it again. The escape hatch that
 * costs a visible edit is the right price.
 *
 * WHY IT NEVER RUNS BY ITSELF. Not in `build`, not in `check`, not in `serve`,
 * not in `regen-hook`. A task arriving in somebody else's pull request carries a
 * shell command; it may run only when a person deliberately closes THAT task,
 * and only after its text has been printed. `scripts/tests/verification-gate.test.mjs`
 * holds a test that fails if another command ever learns to run it.
 *
 * Tests: `node --test scripts/tests/verification-gate.test.mjs`
 */

import { spawnSync } from "node:child_process";
import { closeSync, openSync, readFileSync, readSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveActor } from "./actor.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { backlogPaths, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { applyProofs, auditTask, parseCriteria, parseVerification } from "./criteria.mjs";
import { buildFieldSpecs, extractMeta, fieldSpec, setFrontmatterField, splitFrontmatter } from "./task-fields.mjs";
import { ACTOR_NAMESPACES, FIELD_VERIFIED, REASON_PROVEN, appendEntries, eventId, isValidActor, isValidReason, recordEdit, requiresReason } from "./history.mjs";
import { printJson } from "./json-envelope.mjs";
import { releaseLock } from "./lock.mjs";
import { MARK, color, errColor, failure } from "./ui.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OKM = color.ok(MARK.ok);
const ERRM = errColor.err(MARK.err);
const WARNM = errColor.warn(MARK.warn);

/** The placeholder `_template.md` ships. A task closed on this has a contract
 *  that was never written — a different failure from "the verification failed",
 *  and it gets a different message. */
export const TEMPLATE_PLACEHOLDER = "command to run";

/**
 * What a `manual:` entry is NOT evidence of.
 *
 * The enumeration matters more than the request. "Verify this properly" is
 * advice nobody has ever acted on differently; a list of the four things people
 * actually submit instead of evidence is something a reader can check themselves
 * against. Taken from the Backlog.md guidance, which is better here than our
 * silence was.
 */
const NOT_EVIDENCE = [
  "the code being present, or the diff looking right",
  "a grep or a search finding the string you expected",
  "the intention of the implementation, or a reading of the source",
  "\"I checked\" — including when it is true",
];
const IS_EVIDENCE = [
  "  Evidence is a run through the browser, a script against the DOM, a test runner,",
  "  or a described result of a manual interaction another person could repeat.",
];

/** The word the prompt asks for. Not `y`: a confirmation you can give with one
 *  finger on the way to something else is not the deliberate act this is for. */
const CONFIRM_WORD = "confirm";

// ──────────────────────────────────────────────────────────────────────────
// Pure helpers
// ──────────────────────────────────────────────────────────────────────────

const FLAGS = ["--dir", "--dry-run", "--json", "--actor", "--status", "--confirm-manual", "--reason"];

/** PURE — resolves `done`'s arguments. Throws on a usage error. */
export function parseDoneArgs(args) {
  let id = null;
  let dir = null;
  let dryRun = false;
  let json = false;
  let actor = null;
  let status = null;
  let confirmManual = false;
  let reason = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dir") {
      dir = args[++i] || null;
      if (!dir) throw new Error("`--dir` with no path");
      continue;
    }
    if (a === "--dry-run") { dryRun = true; continue; }
    if (a === "--json") { json = true; continue; }
    if (a === "--confirm-manual") { confirmManual = true; continue; }
    if (a === "--actor") {
      actor = args[++i] || null;
      if (!actor) throw new Error("`--actor` with no name");
      continue;
    }
    if (a === "--status") {
      status = args[++i] || null;
      if (!status) throw new Error("`--status` with no value");
      continue;
    }
    if (a === "--reason") {
      reason = args[++i] || null;
      if (!reason) throw new Error("`--reason` with no text");
      // A reserved value is a bad ARGUMENT — wrong whatever the task and whatever
      // the configuration say — so it fails here with the other usage errors
      // rather than as a refusal about this particular closure.
      if (!isValidReason(reason)) {
        throw new Error(
          "`--reason " + reason + "` is reserved\n" +
            "`unknown` and `proven` are what the tool writes when nobody stated a reason\n" +
            "or when a run stood in for one. Typing them by hand would dress a machine's\n" +
            "answer up as yours."
        );
      }
      continue;
    }
    if (a.startsWith("-")) {
      throw new Error("unknown flag: " + a + "\nknown flags: " + FLAGS.join(" "));
    }
    if (id) throw new Error("two task ids given: " + id + " and " + a + " — close one task at a time");
    id = a;
  }
  if (!id) throw new Error("no task id\nusage: " + N + " done <ID> [--dry-run] [--json]");
  return { id, dir, dryRun, json, actor, status, confirmManual, reason };
}

/** The task file for an id, or null. */
export function findTaskFile(tasksDir, config, id) {
  const wanted = String(id || "").toUpperCase();
  for (const f of readdirSync(tasksDir)) {
    if (!config.taskId.file.test(f)) continue;
    const m = f.match(config.taskId.fileId);
    if (m && m[1].toUpperCase() === wanted) return join(tasksDir, f);
  }
  return null;
}

/**
 * Why this task cannot be closed BEFORE anything is run, or null.
 *
 * Separated from the run on purpose: "this task has no closing contract" is not
 * the same defect as "the verification failed", it is discovered without
 * executing anything, and it deserves its own message. A guard that is green on
 * an empty sample is green with no evidential force (CLAUDE.md), and an empty
 * `verification:` is exactly that sample.
 */
export function contractProblem(entries, problems) {
  if (problems && problems.length) return problems.join("\n");
  if (!entries.length) {
    return (
      "this task has no `verification:` — there is nothing that could prove it is done.\n" +
      "A closing contract is not paperwork: it is the whole difference between a status\n" +
      "somebody set and a status something earned. Write one, then close the task."
    );
  }
  for (const e of entries) {
    const text = e.bash || e.manual || "";
    if (text.trim() === TEMPLATE_PLACEHOLDER) {
      return (
        "`verification:` still holds the template placeholder (`" + TEMPLATE_PLACEHOLDER + "`).\n" +
        "The field was filled in by the template, not by anybody who thought about this task."
      );
    }
  }
  return null;
}

/** The repository root — the working directory for every command.
 *
 *  NOT `join(backlogRoot, "..")`: in a co-located layout the backlog directory
 *  IS the repository root, and in a nested one it is one level down, and neither
 *  is a rule you may assume. Git knows; when there is no git, the backlog root
 *  is the only defensible answer left, and it is stated rather than guessed. */
export function repoRootFor(backlogRoot) {
  const r = spawnSync("git", ["-C", backlogRoot, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  const out = (r.stdout || "").trim();
  return r.status === 0 && out ? out : backlogRoot;
}

/** Today, as the frontmatter writes it. */
function today() {
  return new Date().toISOString().slice(0, 10);
}

// ──────────────────────────────────────────────────────────────────────────
// Running the contract
// ──────────────────────────────────────────────────────────────────────────

function runBash(command, cwd, capture) {
  const started = Date.now();
  const r = spawnSync(command, {
    shell: true,
    cwd,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  return {
    ok: r.status === 0,
    exitCode: r.status == null ? 1 : r.status,
    ms: Date.now() - started,
    output: capture ? (r.stdout || "") + (r.stderr || "") : null,
  };
}

/**
 * RUN A CONTRACT. One implementation, shared by the command that closes a task
 * and by the guard that re-runs a closed one (TL-147).
 *
 * WHY THE CALLBACKS RATHER THAN TWO LOOPS. The two callers differ in what they
 * SAY, not in what they do: `done` narrates each entry and asks a person to
 * vouch for a `manual:` one; `check --proofs` prints nothing and cannot ask
 * anybody anything. Two loops would be two answers to "did this contract pass",
 * which is the one question the guard exists to ask about the other's work.
 *
 * IT STOPS AT THE FIRST FAILURE, as `done` always has: the entries after it
 * would run against a tree the failure already describes, and the time is spent
 * for nothing.
 *
 * `manual` is asked for a decision and may return `null` for "cannot be
 * re-run", which is neither a pass nor a failure — a distinction the guard
 * needs, because a task proved only by a person is not broken and is not green
 * either.
 *
 * @param {Array<object>} entries parsed `verification:` entries
 * @param {string} cwd where the commands run — the repository root
 * @param {{capture?: boolean, manual?: function, before?: function, after?: function}} opts
 * @returns {{results: Array<object>, failed: object|null}}
 */
export function runContract(entries, cwd, opts = {}) {
  const results = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.manual) {
      const decision = opts.manual ? opts.manual(e, i) : { ok: null };
      const row = { id: e.id, kind: "manual", command: e.manual, ok: decision.ok, exitCode: null, ms: 0 };
      if (decision.vouchedBy) row.vouchedBy = decision.vouchedBy;
      results.push(row);
      if (decision.ok === false) return { results, failed: { entry: e, kind: "manual" } };
      continue;
    }
    if (opts.before) opts.before(e, i);
    const r = runBash(e.bash, cwd, opts.capture);
    results.push({ id: e.id, kind: "bash", command: e.bash, ok: r.ok, exitCode: r.exitCode, ms: r.ms });
    if (!r.ok) return { results, failed: { entry: e, kind: "bash", ...r } };
    if (opts.after) opts.after(e, r);
  }
  return { results, failed: null };
}

/** Read one line from the terminal. Returns null when there is no terminal.
 *
 *  It reads `/dev/tty`, not stdin: the command is meant to be usable in a pipe
 *  (`done X --json | jq`), and a prompt that consumed stdin would make
 *  the two mutually exclusive. */
function askLine(prompt) {
  if (!process.stdin.isTTY) return null;
  process.stdout.write(prompt);
  let fd;
  try {
    fd = openSync("/dev/tty", "r");
  } catch {
    return null;
  }
  try {
    const buf = Buffer.alloc(256);
    let out = "";
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (!n) break;
      out += buf.toString("utf8", 0, n);
      if (out.indexOf("\n") >= 0) break;
    }
    return out.split("\n")[0].trim();
  } finally {
    closeSync(fd);
  }
}

export function manualPrompt(entry, actor) {
  const lines = [];
  lines.push(WARNM + " no command can prove this one. A person has to vouch for it:");
  lines.push("    " + entry.manual);
  lines.push("");
  lines.push("  These are NOT evidence:");
  for (const n of NOT_EVIDENCE) lines.push("    · " + n);
  for (const l of IS_EVIDENCE) lines.push(l);
  lines.push("");
  lines.push("  Vouching is recorded in the history as " + actor + " and does not go away.");
  return lines.join("\n");
}

// ──────────────────────────────────────────────────────────────────────────
// The command
// ──────────────────────────────────────────────────────────────────────────

/**
 * The status a closed task lands in.
 *
 * From `archived_statuses`, never from the literal "done": the vocabulary is
 * this project's (third law), and a backlog that calls it `shipped` must not
 * need a different tool. `--status` picks another archived one — closing a task
 * as `cancelled` is a real ending, and it is still an ending that has to be
 * spelled, not inferred from a mood.
 */
export function closingStatus(config, requested) {
  const archived = config.archivedStatuses || [];
  if (!archived.length) {
    throw new Error(
      "`archived_statuses` in config.yaml is empty — this backlog has no status that means\n" +
        "\"closed\", so there is nothing for `done` to set. Name one there first."
    );
  }
  if (!requested) return archived[0];
  if (archived.indexOf(requested) < 0) {
    throw new Error(
      "`--status " + requested + "` is not one of `archived_statuses` (" + archived.join(", ") + ").\n" +
        "`done` closes a task; moving it to an OPEN status is an edit, not a closure."
    );
  }
  return requested;
}

function log(json, text) {
  if (!json) console.log(text);
}

/**
 * A refusal, in both shapes at once.
 *
 * `--json` consumers need a machine-readable answer to "why not" just as much as
 * to "yes" — a refusal that prints only prose makes the flag useless for exactly
 * the case a script cares about. The human text still goes to stderr, so the two
 * outputs never fight over stdout.
 */
function refuse(plan, headline, details, results, reason) {
  console.error(failure(N + " done", headline, details));
  if (plan.json) {
    printJson("verification-run", {
      task: plan.id, ok: false, closed: false, dryRun: plan.dryRun,
      refusalKind: reason, refusal: headline, details: details || [],
      entries: results || [],
    });
  }
  return 1;
}

function run(argv) {
  let plan;
  try {
    plan = parseDoneArgs(argv);
  } catch (e) {
    const [head, ...rest] = e.message.split("\n");
    console.error(failure(N + " done", head, rest, [N + " done --help"]));
    return 2;
  }

  const root = resolveBacklogDir({ dir: plan.dir || undefined, moduleDir: __dirname }).root;
  const config = loadConfigOrExit(root);
  const tasksDir = backlogPaths(root).tasksDir;

  const actor = resolveActor(plan.actor);
  if (!isValidActor(actor)) {
    console.error(
      failure(N + " done", "the actor `" + actor + "` has no valid namespace", [
        "use one of: " + ACTOR_NAMESPACES.map((n) => n + ":<name>").join(" | "),
        "the namespace says how much a vouching is worth, and vouching is the only",
        "thing `manual:` can offer instead of a command.",
      ])
    );
    return 2;
  }

  let status;
  try {
    status = closingStatus(config, plan.status);
  } catch (e) {
    const [head, ...rest] = e.message.split("\n");
    console.error(failure(N + " done", head, rest));
    return 2;
  }

  // The reason is settled BEFORE anything runs (TL-105). A contract that passes
  // and then stops on a missing sentence would have spent the whole run to reach
  // a usage error.
  //
  // WHY THE DEFAULT CLOSING STATUS IS EXEMPT. `done` reaches it by RUNNING the
  // verification and refusing on the first failure, so the why of that transition
  // is a recorded run — kept as `proven`, next to the `__verified__` entries from
  // the same act. Any OTHER archived status is a decision the run does not make:
  // a passing contract says nothing about why a task is being abandoned.
  const provenStatus = (config.archivedStatuses || [])[0];
  const statedReason = plan.reason;
  if (!statedReason && status !== provenStatus && requiresReason(config, { field: "status", to: status })) {
    return refuse(
      plan,
      "closing to `" + status + "` needs `--reason \"…\"`",
      [
        "`reason_required_statuses` in config.yaml names it: " +
          (config.reasonRequiredStatuses || []).join(", ") + ".",
        "",
        "`" + provenStatus + "` is exempt because the verification run proves it. `" + status + "` is not",
        "reached by proving anything — the run says the contract holds, not why the task",
        "is being closed this way, and that why is what nobody can reconstruct later.",
      ],
      [],
      "reason-required"
    );
  }

  const file = findTaskFile(tasksDir, config, plan.id);
  if (!file) return refuse(plan, "there is no task " + plan.id + " in " + tasksDir, [], [], "no-such-task");

  const raw = readFileSync(file, "utf8");
  const { frontmatter, body } = splitFrontmatter(raw);
  const before = extractMeta(frontmatter);

  if ((config.archivedStatuses || []).indexOf(before.status) >= 0) {
    return refuse(plan, plan.id + " is already closed (`status: " + before.status + "`)", [
      "Nothing was run. Re-running a contract against a tree that has moved on",
      "would answer a different question than the one that closed this task.",
    ], [], "already-closed");
  }

  const { entries, problems } = parseVerification(frontmatter);
  const contract = contractProblem(entries, problems);
  if (contract) {
    return refuse(plan, plan.id + " has no closing contract", contract.split("\n"), [], "no-contract");
  }

  // A BROKEN criterion link fails before anything runs: it can only have been
  // written by somebody already using the mechanism, so it is a mistake to fix,
  // not a legacy task to be lenient with (TL-86).
  const audit = auditTask({ frontmatter, body, policy: config.criteriaLinks });
  if (audit.errors.length) {
    return refuse(
      plan,
      plan.id + ": the acceptance criteria and the verification do not agree",
      audit.errors.concat([
        "",
        "Nothing was run. Under `criteria_links: " + config.criteriaLinks + "` this is a refusal",
        "BEFORE the contract, not after it — running commands to then reject the result",
        "would spend the time and answer nothing.",
      ]),
      [],
      "criteria"
    );
  }

  const cwd = repoRootFor(root);

  log(plan.json, "");
  log(plan.json, "  " + plan.id + " — " + entries.length + " verification entr" +
    (entries.length === 1 ? "y" : "ies") + ", run in " + cwd);
  log(plan.json, "");

  // ONE runner, shared with `check --proofs` (TL-147). What differs between the
  // two callers is the narration and the question put to a person, so those are
  // the callbacks; the loop, the order and the stop-at-first-failure are not
  // this command's private behaviour any more.
  const tagOf = (e, i) => "  " + (i + 1) + "/" + entries.length + "  " + (e.id ? e.id + "  " : "");
  let stop = null;
  const { results, failed } = runContract(entries, cwd, {
    capture: plan.json,
    before: (e, i) => log(plan.json, tagOf(e, i) + "bash: " + e.bash),
    after: (e, r) => {
      log(plan.json, "  " + OKM + " passed (" + r.ms + " ms)");
      log(plan.json, "");
    },
    manual: (e, i) => {
      // The text is printed BEFORE anything is asked, and the entry is named as
      // manual, so nobody confirms a sentence they have not read.
      log(plan.json, tagOf(e, i) + "manual");
      log(plan.json, manualPrompt(e, actor));
      let confirmed = plan.confirmManual;
      if (!confirmed && plan.json) {
        // Asking a person for consent while the output is being parsed by a
        // program is incoherent, and the prompt would land in the middle of the
        // JSON besides. `--json` has to say so rather than produce broken output.
        stop = {
          kind: "manual-needs-person",
          headline: plan.id + ": `--json` cannot ask a person to vouch for a `manual:` entry",
          details: [
            "  " + e.manual,
            "",
            "Run it without `--json` and type `" + CONFIRM_WORD + "`, or pass `--confirm-manual`",
            "if you are vouching for it yourself.",
          ],
          refuse: true,
        };
        return { ok: false };
      }
      if (!confirmed) {
        const answer = askLine("  type `" + CONFIRM_WORD + "` to vouch, anything else to stop: ");
        confirmed = answer === CONFIRM_WORD;
        if (answer === null) {
          stop = {
            headline: plan.id + ": a `manual:` entry needs a person, and there is no terminal here",
            details: [
              "Nothing was changed. Two ways on:",
              "  · run it in a terminal and type `" + CONFIRM_WORD + "` when asked;",
              "  · or pass `--confirm-manual`, which vouches for EVERY manual entry at once",
              "    and records " + actor + " as the one who did.",
            ],
          };
          return { ok: false };
        }
      }
      if (!confirmed) {
        stop = { headline: plan.id + ": not vouched for — the task file was not touched", details: [] };
        return { ok: false, vouchedBy: actor };
      }
      log(plan.json, "  " + OKM + " vouched for by " + actor);
      log(plan.json, "");
      return { ok: true, vouchedBy: actor };
    },
  });

  if (stop && stop.refuse) return refuse(plan, stop.headline, stop.details, results, stop.kind);
  if (stop) {
    console.error("");
    console.error(failure(N + " done", stop.headline, stop.details));
    return finishFailed(plan, results, 1);
  }
  if (failed) {
    if (plan.json && failed.output) process.stderr.write(failed.output);
    console.error("");
    console.error(
      failure(N + " done", plan.id + ": verification failed (exit " + failed.exitCode + ")", [
        "`" + failed.entry.bash + "`",
        "",
        "The task file was NOT touched — its status is still `" + before.status + "`.",
      ])
    );
    return finishFailed(plan, results, 1);
  }

  // Every entry is green. Tick what that proves, then refuse if anything is left
  // unproved — a task closed with a dead checkbox is the defect measured in
  // TL-86 (12 of 44 closed tasks, 60 dead checkboxes).
  const passed = results.filter((r) => r.ok && r.id).map((r) => r.id);
  const proofed = applyProofs(raw, passed);
  const remaining = parseCriteria(splitFrontmatter(proofed.text).body).items.filter((c) => !c.checked);

  // Under `require` a criterion naming no proof was already refused ABOVE, before
  // anything ran. What is left here is the other half: a criterion that names
  // proofs which ALL passed and is still unticked. That cannot happen while the
  // runner and `applyProofs` agree about what passed — which is exactly why it is
  // checked. A gate that trusts its own bookkeeping is a gate with a blind spot.
  const inconsistent = remaining.filter((c) => c.proofs.length && c.proofs.every((pid) => passed.indexOf(pid) >= 0));
  if (inconsistent.length) {
    return refuse(
      plan,
      plan.id + ": a criterion whose every proof passed was not ticked",
      inconsistent.map((c) => "  · " + c.text).concat([
        "",
        "This is a defect in the tool, not in the task: the run and the ticking disagree.",
        "The task file was NOT touched.",
      ]),
      results,
      "internal"
    );
  }
  if (remaining.length) {
    log(plan.json, "  " + WARNM + " " + remaining.length + " criteri" +
      (remaining.length === 1 ? "on names" : "a name") + " no proof — closed anyway (criteria_links: " +
      config.criteriaLinks + ")");
  }

  if (plan.dryRun) {
    log(plan.json, "");
    log(plan.json, "  " + OKM + " the whole contract passed. `--dry-run`: nothing was changed.");
    log(plan.json, "    would set: status " + before.status + " → " + status);
    log(plan.json, "    would tick: " + (proofed.ticked.length || "no") + " criteri" +
      (proofed.ticked.length === 1 ? "on" : "a"));
    if (plan.json) answer(plan, results, { status: before.status, wouldBe: status, ticked: proofed.ticked, closed: false });
    return 0;
  }

  // The frontmatter is written through `task-fields.mjs`, the same door `take`
  // uses, and NOT with a regex over the whole file. Two behaviours are the
  // reason, both observed: `^status: .*$` erases a trailing comment the reader
  // put beside the value (TL-70 says a comment is a comment in every reader),
  // and on a task whose frontmatter lacks the field the replacement matches
  // nothing and silently writes nothing — a closed task with no `updated:` and
  // an exit code of 0. The setter edits inside the frontmatter, keeps the
  // comment and INSERTS a missing field in its ordered place.
  const day = today();
  const specs = buildFieldSpecs(config);
  let text = proofed.text;
  try {
    text = setFrontmatterField(text, "status", status, fieldSpec("status", specs));
    text = setFrontmatterField(text, "updated", day);
  } catch (e) {
    return refuse(
      plan,
      plan.id + ": the whole contract passed, but the task file could not be written",
      [e.message, "", "The task file was NOT touched — its status is still `" + before.status + "`."],
      results,
      "unwritable"
    );
  }
  writeFileSync(file, text, "utf8");

  const after = extractMeta(splitFrontmatter(text).frontmatter);
  recordEdit(root, {
    taskId: before.id, before, after, actor, source: "done",
    reason: statedReason || REASON_PROVEN,
  });

  // The vouching is an EVENT, not a field change, so it does not come out of
  // diffMeta and has to be written on purpose. Without it a `manual:` entry would
  // leave no trace of who stood behind it, which is the only thing it has to
  // offer instead of a command.
  const vouched = results.filter((r) => r.kind === "manual" && r.ok);
  if (vouched.length) {
    const ts = new Date().toISOString();
    appendEntries(root, before.id, vouched.map((v) => ({
      id: eventId(ts), ts, task: before.id, field: FIELD_VERIFIED,
      from: "", to: v.command, actor, source: "done",
      reason: statedReason || REASON_PROVEN,
    })));
  }

  log(plan.json, "");
  log(plan.json, "  " + OKM + " " + plan.id + " closed — status " + before.status + " → " + status);
  if (proofed.ticked.length) {
    log(plan.json, "    ticked " + proofed.ticked.length + " criteri" + (proofed.ticked.length === 1 ? "on" : "a") + " from the run");
  }

  // The reservation `take` made is over: the task is closed, so holding it would
  // only make the state directory grow. Best effort — the lock has a TTL, and a
  // failure here must not turn a finished piece of work into an error.
  releaseLock({ root, taskId: before.id, actor });

  const build = spawnSync(process.execPath, [join(__dirname, "build-backlog.mjs"), "--dir", root], {
    encoding: "utf8",
  });
  if (build.status !== 0) {
    console.error(WARNM + " the views were not rebuilt — run `" + N + " build` yourself");
  }

  if (plan.json) answer(plan, results, { status, ticked: proofed.ticked, closed: true });
  return 0;
}

// A prose line summarising the run USED to be appended to a `## Log` section
// here (TL-105). It is gone, and not because it was wrong: it was a SECOND
// copy of what the history already held, kept by hand in a file, and a second
// copy is the thing this tool refuses everywhere else. The run now leaves its
// record in one place — the history entries written just above, carrying the
// reason, the actor and the vouched-for `manual:` entries.
//
// Sections that already exist in older task files are left alone. They hold
// sentences nobody can reconstruct, and deleting a person's writing to tidy up a
// convention would cost more than the tidiness is worth.

/** The answer, in the envelope every other command uses (TL-119). The kind is
 *  `verification-run` and not `task-done`, because what a consumer reads here is
 *  the EVIDENCE — `--dry-run` produces the same payload with `closed: false`. */
function answer(plan, results, extra) {
  printJson("verification-run", {
    task: plan.id,
    ok: results.every((r) => r.ok),
    dryRun: plan.dryRun,
    entries: results,
    ...extra,
  });
}

function finishFailed(plan, results, code) {
  if (plan.json) answer(plan, results, { closed: false });
  return code;
}

if (process.argv[1] && process.argv[1].endsWith("done-task.mjs")) {
  process.exit(run(process.argv.slice(2)));
}

export { run };
