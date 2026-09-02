#!/usr/bin/env node
/**
 * The backlog configuration — the vocabularies that are NOT code (BL-1400).
 *
 * The split this file introduces, and the one to hold on to:
 *
 *   CODE knows the SHAPE   — which fields a task has, what type they are, how
 *                            they are written into the frontmatter, how they are
 *                            compared. That is `task-fields.mjs` and the rest of
 *                            the scripts.
 *   CONFIG knows the VALUES — which statuses exist in THIS project, which
 *                            labels, priorities, boards, who counts as an author.
 *
 * Why this is not cosmetic: a set of labels naming one company's release
 * schedule, an `owner` list of two named people and seven statuses are ONE
 * organisation's process. As long as they sit in the code, the module is that
 * organisation's tool rather than a tool. After this change the code does not
 * know that anything like a `pre-launch` label exists — it only knows that
 * `labels` is a list of values from a vocabulary given in the configuration.
 *
 * Format: `config.yaml` in the backlog directory, FLAT keys (a scalar, an inline
 * list, a block list, a block map). The parser is deliberately narrow — the
 * module has no dependencies, and "almost YAML" breaks worse than a parser that
 * simply does not find a field. The board registry stays in `boards.yaml` (it
 * has its own guard and its own documentation); this module joins the two into
 * ONE object, so that the rest of the code sees a single source.
 *
 * No `config.yaml` means DEFAULTS. That is deliberate: a fresh repository has to
 * work without a configuration file, and the default vocabularies are generic —
 * they are not copied from any particular project.
 *
 * Tests: `node --test scripts/tests/config.test.mjs`
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";

import { backlogPaths } from "./paths.mjs";
import { PRODUCT_NAME } from "./product.mjs";
import { DEFAULT_TASK_ID_PREFIX, PREFIX_SHAPE, inferPrefix, taskIdPatterns } from "./task-id.mjs";
import { ACTOR_NAMESPACES, ROLE_SHAPE, isValidActor } from "./task-fields.mjs";
import { LINK_POLICIES } from "./criteria.mjs";
import { DEFAULT_LOCK_TTL_MINUTES } from "./lock.mjs";
import { USER_KEYS, loadUserConfig } from "./home.mjs";

// ──────────────────────────────────────────────────────────────────────────
// Default values — generic, for a fresh repository
// ──────────────────────────────────────────────────────────────────────────

export const DEFAULTS = Object.freeze({
  project_name: "Backlog",
  // The task number prefix. A project value, not a fact about the code (BL-1452).
  task_id_prefix: DEFAULT_TASK_ID_PREFIX,
  statuses: ["pending", "in_progress", "blocked", "done", "cancelled"],
  archived_statuses: ["done", "cancelled"],
  priorities: ["P0", "P1", "P2", "P3"],
  types: ["task"],
  confidence: ["high", "medium", "low"],
  labels: [],                 // empty means an open, empty vocabulary
  labels_closed: false,
  // WHO MAY take a task, as opposed to who holds it now (TL-97). The
  // vocabulary is the project's: a team with no analyst simply does not declare
  // one. Empty is not "any role is fine" — it says this project does not use
  // roles at all, and then a task carrying a non-empty `role:` FAILS. Silently
  // accepting one would create a phantom role no dispatcher serves, and the task
  // would leave every specialised queue without a word.
  roles: [],
  label_axis_timing: [],      // the "Phase" axis in the viewer filters; empty removes the facet
  label_axis_env: [],         // the "Environment" axis; empty removes the facet
  owners: ["unassigned"],
  estimates: ["30m", "2h", "1d", "1w"],
  actors: ["unknown"],   // namespaces: local: / agent: / user: (BL-1404)
  title_max_length: 60,
  epic_aliases: {},
  // Presentation colours per vocabulary value. No entry means a colour from the
  // cycling palette (in vocabulary order). Kept in the configuration, because
  // "done is green" is a project convention, not a fact about the code.
  status_colors: {},
  // Statuses drawn struck through (the convention: "this will not happen").
  status_strikethrough: [],
  priority_colors: {},
  label_colors: {},
  dashboard_open_statuses: ["pending", "in_progress", "blocked"],
  dashboard_burndown_kind: "board",
  dashboard_burndown_value: "",
  // How hard `check --criteria` judges a task whose acceptance criteria are not
  // linked to the `verification:` entry that proves them (TL-86). A POLICY,
  // not a fact about the code: a backlog that predates the mechanism needs
  // `warn` while it is being linked up, and flips to `require` once it is. A
  // BROKEN link fails under every setting, `off` included.
  criteria_links: "warn",
  // Which statuses may not be entered without a stated reason (TL-105). A
  // VOCABULARY, so it belongs here and not in the code: `blocked` and
  // `cancelled` are this project's words, and a list of literals in a script
  // would be one project's habit imposed on everybody else's backlog.
  //
  // `null` means "not stated", and then it resolves to `archived_statuses` —
  // leaving the queue is the decision whose why is irrecoverable later, and it
  // is the one set of statuses every backlog already declares. A default of `[]`
  // would have made the mechanism opt-in, which is how the `## Log` convention
  // this replaces reached zero enforcement.
  reason_required_statuses: null,
  // Which status means "somebody is working on this" — the one `take` and `next`
  // write (TL-87). `null` means "not stated", and then it resolves to
  // DEFAULT_IN_PROGRESS_STATUS if the project actually has that status. A backlog
  // whose statuses were renamed has to SAY which one this is: a dispatcher
  // picking one by guesswork would write into somebody's tree a value they never
  // chose, and it would do it unattended.
  in_progress_status: null,
  // ── Time measurement (TL-27) ────────────────────────────────────────────
  // The whole set is declared HERE and now, although only `activity_privacy` is
  // read yet: an unknown key FAILS, so adding these one task at a time would be
  // four changes to the schema and four upgrades that reject a config written
  // for the next one.
  //
  // Where the raw heartbeats may go: `local` keeps them out of git (the
  // `.gitignore` block), `shared` versions them. The default is the one that
  // cannot leak somebody's working calendar into a public history by way of one
  // `git add -A`.
  activity_privacy: "local",
  // How long a gap between heartbeats ends a working session, in minutes. The
  // WakaTime model, borrowed deliberately rather than invented.
  idle_gap_minutes: 10,
  // How rarely a source may record a heartbeat, in seconds. A tool firing on
  // every keystroke would measure typing speed, not work.
  heartbeat_throttle_seconds: 60,
  // Below this many samples a report says "not enough" rather than a median of
  // three. A number computed from too little data is read exactly like one that
  // was not.
  min_report_n: 8,
  // How long raw heartbeats are kept, in days. The aggregate outlives them.
  activity_retention_days: 90,
  // After how many days without a recorded change `audit` calls a task in
  // progress PARKED (TL-90). A REPORT's threshold, not a rule: nothing acts on
  // it, unlike `abandoned_after_days`, which hands the task to somebody else.
  //
  // Seven days rather than two, because the number has to survive a weekend and
  // a week off without accusing anybody. A project that works in shorter cycles
  // lowers it; the code knows the shape, this line knows the value.
  audit_stale_days: 7,
  // How long a task reservation is honoured, in minutes (TL-87). A killed
  // session leaves its lockfile behind, and a reservation nobody can release is
  // a task that leaves the queue for good; after this long the lock is stale and
  // the next caller takes it over, saying so.
  lock_ttl_minutes: DEFAULT_LOCK_TTL_MINUTES,
  // After how many days without a change an `in_progress` task is judged
  // ABANDONED and handed out again (TL-104). `0` — the default — means never.
  //
  // OFF by default on purpose. The evidence this reads is `updated:`, which has
  // a day's resolution and is written by commands, not by working: somebody
  // three days into a hard task has touched no field, and a window switched on
  // for them would reassign live work and call it recovery. A queue that runs
  // unattended long enough to need this is a queue whose owner can state the
  // number. The reservation itself is NOT this mechanism — a lock expires in
  // minutes (`lock_ttl_minutes`) and only says that a process died; this key
  // says how long a CLAIM in the tree survives its session.
  abandoned_after_days: 0,
  // Whether reading state consults OTHER branches and worktrees (TL-73).
  //
  // ON by default, and that default is the point: with it off, `query --status
  // pending` offers work that another branch already has `in_progress`, and it
  // does so with no sign that the answer came from one checkout. Off is for a
  // repository whose branch count makes the scan cost more than the answer —
  // a deliberate, stated narrowing rather than a silent one.
  cross_branch_state: true,
  // How far back a branch's last commit may be for the scan to read it, in days.
  // `0` means no window at all. Dead branches accumulate without limit, and a
  // scan proportional to a repository's whole history would be paid for on every
  // listing. A branch CHECKED OUT in a worktree is always read whatever its age:
  // somebody is standing in it.
  active_branch_days: 30,
});

/** The word the DEFAULT vocabulary uses for work in progress. Not a fact about
 *  any project — see `in_progress_status`. */
