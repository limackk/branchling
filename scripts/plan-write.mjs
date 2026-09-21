#!/usr/bin/env node
/**
 * Writing `plan.yaml` — the one data file the tool refused to touch (TL-213).
 *
 * WHAT WAS MISSING. Every other piece of data here has a writing command, and
 * every one of them records who acted and why: `new`, `take`, `done`,
 * `handoff`, `decide`. The plan was edited by hand, so scheduling was the one
 * decision that left no trace of its author — and creating a task and
 * scheduling it were two steps that could end in the middle. Measured on
 * 2026-09-03: a session created a task and hand-edited the plan on the same
 * shell line, the plan edit failed, the commit ran anyway, and the task landed
 * in the backlog scheduled nowhere.
 *
 * WHY THE TEXT AND NOT THE PARSE. `parsePlanYaml` returns waves and ids and
 * drops everything else, so a file rebuilt from it would be a file with every
 * comment deleted — and the comments ARE the plan: each wave carries a
 * paragraph of argument saying why those tasks belong together and why the wave
 * stands where it does. So this module edits LINES, keeps what it does not
 * understand, and leaves the form each list was written in alone. A writer that
 * normalised the file would rewrite lines nobody asked it to touch, and the
 * diff of one reviewable file — the whole reason the plan is one file — would
 * stop being readable.
 *
 * WHAT THE TOOL MAY WRITE, AND WHAT IT MAY NOT. Membership is mechanical: an id
 * belongs to a wave, and waves are ordered. The RATIONALE is a person's, so
 * nothing here composes one. A NEW wave therefore requires a `--why` written by
 * the caller and is refused when it is empty, for the same reason
 * `reason_required_statuses` refuses a status change with no sentence; `--why`
 * means "create a wave" and nothing else, so offered for a wave that already
 * exists it is refused rather than appended to somebody else's paragraph.
 *
 * WHY THE PARSE IS STILL THE AUTHORITY. Membership is decided by
 * `parsePlanYaml` — what the file SAYS — and the line scan below only decides
 * where the bytes go. The result is then parsed again and compared against the
 * membership that was intended: an edit that disturbed anything else is
 * refused, and the file is returned byte for byte. Refusal has to be total. A
 * writer that returned a half-applied text would be the 2026-09-03 defect in a
 * new place.
 *
 * NOTHING IS WRITTEN TO `backlog/history/`. Decided in TL-213 (see
 * `backlog/history/TL-213.jsonl`): that log is keyed by a task and holds facts
 * about a task's own life, while scheduling is a fact about the ORDER — a
 * `__planned__` event would force one subject into another's shape. The record
 * of a scheduling change is the git diff of this one file, plus the `--why` the
 * writer preserves in it.
 *
 * Tests: `node --test scripts/tests/plan-write.test.mjs`
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { reportPlanErrors } from "./check-backlog-plan.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { backlogPaths, resolveBacklogDirOrExit, takeDirFlag } from "./paths.mjs";
import { parsePlanYaml, validatePlan } from "./plan.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { todayStamp } from "./today.mjs";
import { stripComment, unquote } from "./task-fields.mjs";
import { readTaskMetas } from "./task-io.mjs";
import { MARK, color, fail, failure } from "./ui.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The edits the tool performs. Anything else after `plan` is a typo, and a
 *  silent no-op looks like it worked. */
export const EDIT_SUBCOMMANDS = ["add", "move", "remove"];

/** A wave named the way `validatePlan` names it, so one wave has one name in
 *  every message the user can see. */
function waveLabel(plan, i) {
  return `${i + 1} (${plan.waves[i].name || "unnamed"})`;
}

/**
 * A line split into what YAML reads and what only a person reads.
 *
 * `stripComment` already owns the rule for where a comment starts — at the
 * start of the line or after whitespace, and never inside quotes — so the
 * remainder of the line is everything it dropped. A second implementation of
 * that rule is a second chance to eat a `#` out of a quoted wave name.
 */
function splitComment(raw) {
  const code = stripComment(raw);
  return { code, comment: raw.slice(code.length) };
}

const indentOf = (s) => s.length - s.trimStart().length;

