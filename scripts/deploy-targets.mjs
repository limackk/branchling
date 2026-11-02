/**
 * The SHAPE of `deploy_targets:` in config.yaml (TL-501).
 *
 * WHAT THE KEY DECLARES. The deployables of a project and, for each, its
 * promotion stages as an ORDERED list of git refs. Which environment a task has
 * reached is then computed from git by `scripts/environments.mjs`; nothing here
 * reads git. The design is `docs/release-tracking.md` §3.
 *
 *   deploy_targets:
 *     - name: web
 *       paths: [web/, api/]
 *       stages:
 *         - { name: test, ref: origin/main }
 *         - name: production
 *           refs: [refs/deploys/web/production-eu, refs/deploys/web/production-us]
 *
 * WHY A MODULE OF ITS OWN. Every other key in config.yaml is a scalar, a flat
 * list or a flat map, and the narrow parser in `config.mjs` reads exactly
 * those. This one nests three levels deep, so it needs a reader that knows
 * block sequences, block mappings and the flow forms `[a, b]` and
 * `{ k: v }` — and nothing more. Keeping it here keeps that grammar from
 * leaking into the reader every other key goes through.
 *
 * WHY EVERY SUB-KEY IS ON AN ALLOW-LIST. An unknown key fails everywhere else
 * in the configuration, and the reason holds here with more force: a stage
 * spelled `refs:` where `ref:` was meant, or `path:` for `paths:`, would select
 * different commits and still produce an answer that reads like one. The lists
 * are per level (`TARGET_KEYS`, `STAGE_KEYS`) so a later task adds a key — the
 * `recorded:` stage flag of TL-506 — by extending one set and validating its
 * value, without loosening anything else.
 *
 * A RECORDED STAGE (`recorded: true`, TL-506) is one git cannot observe — store
 * review, an update channel, a sign-off — so `release record` moves its ref on
 * somebody's word (`scripts/release-record.mjs`). The tool WRITES that ref, so
 * every ref of such a stage must be one it can write and nothing else moves:
 *
 *   - a literal name, never a glob — a glob names no single ref to move;
 *   - a full `refs/…` name — a short name is resolved by git's search order and
 *     could land on a branch or a tag;
 *   - outside `refs/heads/`, `refs/remotes/` and `refs/tags/` — a branch moves
 *     with every commit, a remote-tracking ref is overwritten by the next fetch,
 *     and a tag that moves is a tag nobody can trust.
 *
 * The last rule is also what puts every recorded ref in front of `doctor`'s
 * fetch-refspec row (TL-508), which judges exactly the full names outside those
 * namespaces: a recorded stage cannot be declared where that check is blind.
 *
 * A TARGET IN ANOTHER REPOSITORY (`repository:`, TL-507) is a deployable whose
 * code lives outside the repository holding the backlog — a separate frontend
 * repository, a desktop client in its own. Its commits are invisible to this
 * git, so nothing about its deployment can be observed here, and the decision
 * of 2026-11-01 is to say so rather than to read the other repository:
 *
 *   - `repository:` names the other repository, in the shape of the `<repo>`
 *     half of a `<repo>#<path>` reference. It is a label for the reader; the
 *     tool never resolves, clones or fetches it;
 *   - `labels:` says which tasks belong to the target. A task's targets are
 *     otherwise computed from the paths its commits touched, and such a task
 *     has no commit here to compute them from; the label is the one thing a
 *     person writes on the task that can carry the link. Required, because a
 *     target that selects no task would declare nothing anybody could see;
 *   - `paths:` and `stages:` are refused: both are read against THIS
 *     repository's git, so a path would assign this repository's commits to the
 *     other one, and a stage ref would be resolved in the wrong repository and
 *     read like an answer about the right one.
 *
 * The tasks such a target selects are reported as UNOBSERVABLE there, never as
 * undeployed, and no gap detector reports them on its account
 * (`docs/release-tracking.md` §6).
 */

/** The keys a target may carry. */
export const TARGET_KEYS = Object.freeze(["name", "paths", "stages", "repository", "labels"]);
/** The keys a stage may carry. Exactly one of `ref` and `refs`. */
export const STAGE_KEYS = Object.freeze(["name", "ref", "refs", "recorded"]);