export const DEFAULT_IN_PROGRESS_STATUS = "in_progress";

/** The keys allowed in config.yaml. An unknown key FAILS — a typo in a
 *  vocabulary is indistinguishable from "that is how this project does it", and
 *  it costs exactly as much as a typo in a CLI flag (see query.mjs). */
const KNOWN_KEYS = Object.keys(DEFAULTS);

const LIST_KEYS = new Set([
  "statuses", "archived_statuses", "priorities", "types", "confidence",
  "labels", "label_axis_timing", "label_axis_env", "owners", "estimates", "actors", "roles",
  "dashboard_open_statuses", "status_strikethrough", "reason_required_statuses",
]);
const MAP_KEYS = new Set(["epic_aliases", "status_colors", "priority_colors", "label_colors"]);
const NUMBER_KEYS = new Set([
  "title_max_length", "lock_ttl_minutes", "active_branch_days", "abandoned_after_days",
  "idle_gap_minutes", "heartbeat_throttle_seconds", "min_report_n", "activity_retention_days",
  "audit_stale_days",
]);
const BOOL_KEYS = new Set(["labels_closed", "cross_branch_state"]);

// ──────────────────────────────────────────────────────────────────────────
// The narrow parser
// ──────────────────────────────────────────────────────────────────────────

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

