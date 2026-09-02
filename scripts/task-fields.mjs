#!/usr/bin/env node
/**
 * Task frontmatter — schema, parsing, editing and diffing (BL-1396/BL-1397).
 *
 * ONE place decides what a task field is: which fields exist, which of them a
 * human may edit, what values are legal, how a value is written back into the
 * `.md` and how two versions of a task differ. The server validates with this
 * module, the viewer renders its editors from the same specs, and the history
 * recorder diffs with the same comparison — so a new field or a new status is
 * added once, not three times.
 *
 * Constraints this file must keep:
 *   - No imports. Its SOURCE is pasted into the generated viewer HTML
 *     (`build-viewer.mjs`), exactly like `viewer-url.mjs`, so the browser runs
 *     the same code `node --test` runs. An `import` line would break the page.
 *   - No filesystem access — pure text in, text out. Anything touching disk
 *     lives in `history.mjs` / `serve-backlog.mjs`.
 *
 * Tests: `node --test backlog/scripts/tests/task-fields.test.mjs`
 */

// ──────────────────────────────────────────────────────────────────────────
// The SHAPE of the fields — with no values (BL-1400)
// ──────────────────────────────────────────────────────────────────────────
//
// This file knows WHICH fields a task has and how they are written. It does NOT
// know which statuses or labels exist in a particular project — those are data,
// they live in `config.yaml` and reach here through `buildFieldSpecs(config)`.
// Until BL-1400 one organisation's seven statuses and seven labels stood here,
// which made the module that organisation's tool rather than a tool.
//
// `dictionary` names the configuration key the vocabulary of values comes from.
// `suggestFrom` — the same, but as suggestions (the field stays open).
// `dynamic` — a set that neither the code nor the configuration knows, because
// it follows from the data (the epics and owners occurring in the tasks); the
// caller supplies it.

// ──────────────────────────────────────────────────────────────────────────
// Role — WHO MAY take a task (TL-97)
// ──────────────────────────────────────────────────────────────────────────
//
// Three words that are easy to collapse into one, and must not be:
//
//   role   who MAY take the task    frontmatter (this field)
//   owner  who holds it NOW         frontmatter
//   actor  who wrote the change     history
//
// The VOCABULARY is the project's (`roles:` in config.yaml) — a team without an
// analyst does not declare one. This file only knows that the field exists, that
// it is optional, and that its values come from that key.
//
// The shape is a lowercase slug, like an actor name: a role is an identifier a
// dispatcher matches on and a caller types as a flag value, so `Data Analyst`
// would be equal to `data analyst` in whichever comparison happened to lowercase
// and unequal in the next one.
export const ROLE_SHAPE = /^[a-z0-9][a-z0-9._-]{0,62}$/;

// ──────────────────────────────────────────────────────────────────────────
// Actor identity (BL-1404 step 4)
// ──────────────────────────────────────────────────────────────────────────
//
// `<namespace>:<name>`. The namespace says HOW MUCH the attribution is worth —
// exactly as `source` says which route it arrived by:
//   local:<nick>  — declared on somebody's machine, UNVERIFIED
//   agent:<name>  — an automated writer (a hook, CI)
//   user:<id>     — an account AUTHENTICATED by the server
//   unknown       — nobody knows; the only value with no namespace
//
// The code DOES NOT GUESS the namespace. A bare name in a NEW record is an
// absence of declaration, so it lands as `unknown` — adding `local:` wholesale
// would be inventing, and would incidentally reclassify an agent as a person.
//
// Entries from before BL-1404 stay in the log byte for byte (append-only; we do
// not rewrite history). On READ they are given the namespace `legacy` — which is
// the truth about them, unlike forcing them into one of today's categories.
export const ACTOR_NAMESPACES = ["local", "agent", "user"];
export const ACTOR_UNKNOWN = "unknown";

const ACTOR_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,62}$/;
const ACTOR_RE = /^(local|agent|user):[a-z0-9][a-z0-9._-]{0,62}$/;

export function isValidActor(actor) {
  if (typeof actor !== "string") return false;
  return actor === ACTOR_UNKNOWN || ACTOR_RE.test(actor);
}

