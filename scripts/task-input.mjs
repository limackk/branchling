/**
 * ONE task, handed to the tool from outside — its prose and its closing
 * contract (TL-94, TL-237).
 *
 * WHY THIS MODULE EXISTS. `seed` already accepted a structured task without a
 * model: goal, context, steps and a `verification:` block, as JSON on stdin.
 * `new` needed exactly the same thing for a SINGLE task in an existing tree,
 * and a second reading of the same document would have been a second format —
 * two shapes with one name, drifting at the first field either side added. The
 * judgement and the rendering therefore live here, and both commands call them.
 *
 * WHAT IS SHARED AND WHAT IS NOT. Shared: the `verification` entry, the body
 * headings, and the rule that a check which proves nothing is refused. Not
 * shared: `plan_id`, `blocked_by` and the frontmatter a plan carries per item —
 * those belong to a PLAN, which is a set of tasks with references between them.
 * A single task in a tree that already exists refers to nothing by a local key,
 * and its frontmatter arrives on flags that have validated against this
 * project's vocabulary since long before this input existed.
 *
 * THE FORMAT IS PUBLIC SURFACE: other people's programs write to it. An unknown
 * key FAILS here, exactly as an unknown key in `config.yaml` and an unknown
 * flag on the command line do — a document whose typo is silently dropped is a
 * document whose author believes it was honoured.
 *
 * Tests: `node --test scripts/tests/new-body-input.test.mjs scripts/tests/seed.test.mjs`
 */

import { PROOF_ID } from "./criteria.mjs";
import { TEMPLATE_PLACEHOLDER } from "./done-task.mjs";

export function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function isNonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "";
}

/** The keys one `verification` entry may carry. `bash` and `manual` are the two
 *  the task file itself accepts; `proves` is the SENTENCE this check earns —
 *  it becomes the acceptance criterion that points back at the entry. */
export const VERIFICATION_KEYS = ["id", "bash", "manual", "proves"];

/** The keys a SINGLE task document may carry — the body and the contract. */
export const TASK_DOCUMENT_KEYS = ["goal", "context", "steps", "verification"];

/**
 * Frontmatter the command line already owns. Named rather than reported as an
 * unknown key, because the author of the document did think about the field —
 * they put it in the wrong half of the interface, and the message that says so
 * is the difference between a fix and a guess.
 */
const FLAG_FIELDS = {
  title: "--title", board: "--board", priority: "--priority", status: "--status",
  type: "--type", owner: "--owner", epic: "--epic", estimate: "--estimate", wave: "--wave",
};

/** Keys that belong to a `seed` plan and mean nothing for one task. */
const PLAN_FIELDS = ["plan_id", "blocked_by", "blocks"];

const prefixed = (at, text) => (at ? at + ": " : "") + text;
const spotOf = (at, j) => (at ? at + " " : "") + "verification[" + j + "]";

/**
 * The closing contract of one task.
 *
 * This is the gate both commands exist to defend, so it is strict about the two
 * ways an entry can be present and still prove nothing: empty, and the
 * template's own placeholder.
 *
 * @param {*} list the `verification` value as it arrived
 * @param {string} at where to say it is, empty for a document that is one task
 */
export function validateVerification(list, at) {
  const errors = [];
  if (!Array.isArray(list) || !list.length) {
    errors.push(prefixed(at,
      "`verification` is required and must not be empty — a task with nothing " +
        "that could prove it is done cannot be worked unattended"));
    return errors;
  }
  const ids = new Set();
  list.forEach((raw, j) => {
    const spot = spotOf(at, j);
    const v = typeof raw === "string" ? { bash: raw } : raw;
    if (!isPlainObject(v)) {
      errors.push(spot + ": expecting a command string or an object with `bash:` or `manual:`");
      return;
    }
    for (const key of Object.keys(v)) {
      if (VERIFICATION_KEYS.indexOf(key) < 0) errors.push(spot + ": unknown key `" + key + "` (known: " + VERIFICATION_KEYS.join(", ") + ")");
    }
    const hasBash = v.bash !== undefined;
    const hasManual = v.manual !== undefined;
    if (hasBash && hasManual) errors.push(spot + ": `bash` and `manual` in one entry — one check, one way of checking it");
    if (!hasBash && !hasManual) {
      errors.push(spot + ": neither `bash` nor `manual` — there is nothing to check");
      return;
    }
    const text = hasBash ? v.bash : v.manual;
    if (!isNonEmptyString(text)) {
      errors.push(spot + ": `" + (hasBash ? "bash" : "manual") + "` is empty — there is nothing to check");
      return;
    }
    if (text.trim() === TEMPLATE_PLACEHOLDER) {
      errors.push(
        spot + ": still the template placeholder (`" + TEMPLATE_PLACEHOLDER + "`) — " +
          "that field was filled in by the template, not by anybody who thought about this task"
      );
    }
    if (v.id !== undefined) {
      if (!isNonEmptyString(v.id) || !PROOF_ID.test(v.id)) {
        errors.push(spot + ": `id` must be lower case letters, digits and dashes");
      } else if (ids.has(v.id)) {
        errors.push(spot + ": duplicate `id: " + v.id + "` — a proof reference would be ambiguous");
      } else {
        ids.add(v.id);
      }
    }
    if (v.proves !== undefined && !isNonEmptyString(v.proves)) {
      errors.push(spot + ": `proves` must be a non-empty string when given");
    }
  });
  return errors;
}

