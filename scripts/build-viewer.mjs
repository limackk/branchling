#!/usr/bin/env node
/**
 * Backlog viewer builder.
 *
 * Reads every `backlog/tasks/BL-NNN-*.md`, parses YAML frontmatter +
 * markdown body, generates a single self-contained `backlog/viewer.html`
 * with all data embedded (zero runtime fetch, works offline via file://).
 *
 * Usage:
 *   node backlog/scripts/build-viewer.mjs
 *   open backlog/viewer.html
 *
 * Zero npm dependencies — uses only `node:fs` + `node:path` + hand-rolled
 * minimal YAML + markdown parsers (sufficient for our task file schema).
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { extractMeta, splitFrontmatter } from "./task-fields.mjs";
import { crossBranchState, divergences } from "./branch-scan.mjs";
import { readAllHistory } from "./history.mjs";
import { modifiedFilesCached, repoRoot } from "./modified-files.mjs";
import { loadConfig, loadConfigOrExit } from "./config.mjs";
import { taskIdPatterns } from "./task-id.mjs";
import { backlogPaths, resolveBacklogDir, resolveBacklogDirOrExit, takeDirFlag } from "./paths.mjs";
import { loadPlan } from "./plan.mjs";
import { PRODUCT_NAME as N, STORAGE_KEY_PREFIX } from "./product.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The data directory is an ARGUMENT, not a property of where this file sits
 * (BL-1399). The default value preserves today's calls with no flags.
 */
function defaultRoot() {
  return resolveBacklogDirOrExit({ dir: takeDirFlag(process.argv.slice(2)).dir, moduleDir: __dirname }, N + " viewer").root;
}

/**
 * The encoding of the tasks view state in the URL enters the page BY SOURCE, not
 * as a copy: `viewer-url.mjs` is also imported by `node --test`, so the browser
 * and the test run the same code. A version written out in this template would be
 * unrunnable in a test — and then the only assertion left would be a regex on the
 * HTML, which passes just as well for a function returning the wrong URL.
 *
 * `export ` disappears, because the page is not a module; `</script` is split,
 * because such a sequence inside a script's body would close the tag earlier than
 * intended (there is none here, but it is one line less to remember next time).
 *
 * `import` lines disappear too, and that is a CONSTRAINT ON THE ORDER OF THE
 * PASTES, not a free lunch: a module inlined here may only reach for names that
 * an earlier paste has already defined. `plan.mjs` reads two helpers from
 * `task-fields.mjs`, which is pasted before it. What it imports from `node:fs`
 * is used only as the default argument of `loadPlan()` — a function the page
 * never calls, and a default is evaluated at the call, not at the paste.
 */