export function normalizeActor(actor) {
  return isValidActor(actor) ? actor : ACTOR_UNKNOWN;
}

// ── The reason for a change (TL-105) ─────────────────────────────────────
//
// WHY A FIELD AND NOT PROSE IN THE TASK FILE. The record says WHAT changed —
// `field`, `from`, `to`, `actor`, `source`, `ts` — and had nowhere to say WHY.
// The why was meant to live in a `## Log` section written by hand, in a second
// place, on trust. `actor` in the same repository has a hundred per cent
// presence, and the difference is not the diligence of the writers: `actor` is
// REFUSED at write time when it has no namespace, and prose was a request in the
// documentation.
//
// WHY `unknown` IS A VALUE AND NOT AN EMPTY STRING. Reconciliation sees a change
// that already happened, in a file somebody edited outside the tool; nobody can
// be asked why. "" would read as "no reason needed", which is a different claim
// and one nothing here can support. `unknown` says which of the two it is —
// exactly the choice already made for the actor.
export const REASON_UNKNOWN = "unknown";

// WHY THERE IS A SECOND SENTINEL. Closing a task with `done` runs its
// `verification:` and refuses on the first failure, so the "why" of that
// transition is a recorded run, not an opinion — and the run is already in the
// history as `__verified__` entries beside it. Demanding a sentence there would
// buy nothing and teach people to type "done" into a reason box, which is how a
// required field turns into noise. `proven` says which of the two kinds of
// answer this entry carries; writing prose on the closer's behalf would not.
export const REASON_PROVEN = "proven";

/** The values that are NOT somebody's sentence. Reserved, so a person cannot
 *  type them and have a machine claim read as their own words. */
export const REASON_SENTINELS = [REASON_UNKNOWN, REASON_PROVEN];

/** The longest reason kept in one entry. A reason is one sentence about one
 *  change; a treatise belongs in the task body, which has no limit. */
export const REASON_MAX_LENGTH = 500;

export function isValidReason(reason) {
  if (typeof reason !== "string") return false;
  const trimmed = reason.trim();
  if (REASON_SENTINELS.indexOf(trimmed) !== -1) return false;
  return trimmed.length > 0 && trimmed.length <= REASON_MAX_LENGTH;
}

/** Never invents: anything that is not a usable reason becomes `unknown`. */
export function normalizeReason(reason) {
  if (typeof reason !== "string") return REASON_UNKNOWN;
  const trimmed = reason.trim().replace(/\s+/g, " ");
  if (!trimmed) return REASON_UNKNOWN;
  return trimmed.slice(0, REASON_MAX_LENGTH);
}

/** Whether an entry carries a reason somebody actually gave — a sentinel is an
 *  answer about the KIND of answer, not the answer. */
export function hasStatedReason(entry) {
  return isValidReason(entry && entry.reason);
}

/**
 * Splitting an actor into namespace and name — for display and for grouping.
 * A bare name (an entry from before BL-1404) is given the namespace `legacy`,
 * because that is all that is known about it: it was created before the
 * convention existed. Forcing it into one of today's categories would be
 * inventing — some of those names were agents and some were people, and a
 * wholesale `local:` would reclassify the first kind as the second.
 */
export function actorParts(actor) {
  const raw = typeof actor === "string" ? actor : "";
  if (raw === ACTOR_UNKNOWN || !raw) return { namespace: ACTOR_UNKNOWN, name: ACTOR_UNKNOWN };
  const i = raw.indexOf(":");
  if (i === -1) {
    return ACTOR_NAME_RE.test(raw)
      ? { namespace: "legacy", name: raw }
      : { namespace: ACTOR_UNKNOWN, name: ACTOR_UNKNOWN };
  }
  const namespace = raw.slice(0, i);
  const name = raw.slice(i + 1);
  if (ACTOR_NAMESPACES.indexOf(namespace) === -1 || !ACTOR_NAME_RE.test(name)) {
    return { namespace: ACTOR_UNKNOWN, name: ACTOR_UNKNOWN };
  }
  return { namespace, name };
}