function unquote(s) {
  const v = String(s == null ? "" : s).trim();
  if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

/** Levenshtein, small enough not to pull in a dependency for a single hint. It
 *  is sufficient: we are comparing short identifiers, not sentences. */
function editDistance(a, b) {
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** The nearest known key, or null when nothing is close enough. The threshold
 *  grows with the length of the name — `types` and `owners` must not be confused
 *  with each other, while `dashboard_open_statuses` missing one letter should
 *  still be recognised. */
function nearestKey(key) {
  const limit = Math.max(2, Math.floor(key.length / 4));
  let best = null;
  let bestScore = Infinity;
  for (const known of KNOWN_KEYS) {
    const d = editDistance(key, known);
    if (d < bestScore) { bestScore = d; best = known; }
  }
  return bestScore <= limit ? best : null;
}

/**
 * @returns {{values: Record<string, unknown>, problems: string[]}}
 */
export function parseConfigYaml(text) {
  const values = {};
  const problems = [];
  const lines = String(text || "").split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const raw = stripComment(lines[i]);
    if (!raw.trim()) continue;
    if (/^\s/.test(raw)) continue;              // a block body — read by the key above

    const m = raw.match(/^([a-z_][a-z0-9_]*):\s*(.*)$/);
    if (!m) {
      problems.push(`line ${i + 1}: cannot read \`${raw.trim()}\` (expecting \`key: value\`)`);
      continue;
    }
    const key = m[1];
    const inline = m[2].trim();

    if (KNOWN_KEYS.indexOf(key) < 0) {
      // A suggestion instead of a list of thirty keys: a typo is the most common
      // cause, and `statusess` next to `statuses` answers the question at once.
      // The full list is printed only when nothing is similar — at that point the
      // user really is looking for a name, not for their own mistake.
      const near = nearestKey(key);
      problems.push(
        near
          ? `line ${i + 1}: unknown key \`${key}\` — did you mean \`${near}\`?`
          : `line ${i + 1}: unknown key \`${key}\` (allowed: ${KNOWN_KEYS.join(", ")})`
      );
      continue;
    }

    // A block body is the indented lines that follow.
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const next = stripComment(lines[j]);
      if (!next.trim()) continue;
      if (!/^\s/.test(next)) break;
      body.push(next.trim());
    }

    if (MAP_KEYS.has(key)) {
      const map = {};
      for (const entry of body) {
        const em = entry.match(/^(.+?):\s*(.*)$/);
        if (!em) { problems.push(`${key}: cannot read the entry \`${entry}\``); continue; }
        map[unquote(em[1])] = unquote(em[2]);
      }
      values[key] = map;
      i = j - 1;
      continue;
    }

    if (LIST_KEYS.has(key)) {
      let items;
      if (inline.startsWith("[")) {
        items = inline.replace(/^\[|\]$/g, "").split(",").map(unquote).filter(Boolean);
      } else if (body.length) {
        items = body.map((l) => unquote(l.replace(/^-\s*/, ""))).filter(Boolean);
        i = j - 1;
      } else if (inline) {
        items = [unquote(inline)];
      } else {
        items = [];
      }
      values[key] = items;
      continue;
    }

    if (NUMBER_KEYS.has(key)) {
      const n = Number(unquote(inline));
      if (!Number.isFinite(n)) problems.push(`${key}: \`${inline}\` is not a number`);
      else values[key] = n;
      continue;
    }

    if (BOOL_KEYS.has(key)) {
      const v = unquote(inline).toLowerCase();
      if (v !== "true" && v !== "false") problems.push(`${key}: expecting true/false, got \`${inline}\``);
      else values[key] = v === "true";
      continue;
    }

    values[key] = unquote(inline);
  }

  return { values, problems };
}