/** The ids of an inline `tasks: [A, B]`, or null when the line is not one. */
function inlineIds(raw) {
  const m = splitComment(raw).code.match(/\[([^\]]*)\]$/);
  if (!m) return null;
  return m[1].split(",").map((s) => unquote(s.trim())).filter(Boolean);
}

/** The same line with a new list in it — the key, the spacing and any trailing
 *  comment exactly as they were. */
function rewriteInline(raw, ids) {
  const { code, comment } = splitComment(raw);
  if (!/\[[^\]]*\]$/.test(code)) return null;
  return code.replace(/\[[^\]]*\]$/, "[" + ids.join(", ") + "]") + comment;
}

/** The id of a `- TL-1` item line. */
function itemId(raw) {
  const code = splitComment(raw).code.trim();
  return code.startsWith("- ") ? unquote(code.slice(2).trim()) : "";
}

/**
 * WHERE the bytes are — the lines an edit is allowed to touch.
 *
 * This is not a second parser: it answers "which line" and never "what does
 * the plan say", which `parsePlanYaml` answers and `editPlanText` re-checks the
 * result against. A comment line reduces to nothing here, exactly as it does
 * for the parser, which is why a comment cannot be mistaken for structure.
 */
function scan(src) {
  const lines = String(src).split("\n");
  // A file ending in a newline leaves an empty last element. Every insertion
  // happens BEFORE it, so the file still ends in a newline afterwards.
  const eof = lines.length && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
  const waves = [];
  let updatedLine = -1;
  let wavesLine = -1;
  let wavesEnd = eof;
  let wave = null;
  let pending = null;

  for (let i = 0; i < lines.length; i++) {
    const code = stripComment(lines[i]);
    if (!code.trim()) continue;
    const indent = indentOf(code);
    const line = code.trim();

    if (indent === 0) {
      const m = line.match(/^([a-z_][a-z0-9_]*):/);
      if (!m) continue;
      if (m[1] === "updated") updatedLine = i;
      if (m[1] === "waves") {
        wavesLine = i;
      } else if (wavesLine >= 0 && wavesEnd === eof) {
        // A top-level key after `waves:` closes the block: a wave appended
        // below it would be indented under the wrong key.
        wavesEnd = i;
      }
      wave = null;
      pending = null;
      continue;
    }
    if (wavesLine < 0 || wavesEnd < i) continue;

    if (line.startsWith("- name:")) {
      wave = { name: unquote(line.slice("- name:".length)), head: i, indent, tasks: null };
      waves.push(wave);
      pending = null;
      continue;
    }
    if (!wave) continue;
    if (line.startsWith("- ")) {
      if (pending === "tasks") wave.tasks.items.push(i);
      continue;
    }
    const m = line.match(/^([a-z_][a-z0-9_]*):\s*(.*)$/);
    if (!m) continue;
    pending = m[2] ? null : m[1];
    if (m[1] === "tasks") {
      wave.tasks = m[2] ? { form: "inline", line: i, indent } : { form: "block", line: i, indent, items: [] };
    }
  }
  return { lines, eof, updatedLine, wavesLine, wavesEnd, waves };
}

/**
 * Take an id out of the wave that holds it. Null when the line is not there.
 *
 * A BLOCK ITEM CARRYING A COMMENT LEAVES THE COMMENT BEHIND. `- TL-1   # the
 * parser, and nothing else` is two things on one line: a membership the tool
 * owns and a sentence it does not. Deleting the line would delete the sentence,
 * so what is left is the comment on a line of its own.
 */
function removeIdText(src, waveIndex, id) {
  const s = scan(src);
  const w = s.waves[waveIndex];
  if (!w || !w.tasks) return null;

  if (w.tasks.form === "inline") {
    const ids = inlineIds(s.lines[w.tasks.line]);
    if (!ids || ids.indexOf(id) < 0) return null;
    const line = rewriteInline(s.lines[w.tasks.line], ids.filter((t) => t !== id));
    if (line === null) return null;
    s.lines[w.tasks.line] = line;
    return s.lines.join("\n");
  }

  const at = w.tasks.items.find((i) => itemId(s.lines[i]) === id);
  if (at === undefined) return null;
  const { code, comment } = splitComment(s.lines[at]);
  if (comment.trim()) s.lines[at] = " ".repeat(indentOf(code)) + comment.trim();
  else s.lines.splice(at, 1);
  return s.lines.join("\n");
}

