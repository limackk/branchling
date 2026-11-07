#!/usr/bin/env node
/**
 * `jira-proof` — the proof of each task closed in a range, as one comment per
 * Jira ticket (TL-582).
 *
 * WHAT IT IS FOR. Jira keeps the request and the conversation; the repository
 * keeps execution, status and proof. Atlassian's own GitHub integration already
 * puts branches, commits and pull requests on a ticket. What Jira cannot see is
 * the verification contract and the record of the run that closed the task, so
 * that is the whole of what this command says — it never transitions a ticket
 * and never reads one.
 *
 * WHERE THE DECISIONS LIVE. All of them here, none in the CI job, by the rule
 * `pr-summary` set (TL-89): which tasks entered the closed status in the range,
 * which of them came from Jira, and what the comment says. The job in
 * `examples/jira-proof.yml` is checkout, run, post. This command makes no
 * network request; the credentials never pass through it.
 *
 * A NEW COMMAND, NOT A MODE OF `pr-summary`. `pr-summary` answers a reviewer
 * about a BRANCH (`<base>...HEAD`, every task touched, markdown); this answers a
 * ticket about a PUSH (only closings, only Jira-linked tasks, Atlassian
 * Document Format). Folding one into the other would give `pr-summary --json`
 * two consumers that want different tasks out of the same range.
 *
 * THE SOURCES, both git and the task file, never a view:
 *
 *   which closings  the lines ADDED to `history/*.jsonl` in `<base>..HEAD`. A
 *                   task is reported when the LAST status record the range
 *                   added lands on a status whose role is `closed` — a task
 *                   closed and reopened within one push has no standing proof.
 *   which ticket    the `Imported from Jira: <site>/browse/<KEY>` line that
 *                   `import --from jira` writes (TL-581). It is a contract: the
 *                   pattern is that module's own `SOURCE_MARKER`.
 *   what it proves  the task's `verification:` entries with the acceptance
 *                   criteria naming them, read by the reader `show --json`
 *                   uses (TL-561), and the closing record itself, including its
 *                   `contractCapability` verdict.
 *
 * NOTHING IS DROPPED SILENTLY. A closed task with no Jira marker, with a marker
 * that is not a browse URL, whose file is gone, or whose marker names a site
 * other than `--site`, is listed under `skipped` with its reason.
 *
 * THE BODY IS ADF, EMITTED HERE. The v3 comment endpoint takes Atlassian
 * Document Format. Wrapping plain text in the job would either post one
 * unformatted paragraph — the list of checks and their commands run together —
 * or put a converter into YAML, which is a decision living in every consumer's
 * copy. `text` carries the same comment for a terminal and for anything that is
 * not Jira Cloud.
 *
 * ONE COMMENT PER TASK, ONCE. Each comment ends in `marker`, a literal keyed on
 * `BLOCK_MARKER_NAME` and the task id. The job looks for it among the ticket's
 * comments before posting, so a re-run over the same range posts nothing.
 * `BLOCK_MARKER_NAME` and not the display name: the string identifies comments
 * that already exist in somebody's Jira, and a rename must not post a second.
 *
 * Exit: 0 = answered (including "nothing to post") · 2 = the invocation was wrong.
 *
 * Tests: `node --test scripts/tests/jira-proof.test.mjs`
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { repoRelative } from "./canonical-path.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { SOURCE_MARKER } from "./import-jira.mjs";
import { printJson } from "./json-envelope.mjs";
import { repoRoot } from "./modified-files.mjs";
import { answerBacklogDirRefusal, backlogPaths, isBacklogDirRefusal, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { addedHistoryEntries } from "./pr-summary.mjs";
import { BLOCK_MARKER_NAME, PRODUCT_NAME as N } from "./product.mjs";
import { verificationContractOf } from "./show-task.mjs";
import { extractMeta, splitFrontmatter } from "./task-fields.mjs";
import { listTaskFileNames } from "./task-io.mjs";
import { refusal } from "./ui.mjs";
import { statusEntries } from "./vocabulary.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const COMMAND = N + " jira-proof";
const AVAILABLE = "--base <ref> --site <url> --json --dir <path>";

// The usage text lives in the command table in `cli.mjs`, which prints it for
// `--help`; a second copy here would be a second place for it to go stale.

// ──────────────────────────────────────────────────────────────────────────
// Arguments — PURE
// ──────────────────────────────────────────────────────────────────────────

/** `<site>` as one comparable string: origin plus path, no trailing slash. */
export function normalizeSite(raw) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.search || url.hash) return null;
  return url.origin + url.pathname.replace(/\/+$/, "");
}

