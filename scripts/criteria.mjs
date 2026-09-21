#!/usr/bin/env node
/**
 * The link between `## Acceptance criteria` and `verification:` (TL-86).
 *
 * THE DEFECT THIS CLOSES. A task carried TWO lists about the same "done" — the
 * criteria in prose and the commands in `verification:` — with no defined
 * relation between them. Only one of the two was ever run, so the other was
 * ignored: measured on this backlog, 12 of 44 closed tasks left 60 criteria
 * unticked while their verification was green and real. That 27% is a measure
 * of REDUNDANCY, not of sloppiness. Here a criterion stops being something you
 * declare and becomes something you are GRANTED: it names the verification
 * entry that proves it, and the tool ticks it after a green run.
 *
 * WHY THE CRITERION POINTS AT THE PROOF, AND NOT THE OTHER WAY ROUND. The link
 * has to survive a criteria list being reordered or added to in the middle,
 * which rules out the position of a list item as the identifier. Two directions
 * remained. A criterion naming its proof wins because a criterion is the thing
 * a reader edits — it is written, rewritten and moved — while a verification
 * entry is a command that stays put. Keeping the reference on the moving side
 * means it moves WITH the sentence it belongs to, so a reordering is a no-op by
 * construction rather than by careful bookkeeping. The reverse direction would
 * also force one proof to enumerate its criteria, which is exactly the list that
 * goes stale when a criterion is deleted.
 *
 * THE SHAPE. A verification entry may carry a stable `id:`; a criterion names
 * one or more of them in a trailing `[proof: a, b]`:
 *
 *   verification:
 *     - id: help-exit-0
 *       bash: "node --test scripts/tests/cli-help.test.mjs"
 *
 *   - [ ] `<cmd> --help` exits 0 for every command. [proof: help-exit-0]
 *
 * The marker is VISIBLE, not an HTML comment. These files are read with `cat`
 * as often as in a renderer, an HTML comment is only invisible in one of the
 * two, and a link you cannot see is a link nobody maintains.
 *
 * WHY A TICK MAY BE WRITTEN TO A VERSIONED FILE, though it is computed —
 * apparently at odds with the second law ("what is computed may be deleted").
 * It is not. A view can be deleted and rebuilt from the tasks; the result of a
 * run that happened in the past cannot be rebuilt from anything — only by
 * running it again, against a tree that has meanwhile moved on. A tick is a
 * RECORD OF A RUN, of the same kind as a history entry, not a view.
 *
 * Tests: `node --test scripts/tests/criteria-mapping.test.mjs`
 */

// A trailing `# comment` beside a field is a convention of the WHOLE format —
// `_template.md` annotates a dozen fields that way — so every reader of a
// frontmatter line owes the value the same treatment (TL-70). Re-implementing
// it here would make `id: the-name  # optional` parse as an id with a comment in
// it, which is exactly the class of bug that module was extracted to end.
import { stripComment, unquote } from "./task-fields.mjs";

/** The heading that opens the criteria list. Part of the FORMAT (`_template.md`
 *  writes it), so it belongs in the code — unlike statuses or labels, which are
 *  project vocabulary and live in config.yaml. */
const CRITERIA_HEADING = /^#{2,}\s+Acceptance criteria\s*$/;

/** A proof id: lower case, digits and dashes. Narrow on purpose — the id ends up
 *  inside `[proof: …]`, where a comma or a bracket would be unparseable. */
export const PROOF_ID = /^[a-z0-9][a-z0-9-]*$/;

/** The keys a `verification:` entry may carry. An unknown key FAILS, like an
 *  unknown key in config.yaml and an unknown flag in the CLI.
 *
 *  `manual:` is here because the backlog already uses it for what no command can
 *  check (TL-82 designs the confirmation it will require). This parser only
 *  has to agree that such an entry EXISTS and may be pointed at; whether a
 *  manual entry counts as passed is a decision at closing time, not here. */
const VERIFICATION_KEYS = ["id", "bash", "manual"];