// ──────────────────────────────────────────────────────────────────────────
// History pseudo-fields (BL-1397, extended in BL-1404)
// ──────────────────────────────────────────────────────────────────────────
//
// Events concerning the WHOLE task, not a single frontmatter value. They live
// here rather than in history.mjs for one reason: this file is pasted into the
// viewer BY SOURCE, so the browser and node see the same list. Previously the
// viewer had its own hand-copied version — exactly the class of "the same
// decision in two places".
//
// __body__ is RESERVED, not implemented (BL-1404 step 5) — body history is the
// plan in docs/worktrail-state-and-sync.md §5.2-5.3; // product-name: allow
// the schema admits it today so that adding it is an append rather than a
// migration of somebody's existing data. __comment__ was reserved the same way
// and is now WRITTEN, first by `handoff` (TL-99).
export const FIELD_CREATED = "__created__";
export const FIELD_DELETED = "__deleted__";
export const FIELD_BODY = "__body__";
// A message about the task rather than a change to it (TL-99). The whole
// content is `to`; `from` is empty, because a comment replaces nothing. Unlike
// `__created__` it is NOT deduplicated by event: two identical comments at
// different times are two things somebody said, and collapsing them would edit
// a conversation. It carries an id of its own, which is what an answer can point
// at — `__decision__` (TL-114) resolves a comment, and nothing can point at the
// reason attached to a field.
export const FIELD_COMMENT = "__comment__";
// A person vouching for a `manual:` verification entry at closing time (TL-82).
// A pseudo-field, because it describes an EVENT and not a value: nothing in the
// frontmatter changes, so `diffMeta` cannot see it, and without a record of its
// own the only thing a manual entry has to offer instead of a command — who
// stood behind it — would leave no trace at all.
export const FIELD_VERIFIED = "__verified__";

// A task taken by somebody outside the role it asks for (TL-97). A
// pseudo-field for the same reason as `__verified__`: nothing in the frontmatter
// changes, so `diffMeta` cannot see it. `from` is the role the task asks for,
// `to` the role the caller declared.
//
// WHY IT IS RECORDED AND NOT REFUSED. `role:` exists so that a queue running
// with nobody watching does not hand an analyst's decision to a developer —
// that gate belongs to the dispatcher (TL-98). A person naming a task
// outranks it: blocking `take` would mean an explicit human instruction loses
// to a hint in a file. What is left is the trace, so that "who did this, and
// were they the intended one" is answerable afterwards.
export const FIELD_ROLE_OVERRIDE = "__role_override__";

// A decision recorded as an event of its own (TL-114). The whole content is
// `to`, exactly like a comment, and an optional `resolves` carries the id of the
// event it answers.
//
// WHY NOT A FLAG ON A COMMENT. The two are told apart MACHINE-SIDE, not
// stylistically: the panel counts "questions with no decision" and the graph
// draws decisions as nodes. A boolean on a comment would make both of those a
// scan for a convention rather than a lookup of an event type, and a convention
// is what somebody forgets to write.
//
// AN AGENT'S DECISION AND A PERSON'S ARE THE SAME SHAPE. What separates them is
// the actor's namespace, so "which decisions did an agent make" stays one filter
// over `actor` instead of a second schema that has to be kept in step.
export const FIELD_DECISION = "__decision__";

export const PSEUDO_FIELDS = [FIELD_CREATED, FIELD_DELETED, FIELD_BODY, FIELD_COMMENT, FIELD_VERIFIED, FIELD_ROLE_OVERRIDE, FIELD_DECISION];

export function isPseudoField(key) {
  return PSEUDO_FIELDS.indexOf(key) !== -1;
}

/**
 * How ONE history entry reads. PURE, and here rather than inside the viewer's
 * template because a decision written into that template cannot be run from a
 * test — an assertion on the page's HTML passes just as happily for a branch
 * that never fires (the shape TL-124 settled on for `elsewhere`).
 *
 *   message      the whole content is `to` — a comment replaces nothing, so
 *                rendering it as a transition would print an arrow pointing at
 *                the text and strike out an empty half
 *   event        a label alone: something happened, and neither end of a
 *                comparison says what (`__verified__`)
 *   transition   from → to, which is what a field change is
 */