export function parseJiraProofArgs(args) {
  let base = null;
  let site = null;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") { json = true; continue; }
    if (a === "--base") {
      base = args[++i];
      if (!base) throw new Error("`--base` with no ref");
      // It is handed to `git diff` as an argument of its own, where a leading
      // dash would be read as an option of git's rather than as a ref.
      if (base.startsWith("-")) throw new Error("`--base " + base + "` is not a ref");
      continue;
    }
    if (a === "--site") {
      const value = args[++i];
      if (!value) throw new Error("`--site` with no URL");
      site = normalizeSite(value);
      if (!site) throw new Error("`--site " + value + "` is not an http(s) URL of a Jira site");
      continue;
    }
    if (a.startsWith("-")) throw new Error("unknown flag: " + a);
    throw new Error("unexpected argument: " + a);
  }
  if (!base) throw new Error("`--base <ref>` is required — without it the range on `main` would be empty and look answered");
  return { base, site, json };
}

// ──────────────────────────────────────────────────────────────────────────
// Reading one task — PURE
// ──────────────────────────────────────────────────────────────────────────

// The marker is matched as a literal: `SOURCE_MARKER` holds no character a
// regular expression reads as syntax.
const MARKER_LINE = new RegExp("^" + SOURCE_MARKER + "(\\S+)\\s*$", "m");

/** A Jira issue key: a project key that starts with a letter, a number. */
const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-[1-9]\d*$/;

/**
 * The ticket a task file names, or why it names none.
 *
 * @returns {{ok: true, url: string, site: string, key: string} |
 *           {ok: false, reason: "no-jira-marker"|"malformed-jira-marker"}}
 */
export function jiraTicketOf(text) {
  const m = text.match(MARKER_LINE);
  if (!m) return { ok: false, reason: "no-jira-marker" };
  const url = m[1];
  const parts = url.match(/^(.+)\/browse\/([^/]+)$/);
  const site = parts && normalizeSite(parts[1]);
  if (!site || !ISSUE_KEY.test(parts[2])) return { ok: false, reason: "malformed-jira-marker" };
  return { ok: true, url, site, key: parts[2] };
}

/**
 * The record that closed a task in this range, or `null`.
 *
 * The LAST status record the range added decides. Any earlier closing in the
 * same range was undone before the push ended, and a comment saying "closed"
 * on a task that is open again would be the one claim this command exists to
 * keep honest.
 */
export function closingRecord(entries, closedStatuses) {
  const moves = entries.filter((e) => e.field === "status");
  const last = moves[moves.length - 1];
  return last && closedStatuses.indexOf(last.to) >= 0 ? last : null;
}

/** The marker a comment for this task ends in. Bracketed, so the marker of
 *  `TL-58` is not a prefix of the marker of `TL-582`. */  // renumber: allow
export function commentMarker(id) {
  return "[" + BLOCK_MARKER_NAME + "-proof:" + id + "]";
}

// ──────────────────────────────────────────────────────────────────────────
// The comment — PURE. One block model, rendered twice, so the ADF and the
// plain text cannot say different things.
// ──────────────────────────────────────────────────────────────────────────

const OBSERVED_SOURCES = ["external", "manual", "boot"];

/**
 * What the closing record says about whether the checks RAN. A `proven`
 * closing means the command checks ran; a `manual:` entry in the same contract
 * was vouched for at that closing, never run, so the sentence is drawn from
 * the contract as well as the record and never claims more than ran.
 * @param {object} record the history record that closed the task
 * @param {Array<{bash: string|null}>} verification the task's verification entries
 */
export function closingSentence(record, verification) {
  if (record.reason === "proven") {
    const commands = verification.filter((v) => v.bash).length;
    if (commands === verification.length && commands) return "every check below ran and passed.";
    if (commands) {
      return "every command check below ran and passed; the ones checked by a person were vouched for, not run.";
    }
    return verification.length
      ? "the checks below were vouched for by a person; none of them is a command, so none was run."
      : "the closing is recorded as proven, but no check is declared, so nothing was run.";
  }
  if (record.reason === "unknown" || !record.reason) {
    return OBSERVED_SOURCES.indexOf(record.source) >= 0
      ? "the status was changed outside the tool, so no run of the checks below is recorded."
      : "no reason was stated, and no run of the checks below is recorded.";
  }
  return "the stated reason is “" + record.reason + "”; no run of the checks below is recorded.";
}