/**
 * The command `_template.md` writes into its `verification:` example.
 *
 * It is the one thing that tells an entry nobody has written from a contract:
 * the id beside it is a NAME, and a name is exactly what an author keeps when
 * they fill the entry in, so the id can never carry this meaning.
 *
 * WHY THERE ARE TWO COPIES OF THE STRING. `done` owns the other one and refuses
 * to close a task that still carries it, which is the whole reason this guard
 * may stay quiet about it. That module already imports this one, so reading its
 * constant from here would pull the closing command in behind every guard;
 * `scripts/tests/new-task-passes-check.test.mjs` fails on the day the two
 * copies stop being the same string.
 */
export const TEMPLATE_PLACEHOLDER = "command to run";

/**
 * Is this entry still the template's, rather than somebody's?
 *
 * @param {{bash: string|null, manual: string|null}} entry one parsed entry
 */
export function isTemplatePlaceholder(entry) {
  if (!entry) return false;
  const text = entry.bash != null ? entry.bash : entry.manual;
  return String(text == null ? "" : text).trim() === TEMPLATE_PLACEHOLDER;
}


/**
 * The `verification:` entries, in file order.
 *
 * @param {string} frontmatter the block between the `---` markers
 * @returns {{entries: Array<{id: string|null, bash: string|null, manual: string|null, line: number}>, problems: string[]}}
 */
export function parseVerification(frontmatter) {
  const lines = String(frontmatter || "").split(/\r?\n/);
  const entries = [];
  const problems = [];

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^verification:\s*(#.*)?$/.test(lines[i])) { start = i + 1; break; }
  }
  if (start < 0) return { entries, problems };

  let current = null;
  for (let i = start; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    // A WHOLE-LINE `#` COMMENT, AT ANY POSITION IN THE LIST (TL-173). A trailing
    // comment beside a value was already read as one; a comment standing on its
    // own line was read as an entry key, so the sentence that explains an entry
    // could only be written ABOVE the list — far from what it explains — and
    // moving it between two entries made the whole contract unreadable and
    // `done` report a four-entry contract as absent.
    //
    // TESTED BEFORE THE TOP-LEVEL BREAK BELOW, so an unindented comment does not
    // end the block either: a `#` line carries no key, so it can never BE the
    // next top-level field, and making a comment's meaning depend on its column
    // would replace one positional accident with another.
    //
    // `stripComment` and not `/^\s*#/`: it is the one implementation of what
    // counts as a comment in this format (TL-70), and it is what already keeps
    // the hash inside `bash: "grep '#' file"` out of this decision.
    if (!stripComment(raw).trim()) continue;
    if (!/^\s/.test(raw)) break;                       // the next top-level key

    const item = raw.match(/^\s*-\s*(.*)$/);
    const text = item ? item[1] : raw.trim();
    if (item) {
      current = { id: null, bash: null, manual: null, line: i };
      entries.push(current);
    }
    if (!current) continue;

    const kv = text.match(/^([a-z_]+):\s*(.*)$/);
    if (!kv) {
      problems.push(`verification: cannot read \`${text}\` (expecting one of: ${VERIFICATION_KEYS.join(", ")})`);
      continue;
    }
    const key = kv[1];
    if (VERIFICATION_KEYS.indexOf(key) < 0) {
      problems.push(
        `verification: unknown key \`${key}\` (allowed: ${VERIFICATION_KEYS.join(", ")})`
      );
      continue;
    }
    current[key] = unquote(stripComment(kv[2]));
  }

  for (const e of entries) {
    if (!e.bash && !e.manual) {
      problems.push("verification: an entry with neither `bash:` nor `manual:` — there is nothing to check");
    }
    if (e.id !== null && !PROOF_ID.test(e.id)) {
      problems.push(`verification: \`id: ${e.id}\` — expecting lower case letters, digits and dashes`);
    }
  }

  const seen = new Set();
  for (const e of entries) {
    if (e.id === null) continue;
    if (seen.has(e.id)) problems.push(`verification: duplicate \`id: ${e.id}\` — a proof reference would be ambiguous`);
    seen.add(e.id);
  }

  return { entries, problems };
}