export function historyEntryKind(entry) {
  const field = entry && entry.field;
  if (field === FIELD_COMMENT || field === FIELD_DECISION) return "message";
  if (isPseudoField(field)) return entry.from && entry.to ? "transition" : "event";
  return "transition";
}

export const FIELD_SHAPES = [
  { key: "title", label: "Title", kind: "text", maxLengthFrom: "titleMaxLength" },
  { key: "status", label: "Status", kind: "enum", dictionary: "statuses" },
  { key: "priority", label: "Priority", kind: "enum", dictionary: "priorities" },
  { key: "type", label: "Type", kind: "enum", dictionary: "types" },
  // `allowEmpty`, because "nobody holds this" is a real state and it is the
  // ABSENCE of a claim, not a value (TL-99). `handoff` clears the field, and a
  // spec that called that invalid while a command wrote it would be two answers
  // to one question. The alternative — writing a word like "unassigned" — puts
  // one project's vocabulary into everybody's tree; `owners:` is where a project
  // keeps its own, and nothing in it says which entry means nobody.
  { key: "owner", label: "Owner", kind: "text", dynamic: "owners", suggestFrom: "owners", allowEmpty: true },
  // `dictionaryRequired` is what separates this from every other enum: an empty
  // `roles:` must NOT degrade the field to free text (see buildFieldSpecs).
  { key: "role", label: "Role", kind: "enum", dictionary: "roles", allowEmpty: true, dictionaryRequired: true },
  { key: "estimate", label: "Estimate", kind: "text", suggestFrom: "estimates" },
  { key: "confidence", label: "Confidence", kind: "enum", dictionary: "confidence", allowEmpty: true },
  { key: "board", label: "Board", kind: "enum", dynamic: "boards" },
  { key: "epic", label: "Epic", kind: "text", dynamic: "epics", allowEmpty: true },
  { key: "labels", label: "Labels", kind: "list", style: "inline", dictionary: "labels", closedFrom: "labelsClosed" },
  // `itemPattern` is closed with the configured prefix in buildFieldSpecs
  // (BL-1452); `TASK` is only a fallback for calls made without a configuration.
  { key: "blocked_by", label: "Blocked by", kind: "list", style: "inline", prefixed: true, itemPattern: "^TASK-[0-9]+$", itemHint: "TASK-123" },
  { key: "blocks", label: "Blocks", kind: "list", style: "inline", prefixed: true, itemPattern: "^TASK-[0-9]+$", itemHint: "TASK-123" },
  // WHO MAY DO IT, as opposed to WHAT COMPETENCE IT NEEDS (TL-113). `role` is
  // the project's vocabulary; this is the SHAPE of the field, fixed in code and
  // deliberately absent from config.yaml — the same arrangement the actor
  // namespaces have had since TL-21. A project does not get to invent a third
  // species of executor, because the dispatcher would have nothing to compare it
  // against: it reads the caller's species off the actor's namespace, and that
  // list is closed too.
  //
  // `agent` is admitted for symmetry — a task a person should not do by hand, a
  // bulk migration — but the case that designed the field is `human`: a product
  // decision no agent may take, whatever its role.
  { key: "executor", label: "Executor", kind: "enum", values: ["human", "agent"], allowEmpty: true, dictionaryRequired: true },
  { key: "related_docs", label: "Related docs", kind: "list", style: "block", itemHint: "docs/x.md" },
];

/**
 * The canonical key order, used ONLY when a key is missing and has to be
 * inserted. Existing keys are never reordered — task files in the wild differ in
 * their order (some have `epic` before `board`), and rewriting it would turn
 * editing one field into a diff of the whole file.
 */
export const FRONTMATTER_ORDER = [
  "id", "title", "type", "labels", "board", "epic", "priority", "status",
  "owner", "role", "estimate", "confidence", "created", "updated",
  "blocked_by", "blocks", "related_docs", "verification",
];

/** The fields a parsed task carries and the history compares. */
export const TRACKED_FIELDS = FIELD_SHAPES.map((f) => f.key).concat(["created"]);

/**
 * Shape plus values from the configuration make the concrete field specs the
 * server validates against and the viewer draws editors from.
 *
 * @param {object} config the result of `loadConfig()` from config.mjs
 */