/**
 * The namespaces git's own refspecs already describe: local branches, the
 * remote-tracking copies the default refspec writes, and tags. Declared here,
 * beside the shape, because two readers need the same list: the fetch check
 * (`scripts/deploy-fetch.mjs`) skips them, and a recorded stage may not live in
 * them (below).
 */
export const GIT_NAMESPACES = Object.freeze(["refs/heads/", "refs/remotes/", "refs/tags/"]);

/** A target or stage name: it is typed as a flag value (`query --env`) and
 *  joined with `/` as `target/stage`, so it may not contain a slash or a space. */
export const NAME_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** A repository name in `repository:` — the `<repo>` half of a `<repo>#<path>`
 *  reference (`check-docs-links.mjs`): no slash, so it cannot be mistaken for a
 *  path or a URL the tool might be expected to open. */
export const REPOSITORY_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Is this normalised target deployed from another repository? */
export function isExternalTarget(target) {
  return !!(target && target.repository);
}

/** The targets whose code lives in THIS repository — the only ones git can
 *  observe. Every reader of commits and refs goes through this. */
export function observedTargets(targets) {
  return (targets || []).filter((t) => !isExternalTarget(t));
}

/**
 * PURE — the external targets a task belongs to, by its labels.
 *
 * @param {readonly object[]} targets  `config.deployTargets`
 * @param {{labels?: string[]}} task
 * @returns {object[]}
 */
export function externalTargetsOf(targets, task) {
  const labels = (task && Array.isArray(task.labels)) ? task.labels : [];
  if (!labels.length) return [];
  return (targets || []).filter((t) => isExternalTarget(t) && t.labels.some((l) => labels.indexOf(l) >= 0));
}

/** A ref spec is a glob when it carries a glob character. */
export function isGlob(spec) {
  return /[*?[]/.test(String(spec));
}

// ──────────────────────────────────────────────────────────────────────────
// The reader: block and flow collections, nothing else
// ──────────────────────────────────────────────────────────────────────────

function unquoteScalar(s) {
  const t = String(s).trim();
  if (t.length >= 2 && ((t[0] === '"' && t[t.length - 1] === '"') || (t[0] === "'" && t[t.length - 1] === "'"))) {
    return t.slice(1, -1);
  }
  if (t === "true") return true;
  if (t === "false") return false;
  return t;
}

/** Splits a flow body on top-level commas, respecting quotes and nesting. */
function splitFlow(body) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let cur = "";
  for (const c of body) {
    if (quote) { cur += c; if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === "[" || c === "{") depth++;
    if (c === "]" || c === "}") depth--;
    if (c === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter((p) => p !== "");
}

/** The first `:` followed by a space or the end, outside quotes and brackets. */
function keySplit(text) {
  let quote = null;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "[" || c === "{") depth++;
    if (c === "]" || c === "}") depth--;
    if (c === ":" && depth === 0 && (i === text.length - 1 || /\s/.test(text[i + 1]))) {
      return [text.slice(0, i).trim(), text.slice(i + 1).trim()];
    }
  }
  return null;
}

/** An inline value: a flow sequence, a flow mapping or a scalar. */
export function parseFlow(text, problems) {
  const t = String(text).trim();
  if (t.startsWith("[")) {
    if (!t.endsWith("]")) { problems.push("unterminated `[` in `" + t + "`"); return []; }
    return splitFlow(t.slice(1, -1)).map((p) => parseFlow(p, problems));
  }
  if (t.startsWith("{")) {
    if (!t.endsWith("}")) { problems.push("unterminated `{` in `" + t + "`"); return {}; }
    const map = {};
    for (const part of splitFlow(t.slice(1, -1))) {
      const kv = keySplit(part);
      if (!kv) { problems.push("cannot read `" + part + "` (expecting `key: value`)"); continue; }
      map[unquoteScalar(kv[0])] = parseFlow(kv[1], problems);
    }
    return map;
  }
  return unquoteScalar(t);
}

/**
 * Reads indented block lines (comments already stripped) into plain values.
 *
 * @param {{indent: number, text: string}[]} lines
 * @returns {{value: unknown, next: number}}
 */