/**
 * The items of the `## Acceptance criteria` list.
 *
 * @param {string} body everything after the frontmatter
 * @returns {{present: boolean, items: Array<{text: string, checked: boolean, proofs: string[], line: number, endLine: number}>}}
 *          `present` distinguishes "the section is missing" from "the section is
 *          empty" — both are defects, but not the same one.
 *          `line` is the `- [ ]` line and `endLine` the last line of the
 *          criterion; they differ when the sentence wraps, and only `line` may
 *          ever be written to.
 */
export function parseCriteria(body) {
  const lines = String(body || "").split(/\r?\n/);
  const items = [];

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (CRITERIA_HEADING.test(lines[i])) { start = i + 1; break; }
  }
  if (start < 0) return { present: false, items };

  // A CRITERION MAY WRAP (TL-118). Wrapping at eighty columns is the norm in
  // this format, not an exception, and the one-line reader that stood here saw
  // only the first line: the rest of the sentence vanished from every report,
  // and a `[proof:]` at the end of the last line vanished with it — so
  // `check --criteria` said "criterion with no proof" about a criterion that
  // named one. A guard that fails on correct data is a guard people switch off.
  //
  // WHAT ENDS A CRITERION: a blank line, a new list item, a heading, or an
  // unindented line. That is the markdown rule for a list item's continuation,
  // and it is deliberately the same shape `parseVerification` above uses for a
  // multi-line entry. Lazy continuation — an UNindented following line — is not
  // accepted, because at that point a criterion and the prose after the list
  // become indistinguishable.
  //
  // WHERE `[proof:]` MAY STAND: at the end of the LAST line, which is where a
  // person writes it. One place rather than two: a second permitted position
  // buys nothing and makes the rule harder to state than to follow.
  let current = null;
  const close = () => {
    if (!current) return;
    const joined = current.parts.join(" ").replace(/\s+/g, " ").trim();
    const marker = joined.match(/\[proof:\s*([^\]]*)\]\s*$/);
    current.item.proofs = marker
      ? marker[1].split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    current.item.text = (marker ? joined.slice(0, marker.index) : joined).trim();
    items.push(current.item);
    current = null;
  };

  for (let i = start; i < lines.length; i++) {
    const raw = lines[i];
    if (/^#{2,}\s+\S/.test(raw)) { close(); break; }   // the next section
    const m = raw.match(/^\s*-\s*\[([ xX])\]\s*(.*)$/);
    if (m) {
      close();
      // `line` stays the index of the `- [ ]` line and of no other: it is what
      // `applyProofs` writes the tick onto, and a tick landing on a
      // continuation would corrupt the sentence instead of marking it.
      current = { item: { text: "", checked: m[1] !== " ", proofs: [], line: i, endLine: i }, parts: [m[2]] };
      continue;
    }
    if (!current) continue;
    // A list item that is not a criterion, or an unindented line, or a blank
    // one: the criterion ended at the line before.
    if (!raw.trim() || !/^\s/.test(raw) || /^\s*-\s/.test(raw)) { close(); continue; }
    current.parts.push(raw.trim());
    current.item.endLine = i;
  }
  close();
  return { present: true, items };
}

/** The severities `criteria_links` can be set to, worst last. */
export const LINK_POLICIES = ["off", "warn", "require"];

/**
 * Judge ONE task.
 *
 * The split between `errors` and `warnings` is the migration path (TL-86,
 * point 2). A BROKEN link — a criterion naming a proof that does not exist, a
 * duplicate id — is always an error: it can only have been introduced by
 * someone who was already using the mechanism, so failing on it cannot make an
 * old task unclosable. A MISSING link is only an error under
 * `criteria_links: require`; the default `warn` is what keeps the 39 active
 * tasks that predate this closable while they are being linked up.
 *
 * @param {{frontmatter: string, body: string, policy?: string}} input
 */
