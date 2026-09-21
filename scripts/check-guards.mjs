/**
 * The guards `check` runs, as data — and what each may do to a release verdict.
 *
 * WHY ITS OWN MODULE (TL-383). The table was inside the dispatcher, which was
 * right while `check` was its only reader. `audit` is now the second: the
 * guards that report and cannot fail moved under it, and it runs THEM rather
 * than reimplementing their findings, because two implementations of one
 * finding is the defect this table was extracted to prevent in the first place
 * (TL-57: two lists of eleven guards would differ the first time somebody added
 * a twelfth). A shared table has one reader more and still one definition.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PRODUCT_NAME as N } from "./product.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The guards, as data (TL-57).
 *
 * WHY A TABLE AND NOT ELEVEN `if` BLOCKS, which is what this was. `check --json`
 * has to run the same set the text mode runs, and two lists of eleven guards
 * would differ the first time somebody added a twelfth to one of them — silently,
 * because the JSON consumer has no way to notice a guard that is not there.
 *
 * `args` IS A FUNCTION BECAUSE THE INPUT CONVENTIONS GENUINELY DIFFER, and the
 * discrepancy stays on the dispatcher's side rather than being normalised into
 * eleven guards: one takes the tasks directory positionally, most take the
 * backlog directory through `--dir`, and two take nothing at all.
 */
export const CHECK_GUARDS = [
  // An id collision is a property of the SET, so this one reads the whole tree.
  { key: "ids", severity: "gate", want: "wantIds", name: "id-collisions", script: "check-backlog-id-collisions.mjs",
    args: (root, tasksDir) => [tasksDir] },
  // A board is a property of ONE file, so a pre-commit hook can judge the staged
  // files — otherwise my commit would fail because of somebody else's task.
  { key: "boards", severity: "gate", want: "wantBoards", name: "boards", script: "check-backlog-boards.mjs",
    args: (root, tasksDir, files) => (files.length ? files : ["--all", tasksDir]) },
  // A third input convention: the BACKLOG directory through --dir, not the tasks
  // directory positionally.
  { key: "refs", severity: "gate", want: "wantRefs", name: "refs", script: "check-backlog-refs.mjs",
    args: (root) => ["--dir", root] },
  // Judges the SET, and needs the configuration to know which statuses are closed.
  { key: "criteria", severity: "gate", want: "wantCriteria", name: "criteria", script: "check-backlog-criteria.mjs",
    // The ONE guard whose severity is the project's to set rather than ours.
    // `criteria_links` already decides how hard a missing link is judged, and
    // `warn` IS a project saying the finding may not block a release — so
    // reading that key here is honouring a decision already made, not adding
    // a second place to make it.
    advisoryWhen: (config) => config.criteriaLinks !== "require",
    args: (root) => ["--dir", root] },
  // Reads the whole history; the configuration says which statuses require a reason.
  { key: "reasons", severity: "advisory", want: "wantReasons", name: "reasons", script: "check-backlog-reasons.mjs",
    args: (root) => ["--dir", root] },
  // Compares each task against ITSELF — the only guard whose question is entirely
  // inside one file. It needs the configuration twice over: for the statuses that
  // make a log line a status claim at all, and for the archived ones that decide
  // which direction of drift is a defect rather than stale prose.
  { key: "log-status", severity: "advisory", want: "wantLogStatus", name: "log-status", script: "check-backlog-log-status.mjs",
    args: (root) => ["--dir", root] },
  // The only guard whose answer depends on something outside the backlog
  // directory — it asks git — which is why it says so when there is no git.
  // TWO FINDINGS, ONE WALK (TL-383). The gate half — a log left untracked beside
  // a tracked task file — is current and repairable. The other half, a log whose
  // task is on somebody else's branch, is not a defect at all and cannot be
  // repaired from here, so the DEFAULT run asks for the gate alone and `audit`
  // asks for the rest. A caller naming `--history` gets both: they asked the
  // whole question.
  { key: "history", severity: "gate", want: "wantHistory", name: "history", script: "check-backlog-history-tracked.mjs",
    args: (root, tasksDir, files, plan) =>
      ["--dir", root].concat(plan && plan.explicit ? [] : ["--only", "gates"]),
    alsoAdvisory: (root) => ["--only", "advisory", "--dir", root] },
  // The second guard that asks git, and the only one that REPORTS rather than
  // failing (TL-230): a task file whose state has not been committed yet is the
  // normal condition of a session still working, so a red exit here would be
  // red in every tree that is mid-task.
  { key: "task-state", severity: "advisory", want: "wantTaskState", name: "task-state",
    script: "check-backlog-task-state-committed.mjs", args: (root) => ["--dir", root] },
  // Judges the REPOSITORY holding the backlog, not this installation: a
  // `related_docs` entry resolves against the consumer's tree.
  { key: "docs", severity: "gate", want: "wantDocs", name: "docs", script: "check-docs-links.mjs",
    args: (root) => ["--dir", root] },
  // The one guard whose question is entirely the configuration file.
  { key: "vocabulary", severity: "gate", want: "wantVocabulary", name: "vocabulary", script: "check-backlog-vocabulary.mjs",
    args: (root) => ["--dir", root] },
  // The plan is judged against the WHOLE tree; a finished blocker outside the
  // plan is not a gap.
  { key: "plan", severity: "gate", want: "wantPlan", name: "plan", script: "check-backlog-plan.mjs",
    args: (root) => ["--dir", root] },
  // No `--dir` either, and for the same reason. A user's task files may name the
  // tool as often as they like — that is their prose, not our literal.
  { key: "product-name", severity: "gate", want: "wantProductName", name: "product-name", script: "check-product-name.mjs",
    installationOnly: true, args: () => [] },
  // Installation-only for the same reason again (TL-37): the subject is THIS
  // repository's public documents. Somebody else's `docs/` may name whatever
  // company they like — it is their repository, and their decision.
  { key: "foreign-context", severity: "gate", want: "wantForeignContext", name: "foreign-context",
    script: "check-no-foreign-context.mjs", installationOnly: true, args: () => [] },
  // OPT-IN ONLY — see `parseCheckArgs`. It re-runs the contracts of tasks that
  // are already closed, so it costs what those test suites cost.
  { key: "proofs", severity: "gate", want: "wantProofs", name: "proofs", script: "check-backlog-proofs.mjs",
    // The ONE guard outside the default run, and the flag says so in the table
    // rather than in a name a test would have to know — see `parseCheckArgs`.
    optIn: true,
    args: (root, tasksDir, files, plan) => ["--dir", root].concat(plan.since ? ["--since", plan.since] : []) },
];

