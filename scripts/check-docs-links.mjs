#!/usr/bin/env node
/**
 * Guard: a link, or a `related_docs` entry, leads to a file that exists (TL-45).
 *
 * THE DEFECT, MEASURED. On 2026-08-31, the day after this tool was moved into a
 * repository of its own, 61 of 101 markdown links were dead — 60% — plus 27
 * `related_docs` entries pointing at a directory layout (`docs/architecture/…`,
 * `qa/…`) that belongs to the project this module came out of and does not exist
 * here. They were fixed by hand the same day, and a fix with no gate rots the
 * same way: every documentation move reproduces the state and nobody finds out.
 *
 * WHY THIS IS NOT A COSMETIC CONCERN. This is the navigation an agent moves
 * through. A dead link does not produce an error — it produces LESS CONTEXT, and
 * the reader cannot tell. `related_docs` is the one place a task says "read this
 * before you start"; pointing into a void turns the pre-flight reading into a
 * shorter list, silently, and the work then happens without the reasoning the
 * task was written to supply.
 *
 * WHAT IT JUDGES, AND WHY IT IS THE REPOSITORY AND NOT THE INSTALLATION. Unlike
 * `--product-name`, which reads the code of THIS installation, this guard reads
 * the repository that CONTAINS the backlog it was pointed at:
 * top-level `*.md`, everything under `docs/`, and every task file. That is the
 * only scope in which the answers are true — a `related_docs` entry resolves
 * against the consumer's tree, not against ours, and a task's link to
 * `../../docs/x.md` means their document.
 *
 * FOUR THINGS THAT ARE NOT DEAD LINKS AND MUST NOT BE REPORTED AS SUCH:
 *
 *   1. An external URL. Reachability is a network question and this guard does
 *      not ask network questions — one that did would fail on a train.
 *   2. `<repo>#<path>` — a reference to ANOTHER repository, the convention this
 *      backlog already uses (`other-repo#qa/…`). Skipped DELIBERATELY, by a
 *      rule that recognises the shape, not by accident because the resolution
 *      happened to fail.
 *   3. An external fragment. Its target is outside this repository, so its
 *      heading cannot be checked without making a network request.
 *
 * AND ONE THING THAT IS A FINDING OF ITS OWN, NOT A DEAD LINK (TL-433). A target
 * inside an install directory resolves on the machine that ran the install and
 * nowhere else. Measured: `node_modules/@clack/prompts/README.md`, cited by one
 * task, passed on every developer machine and failed on all six CI jobs, for a
 * package this repository never depended on. Judging it by `existsSync` makes
 * the verdict a property of the machine, so the rule reads the PATH instead and
 * answers the same everywhere — and it is reported separately, because a dead
 * link is fixed by finding the file and this one is fixed by citing the
 * upstream URL, which no local tree can ever contain.
 *
 * Local fragments are checked against Markdown headings. A bare `#section`
 * means the current document; `docs/manual.md#the-contract` means that file.
 *
 * Usage:
 *   node scripts/check-docs-links.mjs [--dir <backlog>]
 *
 * Exit 0 every target exists · 1 a dead link · 2 a usage error.
 *
 * Tests: `node --test scripts/tests/docs-links.test.mjs`
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfigOrExit } from "./config.mjs";
import { backlogPaths, repositoryRoot, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { splitFrontmatter, stripComment } from "./task-fields.mjs";
import { MARK, color } from "./ui.mjs";

const OKM = color.ok(MARK.ok);
const ERRM = color.err(MARK.err);
const __dirname = dirname(fileURLToPath(import.meta.url));

/** The directory a package manager creates. Named once: it is both a place this
 *  guard never READS from and a place no document here may POINT INTO. */
export const INSTALL_DIR = "node_modules";

/** Directories never walked. The install directory is somebody else's
 *  documentation and would triple the runtime to report links nobody in this
 *  repository wrote. */
const SKIP_DIRS = new Set([INSTALL_DIR, ".git", ".worktrees"]);

/**
 * Does this target point inside an install directory? PURE, and deliberately
 * NOT a question about the filesystem: the file is present wherever the install
 * ran and absent everywhere else, so asking `existsSync` would make the guard
 * answer differently on two machines looking at one repository (TL-433).
 */
export function isInstallArtefact(path) {
  return String(path || "").split(/[\\/]+/).includes(INSTALL_DIR);
}

/** A markdown inline link: `[text](target)`. Reference-style definitions
 *  (`[id]: target`) are matched separately below — both carry a path, and a
 *  guard that read only one of them would be silent about half the file. */
