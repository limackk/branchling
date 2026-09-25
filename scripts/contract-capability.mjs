/**
 * What a successful verification run actually executed (TL-443).
 *
 * Coverage is a deliberately narrow signal. It can show that a Node test run
 * executed a file the task changed; it cannot show that an assertion guarded
 * the task's thesis. Foreign commands and manual checks stay `undetermined`
 * because claiming to have measured them would be worse than recording no
 * verdict at all.
 */

import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const CAPABLE = "capable";
export const INCAPABLE = "incapable";
export const UNDETERMINED = "undetermined";

/** Repository-relative files named by Node's raw V8 coverage directory. */
export function readCoverageFiles(directory, root) {
  const found = new Set();
  let names = [];
  try { names = readdirSync(directory); } catch { return found; }
  const prefix = resolve(root) + sep;
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    let document;
    try { document = JSON.parse(readFileSync(resolve(directory, name), "utf8")); } catch { continue; }
    for (const script of document.result || []) {
      if (!String(script.url || "").startsWith("file:")) continue;
      let absolute;
      try { absolute = fileURLToPath(script.url); } catch { continue; }
      if (absolute !== resolve(root) && !absolute.startsWith(prefix)) continue;
      const path = relative(root, absolute).split(sep).join("/");
      if (path && path !== ".." && !path.startsWith("../")) found.add(path);
    }
  }
  return found;
}

/**
 * Three-valued reading over an already completed contract.
 *
 * One observed intersection is enough to state the narrow positive fact. No
 * intersection is `incapable` only when EVERY entry was observable; otherwise
 * an unobserved foreign/manual entry may still be the one that exercised the
 * change, so the only honest answer is `undetermined`.
 */
export function contractCapability(results, changedFiles) {
  const changed = new Set(changedFiles || []);
  const observed = (results || []).filter((r) => r.coverageObserved);
  const executed = new Set(observed.flatMap((r) => r.executedFiles || []));
  const overlap = [...executed].filter((path) => changed.has(path)).sort();
  const everyEntryObserved = (results || []).length > 0 && observed.length === results.length;

  if (overlap.length) {
    return {
      verdict: CAPABLE,
      statement: "the run executed a file this task changed",
      changedFilesExecuted: overlap,
    };
  }
  if (everyEntryObserved) {
    return {
      verdict: INCAPABLE,
      statement: "the run executed no file this task changed",
      changedFilesExecuted: [],
    };
  }
  return {
    verdict: UNDETERMINED,
    statement: "whether the run executed a file this task changed was not determined",
    changedFilesExecuted: [],
  };
}
