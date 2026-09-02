/**
 * The JSON envelope — one shape for every `--json` answer (TL-72).
 *
 * WHY. The fourth law makes `--json` the extension surface: there is no plugin
 * API, so the JSON contract is the only thing anybody can build against. Until
 * this file, `query --json` printed a bare array. A bare array has nowhere to put
 * metadata — the only way to add a warning, a directory, or a result count is to
 * change the root from an array into an object, which breaks every consumer at
 * once. The longer that stands, the more expensive the change gets.
 *
 * The shape is the one Backlog.md settled on for the same problem:
 *
 *   { "schemaVersion": 1, "kind": "task-list", "tasks": [ … ] }
 *
 * and with it the rules a consumer may rely on:
 *
 *   - `schemaVersion` and `kind` are ALWAYS present, and `kind` says which
 *     payload keys follow;
 *   - a key declared for that kind is always present: an absent scalar is
 *     `null`, an absent collection is `[]`. Never a missing key — a consumer
 *     must not have to tell "no value" from "old version of the tool";
 *   - ADDING a key is backwards compatible and does not move the version;
 *   - removing, renaming or redefining a key needs a new `schemaVersion`.
 *
 * WHY THE KINDS ARE DECLARED HERE AND NOT AT THE EMITTERS. The emptiness rule is
 * worth nothing as a promise; it holds because the key set lives beside the
 * version and every emitter is filled in from it. An emitter that forgets a key
 * still prints it, and an emitter that invents one FAILS instead of quietly
 * extending the contract from a typo.
 *
 * Tests: `node --test scripts/tests/json-envelope.test.mjs`
 */

/**
 * The version of the contract, in ONE place. It is not the package version:
 * releases happen for reasons that have nothing to do with the JSON shape, and a
 * consumer pinning behaviour wants the shape, not the release.
 */
export const SCHEMA_VERSION = 1;

/**
 * Every kind, with its keys and their EMPTY values. `null` marks a scalar, `[]`
 * a collection — that is the whole emptiness rule, expressed as data rather than
 * as a paragraph in the README.
 */