const INLINE_LINK = /\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const REFERENCE_LINK = /^\s{0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/gm;

/**
 * Is this target something this guard can and should resolve? PURE.
 *
 * @returns {{skip: string} | {path: string}}  `skip` names the RULE, so a test
 *          can assert that a cross-repository reference was skipped on purpose
 *          rather than because resolving it happened to fail.
 */
export function classifyTarget(raw) {
  const target = String(raw || "").trim();
  if (!target) return { skip: "empty" };
  if (target.startsWith("#")) return { skip: "anchor-in-page" };
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) return { skip: "external" };

  // A reference to another repository: `<repo>#<path>`. The half before the `#`
  // is a repository name — no slash, no extension — which is what tells it from
  // `docs/manual.md#a-heading`, where the half before the `#` is a real path.
  const hash = target.indexOf("#");
  if (hash > 0) {
    const head = target.slice(0, hash);
    if (/^[A-Za-z0-9._-]+$/.test(head) && !/\.[A-Za-z0-9]+$/.test(head)) {
      return { skip: "other-repository" };
    }
  }

  // The anchor is dropped for path resolution and compared with the target's
  // headings separately in `auditLinks`.
  const path = (hash >= 0 ? target.slice(0, hash) : target).split("?")[0];
  if (!path) return { skip: "anchor-in-page" };
  return { path: decodeURIComponent(path) };
}

/** The URL fragment of a local target, decoded once for comparison to a heading.
 * `#` is meaningful before a query string in Markdown URLs, so the query is
 * removed only from the path by `classifyTarget`, not from the fragment. */
export function fragmentIn(raw) {
  const hash = String(raw || "").indexOf("#");
  return hash < 0 ? "" : decodeURIComponent(String(raw).slice(hash + 1));
}

/** GitHub-compatible enough for repository Markdown: headings become lowercase
 * words joined with hyphens; punctuation and inline formatting do not survive
 * in an anchor. Repeated headings receive the same numeric suffix GitHub uses. */
export function headingSlug(heading) {
  return String(heading || "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[\\`*_~]/g, "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

/** Every Markdown heading anchor a reader can follow in one document. PURE. */
export function anchorsIn(text) {
  const anchors = new Set();
  const duplicates = new Map();
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const base = headingSlug(match[1]);
    if (!base) continue;
    const count = duplicates.get(base) || 0;
    duplicates.set(base, count + 1);
    anchors.add(count ? base + "-" + count : base);
  }
  return anchors;
}

/** Every link target a document carries, with the line it sits on. PURE. */
export function linksIn(text) {
  const out = [];
  const lines = String(text || "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const re of [INLINE_LINK, new RegExp(REFERENCE_LINK.source, "g")]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(lines[i])) !== null) out.push({ target: m[1], line: i + 1 });
    }
  }
  return out;
}

/** The `related_docs:` entries of one task's frontmatter. PURE.
 *  Parsed here rather than through the field machinery because this guard runs
 *  over files that may not parse as tasks at all, and a document that cannot be
 *  read is not the same finding as a link that leads nowhere. */
export function relatedDocsIn(frontmatter) {
  const out = [];
  const lines = String(frontmatter || "").split(/\r?\n/);
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    // A trailing `# comment` beside a field is a convention of the whole format
    // — `_template.md` annotates a dozen of them — so it is stripped before the
    // value is read. Without this, `related_docs: []  # paths relative to the
    // repository root` parses as an entry called `]` and the guard reports the
    // template as broken.
    const line = stripComment(lines[i]);
    const m = line.match(/^related_docs:\s*(.*)$/);
    if (m) {
      const inline = m[1].trim();
      inBlock = !inline;
      if (inline.startsWith("[")) {
        for (const item of inline.replace(/^\[|\]$/g, "").split(",")) {
          const value = item.trim().replace(/^["']|["']$/g, "");
          if (value) out.push({ target: value, line: i + 1 });
        }
      }
      continue;
    }
    if (!inBlock) continue;
    const item = line.match(/^\s+-\s*(.+?)\s*$/);
    if (item) {
      out.push({ target: item[1].replace(/^["']|["']$/g, ""), line: i + 1 });
      continue;
    }
    if (line.trim() && !/^\s/.test(line)) inBlock = false;
  }
  return out;
}

function walkMarkdown(dir, out) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkMarkdown(path, out);
    else if (entry.name.endsWith(".md")) out.push(path);
  }
  return out;
}

/** Which documents are judged: top-level `*.md`, everything under `docs/`, and
 *  every task file. Not the whole tree — a repository's source directories are
 *  full of markdown that belongs to somebody else's tooling. */
export function documentsToCheck(root, tasksDir) {
  const files = [];
  if (existsSync(root)) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".md")) files.push(join(root, entry.name));
    }
  }
  walkMarkdown(join(root, "docs"), files);
  walkMarkdown(tasksDir, files);
  return [...new Set(files)].sort();
}

/**
 * The audit. `exists` is injected so the rules can be exercised without a tree.
 *
 * @param {Array<{file: string, text: string}>} documents
 * @param {(p: string) => boolean} exists
 * @param {string} root  what an absolute-looking target is resolved against
 * @param {(p: string) => string} read  reads a resolved local document
 */