/**
 * @returns {Array<object[] | {items: object[][]}>} a paragraph is an array of
 *   parts, a bullet list is `{items}`; a part is `{text, strong?, code?}`
 */
export function commentBlocks(c) {
  const t = (text, extra) => ({ text: String(text), ...extra });
  const rec = c.closing;
  const blocks = [
    [t("Backlog task "), t(c.task, { strong: true }), t(" was closed in the repository: " + (c.title || "(no title)"))],
    [
      t("Closed by " + rec.actor + " at " + rec.ts + ", "),
      t(rec.from || "(new)", { code: true }), t(" \u2192 "), t(rec.to, { code: true }),
      t(": " + closingSentence(rec, c.verification)),
    ],
  ];
  if (rec.contractCapability && rec.contractCapability.verdict) {
    blocks.push([
      t("Contract capability: "), t(rec.contractCapability.verdict, { strong: true }),
      t(rec.contractCapability.statement ? " \u2014 " + rec.contractCapability.statement + "." : "."),
    ]);
  }
  if (c.verification.length) {
    blocks.push([t("Verification", { strong: true })]);
    blocks.push({ items: c.verification.map((v) => [
      t(v.id || "(no id)", { code: true }), t(": "),
      v.bash ? t(v.bash, { code: true }) : t("checked by a person, not run: " + v.manual),
      t(v.criteria.length
        ? " \u2014 proves: " + v.criteria.map((x) => x.text).join("; ")
        : " \u2014 no acceptance criterion names this check"),
    ]) });
  } else {
    blocks.push([t("This task declares no verification.")]);
  }
  for (const v of c.vouched) {
    blocks.push([
      t("Vouched for by " + v.actor + ": "), t(v.command, { code: true }),
      t(" \u2014 a person stood behind this; no command checked it."),
    ]);
  }
  blocks.push([t(c.marker)]);
  return blocks;
}

export function renderText(blocks) {
  const line = (parts) => parts.map((p) => (p.code ? "`" + p.text + "`" : p.text)).join("");
  return blocks.map((b) => (Array.isArray(b)
    ? line(b)
    : b.items.map((parts) => "- " + line(parts)).join("\n"))).join("\n\n") + "\n";
}

/** Atlassian Document Format, version 1. An empty text node is invalid ADF, so
 *  none is ever written. */
export function renderAdf(blocks) {
  const inline = (parts) => parts.filter((p) => p.text).map((p) => {
    const marks = [];
    if (p.strong) marks.push({ type: "strong" });
    if (p.code) marks.push({ type: "code" });
    return marks.length ? { type: "text", text: p.text, marks } : { type: "text", text: p.text };
  });
  const paragraph = (parts) => ({ type: "paragraph", content: inline(parts) });
  return {
    type: "doc",
    version: 1,
    content: blocks.map((b) => (Array.isArray(b)
      ? paragraph(b)
      : { type: "bulletList", content: b.items.map((parts) => ({ type: "listItem", content: [paragraph(parts)] })) })),
  };
}

/** One task's comment, with the data it was written from. PURE. */
export function proofComment({ id, title, ticket, closing, contract, vouched }) {
  const c = {
    task: id,
    title: title || null,
    key: ticket.key,
    site: ticket.site,
    url: ticket.url,
    marker: commentMarker(id),
    closing,
    verification: contract.verification,
    verificationProblems: contract.verificationProblems,
    vouched,
  };
  const blocks = commentBlocks(c);
  return { ...c, text: renderText(blocks), adf: renderAdf(blocks) };
}

// ──────────────────────────────────────────────────────────────────────────
// The run
// ──────────────────────────────────────────────────────────────────────────

function git(cwd, args) {
  return spawnSync("git", args, { cwd, encoding: "utf8", timeout: 120_000, maxBuffer: 128 * 1024 * 1024 });
}

/** Task ids in NUMBER order, so `-2` comes before `-10`. PURE. */
export function compareTaskIds(a, b) {
  return Number(a.split("-").pop()) - Number(b.split("-").pop()) || a.localeCompare(b);
}