/** Put an id into a wave that exists, in the form that wave was written in. */
function addIdText(src, waveName, id) {
  const s = scan(src);
  const w = s.waves.find((x) => x.name === waveName);
  if (!w) return null;

  if (!w.tasks) {
    s.lines.splice(w.head + 1, 0, " ".repeat(w.indent + 2) + "tasks: [" + id + "]");
    return s.lines.join("\n");
  }
  if (w.tasks.form === "inline") {
    const ids = inlineIds(s.lines[w.tasks.line]);
    if (!ids) return null;
    const line = rewriteInline(s.lines[w.tasks.line], ids.concat([id]));
    if (line === null) return null;
    s.lines[w.tasks.line] = line;
    return s.lines.join("\n");
  }
  if (w.tasks.items.length) {
    const at = w.tasks.items[w.tasks.items.length - 1];
    s.lines.splice(at + 1, 0, " ".repeat(indentOf(s.lines[at])) + "- " + id);
    return s.lines.join("\n");
  }
  s.lines.splice(w.tasks.line + 1, 0, " ".repeat(w.tasks.indent + 2) + "- " + id);
  return s.lines.join("\n");
}

/**
 * A new wave, at the END of the order and with the caller's sentence above it.
 *
 * APPENDED, never inserted: where a wave stands is the argument the file makes,
 * and a command that guessed a position would be composing the reasoning this
 * module refuses to compose. Moving it earlier is a hand edit of one line,
 * which is a person deciding.
 */
function createWaveText(src, name, why, id) {
  const s = scan(src);
  if (s.wavesLine < 0) return null;
  const indent = s.waves.length ? s.waves[s.waves.length - 1].indent : 2;
  const at = s.wavesEnd;
  const block = [];
  if (at > 0 && s.lines[at - 1].trim()) block.push("");
  block.push(" ".repeat(indent) + "# " + why);
  block.push(" ".repeat(indent) + "- name: " + JSON.stringify(name));
  block.push(" ".repeat(indent + 2) + "tasks: [" + id + "]");
  s.lines.splice(at, 0, ...block);
  return s.lines.join("\n");
}

/** `updated:` says when a person last revised the order, so a plan that never
 *  carried the key does not gain one — inventing it would be the tool
 *  asserting something nobody claimed. */
function stampUpdated(src, day) {
  const s = scan(src);
  if (s.updatedLine < 0) return src;
  const { code, comment } = splitComment(s.lines[s.updatedLine]);
  s.lines[s.updatedLine] = code.replace(/^(\s*updated:).*$/, "$1 " + day) + comment;
  return s.lines.join("\n");
}

const shapeOf = (waves) =>
  JSON.stringify(waves.map((w) => [w.name, w.tasks, w.together]));

/**
 * ONE edit of the plan's text. PURE — text in, text out, nothing on disk.
 *
 * `problems` non-empty means the edit did NOT happen and `text` is the input,
 * byte for byte. `kind` says which exit code the refusal is worth: `usage` is
 * an invocation this file's vocabulary does not contain (an unknown wave, a
 * missing `--why`), `state` is a refusal about what the plan currently says.
 *
 * @param {string} text the file as it stands
 * @param {{op: "add"|"move"|"remove", id: string, wave?: string, why?: string,
 *          today?: string}} spec
 * @returns {{text: string, problems: string[], kind: "usage"|"state"|null}}
 */