export function auditLinks(documents, exists, root, read = () => "") {
  const dead = [];
  const artefacts = [];
  const skipped = { empty: 0, "anchor-in-page": 0, external: 0, "other-repository": 0 };
  let checked = 0;
  let anchorsChecked = 0;

  for (const doc of documents) {
    const { frontmatter, body } = splitFrontmatter(doc.text);
    const targets = linksIn(body || doc.text)
      .concat(relatedDocsIn(frontmatter).map((e) => ({ ...e, kind: "related_docs" })));

    for (const entry of targets) {
      const verdict = { ...classifyTarget(entry.target), kind: entry.kind };
      const fragment = fragmentIn(entry.target);
      if (verdict.skip === "anchor-in-page") {
        checked++;
        anchorsChecked++;
        if (!anchorsIn(doc.text).has(fragment)) {
          dead.push({ file: doc.file, line: entry.line, target: entry.target, kind: "anchor" });
        }
        continue;
      }
      if (verdict.skip) {
        skipped[verdict.skip] = (skipped[verdict.skip] || 0) + 1;
        continue;
      }
      checked++;
      // Asked BEFORE the path is resolved, so the answer is the same on a
      // machine that ran the install and on one that did not.
      if (isInstallArtefact(verdict.path)) {
        artefacts.push({ file: doc.file, line: entry.line, target: entry.target, kind: entry.kind || "link" });
        continue;
      }
      // TWO RESOLUTION RULES, because the format has two. A markdown link is
      // relative to the FILE it sits in, which is what makes a link between two
      // tasks in one directory read as a bare filename. A `related_docs` entry
      // is relative to the REPOSITORY ROOT — `_template.md` says so on the line
      // beside the field, and every task in this backlog is written that way.
      // Resolving one by the other's rule reports 150 dead links that are not.
      const base = verdict.kind === "related_docs" || isAbsolute(verdict.path)
        ? root
        : dirname(doc.file);
      const resolved = resolve(base, verdict.path.replace(/^\//, ""));
      if (!exists(resolved)) {
        dead.push({ file: doc.file, line: entry.line, target: entry.target, kind: entry.kind || "link" });
        continue;
      }
      if (fragment) {
        anchorsChecked++;
        const targetText = resolved === doc.file ? doc.text : read(resolved);
        if (!anchorsIn(targetText).has(fragment)) {
          dead.push({ file: doc.file, line: entry.line, target: entry.target, kind: "anchor" });
        }
      }
    }
  }
  return { dead, artefacts, skipped, checked, anchorsChecked, documents: documents.length };
}

export function main(argv) {
  const { dir, argv: rest } = takeDirFlag(argv);
  if (rest.length) {
    console.error(`${N} check: unknown argument: ` + rest.join(" "));
    console.error("  usage: check-docs-links.mjs [--dir <backlog>]");
    return 2;
  }
  const backlog = resolveBacklogDir({ dir: dir || undefined, moduleDir: __dirname }).root;
  loadConfigOrExit(backlog);
  const paths = backlogPaths(backlog);
  const root = repositoryRoot(backlog);

  const documents = documentsToCheck(root, paths.tasksDir).map((file) => ({
    file, text: readFileSync(file, "utf8"),
  }));
  const result = auditLinks(documents, (p) => existsSync(p), root, (p) => readFileSync(p, "utf8"));

  const rel = (p) => relative(root, p) || p;
  const label = (kind) =>
    kind === "related_docs" ? "  (related_docs)" : kind === "anchor" ? "  (missing anchor)" : "";

  if (result.artefacts.length) {
    console.log(
      `${ERRM} docs: ${result.artefacts.length} of ${result.checked} target(s) point inside ` +
        `\`${INSTALL_DIR}/\`, which an install creates and no clone contains`
    );
    for (const a of result.artefacts.slice(0, 25)) {
      console.log(`  - ${rel(a.file)}:${a.line} → ${a.target}` + label(a.kind));
    }
    if (result.artefacts.length > 25) console.log(`  … and ${result.artefacts.length - 25} more`);
    console.log("");
    console.log("  This is NOT a dead link and is not fixed by finding the file: it resolves on");
    console.log("  the machine that ran the install and nowhere else, so it is green here and");
    console.log("  red in CI. Cite the upstream URL, or nothing.");
  }

  if (!result.dead.length && !result.artefacts.length) {
    // The counts are the positive control: "0 dead" over 0 links read is a guard
    // that found nothing to judge, and it must not look like one that passed.
    console.log(
      `${OKM} docs: ${result.checked} link(s) and related_docs entr(ies), including ` +
        `${result.anchorsChecked} anchor(s), across ${result.documents} document(s), each one resolving locally`
    );
    if (result.skipped["other-repository"]) {
      console.log(
        `  ${result.skipped["other-repository"]} reference(s) to another repository were skipped ` +
          "on purpose — `<repo>#<path>` is not a local path"
      );
    }
    return 0;
  }

  if (!result.dead.length) return 1;

  console.log(`${ERRM} docs: ${result.dead.length} of ${result.checked} target(s) lead nowhere or to a missing section`);
  for (const d of result.dead.slice(0, 25)) {
    console.log(`  - ${rel(d.file)}:${d.line} → ${d.target}` + label(d.kind));
  }
  if (result.dead.length > 25) console.log(`  … and ${result.dead.length - 25} more`);
  console.log("");
  console.log("  A dead link produces no error — it produces LESS CONTEXT, and the reader");
  console.log("  cannot tell. `related_docs` is where a task says what to read first.");
  return 1;
}

if (process.argv[1] && process.argv[1].endsWith("check-docs-links.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