// ──────────────────────────────────────────────────────────────────────────
// The board registry (boards.yaml) — one parser instead of three
// ──────────────────────────────────────────────────────────────────────────

/**
 * The supported shape is deliberately exactly the one in boards.yaml:
 * `default:`, `ignore_paths:` and a flat list of `- slug:` blocks with optional
 * `name:` and `paths:`. Until BL-1400 the same shape was read by three
 * independent parsers (build-backlog, build-viewer, check-backlog-boards) — a
 * comment in the guard called that outright "the price of having no
 * dependencies". The price was the risk of them drifting apart.
 */
export function parseBoardsYaml(text) {
  // Comments are stripped LINE BY LINE up front, because everything below reads
  // this file with regexes over the whole text and each of them would otherwise
  // need its own `#` handling. `parseConfigYaml` already works that way; this
  // parser did not, so `default: main   # the fallback board` gave the slug
  // `main` only by luck of `(\S+)` (TL-70).
  const raw = String(text || "").split(/\r?\n/).map(stripComment).join("\n");
  const def = (raw.match(/^default:\s*(\S+)\s*$/m) || [])[1] || "";

  const ignorePaths = [];
  const ignoreBlock = raw.match(/^ignore_paths:\s*\n((?:\s+-\s+.*\n?)+)/m);
  if (ignoreBlock) {
    for (const line of ignoreBlock[1].split("\n")) {
      const v = unquote(line.replace(/^\s*-\s*/, "").trim());
      if (v) ignorePaths.push(v);
    }
  }

  const blocks = raw.split(/^\s*-\s*slug:\s*/m).slice(1);
  const boards = blocks.map((block) => {
    const slug = block.match(/^(\S+)/)[1];
    const nameMatch = block.match(/^\s+name:\s*(.+?)\s*$/m);
    const paths = [];
    const pathsBlock = block.match(/^\s+paths:\s*\n((?:\s+-\s+.*\n?)+)/m);
    if (pathsBlock) {
      for (const line of pathsBlock[1].split("\n")) {
        const v = unquote(line.replace(/^\s*-\s*/, "").trim());
        if (v) paths.push(v);
      }
    }
    return { slug, name: nameMatch ? unquote(nameMatch[1]) : slug, paths };
  });

  return { boards, default: def, ignorePaths };
}

// ──────────────────────────────────────────────────────────────────────────
// Loading
// ──────────────────────────────────────────────────────────────────────────

/**
 * A configuration error is a PREDICTED STATE, not a crash of the program
 * (TL-60).
 *
 * Until TL-60 it came out as an unhandled exception: a user who was in the
 * middle of adapting the vocabularies to their own project got a stack trace
 * from `config.mjs:258`. A stack trace says "the tool fell over" — and what fell
 * over was a typo on one line they had written a moment earlier.
 *
 * The error type exists so that a caller can tell THIS case apart from a real
 * defect in the program. A `TypeError` still has to show its stack; silencing
 * everything would be a cure worse than the disease.
 */
export class ConfigError extends Error {
  constructor(message, info) {
    super(message);
    this.name = "ConfigError";
    this.configPath = info.configPath;
    this.problems = info.problems;
    this.headline = info.headline;
    // The way out belongs to the FILE, not to this class. Since TL-34 two
    // different files reach here — the project's vocabulary and a person's
    // preferences — and telling somebody editing their own preferences that
    // "the vocabularies are this project's values" sends them to the wrong
    // file to fix the right problem.
    this.remedy = info.remedy || null;
  }
}