export function editPlanText(text, spec = {}) {
  const src = String(text == null ? "" : text);
  const refuse = (kind, problems) => ({ text: src, problems, kind });

  const op = String(spec.op == null ? "" : spec.op);
  if (EDIT_SUBCOMMANDS.indexOf(op) < 0) {
    return refuse("usage", ["`" + op + "` is not a plan edit (known: " + EDIT_SUBCOMMANDS.join(", ") + ")"]);
  }
  const id = String(spec.id == null ? "" : spec.id).trim();
  if (!id) return refuse("usage", ["a plan edit names ONE task id, and this one names none"]);
  const wave = String(spec.wave == null ? "" : spec.wave).trim();
  const whyGiven = spec.why !== undefined && spec.why !== null;
  const why = whyGiven ? String(spec.why).trim() : "";

  if (op === "remove") {
    if (wave) return refuse("usage", ["`remove` takes an id and no wave — it takes the id out of whichever wave holds it"]);
    if (whyGiven) return refuse("usage", ["`--why` creates a wave, so it says nothing about a removal"]);
  } else if (!wave) {
    return refuse("usage", ["`" + op + "` needs the wave the id belongs in"]);
  }

  const { plan, problems } = parsePlanYaml(src);
  if (problems.length) {
    return refuse("state", ["the plan cannot be read, and half a plan must not be edited"].concat(problems));
  }

  const names = plan.waves.map((w) => w.name);
  const holder = plan.waves.findIndex((w) => w.tasks.indexOf(id) >= 0);
  const target = names.indexOf(wave);
  const waveList = names.length ? "the waves it has: " + names.join(" | ") : "the plan has no waves yet";

  if (op === "add" && holder >= 0) {
    return refuse("state", [
      id + " is already scheduled, in wave " + waveLabel(plan, holder),
      "an id in two waves is a defect `check --plan` refuses; `" + N + " plan move` changes where it stands",
    ]);
  }
  if (op !== "add" && holder < 0) {
    // The waves are NOT listed here: the id is what is missing, not the wave,
    // and a wall of wave names would bury the one sentence that matters.
    return refuse("state", [
      "the plan does not schedule " + id + " at all, so there is nothing to " + op,
      "`" + N + " plan --json` says what it does schedule",
    ]);
  }
  if (op !== "add") {
    // `together` says these tasks are done as ONE act. Taking one member out
    // from under the group leaves a group naming an id its wave does not
    // schedule, or one split across two waves — both errors `validatePlan`
    // reports. Refused here instead, before the write.
    for (let i = 0; i < plan.waves.length; i++) {
      const group = plan.waves[i].together.find((g) => g.indexOf(id) >= 0);
      if (!group) continue;
      return refuse("state", [
        id + " is named by a `together` group in wave " + waveLabel(plan, i) + ": [" + group.join(", ") + "]",
        "a group is done in ONE wave or it is not a group, so the group is edited by hand first",
      ]);
    }
  }

  let creating = false;
  if (op !== "remove") {
    if (target >= 0 && whyGiven) {
      return refuse("usage", [
        "the wave `" + wave + "` already exists, and `--why` creates a wave",
        "its paragraph is somebody's argument — this command will neither append to it nor replace it",
      ]);
    }
    if (target < 0 && whyGiven && !why) {
      return refuse("usage", [
        "`--why` is empty, and a new wave is the one thing here that requires prose",
        "why those tasks belong together, and why the wave stands where it does — nobody else can write it",
      ]);
    }
    if (target < 0 && !whyGiven) {
      return refuse("usage", [
        "there is no wave `" + wave + "` in this plan",
        waveList,
        "to CREATE one, say why it stands where it does: --why \"…\"",
      ]);
    }
    if (target >= 0 && target === holder) {
      return refuse("state", [id + " is already in wave " + waveLabel(plan, target)]);
    }
    creating = target < 0;
  }

  // The membership this edit is MEANT to produce, taken from the parse. The
  // text is edited below and then measured against this.
  const expected = plan.waves.map((w) => ({ name: w.name, tasks: w.tasks.slice(), together: w.together.map((g) => g.slice()) }));
  let next = src;

  if (op !== "add") {
    next = removeIdText(next, holder, id);
    if (next === null) return refuse("state", [id + " is scheduled in wave " + waveLabel(plan, holder) + ", but no line of the file spells it out"]);
    expected[holder].tasks = expected[holder].tasks.filter((t) => t !== id);
  }
  if (op !== "remove") {
    if (creating) {
      next = createWaveText(next, wave, why, id);
      if (next === null) return refuse("state", ["this plan has no `waves:` section, so a wave cannot be added to it"]);
      expected.push({ name: wave, tasks: [id], together: [] });
    } else {
      next = addIdText(next, wave, id);
      if (next === null) return refuse("state", ["wave " + waveLabel(plan, target) + " has no `tasks:` line this writer could extend"]);
      expected[target].tasks.push(id);
    }
  }
  next = stampUpdated(next, String(spec.today || todayStamp()));

  // THE WRITER CHECKS ITS OWN WORK. The line scan decided where the bytes went;
  // this decides whether the file now says what the edit meant, and nothing
  // else. Anything unexpected is returned as a refusal with the file untouched.
  const after = parsePlanYaml(next);
  if (after.problems.length) {
    return refuse("state", ["the edit would leave a plan that cannot be read, so it was not made"].concat(after.problems));
  }
  if (shapeOf(after.plan.waves) !== shapeOf(expected)) {
    return refuse("state", [
      "the edit could not be made without disturbing the rest of the file, so it was not made",
      "expected: " + shapeOf(expected),
      "would be: " + shapeOf(after.plan.waves),
    ]);
  }
  return { text: next, problems: [], kind: null };
}