/**
 * @returns {{base: string, site: string|null, scanned: boolean, reason: string,
 *            closedStatuses: string[], comments: object[], skipped: object[]}}
 */
export function buildProof({ root, config, base, site = null, run = git }) {
  const closedStatuses = statusEntries(config).filter((s) => s.role === "closed").map((s) => s.name);
  const answer = { base, site, scanned: false, closedStatuses, comments: [], skipped: [] };
  const repo = repoRoot(root);
  if (!repo) return { ...answer, reason: "not a git repository — there is no range to read closings from" };

  const paths = backlogPaths(root);
  const historyRel = repoRelative(repo, paths.historyDir);
  const diff = run(repo, ["diff", "--unified=0", base, "HEAD", "--", historyRel]);
  if (diff.status !== 0) {
    return {
      ...answer,
      reason: "`git diff " + base + " HEAD` failed — is `" + base + "` a commit this clone has? " +
        "On CI a shallow checkout often does not.",
    };
  }

  const byTask = addedHistoryEntries(diff.stdout);
  // Each id to its file by the id the FILENAME carries, exactly — a prefix
  // match would hand `-1` the file of `-10`.
  const files = new Map(listTaskFileNames(paths.tasksDir, config)
    .map((f) => [f.match(config.taskId.fileId)[1], join(paths.tasksDir, f)]));
  const ids = [...byTask.keys()].sort(compareTaskIds);
  const comments = [];
  const skipped = [];
  for (const id of ids) {
    const entries = byTask.get(id);
    const closing = closingRecord(entries, closedStatuses);
    if (!closing) continue;
    const file = files.get(id);
    if (!file) { skipped.push({ task: id, reason: "no-task-file" }); continue; }
    const text = readFileSync(file, "utf8");
    const ticket = jiraTicketOf(text);
    if (!ticket.ok) { skipped.push({ task: id, reason: ticket.reason }); continue; }
    if (site && ticket.site !== site) { skipped.push({ task: id, reason: "other-site", site: ticket.site }); continue; }
    comments.push(proofComment({
      id,
      title: extractMeta(splitFrontmatter(text).frontmatter).title,
      ticket,
      closing,
      contract: verificationContractOf(text),
      vouched: entries.filter((e) => e.field === "__verified__").map((e) => ({ command: e.to, actor: e.actor })),
    }));
  }
  return { ...answer, scanned: true, reason: "ok", comments, skipped };
}

const SKIP_WORDS = {
  "no-jira-marker": "no `" + SOURCE_MARKER.trim() + "` line",
  "malformed-jira-marker": "its Jira line is not a browse URL",
  "no-task-file": "its task file is not in this tree",
  "other-site": "its ticket is on another Jira site",
};

export function renderReport(model) {
  if (!model.scanned) return model.reason + "\n";
  const out = [];
  if (!model.comments.length) {
    out.push("Nothing to post: no Jira-linked task entered the closed status between `" + model.base + "` and HEAD.");
  }
  for (const c of model.comments) {
    out.push("── " + c.task + " → " + c.key + "  " + c.url + "\n\n" + c.text);
  }
  if (model.skipped.length) {
    out.push("skipped " + model.skipped.length + " closed task(s):\n" +
      model.skipped.map((s) => "  " + s.task + "  " + SKIP_WORDS[s.reason] + "\n").join(""));
  }
  return out.join("\n").replace(/\n*$/, "\n");
}

export function main(argv) {
  const cli = takeDirFlag(argv);
  let opts;
  try {
    opts = parseJiraProofArgs(cli.argv);
  } catch (e) {
    console.error(refusal(COMMAND, e.message, AVAILABLE));
    return 2;
  }

  let root;
  try {
    root = resolveBacklogDir({ dir: cli.dir, moduleDir: HERE }).root;
  } catch (e) {
    if (!isBacklogDirRefusal(e)) throw e;
    return answerBacklogDirRefusal(e, { command: COMMAND, jsonKind: opts.json ? "jira-proof" : null, hints: [`${N} jira-proof --dir <path>`] });
  }
  const config = loadConfigOrExit(root);
  const model = buildProof({ root, config, base: opts.base, site: opts.site });

  if (opts.json) {
    printJson("jira-proof", model);
    return 0;
  }
  process.stdout.write(renderReport(model));
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("jira-proof.mjs")) {
  process.exitCode = main(process.argv.slice(2));
}