const VOCABULARY_REMEDY = [
  "  → fix the file; the vocabularies are this project's VALUES, so an unknown",
  "    key is a typo, not a new capability.",
];

/** The message for a human: headline, file, the list of problems, a way out. */
export function formatConfigError(err, product = PRODUCT_NAME) {
  return [
    "✗ " + product + ": " + err.headline,
    "  " + err.configPath,
    ...err.problems.map((p) => "    " + p),
    "",
    ...(err.remedy || VOCABULARY_REMEDY),
  ].join("\n");
}

/**
 * Load the configuration, or end the program with a readable message.
 *
 * ONE PLACE FOR THIS HANDLING, because otherwise every command would have its
 * own version of the same `try` — and twelve versions are twelve chances for one
 * of them to be left with a bare exception. Exit code 1: this is not a usage
 * error (the flags are fine), it is a refusal to work on data that cannot be
 * read.
 */
export function loadConfigOrExit(root, opts = {}) {
  try {
    return loadConfig(root, opts);
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(formatConfigError(e));
      process.exit(1);
    }
    throw e;
  }
}

/**
 * @param {string} root the backlog directory (from paths.mjs)
 * @param {{strict?: boolean, boardsPath?: string}} opts
 *        `strict` (true by default) — an error in config.yaml throws instead of
 *        being ignored. A typo in the status vocabulary quietly papered over is
 *        validation that lets everything through.
 * @returns {object} a frozen configuration, plus the boards
 */