export function buildFieldSpecs(config) {
  const cfg = config || {};
  return FIELD_SHAPES.map((shape) => {
    const spec = {
      key: shape.key,
      label: shape.label,
      kind: shape.kind,
    };
    if (shape.style) spec.style = shape.style;
    if (shape.allowEmpty) spec.allowEmpty = true;
    if (shape.dictionaryRequired) spec.dictionaryRequired = true;
    if (shape.itemPattern) spec.itemPattern = shape.itemPattern;
    if (shape.itemHint) spec.itemHint = shape.itemHint;
    // Fields holding task ids close their pattern with the PROJECT prefix
    // (BL-1452). Without that the viewer would reject valid numbers from every
    // backlog that does not use the prefix hardcoded here.
    if (shape.prefixed && cfg.taskIdPrefix) {
      const p = String(cfg.taskIdPrefix).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      spec.itemPattern = "^" + p + "-[0-9]+$";
      spec.itemHint = cfg.taskIdPrefix + "-123";
    }
    // A vocabulary written HERE rather than read from the configuration: the
    // field's shape is the tool's, not the project's (see `executor` above).
    if (shape.values) {
      spec.options = shape.values.slice();
      // Marked so a report can say WHERE the vocabulary lives. Told that a value
      // "diverges from config.yaml", a reader would go and edit a key that is not
      // there.
      spec.fixed = true;
    }
    if (shape.dynamic) spec.dynamic = shape.dynamic;
    if (shape.dictionary) {
      spec.options = cfg[shape.dictionary] || [];
      // The configuration KEY name, not guessed from the field name (TL-50):
      // `status` lives under `statuses`, `priority` under `priorities`. Appending
      // A naive "add an s" produced `statuss:` in the hint — a message pointing
      // at a key that does not exist is worse than a message with no hint.
      spec.dictionary = shape.dictionary;
    }
    if (shape.suggestFrom) spec.suggest = cfg[shape.suggestFrom] || [];
    if (shape.closedFrom) spec.closed = !!cfg[shape.closedFrom];
    if (shape.maxLengthFrom && cfg[shape.maxLengthFrom]) spec.maxLength = cfg[shape.maxLengthFrom];
    // An enum with neither a vocabulary nor a dynamic set would be a field that
    // cannot be set to anything. Such a case behaves like text.
    //
    // EXCEPT when the field REQUIRES its dictionary (TL-97). For `role`, an
    // undeclared vocabulary is an answer — "this project does not use roles" —
    // and the free text this branch would fall back to is precisely the phantom
    // value the field exists to make impossible. It stays an enum whose only
    // legal value is the empty one; `normalizeValue` says so by name.
    if (spec.kind === "enum" && !spec.dynamic && !spec.dictionaryRequired &&
        !(spec.options && spec.options.length)) {
      spec.kind = "text";
    }
    return spec;
  });
}

/**
 * Do the VALUES in the tree fit inside the configuration's vocabularies
 * (TL-62)?
 *
 * WHY A SEPARATE FUNCTION. The vocabularies are enforced today on WRITE —
 * The `new` command refuses a value outside `types` — and not on read. The effect is
 * the opposite of the intention: a tree may violate the vocabulary from end to
 * end without a word of protest, and the only thing blocked is adding one more
 * file exactly like all the existing ones. This function puts the same question
 * to the read path.
 *
 * BOARD IS SKIPPED DELIBERATELY — it has its own guard with its own message
 * (`check --boards`), and two voices about the same file read as two problems.
 *
 * Empty values are not a violation: an unset field is an absence of an answer,
 * not a wrong answer. Deciding which fields are mandatory belongs to the guards.
 *
 * @param {Array<object>} metas the results of `extractMeta()`
 * @param {object} config the result of `loadConfig()`
 * @returns {Array<{field: string, label: string, allowed: string[], found: Array<{value: string, count: number}>}>}
 */