export const KINDS = {
  // `query --json`. `total` is the number of matches BEFORE `--limit` cut them;
  // without it the array is a slice that reads like a complete answer, which is
  // the defect the text output has warned about since it had a `--limit`.
  // `scan` says whether the branch and worktree scan ran (TL-73) — without
  // it, an empty `elsewhere` on every task is ambiguous between "the branches
  // agree" and "nobody looked", and those two call for opposite decisions.
  // `modifiedFile` is `null` unless `--modified-file` was asked for, and then it
  // says whether the git index could be computed at all (TL-75): zero matches
  // and an unscanned repository are otherwise the same empty `tasks`.
  "task-list": { tasks: [], total: null, limit: null, scan: null, modifiedFile: null },
  // `<command> --help --json` (TL-83). `flags` describes the input surface, and
  // a flag drawing on a vocabulary carries THIS project's values in `values` —
  // so an agent narrows its input instead of guessing and retrying. `configured`
  // says whether a backlog was found at all: `values: null` under
  // `configured: false` is "nobody looked", not "the vocabulary is empty".
  "command-help": { command: null, summary: null, usage: null, configured: null, flags: [] },
  // `stats --json`. The tallies stay nested under `stats` instead of being
  // spread across the root: a future tally called `kind` would otherwise
  // overwrite the envelope's own key and nobody would notice until a consumer
  // broke.
  // `divergent` is the list behind the `divergent` tally inside `stats`: the
  // tasks another branch disagrees with, each naming both statuses (TL-73).
  stats: { root: null, stats: null, scan: null, divergent: [] },
  // `check --json` (TL-57). `ok` is what CI reads, `failed` is what it acts on —
  // a consumer must not have to filter `guards` to learn which one to look at.
  // `output` beside each guard is text written for a PERSON and may be reworded;
  // `name`, `ok` and `exit` are the contract.
  check: { ok: null, root: null, failed: [], guards: [] },
  // `doctor --json`. `ok` is the answer CI reads; `checks` is why.
  doctor: { ok: null, root: null, next: null, checks: [] },
  // `board --json`. `rule` and `matched` are null exactly when `isDefault` is
  // true — nothing matched, so there is no rule to name.
  board: { board: null, rule: null, matched: null, isDefault: null, reason: null },
  // `next-id --json`. Everything `--explain` prints, always — a machine that has
  // to ask a second question to learn where the number came from would have to
  // parse prose.
  // `instructions --json`. `topics` is always the full list, even when one topic
  // was asked for: a consumer that has to make a second call to learn what else
  // exists is one that will hard-code the list instead. `version` is the version
  // of the POINTER a repository carries, not of the guides.
  instructions: { topics: [], topic: null, text: null, version: null },
  "next-id": { nextId: null, id: null, prefix: null, max: null, source: null, trees: null, branches: null, known: null },
  // `seed --json`. The first WRITING command in the envelope, because it is the
  // first one written after the envelope existed — the older three answer with a
  // bare object and move separately.
  // `created` carries the mapping the caller cannot compute: `planId` is the key
  // it wrote, `id` is the number the tool allocated. `errors` is what the plan
  // was refused for, in full — an adapter retrying with the model (TL-95) needs
  // every complaint, not the first.
  seed: { ok: null, root: null, dryRun: null, created: [], errors: [] },
  // `plan --json`. `exists` is false for a backlog with no `plan.yaml`, and then
  // every other key carries its empty value — the execution order is optional,
  // so its absence is an answer and not an error to be told apart from one.
  // `unplanned` and `stale` are lists rather than counts on purpose: a plan rots
  // by accumulating work nobody scheduled, and a number cannot be acted on.
  plan: {
    root: null, exists: null, updated: null, rationale: null, waves: [],
    activeWave: null, nextUp: [], inProgress: [], unplanned: [], stale: [],
    inProgressStatus: null,
  },
  // `unstamped` is a LIST and not a count, for the reason `unplanned` is: the
  // tasks outside a measurement are the thing a reader has to be able to go and
  // look at, and a number cannot be acted on (TL-27).
  // `engaged` and `unknown_ratio` are TL-28's: measured time at the keyboard,
  // beside the calendar time the stamps give. `unknown_ratio` sits at the ROOT
  // rather than inside `engaged` because §8.2 of docs/backlog-time-tracking.md
  // makes it a first-class number of every report — a consumer must not have to
  // walk into a nested object to find out whether the sum beside it can be
  // trusted, and one that forgot to look would be reading a pretty sum.
  //
  // IT IS THE ONE SNAKE_CASE KEY IN THIS FILE, deliberately. It is the name the
  // design document and the task's own contract give the statistic, the way
  // `p80` is a name rather than a field; renaming it for house style would put
  // the tool's only honesty signal under a word nothing else in the project
  // uses.
  time: {
    root: null, closed: null, completed: null, unstamped: [],
    leadTimeDays: null, throughput: [], perWeekMean: null,
    engaged: null, unknown_ratio: null,
  },
};

/** The envelope's own keys — a payload may never carry them. */
const RESERVED = ["schemaVersion", "kind"];

/**
 * Build the answer for one kind.
 *
 * Both refusals are programmer errors and throw rather than print: an unknown
 * kind or an unknown key means the contract and the code have parted company,
 * and a machine-readable answer that quietly invents a field is worse than none.
 *
 * @param {string} kind  a key of KINDS
 * @param {object} payload  the declared keys; anything missing takes its empty value
 */
export function envelope(kind, payload) {
  const shape = KINDS[kind];
  if (!shape) {
    throw new Error("unknown JSON kind: " + kind + " (declare it in json-envelope.mjs; known: " + Object.keys(KINDS).join(", ") + ")");
  }
  const given = payload || {};
  for (const key of Object.keys(given)) {
    if (RESERVED.indexOf(key) !== -1) {
      throw new Error("`" + key + "` belongs to the envelope and cannot be a payload key of " + kind);
    }
    if (!(key in shape)) {
      throw new Error("unknown key `" + key + "` for kind " + kind + " (declared: " + Object.keys(shape).join(", ") + ")");
    }
  }
  const out = { schemaVersion: SCHEMA_VERSION, kind };
  for (const key of Object.keys(shape)) {
    const value = given[key];
    // `undefined` is the same as absent — JSON.stringify would DROP the key, and
    // a dropped key is the one thing the contract promises never to do.
    out[key] = value === undefined ? shape[key] : value;
  }
  return out;
}

/** Print one answer on stdout. No colour, no ornament: this is for a program. */
export function printJson(kind, payload) {
  console.log(JSON.stringify(envelope(kind, payload), null, 2));
}