function readModuleSource(name) {
  return readFileSync(join(__dirname, name), "utf8")
    .replace(/^import [^;]*;\n/gm, "")
    .replace(/^export /gm, "")
    .replace(/^#!.*\n/, "")
    .replace(/<\/script/gi, "<\\/script");
}

// Frontmatter: the parser and the field schema live in `task-fields.mjs` — the
// same module that validates the server's writes and that the viewer draws its
// editors from. A copy of the parser here would drift at the first new field.

// The board registry is read by `config.mjs` (one boards.yaml parser instead of
// three, BL-1400). The viewer gets a ready config and does not know that file's shape.

// ──────────────────────────────────────────────────────────────────────────
// Minimal markdown → HTML (covers what task files use)
// ──────────────────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function md2html(md) {
  // 1. Extract code fences first so they're not mangled.
  const fences = [];
  md = md.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    fences.push(
      `<pre class="code"><code class="lang-${lang || "text"}">${escapeHtml(
        code.replace(/\n$/, "")
      )}</code></pre>`
    );
    return `\x00FENCE${fences.length - 1}\x00`;
  });

  // Escape remaining HTML in the body (after code is safe).
  md = escapeHtml(md);

  // 2. Tables (must come before paragraph splitting).
  md = md.replace(/((?:^\|.*\|\s*\n?)+)/gm, (block) => {
    const rows = block.trim().split("\n");
    if (rows.length < 2) return block;
    const header = rows[0]
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    const body = rows.slice(2).map((r) =>
      r
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim())
    );
    return (
      "<table><thead><tr>" +
      header.map((h) => `<th>${inline(h)}</th>`).join("") +
      "</tr></thead><tbody>" +
      body
        .map(
          (row) =>
            "<tr>" + row.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>"
        )
        .join("") +
      "</tbody></table>"
    );
  });

  // 3. Headers.
  md = md.replace(/^####\s+(.+)$/gm, "<h4>$1</h4>");
  md = md.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
  md = md.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
  md = md.replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");

  // 4. Lists (handle checkboxes, numbered, bullets — line-based grouping).
  md = md.replace(/((?:^[-*]\s+.*(?:\n|$))+)/gm, (group) => {
    const items = group
      .trim()
      .split(/\n/)
      .map((l) => {
        const text = l.replace(/^[-*]\s+/, "");
        if (text.startsWith("[ ] ")) {
          return `<li class="task-item"><input type="checkbox" disabled> ${inline(
            text.slice(4)
          )}</li>`;
        }
        if (text.match(/^\[x\]\s/i)) {
          return `<li class="task-item done"><input type="checkbox" checked disabled> ${inline(
            text.replace(/^\[x\]\s/i, "")
          )}</li>`;
        }
        return `<li>${inline(text)}</li>`;
      })
      .join("");
    return `<ul>${items}</ul>`;
  });
  md = md.replace(/((?:^\d+\.\s+.*(?:\n|$))+)/gm, (group) => {
    const items = group
      .trim()
      .split(/\n/)
      .map((l) => `<li>${inline(l.replace(/^\d+\.\s+/, ""))}</li>`)
      .join("");
    return `<ol>${items}</ol>`;
  });

  // 5. Horizontal rules.
  md = md.replace(/^---+\s*$/gm, "<hr>");

  // 6. Paragraphs — split on blank lines, wrap leftover text.
  md = md
    .split(/\n{2,}/)
    .map((block) => {
      block = block.trim();
      if (!block) return "";
      // Already a block element?
      if (/^<(h\d|ul|ol|table|pre|hr|blockquote|\x00FENCE\d+\x00)/.test(block)) {
        return block;
      }
      return `<p>${inline(block).replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");

  // 7. Restore code fences.
  md = md.replace(/\x00FENCE(\d+)\x00/g, (_, i) => fences[Number(i)]);

  return md;
}

function inline(s) {
  // Inline transforms — bold, italic, code, links.
  // (We've already HTML-escaped the input.)
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\s][^*]*[^*\s]|[^*\s])\*(?!\*)/g, "$1<em>$2</em>");
  s = s.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_, text, url) => `<a href="${url}" target="_blank" rel="noopener">${text}</a>`
  );
  return s;
}

// ──────────────────────────────────────────────────────────────────────────
// Read all tasks
// ──────────────────────────────────────────────────────────────────────────

/**
 * @param {string} root the backlog directory
 * @param {object} [preloaded] a configuration the caller has ALREADY loaded.
 *        The server passes one when the directory is another worktree's
 *        (TL-188): `loadConfigOrExit` ends the process, which is the right
 *        answer for a command and the wrong one for a server that would be
 *        taken down by an unreadable config.yaml in a tree it merely offered to
 *        show. Loading it once also removes the read-it-twice race.
 */
export function readTasks(root = defaultRoot(), preloaded = null) {
  const TASKS_DIR = backlogPaths(root).tasksDir;
  // The prefix from this backlog's configuration (BL-1452), not from a constant.
  // STRICT (TL-60): a page built under a configuration that could not be read
  // shows emptiness or somebody else's vocabulary — and looks correct doing it.
  const config = preloaded || loadConfigOrExit(root);
  const taskFile = taskIdPatterns(config.taskIdPrefix).file;
  // THE SAME SCAN AND THE SAME DEFINITION OF A DIFFERENCE AS THE TERMINAL
  // (TL-73). The page is the view non-technical readers work from, so a status
  // computed from one checkout misleads exactly the people least able to notice
  // it; and a second definition of "differs" here would put the viewer and
  // `query` into disagreement about the same tree.
  const scan = crossBranchState(root, config);
  const files = readdirSync(TASKS_DIR)
    .filter((f) => taskFile.test(f))
    .sort();
  return files.map((file) => {
    const raw = readFileSync(join(TASKS_DIR, file), "utf8");
    const { frontmatter, body } = splitFrontmatter(raw);
    const meta = extractMeta(frontmatter);
    return {
      ...meta,
      file,
      elsewhere: divergences(meta.status, scan.byId.get(meta.id)),
      bodyHtml: md2html(body.trim()),
    };
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Stats
// ──────────────────────────────────────────────────────────────────────────

export function computeStats(tasks) {
  const by = (key) =>
    tasks.reduce((acc, t) => {
      const k = (Array.isArray(t[key]) ? t[key].join(",") : t[key]) || "—";
      if (Array.isArray(t[key])) {
        for (const v of t[key]) acc[v] = (acc[v] || 0) + 1;
      } else {
        acc[k] = (acc[k] || 0) + 1;
      }
      return acc;
    }, {});
  return {
    total: tasks.length,
    by_status: by("status"),
    by_priority: by("priority"),
    by_type: by("type"),
    by_label: by("labels"),
    by_epic: by("epic"),
    by_board: by("board"),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// HTML template
// ──────────────────────────────────────────────────────────────────────────

/**
 * @param {object} plan  the result of `loadPlan()`. A default rather than a
 *   required argument for the same reason `history` is one: both call sites
 *   (the `viewer` command and the server) hand in tasks and a config, and neither
 *   should have to learn where the plan file lives to keep working.
 */
/**
 * @param {object} [viewer] what the SERVER knows and a file:// page cannot
 *        (TL-188): `worktrees` is the list of trees this clone offers as
 *        subjects, `worktree` the key of the one being rendered, and `canEdit`
 *        whether writes may reach it. Absent by default, and that is the
 *        file:// case: with no server there is nothing to switch to and no
 *        write path, so the page renders no switcher rather than one that
 *        cannot work.
 */
export function buildHtml(
  tasks,
  stats,
  config = loadConfig(defaultRoot()),
  history = readAllHistory(config.root),
  plan = loadPlan(backlogPaths(config.root).planPath)
) {
  // WHICH FILES EACH TASK CHANGED (TL-75). Attached here rather than stored in
  // the frontmatter, for the reason modified-files.mjs gives at length: the
  // commits are the record, and an index over them is a view. Cached on HEAD, so
  // a `serve` rebuilding on every keystroke pays for one `git log` per commit
  // rather than one per rebuild.
  const fileIndex = modifiedFilesCached({ root: repoRoot(config.root), prefix: config.taskIdPrefix });
  const withFiles = tasks.map((t) => ({
    ...t,
    modified_files: [...(fileIndex.byTask.get(t.id) || [])].sort(),
  }));
  const tasksJson = JSON.stringify(withFiles).replace(/</g, "\\u003c");
  const statsJson = JSON.stringify(stats);
  const boardsJson = JSON.stringify(config.boards.map((b) => ({ slug: b.slug, name: b.name }))).replace(/</g, "\\u003c");
  // The colours are generated from the project's VOCABULARIES (BL-1400), not from
  // a list of names written into the CSS. A value with no entry in `*_colors` gets
  // a colour from the cycling palette — the order in the vocabulary decides, so the
  // result is stable.
  const PALETTE = [
    [220, 38, 38], [37, 99, 235], [5, 150, 105], [180, 83, 9],
    [124, 58, 237], [8, 145, 178], [190, 24, 93], [107, 123, 142],
  ];
  const cssIdent = (v) => String(v).replace(/[^A-Za-z0-9_-]/g, "-");
  const hexToRgb = (hex) => {
    const m = String(hex).match(/^#?([0-9a-f]{6})$/i);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const colorFor = (kind, value, i) =>
    hexToRgb((config.colors[kind] || {})[value]) || PALETTE[i % PALETTE.length];

  const varsFor = (kind, values) => values.map((v, i) => {
    const [r, g, b] = colorFor(kind, v, i);
    return "    --" + kind + "-" + cssIdent(v) + ": rgb(" + r + "," + g + "," + b + ");";
  }).join("\n");
  const badgesFor = (kind, values, alpha) => values.map((v, i) => {
    const [r, g, b] = colorFor(kind, v, i);
    const id = cssIdent(v);
    return "  .badge-" + kind + "-" + id + " { background: rgba(" + r + "," + g + "," + b + "," + alpha +
      "); color: var(--" + kind + "-" + id + "); }";
  }).join("\n");

  const paletteVarCss = [
    varsFor("status", config.statuses),
    varsFor("priority", config.priorities),
    varsFor("label", config.labels || []),
  ].filter(Boolean).join("\n");
  const strike = new Set(config.statusStrikethrough || []);
  const paletteBadgeCss = [
    badgesFor("status", config.statuses, "0.15"),
    // The priority is filled in, not dimmed — it is the one axis read "from a
    // distance" on the list of cards.
    config.priorities.map((v, i) => {
      const [r, g, b] = colorFor("priority", v, i);
      return "  .badge-priority-" + cssIdent(v) + " { background: rgb(" + r + "," + g + "," + b + "); color: white; }";
    }).join("\n"),
    [...strike].map((v) => "  .badge-status-" + cssIdent(v) + " { text-decoration: line-through; }").join("\n"),
    badgesFor("label", config.labels || [], "0.13"),
    config.statuses.map((v) => {
      const id = cssIdent(v);
      return "  .status-btn.active-" + id + " { background: var(--status-" + id +
        "); color: white; border-color: var(--status-" + id + "); }";
    }).join("\n"),
  ].filter(Boolean).join("\n");

  // The PLAN FILE goes into the page, not the state computed from it: the page
  // recomputes the state itself with `planState()` after every refresh, so a
  // status changed in the browser moves the card without a round trip to a
  // number somebody baked in at build time. A plan that does not parse travels
  // as its problems, and the view says so instead of drawing half an order.
  // The path travels as `<backlog dir>/plan.yaml`, never absolute: the page is
  // mailed around and read over file://, and somebody else's home directory in
  // an empty state is noise at best.
  const planPathLabel = basename(config.root) + "/plan.yaml";
  const planJson = JSON.stringify(
    plan && plan.exists
      ? { exists: true, path: planPathLabel, plan: plan.plan, problems: plan.problems }
      : { exists: false, path: planPathLabel, plan: null, problems: (plan && plan.problems) || [] }
  ).replace(/</g, "\\u003c");
  const configJson = JSON.stringify(config, (k, v) => (k === "paths" || k === "problems" || k === "taskId" ? undefined : v)).replace(/</g, "\\u003c");
  const buildTime = new Date().toISOString();
  // EVERY KEY THIS PAGE WRITES INTO A BROWSER HANGS OFF ONE PREFIX (TL-178), and
  // that prefix is a FROZEN constant rather than the display name: it identifies
  // data already stored in browsers we cannot reach.
  const storagePrefix = JSON.stringify(STORAGE_KEY_PREFIX + "-backlog");
  const urlModuleSrc = readModuleSource("viewer-url.mjs");
  const fieldsModuleSrc = readModuleSource("task-fields.mjs");
  // Estimate → hours: ONE implementation for the dashboard and for
  // the `stats` command (BL-1412). A second copy would mean the terminal and the
  // browser could give two different numbers for the same question.
  const estimateModuleSrc = readModuleSource("estimate.mjs");
  const elsewhereModuleSrc = readModuleSource("elsewhere.mjs");
  // The plan's arithmetic and the Execution view. `plan.mjs` comes first:
  // `viewer-plan.mjs` renders what `planState()` returns.
  const planModuleSrc = readModuleSource("plan.mjs");
  const viewerPlanModuleSrc = readModuleSource("viewer-plan.mjs");
  // The decision panel reads `openQuestions` from task-fields.mjs, pasted above.
  const decisionPanelModuleSrc = readModuleSource("decision-panel.mjs");
  const taskGraphModuleSrc = readModuleSource("task-graph.mjs");
  const historyJson = JSON.stringify(history).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(config.projectName)}</title>
<style>
  /* ─── Reset + theme ─────────────────────────────────────────────── */
  *, *::before, *::after { box-sizing: border-box; }
  :root {
    --bg: #FAF8F5;
    --bg-card: #FFFFFF;
    --bg-sidebar: #F4EFE8;
    --fg: #1E3A5C;
    --fg-muted: #6B7B8E;
    --border: #E5E0D8;
    --accent: #C97B5C;
    --accent-soft: #F4DED1;
    --shadow: 0 1px 3px rgba(30, 58, 92, 0.05);
    --shadow-md: 0 4px 12px rgba(30, 58, 92, 0.08);
    --shadow-lg: 0 12px 32px rgba(30, 58, 92, 0.16), 0 2px 6px rgba(30, 58, 92, 0.08);
    --code-bg: #2D3748;
    --code-fg: #E2E8F0;
    /* The "you are looking at another worktree" surface (TL-188). A token, not a
       colour written into the rule, and not borrowed from the priority palette —
       that palette is this project's VOCABULARY and a project without a P2 would
       lose the tint. */
    --foreign-border: #B4530E;
    --foreign-bg: rgba(180, 83, 14, 0.09);
    /* "Somebody is on this right now" (TL-189). A token of its own for the reason
       above: a status colour would tie the mark to one project's vocabulary, and
       this is a fact about the heartbeat log, not about a status. */
    --in-flight: #059669;
    --in-flight-bg: rgba(5, 150, 105, 0.13);
    /* "Worked, and waiting for somebody to sign" (TL-212). A token for the same
       reason as the two above: it marks a fact about the VERIFICATION — an
       unsigned \`manual:\` entry — and a status colour would tie it to one
       project's vocabulary. Deliberately not \`--in-flight\`: nobody is on this
       one, which is the whole difference. */
    --vouch: #0F766E;
    --vouch-bg: rgba(15, 118, 110, 0.10);
${paletteVarCss}
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #1A1F2E;
      --bg-card: #232938;
      --bg-sidebar: #1F2532;
      --fg: #E2E8F0;
      --fg-muted: #94A3B8;
      --border: #2D3748;
      --accent: #E89A7D;
      --accent-soft: #3D2A23;
      --shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
      --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4);
      --shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.55), 0 2px 6px rgba(0, 0, 0, 0.4);
      --code-bg: #0F1419;
      --code-fg: #CBD5E1;
      --foreign-border: #E8A25D;
      --foreign-bg: rgba(232, 162, 93, 0.12);
      --in-flight: #34D399;
      --in-flight-bg: rgba(52, 211, 153, 0.15);
      --vouch: #5EEAD4;
      --vouch-bg: rgba(94, 234, 212, 0.11);
    }
  }
  html, body { margin: 0; padding: 0; height: 100%; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
    background: var(--bg);
    color: var(--fg);
    line-height: 1.55;
    font-size: 14px;
    /* Column flex instead of a hardcoded calc(100vh - 132px) on main — the
       header's height is variable (chips row wraps, stats wrap). */
    display: flex;
    flex-direction: column;
  }

  /* ─── Layout ────────────────────────────────────────────────────── */
  header.app-header {
    background: var(--bg-card);
    border-bottom: 1px solid var(--border);
    padding: 16px 24px;
    flex: none;
    z-index: 10;
    box-shadow: var(--shadow);
  }
  .app-title {
    display: flex;
    align-items: baseline;
    gap: 16px;
    margin-bottom: 12px;
  }
  .app-title h1 { font-size: 18px; margin: 0; font-weight: 600; }
  .app-title .build-meta {
    font-size: 12px;
    color: var(--fg-muted);
    font-variant-numeric: tabular-nums;
  }
  .stats {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 12px;
  }
  .stat-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 999px;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .stat-chip strong { color: var(--accent); font-weight: 600; }
  /* ─── Filter dropdowns (combobox pattern) ───────────────────────── */
  .filters-bar { display: flex; flex-direction: column; gap: 8px; }
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .filter-dropdown { position: relative; }
  .filter-trigger {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 250px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    color: var(--fg-muted);
    padding: 5px 10px;
    border-radius: 8px;
    font-size: 12px;
    cursor: pointer;
    font-family: inherit;
    transition: border-color 120ms ease, background 120ms ease, color 120ms ease;
    white-space: nowrap;
  }
  .filter-trigger:hover { border-color: var(--accent); color: var(--fg); }
  .filter-trigger:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .filter-trigger.has-selection {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--fg);
  }
  .filter-trigger-label { font-weight: 500; flex: none; }
  /* Selected values are shown on the trigger itself — a bare count forced a
     re-open just to recall what was filtered. */
  .filter-trigger-value {
    color: var(--fg);
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }
  .filter-trigger-value::before { content: "·"; margin-right: 6px; color: var(--fg-muted); font-weight: 400; }
  .filter-chevron { font-size: 9px; opacity: 0.7; transition: transform 120ms; flex: none; }
  .filter-dropdown.open .filter-chevron { transform: rotate(180deg); }

  .filter-panel {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    width: 288px;
    max-width: calc(100vw - 32px);
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: var(--shadow-lg);
    z-index: 60;
    display: none;
    flex-direction: column;
    overflow: hidden;
  }
  .filter-dropdown.open .filter-panel { display: flex; }
  .filter-dropdown.align-right .filter-panel { left: auto; right: 0; }
  .filter-panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    padding: 9px 12px 7px;
    border-bottom: 1px solid var(--border);
  }
  .filter-panel-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--fg-muted);
  }
  .filter-panel-clear {
    font-size: 11px;
    color: var(--accent);
    cursor: pointer;
    background: none;
    border: none;
    font-family: inherit;
    padding: 2px 4px;
    border-radius: 4px;
  }
  .filter-panel-clear:hover { text-decoration: underline; }
  .filter-panel-clear:disabled { color: var(--fg-muted); opacity: 0.5; cursor: default; text-decoration: none; }
  /* The board scope — deliberately NOT looking like a filter beside Epic/Status:
     it is the context of work in which the filters then operate, so it sits above them. */
  .scope-bar {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    margin: 0 0 12px; padding: 8px 12px; border: 1px solid var(--border);
    border-radius: 8px; background: var(--bg-elev); font-size: 13px; color: var(--fg-muted);
  }
  .scope-bar strong { color: var(--fg); }
  .board-scope { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 0 0 8px; }
  .board-scope-label { font-size: 12px; color: var(--fg-muted); margin-right: 2px; }
  .board-btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 4px 10px; border: 1px solid var(--border); border-radius: 999px;
    background: var(--bg-elev); color: var(--fg); font-size: 12px; font-weight: 500;
    cursor: pointer; font-family: inherit;
  }
  .board-btn:hover { border-color: var(--accent); }
  .board-btn.is-active { background: var(--accent); border-color: var(--accent); color: #fff; }
  .board-count { font-variant-numeric: tabular-nums; opacity: .7; font-size: 11px; }
  .board-btn.is-active .board-count { opacity: .9; }
  .badge-board { background: rgba(56, 189, 248, 0.16); color: #0369A1; }

  .filter-search-wrap { padding: 8px 10px; border-bottom: 1px solid var(--border); }
  .filter-search {
    width: 100%;
    padding: 6px 10px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--fg);
    border-radius: 6px;
    font-size: 12px;
    font-family: inherit;
  }
  .filter-search:focus { outline: 2px solid var(--accent); outline-offset: -1px; border-color: transparent; }
  /* The bounded, scrollable body is the core fix: 90 epics used to render as
     one unbounded column that ran past the viewport. */
  .filter-options {
    overflow-y: auto;
    max-height: min(320px, 46vh);
    padding: 4px;
    overscroll-behavior: contain;
  }
  .filter-option {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 6px 8px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    user-select: none;
    scroll-margin: 4px;
  }
  .filter-option:hover { background: var(--bg-sidebar); }
  .filter-option:focus { outline: none; background: var(--bg-sidebar); box-shadow: inset 0 0 0 1.5px var(--accent); }
  .filter-option[aria-selected="true"] { background: var(--accent-soft); }
  .filter-option[aria-disabled="true"] { opacity: 0.38; cursor: default; }
  .filter-option[aria-disabled="true"]:hover { background: transparent; }
  .filter-option-check {
    width: 15px; height: 15px;
    border: 1.5px solid var(--border);
    border-radius: 4px;
    flex: none;
    display: grid;
    place-items: center;
    font-size: 10px;
    line-height: 1;
    color: transparent;
    background: var(--bg);
  }
  .filter-option[aria-selected="true"] .filter-option-check {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  /* Single-line rows with ellipsis — long epic names used to wrap to three
     lines and destroy the scan rhythm. Full text stays in title=. */
  .filter-option-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .filter-option-count {
    font-size: 10px;
    color: var(--fg-muted);
    font-variant-numeric: tabular-nums;
    flex: none;
  }
  .filter-panel-empty { padding: 16px 12px; text-align: center; font-size: 12px; color: var(--fg-muted); }
  .filter-panel-footer {
    border-top: 1px solid var(--border);
    padding: 7px 10px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
  .filter-panel-hint { font-size: 10px; color: var(--fg-muted); }
  .filter-panel-action {
    font-size: 11px;
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font-family: inherit;
    padding: 2px 4px;
    border-radius: 4px;
  }
  .filter-panel-action:hover { text-decoration: underline; }
  .filter-panel-action:disabled { color: var(--fg-muted); opacity: 0.5; cursor: default; text-decoration: none; }

  /* Active selections as removable chips — one-click removal without
     hunting the value back down inside its panel. */
  .active-filters { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .active-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 260px;
    background: var(--accent-soft);
    border: 1px solid var(--accent);
    border-radius: 999px;
    padding: 2px 4px 2px 10px;
    font-size: 11px;
  }
  .active-chip-key { color: var(--fg-muted); flex: none; }
  .active-chip-val { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
  .active-chip-x {
    border: none; background: none; cursor: pointer;
    color: var(--fg-muted); font-size: 12px; line-height: 1;
    width: 16px; height: 16px; border-radius: 50%;
    display: grid; place-items: center; flex: none; font-family: inherit;
  }
  .active-chip-x:hover { background: rgba(127,127,127,0.2); color: var(--fg); }
  .filter-reset-btn {
    background: transparent;
    border: 1px solid rgba(185,28,28,0.3);
    color: var(--status-blocked);
    padding: 3px 10px;
    border-radius: 999px;
    font-size: 11px;
    cursor: pointer;
    font-family: inherit;
    transition: all 120ms ease;
  }
  .filter-reset-btn:hover { background: rgba(185,28,28,0.07); border-color: var(--status-blocked); }

  @media (max-width: 640px) {
    /* Bottom sheet — an anchored popover cannot fit a long list on a phone.
       Backdrop sits on <body> (not inside .filter-dropdown) so a tap on it
       reads as "outside" and closes the sheet. */
    body.filter-open::before {
      content: "";
      position: fixed;
      inset: 0;
      background: rgba(15, 20, 30, 0.45);
      z-index: 55;
    }
    .filter-panel {
      position: fixed;
      top: auto; left: 8px; right: 8px; bottom: 8px;
      width: auto; max-width: none;
    }
    .filter-dropdown.align-right .filter-panel { left: 8px; right: 8px; }
    .filter-options { max-height: 50vh; }
  }

  /* ─── Sort bar ───────────────────────────────────────────────────── */
  .sort-bar {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 7px 12px 8px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-sidebar);
    position: sticky;
    top: 0;
    z-index: 2;
  }
  .sort-bar-label {
    font-size: 10px;
    color: var(--fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-right: 2px;
  }
  .sort-btn {
    background: transparent;
    border: 1px solid transparent;
    color: var(--fg-muted);
    padding: 2px 8px;
    border-radius: 5px;
    font-size: 11px;
    cursor: pointer;
    font-family: inherit;
    transition: all 100ms;
  }
  .sort-btn:hover { background: var(--bg-card); color: var(--fg); border-color: var(--border); }
  .sort-btn.active {
    background: var(--bg-card);
    color: var(--fg);
    border-color: var(--accent);
    font-weight: 600;
  }
  .list-count {
    margin-left: auto;
    font-size: 11px;
    color: var(--fg-muted);
    font-variant-numeric: tabular-nums;
  }

  main.app-main {
    display: grid;
    grid-template-columns: 380px 1fr;
    gap: 0;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  @media (max-width: 800px) {
    main.app-main { grid-template-columns: 1fr; flex: none; overflow: visible; }
  }

  aside.task-list {
    background: var(--bg-sidebar);
    border-right: 1px solid var(--border);
    overflow-y: auto;
    padding: 12px;
  }

  .task-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-left: 3px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    margin-bottom: 8px;
    cursor: pointer;
    transition: all 120ms ease;
    box-shadow: var(--shadow);
  }
  .task-card:hover {
    transform: translateY(-1px);
    box-shadow: var(--shadow-md);
  }
  .task-card.active {
    border-left-color: var(--accent);
    background: var(--accent-soft);
  }
  .task-card[data-priority="P0"] { border-left-color: var(--priority-P0); }
  .task-card[data-priority="P1"] { border-left-color: var(--priority-P1); }
  .task-card[data-priority="P2"] { border-left-color: var(--priority-P2); }
  .task-card[data-priority="P3"] { border-left-color: var(--priority-P3); }

  /* Seen differently in another tree — taken there, most of the time (TL-124).
     The badge that says so is the seventh in the footer and loses to the first
     impression: the card looks exactly like a free one, and a session takes work
     somebody is already doing. Two signals, because one of them is a colour —
     the card recedes into the sidebar background AND its border turns dashed,
     which survives a printout and a reader who does not tell the shades apart.
     The left edge stays solid: it carries the priority, a different question. */
  .task-card.elsewhere {
    background: var(--bg-sidebar);
    border-style: dashed;
    border-left-style: solid;
    /* Only three edges: the left one carries the priority colour, and a shorthand
       here would silently repaint it — the two axes are read at the same glance. */
    border-top-color: rgba(217, 119, 6, 0.45);
    border-right-color: rgba(217, 119, 6, 0.45);
    border-bottom-color: rgba(217, 119, 6, 0.45);
    box-shadow: none;
  }
  @media (prefers-color-scheme: dark) {
    .task-card.elsewhere {
      border-top-color: rgba(251, 191, 36, 0.45);
      border-right-color: rgba(251, 191, 36, 0.45);
      border-bottom-color: rgba(251, 191, 36, 0.45);
    }
  }
  .task-card.elsewhere .task-card-title { color: var(--fg-muted); }
  /* Dimming must not swallow the fact that this is the card being read. */
  .task-card.elsewhere.active { background: var(--accent-soft); }
  .task-card.elsewhere.active .task-card-title { color: var(--fg); }

  /* A task being worked on RIGHT NOW (TL-189). The left border is already spoken
     for by the priority and the other three by the elsewhere mark, so this one is an
     outline: it composes with both instead of arguing with either. */
  .task-card.in-flight { box-shadow: 0 0 0 1px var(--in-flight); }
  .badge-in-flight {
    background: var(--in-flight-bg);
    color: var(--in-flight);
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  /* The dot is a SHAPE, not an animation. A pulse says "alive" on its own, which
     is the claim this whole signal refuses to make without a timestamp beside it —
     and it would keep pulsing over a session that died an hour ago. */
  .badge-in-flight::before {
    content: "";
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--in-flight);
  }
  /* Heard from, but not recently. Grey rather than red: a session that stopped is
     the normal end of work, and only the reader knows whether it should not have. */
  .badge-in-flight.stale {
    background: var(--bg-sidebar);
    color: var(--fg-muted);
  }
  .badge-in-flight.stale::before { background: var(--fg-muted); }

  .task-card-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 4px;
  }
  .task-card-id {
    font-family: "SF Mono", Monaco, Menlo, monospace;
    font-size: 11px;
    color: var(--fg-muted);
    font-weight: 600;
  }
  .task-card-meta {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .task-card-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--fg);
    line-height: 1.35;
    margin-bottom: 6px;
  }
  .task-card-footer {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    align-items: center;
  }

  .badge {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }


  .badge-type-code { background: rgba(37,99,235,0.12); color: #1D4ED8; }
  .badge-type-manual { background: rgba(217,119,6,0.12); color: #B45309; }

${paletteBadgeCss}

  .badge-epic {
    background: rgba(124, 58, 237, 0.14);
    color: #6D28D9;
    text-transform: none;
    letter-spacing: 0;
    font-weight: 500;
  }

  /* A status another branch disagrees with (TL-73). Amber and outlined rather
     than a palette colour: it is not one more vocabulary value, it is a warning
     that the value beside it is not the whole truth. The branch name is in the
     text, never only in the tooltip — a colour that carries information alone is
     information lost on a printout and to anybody who does not see the shade. */
  .badge-elsewhere {
    background: rgba(217, 119, 6, 0.12);
    color: #B45309;
    border: 1px solid rgba(217, 119, 6, 0.45);
    text-transform: none;
    letter-spacing: 0;
    font-weight: 500;
  }
  @media (prefers-color-scheme: dark) {
    .badge-elsewhere { background: rgba(251, 191, 36, 0.16); color: #FCD34D; border-color: rgba(251, 191, 36, 0.45); }
  }
  @media (prefers-color-scheme: dark) {
    .badge-epic { background: rgba(167, 139, 250, 0.18); color: #C4B5FD; }
    .badge-board { background: rgba(56, 189, 248, 0.18); color: #7DD3FC; }
  }
  @media (prefers-color-scheme: dark) {
    }
  /* ─── Connection banner + action buttons ────────────────────────── */
  .connection-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
    padding: 8px 12px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    font-size: 12px;
  }
  .connection-bar.live {
    border-color: var(--status-done);
    background: rgba(22,163,74,0.06);
  }
  .connection-bar.snapshot {
    border-color: var(--status-pending);
  }
  .connection-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--status-pending);
  }
  .connection-bar.live .connection-dot { background: var(--status-done); }
  .connection-status { font-weight: 600; }
  .connection-hint { color: var(--fg-muted); flex: 1; }
  .btn-action {
    background: var(--bg-card);
    border: 1px solid var(--border);
    color: var(--fg);
    padding: 5px 12px;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
    font-family: inherit;
    transition: all 120ms ease;
  }
  .btn-action:hover { background: var(--accent-soft); border-color: var(--accent); }
  .btn-action.primary {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }
  .btn-action.primary:hover { background: var(--accent); opacity: 0.9; }
  .btn-action:disabled { opacity: 0.5; cursor: not-allowed; }

  /* ─── Toast ─────────────────────────────────────────────────────── */
  .toast {
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 10px 16px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: var(--shadow-md);
    font-size: 13px;
    z-index: 100;
    animation: slideIn 200ms ease;
    max-width: 380px;
  }
  .toast.success { border-left: 3px solid var(--status-done); }
  .toast.error { border-left: 3px solid var(--status-blocked); }
  .toast.info { border-left: 3px solid var(--accent); }
  @keyframes slideIn {
    from { transform: translateX(20px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }

  /* ─── Detail panel ──────────────────────────────────────────────── */
  article.task-detail {
    overflow-y: auto;
    padding: 32px 48px;
    background: var(--bg);
  }
  .empty-state {
    color: var(--fg-muted);
    text-align: center;
    margin-top: 80px;
    font-size: 14px;
  }
  .detail-header { margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
  .detail-header h1 {
    font-size: 22px;
    margin: 0 0 8px 0;
    font-weight: 600;
  }
  .detail-id {
    font-family: "SF Mono", Monaco, Menlo, monospace;
    font-size: 13px;
    color: var(--fg-muted);
    margin-right: 12px;
  }
  .detail-meta-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 12px;
    margin-top: 16px;
    background: var(--bg-card);
    padding: 14px;
    border-radius: 8px;
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
  }
  /* ─── Markdown content ──────────────────────────────────────────── */
  .markdown-body h2 {
    font-size: 16px;
    margin: 24px 0 10px 0;
    color: var(--accent);
    font-weight: 600;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border);
  }
  .markdown-body h3 {
    font-size: 14px;
    margin: 18px 0 8px 0;
    font-weight: 600;
  }
  .markdown-body h4 {
    font-size: 13px;
    margin: 14px 0 6px 0;
    font-weight: 600;
    color: var(--fg-muted);
  }
  .markdown-body p { margin: 8px 0; }
  .markdown-body ul, .markdown-body ol { margin: 8px 0; padding-left: 24px; }
  .markdown-body li { margin: 3px 0; }
  .markdown-body li.task-item { list-style: none; margin-left: -20px; }
  .markdown-body li.task-item.done { color: var(--fg-muted); }
  .markdown-body code {
    background: var(--bg-sidebar);
    padding: 1px 5px;
    border-radius: 3px;
    font-family: "SF Mono", Monaco, Menlo, monospace;
    font-size: 12px;
  }
  .markdown-body pre.code {
    background: var(--code-bg);
    color: var(--code-fg);
    padding: 12px 16px;
    border-radius: 6px;
    overflow-x: auto;
    margin: 10px 0;
    font-size: 12px;
    line-height: 1.5;
  }
  .markdown-body pre.code code {
    background: transparent;
    color: inherit;
    padding: 0;
    font-size: inherit;
  }
  .markdown-body a {
    color: var(--accent);
    text-decoration: none;
    border-bottom: 1px solid transparent;
  }
  .markdown-body a:hover { border-bottom-color: var(--accent); }
  .markdown-body table {
    border-collapse: collapse;
    margin: 12px 0;
    font-size: 12px;
    width: 100%;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }
  .markdown-body th, .markdown-body td {
    padding: 6px 10px;
    text-align: left;
    border-bottom: 1px solid var(--border);
  }
  .markdown-body th {
    background: var(--bg-sidebar);
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    color: var(--fg-muted);
  }
  .markdown-body tr:last-child td { border-bottom: none; }
  .markdown-body hr { border: none; border-top: 1px solid var(--border); margin: 20px 0; }
  .markdown-body blockquote {
    border-left: 3px solid var(--accent);
    padding-left: 14px;
    color: var(--fg-muted);
    margin: 10px 0;
  }

  /* ─── Search ────────────────────────────────────────────────────── */
  .search {
    width: 100%;
    padding: 6px 12px;
    border: 1px solid var(--border);
    background: var(--bg-card);
    color: var(--fg);
    border-radius: 6px;
    font-size: 13px;
    font-family: inherit;
    margin-bottom: 10px;
  }
  .search:focus { outline: 2px solid var(--accent); outline-offset: -1px; border-color: transparent; }

  /* ─── Empty filter result ───────────────────────────────────────── */
  .no-results {
    text-align: center;
    color: var(--fg-muted);
    padding: 40px 20px;
    font-size: 13px;
  }
  /* ─── View tabs ─────────────────────────────────────────────────── */
  .view-tabs { display: flex; gap: 4px; margin-left: auto; }
  .view-tab {
    font: inherit;
    font-size: 12px;
    padding: 5px 14px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--fg-muted);
    border-radius: 999px;
    cursor: pointer;
  }
  .view-tab:hover { border-color: var(--accent); color: var(--fg); }
  .view-tab.is-active {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--fg);
    font-weight: 600;
  }
  /* A separate class, NOT .view-tab: the loop that binds the tabs reads
     dataset.view from every .view-tab and would switch the view to undefined. */
  .copy-link-btn {
    font: inherit;
    font-size: 12px;
    padding: 5px 14px;
    border: 1px dashed var(--border);
    background: transparent;
    color: var(--fg-muted);
    border-radius: 999px;
    cursor: pointer;
    margin-left: 10px;
  }
  .copy-link-btn:hover { border-color: var(--accent); color: var(--fg); }

  /* ─── Execution (the plan as waves, TL-109) ─────────────────────── */
  /* A flow, not a table: the whole point of the view is that it does not look
     like the rest of the page. Every colour is a token, so the dark block below
     needs no rule of its own. */
  .execution-view { display: none; }
  body.view-execution main.app-main { display: none; }
  body.view-execution .filters-bar,
  body.view-execution .stats { display: none; }
  body.view-execution .execution-view {
    display: block;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 20px 24px 64px;
  }
  .exec-head h2 { margin: 0 0 2px; font-size: 16px; }
  .exec-updated { font-size: 11px; color: var(--fg-muted); font-variant-numeric: tabular-nums; }
  .exec-rationale { margin: 6px 0 18px; color: var(--fg-muted); font-size: 13px; max-width: 70ch; }
  .exec-flow { position: relative; }
  /* The edges are drawn UNDER the cards and never take a click. */
  .exec-edges {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 0;
    overflow: visible;
  }
  .exec-edges path {
    fill: none;
    stroke: var(--fg-muted);
    stroke-width: 1.5;
    opacity: .45;
  }
  .exec-wave {
    position: relative;
    z-index: 1;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--bg-card);
    padding: 10px 14px 14px;
    margin-bottom: 18px;
  }
  .exec-wave.is-active { border-color: var(--accent); box-shadow: var(--shadow); }
  .exec-wave.is-past { opacity: .55; }
  .exec-wave-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; }
  .exec-wave-name { font-weight: 600; font-size: 13px; }
  .exec-wave-count { font-size: 11px; color: var(--fg-muted); font-variant-numeric: tabular-nums; }
  .exec-wave-tag {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: .06em;
    color: var(--accent);
    border: 1px solid var(--accent);
    border-radius: 999px;
    padding: 1px 8px;
  }
  /* The "now" line: the boundary between what is finished and the rest. A word,
     not only a colour — the rule the status badges follow (TL-52). */
  .exec-now {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 4px 0 10px;
    color: var(--accent);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: .08em;
  }
  .exec-now::after {
    content: "";
    flex: 1;
    border-top: 2px dashed var(--accent);
  }
  .exec-cards { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-start; }
  .exec-group {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    padding: 20px 10px 10px;
    position: relative;
    border: 1px dashed var(--accent);
    border-radius: 10px;
  }
  .exec-group-label {
    position: absolute;
    top: 4px;
    left: 10px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: .06em;
    color: var(--accent);
  }
  .exec-card {
    width: 230px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    padding: 8px 10px 9px;
  }
  .exec-card.is-closed { opacity: .6; }
  .exec-card.is-running { border-color: var(--accent); }
  .exec-card.is-unknown { border-style: dashed; }
  /* Running, but in ANOTHER working tree (TL-210). The card has to read as
     running — that is the fact the view was standing still about — without
     reading as work this reader can pick up. Two signals, as on the Tasks card:
     the border keeps the running colour and turns DASHED, which survives a
     printout and a reader who does not separate the shades, and the head names
     the tree in words. */
  .exec-card.is-elsewhere { border-style: dashed; }
  /* The bar under a foreign card is measured from that tree's log, and its fill
     says so — the accent belongs to work in this tree. */
  .exec-card.is-elsewhere .exec-bar-fill { background: rgba(217, 119, 6, 0.22); }
  @media (prefers-color-scheme: dark) {
    .exec-card.is-elsewhere .exec-bar-fill { background: rgba(251, 191, 36, 0.24); }
  }
  /* ── The critical path, the selected chain, and motion (TL-110) ──────────
     Every state below is carried by MORE than a hue: the critical path adds a
     thicker border, a left rule and the words "critical path" on the card; the
     selection dims what is not in the chain rather than tinting what is. A
     reader who cannot separate two colours still sees which cards are meant. */
  .exec-card { transition: opacity .18s ease, transform .18s ease, border-color .18s ease; }
  .exec-card.is-critical {
    border-width: 2px;
    border-color: var(--accent);
    box-shadow: inset 3px 0 0 0 var(--accent);
  }
  .exec-critical-tag {
    font-weight: 600;
    color: var(--accent);
    white-space: nowrap;
  }
  .exec-critical-sum {
    margin-left: 10px;
    font-size: 11px;
    font-weight: 600;
    color: var(--accent);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .exec-critical-head { margin: 4px 0 0; }
  .exec-critical-head .exec-critical-sum { margin-left: 0; }
  /* Thicker AND solid against the dashed rest — the same rule as the cards. */
  .exec-edges path.is-critical { stroke: var(--accent); stroke-width: 3; opacity: .9; }
  .exec-edges path:not(.is-critical) { stroke-dasharray: 4 3; }

  /* Selection: the chain a task unblocks. Everything else recedes, which is why
     nothing has to be tinted to say "this one". */
  .exec-flow.is-focused .exec-card { opacity: .22; }
  .exec-flow.is-focused .exec-card.is-lit { opacity: 1; }
  .exec-flow.is-focused .exec-card.is-selected {
    opacity: 1;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent);
  }
  .exec-flow.is-focused .exec-edges path { opacity: .08; }
  .exec-flow.is-focused .exec-edges path.is-lit { opacity: .9; stroke: var(--accent); stroke-width: 2.5; }
  .exec-selection-hint {
    margin: 6px 0 0;
    font-size: 11px;
    color: var(--fg-muted);
  }

  /* A card that has just moved, and a wave that has just closed in full. Both
     announce a change that ACTUALLY happened — the first paint animates
     nothing, because there is nothing yet for a card to have moved from. */
  @keyframes execPulse {
    0%   { transform: translateY(-4px); box-shadow: 0 0 0 0 var(--accent); }
    35%  { transform: translateY(0);    box-shadow: 0 0 0 4px var(--accent-soft); }
    100% { transform: translateY(0);    box-shadow: 0 0 0 0 transparent; }
  }
  @keyframes execWaveDone {
    0%   { background: var(--accent-soft); }
    100% { background: transparent; }
  }
  .exec-card.just-changed { animation: execPulse .9s ease-out; }
  .exec-wave.just-closed { animation: execWaveDone 1.4s ease-out; }

  /* MOTION IS OPT-OUT, and the opt-out is the reader's system setting rather
     than a control in this page: somebody who has asked their machine for less
     motion has already answered, and asking again is a worse answer. The
     information survives — only the movement stops. */
  @media (prefers-reduced-motion: reduce) {
    .exec-card { transition: none; }
    .exec-card.just-changed,
    .exec-wave.just-closed { animation: none; }
  }
  /* Wrapping, because the badge naming another tree (TL-210) is a directory
     name and does not shorten to fit beside the id and the status. */
  .exec-card-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 4px; }
  .exec-id { font-size: 11px; font-weight: 600; color: var(--accent); text-decoration: none; }
  .exec-id:hover { text-decoration: underline; }
  .exec-title { font-size: 12px; line-height: 1.35; }
  .exec-meta { margin-top: 5px; font-size: 11px; color: var(--fg-muted); }
  .exec-waiting { white-space: nowrap; }
  .exec-missing { background: var(--bg-card); color: var(--fg-muted); }
  .exec-bar {
    position: relative;
    margin-top: 7px;
    height: 14px;
    border-radius: 999px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    overflow: hidden;
  }
  .exec-bar-fill { height: 100%; background: var(--accent-soft); }
  .exec-bar-label {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    color: var(--fg-muted);
    font-variant-numeric: tabular-nums;
  }
  .exec-unplanned { margin-top: 10px; }
  .exec-unplanned h3 { font-size: 13px; margin: 0 0 4px; }
  .exec-unplanned p { color: var(--fg-muted); font-size: 12px; margin: 0 0 8px; max-width: 70ch; }
  .exec-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .exec-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 340px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    color: var(--fg);
    text-decoration: none;
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 3px 10px 3px 4px;
  }
  .exec-chip:hover { border-color: var(--accent); }
  .exec-empty { max-width: 70ch; }
  .exec-empty h2 { font-size: 16px; margin: 0 0 8px; }
  .exec-empty p { color: var(--fg-muted); font-size: 13px; }
  .exec-empty pre {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    font-size: 12px;
    overflow-x: auto;
  }

  /* ─── Waiting on you (TL-115) ────────────────────────────────────── */
  .decisions-view { display: none; }
  body.view-decisions main.app-main { display: none; }
  body.view-decisions .filters-bar,
  body.view-decisions .stats { display: none; }
  body.view-decisions .decisions-view {
    display: block;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 20px 24px 64px;
  }
  .dec-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 4px; }
  .dec-head h2 { margin: 0; font-size: 16px; }
  .dec-lede { color: var(--fg-muted); font-size: 13px; max-width: 74ch; margin: 0 0 16px; }
  /* THREE KINDS, THREE SHAPES (TL-205, TL-212). A question is a paragraph
     somebody has to think about; a task marked for a person has nothing to read
     and one action; a vouch is finished work with one line to check.
     Rendered as the same bordered box they cost the same to scan, so the reader
     had to open every row to learn which was which. An ELEVATED card carries a
     question; a FLAT line carries a marked task, and the difference in vertical
     rhythm (14px against 2px) is visible before a word is read. A vouch sits
     between them — inset, not elevated — because it is neither a decision to make
     nor work to start.
     The ORDER is untouched: every kind stays in ONE list sorted by what the
     decision releases (TL-115), because grouping by kind would put a question
     that frees nothing above a task that frees nine. */
  .dec-q {
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    border-radius: 10px;
    background: var(--bg-card);
    box-shadow: var(--shadow);
    padding: 14px 16px;
    margin: 14px 0;
  }
  /* No border, no card: a marked task is a line on the page. \`--border\` on the
     left rule keeps the two kinds aligned down a common edge. */
  .dec-t {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
    border-left: 3px solid var(--border);
    padding: 6px 14px 6px 13px;
    margin: 2px 0;
    border-radius: 0 8px 8px 0;
  }
  .dec-t:hover { background: var(--bg-card); border-left-color: var(--fg-muted); }
  /* WORKED, WAITING FOR A SIGNATURE (TL-212). Tinted rather than elevated: the
     tint says "this one is different" at a glance, and the absence of a shadow
     says it is not asking to be thought about. */
  .dec-v {
    border-left: 3px solid var(--vouch);
    background: var(--vouch-bg);
    padding: 9px 14px 10px 13px;
    margin: 6px 0;
    border-radius: 0 8px 8px 0;
  }
  .dec-v .dec-src { align-items: baseline; }
  /* The \`manual:\` entry's own words — the ONE thing the reader has to do, and
     the only place it is written. Monospaced because it is quoted from a
     contract, not prose the page wrote. */
  .dec-do {
    margin: 7px 0 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12.5px;
    line-height: 1.5;
    max-width: 78ch;
    color: var(--fg);
  }
  .dec-vtag {
    flex: none;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: .06em;
    font-weight: 600;
    color: var(--vouch);
    white-space: nowrap;
  }
  /* The provenance of a question, above it and quieter than it: which task it
     was asked on is context, the question is the text. */
  .dec-src { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; font-size: 11px; }
  .dec-id { font-weight: 600; font-size: 12px; color: var(--accent); text-decoration: none; }
  .dec-id:hover { text-decoration: underline; }
  .dec-title { font-size: 13px; }
  .dec-src .dec-title { font-size: 11px; color: var(--fg-muted); }
  .dec-unblocks { font-size: 11px; color: var(--fg-muted); font-variant-numeric: tabular-nums; }
  .dec-src .dec-unblocks { margin-left: auto; }
  /* An EMPTY element doing the pushing, so \`releases N\` lands in the same column
     on a flat row as on a card while the row's action stays right of it. Two
     \`margin-left: auto\` siblings would split the free space between them and
     leave the count stranded in the middle. */
  .dec-gap { flex: 1 1 0; }
  /* THE ONLY TEXT ON THE PAGE ANYBODY HAS TO THINK ABOUT, so it gets the size
     and the measure. No box: a border around it competed with it. */
  .dec-ask {
    margin: 8px 0 0;
    font-size: 15px;
    line-height: 1.55;
    max-width: 72ch;
    color: var(--fg);
  }
  /* THE MENU (TL-204). Numbers are the ones \`decide --choose <n>\` takes, so a
     reader who moves to the terminal types what they read here. */
  .dec-menu { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-width: 78ch; }
  .dec-opt {
    font: inherit;
    font-size: 13px;
    line-height: 1.5;
    display: flex;
    gap: 9px;
    width: 100%;
    text-align: left;
    padding: 8px 11px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--fg);
    cursor: pointer;
  }
  .dec-opt:hover:not(:disabled) { border-color: var(--accent); }
  .dec-opt:disabled { cursor: default; }
  .dec-opt-n { flex: none; color: var(--fg-muted); font-variant-numeric: tabular-nums; font-weight: 600; }
  /* Marked by a WORD as well as a colour: the recommendation has to survive a
     monochrome print and a reader who does not see the accent. */
  .dec-opt.is-rec { border-color: var(--accent); background: var(--accent-soft); }
  .dec-opt.is-rec .dec-opt-n { color: var(--fg); }
  /* \`--fg\` and NOT \`--accent\`: the tag sits on \`--accent-soft\`, where the accent
     reaches about 2.3:1 in the light theme — unreadable at 10px. The colour is
     already carried by the row's fill and border, so the word does not need to
     repeat it, and it is the word that has to survive a monochrome print. */
  .dec-rec {
    display: inline-block;
    margin-left: 6px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: .06em;
    font-weight: 600;
    color: var(--fg);
    white-space: nowrap;
  }
  .dec-meta { margin-top: 6px; font-size: 11px; color: var(--fg-muted); }
  .dec-q .dec-meta { margin-top: 10px; }
  /* A marked task keeps the decision box it always had, one click away rather
     than in the reader's face: the row's own action is to go and DO the task. */
  .dec-note { margin-left: 12px; }
  .dec-note > summary { font-size: 11px; color: var(--fg-muted); cursor: pointer; }
  .dec-note > summary:hover { color: var(--accent); }
  .dec-note[open] { margin-left: 0; flex-basis: 100%; }
  .dec-note[open] > summary { margin-bottom: 2px; }
  .dec-actions { margin-top: 10px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .dec-q .dec-actions { max-width: 78ch; }
  .dec-actions input {
    font: inherit;
    font-size: 12px;
    flex: 1;
    min-width: 220px;
    padding: 5px 9px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--fg);
  }
  .dec-hint { font-size: 11px; color: var(--fg-muted); }
  .dec-empty { color: var(--fg-muted); font-size: 13px; max-width: 74ch; }
  .tab-count {
    display: inline-block;
    margin-left: 6px;
    min-width: 17px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--accent);
    color: white;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }

  /* ─── Scrollbars ────────────────────────────────────────────────── */
  /* The default chrome is a light slab that ignores the theme — in dark mode
     it was the brightest thing on the page. */
  * { scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-corner { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: var(--border);
    border: 2px solid transparent;
    background-clip: content-box;
    border-radius: 999px;
  }
  ::-webkit-scrollbar-thumb:hover { background: var(--fg-muted); background-clip: content-box; }

  .range-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 10px 14px;
    margin-bottom: 16px;
    box-shadow: var(--shadow);
    font-size: 12px;
  }
  .range-title { font-weight: 600; }
  .range-presets { display: flex; gap: 4px; flex-wrap: wrap; }
  .range-preset {
    font: inherit;
    padding: 4px 10px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--fg-muted);
    border-radius: 999px;
    cursor: pointer;
  }
  .range-preset:hover { border-color: var(--accent); color: var(--fg); }
  .range-preset.is-active { background: var(--accent-soft); border-color: var(--accent); color: var(--fg); font-weight: 600; }
  /* "Custom" is a state readout, not a button — it turns on when you touch a
     date field, and clicking it would have nothing to set. */
  span.range-preset { cursor: default; }
  span.range-preset:hover { border-color: var(--border); color: var(--fg-muted); }
  span.range-preset.is-active { color: var(--fg); }
  .range-field { display: inline-flex; align-items: center; gap: 6px; color: var(--fg-muted); }
  .range-field input {
    font: inherit;
    color: var(--fg);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 3px 6px;
  }
  .range-meta { color: var(--fg-muted); font-variant-numeric: tabular-nums; }
  .range-hint { flex-basis: 100%; color: var(--fg-muted); font-size: 11px; }

</style>
</head>
<body>

<header class="app-header">
  <div class="app-title">
    <h1>${escapeHtml(config.projectName)}</h1>
    <span class="build-meta">snapshot: ${buildTime}</span>
    <nav class="view-tabs" id="viewTabs">
      <button type="button" class="view-tab is-active" data-view="tasks">Tasks</button>
      <button type="button" class="view-tab" data-view="execution">Execution</button>
      <button type="button" class="view-tab" data-view="decisions" id="tabDecisions">Waiting on you</button>
      <button type="button" class="copy-link-btn" id="btnCopyLink"
              title="Copies the address of this view — filters, search, sort, board and the selected task">⧉ Copy link</button>
    </nav>
  </div>

  <div class="connection-bar snapshot" id="connectionBar">
    <span class="connection-dot"></span>
    <span class="connection-status" id="connectionStatus">Snapshot mode</span>
    <span class="connection-hint" id="connectionHint">Data from the moment of the build. Connect to the folder to work on live files and edit statuses.</span>
    <div class="worktree-picker" id="worktreePicker" style="display:none"></div>
    <button class="btn-action primary" id="btnConnect">Connect to the backlog folder</button>
    <button class="btn-action" id="btnRefresh" style="display:none">Refresh from disk</button>
    <button class="btn-action" id="btnDisconnect" style="display:none">Disconnect</button>
  </div>

  <div class="board-scope" id="boardScope"></div>

  <div class="stats" id="stats"></div>

  <div class="filters-bar">
    <div class="filters" id="filters"></div>
    <div class="active-filters" id="activeFilters"></div>
  </div>
</header>

<main class="app-main">
  <aside class="task-list" id="taskList">
    <input type="search" class="search" id="searchInput" placeholder="Search titles and ids…" autocomplete="off">
    <div id="cards"></div>
  </aside>

  <article class="task-detail markdown-body" id="taskDetail">
    <div class="empty-state">
      ← Pick a task from the list, or use <code>#${config.taskIdPrefix}-001</code> in the URL.
    </div>
  </article>
</main>

<section class="execution-view" id="executionView"></section>
<section class="decisions-view" id="decisionsView"></section>

<script>
// EVERY KEY THIS PAGE WRITES INTO THE BROWSER (TL-178). One prefix, injected
// from \`STORAGE_KEY_PREFIX\` in scripts/product.mjs, which is FROZEN: these key
// data already stored in browsers nobody can reach, so they may not follow a
// rename of the display name.
const STORAGE_PREFIX = ${storagePrefix};

// ─── Pasted source of scripts/viewer-url.mjs (BL-1390) ────────────────
// The link format for the tasks view. Edit THAT file — this is the build's copy,
// which \`node --test scripts/tests/viewer-url.test.mjs\` tests.
${urlModuleSrc}
// ─── end of the pasted module ─────────────────────────────────────────

// ─── Pasted source of scripts/task-fields.mjs (BL-1396) ───────────────
// The field schema, the validation and the frontmatter parser. The same file
// validates the writes on the server side (serve-backlog.mjs) and is run by
// node --test scripts/tests/task-fields.test.mjs — the browser has no copy of
// the rules of its own, so the UI cannot admit a value the server would reject
// (or the other way round).
${fieldsModuleSrc}

${estimateModuleSrc}

// ─── Pasted source of scripts/elsewhere.mjs (TL-124) ─────────────────
// How a cross-branch divergence is worded and marked. The terminal imports the
// same file, so the page cannot name the situation differently than \`query\` does.
${elsewhereModuleSrc}
// ─── end of the pasted module ─────────────────────────────────────────

// ─── Pasted source of scripts/plan.mjs (TL-107) ──────────────────────
// \`planState()\` — the five definitions of "active wave", "next up", "in
// progress", "unplanned" and "stale". The \`plan\` command imports THIS file, so the
// terminal and the page cannot disagree about which task comes next.
${planModuleSrc}
// ─── end of the pasted module ─────────────────────────────────────────

// ─── Pasted source of scripts/viewer-plan.mjs (TL-109) ───────────────
// The Execution view: the model and the HTML, tested by
// node --test scripts/tests/viewer-plan.test.mjs.
${viewerPlanModuleSrc}
// ─── end of the pasted module ─────────────────────────────────────────

// ─── Pasted source of scripts/decision-panel.mjs (TL-115) ────────────
// What hangs on a person's decision — computed from the tasks and the history,
// with no stored state of its own. Tested by
// node --test scripts/tests/decision-panel.test.mjs.
${decisionPanelModuleSrc}
// ─── end of the pasted module ─────────────────────────────────────────

// ─── Pasted source of scripts/task-graph.mjs (TL-116) ────────────────
// One task's history folded into a graph, and the SVG for it. Nothing is
// stored — delete it and a rebuild brings it back. Tested by
// node --test scripts/tests/task-graph.test.mjs.
${taskGraphModuleSrc}
// ─── end of the pasted module ─────────────────────────────────────────


// TASKS / STATS are mutable — live mode replaces them after reading from disk.
// ALL_TASKS is the full set; TASKS is its narrowing to the selected board.
// The split is here rather than at every place that reads TASKS, because a board
// is meant to be a SCOPE, not a filter: a filter narrows the list of cards,
// while a scope narrows the source everything below reads from.
// THE LIVE SIGNAL IS NOT EMBEDDED (TL-189) — it starts empty and is filled from
// /api/in-flight. This file is also written to backlog/viewer.html and mailed
// around, and the heartbeat log is a record of what hour a particular person
// worked; baking it in here would carry that record out of the machine that holds
// it. Over file:// the map therefore stays empty and no card claims anything,
// which is the honest state: there is nobody to ask.
// { "<ID>": {last, actor, session, events, sessions, since} }
let IN_FLIGHT = {};
// The SERVER's clock, from the same response. A browser five minutes off would
// otherwise read a live session as stale, or the reverse, and would do it
// silently. Held as an OFFSET so the age keeps advancing between fetches.
let IN_FLIGHT_SKEW_MS = 0;
let HISTORY = ${historyJson};
let ALL_TASKS = ${tasksJson};
let TASKS = ALL_TASKS;
let STATS = ${statsJson};
const BOARDS = ${boardsJson};
// This project's vocabularies (config.yaml + boards.yaml) — the page's code knows
// no particular value, it receives them from here (BL-1400).
const CONFIG = ${configJson};
// The plan file as it was read from disk. Mutable: the server hands a fresh copy
// back on /api/tasks, so an edit to plan.yaml reaches an open tab.
let PLAN = ${planJson};

// The id prefix is a PROJECT value (BL-1452), and the client had it hardcoded in
// three places (TL-44): the file filter when reading from disk and two sorts by
// number. Each of them, under a different prefix, quietly returned "nothing" or
// "zero" — with no error and no empty screen with a reason.
const TASK_PREFIX = CONFIG.taskIdPrefix || "TASK";
const TASK_FILE_RE = new RegExp("^" + TASK_PREFIX + "-\\d+.*\\.md$");
const taskNum = (id) => parseInt(String(id || "").replace(new RegExp("^" + TASK_PREFIX + "-"), ""), 10) || 0;
const FIELDS = buildFieldSpecs(CONFIG);
const BOARD_ALL = "__all__";

// ─── State ────────────────────────────────────────────────────────────
const state = {
  filterStatus: new Set(),
  filterPriority: new Set(),
  filterType: new Set(),
  filterLabel: new Set(),
  filterEnv: new Set(),   // the values of the label_axis_env axis plus "n/a"
  filterEpic: new Set(),  // values: epic name | NO_EPIC constant
  sortBy: "priority",     // "priority" | "id_asc" | "id_desc"
  view: "tasks",          // "tasks" | "dashboard" | "execution" | "decisions"
  // The panel's own filter: "" = everything, "mine" = rows naming this actor.
  // The moment the replay is showing (TL-91): an ISO instant, or null for the
  // last one the log covers. A moment and not a day — everything within one day
  // would otherwise encode to the same address.
  search: "",
  selectedId: null,
  liveMode: false,        // true after successful File System Access pick
  dirHandle: null,        // FileSystemDirectoryHandle for backlog/
  // Field editing (BL-1396): { id, field } or null. One field at a time — an open
  // an editor is a state of the view, not a state of the task.
  editing: null,
  // Who is editing (BL-1397). The entry goes into the history, so the default
  // value has to be the one that IS true in typical use of the viewer.
  actor: "founder",
  historyOpen: false,
  // The change graph (TL-116) is closed by default: a reader who opened a task
  // to change a field must not have to scroll past a picture to reach it.
  graphOpen: false,
  historyField: null,     // narrows the history list to one field
  // The scope, not a filter: BOARD_ALL or a board slug. Kept apart from
  // the filter* fields, because clearing the filters must not clear it — this is
  // the context of the work, not a narrowing inside that context.
  board: BOARD_ALL,
};

const NO_EPIC = "__none__";
const ENV_NEUTRAL = "n/a";

/** A vocabulary value as a label: "in_progress" -> "In progress". */
function labelTitle(v) {
  const s = String(v || "").replace(/[_-]+/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Board scope ──────────────────────────────────────────────────────
const BOARD_STORAGE_KEY = STORAGE_PREFIX + "-board";

/**
 * Boards to offer in the selector: the registry from the build plus everything that
 * lives in the data. The second half is not decoration — in live mode the data
 * come from disk while the registry comes from the moment of the build, so a board
 * added after the build would exist in the tasks but in no scope. A task must not
 * disappear from the UI because the viewer is older than boards.yaml.
 */
function knownBoards() {
  const out = [];
  const seen = new Set();
  for (const b of BOARDS) {
    out.push({ slug: b.slug, name: b.name });
    seen.add(b.slug);
  }
  for (const t of ALL_TASKS) {
    const b = (t.board || "").trim();
    if (b && !seen.has(b)) {
      seen.add(b);
      out.push({ slug: b, name: b + " (not in the registry)" });
    }
  }
  return out;
}

/** Whether such a scope exists at all — both the URL and the localStorage value ask this. */
function isKnownScope(slug) {
  return slug === BOARD_ALL || knownBoards().some((b) => b.slug === slug);
}

/**
 * A scope given in the URL. With no write to localStorage and no toast: a link is
 * show the sender's set, not to change somebody's working context for good — the
 * same way \`viewer.html?board=…\` has behaved for a long time. The caller renders.
 */
function applyBoardFromUrl(slug) {
  if (!isKnownScope(slug) || state.board === slug) return;
  state.board = slug;
  applyScope();
}

/** Narrows the source to the selected board and recomputes the stats from that set. */
function applyScope() {
  TASKS = state.board === BOARD_ALL
    ? ALL_TASKS
    : ALL_TASKS.filter((t) => (t.board || "") === state.board);
  STATS = computeStatsClient(TASKS);
}

function setBoardScope(slug, opts) {
  const next = slug || BOARD_ALL;
  if (state.board === next) return;
  state.board = next;
  try { localStorage.setItem(BOARD_STORAGE_KEY, next); } catch { /* a private window */ }
  applyScope();
  // A selection from another board has no right to survive — it would show the
  // detail of a task that is not in the list beside it.
  if (state.selectedId && !TASKS.some((t) => t.id === state.selectedId)) {
    state.selectedId = null;
  }
  renderBoardScope();
  render();
  if (!opts || !opts.quiet) {
    const label = next === BOARD_ALL ? "all boards" : "board " + boardLabel(next);
    toast("Scope: " + label + " — " + TASKS.length + " tasks", "success");
  }
}

function boardLabel(slug) {
  const b = knownBoards().find((x) => x.slug === slug);
  return b ? b.name : slug;
}

/** The segmented switch in the header: the scope plus how many tasks each board has. */
function renderBoardScope() {
  const el = document.getElementById("boardScope");
  if (!el) return;
  const boards = knownBoards();
  if (!boards.length) { el.style.display = "none"; return; }
  el.style.display = "";
  el.innerHTML = "";

  const label = document.createElement("span");
  label.className = "board-scope-label";
  label.textContent = "Board:";
  el.appendChild(label);

  const mk = (slug, text, count) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "board-btn" + (state.board === slug ? " is-active" : "");
    b.setAttribute("aria-pressed", String(state.board === slug));
    b.innerHTML = escape(text) + ' <span class="board-count">' + count + "</span>";
    b.onclick = () => setBoardScope(slug);
    el.appendChild(b);
  };
  mk(BOARD_ALL, "All", ALL_TASKS.length);
  for (const b of boards) {
    mk(b.slug, b.name, ALL_TASKS.filter((t) => (t.board || "") === b.slug).length);
  }
}

// The status vocabulary comes from the configuration — the same one the server
// validates against. A local list would drift at the first new status.
const STATUSES = CONFIG.statuses;

// The reason for a change (TL-105). The RULE is one line and reads the same
// \`reason_required_statuses\` the server reads — the browser has to know it in
// order to ask BEFORE the write, and the server refuses independently, so an
// answer typed here is a convenience and never the enforcement.
const REASON_REQUIRED_STATUSES = CONFIG.reasonRequiredStatuses || [];
const FS_SUPPORTED = typeof window.showDirectoryPicker === "function";

// Served by scripts/serve-backlog.mjs? Then the backlog path is known
// server-side and there is nothing to pick: no folder dialog, no permission,
// works in every browser. The File System Access path below stays as the
// offline fallback for opening viewer.html straight off the disk — a file://
// page can never be granted a directory without an explicit user pick.
const SERVER_MODE = location.protocol === "http:" || location.protocol === "https:";

// ─── Toast (transient feedback) ──────────────────────────────────────
let toastTimer = null;
function toast(msg, kind) {
  kind = kind || "info";
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();
  if (toastTimer) clearTimeout(toastTimer);
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.textContent = msg;
  document.body.appendChild(el);
  toastTimer = setTimeout(() => el.remove(), 3500);
}

// The frontmatter parser (splitFrontmatter/extractMeta) and the field schema come
// from the task-fields.mjs pasted above — a second copy here would drift away from
// the server's validation at the first change to the schema.

// ─── Inline markdown → HTML (matches build-viewer.mjs subset) ─────────
function escapeHtmlStr(s) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function mdInline(s) {
  s = s.replace(/\`([^\`]+)\`/g, "<code>$1</code>");
  s = s.replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\\*([^*\\s][^*]*[^*\\s]|[^*\\s])\\*(?!\\*)/g, "$1<em>$2</em>");
  s = s.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, (_, t, u) => '<a href="' + u + '" target="_blank" rel="noopener">' + t + '</a>');
  return s;
}
function md2htmlClient(md) {
  const fences = [];
  md = md.replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g, (_, lang, code) => {
    fences.push('<pre class="code"><code class="lang-' + (lang || "text") + '">' + escapeHtmlStr(code.replace(/\\n$/, "")) + "</code></pre>");
    return "\\x00FENCE" + (fences.length - 1) + "\\x00";
  });
  md = escapeHtmlStr(md);
  md = md.replace(/((?:^\\|.*\\|\\s*\\n?)+)/gm, (block) => {
    const rows = block.trim().split("\\n");
    if (rows.length < 2) return block;
    const header = rows[0].split("|").slice(1,-1).map(c => c.trim());
    const body = rows.slice(2).map(r => r.split("|").slice(1,-1).map(c => c.trim()));
    return "<table><thead><tr>" +
      header.map(h => "<th>" + mdInline(h) + "</th>").join("") +
      "</tr></thead><tbody>" +
      body.map(row => "<tr>" + row.map(c => "<td>" + mdInline(c) + "</td>").join("") + "</tr>").join("") +
      "</tbody></table>";
  });
  md = md.replace(/^####\\s+(.+)$/gm, "<h4>$1</h4>");
  md = md.replace(/^###\\s+(.+)$/gm, "<h3>$1</h3>");
  md = md.replace(/^##\\s+(.+)$/gm, "<h2>$1</h2>");
  md = md.replace(/^#\\s+(.+)$/gm, "<h1>$1</h1>");
  md = md.replace(/((?:^[-*]\\s+.*(?:\\n|$))+)/gm, (group) => {
    const items = group.trim().split(/\\n/).map(l => {
      const text = l.replace(/^[-*]\\s+/, "");
      if (text.startsWith("[ ] ")) return '<li class="task-item"><input type="checkbox" disabled> ' + mdInline(text.slice(4)) + "</li>";
      if (text.match(/^\\[x\\]\\s/i)) return '<li class="task-item done"><input type="checkbox" checked disabled> ' + mdInline(text.replace(/^\\[x\\]\\s/i, "")) + "</li>";
      return "<li>" + mdInline(text) + "</li>";
    }).join("");
    return "<ul>" + items + "</ul>";
  });
  md = md.replace(/((?:^\\d+\\.\\s+.*(?:\\n|$))+)/gm, (group) => {
    const items = group.trim().split(/\\n/).map(l => "<li>" + mdInline(l.replace(/^\\d+\\.\\s+/, "")) + "</li>").join("");
    return "<ol>" + items + "</ol>";
  });
  md = md.replace(/^---+\\s*$/gm, "<hr>");
  md = md.split(/\\n{2,}/).map(block => {
    block = block.trim();
    if (!block) return "";
    if (/^<(h\\d|ul|ol|table|pre|hr|blockquote|\\x00FENCE\\d+\\x00)/.test(block)) return block;
    return "<p>" + mdInline(block).replace(/\\n/g, "<br>") + "</p>";
  }).join("\\n");
  md = md.replace(/\\x00FENCE(\\d+)\\x00/g, (_, i) => fences[Number(i)]);
  return md;
}

// ─── IndexedDB for persisting FileSystemDirectoryHandle ──────────────
function dbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(STORAGE_PREFIX + "-viewer", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("handles");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function dbSaveHandle(handle) {
  const db = await dbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction("handles", "readwrite");
    tx.objectStore("handles").put(handle, "backlog");
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}
async function dbLoadHandle() {
  try {
    const db = await dbOpen();
    return new Promise((res, rej) => {
      const tx = db.transaction("handles", "readonly");
      const r = tx.objectStore("handles").get("backlog");
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => rej(r.error);
    });
  } catch (_) { return null; }
}
async function dbClearHandle() {
  const db = await dbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction("handles", "readwrite");
    tx.objectStore("handles").delete("backlog");
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}

// ─── File System Access — live read + write ──────────────────────────
async function loadTasksFromDisk(handle) {
  const tasksDir = await handle.getDirectoryHandle("tasks");
  const tasks = [];
  for await (const [name, fh] of tasksDir.entries()) {
    if (!TASK_FILE_RE.test(name)) continue;
    if (fh.kind !== "file") continue;
    const file = await fh.getFile();
    const text = await file.text();
    const { frontmatter, body } = splitFrontmatter(text);
    const meta = extractMeta(frontmatter);
    tasks.push({ ...meta, file: name, bodyHtml: md2htmlClient(body.trim()) });
  }
  tasks.sort((a, b) => (a.file || "").localeCompare(b.file || ""));
  return tasks;
}
function computeStatsClient(tasks) {
  const by = (key) => tasks.reduce((acc, t) => {
    if (Array.isArray(t[key])) for (const v of t[key]) acc[v] = (acc[v] || 0) + 1;
    else { const k = t[key] || "—"; acc[k] = (acc[k] || 0) + 1; }
    return acc;
  }, {});
  return { total: tasks.length, by_status: by("status"), by_priority: by("priority"), by_type: by("type"), by_label: by("labels"), by_epic: by("epic") };
}
async function verifyPermission(handle) {
  const opts = { mode: "readwrite" };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  if ((await handle.requestPermission(opts)) === "granted") return true;
  return false;
}
async function connectToFolder(handle) {
  state.dirHandle = handle;
  state.liveMode = true;
  await refreshFromDisk();
  updateConnectionBar();
}
async function refreshFromServer(quiet) {
  try {
    const res = await fetch("api/tasks", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    ALL_TASKS = data.tasks;
    // plan.yaml is watched too (TL-109): an order edited in an editor reaches an
    // open tab by the same signal a task edit does.
    if (data.plan) PLAN = data.plan;
    applyScope();
    renderBoardScope();
    render();
    // A status write moves the take, and the take is the window the events are
    // counted in — so the signal is recomputed with the tasks, not only when a
    // heartbeat arrives.
    refreshInFlight();
    if (!quiet) toast("Refreshed " + TASKS.length + " tasks from disk", "success");
  } catch (e) {
    console.error(e);
    toast("Error reading from the server: " + e.message, "error");
  }
}

async function refreshFromDisk() {
  if (SERVER_MODE) return refreshFromServer(false);
  if (!state.dirHandle) return;
  try {
    const tasks = await loadTasksFromDisk(state.dirHandle);
    ALL_TASKS = tasks;
    applyScope();
    renderBoardScope();
    render();
    toast("Refreshed " + tasks.length + " tasks from disk", "success");
  } catch (e) {
    console.error(e);
    toast("Read error: " + e.message, "error");
  }
}
async function pickDirectory() {
  if (!FS_SUPPORTED) {
    toast("Your browser does not support the File System Access API. Use Chrome or Edge.", "error");
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite", id: STORAGE_PREFIX });
    if (!(await verifyPermission(handle))) {
      toast("No write permission", "error"); return;
    }
    // Sanity check: must contain tasks/ + INDEX.yaml
    try { await handle.getDirectoryHandle("tasks"); }
    catch { toast("The chosen folder has no tasks/ subdirectory. Pick the backlog/ folder", "error"); return; }
    await dbSaveHandle(handle);
    await connectToFolder(handle);
    toast("Connected to the backlog folder ✓", "success");
  } catch (e) {
    if (e.name !== "AbortError") {
      console.error(e); toast("Error: " + e.message, "error");
    }
  }
}
async function disconnect() {
  await dbClearHandle();
  state.dirHandle = null;
  state.liveMode = false;
  updateConnectionBar();
  toast("Disconnected. You are now looking at the snapshot from the build.", "info");
}
// NOTHING BELOW WRITES (TL-379). There were once two implementations of a status
// change — one through the server, one through File System Access — each with
// its own idea of what else a change sets, and the second knowing nothing about
// the history at all. Both are gone, and with them the question of which was
// right: a field is changed in the Markdown, through the CLI, under review.
// ─── The worktree switcher (TL-188) ──────────────────────────────────
//
// SWITCHING IS A NAVIGATION, not a swap of the data under an open page. The
// alternative — fetching the other tree's tasks as JSON and replacing ALL_TASKS
// — was rejected because a worktree brings its OWN backlog/config.yaml: its
// statuses, its priorities, its boards, and the palette generated from them. The
// page would then paint one tree's data in another tree's vocabulary, and a
// status with no colour is exactly the kind of wrong that still looks rendered.
// A navigation makes the server build the page from that tree's configuration,
// which is the same guarantee \`${N} viewer\` gives in the terminal.
//
// The subject travels in the QUERY STRING, not the hash: the hash is per-view
// (#tasks, #dashboard, #execution) and clicking a tab would drop the subject,
// while ?worktree= survives every view and is what makes "look at the fleet's
// worktree" one link.
// ─── Connection bar UI ───────────────────────────────────────────────
function updateConnectionBar() {
  const bar = document.getElementById("connectionBar");
  const status = document.getElementById("connectionStatus");
  const hint = document.getElementById("connectionHint");
  const btnConnect = document.getElementById("btnConnect");
  const btnRefresh = document.getElementById("btnRefresh");
  const btnDisconnect = document.getElementById("btnDisconnect");
  if (SERVER_MODE) {
    bar.classList.remove("snapshot", "foreign"); bar.classList.add("live");
    status.textContent = "Live (local server)";
    hint.textContent = "The .md files are read and written by the server. Click any field in the detail panel to change it — a write appends to the history and rebuilds NOW/INDEX/archive.";
    btnConnect.style.display = "none";
    btnDisconnect.style.display = "none";
    btnRefresh.style.display = "";
    return;
  }
  if (state.liveMode) {
    bar.classList.remove("snapshot"); bar.classList.add("live");
    status.textContent = "Live (folder connected)";
    hint.textContent = "The data are read from the .md files on every refresh. Editing fields requires server mode (run ${N} in the terminal).";
    btnConnect.style.display = "none";
    btnRefresh.style.display = ""; btnDisconnect.style.display = "";
  } else {
    bar.classList.remove("live"); bar.classList.add("snapshot");
    status.textContent = "Snapshot mode";
    if (FS_SUPPORTED) {
      hint.textContent = "Data from the moment of the build. Connect to the folder to work on live files (editing fields — server mode only).";
    } else {
      hint.textContent = "Your browser does not support the File System Access API — use Chrome or Edge for live mode.";
      btnConnect.disabled = true;
    }
    btnConnect.style.display = "";
    btnRefresh.style.display = "none"; btnDisconnect.style.display = "none";
  }
}

// ─── Stats ────────────────────────────────────────────────────────────
function renderStats() {
  const el = document.getElementById("stats");
  el.innerHTML = "";
  const filtered = getFilteredTasks();
  const isFiltered = filtered.length !== TASKS.length;
  const total = filtered.length;
  const closed = filtered.filter(t => CONFIG.archivedStatuses.includes(t.status)).length;
  const pct = total ? Math.round((closed / total) * 100) : 0;

  // The chips count by the project's VOCABULARIES (BL-1400), not by names written
  // into the code. The two highest priorities, every type, the whole phase axis —
  // and a project that does not have one of those axes simply gets no chip.
  const chip = (label, count) => '<span class="stat-chip">' + escape(label) + ': <strong>' + count + "</strong></span>";
  const byPriority = CONFIG.priorities.slice(0, 2)
    .map(p => chip(p, filtered.filter(t => t.priority === p).length));
  const byType = (CONFIG.types || [])
    .map(ty => chip(ty, filtered.filter(t => t.type === ty).length));
  const byPhase = (CONFIG.labelAxes.timing || [])
    .map(l => chip(l, filtered.filter(t => (t.labels || []).includes(l)).length));

  el.innerHTML =
    '<span class="stat-chip">' + (isFiltered
      ? "<strong>" + total + "</strong> / " + TASKS.length + " tasks"
      : "<strong>" + total + "</strong> tasks in total") + "</span>"
    + '<span class="stat-chip"><strong>' + closed + "</strong> closed (" + pct + "%)</span>"
    + byPriority.join("") + byType.join("") + byPhase.join("");
}

// ─── Filter dropdowns ─────────────────────────────────────────────────
// One spec per facet: it owns the option list AND the predicate, so filtering,
// cross-filtered counting and chip rendering all read from a single definition
// (previously the predicates lived in getFilteredTasks and the options in
// renderFilters, and the two drifted apart).
//
// \`param\` is this filter's name in the link (#tasks?status=…). It is here, not in
// the URL code, because it is the same decision as the predicate: changing one without the other
// makes a filter that can be clicked and cannot be sent. Note on \`phase\` —
// calling it \`label\` would mislead, because the "Environment" filter also reads labels.
const EPIC_NONE_LABEL = "(no epic)";

const FILTER_SPECS = [
  {
    key: "filterStatus", param: "status", label: "Status",
    match: (t, v) => (t.status || "") === v,
    // The options come from the project's vocabulary (BL-1400) — the facet shows
    // exactly the statuses this backlog knows, not a list written into the viewer.
    options: () => CONFIG.statuses.map(value => ({ value, label: labelTitle(value) })),
  },
  {
    key: "filterPriority", param: "priority", label: "Priority",
    match: (t, v) => (t.priority || "") === v,
    options: () => CONFIG.priorities.map(value => ({ value, label: value })),
  },
  {
    key: "filterType", param: "type", label: "Type",
    match: (t, v) => (t.type || "") === v,
    options: () => (CONFIG.types || []).map(value => ({ value, label: labelTitle(value) })),
  },
  {
    key: "filterLabel", param: "phase", label: "Phase",
    match: (t, v) => (t.labels || []).includes(v),
    // The axis values come from config.yaml (label_axis_timing). An axis with no
    // values disappears from the bar by itself — renderFilters drops empty facets.
    options: () => (CONFIG.labelAxes.timing || []).map(value => ({ value, label: labelTitle(value) })),
  },
  {
    key: "filterEnv", param: "env", label: "Environment",
    match: (t, v) => {
      const ls = t.labels || [];
      const axis = CONFIG.labelAxes.env || [];
      if (axis.includes(v)) return ls.includes(v);
      return !axis.some(a => ls.includes(a));   // "n/a" means outside the whole axis
    },
    options: () => {
      const axis = CONFIG.labelAxes.env || [];
      if (!axis.length) return [];
      return axis.map(value => ({ value, label: labelTitle(value) }))
        .concat([{ value: ENV_NEUTRAL, label: "N/A" }]);
    },
  },
  {
    key: "filterEpic", param: "epic", label: "Epic",
    match: (t, v) => (v === NO_EPIC ? !(t.epic || "").trim() : (t.epic || "").trim() === v),
    // The long list: searchable, and ordered by size so the epics that carry
    // most of the backlog sit at the top of the scroll.
    options: () => {
      const totals = new Map();
      let none = 0;
      for (const t of TASKS) {
        const e = (t.epic || "").trim();
        if (e) totals.set(e, (totals.get(e) || 0) + 1);
        else none++;
      }
      const opts = [...totals.entries()]
        .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
        .map(([value]) => ({ value, label: value }));
      if (none) opts.push({ value: NO_EPIC, label: EPIC_NONE_LABEL });
      return opts;
    },
  },
];

const FILTER_KEYS = FILTER_SPECS.map(s => s.key);
const SEARCH_THRESHOLD = 8;   // options above this get a type-ahead field

// Live DOM registry — the panel is built once per option-set and then synced
// in place. Rebuilding on every toggle (the old behaviour) reset the scroll
// position and stole focus, which made a 90-item list unusable.
const filterUI = new Map();
let filterUISig = null;
let openFilterKey = null;

function selectedFor(spec) { return state[spec.key]; }

/** Tasks passing every filter EXCEPT skipKey — the base for honest counts. */
function tasksMatchingExcept(skipKey) {
  return TASKS.filter(t => {
    for (const spec of FILTER_SPECS) {
      if (spec.key === skipKey) continue;
      const sel = state[spec.key];
      if (sel.size && ![...sel].some(v => spec.match(t, v))) return false;
    }
    return true;
  });
}

function renderFilters() {
  const el = document.getElementById("filters");
  const computed = FILTER_SPECS
    .map(spec => ({ spec, options: spec.options() }))
    .filter(x => x.options.length > 0);

  const sig = computed.map(x => x.spec.key + ":" + x.options.map(o => o.value).join("\\u0001")).join("\\u0002");
  if (sig !== filterUISig) {
    el.innerHTML = "";
    filterUI.clear();
    openFilterKey = null;
    filterUISig = sig;
    for (const { spec, options } of computed) el.appendChild(buildDropdown(spec, options));
    initFilterGlobalHandlers();
  }
  syncFilters(computed);
  renderActiveChips(computed);
}

function initFilterGlobalHandlers() {
  if (initFilterGlobalHandlers._done) return;
  initFilterGlobalHandlers._done = true;
  document.addEventListener("mousedown", (e) => {
    if (!e.target.closest(".filter-dropdown")) closeAllDropdowns();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && openFilterKey) {
      const ui = filterUI.get(openFilterKey);
      closeAllDropdowns();
      if (ui) ui.trigger.focus();
    }
  });
  window.addEventListener("resize", () => { if (openFilterKey) positionPanel(filterUI.get(openFilterKey)); });
}

function buildDropdown(spec, options) {
  const wrap = document.createElement("div");
  wrap.className = "filter-dropdown";

  const panelId = "filter-panel-" + spec.key;

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "filter-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", panelId);

  const tLabel = document.createElement("span");
  tLabel.className = "filter-trigger-label";
  tLabel.textContent = spec.label;
  const tValue = document.createElement("span");
  tValue.className = "filter-trigger-value";
  const tChevron = document.createElement("span");
  tChevron.className = "filter-chevron";
  tChevron.textContent = "▾";
  tChevron.setAttribute("aria-hidden", "true");
  trigger.append(tLabel, tValue, tChevron);

  const panel = document.createElement("div");
  panel.className = "filter-panel";
  panel.id = panelId;

  // Header — label + per-facet clear
  const hdr = document.createElement("div");
  hdr.className = "filter-panel-header";
  const hLabel = document.createElement("span");
  hLabel.className = "filter-panel-label";
  hLabel.textContent = spec.label;
  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "filter-panel-clear";
  clearBtn.textContent = "Clear";
  clearBtn.onclick = () => { state[spec.key] = new Set(); render(); };
  hdr.append(hLabel, clearBtn);
  panel.appendChild(hdr);

  // Type-ahead for long lists
  let searchEl = null;
  if (options.length >= SEARCH_THRESHOLD) {
    const sw = document.createElement("div");
    sw.className = "filter-search-wrap";
    searchEl = document.createElement("input");
    searchEl.type = "search";
    searchEl.className = "filter-search";
    searchEl.placeholder = "Search: " + spec.label.toLowerCase() + "…";
    searchEl.setAttribute("aria-label", "Search within the " + spec.label + " filter");
    searchEl.addEventListener("input", () => applyPanelSearch(spec.key));
    sw.appendChild(searchEl);
    panel.appendChild(sw);
  }

  const list = document.createElement("div");
  list.className = "filter-options";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-multiselectable", "true");
  list.setAttribute("aria-label", spec.label);

  const optionEls = new Map();
  for (const opt of options) {
    const row = document.createElement("div");
    row.className = "filter-option";
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", "false");
    row.tabIndex = -1;
    row.dataset.value = opt.value;
    row.dataset.search = opt.label.toLowerCase();
    row.title = opt.label;

    const check = document.createElement("span");
    check.className = "filter-option-check";
    check.textContent = "✓";
    check.setAttribute("aria-hidden", "true");
    const lbl = document.createElement("span");
    lbl.className = "filter-option-label";
    lbl.textContent = opt.label;
    const cnt = document.createElement("span");
    cnt.className = "filter-option-count";

    row.append(check, lbl, cnt);
    row.addEventListener("click", () => toggleOption(spec, opt.value, row));
    optionEls.set(opt.value, { row, cnt });
    list.appendChild(row);
  }

  const emptyNote = document.createElement("div");
  emptyNote.className = "filter-panel-empty";
  emptyNote.textContent = "Nothing matches the search.";
  emptyNote.style.display = "none";
  list.appendChild(emptyNote);
  panel.appendChild(list);

  // Footer — bulk-select what the search narrowed down to
  let selectVisibleBtn = null, hintEl = null;
  if (searchEl) {
    const footer = document.createElement("div");
    footer.className = "filter-panel-footer";
    hintEl = document.createElement("span");
    hintEl.className = "filter-panel-hint";
    selectVisibleBtn = document.createElement("button");
    selectVisibleBtn.type = "button";
    selectVisibleBtn.className = "filter-panel-action";
    selectVisibleBtn.textContent = "Select visible";
    selectVisibleBtn.onclick = () => {
      const ns = new Set(state[spec.key]);
      for (const [value, { row }] of filterUI.get(spec.key).optionEls) {
        if (row.style.display !== "none" && row.getAttribute("aria-disabled") !== "true") ns.add(value);
      }
      state[spec.key] = ns;
      render();
    };
    footer.append(hintEl, selectVisibleBtn);
    panel.appendChild(footer);
  }

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (openFilterKey === spec.key) { closeAllDropdowns(); return; }
    openDropdown(spec.key);
  });
  trigger.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openDropdown(spec.key);
    }
  });
  panel.addEventListener("keydown", (e) => onPanelKeydown(e, spec));

  wrap.append(trigger, panel);
  filterUI.set(spec.key, { spec, wrap, trigger, panel, list, searchEl, optionEls, emptyNote, tValue, clearBtn, selectVisibleBtn, hintEl });
  return wrap;
}

function toggleOption(spec, value, row) {
  if (row.getAttribute("aria-disabled") === "true") return;
  const ns = new Set(state[spec.key]);
  ns.has(value) ? ns.delete(value) : ns.add(value);
  state[spec.key] = ns;
  render();          // sync-only — scroll position and focus survive
  row.focus();
}

function syncFilters(computed) {
  for (const { spec, options } of computed) {
    const ui = filterUI.get(spec.key);
    if (!ui) continue;
    const sel = state[spec.key];
    const base = tasksMatchingExcept(spec.key);

    // Trigger — name the selection instead of just counting it
    const selectedLabels = options.filter(o => sel.has(o.value)).map(o => o.label);
    ui.trigger.classList.toggle("has-selection", sel.size > 0);
    if (!sel.size) {
      ui.tValue.textContent = "";
      ui.tValue.style.display = "none";
    } else {
      ui.tValue.style.display = "";
      ui.tValue.textContent = selectedLabels.length === 1
        ? selectedLabels[0]
        : selectedLabels[0] + " +" + (selectedLabels.length - 1);
      ui.tValue.title = selectedLabels.join(", ");
    }
    ui.clearBtn.disabled = sel.size === 0;

    // Options — counts reflect the OTHER active filters, so a zero here really
    // means "picking this yields nothing" rather than a stale global tally.
    for (const opt of options) {
      const entry = ui.optionEls.get(opt.value);
      if (!entry) continue;
      const n = base.reduce((acc, t) => acc + (spec.match(t, opt.value) ? 1 : 0), 0);
      const isSelected = sel.has(opt.value);
      entry.cnt.textContent = String(n);
      entry.row.setAttribute("aria-selected", isSelected ? "true" : "false");
      entry.row.setAttribute("aria-disabled", (n === 0 && !isSelected) ? "true" : "false");
    }
    if (ui.searchEl) applyPanelSearch(spec.key);
  }
}

function applyPanelSearch(key) {
  const ui = filterUI.get(key);
  if (!ui) return;
  const q = (ui.searchEl ? ui.searchEl.value : "").trim().toLowerCase();
  let visible = 0;
  for (const [, { row }] of ui.optionEls) {
    const hit = !q || row.dataset.search.includes(q);
    row.style.display = hit ? "" : "none";
    if (hit) visible++;
  }
  ui.emptyNote.style.display = visible ? "none" : "";
  if (ui.hintEl) ui.hintEl.textContent = visible + " z " + ui.optionEls.size;
  if (ui.selectVisibleBtn) ui.selectVisibleBtn.disabled = visible === 0;
}

function visibleOptionRows(ui) {
  return [...ui.optionEls.values()].map(e => e.row).filter(r => r.style.display !== "none");
}

function onPanelKeydown(e, spec) {
  const ui = filterUI.get(spec.key);
  if (!ui) return;
  const rows = visibleOptionRows(ui);
  if (!rows.length) return;
  const idx = rows.indexOf(document.activeElement);

  if (e.key === "ArrowDown") {
    e.preventDefault();
    rows[idx < 0 ? 0 : Math.min(idx + 1, rows.length - 1)].focus();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (idx <= 0 && ui.searchEl) ui.searchEl.focus();
    else rows[Math.max(idx - 1, 0)].focus();
  } else if (e.key === "Home") {
    e.preventDefault(); rows[0].focus();
  } else if (e.key === "End") {
    e.preventDefault(); rows[rows.length - 1].focus();
  } else if ((e.key === "Enter" || e.key === " ") && idx >= 0) {
    e.preventDefault();
    toggleOption(spec, rows[idx].dataset.value, rows[idx]);
  } else if (e.key === "Enter" && ui.searchEl && document.activeElement === ui.searchEl) {
    e.preventDefault();
    toggleOption(spec, rows[0].dataset.value, rows[0]);
  } else if (e.key === "Tab") {
    closeAllDropdowns();
  }
}

function closeAllDropdowns() {
  for (const ui of filterUI.values()) {
    ui.wrap.classList.remove("open", "align-right");
    ui.trigger.setAttribute("aria-expanded", "false");
  }
  openFilterKey = null;
  document.body.classList.remove("filter-open");
}

function openDropdown(key) {
  const ui = filterUI.get(key);
  if (!ui) return;
  closeAllDropdowns();
  ui.wrap.classList.add("open");
  ui.trigger.setAttribute("aria-expanded", "true");
  openFilterKey = key;
  document.body.classList.add("filter-open");
  positionPanel(ui);
  if (ui.searchEl) { ui.searchEl.value = ""; applyPanelSearch(key); ui.searchEl.focus(); }
  else { const rows = visibleOptionRows(ui); if (rows.length) rows[0].focus(); }
}

/** Flip the panel to right-alignment when it would run past the viewport. */
function positionPanel(ui) {
  if (!ui) return;
  ui.wrap.classList.remove("align-right");
  if (window.innerWidth <= 640) return;   // bottom sheet — CSS handles it
  const rect = ui.wrap.getBoundingClientRect();
  const panelWidth = ui.panel.offsetWidth || 288;
  if (rect.left + panelWidth > window.innerWidth - 12) ui.wrap.classList.add("align-right");
}

// ─── Active filter chips ──────────────────────────────────────────────
function renderActiveChips(computed) {
  const el = document.getElementById("activeFilters");
  el.innerHTML = "";
  const labelOf = (spec, value) => {
    const entry = computed.find(c => c.spec.key === spec.key);
    const opt = entry && entry.options.find(o => o.value === value);
    return opt ? opt.label : value;
  };

  let any = false;
  for (const spec of FILTER_SPECS) {
    for (const value of state[spec.key]) {
      any = true;
      const chip = document.createElement("span");
      chip.className = "active-chip";
      const k = document.createElement("span");
      k.className = "active-chip-key";
      k.textContent = spec.label + ":";
      const v = document.createElement("span");
      v.className = "active-chip-val";
      v.textContent = labelOf(spec, value);
      v.title = labelOf(spec, value);
      const x = document.createElement("button");
      x.type = "button";
      x.className = "active-chip-x";
      x.textContent = "✕";
      x.setAttribute("aria-label", "Remove the filter " + spec.label + ": " + labelOf(spec, value));
      x.onclick = () => {
        const ns = new Set(state[spec.key]);
        ns.delete(value);
        state[spec.key] = ns;
        render();
      };
      chip.append(k, v, x);
      el.appendChild(chip);
    }
  }

  if (any) {
    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "filter-reset-btn";
    resetBtn.textContent = "✕ Clear all";
    resetBtn.onclick = () => {
      FILTER_KEYS.forEach(k => { state[k] = new Set(); });
      render();
    };
    el.appendChild(resetBtn);
  }
  el.style.display = any ? "" : "none";
}

// ─── Task list ─────────────────────────────────────────────────────────
function getFilteredTasks() {
  const q = state.search.toLowerCase();
  const filtered = TASKS.filter((t) => {
    // OR within a facet, AND across facets — predicates come from FILTER_SPECS
    // so the list, the counts and the chips can never disagree.
    for (const spec of FILTER_SPECS) {
      const sel = state[spec.key];
      if (sel.size && ![...sel].some(v => spec.match(t, v))) return false;
    }
    if (q) {
      if (!(t.id + " " + t.title).toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // "…-999" vs "…-1200" sorts wrong as a string ('9' > '1' in the 3rd char) —
  // compare the numeric suffix instead, so id order matches task-number order.
  const blNum = taskNum;

  return filtered.sort((a, b) => {
    if (state.sortBy === "id_asc")  return blNum(a.id) - blNum(b.id);
    if (state.sortBy === "id_desc") return blNum(b.id) - blNum(a.id);
    // default: priority then id
    const p = (a.priority || "P9").localeCompare(b.priority || "P9");
    return p !== 0 ? p : blNum(a.id) - blNum(b.id);
  });
}

function renderCards() {
  const el = document.getElementById("cards");
  el.innerHTML = "";
  const tasks = getFilteredTasks();

  // ── Sort bar ──────────────────────────────────────────────────────
  const sortBar = document.createElement("div");
  sortBar.className = "sort-bar";
  const sortLabel = document.createElement("span");
  sortLabel.className = "sort-bar-label";
  sortLabel.textContent = "Sort:";
  sortBar.appendChild(sortLabel);
  const sorts = [
    { key: "priority", label: "Priority" },
    { key: "id_asc",   label: "ID ↑" },
    { key: "id_desc",  label: "ID ↓" },
  ];
  for (const s of sorts) {
    const b = document.createElement("button");
    b.className = "sort-btn" + (state.sortBy === s.key ? " active" : "");
    b.textContent = s.label;
    b.onclick = () => { state.sortBy = s.key; render(); };
    sortBar.appendChild(b);
  }
  const countEl = document.createElement("span");
  countEl.className = "list-count";
  countEl.textContent = tasks.length === TASKS.length
    ? \`\${tasks.length} tasks\`
    : \`\${tasks.length} / \${TASKS.length}\`;
  sortBar.appendChild(countEl);
  el.appendChild(sortBar);

  if (tasks.length === 0) {
    const noRes = document.createElement("div");
    noRes.className = "no-results";
    noRes.textContent = "No tasks match the filter.";
    el.appendChild(noRes);
    return;
  }
  for (const t of tasks) {
    const card = document.createElement("div");
    card.className = "task-card";
    card.dataset.priority = t.priority || "";
    // The live signal is repainted in place by paintInFlight(), which finds the
    // card by this id rather than rebuilding the list every thirty seconds.
    card.dataset.taskId = t.id || "";
    if (state.selectedId === t.id) card.classList.add("active");
    // The rule is in elsewhere.mjs, tested there: it fires on the EXISTENCE of a
    // divergence, never on a status name out of somebody's config.yaml.
    const ew = elsewhereCardAttrs(t);
    if (ew.className) {
      card.classList.add(ew.className);
      card.title = ew.title;
    }
    card.innerHTML = \`
      <div class="task-card-head">
        <span class="task-card-id">\${escape(t.id || "")}</span>
        <span class="task-card-meta">
          <span class="badge badge-priority-\${t.priority}">\${escape(t.priority || "")}</span>
        </span>
      </div>
      <div class="task-card-title">\${escape(t.title || "")}</div>
      <div class="task-card-footer">
        <span class="badge badge-status-\${t.status}">\${escape(t.status || "")}</span>
        <span class="badge badge-type-\${t.type}">\${escape(t.type || "")}</span>
        \${(t.labels || []).map(l => \`<span class="badge badge-label-\${l}">\${escape(l)}</span>\`).join("")}
        \${state.board === BOARD_ALL && t.board ? \`<span class="badge badge-board" title="Board">\${escape(boardLabel(t.board))}</span>\` : ""}
        \${elsewhereHtml(t)}
        \${t.epic ? \`<span class="badge badge-epic" title="Epic">\${escape(t.epic)}</span>\` : ""}
        \${t.estimate ? \`<span class="badge" style="background:var(--bg-sidebar);color:var(--fg-muted)">~\${escape(t.estimate)}</span>\` : ""}
      </div>
    \`;
    card.onclick = () => selectTask(t.id);
    el.appendChild(card);
  }
}

// ─── Detail ────────────────────────────────────────────────────────────
function selectTask(id) {
  state.selectedId = id;
  renderCards();
  renderDetail();
  // pushState, not an assignment to location.hash: the hash now carries the
  // filters too, and an assignment would lose them and fire a hashchange, which
  // would immediately load the state back.
  tasksSyncHash({ push: true });
}

// ─── Task detail ──────────────────────────────────────────────────────
//
// Every field is text. Nothing here writes (TL-379).


const HISTORY_FIELD_LABELS = {
  __created__: "task created",
  __deleted__: "task deleted",
  __body__: "task body",
  __comment__: "comment",
  __decision__: "decision",
  __verified__: "manual verification vouched for",
  // TL-130: somebody claiming a change the log had recorded as nobody's. The
  // earlier row still says "unknown", and this one stands beside it.
  __attributed__: "claimed as their own change",
  // TL-387: the fields a reconciliation absorbed with no reference point to
  // compare them against. The entry's "to" is the list of those fields.
  __adopted__: "adopted with no reference point",
  __role_override__: "taken outside its role",
  updated: "Updated",
  created: "Created",
};

// ─── History ──────────────────────────────────────────────────────────
// The history is fetched ONCE per task and redrawn only when it really changed.
// An unconditional renderDetail() after every fetch made a loop
// (render → fetch → render) that wiped an open editor while somebody was typing.
const historyLoaded = {};
// ─── The live signal (TL-189) ──────────────────────────────────────
//
// The server holds the raw log; this side holds only the reduced signal and the
// rules for reading it, which come from the pasted in-flight.mjs above.
// A REPAINT ON A TIMER, WITH NO FETCH BEHIND IT. Silence is the signal that has
// no event: a session that stops sends nothing, so nothing would ever move a card
// off "1m" — and a card frozen at one minute is exactly the spinner this feature
// exists instead of. The tick only re-reads a clock.
const IN_FLIGHT_TICK_MS = 30000;

function histDay(ts) { return String(ts || "").slice(0, 10); }
function histAgo(ts) {
  const day = histDay(ts);
  if (!day) return "";
  const today = new Date();
  const t0 = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const parts = day.split("-");
  const t1 = Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  const days = Math.round((t0 - t1) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return days + " days ago";
  return day;
}
function histTime(ts) {
  const m = String(ts || "").match(/T(\\d{2}:\\d{2})/);
  return m ? m[1] : "";
}

// ─── Field editors ──────────────────────────────────────────────
// ─── Detail render ────────────────────────────────────────────────────
// ONE listener rather than one per node: the detail panel is re-rendered
// wholesale on every edit and every SSE refresh, so per-node handlers would be
// re-bound each time. A click narrows the history list to that node's field —
// the filter mechanism the list already has, rather than a second one.
document.addEventListener("click", function (e) {
  const node = e.target.closest && e.target.closest("[data-graph-node]");
  if (!node || !state.selectedId) return;
  openHistory(state.selectedId, node.dataset.graphField);
});
document.addEventListener("keydown", function (e) {
  if (e.key !== "Enter" && e.key !== " ") return;
  const node = e.target.closest && e.target.closest("[data-graph-node]");
  if (!node || !state.selectedId) return;
  e.preventDefault();
  openHistory(state.selectedId, node.dataset.graphField);
});

function renderDetail() {
  const el = document.getElementById("taskDetail");
  const t = TASKS.find(function (x) { return x.id === state.selectedId; });
  if (!t) {
    el.innerHTML = '<div class="empty-state">← Pick a task from the list, or use <code>#' + TASK_PREFIX + '-001</code> in the URL.</div>';
    return;
  }
  // ONE ROW PER FIELD, no pen (TL-379). The rows used to be editors that fell
  // back to text when the page could not write; now they are text, because the
  // page cannot write at all. A field is changed where it is authoritative — in
  // the Markdown, through the CLI, under review.
  const rows = FIELDS.filter(function (spec) { return spec.key !== "title"; })
    .map(function (spec) {
      return '<div class="meta-row"><div class="meta-label">' + escape(spec.label || spec.key) +
        '</div><div class="meta-value">' + escape(formatValue(t[spec.key]) || "—") + "</div></div>";
    }).join("");

  const files = t.modified_files || [];
  const filesRow = files.length
    ? '<div class="meta-row meta-row-wide"><div class="meta-label">Files changed</div><div class="meta-value">' +
      files.map(function (p) { return "<code>" + escape(p) + "</code>"; }).join(" ") + "</div></div>"
    : "";

  const readOnlyRows =
    '<div class="meta-row"><div class="meta-label">Created</div><div class="meta-value">' + escape(t.created || "—") + "</div></div>" +
    '<div class="meta-row"><div class="meta-label">Updated</div><div class="meta-value">' + escape(t.updated || "—") + "</div></div>" +
    // COMPUTED from commit messages, so there is no pen: it is not a field
    // anybody may edit, and offering one would invite a value that contradicts
    // the history it was derived from. Absent when the task has no commits yet —
    // an empty row would read as "this task changed nothing".
    filesRow;

  const titleHtml = "<h1>" + escape(t.title) + "</h1>";

  el.innerHTML =
    '<div class="detail-header">' +
      "<div>" +
        '<span class="detail-id">' + escape(t.id) + "</span>" +
        '<span class="badge badge-status-' + escape(t.status) + '">' + escape(t.status) + "</span>" +
        elsewhereHtml(t) +
        '<span class="badge badge-priority-' + escape(t.priority) + '">' + escape(t.priority) + "</span>" +
        '<span class="badge badge-type-' + escape(t.type) + '">' + escape(t.type) + "</span>" +
        (t.labels || []).map(function (l) { return '<span class="badge badge-label-' + escape(l) + '">' + escape(l) + "</span>"; }).join("") +
        (t.epic ? '<span class="badge badge-epic">' + escape(t.epic) + "</span>" : "") +
      "</div>" +
      titleHtml +
      '<div class="detail-meta-grid">' + rows + readOnlyRows + "</div>" +
    "</div>" +
    '<div class="markdown-content">' + t.bodyHtml + "</div>";

  el.scrollTop = 0;
}

// A status another branch or worktree disagrees with (TL-73). BOTH values
// stand and the branch is named — the page never picks a winner, for the same
// reason the terminal does not: a single status is what a one-checkout view
// already showed, and it is what made the page wrong.
function elsewhereHtml(t) {
  return (t.elsewhere || []).map(function (d) {
    return '<span class="badge badge-elsewhere" title="' + escape(ELSEWHERE_HINT) + '">' +
      escape(describeElsewhere(d)) + "</span>";
  }).join("");
}

function escape(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Dashboard ────────────────────────────────────────────────────────
// Every number below is derived from the SAME task frontmatter the list view
// ─── Chart hover ──────────────────────────────────────────────────────
// Each chart ships the pixel positions the builder already computed alongside
// the values behind them. The hover code recomputes no scales: a second
// implementation of the same mapping is a second chance to disagree with the
// picture on screen — the tooltip would confidently name a point the line is
// not drawn through.
// One lookup for both hover and click: if they resolved the index separately,
// clicking could open a different day than the tooltip under the cursor names.
const DASH_PRESETS = [
  { key: "30", label: "30 days", days: 30 },
  { key: "60", label: "60 days", days: 60 },
  { key: "90", label: "90 days", days: 90 },
  { key: "all", label: "Whole history", days: null },
];
const DASH_RANGE_STORE = STORAGE_PREFIX + "-dash-range";

// Tasks behind one point on a chart. Same two definitions the charts are drawn
// from — created day, and "closed" as status done + updated — so the list can
// never show a different count than the bar above it.
const DASH_BURN_STORE = STORAGE_PREFIX + "-dash-burn";

// ─── Sorting, once, for every listing on the dashboard ──────────────
// A column declares its label, its value accessor and the direction it opens
// in. Header, comparator and cell therefore cannot drift into disagreeing
// about what "Blok." means, and the eight listings below cannot drift into
// eight slightly different sorting behaviours.
//

const AGING_COLUMNS = [
  { key: "natural", label: "Age" },
  { key: "P0", label: "P0", num: true, dir: "desc", get: (r) => r.P0 },
  { key: "P1", label: "P1", num: true, dir: "desc", get: (r) => r.P1 },
  { key: "P2", label: "P2", num: true, dir: "desc", get: (r) => r.P2 },
  { key: "P3", label: "P3", num: true, dir: "desc", get: (r) => r.P3 },
  { key: "total", label: "Total", num: true, dir: "desc", get: (r) => r.total },
];

// ─── Tasks view state in the URL ──────────────────────────────────────
// The same contract as the dashboard below, only for the task list: the filters,
// the search, the sorting, the board scope and the selected task travel in the
// hash, so "look at these blockers from the Legal epic" can be SENT instead of
// described. The encoding lives in \`viewer-url.mjs\` (pasted at the top of the
// the page state.
const TASKS_FILTER_PARAMS = FILTER_SPECS.map((s) => s.param);

// The first render runs BEFORE anybody has read the hash. Without this gate it
// would rewrite a \`#BL-123\` from a pasted link into its own state before
// handleHash() got to see it.
let hashRouted = false;

function tasksViewState() {
  return {
    board: state.board,
    filters: FILTER_SPECS.map((s) => ({ param: s.param, values: [...state[s.key]] })),
    search: state.search,
    sortBy: state.sortBy,
    selectedId: state.selectedId,
  };
}

/**
 * Rewrites the URL to match the current state of the list.
 * \`push\` only for selecting a task — Back is meant to step through tasks as it
 * always has; if it pushed filters too, one phrase typed into the search would
 * leave one history entry per keystroke.
 */
function tasksSyncHash(opts) {
  if (!hashRouted || state.view !== "tasks") return;
  const next = "#" + encodeTasksHash(tasksViewState());
  if (window.location.hash === next) return;
  const url = window.location.pathname + window.location.search + next;
  if (opts && opts.push) history.pushState(null, "", url);
  else history.replaceState(null, "", url);
}

/**
 * Sets the view to what the link carries. A parameter that is absent falls back
 * to the default — otherwise the recipient's leftover filters would narrow the
 * sender's set and the link would show something different to everyone.
 */
function tasksApplyHash(query) {
  if (!query) return;                       // a bare #tasks — leave what you have
  const v = parseTasksHash(query, TASKS_FILTER_PARAMS);
  if (v.board !== null) applyBoardFromUrl(v.board);
  for (const spec of FILTER_SPECS) state[spec.key] = new Set(v.filters[spec.param] || []);
  state.search = v.search;
  const input = document.getElementById("searchInput");
  if (input) input.value = v.search;
  state.sortBy = v.sortBy;
  // The selection is checked AFTER the scope is set — an id from another board
  // would show an empty detail beside a list that does not have that task.
  state.selectedId = v.selectedId && TASKS.some((t) => t.id === v.selectedId) ? v.selectedId : null;
  if (v.selectedId && !state.selectedId) {
    // The value carried a task the recipient does not have (an older snapshot, a
    // different board). Silence would look like "the sender selected nothing".
    toast(v.selectedId + " does not exist in this data — showing the list alone", "error");
  }
}

// ─── View switching ───────────────────────────────────────────────────
// ─── Dashboard state in the URL ───────────────────────────────────────
// The hash carries what you are looking at, so a view can be handed to someone
// else — or to an agent, or back from one — instead of described in prose.
//
// Range and burn scope are ALWAYS emitted, day and sorts only when set. That
// makes a shared link exact: a recipient whose localStorage holds a different
// range still sees the sender's. A bare "#dashboard" (what the tab button
// produces) deliberately carries nothing and leaves your own state alone.
// replaceState, not a hash assignment: assigning fires hashchange, which would
// re-enter handleHash and re-apply the state that was just set.
// ─── Execution view (TL-109) ──────────────────────────────────────────
// The state is recomputed on every render from ALL_TASKS — deliberately not from
// TASKS: a board is a scope over the LIST, while a plan spans the whole backlog,
// and a scoped Execution tab would quietly drop half an order and look complete.
function renderExecution_() {
  const host = document.getElementById("executionView");
  if (!PLAN || !PLAN.exists) {
    host.innerHTML = renderPlanMissing({ planPath: PLAN && PLAN.path });
    return;
  }
  if (PLAN.problems && PLAN.problems.length) {
    // Half an order drawn from a file that does not parse is worse than none:
    // it looks like the plan, and it is not.
    host.innerHTML = '<div class="exec-empty"><h2>The plan file cannot be read</h2><p>' +
      escapeHtmlStr(PLAN.problems[0]) + "</p></div>";
    return;
  }
  const state_ = planState(PLAN.plan, ALL_TASKS, {
    archivedStatuses: CONFIG.archivedStatuses,
    inProgressStatus: CONFIG.inProgressStatus,
  });
  const vm = planViewModel(state_, ALL_TASKS, {
    history: HISTORY,
    now: Date.now(),
    estimateHours,
    archivedStatuses: CONFIG.archivedStatuses,
  });
  // WHAT MOVED SINCE THE LAST RENDER, computed BEFORE the HTML is replaced —
  // afterwards the old statuses are gone. \`null\` on the first paint, so the
  // load does not announce changes that did not happen.
  const moved = statusChanges(EXEC_SEEN, vm);
  EXEC_SEEN = { statuses: moved.statuses, closure: moved.closure };

  host.innerHTML = renderExecution(vm);
  execAnnounce(host, moved);
  execApplySelection();
  drawPlanEdges();
}

// ─── The chain a card unblocks, and the motion (TL-110) ───────────────────
// Presentation only: nothing here changes a task, a status or the plan. The
// arithmetic — which chain is critical, what has moved — lives in
// viewer-plan.mjs, where a test can reach it.

// The statuses the previous render drew, so a change can be told from a first
// paint. Reset to null when the tab is left, because a card cannot have "moved"
// relative to a render nobody saw.
let EXEC_SEEN = null;
// The card whose chain is lit, or null. Kept OUTSIDE the DOM so it survives the
// innerHTML replacement an SSE refresh performs.
let EXEC_SELECTED = null;

/** Mark what has just moved, and take the mark off again once it has been seen.
 *  The class is removed on \`animationend\` so a reader with reduced motion — for
 *  whom no animation ever fires — is not left with a permanent highlight. */
function execAnnounce(host, moved) {
  for (const id of moved.cards) {
    const el = host.querySelector('[data-plan-card="' + CSS.escape(id) + '"]');
    if (!el) continue;
    el.classList.add("just-changed");
    el.addEventListener("animationend", () => el.classList.remove("just-changed"), { once: true });
  }
  for (const index of moved.waves) {
    const el = host.querySelector('[data-plan-wave="' + index + '"]');
    if (!el) continue;
    el.classList.add("just-closed");
    el.addEventListener("animationend", () => el.classList.remove("just-closed"), { once: true });
  }
  // With motion switched off nothing fires \`animationend\`, so the marks are
  // cleared on a timer as well. Belt and braces on purpose: a highlight that
  // never goes away stops meaning "this just changed".
  setTimeout(() => {
    for (const el of host.querySelectorAll(".just-changed, .just-closed")) {
      el.classList.remove("just-changed", "just-closed");
    }
  }, 2000);
}

/** Draw the current selection, whatever it is. Called after every render, so a
 *  refresh mid-selection does not silently drop it. */
function execApplySelection() {
  const flow = document.querySelector("#executionView .exec-flow");
  if (!flow) return;
  for (const el of flow.querySelectorAll(".is-lit, .is-selected")) {
    el.classList.remove("is-lit", "is-selected");
  }
  const hint = document.getElementById("execSelectionHint");
  if (hint) hint.remove();
  if (!EXEC_SELECTED) { flow.classList.remove("is-focused"); return; }

  const edges = [...flow.querySelectorAll("#execEdges path")]
    .map((p) => ({ from: p.dataset.edgeFrom, to: p.dataset.edgeTo }));
  const lit = descendants(edges, EXEC_SELECTED);
  const selected = flow.querySelector('[data-plan-card="' + CSS.escape(EXEC_SELECTED) + '"]');
  if (!selected) { EXEC_SELECTED = null; flow.classList.remove("is-focused"); return; }

  flow.classList.add("is-focused");
  selected.classList.add("is-selected");
  for (const id of lit) {
    const el = flow.querySelector('[data-plan-card="' + CSS.escape(id) + '"]');
    if (el) el.classList.add("is-lit");
  }
  for (const p of flow.querySelectorAll("#execEdges path")) {
    const chain = new Set([EXEC_SELECTED, ...lit]);
    if (chain.has(p.dataset.edgeFrom) && chain.has(p.dataset.edgeTo)) p.classList.add("is-lit");
  }
  // A word, again: the dimming says WHICH cards, this says what the dimming
  // means and how to undo it.
  const note = document.createElement("p");
  note.className = "exec-selection-hint";
  note.id = "execSelectionHint";
  note.textContent = EXEC_SELECTED + " unblocks " + lit.size + " task(s) — click again or press Escape to clear";
  flow.parentElement.insertBefore(note, flow);
}

/** One listener on the view, not one per card: the cards are replaced on every
 *  refresh, and per-card listeners would be re-bound (or leak) each time. */
document.addEventListener("click", (e) => {
  const card = e.target.closest && e.target.closest("#executionView [data-plan-card]");
  if (!card) return;
  // The id in the head is a link to the task; selecting the chain must not
  // steal that click.
  if (e.target.closest(".exec-id")) return;
  const id = card.dataset.planCard;
  EXEC_SELECTED = EXEC_SELECTED === id ? null : id;
  execApplySelection();
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !EXEC_SELECTED) return;
  EXEC_SELECTED = null;
  execApplySelection();
});

/**
 * The geometry of the dependency edges, measured after layout.
 *
 * The model says which pairs are joined (\`data-edge-from\` / \`data-edge-to\`); the
 * positions only exist once the browser has laid the cards out, so they are
 * filled in here. A cubic curve rather than a straight line: two cards in the
 * same row would otherwise be joined by a line running through the cards between
 * them.
 */
function drawPlanEdges() {
  const svg = document.getElementById("execEdges");
  if (!svg) return;
  const flow = svg.parentElement;
  const base = flow.getBoundingClientRect();
  svg.setAttribute("viewBox", "0 0 " + Math.round(base.width) + " " + Math.round(base.height));
  for (const path of svg.querySelectorAll("path")) {
    const a = flow.querySelector('[data-plan-card="' + CSS.escape(path.dataset.edgeFrom) + '"]');
    const b = flow.querySelector('[data-plan-card="' + CSS.escape(path.dataset.edgeTo) + '"]');
    if (!a || !b) { path.removeAttribute("d"); continue; }
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    const x1 = ra.left + ra.width / 2 - base.left;
    const y1 = ra.bottom - base.top;
    const x2 = rb.left + rb.width / 2 - base.left;
    const y2 = rb.top - base.top;
    const dy = Math.max((y2 - y1) / 2, 18);
    path.setAttribute("d", "M" + x1 + "," + y1 + " C" + x1 + "," + (y1 + dy) + " " + x2 + "," + (y2 - dy) + " " + x2 + "," + y2);
  }
}

// The cards move when the window does; the edges are pixels and have to follow.
window.addEventListener("resize", () => {
  if (state.view === "execution") drawPlanEdges();
});

// ─── Waiting on you (TL-115) ──────────────────────────────────────────
// Computed from ALL_TASKS and HISTORY on every render — never from the
// generated views, which are a snapshot of the last build and would describe a
// backlog that moved an hour ago (the rule TL-108 states). ALL_TASKS and not
// TASKS: a person's decision queue is not a property of the board they happen
// to be looking at.
function decisionRows() {
  const items = decisionPanel(ALL_TASKS, HISTORY, {
    archivedStatuses: CONFIG.archivedStatuses,
    // The project's word for "worked, unverified" (TL-212), or nothing at all
    // when it declares none — the page never invents one.
    awaitingVouchStatus: CONFIG.awaitingVouchStatus,
    now: Date.now(),
    // \`servedRoles\` is deliberately NOT passed: the map of roles to agent
    // commands lives in somebody's \`run\` invocation and the page has never seen
    // it. Guessing an empty one would put every task with any role into a
    // person's queue.
  });
  return items;
}

function srcHead(r) {
  return '<a class="dec-id" href="#' + escapeHtmlStr(r.id) + '">' + escapeHtmlStr(r.id) + "</a>" +
    '<span class="dec-title">' + escapeHtmlStr(r.title) + "</span>";
}

/** The menu the question was asked with, or nothing (TL-204, TL-207).
 *
 *  NOTHING IS INVENTED. A question asked before options existed, or asked
 *  without them on purpose, gets no list — an empty \`<ol>\` reading "no options"
 *  would be a sentence about the tool rather than about the decision.
 *
 *  THE NUMBERS ARE THE ONES \`decide --choose <n>\` TAKES, 1-based at every end
 *  (TL-204), so a reader who moves to the terminal types what they read here.
 *  Since TL-379 that move is the ONLY way to answer, and the list is plain text
 *  rather than buttons: a disabled button is a promise the page cannot keep, and
 *  a reader deserves to be told where the answer goes instead of finding out by
 *  clicking. The event id is printed for the same reason — it is the argument
 *  \`--resolves\` needs, and without it the reader has to go and find the log. */
function decisionMenu(r) {
  const options = r.options || [];
  if (!options.length) return "";
  const how = r.eventId
    ? '<p class="dec-how">Answer it: <code>' + escapeHtmlStr(TASK_PREFIX ? "" : "") +
      "decide " + escapeHtmlStr(r.id) + " --resolves " + escapeHtmlStr(r.eventId) +
      " --choose &lt;n&gt;</code></p>"
    : "";
  return '<ol class="dec-menu">' + options.map(function (text, i) {
    const n = i + 1;
    const rec = n === r.recommend;
    return '<li class="dec-opt' + (rec ? " is-rec" : "") + '">' +
      '<span class="dec-opt-n">' + n + ".</span>" +
      "<span>" + escapeHtmlStr(text) +
      (rec ? '<span class="dec-rec">recommended</span>' : "") + "</span></li>";
  }).join("") + "</ol>" + how;
}

function renderDecisions() {
  const host = document.getElementById("decisionsView");
  const rows = decisionRows();
  const head =
    '<div class="dec-head"><h2>Waiting on you</h2></div>' +
    // THE LEDE CARRIES WHAT IS CONSTANT so the rows do not have to (TL-205): a
    // card is a question to answer, a plain line is a task somebody marked for
    // a person. Stated once here, it is not repeated eleven times below.
    // THE HEADING NO LONGER CLAIMS EVERY ROW IS STUCK (TL-212). Half of them
    // were finished work waiting for a signature, and calling that "cannot move"
    // is what made the count above it a number of the wrong thing.
    '<p class="dec-lede">Work that needs you. A <strong>card</strong> is a question ' +
    "somebody asked that nothing has answered; a <strong>plain line</strong> is a task marked for a person, " +
    "with nothing to read and one thing to do; a <strong>tinted row</strong> is work an agent already " +
    "finished, waiting only for you to check the one line printed on it. Ordered by how many tasks the " +
    "decision would release, counted through the chain — not by age.</p>";

  if (!rows.length) {
    host.innerHTML = head + '<p class="dec-empty">Nothing is waiting on a person. A task gets here by ' +
      'carrying <code>executor: human</code>, when a handoff leaves a question nobody has answered yet, ' +
      'or when a run finishes the work and stops at a <code>manual:</code> entry only you can vouch for.</p>';
    updateDecisionsCount();
    return;
  }

  host.innerHTML = head + rows.map(function (r) {
    // \`releases nothing else\` was printed in the position, and the weight, that
    // \`releases 1 task\` occupies — the one number on the row that changes the
    // ordering. Most rows released nothing, so the column read as noise and the
    // rows that mattered did not stand out (TL-205). Absent now means nothing.
    const unblocks = r.unblocks
      ? '<span class="dec-unblocks">releases ' + r.unblocks + " task" + (r.unblocks === 1 ? "" : "s") + "</span>"
      : "";

    if (r.kind === "question") {
      const age = r.ageDays === null ? "" :
        ", " + (r.ageDays === 0 ? "today" : r.ageDays + " day" + (r.ageDays === 1 ? "" : "s") + " ago");
      return '<article class="dec-q">' +
        '<div class="dec-src">' + srcHead(r) + unblocks + "</div>" +
        '<p class="dec-ask">' + escapeHtmlStr(r.question) + "</p>" +
        decisionMenu(r) +
        '<div class="dec-meta">asked by ' + escapeHtmlStr(r.asker || "somebody") + age + "</div>" +
        "</article>";
    }
    if (r.kind === "vouch") {
      // THE CONTRACT'S OWN WORDS, and nothing invented where there are none: a
      // task moved into this status by hand has no \`__unverified__\` event behind
      // it, and a sentence the page made up would read exactly like a quotation.
      const age = r.ageDays === null ? "" :
        (r.ageDays === 0 ? "today" : r.ageDays + " day" + (r.ageDays === 1 ? "" : "s") + " ago");
      const asked = r.manual
        ? '<p class="dec-do">' + escapeHtmlStr(r.manual) + "</p>"
        : '<p class="dec-do">The contract asks for a vouch; the entry\\'s text is not in this task\\'s ' +
          "history. Open the task and read its <code>verification:</code> block.</p>";
      // \`done\` is named because it is the ONE way back in, and it re-runs the
      // whole contract — the automatic entries may have gone stale while the task
      // sat here, so a shortcut that recorded the vouch alone would close a task
      // on evidence nobody re-checked.
      const meta = '<div class="dec-meta">the agent\\'s work stands — check the line above, then ' +
        "<code>${N} done " + escapeHtmlStr(r.id) + "</code>" +
        (age ? " · parked " + age : "") + "</div>";
      return '<div class="dec-v">' +
        '<div class="dec-src">' + srcHead(r) +
        '<span class="dec-vtag">awaiting your vouch</span>' + unblocks + "</div>" +
        asked + meta + "</div>";
    }
    // ONLY THE EXCEPTION IS SPELLED OUT. \`marked executor: human\` was on nearly
    // every one of these rows; the flat shape and the lede now say it, and the
    // sentence is kept for the case the shape does NOT imply — a role this
    // deployment has no agent for. The owner is not shown at all: who holds a
    // task is a click away on the task, and the common value repeated down the
    // column is the defect this task was filed about.
    const role = r.why.indexOf("executor") >= 0
      ? ""
      : '<span class="dec-meta">no agent here serves the role <code>' +
        escapeHtmlStr(r.role) + "</code></span>";
    return '<div class="dec-t">' + srcHead(r) + role +
      '<span class="dec-gap"></span>' + unblocks + "</div>";
  }).join("");
  updateDecisionsCount();
}

/** The count on the tab, so the panel is visible from wherever you are. */
function updateDecisionsCount() {
  const tab = document.getElementById("tabDecisions");
  if (!tab) return;
  const n = decisionPanel(ALL_TASKS, HISTORY, {
    archivedStatuses: CONFIG.archivedStatuses,
    awaitingVouchStatus: CONFIG.awaitingVouchStatus,
  }).length;
  tab.innerHTML = "Waiting on you" + (n ? '<span class="tab-count">' + n + "</span>" : "");
}

function decisionsSyncHash() {
  if (state.view !== "decisions") return;
  const next = "#decisions";
  if (window.location.hash !== next) {
    history.replaceState(null, "", window.location.pathname + window.location.search + next);
  }
}

document.getElementById("decisionsView").addEventListener("click", (e) => {
  const opt = e.target.closest("[data-choose]");
  const btn = e.target.closest("[data-decision-submit]");
  if (btn) submitDecision(btn.previousElementSibling);
});
document.getElementById("decisionsView").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  // SCOPED TO THE INPUT. The menu's buttons carry \`data-decision-for\` too, and
  // Enter on a button already fires its click — an unscoped selector would send
  // the empty value of a button as a typed answer on top of the chosen row.
  const input = e.target.closest("input[data-decision-for]");
  if (!input) return;
  e.preventDefault();
  submitDecision(input);
});


// ─── Replay view (TL-91) ──────────────────────────────────────────────
// The board as it stood at a moment, folded out of HISTORY on every frame.
// Nothing is stored and nothing is asked for over the network: the page carries
// the log it was built with, which is exactly why the replay works on a file
// somebody was mailed.
//
// THE WHOLE BACKLOG, NEVER ONE BOARD. The scope travels in the link because the
// rest of the page is scoped by it, but a FRAME is not narrowed by it: the log
// records a board only when somebody CHANGED one, so scoping a frame would drop
// every task that has always sat where it sits — and the missing cards would
// look exactly like a quiet week.

function setView(view) {
  state.view = view;
  document.body.classList.toggle("view-execution", view === "execution");
  document.body.classList.toggle("view-decisions", view === "decisions");
  for (const btn of document.querySelectorAll(".view-tab")) {
    btn.classList.toggle("is-active", btn.dataset.view === view);
  }
  if (view === "execution") renderExecution_();
  if (view === "decisions") renderDecisions();
}

// ─── Render all ───────────────────────────────────────────────────────
function render() {
  renderBoardScope();
  // The tab's count is refreshed on EVERY render, not only inside the panel:
  // its whole job is to be seen from the view you are already on.
  updateDecisionsCount();
  renderStats();
  renderFilters();
  renderCards();
  renderDetail();
  // The plan's state is computed from the tasks, so a refresh that did not
  // redraw it would leave a card in a status the rest of the page no longer
  // shows.
  if (state.view === "execution") renderExecution_();
  else if (state.view === "decisions") renderDecisions();
  // The one place where the list rewrites the URL: every change of a filter, a
  // chip, the sorting and the scope ends up here anyway, so there is no route by
  // which the state changes without a link (except the search — that renders cards only).
  else tasksSyncHash();
}

// ─── Search input ─────────────────────────────────────────────────────
document.getElementById("searchInput").addEventListener("input", (e) => {
  state.search = e.target.value;
  renderCards();
  tasksSyncHash();   // renderCards() does not go through render()
});

// ─── URL hash routing ─────────────────────────────────────────────────
function handleHash() {
  const raw = window.location.hash.replace(/^#/, "");
  const qi = raw.indexOf("?");
  const id = qi < 0 ? raw : raw.slice(0, qi);
  if (id === "decisions") {
    if (state.view !== "decisions") setView("decisions");
    else renderDecisions();
    return;
  }
  if (id === "execution") {
    if (state.view !== "execution") setView("execution");
    else renderExecution_();
    return;
  }
  if (isTasksHash(id)) {
    tasksApplyHash(qi < 0 ? "" : raw.slice(qi + 1));
    if (state.view !== "tasks") setView("tasks");
    render();
    return;
  }
  if (!id) return;
  // A link from a chat or an old bookmark may point at a task from another board.
  // A narrowed scope would then show an empty list and an empty detail — which
  // looks like "the task is gone" while it is only out of scope. We switch the scope.
  const inScope = TASKS.find((t) => t.id === id);
  const anywhere = inScope || ALL_TASKS.find((t) => t.id === id);
  if (!anywhere) return;
  if (!inScope) {
    setBoardScope(anywhere.board || BOARD_ALL, { quiet: true });
    toast(id + " is in the board " + boardLabel(anywhere.board || BOARD_ALL) + " — the scope has been switched", "success");
  }
  if (state.view !== "tasks") setView("tasks");
  state.selectedId = id;
  renderCards();
  renderDetail();
  // A bare #BL-NNN (a link from a chat, an old bookmark) is raised to the full
  // form — from that moment the URL carries the filters too, so it can be passed on whole.
  tasksSyncHash();
}
window.addEventListener("hashchange", handleHash);

// expose for inline onclick in dynamically-generated content
window.selectTask = selectTask;
window.changeTaskStatus = changeTaskStatus;
window.startEdit = startEdit;
window.cancelEdit = cancelEdit;
window.saveField = saveField;
window.submitReason = submitReason;
window.cancelReason = cancelReason;
window.saveChips = saveChips;
window.saveLines = saveLines;
window.onEditorKey = onEditorKey;
window.openHistory = openHistory;
window.toggleHistory = toggleHistory;
window.toggleTaskGraph = toggleTaskGraph;
window.clearHistoryFilter = clearHistoryFilter;

// ─── Connection bar event wiring ─────────────────────────────────────
document.getElementById("btnConnect").addEventListener("click", pickDirectory);
document.getElementById("btnRefresh").addEventListener("click", refreshFromDisk);
document.getElementById("btnDisconnect").addEventListener("click", disconnect);

// ─── Kopiowanie linku ────────────────────────────────────────────────
// The URL is always current anyway (every filter change rewrites it), so the
// button simply copies location.href — it works the same for the task list and
// for the dashboard.
//
// Three routes, because the viewer lives in two contexts: through the server
// (127.0.0.1 is a secure context, so \`navigator.clipboard\` exists) and from a file
// (file:// is not — there the clipboard API does not exist and the old
// \`execCommand\` is what remains). When both routes refuse, we show the URL in a prompt: the user has something to select, instead
// of getting a "copied" toast with nothing behind it.
function legacyCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
  ta.remove();
  return ok;
}

function copyTextToClipboard(text) {
  if (window.isSecureContext && navigator.clipboard) {
    return navigator.clipboard.writeText(text).then(() => true, () => legacyCopy(text));
  }
  return Promise.resolve(legacyCopy(text));
}

document.getElementById("btnCopyLink").addEventListener("click", () => {
  const url = window.location.href;
  copyTextToClipboard(url).then((ok) => {
    if (ok) toast("Link copied ✓", "success");
  else window.prompt("Copy the link to this view:", url);
  });
});

// ─── View tabs ───────────────────────────────────────────────────────
for (const btn of document.querySelectorAll(".view-tab")) {
  btn.addEventListener("click", () => {
    const v = btn.dataset.view;
    setView(v);
    if (v === "execution") window.location.hash = "execution";
    else if (v === "decisions") window.location.hash = "decisions";
    else tasksSyncHash();
  });
}

// ─── Initial render + auto-reconnect ─────────────────────────────────
// The scope is loaded BEFORE the first render: if it came after, the first frame
// would show the full backlog and only then collapse to the board.
// The order of the sources: ?board= in the URL (a link can be passed on) > localStorage.
(function restoreBoardScope() {
  let wanted = null;
  const p = new URLSearchParams(window.location.search);
  if (p.get("board")) wanted = p.get("board");
  if (!wanted) {
    try { wanted = localStorage.getItem(BOARD_STORAGE_KEY); } catch { /* a private window */ }
  }
  const valid = wanted === BOARD_ALL || knownBoards().some((b) => b.slug === wanted);
  state.board = valid ? wanted : BOARD_ALL;
  applyScope();
})();

render();
handleHash();
// Only now may the URL be overwritten: the link somebody arrived with has been
// read. The first write normalises the entry (\`#BL-123\`, no hash at all) into a
// form that can be copied from the address bar and sent.
hashRouted = true;
tasksSyncHash();
updateConnectionBar();

// Server mode: already live at first paint (the page is rendered from a fresh
// disk read), plus an SSE subscription so edits made outside the browser —
// by an agent, an editor, a git checkout — show up without a reload.
if (SERVER_MODE) {
  state.liveMode = true;
  // The page was rendered from a fresh disk read on this request — calling it
  // a "snapshot" would be wrong.
  const meta = document.querySelector(".build-meta");
  if (meta) meta.textContent = "read from disk: " + new Date().toLocaleTimeString();
  let sseTimer = null;
  try {
    const es = new EventSource("api/events");
    es.addEventListener("tasks-changed", () => {
      clearTimeout(sseTimer);                    // debounce editor write bursts
      sseTimer = setTimeout(() => refreshFromServer(true), 250);
    });
    es.onerror = () => { /* server stopped — keep showing the last render */ };
  } catch (e) {
    console.warn("SSE unavailable:", e.message);
  }
}

(async () => {
  if (SERVER_MODE || !FS_SUPPORTED) return;
  const saved = await dbLoadHandle();
  if (!saved) return;
  // Try silent reconnect — only succeeds if user already granted persistent permission.
  try {
    const opts = { mode: "readwrite" };
    if ((await saved.queryPermission(opts)) === "granted") {
      await connectToFolder(saved);
      toast("Auto-connected to the previous folder ✓", "success");
    } else {
      // Permission needs re-prompt — show a non-modal hint instead of forcing dialog.
      const hint = document.getElementById("connectionHint");
      hint.textContent = 'I have a remembered folder — click "Resume connection" to confirm the permission.';
      document.getElementById("btnConnect").textContent = "Resume connection";
      document.getElementById("btnConnect").onclick = async () => {
        if (await verifyPermission(saved)) await connectToFolder(saved);
        else toast("No permission", "error");
      };
    }
  } catch (e) {
    console.warn("Auto-reconnect failed:", e.message);
  }
})();
</script>

</body>
</html>
`;
}

// ──────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────

// Guarded so `serve-backlog.mjs` can import the renderer without writing the
// snapshot file as a side effect of the import.
const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  // The validation lives ONLY here, in the CLI branch — never in defaultRoot(),
  // which is also called when the module is imported (serve-backlog.mjs, tests
  // calling readTasks()/buildHtml() with no arguments). There process.argv carries
  // the RUNNER's flags (e.g. `node --test`), not the backlog's; argv validation in defaultRoot()
  // would kill those processes with an error of its own (BL-1417).
  {
    const KNOWN = new Set(["--dir"]);
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (!a.startsWith("-")) {
        if (i > 0 && argv[i - 1] === "--dir") continue; // the value of --dir
        console.error(`${N} viewer: unexpected argument: ` + a);
        console.error("  available: --dir <path>");
        process.exit(2);
      }
      if (!KNOWN.has(a)) {
        console.error(`${N} viewer: unknown flag: ` + a);
        console.error("  available: --dir <path>");
        process.exit(2);
      }
    }
  }
  const root = defaultRoot();
  const config = loadConfigOrExit(root);
  const tasks = readTasks(root);
  const stats = computeStats(tasks);
  const html = buildHtml(tasks, stats, config);
  const OUTPUT_PATH = backlogPaths(root).viewerPath;
  writeFileSync(OUTPUT_PATH, html, "utf8");

  console.log(
    `${N} viewer: Built ${OUTPUT_PATH}\n` +
      `  ${tasks.length} tasks rendered\n` +
      `  ${Math.round(html.length / 1024)} KB output\n` +
      `  Open: file://${OUTPUT_PATH}`
  );
}