export function auditTask({ frontmatter, body, policy = "warn" }) {
  const errors = [];
  const warnings = [];
  const { entries, problems } = parseVerification(frontmatter);
  for (const p of problems) errors.push(p);

  const { present, items } = parseCriteria(body);
  const ids = new Set(entries.filter((e) => e.id !== null).map((e) => e.id));
  const used = new Set();

  for (const item of items) {
    for (const ref of item.proofs) {
      used.add(ref);
      if (!ids.has(ref)) {
        errors.push(
          `\`[proof: ${ref}]\` names no \`verification:\` entry — add \`id: ${ref}\` to the entry that proves it`
        );
      }
    }
  }

  if (policy === "off") return { errors, warnings, items, entries };

  const severity = policy === "require" ? errors : warnings;

  // A guard that is green on an empty sample is green with no evidential force
  // (CLAUDE.md). A task with no criteria would sail through every rule below,
  // so its absence is judged first and by itself.
  if (!present) {
    severity.push("no `## Acceptance criteria` section — there is nothing for the verification to prove");
  } else if (!items.length) {
    severity.push("`## Acceptance criteria` is empty — an empty list is proved by anything");
  }

  for (const item of items) {
    if (!item.proofs.length) {
      severity.push(`criterion with no proof: "${item.text}" — end the line with \`[proof: <id>]\``);
    }
  }
  for (const e of entries) {
    // THE TEMPLATE'S OWN ENTRY IS NOT AN ORPHAN (TL-262). It proves no criterion
    // because it proves nothing at all, and the advice this message gives —
    // link it, or drop the `id:` — is the wrong repair for it twice: a
    // placeholder has to be REPLACED, and dropping the id would hide the shape
    // a real entry takes, which is what the example is there to show. Nothing is
    // lost by the silence: `done` refuses to close a task that still carries
    // this command, so the task cannot end on it either way. Warning here would
    // fire on a state the tool authored, and a guard that reports its own output
    // teaches its reader to delete what the tool just wrote.
    if (e.id !== null && !used.has(e.id) && !isTemplatePlaceholder(e)) {
      severity.push(`\`verification\` entry \`${e.id}\` proves no criterion — either link it or drop the \`id:\``);
    }
  }
  return { errors, warnings, items, entries };
}

/**
 * Tick the criteria proved by the verification entries that PASSED.
 *
 * Idempotent by construction: it rewrites `- [ ]` to `- [x]` and never the other
 * way round. Untickng is deliberately not offered — a tick records that a run
 * happened, and a later red run does not un-happen it; what it does is stop the
 * task from being closed, which is TL-82's job, not this function's.
 *
 * A criterion is ticked only when EVERY proof it names passed. A criterion with
 * two proofs claims both, so one green run out of two proves nothing.
 *
 * @param {string} raw the whole file
 * @param {Iterable<string>} passedIds ids of the verification entries that ran green
 * @returns {{text: string, ticked: string[]}}
 */
export function applyProofs(raw, passedIds) {
  const passed = new Set(passedIds || []);
  const text = String(raw == null ? "" : raw);
  const match = text.match(/^---\r?\n([\s\S]*?\r?\n)---\r?\n/);
  const offset = match ? match[0].length : 0;
  const body = text.slice(offset);

  // split on "\n" and not /\r?\n/: the rejoin has to give back byte-for-byte
  // what came in apart from the one bracket that changed, and a CRLF file
  // normalised to LF would show up as a whole-file diff. The line INDICES are
  // the same either way, so they still line up with parseCriteria.
  const lines = body.split("\n");
  const { items } = parseCriteria(body);
  const ticked = [];

  for (const item of items) {
    if (item.checked) continue;
    if (!item.proofs.length) continue;
    if (!item.proofs.every((p) => passed.has(p))) continue;
    lines[item.line] = lines[item.line].replace(/\[ \]/, "[x]");
    ticked.push(item.text);
  }

  return { text: text.slice(0, offset) + lines.join("\n"), ticked };
}