export function auditVocabulary(metas, config) {
  // AN EMPTY VOCABULARY IS NOT THE SAME ANSWER IN BOTH KINDS. For an enum it
  // means the field has no vocabulary to be judged against, and `buildFieldSpecs`
  // already refuses that shape. For a CLOSED list it is a decision — `labels: []`
  // under `labels_closed: true` says "no labels at all" — and the write path
  // enforces exactly that. Skipping it here would leave the one asymmetry this
  // function exists to close (TL-56).
  //
  // A `dictionaryRequired` enum is judged even when its vocabulary is EMPTY
  // (TL-97): there, an empty vocabulary is the project saying it does not use
  // the field at all, so every non-empty value in the tree is outside it. That is
  // the one case where an empty `options` carries a verdict rather than an
  // absence of one.
  const specs = buildFieldSpecs(config).filter(
    (f) => f.key !== "board" && !f.dynamic && f.options &&
      ((f.kind === "enum" && (f.options.length || f.dictionaryRequired)) ||
        (f.kind === "list" && f.closed))
  );

  const out = [];
  for (const spec of specs) {
    const counts = new Map();
    for (const meta of metas) {
      const raw = meta ? meta[spec.key] : undefined;
      const values = Array.isArray(raw) ? raw : [raw];
      for (const v of values) {
        const value = String(v == null ? "" : v).trim();
        if (!value) continue;
        if (spec.options.indexOf(value) >= 0) continue;
        counts.set(value, (counts.get(value) || 0) + 1);
      }
    }
    if (counts.size) {
      out.push({
        field: spec.key,
        fixed: !!spec.fixed,
        dictionary: spec.dictionary || spec.key,
        label: spec.label,
        allowed: spec.options.slice(),
        found: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count })),
      });
    }
  }
  return out;
}

export function fieldSpec(key, fields) {
  const list = fields || [];
  for (const f of list) if (f.key === key) return f;
  return null;
}

export function isEditableField(key, fields) {
  return fieldSpec(key, fields) !== null;
}

// ──────────────────────────────────────────────────────────────────────────
// Frontmatter parsing (the subset documented in _template.md)
// ──────────────────────────────────────────────────────────────────────────

export function splitFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { frontmatter: "", body: text };
  return { frontmatter: match[1], body: match[2] };
}

export function extractMeta(frontmatter) {
  const get = (key) => {
    const m = frontmatter.match(new RegExp("^" + key + ":\\s*(.+?)\\s*$", "m"));
    if (!m) return null;
    return unquote(stripComment(m[1]));
  };
  const getInlineList = (key) => {
    const m = frontmatter.match(new RegExp("^" + key + ":\\s*\\[(.*?)\\]", "m"));
    if (!m) return [];
    return m[1].split(",").map((s) => unquote(s.trim())).filter(Boolean);
  };
  const getBlockList = (key) => {
    const re = new RegExp("^" + key + ":\\s*\\n((?:\\s{2,}-\\s+.*\\n?)+)", "m");
    const m = frontmatter.match(re);
    if (!m) return [];
    return m[1]
      .split("\n")
      .map((l) => unquote(stripComment(l.replace(/^\s*-\s*/, "").trim())))
      .filter(Boolean);
  };

  return {
    id: get("id"),
    title: get("title") || "",
    type: get("type"),
    labels: getInlineList("labels"),
    board: get("board") || "",
    epic: get("epic") || "",
    priority: get("priority"),
    status: get("status"),
    owner: get("owner"),
    role: get("role") || "",
    executor: get("executor") || "",
    estimate: get("estimate"),
    confidence: get("confidence"),
    created: get("created"),
    updated: get("updated"),
    blocked_by: getInlineList("blocked_by"),
    blocks: getInlineList("blocks"),
    related_docs: getBlockList("related_docs"),
  };
}

/**
 * Drop a trailing `# comment` — but only one that is actually a comment, i.e.
 * at the start of the line or preceded by whitespace, and outside quotes.
 * `title: "Fix #42 in parser"` and `epic: "v1.0 #launch"` keep their hash.
 *
 * EXPORTED because a comment beside a field is a convention of the WHOLE
 * format — `_template.md` annotates eight fields that way — so every reader of
 * a frontmatter line owes the value the same treatment. Five readers each had
 * their own `.replace(/^["\']|["\']$/g, "")` instead, and each returned the
 * comment as part of the value (TL-70).
 */
