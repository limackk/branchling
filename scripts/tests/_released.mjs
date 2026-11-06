/**
 * The frozen backlogs of published releases, for the tests that read them
 * (TL-587). How a fixture is made, and why it is frozen rather than rebuilt
 * from a tag, is the header of `fixtures/released/capture.mjs`.
 */
import { cpSync, readFileSync, readdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

import { VERSION_SHAPE, compareVersions } from "../config-version.mjs";
import { SCRIPTS_DIR } from "./_repo.mjs";

export const RELEASED_DIR = join(SCRIPTS_DIR, "tests", "fixtures", "released");

/** Every captured release, oldest first. */
export function releasedVersions() {
  return readdirSync(RELEASED_DIR)
    .filter((name) => VERSION_SHAPE.test(name) && statSync(join(RELEASED_DIR, name)).isDirectory())
    .sort(compareVersions);
}

/** The `config.yaml` keys `version` knew. */
export function releasedKeys(version) {
  return JSON.parse(readFileSync(join(RELEASED_DIR, version, "config-keys.json"), "utf8"));
}

/** The newest captured release strictly older than `version`, or null. */
export function previousRelease(version, versions = releasedVersions()) {
  return versions.filter((v) => compareVersions(v, version) < 0).pop() ?? null;
}

/**
 * Copy the backlog `version`'s init wrote into `destDir/backlog`, with its
 * dotfiles under their real names again, and return that directory.
 */
export function restoreReleasedBacklog(version, destDir) {
  const backlog = join(destDir, "backlog");
  cpSync(join(RELEASED_DIR, version, "backlog"), backlog, { recursive: true });
  undot(backlog);
  return backlog;
}

function undot(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    let name = entry.name;
    if (name.startsWith("dot-")) {
      name = "." + name.slice("dot-".length);
      renameSync(join(dir, entry.name), join(dir, name));
    }
    if (entry.isDirectory()) undot(join(dir, name));
  }
}