/**
 * The prose of one task, judged whole.
 *
 * Every problem is collected — the caller prints the list and writes nothing.
 * Reporting only the first would turn a document with three defects into three
 * runs, and for a program generating the document into three attempts.
 *
 * @returns {string[]} the complaints, empty when there are none
 */
export function validateTaskDocument(doc) {
  if (!isPlainObject(doc)) {
    return [
      "the task must be a JSON object, not " + (Array.isArray(doc) ? "an array" : typeof doc),
      'expected: { "goal": "…", "verification": [ { "bash": "…" } ] }',
    ];
  }
  const errors = [];
  for (const key of Object.keys(doc)) {
    if (TASK_DOCUMENT_KEYS.indexOf(key) >= 0) continue;
    if (FLAG_FIELDS[key]) {
      errors.push("`" + key + "` is frontmatter, and frontmatter arrives on the command line: " +
        FLAG_FIELDS[key] + " — one field, one way in");
    } else if (PLAN_FIELDS.indexOf(key) >= 0) {
      errors.push("`" + key + "` belongs to a plan, which is a set of tasks with references between " +
        "them; this document is one task in a tree that already exists");
    } else {
      errors.push("unknown key `" + key + "` (known: " + TASK_DOCUMENT_KEYS.join(", ") + ")");
    }
  }
  if (!isNonEmptyString(doc.goal)) {
    errors.push("`goal` is required — a task whose reason for existing is not written down cannot be picked up by anybody else");
  }
  if (doc.context !== undefined && !isNonEmptyString(doc.context)) {
    errors.push("`context` must be a non-empty string when given");
  }
  if (doc.steps !== undefined) {
    if (!Array.isArray(doc.steps)) errors.push("`steps` must be an array of strings");
    else doc.steps.forEach((s, j) => {
      if (!isNonEmptyString(s)) errors.push("`steps[" + j + "]` is not a non-empty string");
    });
  }
  errors.push(...validateVerification(doc.verification, ""));
  return errors;
}

/**
 * Text → a task document, judged.
 *
 * @returns {{task: object|null, errors: string[]}}
 */
export function parseTaskDocument(text) {
  let doc;
  try {
    doc = JSON.parse(String(text == null ? "" : text));
  } catch (e) {
    return { task: null, errors: ["the task is not valid JSON: " + e.message] };
  }
  const errors = validateTaskDocument(doc);
  return { task: errors.length ? null : doc, errors };
}

/**
 * The `verification:` entries and the criteria they prove, for one task.
 *
 * EVERY entry gets an id, even when the document did not give one. That is what
 * lets each acceptance criterion end in `[proof: <id>]`, which is the whole
 * reason `check --criteria` is quiet on a task written this way: a criterion
 * here is not a claim somebody typed, it is a sentence the tool will tick after
 * a green run (TL-86).
 */
export function contractFor(item) {
  const raw = item.verification.map((v) => (typeof v === "string" ? { bash: v } : v));
  const taken = new Set(raw.map((v) => v.id).filter(Boolean));
  const entries = [];
  const criteria = [];
  let n = 0;

  for (const v of raw) {
    let id = v.id;
    if (!id) {
      do { id = "check-" + ++n; } while (taken.has(id));
      taken.add(id);
    }
    const command = v.bash !== undefined ? { bash: v.bash } : { manual: v.manual };
    entries.push({ id, ...command });
    // With no sentence from the document, the criterion IS the check passing.
    // That reads thinly, and it is still the honest statement of what this task
    // has to earn — an invented sentence would be prettier and unproved.
    criteria.push(v.proves || (v.bash !== undefined ? "`" + v.bash + "` passes." : v.manual));
  }
  return { entries, criteria };
}

/** The markdown below the frontmatter. The headings are the format's, the same
 *  ones `_template.md` writes — `parseCriteria` looks for one of them by name. */
export function renderBody(item, criteria) {
  const out = ["", "## Goal", "", item.goal.trim(), ""];
  if (isNonEmptyString(item.context)) out.push("## Context", "", item.context.trim(), "");
  const steps = Array.isArray(item.steps) ? item.steps : [];
  if (steps.length) {
    out.push("## Steps", "");
    steps.forEach((s, i) => out.push(i + 1 + ". " + s.trim()));
    out.push("");
  }
  out.push("## Acceptance criteria", "");
  for (const c of criteria) out.push("- [ ] " + c.text + " [proof: " + c.id + "]");
  out.push("");
  return out.join("\n");
}

/** Entries and body in one call — what both writing commands actually need. */
export function taskContent(item) {
  const { entries, criteria } = contractFor(item);
  return {
    verification: entries,
    body: renderBody(item, entries.map((e, i) => ({ id: e.id, text: criteria[i] }))),
  };
}