/**
 * The errors this edit would ADD, in the guard's own words.
 *
 * WHY THE DIFFERENCE AND NOT THE VERDICT. A plan can already be in error — a
 * wave naming a task somebody deleted is exactly the state `plan remove` exists
 * to repair — and refusing every edit until it is clean would leave the repair
 * to the hand editing this command replaces. What may not happen is an edit
 * that makes the order unexecutable, so that is what is measured.
 */
export function newPlanErrors(before, after, tasks, config) {
  const was = new Set(validatePlan(parsePlanYaml(before).plan, tasks, config).errors);
  return validatePlan(parsePlanYaml(after).plan, tasks, config).errors.filter((e) => !was.has(e));
}

const FLAGS = { "--wave": "wave", "--why": "why" };

/**
 * `--` ENDS FLAG READING (TL-248), the shape TL-58 settled for `new`.
 *
 * Without a separator a value beginning with a dash is still refused, and that
 * heuristic stays: `--why --wave 3` is overwhelmingly a mistake, and a wave
 * introduced by the paragraph "--wave" is the silent no-op this tool refuses to
 * be. The price was that a reason which LEGITIMATELY begins with a dash had no
 * way in at all — and `--why` is the flag that hurts, because it takes a
 * sentence and this project's sentences are about flags.
 *
 * The separator is that way in, in the form a user already knows from `git` and
 * `rm`: the flag before it takes the next argument WHATEVER it looks like, and
 * nothing beyond the separator is read as a flag. The second half is why this
 * is not merely a leading dash being tolerated: `--why -- --wave` must record
 * the reason "--wave", not also take the word after it as a wave name.
 *
 * WHAT DIFFERS FROM `new`: this command takes a positional id. A non-flag
 * argument BEFORE the separator is therefore an id rather than an error — but
 * one past the separator's value is refused BY NAME, because the separator
 * stops flag reading and does not open a second place to name a task. Collected
 * as an id it would surface as "one task id, and this names 2", a message about
 * the wrong mistake.
 *
 * A THIRD CALL SITE, NOT A SHARED PARSER. Two are not yet an argument for
 * extracting one, and an extraction would touch every command at once; TL-247
 * (global flags past the separator) and TL-220 (the four shapes of an unknown
 * flag) are where that question belongs.
 */
function parseEditArgs(argv) {
  const values = {};
  const ids = [];
  const sep = argv.indexOf("--");
  const flags = sep < 0 ? argv : argv.slice(0, sep);
  const literal = sep < 0 ? [] : argv.slice(sep + 1);
  for (let i = 0; i < flags.length; i++) {
    const a = flags[i];
    if (!a.startsWith("-")) {
      if (i > 0 && FLAGS[flags[i - 1]]) continue; // the previous flag's value
      ids.push(a);
      continue;
    }
    if (!FLAGS[a]) return { error: "unknown flag: " + a };
    // Only the LAST flag before the separator reaches past it, and only that
    // one is exempt from the dash heuristic.
    const beyond = i + 1 === flags.length;
    const value = beyond ? literal[0] : flags[i + 1];
    if (value === undefined || (!beyond && value.startsWith("-"))) return { error: a + " requires a value" };
    values[FLAGS[a]] = value;
  }
  const spent = flags.length > 0 && FLAGS[flags[flags.length - 1]] ? 1 : 0;
  if (literal.length > spent) return { error: "unexpected argument: " + literal[spent] };
  return { values, ids };
}