function parseBlock(lines, start, problems) {
  if (start >= lines.length) return { value: null, next: start };
  const indent = lines[start].indent;
  if (lines[start].text === "-" || lines[start].text.startsWith("- ")) {
    const seq = [];
    let i = start;
    while (i < lines.length && lines[i].indent === indent &&
      (lines[i].text === "-" || lines[i].text.startsWith("- "))) {
      const rest = lines[i].text.slice(1);
      const content = rest.trim();
      if (!content) {
        // The item's value is the block below it.
        const child = i + 1 < lines.length && lines[i + 1].indent > indent
          ? parseBlock(lines, i + 1, problems)
          : { value: null, next: i + 1 };
        seq.push(child.value);
        i = child.next;
        continue;
      }
      if (!content.startsWith("[") && !content.startsWith("{") && keySplit(content)) {
        // `- key: value` opens a mapping whose first key sits on this line. The
        // keys that follow are aligned with it, so the line is re-read as one
        // indented to the column of its content.
        const column = indent + 1 + (rest.length - rest.trimStart().length);
        const sub = [{ indent: column, text: content }];
        let j = i + 1;
        while (j < lines.length && lines[j].indent >= column) { sub.push(lines[j]); j++; }
        seq.push(parseBlock(sub, 0, problems).value);
        i = j;
        continue;
      }
      seq.push(parseFlow(content, problems));
      i++;
    }
    return { value: seq, next: i };
  }
  const map = {};
  let i = start;
  while (i < lines.length && lines[i].indent === indent) {
    const kv = keySplit(lines[i].text);
    if (!kv) { problems.push("cannot read `" + lines[i].text + "` (expecting `key: value`)"); i++; continue; }
    const key = String(unquoteScalar(kv[0]));
    if (Object.prototype.hasOwnProperty.call(map, key)) problems.push("the key `" + key + "` appears twice");
    if (kv[1] !== "") {
      map[key] = parseFlow(kv[1], problems);
      i++;
      continue;
    }
    if (i + 1 < lines.length && lines[i + 1].indent > indent) {
      const child = parseBlock(lines, i + 1, problems);
      map[key] = child.value;
      i = child.next;
    } else {
      map[key] = null;
      i++;
    }
  }
  if (i < lines.length && lines[i].indent > indent) {
    problems.push("unexpected indentation at `" + lines[i].text + "`");
  }
  return { value: map, next: i };
}

/**
 * The raw value of the key, from its inline text and its indented body.
 *
 * @param {string} inline what follows `deploy_targets:` on its own line
 * @param {string[]} bodyLines the indented lines below it, comments stripped
 */
export function readDeployTargetsYaml(inline, bodyLines) {
  const problems = [];
  const lines = bodyLines
    .filter((l) => l.trim())
    .map((l) => ({ indent: l.length - l.trimStart().length, text: l.trim() }));
  let value;
  if (inline) {
    if (lines.length) problems.push("an inline value and an indented block at once");
    value = parseFlow(inline, problems);
  } else {
    const parsed = parseBlock(lines, 0, problems);
    value = parsed.value;
    if (parsed.next < lines.length) problems.push("cannot read `" + lines[parsed.next].text + "`");
  }
  return { value, problems };
}

// ──────────────────────────────────────────────────────────────────────────
// The validator
// ──────────────────────────────────────────────────────────────────────────

const isMap = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function nonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "";
}

/**
 * Validates the raw value and returns the normalised targets.
 *
 * A normalised stage always carries `refs` (one entry for `ref:`) and says
 * which form was written in `parallel`, so a reader never has to branch on the
 * two spellings — and a report can still say "every one of these refs" only
 * where the configuration said so.
 *
 * A target in another repository normalises to `stages: []`, `paths: null`,
 * and carries `repository` and `labels`; every other target carries
 * `repository: null` and `labels: null`.
 *
 * @returns {{targets: {name: string, paths: string[]|null, repository: string|null, labels: string[]|null,
 *   stages: {name: string, refs: string[], parallel: boolean, recorded: boolean}[]}[], problems: string[]}}
 */