/**
 * What a guard is allowed to do to a release verdict, under THIS configuration.
 *
 * Severity is a property of the guard TABLE and not of the guard process, so no
 * script's exit contract changes and nothing is classified in two places. The
 * one guard that reads the configuration is `criteria`, and it reads a key the
 * project already uses to say the same thing.
 */
export function effectiveSeverity(guard, config) {
  if (guard.advisoryWhen && guard.advisoryWhen(config)) return "advisory";
  return guard.severity;
}

/**
 * The guards a run executes: a named selector is answered whatever its severity,
 * an unnamed one is a release verdict and carries only what can fail it.
 */
export function guardsForRun(plan, config, table = CHECK_GUARDS) {
  const wanted = table.filter((g) => plan[g.want]);
  if (plan.explicit) return wanted;
  return wanted.filter((g) => effectiveSeverity(g, config) === "gate");
}

/**
 * The guards that report and cannot fail a release, for the command that
 * reports (TL-383).
 *
 * `optIn` is excluded because opting in is a request, and `audit` did not make
 * it: `proofs` re-runs other tasks' contracts, so folding it in here would turn
 * a report into a test run somebody did not ask for.
 */
export function advisoryGuards(config, table = CHECK_GUARDS) {
  return table.filter((g) => !g.optIn && effectiveSeverity(g, config) === "advisory");
}

/**
 * Every advisory finding `audit` has to carry, as a script and the arguments
 * that make it speak: a wholly advisory guard, and the advisory HALF of a gate
 * that happens to compute one.
 */
export function advisoryRuns(config, table = CHECK_GUARDS) {
  const runs = advisoryGuards(config, table).map((g) => ({ name: g.name, script: g.script, args: (root) => g.args(root) }));
  for (const guard of table) {
    if (guard.alsoAdvisory) runs.push({ name: guard.name, script: guard.script, args: guard.alsoAdvisory });
  }
  return runs;
}

/**
 * Run them and keep what they said.
 *
 * The exit code is DISCARDED on purpose rather than forgotten: these guards
 * exit 0 whatever they find — that is what makes them advisory — so a code
 * threaded out of here would be a number that always reads the same and
 * invites somebody to branch on it.
 */
export function collectAdvisories(root, config, table = CHECK_GUARDS) {
  return advisoryRuns(config, table).map((guard) => {
    const r = spawnSync(process.execPath, [join(HERE, guard.script)].concat(guard.args(root)), {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    });
    const output = r.error
      ? "could not start " + guard.script + ": " + r.error.message
      : (String(r.stdout || "") + String(r.stderr || "")).trimEnd();
    return { name: guard.name, output };
  });
}