export function loadConfig(root, opts = {}) {
  const strict = opts.strict !== false;
  const paths = backlogPaths(root);
  const values = { ...DEFAULTS };

  let parsedValues = {};
  if (existsSync(paths.configPath)) {
    const parsed = parseConfigYaml(readFileSync(paths.configPath, "utf8"));
    if (parsed.problems.length && strict) {
      throw new ConfigError(
        paths.configPath + ":\n  " + parsed.problems.join("\n  "),
        { configPath: paths.configPath, problems: parsed.problems, headline: "cannot read the backlog configuration" }
      );
    }
    parsedValues = parsed.values;
    Object.assign(values, parsed.values);
  }

  // THE USER LAYER IS LOADED HERE, IN ONE PLACE, and joined DISJOINTLY (Law 3).
  //
  // Here rather than per command, because a user file holding a project key has
  // to FAIL — every command, not the two that happened to remember to look. A
  // preference silently ignored is indistinguishable from one that had no
  // effect, and a `statuses:` in the wrong file that merely does nothing is the
  // worst possible outcome: the person believes they changed the vocabulary.
  //
  // DISJOINT MEANS THE MERGE CANNOT EXPRESS AN OVERRIDE. The preferences land
  // under `config.user`, a namespace of their own, and nothing above ever reads
  // from it. There is no precedence rule to get wrong, because there is no
  // shared key for one to apply to — `parseUserConfig` refuses a project key
  // before it ever reaches this object.
  const user = loadUserConfig(opts.env || process.env, KNOWN_KEYS);
  if (user.problems.length && strict) {
    throw new ConfigError(
      user.path + ":\n  " + user.problems.join("\n  "),
      {
        configPath: user.path,
        problems: user.problems,
        headline: "cannot read the user preferences",
        remedy: [
          "  → this file holds facts about YOU and your machine: " + USER_KEYS.join(", ") + ".",
          "    A project's vocabulary lives in the backlog's config.yaml and may not be",
          "    overridden from here — two people would then see different values for one",
          "    repository, which is the single truth that file exists to be.",
        ],
      }
    );
  }

  const boardsPath = opts.boardsPath || paths.boardsPath;
  let registry = { boards: [], default: "", ignorePaths: [] };
  if (existsSync(boardsPath)) {
    registry = parseBoardsYaml(readFileSync(boardsPath, "utf8"));
  }

  // The prefix: an EXPLICIT setting always wins; only its absence gives the tree
  // a vote (BL-1452). Without that, every backlog created before this key existed
  // would, after an upgrade, be read under the generic `TASK` and would not find
  // a single one of its own tasks.
  const explicitPrefix = Object.prototype.hasOwnProperty.call(parsedValues, "task_id_prefix");
  let taskIdPrefix = values.task_id_prefix;
  if (!explicitPrefix) {
    const inferred = existsSync(paths.tasksDir) ? inferPrefix(readdirSync(paths.tasksDir)) : null;
    if (inferred) taskIdPrefix = inferred;
  }

  const config = {
    root,
    paths,
    projectName: values.project_name,
    taskIdPrefix,
    taskIdPrefixExplicit: explicitPrefix,
    taskId: taskIdPatterns(taskIdPrefix),
    statuses: values.statuses,
    archivedStatuses: values.archived_statuses,
    activeStatuses: values.statuses.filter((s) => values.archived_statuses.indexOf(s) < 0),
    priorities: values.priorities,
    types: values.types,
    confidence: values.confidence,
    labels: values.labels,
    labelsClosed: values.labels_closed,
    roles: values.roles,
    // Time measurement (TL-27). Only `activityPrivacy` is consulted today; the
    // rest are declared so a configuration written for the next task is not
    // rejected by this one.
    activityPrivacy: values.activity_privacy,
    idleGapMinutes: values.idle_gap_minutes,
    heartbeatThrottleSeconds: values.heartbeat_throttle_seconds,
    minReportN: values.min_report_n,
    auditStaleDays: values.audit_stale_days,
    activityRetentionDays: values.activity_retention_days,
    labelAxes: { timing: values.label_axis_timing, env: values.label_axis_env },
    owners: values.owners,
    estimates: values.estimates,
    actors: values.actors,
    titleMaxLength: values.title_max_length,
    epicAliases: values.epic_aliases,
    statusStrikethrough: values.status_strikethrough,
    colors: {
      status: values.status_colors,
      priority: values.priority_colors,
      label: values.label_colors,
    },
    criteriaLinks: values.criteria_links,
    // Resolved here rather than in DEFAULTS, because the fallback is another
    // key's value and DEFAULTS is a flat literal.
    reasonRequiredStatuses: values.reason_required_statuses || values.archived_statuses,
    // Resolved here for the same reason as the line above: the fallback depends
    // on another key's value, and DEFAULTS is a flat literal.
    inProgressStatus:
      values.in_progress_status ||
      (values.statuses.indexOf(DEFAULT_IN_PROGRESS_STATUS) >= 0 ? DEFAULT_IN_PROGRESS_STATUS : null),
    lockTtlMinutes: values.lock_ttl_minutes,
    abandonedAfterDays: values.abandoned_after_days,
    crossBranchState: values.cross_branch_state,
    activeBranchDays: values.active_branch_days,
    dashboard: {
      openStatuses: values.dashboard_open_statuses,
      burndown: { kind: values.dashboard_burndown_kind, value: values.dashboard_burndown_value },
    },
    boards: registry.boards,
    defaultBoard: registry.default,
    boardIgnorePaths: registry.ignorePaths,
    // Facts about the PERSON, in a namespace of their own (TL-34). Nothing
    // above this line may read from here and nothing here may shadow a key
    // above it: that is what makes the two layers disjoint rather than ranked.
    user: Object.freeze({ ...user.values, path: user.path, exists: user.exists }),
  };

  const problems = validateConfig(config);
  if (problems.length && strict) {
    throw new ConfigError(
      "The backlog configuration is inconsistent:\n  " + problems.join("\n  "),
      { configPath: paths.configPath, problems, headline: "the backlog configuration is inconsistent" }
    );
  }
  config.problems = problems;

  return Object.freeze(config);
}

/** Checks the consistency BETWEEN vocabularies — individual lists are validated
 *  by the parser. */