export function stripComment(raw) {
  let quote = null;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "#" && (i === 0 || /\s/.test(raw[i - 1]))) return raw.slice(0, i).trimEnd();
  }
  return raw.trimEnd();
}

/** The value without its surrounding quotes. Exported for the same reason as
 *  `stripComment()`: one convention, one implementation (TL-70). */
export function unquote(s) {
  const v = String(s == null ? "" : s).trim();
  if (v.length >= 2 && ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'"))) {
    return v.slice(1, -1).replace(/\\"/g, '"');
  }
  return v;
}

// ──────────────────────────────────────────────────────────────────────────
// Validation / normalisation
// ──────────────────────────────────────────────────────────────────────────

/**
 * @param {string} key
 * @param {string|string[]} value  raw value from the client
 * @param {{options?: Record<string,string[]>}} ctx  runtime option sets for
 *        `dynamic` fields, e.g. `{ options: { boards: ["main", ...] } }`.
 *        A dynamic field with no supplied set is NOT validated against a
 *        dictionary — better an unchecked board than a viewer that refuses a
 *        board added after it was built.
 * @returns {{ok: boolean, value?: string|string[], error?: string}}
 */
export function normalizeValue(key, value, ctx) {
  const spec = fieldSpec(key, (ctx && ctx.fields) || []);
  if (!spec) return { ok: false, error: "This field is not editable: " + key };
  const opts = (ctx && ctx.options) || {};

  if (spec.kind === "list") {
    const items = (Array.isArray(value) ? value : String(value == null ? "" : value).split(","))
      .map((s) => String(s).trim())
      .filter(Boolean);
    const seen = [];
    for (const item of items) {
      if (item.indexOf("\n") >= 0) return { ok: false, error: "A value cannot contain a newline" };
      if (spec.closed && spec.options && spec.options.indexOf(item) < 0) {
        return { ok: false, error: "Unknown value \"" + item + "\" — allowed: " + spec.options.join(", ") };
      }
      if (spec.itemPattern && !new RegExp(spec.itemPattern).test(item)) {
        return { ok: false, error: "\"" + item + "\" does not match the format " + (spec.itemHint || spec.itemPattern) };
      }
      if (seen.indexOf(item) < 0) seen.push(item);
    }
    return { ok: true, value: seen };
  }

  const raw = String(value == null ? "" : value).trim();
  if (raw.indexOf("\n") >= 0) return { ok: false, error: "A value cannot contain a newline" };
  if (!raw && !spec.allowEmpty) return { ok: false, error: (spec.label || key) + " cannot be empty" };
  if (spec.maxLength && raw.length > spec.maxLength) {
    return { ok: false, error: (spec.label || key) + ": max " + spec.maxLength + " characters (got " + raw.length + ")" };
  }

  const dictionary = spec.dynamic ? opts[spec.dynamic] : spec.options;
  // The vocabulary this field cannot do without is not declared (TL-97). The
  // message names the KEY rather than listing what is allowed, because nothing
  // is: the way out is to declare the vocabulary, not to guess a value.
  if (spec.kind === "enum" && spec.dictionaryRequired && raw && !(dictionary && dictionary.length)) {
    return {
      ok: false,
      error: "Unknown value \"" + raw + "\" — `" + (spec.dictionary || spec.key) +
        ":` is not declared in config.yaml, so this backlog does not use " +
        (spec.label || spec.key).toLowerCase() + "s",
    };
  }
  if (spec.kind === "enum" && dictionary && dictionary.length) {
    if (raw === "" && spec.allowEmpty) return { ok: true, value: raw };
    if (dictionary.indexOf(raw) < 0) {
      return { ok: false, error: "Unknown value \"" + raw + "\" — allowed: " + dictionary.join(", ") };
    }
  }
  return { ok: true, value: raw };
}

// ──────────────────────────────────────────────────────────────────────────
// Writing a field back into the file
// ──────────────────────────────────────────────────────────────────────────

const NEEDS_QUOTES = /^[\s]|[\s]$|^$|^[-?:,\[\]{}#&*!|>'"%@`]|:\s|\s#|["'\\]/;

export function yamlScalar(value) {
  const v = String(value == null ? "" : value);
  if (NEEDS_QUOTES.test(v)) return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  return v;
}

/** Frontmatter lines for one field — the only place that knows the layout. */
export function shapeFor(key) {
  for (const f of FIELD_SHAPES) if (f.key === key) return f;
  return null;
}

export function serializeField(key, value, spec) {
  // The shape (inline versus block list) does NOT depend on the configuration,
  // so when the caller passes no spec we take it from FIELD_SHAPES. Otherwise an
  // omitted argument would write a list as a scalar — silently and irreversibly.
  spec = spec || shapeFor(key);
  const style = spec && spec.style;
  if (spec && spec.kind === "list") {
    const items = (value || []).map((v) => yamlScalar(v));
    if (style === "block") {
      if (!items.length) return [key + ": []"];
      return [key + ":"].concat(items.map((v) => "  - " + v));
    }
    return [key + ": [" + items.join(", ") + "]"];
  }
  return [key + ": " + yamlScalar(value)];
}

/**
 * Replace (or insert) one key in the frontmatter, leaving every other byte of
 * the file untouched — including the trailing `# comment` on the edited line,
 * which is carried over rather than dropped.
 *
 * Throws when the file has no frontmatter: silently appending one would
 * produce a task the build script cannot read.
 */
export function setFrontmatterField(text, key, value, spec) {
  const match = text.match(/^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n)([\s\S]*)$/);
  if (!match) throw new Error("The file has no YAML frontmatter");
  const [, open, fm, close, body] = match;

  const lines = fm.split("\n");
  const topLevelKey = (line) => {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):/);
    return m ? m[1] : null;
  };

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (topLevelKey(lines[i]) === key) { start = i; break; }
  }

  const newLines = serializeField(key, value, spec);

  if (start >= 0) {
    // The entry spans its own line plus any indented continuation lines.
    let end = start + 1;
    while (end < lines.length && /^\s+\S/.test(lines[end])) end++;
    const comment = trailingComment(lines[start]);
    if (comment) newLines[0] = newLines[0] + "  " + comment;
    lines.splice(start, end - start, ...newLines);
  } else {
    const rank = FRONTMATTER_ORDER.indexOf(key);
    let insertAt = lines.length;
    if (rank >= 0) {
      for (let i = 0; i < lines.length; i++) {
        const k = topLevelKey(lines[i]);
        if (!k) continue;
        const r = FRONTMATTER_ORDER.indexOf(k);
        if (r > rank) { insertAt = i; break; }
      }
    }
    lines.splice(insertAt, 0, ...newLines);
  }

  return open + lines.join("\n") + close + body;
}

function trailingComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "#" && i > 0 && /\s/.test(line[i - 1])) return line.slice(i).trimEnd();
  }
  return "";
}

// ──────────────────────────────────────────────────────────────────────────
// Diffing — what history records
// ──────────────────────────────────────────────────────────────────────────

/** Display form of a field value: lists join, null/undefined become "". */
export function formatValue(value) {
  if (Array.isArray(value)) return value.join(", ");
  return String(value == null ? "" : value);
}

export function sameValue(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    const x = Array.isArray(a) ? a : a == null || a === "" ? [] : [a];
    const y = Array.isArray(b) ? b : b == null || b === "" ? [] : [b];
    return x.length === y.length && x.every((v, i) => v === y[i]);
  }
  return formatValue(a) === formatValue(b);
}

/**
 * Field-level diff of two parsed task metas.
 * `updated` is excluded on purpose: it changes on every edit, so logging it
 * would double every entry with a row nobody asked about.
 */
export function diffMeta(before, after, fields) {
  const keys = fields || TRACKED_FIELDS;
  const out = [];
  for (const key of keys) {
    const from = before ? before[key] : undefined;
    const to = after ? after[key] : undefined;
    if (!sameValue(from, to)) {
      out.push({
        field: key,
        from: normalizeForLog(from),
        to: normalizeForLog(to),
      });
    }
  }
  return out;
}

function normalizeForLog(v) {
  if (Array.isArray(v)) return v.slice();
  return v == null ? "" : String(v);
}
