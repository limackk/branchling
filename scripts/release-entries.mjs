/**
 * The entries of `releases:` in config.yaml — a name, and optionally the ref
 * that marks where the release ends (TL-516).
 *
 * TWO SHAPES IN ONE LIST. An entry is either a plain slug (`1.1`) or a mapping
 * `{name: 1.0, ref: v1.0}`. A release that has gone out names the ref that
 * marks it — its tag, typically — so the scope report can say what that release
 * carried (`deploy status --release`, `docs/release-tracking.md`); one still in
 * progress has no such point yet and stays a slug. Both are accepted side by
 * side, because a project gains a ref one release at a time.
 *
 * THE NAMES ARE NORMALISED HERE, ONCE. `config.releases` stays a list of
 * names, so every reader of the vocabulary — `release:` validation, `new`,
 * `query`, the viewer's facet, the current release — works on both shapes
 * without knowing a mapping exists. Only the readers that need the ref ask for
 * `config.releaseEntries`, through `releaseEntriesOf()`.
 *
 * A REF IS ONE POINT. A glob is refused: a release ends at one commit, and
 * "the newest tag matching" would move the end of an old release whenever a
 * newer tag is pushed. The slug rules for the name are unchanged and are
 * checked with the rest of the vocabulary in `validateConfig()`.
 *
 * Tests: `node --test scripts/tests/release-shipped-scope.test.mjs`
 */

import { isGlob, readDeployTargetsYaml } from "./deploy-targets.mjs";

const ENTRY_KEYS = Object.freeze(["name", "ref"]);

const isMap = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * PURE — reads the value of `releases:` from its inline text and indented body.
 * The same YAML subset `deploy_targets:` is read with, so a flow list, a block
 * list and a mapping per item all work.
 *
 * @param {string} inline what follows `releases:` on its own line
 * @param {string[]} bodyLines the indented lines below it, comments stripped
 * @returns {{entries: {name: string, ref: string|null}[], problems: string[]}}
 */
export function readReleases(inline, bodyLines) {
  const read = readDeployTargetsYaml(inline, bodyLines);
  const problems = read.problems.map((p) => "releases: " + p);
  if (problems.length) return { entries: [], problems };
  let raw = read.value;
  if (raw === null || raw === "") raw = [];
  // `releases: 1.0` — a single name, as the plain list reader always accepted.
  if (!Array.isArray(raw) && !isMap(raw)) raw = [raw];
  if (!Array.isArray(raw)) {
    return { entries: [], problems: ["releases: expecting a list of release names or `{name, ref}` entries"] };
  }
  const entries = [];
  raw.forEach((item, i) => {
    const where = "releases: entry " + (i + 1);
    if (typeof item === "string" || typeof item === "boolean" || typeof item === "number") {
      const name = String(item).trim();
      if (name) entries.push({ name, ref: null });
      return;
    }
    if (!isMap(item)) { problems.push(where + ": expecting a name or `{name, ref}`"); return; }
    for (const key of Object.keys(item)) {
      if (ENTRY_KEYS.indexOf(key) < 0) problems.push(where + ": unknown key `" + key + "` (allowed: " + ENTRY_KEYS.join(", ") + ")");
    }
    const name = typeof item.name === "string" || typeof item.name === "number" ? String(item.name).trim() : "";
    if (!name) { problems.push(where + ": `name` is required"); return; }
    let ref = null;
    if (Object.prototype.hasOwnProperty.call(item, "ref")) {
      if (typeof item.ref !== "string" || !item.ref.trim()) {
        problems.push("releases: `" + name + "`: `ref` must be a ref name or tag");
      } else if (isGlob(item.ref)) {
        problems.push("releases: `" + name + "`: `ref: " + item.ref + "` is a pattern — a release ends at one point, so name one ref or tag");
      } else {
        ref = item.ref.trim();
      }
    }
    entries.push({ name, ref });
  });
  return { entries, problems };
}

/** PURE — the names, in the declared order. */
export function releaseNames(entries) {
  return (entries || []).map((e) => e.name);
}

/**
 * PURE — the entries of a loaded configuration. A configuration object built by
 * hand (a test, or a caller that only knows the names) has no
 * `releaseEntries`; its names are then entries without a ref.
 */
export function releaseEntriesOf(config) {
  if (config && Array.isArray(config.releaseEntries)) return config.releaseEntries;
  return ((config && config.releases) || []).map((name) => ({ name, ref: null }));
}