export function validateDeployTargets(raw) {
  const problems = [];
  const targets = [];
  if (!Array.isArray(raw) || raw.length === 0) {
    problems.push(
      "expecting a non-empty list of targets (`- name: …` with `stages:`); a project with no environments omits the key"
    );
    return { targets, problems };
  }
  const names = new Set();
  raw.forEach((t, ti) => {
    const where = "target " + (ti + 1);
    if (!isMap(t)) { problems.push(where + ": expecting a mapping with `name` and `stages`"); return; }
    for (const k of Object.keys(t)) {
      if (TARGET_KEYS.indexOf(k) < 0) {
        problems.push(where + ": unknown key `" + k + "` (allowed: " + TARGET_KEYS.join(", ") + ")");
      }
    }
    const label = nonEmptyString(t.name) ? "target `" + t.name + "`" : where;
    if (!nonEmptyString(t.name) || !NAME_SHAPE.test(t.name)) {
      problems.push(where + ": `name` = `" + (t.name ?? "") + "` — expecting a letter or digit, then letters/digits/`.`/`_`/`-`");
    } else if (names.has(t.name)) {
      problems.push("duplicate target name `" + t.name + "`");
    } else {
      names.add(t.name);
    }

    const has = (k) => Object.prototype.hasOwnProperty.call(t, k);
    if (has("repository")) {
      if (!nonEmptyString(t.repository) || !REPOSITORY_SHAPE.test(t.repository.trim())) {
        problems.push(label + ": `repository` = `" + (t.repository ?? "") +
          "` — expecting the other repository's name (letters, digits, `.`, `_`, `-`; no slash), as in a `<repo>#<path>` reference");
      }
      let labels = null;
      if (!has("labels")) {
        problems.push(label + ": a target in another repository needs `labels` — the labels of the tasks implemented there; " +
          "they have no commit in this repository to assign them by paths");
      } else if (!Array.isArray(t.labels) || t.labels.length === 0 || !t.labels.every(nonEmptyString)) {
        problems.push(label + ": `labels` — expecting a non-empty list of task labels");
      } else {
        labels = t.labels.map((l) => l.trim());
        if (new Set(labels).size !== labels.length) problems.push(label + ": `labels` names the same label twice");
      }
      for (const k of ["paths", "stages"]) {
        if (has(k)) {
          problems.push(label + ": `" + k + "` cannot be declared on a target in another repository — it would be read against " +
            "this repository's git; its tasks are reported as unobservable instead");
        }
      }
      targets.push(Object.freeze({
        name: t.name, paths: null, stages: Object.freeze([]),
        repository: nonEmptyString(t.repository) ? t.repository.trim() : null,
        labels: labels && Object.freeze(labels),
      }));
      return;
    }
    if (has("labels")) {
      problems.push(label + ": `labels` selects tasks only for a target in another repository (`repository:`); " +
        "this target's tasks are the ones whose commits touch its `paths`");
    }

    let paths = null;
    if (Object.prototype.hasOwnProperty.call(t, "paths")) {
      if (!Array.isArray(t.paths) || t.paths.length === 0 || !t.paths.every(nonEmptyString)) {
        problems.push(label + ": `paths` — expecting a non-empty list of paths relative to the repository root; omit it to mean the whole repository");
      } else {
        paths = t.paths.map((p) => p.trim().replace(/^\.\//, ""));
      }
    }

    const stages = [];
    if (!Array.isArray(t.stages) || t.stages.length === 0) {
      problems.push(label + ": `stages` — expecting a non-empty list, in promotion order");
    } else {
      const stageNames = new Set();
      t.stages.forEach((s, si) => {
        const sWhere = label + ", stage " + (si + 1);
        if (!isMap(s)) { problems.push(sWhere + ": expecting a mapping with `name` and `ref` or `refs`"); return; }
        for (const k of Object.keys(s)) {
          if (STAGE_KEYS.indexOf(k) < 0) {
            problems.push(sWhere + ": unknown key `" + k + "` (allowed: " + STAGE_KEYS.join(", ") + ")");
          }
        }
        if (!nonEmptyString(s.name) || !NAME_SHAPE.test(s.name)) {
          problems.push(sWhere + ": `name` = `" + (s.name ?? "") + "` — expecting a letter or digit, then letters/digits/`.`/`_`/`-`");
        } else if (stageNames.has(s.name)) {
          problems.push(label + ": duplicate stage name `" + s.name + "`");
        } else {
          stageNames.add(s.name);
        }
        const hasRef = Object.prototype.hasOwnProperty.call(s, "ref");
        const hasRefs = Object.prototype.hasOwnProperty.call(s, "refs");
        let refs = [];
        if (hasRef === hasRefs) {
          problems.push(sWhere + ": expecting exactly one of `ref` (one ref) and `refs` (refs deployed in parallel)");
        } else if (hasRef) {
          if (!nonEmptyString(s.ref)) problems.push(sWhere + ": `ref` — expecting a ref name or a `refs/…` glob");
          else refs = [s.ref.trim()];
        } else if (!Array.isArray(s.refs) || s.refs.length === 0 || !s.refs.every(nonEmptyString)) {
          problems.push(sWhere + ": `refs` — expecting a non-empty list of ref names or `refs/…` globs");
        } else {
          refs = s.refs.map((r) => r.trim());
          if (new Set(refs).size !== refs.length) problems.push(sWhere + ": `refs` names the same ref twice");
        }
        for (const r of refs) {
          // A glob is resolved by `git for-each-ref`, which matches FULL ref
          // names; `v*` would silently match nothing and read as unknown.
          if (isGlob(r) && !r.startsWith("refs/")) {
            problems.push(sWhere + ": the glob `" + r + "` must be a full ref name starting with `refs/` (for example `refs/tags/" + r + "`)");
          }
        }
        let recorded = false;
        if (Object.prototype.hasOwnProperty.call(s, "recorded")) {
          if (s.recorded !== true && s.recorded !== false) {
            problems.push(sWhere + ": `recorded` = `" + s.recorded + "` — expecting `true` or `false`");
          } else {
            recorded = s.recorded;
          }
        }
        if (recorded) {
          for (const r of refs) {
            if (isGlob(r)) {
              problems.push(sWhere + ": a recorded stage moves one named ref, and `" + r + "` is a glob");
            } else if (!r.startsWith("refs/") || GIT_NAMESPACES.some((ns) => r.startsWith(ns))) {
              problems.push(sWhere + ": a recorded stage needs a full ref name outside refs/heads/, refs/remotes/ and refs/tags/ (for example `refs/deploys/" +
                (nonEmptyString(t.name) ? t.name : "<target>") + "/" + (nonEmptyString(s.name) ? s.name : "<stage>") + "`), not `" + r + "`");
            }
          }
        }
        stages.push(Object.freeze({ name: s.name, refs: Object.freeze(refs), parallel: hasRefs, recorded }));
      });
    }
    targets.push(Object.freeze({
      name: t.name, paths: paths && Object.freeze(paths), stages: Object.freeze(stages), repository: null, labels: null,
    }));
  });
  return { targets: Object.freeze(targets), problems };
}

/** Reader and validator in one step, problems prefixed with the key. */
export function readDeployTargets(inline, bodyLines) {
  const read = readDeployTargetsYaml(inline, bodyLines);
  if (read.problems.length) {
    return { targets: Object.freeze([]), problems: read.problems.map((p) => "deploy_targets: " + p) };
  }
  const v = validateDeployTargets(read.value);
  return { targets: v.targets, problems: v.problems.map((p) => "deploy_targets: " + p) };
}

/**
 * Does a repository-relative path belong to a target?
 *
 * A path ending in `/` selects a directory; any other entry selects that exact
 * file or, if it names a directory, everything below it. No globs: a selector
 * that silently matches more than was meant moves commits between targets.
 *
 * A target in another repository holds no file of this one: its commits are
 * elsewhere, and "no paths" there must not read as "the whole repository".
 */
export function pathInTarget(target, file) {
  if (isExternalTarget(target)) return false;
  if (!target.paths) return true;
  return target.paths.some((p) =>
    p.endsWith("/") ? file.startsWith(p) : file === p || file.startsWith(p + "/"));
}