export function validateConfig(config) {
  const problems = [];
  if (!config.statuses.length) problems.push("`statuses` cannot be empty");
  // The prefix goes into EVERY pattern in the tool, so its shape has to be
  // checked here rather than discovered as a strange match inside a guard.
  if (!PREFIX_SHAPE.test(String(config.taskIdPrefix || ""))) {
    problems.push(
      "`task_id_prefix` = `" + config.taskIdPrefix + "` — expecting a letter, then letters/digits/`.`/`_`/`-`"
    );
  }
  if (!config.priorities.length) problems.push("`priorities` cannot be empty");
  if (LINK_POLICIES.indexOf(config.criteriaLinks) < 0) {
    problems.push(
      "`criteria_links` = `" + config.criteriaLinks + "` — expecting one of: " + LINK_POLICIES.join(", ")
    );
  }

  for (const s of config.archivedStatuses) {
    if (config.statuses.indexOf(s) < 0) {
      problems.push(`\`archived_statuses\` contains \`${s}\`, which is not in \`statuses\``);
    }
  }
  for (const s of config.dashboard.openStatuses) {
    if (config.statuses.indexOf(s) < 0) {
      problems.push(`\`dashboard_open_statuses\` contains \`${s}\`, which is not in \`statuses\``);
    }
  }
  if (config.inProgressStatus && config.statuses.indexOf(config.inProgressStatus) < 0) {
    problems.push(
      "`in_progress_status` = `" + config.inProgressStatus + "`, which is not in `statuses`"
    );
  }
  if (config.inProgressStatus && config.archivedStatuses.indexOf(config.inProgressStatus) >= 0) {
    // Taking a task would close it. The check is here rather than in the take
    // command because a configuration that says this is broken for everybody,
    // not for the one caller who happened to notice.
    problems.push(
      "`in_progress_status` = `" + config.inProgressStatus + "`, which is also in `archived_statuses`"
    );
  }
  if (!Number.isFinite(config.lockTtlMinutes) || config.lockTtlMinutes <= 0) {
    problems.push("`lock_ttl_minutes` = `" + config.lockTtlMinutes + "` — expecting a positive number of minutes");
  }
  // A negative window would make every claim abandoned the moment it is made:
  // the dispatcher would hand out work that is being done. `0` is the OFF
  // switch and is the default, so the mechanism is entered deliberately.
  if (!Number.isFinite(config.abandonedAfterDays) || config.abandonedAfterDays < 0) {
    problems.push(
      "`abandoned_after_days` = `" + config.abandonedAfterDays +
        "` — expecting a whole number of days, or 0 for never"
    );
  }
  // A negative window is not a shorter one, it is a scan that reads nothing and
  // says nothing — the exact silence TL-73 exists to remove. `0` is allowed
  // and means the opposite: no window, every local branch.
  if (!Number.isFinite(config.activeBranchDays) || config.activeBranchDays < 0) {
    problems.push(
      "`active_branch_days` = `" + config.activeBranchDays +
        "` — expecting a number of days, 0 for no window"
    );
  }
  for (const s of config.reasonRequiredStatuses) {
    if (config.statuses.indexOf(s) < 0) {
      problems.push(`\`reason_required_statuses\` contains \`${s}\`, which is not in \`statuses\``);
    }
  }
  for (const axis of ["timing", "env"]) {
    for (const l of config.labelAxes[axis]) {
      if (config.labelsClosed && config.labels.indexOf(l) < 0) {
        problems.push(`the \`${axis}\` axis uses the label \`${l}\`, which is outside the closed \`labels\` vocabulary`);
      }
    }
  }
  if (config.boards.length && config.defaultBoard) {
    if (!config.boards.some((b) => b.slug === config.defaultBoard)) {
      problems.push(`\`default: ${config.defaultBoard}\` in boards.yaml points at no board in the list`);
    }
  }
  // An actor with no namespace would pass config validation and then quietly
  // degrade to `unknown` on write — the configuration would be promising an
  // author the log will never see. Loud here, instead of silent there.
  for (const a of config.actors || []) {
    if (!isValidActor(a)) {
      problems.push(
        `\`actors\` contains \`${a}\` with no valid namespace — use ` +
          ACTOR_NAMESPACES.map((n) => n + ":" + a.replace(/^[a-z]+:/, "")).join(" / ")
      );
    }
  }

  // A role is an identifier a dispatcher MATCHES ON and that a caller types as a
  // flag value, so its shape is checked here rather than discovered later as a
  // comparison that happens to fail. A duplicate is checked for the same reason a
  // duplicate board is: the second entry can never be the one that is selected.
  const seenRoles = new Set();
  for (const r of config.roles || []) {
    if (!ROLE_SHAPE.test(String(r))) {
      problems.push(
        "`roles` contains `" + r + "` — expecting a lowercase slug: a letter or digit, " +
          "then letters/digits/`.`/`_`/`-`"
      );
    }
    if (seenRoles.has(r)) problems.push("duplicate role `" + r + "` in `roles`");
    seenRoles.add(r);
  }

  const seen = new Set();
  for (const b of config.boards) {
    if (seen.has(b.slug)) problems.push(`duplicate board \`${b.slug}\` in boards.yaml`);
    seen.add(b.slug);
  }
  return problems;
}