/**
 * `plan add | move | remove` — the disk read, the exit codes and the write.
 *
 * Exit: 0 written · 1 refused by the plan or the tree · 2 the invocation was
 * wrong. NOTHING is printed on stdout by a refusal, and nothing is written by
 * one either: a command that reported a problem and had already moved half the
 * change is the defect this module exists for.
 */
export function runPlanEdit(op, argv) {
  const command = N + " plan " + op;
  const cli = takeDirFlag(argv);
  const parsed = parseEditArgs(cli.argv);
  const usage = [
    "usage: " + N + " plan add <ID> --wave \"<name>\" [--why \"<sentence>\"]",
    "       " + N + " plan move <ID> --wave \"<name>\" [--why \"<sentence>\"]",
    "       " + N + " plan remove <ID>",
  ];
  if (parsed.error) return fail(command, parsed.error, usage, [N + " plan --help"]);
  if (parsed.ids.length !== 1) {
    return fail(command, "one task id, and this names " + (parsed.ids.length || "none"), usage, [N + " plan --help"]);
  }
  const id = parsed.ids[0];

  const root = resolveBacklogDirOrExit({ dir: cli.dir, moduleDir: HERE }, command).root;
  const config = loadConfigOrExit(root);
  const paths = backlogPaths(root);
  if (!existsSync(paths.planPath)) {
    return fail(command, "there is no plan to edit", [
      "expected: " + paths.planPath,
      "The execution order is an optional decision. A file created by this command would",
      "be a plan with an order and no argument for it, which is the one thing the tool",
      "will not write.",
    ], [], 1);
  }
  const before = readFileSync(paths.planPath, "utf8");
  const tasks = readTaskMetas(paths.tasksDir, config);

  // A SCHEDULING ACT ASSERTS THE WORK EXISTS, so an id no task file carries is
  // refused rather than written into a wave — `check --plan` would report it a
  // moment later. `remove` is exempt on purpose: an id whose task is gone is
  // precisely what a removal repairs.
  if (op !== "remove" && !tasks.some((t) => t.id === id)) {
    return fail(command, id + " is not a task in this backlog", [
      "read from " + paths.tasksDir,
      "The plan schedules work; a wave naming an id nothing in the tree carries is a defect,",
      "not a placeholder.",
    ], [N + " new --title \"…\""], 1);
  }

  const edit = editPlanText(before, { op, id, wave: parsed.values.wave, why: parsed.values.why });
  if (edit.problems.length) {
    const [head, ...rest] = edit.problems;
    console.error(failure(command, head, rest, [N + " plan --help"]));
    return edit.kind === "usage" ? 2 : 1;
  }

  const introduced = newPlanErrors(before, edit.text, tasks, config);
  if (introduced.length) {
    // The guard's wording, not a second one: one defect must not have two.
    reportPlanErrors(introduced);
    return 1;
  }

  writeFileSync(paths.planPath, edit.text, "utf8");
  const plan = parsePlanYaml(edit.text).plan;
  const at = plan.waves.findIndex((w) => w.tasks.indexOf(id) >= 0);
  console.log(
    color.ok(MARK.ok) + " plan: " +
      (op === "remove"
        ? id + " is no longer scheduled"
        : id + (op === "add" ? " is scheduled in" : " moved to") + " wave " + waveLabel(plan, at))
  );
  if (parsed.values.why) console.log("  the wave was created, with your sentence above it");
  console.log("  " + paths.planPath + " — the change is the diff of this one file, and of nothing else");
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("plan-write.mjs")) {
  const sub = process.argv[2];
  if (EDIT_SUBCOMMANDS.indexOf(sub) < 0) {
    console.error(failure(N + " plan", sub ? "unknown subcommand: " + sub : "no subcommand",
      ["available: " + EDIT_SUBCOMMANDS.join(", ")], [N + " plan --help"]));
    process.exit(2);
  }
  process.exit(runPlanEdit(sub, process.argv.slice(3)));
}
