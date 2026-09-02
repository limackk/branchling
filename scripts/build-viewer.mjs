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
import { loadConfig, loadConfigOrExit } from "./config.mjs";
import { taskIdPatterns } from "./task-id.mjs";
import { backlogPaths, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { loadPlan } from "./plan.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The data directory is an ARGUMENT, not a property of where this file sits
 * (BL-1399). The default value preserves today's calls with no flags.
 */
function defaultRoot() {
  return resolveBacklogDir({ dir: takeDirFlag(process.argv.slice(2)).dir, moduleDir: __dirname }).root;
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

export function readTasks(root = defaultRoot()) {
  const TASKS_DIR = backlogPaths(root).tasksDir;
  // The prefix from this backlog's configuration (BL-1452), not from a constant.
  // STRICT (TL-60): a page built under a configuration that could not be read
  // shows emptiness or somebody else's vocabulary — and looks correct doing it.
  const config = loadConfigOrExit(root);
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
export function buildHtml(
  tasks,
  stats,
  config = loadConfig(defaultRoot()),
  history = readAllHistory(config.root),
  plan = loadPlan(backlogPaths(config.root).planPath)
) {
  const tasksJson = JSON.stringify(tasks).replace(/</g, "\\u003c");
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
  .dash-scope {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    margin: 0 0 12px; padding: 8px 12px; border: 1px solid var(--border);
    border-radius: 8px; background: var(--bg-elev); font-size: 13px; color: var(--fg-muted);
  }
  .dash-scope strong { color: var(--fg); }
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

  /* ─── Status changer (in detail panel) ──────────────────────────── */
  .status-changer {
    margin-top: 14px;
    padding: 12px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: var(--shadow);
  }
  .status-changer-label {
    font-size: 11px;
    color: var(--fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
  }
  .status-changer-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .status-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--fg-muted);
    padding: 5px 12px;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
    font-family: inherit;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    font-weight: 600;
    transition: all 120ms ease;
  }
  .status-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--fg); }
  .status-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .status-changer-disabled-hint {
    margin-top: 8px;
    font-size: 11px;
    color: var(--fg-muted);
    font-style: italic;
  }

  /* ─── Why a change was made (TL-105) ───────────────────────────── */
  .reason-ask {
    margin: 12px 0;
    padding: 12px;
    border: 1px solid var(--accent);
    border-radius: 6px;
    background: var(--bg-card);
  }
  .reason-ask-head { font-size: 13px; margin-bottom: 4px; }
  .reason-ask-hint { font-size: 11px; color: var(--fg-muted); margin-bottom: 8px; }
  .reason-ask-error { font-size: 11px; color: var(--accent); margin-bottom: 8px; font-weight: 600; }
  .reason-ask-input {
    width: 100%;
    font: inherit;
    font-size: 13px;
    padding: 6px 8px;
    color: var(--fg);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    resize: vertical;
  }
  .reason-ask-actions { margin-top: 8px; display: flex; gap: 8px; }
  .reason-ask-save, .reason-ask-cancel {
    font: inherit;
    font-size: 12px;
    padding: 4px 12px;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--fg);
    cursor: pointer;
  }
  .reason-ask-save { border-color: var(--accent); }
  .hist-reason {
    margin-top: 2px;
    font-size: 12px;
    color: var(--fg-muted);
    border-left: 2px solid var(--border);
    padding-left: 8px;
  }
  .hist-reason.is-sentinel { font-style: italic; opacity: 0.75; }

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
  /* ─── Field editing + history (BL-1396/BL-1397) ─────────────────────── */
  .actor-picker { display: flex; align-items: center; gap: 4px; margin-left: auto; }
  .actor-label { font-size: 11px; color: var(--fg-muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .actor-btn {
    font: inherit; font-size: 12px; padding: 3px 9px; border-radius: 999px;
    border: 1px solid var(--border); background: var(--bg-card); color: var(--fg-muted); cursor: pointer;
  }
  .actor-btn:hover { border-color: var(--accent); color: var(--fg); }
  .actor-btn.is-active { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }

  .meta-value.is-editable, .detail-header h1.is-editable {
    cursor: pointer; border-radius: 6px;
    border: 1px dashed transparent; padding: 2px 4px; margin: -2px -4px;
  }
  .meta-value.is-editable:hover, .meta-value.is-editable:focus-visible,
  .detail-header h1.is-editable:hover, .detail-header h1.is-editable:focus-visible {
    border-color: var(--accent); background: var(--accent-soft); outline: none;
  }
  .edit-pen { opacity: 0; margin-left: 6px; color: var(--accent); font-size: 11px; }
  .is-editable:hover .edit-pen, .is-editable:focus-visible .edit-pen { opacity: 1; }
  .meta-row.is-editing { background: var(--accent-soft); border-radius: 8px; padding: 4px 6px; margin: -4px -6px; }
  .meta-row-wide { grid-column: 1 / -1; }

  .field-editor { font: inherit; font-size: 13px; }
  select.field-editor, .field-input {
    width: 100%; padding: 4px 6px; border: 1px solid var(--accent);
    border-radius: 6px; background: var(--bg-card); color: var(--fg); font: inherit; font-size: 13px;
  }
  textarea.field-input { resize: vertical; line-height: 1.5; }
  .chips-editor { display: flex; flex-wrap: wrap; gap: 5px; }
  .chip-opt {
    display: inline-flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer;
    padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border); background: var(--bg-card);
  }
  .chip-opt.is-on { border-color: var(--accent); background: var(--accent-soft); }
  .editor-actions { display: flex; gap: 6px; margin-top: 6px; flex-basis: 100%; }
  .editor-actions button {
    font: inherit; font-size: 12px; padding: 3px 10px; border-radius: 6px;
    border: 1px solid var(--border); background: var(--bg-card); color: var(--fg); cursor: pointer;
  }
  .editor-actions button:first-child { border-color: var(--accent); background: var(--accent); color: #fff; }

  .field-stamp {
    font: inherit; font-size: 10px; margin-left: 6px; padding: 1px 6px;
    border-radius: 999px; border: 1px solid var(--border); background: var(--bg);
    color: var(--fg-muted); cursor: pointer; text-transform: none; letter-spacing: 0;
  }
  .field-stamp:hover { border-color: var(--accent); color: var(--accent); }

  .history-block { margin-top: 14px; border-top: 1px solid var(--border); padding-top: 10px; }
  .history-toggle {
    font: inherit; font-size: 12px; font-weight: 600; color: var(--fg-muted);
    background: none; border: none; padding: 0; cursor: pointer;
  }
  .history-toggle:hover { color: var(--accent); }
  .history-filter { font-size: 11px; color: var(--fg-muted); margin-left: 8px; }
  .history-filter button { font: inherit; border: none; background: none; cursor: pointer; color: var(--accent); }
  .history-empty { font-size: 12px; color: var(--fg-muted); margin: 8px 0 0; }
  .history-list { list-style: none; margin: 8px 0 0; padding: 0; max-height: 260px; overflow-y: auto; }
  .history-entry {
    display: grid; grid-template-columns: 96px 72px 1fr auto; gap: 8px; align-items: baseline;
    font-size: 12px; padding: 3px 0; border-bottom: 1px solid var(--border);
  }
  .history-entry:last-child { border-bottom: none; }
  .hist-when { color: var(--fg-muted); font-variant-numeric: tabular-nums; }
  .hist-actor {
    font-weight: 600; font-size: 11px; padding: 1px 6px; border-radius: 999px;
    background: var(--accent-soft); color: var(--fg); text-align: center;
  }
  /* Coloured by the identity NAMESPACE, not by the name: an .actor-<name> class
     was one project's vocabulary in the CSS and did not work in another backlog (BL-1404). */
  .hist-actor.actor-ns-agent { background: var(--bg-sidebar); }
  .hist-actor.actor-ns-user { background: var(--accent-soft); box-shadow: inset 0 0 0 1px var(--accent); }
  .hist-actor.actor-ns-legacy { background: transparent; border: 1px solid var(--border); color: var(--fg-muted); }
  .hist-actor.actor-ns-unknown { background: transparent; border: 1px dashed var(--border); color: var(--fg-muted); }
  .hist-what s { color: var(--fg-muted); text-decoration-thickness: 1px; }
  .hist-source { color: var(--fg-muted); font-size: 10px; }
  .hist-answers {
    font-size: 10px;
    color: var(--accent);
    border: 1px solid var(--accent);
    border-radius: 999px;
    padding: 0 6px;
    white-space: nowrap;
  }
  @media (max-width: 720px) {
    .history-entry { grid-template-columns: 1fr; gap: 2px; }
  }

  .meta-row { display: flex; flex-direction: column; gap: 2px; }
  .meta-label {
    font-size: 11px;
    color: var(--fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .meta-value { font-size: 13px; font-weight: 500; }
  .meta-value a {
    font-family: "SF Mono", Monaco, Menlo, monospace;
    font-size: 12px;
    color: var(--accent);
    text-decoration: none;
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--accent-soft);
    margin-right: 4px;
  }
  .meta-value a:hover { text-decoration: underline; }

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
  .exec-card-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
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
  .dec-filter {
    font: inherit;
    font-size: 11px;
    padding: 3px 10px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--fg-muted);
    cursor: pointer;
  }
  .dec-filter.is-on { background: var(--accent-soft); border-color: var(--accent); color: var(--fg); }
  .dec-item {
    border: 1px solid var(--border);
    border-left-width: 3px;
    border-radius: 10px;
    background: var(--bg-card);
    padding: 12px 14px;
    margin-bottom: 10px;
  }
  .dec-item.is-question { border-left-color: var(--accent); }
  .dec-row { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .dec-id { font-weight: 600; font-size: 12px; color: var(--accent); text-decoration: none; }
  .dec-id:hover { text-decoration: underline; }
  .dec-title { font-size: 13px; }
  .dec-kind {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: .06em;
    color: var(--fg-muted);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 0 7px;
  }
  .dec-unblocks { margin-left: auto; font-size: 11px; color: var(--fg-muted); font-variant-numeric: tabular-nums; }
  .dec-question {
    margin-top: 8px;
    padding: 8px 10px;
    background: var(--bg);
    border-radius: 8px;
    font-size: 12px;
  }
  .dec-meta { margin-top: 6px; font-size: 11px; color: var(--fg-muted); }
  .dec-actions { margin-top: 10px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
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

  /* ─── Dashboard ─────────────────────────────────────────────────── */
  .dashboard-view { display: none; }
  body.view-dashboard main.app-main { display: none; }
  body.view-dashboard .filters-bar,
  body.view-dashboard .stats { display: none; }
  body.view-dashboard .dashboard-view {
    display: block;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 20px 24px 64px;
  }

  .dash-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 16px;
    margin-bottom: 16px;
  }
  .dash-grid.wide { grid-template-columns: 1fr; }
  .dash-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 14px 16px 16px;
    box-shadow: var(--shadow);
    min-width: 0;
  }
  .dash-card h2 {
    font-size: 13px;
    margin: 0 0 2px;
    font-weight: 600;
    letter-spacing: 0.01em;
  }
  .dash-card .dash-sub {
    font-size: 11px;
    color: var(--fg-muted);
    margin: 0 0 12px;
  }
  .dash-card .dash-note {
    font-size: 11px;
    color: var(--fg-muted);
    margin: 10px 0 0;
  }

  .kpi-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 12px;
    margin-bottom: 16px;
  }
  .kpi {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px 14px;
    box-shadow: var(--shadow);
  }
  .kpi-label { font-size: 11px; color: var(--fg-muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .kpi-value {
    font-size: 24px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 1.2;
    margin-top: 2px;
  }
  .kpi-meta { font-size: 11px; color: var(--fg-muted); font-variant-numeric: tabular-nums; }

  .dash-chart { width: 100%; height: auto; display: block; overflow: visible; }
  .dash-legend { display: flex; flex-wrap: wrap; gap: 14px; font-size: 11px; color: var(--fg-muted); margin-top: 8px; }
  .dash-legend span { display: inline-flex; align-items: center; gap: 6px; }
  .dash-legend i { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }

  .bars { display: flex; flex-direction: column; gap: 6px; }
  .bar-row {
    display: grid;
    grid-template-columns: minmax(90px, 34%) 1fr 46px;
    align-items: center;
    gap: 10px;
    font-size: 12px;
    border: 0;
    background: none;
    color: inherit;
    font-family: inherit;
    padding: 1px 0;
    text-align: left;
    cursor: pointer;
    width: 100%;
  }
  .bar-row:hover .bar-label { color: var(--accent); }
  .bar-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* display:block matters — these are <span>s, and an inline box ignores
     width/height, so every bar rendered as an empty track. */
  .bar-track { display: block; background: var(--bg); border-radius: 4px; height: 12px; overflow: hidden; border: 1px solid var(--border); }
  .bar-fill { display: block; height: 100%; background: var(--accent); border-radius: 3px 0 0 3px; }
  .bar-value { text-align: right; font-variant-numeric: tabular-nums; color: var(--fg-muted); }

  .dash-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .dash-table th {
    text-align: left;
    font-weight: 600;
    font-size: 11px;
    color: var(--fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-bottom: 1px solid var(--border);
    padding: 6px 8px;
    background: var(--bg-card);
  }
  /* Sticky only inside a scroll container. On a table that scrolls with the
     page it detached and floated into the middle of its own rows. */
  .dash-scroll .dash-table th { position: sticky; top: 0; }
  .dash-table td { padding: 6px 8px; border-bottom: 1px solid var(--border); vertical-align: middle; }
  .dash-table tbody tr:hover { background: var(--bg); }
  .dash-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
  /* The header was left-aligned over right-aligned numbers, so every column
     read as if its values belonged to the neighbour on the left. */
  .dash-table th.num { text-align: right; }
  .th-sort {
    font: inherit;
    color: inherit;
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
    text-transform: inherit;
    letter-spacing: inherit;
    font-weight: inherit;
  }
  .dash-table th.num .th-sort { display: block; width: 100%; text-align: right; }
  .th-sort:hover { color: var(--accent); }
  .sort-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 6px;
    margin: 0 0 10px;
    font-size: 11px;
    color: var(--fg-muted);
  }
  .sort-btn {
    font: inherit;
    padding: 2px 8px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--fg-muted);
    border-radius: 999px;
    cursor: pointer;
  }
  .sort-btn:hover { border-color: var(--accent); color: var(--fg); }
  .sort-btn.is-active { background: var(--accent-soft); border-color: var(--accent); color: var(--fg); font-weight: 600; }
  .th-sort.is-active { color: var(--fg); }
  .dash-table .epic-name { font-weight: 500; cursor: pointer; }
  .dash-table .epic-name:hover { color: var(--accent); text-decoration: underline; }
  .dash-scroll { max-height: 420px; overflow-y: auto; margin: 0 -6px; padding: 0 6px; }

  .mini-progress {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 120px;
  }
  .mini-progress .bar-track { flex: 1; height: 8px; }
  .mini-progress span { font-variant-numeric: tabular-nums; font-size: 11px; color: var(--fg-muted); width: 34px; text-align: right; }

  .dash-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .dash-list li {
    display: flex;
    gap: 8px;
    align-items: baseline;
    font-size: 12px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border);
  }
  .dash-list li:last-child { border-bottom: 0; }
  .dash-list a { color: inherit; text-decoration: none; cursor: pointer; }
  .dash-list a:hover { color: var(--accent); text-decoration: underline; }
  .dash-list .dash-id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--fg-muted); flex: none; }
  .dash-list .dash-age { margin-left: auto; flex: none; font-variant-numeric: tabular-nums; color: var(--fg-muted); font-size: 11px; }
  .dash-empty { font-size: 12px; color: var(--fg-muted); padding: 8px 0; }

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

  /* ─── Chart hover ───────────────────────────────────────────────── */
  .hover-capture { cursor: crosshair; }
  .hover-line { stroke: var(--fg-muted); stroke-width: 1; stroke-dasharray: 3 3; }
  .hover-band { fill: var(--fg); opacity: 0.07; }
  .hover-dot { stroke: var(--bg-card); stroke-width: 1.5; }
  .chart-tip {
    position: fixed;
    z-index: 60;
    pointer-events: none;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: var(--shadow-lg);
    padding: 8px 10px;
    font-size: 12px;
    min-width: 168px;
    font-variant-numeric: tabular-nums;
  }
  .chart-tip[hidden] { display: none; }
  .chart-tip .tip-day { font-weight: 600; margin-bottom: 5px; }
  .chart-tip .tip-row { display: flex; align-items: center; gap: 8px; line-height: 1.7; }
  .chart-tip .tip-row i { width: 8px; height: 8px; border-radius: 2px; flex: none; }
  .chart-tip .tip-row span { color: var(--fg-muted); }
  .chart-tip .tip-row strong { margin-left: auto; font-weight: 600; }
  .burn-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    margin: 0 0 10px;
    font-size: 12px;
  }
  .burn-bar select {
    font: inherit;
    color: var(--fg);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 3px 6px;
    max-width: 260px;
  }

  details.hyg { border-bottom: 1px solid var(--border); padding: 6px 0; }
  details.hyg:last-of-type { border-bottom: 0; }
  details.hyg > summary {
    cursor: pointer;
    font-size: 12px;
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
  }
  details.hyg > summary::-webkit-details-marker { color: var(--fg-muted); }
  .hyg-count {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    color: var(--accent);
    min-width: 28px;
    display: inline-block;
  }
  .hyg-hint { color: var(--fg-muted); font-size: 11px; flex-basis: 100%; padding-left: 36px; }
  details.hyg .dash-list { margin-top: 8px; max-height: 260px; overflow-y: auto; padding-left: 36px; }

  .day-panel { position: relative; border-color: var(--accent); }
  .day-panel h2 { padding-right: 28px; }
  .day-panel h3 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fg-muted);
    margin: 0 0 8px;
    font-weight: 600;
  }
  .day-cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 16px;
  }
  .day-cols .dash-list { max-height: 320px; overflow-y: auto; }
  .day-close {
    position: absolute;
    top: 10px;
    right: 12px;
    font: inherit;
    font-size: 13px;
    line-height: 1;
    padding: 4px 7px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--fg-muted);
    border-radius: 6px;
    cursor: pointer;
  }
  .day-close:hover { border-color: var(--accent); color: var(--fg); }

  .chart-tip .tip-foot {
    margin-top: 5px;
    padding-top: 5px;
    border-top: 1px solid var(--border);
    color: var(--fg-muted);
    font-size: 11px;
  }
</style>
</head>
<body>

<header class="app-header">
  <div class="app-title">
    <h1>${escapeHtml(config.projectName)}</h1>
    <span class="build-meta">snapshot: ${buildTime}</span>
    <nav class="view-tabs" id="viewTabs">
      <button type="button" class="view-tab is-active" data-view="tasks">Tasks</button>
      <button type="button" class="view-tab" data-view="dashboard">Dashboard</button>
      <button type="button" class="view-tab" data-view="execution">Execution</button>
      <button type="button" class="view-tab" data-view="decisions" id="tabDecisions">Waiting on you</button>
      <button type="button" class="copy-link-btn" id="btnCopyLink"
              title="Copies the address of this view — filters, search, sort, board and the selected task">⧉ Copy link</button>
    </nav>
  </div>

  <div class="connection-bar snapshot" id="connectionBar">
    <span class="connection-dot"></span>
    <span class="connection-status" id="connectionStatus">Tryb snapshot</span>
    <span class="connection-hint" id="connectionHint">Data from the moment of the build. Connect to the folder to work on live files and edit statuses.</span>
    <button class="btn-action primary" id="btnConnect">Connect to the backlog folder</button>
    <button class="btn-action" id="btnRefresh" style="display:none">Refresh from disk</button>
    <button class="btn-action" id="btnDisconnect" style="display:none">Disconnect</button>
    <div class="actor-picker" id="actorPicker" style="display:none"></div>
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

<section class="dashboard-view" id="dashboardView"></section>
<section class="execution-view" id="executionView"></section>
<section class="decisions-view" id="decisionsView"></section>
<div class="chart-tip" id="chartTip" hidden></div>

<script>
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

// TASKS / STATS are mutable — live mode replaces them after reading from disk.
// ALL_TASKS is the full set; TASKS is its narrowing to the selected board.
// The split is here rather than at every place that reads TASKS, because a board
// is meant to be a SCOPE, not a filter: a filter narrows the list of cards, but
// the dashboard counts from TASKS and would show throughput, queue and burndown
// summed across both boards under the heading of one. We narrow the source —
// everything below narrows along with it.
// The history of field changes: { "<ID>": [ {ts, field, from, to, actor, source}, ... ] }.
// Embedded into the page at render time, refreshed from /api/history after every
// edit and after an SSE signal. Under file:// the build's copy remains — it reads
// the same way there, only nothing new can be appended.
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
  decisionsMine: false,
  // Dashboard date range — flow metrics only, see computeDashboard().
  dashRange: { preset: "all", from: null, to: null },
  // Day pinned by clicking a chart point: { day, source } — source names which
  // chart opened it, so the panel appears under that chart and not the others.
  dashDay: null,
  // What the burndown burns down: { kind: "label" | "epic" | "board", value }.
  dashBurn: CONFIG.dashboard.burndown,
  // Sort state per listing, keyed by the id passed to dashSortItems().
  dashSorts: {},
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
const BOARD_STORAGE_KEY = "origin-backlog-board";

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
  try { localStorage.setItem(BOARD_STORAGE_KEY, next); } catch { /* prywatne okno */ }
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
function reasonRequiredFor(field, value) {
  return field === "status" && REASON_REQUIRED_STATUSES.indexOf(String(value)) !== -1;
}
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
    const r = indexedDB.open("origin-backlog-viewer", 1);
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
    const handle = await window.showDirectoryPicker({ mode: "readwrite", id: "origin-backlog" });
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
// Writing a status no longer has a route of its own: the status is one of the
// fields and goes through saveField() → POST /api/field → the server. There used
// to be two implementations (fetch and File System Access), each knowing its own
// version of the "what to set on a change" rules — and the second knew nothing
// about the history.
function changeTaskStatus(taskId, newStatus) {
  return saveField(taskId, "status", newStatus);
}

// ─── Connection bar UI ───────────────────────────────────────────────
function updateConnectionBar() {
  const bar = document.getElementById("connectionBar");
  const status = document.getElementById("connectionStatus");
  const hint = document.getElementById("connectionHint");
  const btnConnect = document.getElementById("btnConnect");
  const btnRefresh = document.getElementById("btnRefresh");
  const btnDisconnect = document.getElementById("btnDisconnect");
  if (SERVER_MODE) {
    bar.classList.remove("snapshot"); bar.classList.add("live");
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
    status.textContent = "Tryb snapshot";
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
    key: "filterPriority", param: "priority", label: "Priorytet",
    match: (t, v) => (t.priority || "") === v,
    options: () => CONFIG.priorities.map(value => ({ value, label: value })),
  },
  {
    key: "filterType", param: "type", label: "Typ",
    match: (t, v) => (t.type || "") === v,
    options: () => (CONFIG.types || []).map(value => ({ value, label: labelTitle(value) })),
  },
  {
    key: "filterLabel", param: "phase", label: "Faza",
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

// ─── Task detail: every field clickable, and who changed it (BL-1396/BL-1397) ──
//
// Editing goes ONLY through the server (\`${N}\`): one place validates, writes
// the .md, appends to the history and rebuilds the views. Under file:// the fields
// are read-only — a second write path (File System Access) would mean a second set
// of rules and a second place that knows about the history.
const CAN_EDIT = SERVER_MODE;
const ACTOR_STORAGE_KEY = "origin-backlog-actor";
const ACTORS = CONFIG.actors || [];

const HISTORY_FIELD_LABELS = {
  __created__: "task utworzony",
  __deleted__: "task deleted",
  __body__: "task body",
  __comment__: "comment",
  __decision__: "decision",
  __verified__: "manual verification vouched for",
  __role_override__: "taken outside its role",
  updated: "Updated",
  created: "Utworzony",
};

/**
 * The actor in the history. The CSS class takes the NAMESPACE, not the whole
 * value — the colon in agent:claude is not legal in a class name, and we want to
 * colour by the kind of identity anyway, not by the name. What stays visible is
 * the name; the namespace goes into the tooltip, because it says HOW MUCH the
 * attribution is worth.
 */
function actorHtml(actor) {
  const parts = actorParts(actor);
  const hint = {
    local: "declared locally, unverified",
    agent: "written automatically",
    user: "authenticated account",
    legacy: "entry from before the namespace convention (BL-1404)",
    unknown: "author unknown",
  }[parts.namespace] || parts.namespace;
  return '<span class="hist-actor actor-ns-' + escape(parts.namespace) + '" title="' +
    escape(actor + " — " + hint) + '">' + escape(parts.name) + "</span>";
}

function fieldLabel(key) {
  const spec = fieldSpec(key, FIELDS);
  if (spec) return spec.label;
  return HISTORY_FIELD_LABELS[key] || key;
}

function loadActor() {
  try {
    const v = localStorage.getItem(ACTOR_STORAGE_KEY);
    if (v && isValidActorSlug(v)) return v;
  } catch (e) { /* prywatne okno */ }
  return "founder";
}
function isValidActorSlug(v) {
  return typeof v === "string" && v.length <= 32 && /^[a-z0-9][a-z0-9._-]*$/.test(v);
}
function setActor(v) {
  if (!isValidActorSlug(v)) return;
  state.actor = v;
  try { localStorage.setItem(ACTOR_STORAGE_KEY, v); } catch (e) { /* ignore */ }
  renderActorPicker();
}
function renderActorPicker() {
  const el = document.getElementById("actorPicker");
  if (!el) return;
  if (!CAN_EDIT) { el.style.display = "none"; return; }
  el.style.display = "";
  const opts = ACTORS.slice();
  if (opts.indexOf(state.actor) < 0) opts.push(state.actor);
  el.innerHTML = '<span class="actor-label">Editing as</span>' +
    opts.map(function (a) {
      // The button shows the name alone; the full value with its namespace goes
      // into data-actor and into the tooltip — that is what lands in the log.
      return '<button type="button" class="actor-btn' + (a === state.actor ? " is-active" : "") +
        '" title="' + escape(a) + '" data-actor="' + escape(a) + '">' + escape(actorParts(a).name) + "</button>";
    }).join("");
  el.querySelectorAll(".actor-btn").forEach(function (b) {
    b.addEventListener("click", function () { setActor(b.dataset.actor); });
  });
}

/** The values the schema does not know in advance — they come from the data. */
function dynamicOptions() {
  const uniq = function (key) {
    const out = [];
    for (const t of ALL_TASKS) {
      const v = String(t[key] == null ? "" : t[key]).trim();
      if (v && out.indexOf(v) < 0) out.push(v);
    }
    return out.sort();
  };
  return {
    boards: knownBoards().map(function (b) { return b.slug; }),
    epics: uniq("epic"),
    owners: uniq("owner"),
  };
}

// ─── History ──────────────────────────────────────────────────────────
function historyFor(id) {
  const entries = HISTORY[id] || [];
  return entries.slice().sort(function (a, b) { return String(a.ts).localeCompare(String(b.ts)); });
}
function lastChangeFor(id, field) {
  const entries = historyFor(id);
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i].field === field) return entries[i];
  return null;
}
// The history is fetched ONCE per task and redrawn only when it really changed.
// An unconditional renderDetail() after every fetch made a loop
// (render → fetch → render) that wiped an open editor while somebody was typing.
const historyLoaded = {};
async function refreshHistory(id, force) {
  if (!SERVER_MODE || !id) return;
  if (!force && historyLoaded[id]) return;
  historyLoaded[id] = true;
  try {
    const res = await fetch("api/history?id=" + encodeURIComponent(id), { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    const next = data.entries || [];
    const changed = JSON.stringify(next) !== JSON.stringify(HISTORY[id] || []);
    HISTORY[id] = next;
    if (changed && state.selectedId === id && !state.editing) renderDetail();
  } catch (e) {
    historyLoaded[id] = false;   // we will try again on the next visit
  }
}
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
function startEdit(id, field) {
  if (!CAN_EDIT) {
    toast("Editing fields only works through the local server — run ${N} in a terminal", "error");
    return;
  }
  state.editing = { id: id, field: field };
  renderDetail();
  const el = document.querySelector("[data-editor-focus]");
  if (el) { el.focus(); if (el.select) el.select(); }
}
function cancelEdit() {
  state.editing = null;
  renderDetail();
}

function editorHtml(t, spec) {
  const value = t[spec.key];
  const opts = dynamicOptions();
  const id = escape(t.id);
  const key = escape(spec.key);
  const common = ' data-editor-focus onkeydown="onEditorKey(event)"';

  if (spec.kind === "enum") {
    const list = (spec.dynamic ? (opts[spec.dynamic] || []) : spec.options).slice();
    if (list.indexOf(String(value || "")) < 0 && value) list.push(String(value));
    const empty = spec.allowEmpty ? '<option value="">— none —</option>' : "";
    return '<select class="field-editor"' + common +
      ' onchange="saveField(\\'' + id + '\\',\\'' + key + '\\', this.value)"' +
      ' onblur="cancelEdit()">' + empty +
      list.map(function (o) {
        return '<option value="' + escape(o) + '"' + (String(value || "") === o ? " selected" : "") + ">" + escape(o) + "</option>";
      }).join("") + "</select>";
  }

  if (spec.kind === "list" && spec.closed) {
    return '<div class="field-editor chips-editor"' + common + ' tabindex="-1">' +
      spec.options.map(function (o) {
        const on = (value || []).indexOf(o) >= 0;
        return '<label class="chip-opt' + (on ? " is-on" : "") + '"><input type="checkbox"' + (on ? " checked" : "") +
          ' value="' + escape(o) + '"> ' + escape(o) + "</label>";
      }).join("") +
      '<div class="editor-actions">' +
      '<button type="button" onclick="saveChips(\\'' + id + '\\',\\'' + key + '\\', this)">Save</button>' +
      '<button type="button" onclick="cancelEdit()">Cancel</button></div></div>';
  }

  if (spec.kind === "list") {
    const text = (value || []).join("\\n");
    return '<div class="field-editor">' +
      '<textarea class="field-input" rows="' + Math.max(2, (value || []).length + 1) + '"' + common +
      ' placeholder="' + escape(spec.itemHint || "") + ' — one value per line">' + escape(text) + "</textarea>" +
      '<div class="editor-actions">' +
      '<button type="button" onclick="saveLines(\\'' + id + '\\',\\'' + key + '\\', this)">Save</button>' +
      '<button type="button" onclick="cancelEdit()">Cancel</button></div></div>';
  }

  const suggest = (spec.dynamic ? (opts[spec.dynamic] || []) : []).concat(spec.suggest || [])
    .filter(function (v, i, arr) { return v && arr.indexOf(v) === i; });
  const listId = "sug-" + key;
  return '<input class="field-editor field-input" type="text" value="' + escape(value == null ? "" : value) + '"' +
    (suggest.length ? ' list="' + listId + '"' : "") +
    (spec.maxLength ? ' maxlength="' + spec.maxLength + '"' : "") + common +
    ' onblur="saveField(\\'' + id + '\\',\\'' + key + '\\', this.value)">' +
    (suggest.length ? '<datalist id="' + listId + '">' + suggest.map(function (o) {
      return '<option value="' + escape(o) + '">';
    }).join("") + "</datalist>" : "");
}

function onEditorKey(e) {
  if (e.key === "Escape") { e.preventDefault(); cancelEdit(); return; }
  if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); e.target.blur(); }
}
function saveChips(id, field, btn) {
  const box = btn.closest(".chips-editor");
  const values = Array.prototype.slice.call(box.querySelectorAll("input:checked")).map(function (i) { return i.value; });
  saveField(id, field, values);
}
function saveLines(id, field, btn) {
  const box = btn.closest(".field-editor");
  const values = box.querySelector("textarea").value.split("\\n").map(function (l) { return l.trim(); }).filter(Boolean);
  saveField(id, field, values);
}

/**
 * Writing a field. The validation comes from the same module as on the server —
 * the UI cannot let through a value the server will reject. The optimistic
 * update reverts to the previous state when a write fails: the state shown has to
 * always match the file on disk.
 */
async function saveField(taskId, field, value, reason) {
  const task = ALL_TASKS.find(function (t) { return t.id === taskId; });
  if (!task) return;
  if (!CAN_EDIT) {
    toast("Editing fields only works through the local server — run ${N} in a terminal", "error");
    return;
  }
  const norm = normalizeValue(field, value, { fields: FIELDS, options: dynamicOptions() });
  if (!norm.ok) { toast(norm.error, "error"); return; }
  if (sameValue(task[field], norm.value)) { cancelEdit(); return; }

  // Asked BEFORE anything is written, and asked here rather than in the field
  // editor, because this is the one place every write route passes through. A box
  // that appears after the change had gone in would be asking why about something
  // already done.
  if (reasonRequiredFor(field, norm.value) && !isValidReason(reason)) {
    state.editing = null;
    state.reasonAsk = { id: taskId, field: field, value: norm.value, error: reason === undefined ? "" : "A reason is required — and \`unknown\`/\`proven\` are the tool's own words." };
    renderDetail();
    return;
  }
  state.reasonAsk = null;

  const previous = task[field];
  const previousUpdated = task.updated;
  task[field] = norm.value;
  task.updated = new Date().toISOString().slice(0, 10);
  state.editing = null;
  applyScope();
  render();

  try {
    const res = await fetch("api/field", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: taskId, field: field, value: norm.value, actor: state.actor, reason: reason || "" }),
    });
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
    if (data.updated) task.updated = data.updated;
    if (data.entries && data.entries.length) {
      HISTORY[taskId] = (HISTORY[taskId] || []).concat(data.entries);
    }
    historyLoaded[taskId] = false;   // the server may have appended more than our diff
    renderDetail();
    toast(taskId + " · " + fieldLabel(field) + ": " + (formatValue(previous) || "—") + " → " + (formatValue(norm.value) || "—"), "success");
  } catch (e) {
    task[field] = previous;
    task.updated = previousUpdated;
    applyScope();
    render();
    console.error(e);
    toast("The write did not succeed: " + e.message, "error");
  }
}

// ─── Render detalu ────────────────────────────────────────────────────
function valueHtml(t, key) {
  if (key === "status") return '<span class="badge badge-status-' + escape(t.status) + '">' + escape(t.status) + "</span>";
  if (key === "priority") return '<span class="badge badge-priority-' + escape(t.priority) + '">' + escape(t.priority) + "</span>";
  if (key === "type") return '<span class="badge badge-type-' + escape(t.type) + '">' + escape(t.type) + "</span>";
  if (key === "labels") {
    return (t.labels || []).map(function (l) {
      return '<span class="badge badge-label-' + escape(l) + '">' + escape(l) + "</span>";
    }).join(" ") || "—";
  }
  if (key === "board") return t.board ? '<span class="badge badge-board">' + escape(boardLabel(t.board)) + "</span>" : "—";
  if (key === "epic") return t.epic ? '<span class="badge badge-epic">' + escape(t.epic) + "</span>" : "—";
  if (key === "estimate") {
    return escape(t.estimate || "—") +
      (t.confidence ? ' <span style="color:var(--fg-muted);font-size:11px">(' + escape(t.confidence) + ")</span>" : "");
  }
  if (key === "blocked_by" || key === "blocks") {
    const ids = t[key] || [];
    if (!ids.length) return "—";
    return ids.map(function (id) { return '<a href="#' + escape(id) + '">' + escape(id) + "</a>"; }).join(" ");
  }
  if (key === "related_docs") {
    const docs = t.related_docs || [];
    if (!docs.length) return "—";
    return docs.map(function (d) { return '<a href="../../' + escape(d) + '" target="_blank">' + escape(d) + "</a>"; }).join(" ");
  }
  const v = t[key];
  return escape((Array.isArray(v) ? v.join(", ") : v) || "—");
}

function metaRowHtml(t, spec) {
  const editing = state.editing && state.editing.id === t.id && state.editing.field === spec.key;
  const last = lastChangeFor(t.id, spec.key);
  const wide = spec.key === "related_docs" || spec.key === "labels";
  const stamp = last
    ? '<button type="button" class="field-stamp" title="' + escape(last.actor + " · " + histDay(last.ts) + " " + histTime(last.ts) + " · source: " + last.source) +
      '" onclick="openHistory(\\'' + escape(t.id) + '\\',\\'' + escape(spec.key) + '\\')">' +
      escape(last.actor) + " · " + escape(histAgo(last.ts)) + "</button>"
    : "";
  const body = editing
    ? editorHtml(t, spec)
    : '<div class="meta-value' + (CAN_EDIT ? " is-editable" : "") + '"' +
      (CAN_EDIT ? ' tabindex="0" role="button" title="Click to edit"' +
        ' onclick="startEdit(\\'' + escape(t.id) + '\\',\\'' + escape(spec.key) + '\\')"' +
        ' onkeydown="if(event.key===\\'Enter\\'||event.key===\\' \\'){event.preventDefault();startEdit(\\'' + escape(t.id) + '\\',\\'' + escape(spec.key) + '\\')}"' : "") +
      ">" + valueHtml(t, spec.key) + (CAN_EDIT ? '<span class="edit-pen" aria-hidden="true">✎</span>' : "") + "</div>";
  return '<div class="meta-row' + (wide ? " meta-row-wide" : "") + (editing ? " is-editing" : "") + '" data-field="' + escape(spec.key) + '">' +
    '<div class="meta-label">' + escape(spec.label) + stamp + "</div>" + body + "</div>";
}

function openHistory(id, field) {
  state.historyField = field || null;
  state.historyOpen = true;
  renderDetail();
  const el = document.getElementById("historyBlock");
  if (el) el.scrollIntoView({ block: "nearest" });
}
function toggleHistory() {
  state.historyOpen = !state.historyOpen;
  if (!state.historyOpen) state.historyField = null;
  renderDetail();
}
function clearHistoryFilter() {
  state.historyField = null;
  renderDetail();
}

/**
 * The box that asks why. It sits in the detail pane rather than in a modal,
 * because the answer belongs to THIS task and the reader needs the task in front
 * of them to write it — a dialog over a dimmed page hides the thing being
 * explained.
 */
function reasonAskHtml(t) {
  const ask = state.reasonAsk;
  if (!ask || ask.id !== t.id) return "";
  return '<section class="reason-ask">' +
    '<div class="reason-ask-head">Why <b>' + escape(fieldLabel(ask.field)) + " → " +
      escape(formatValue(ask.value)) + "</b>?</div>" +
    '<div class="reason-ask-hint">This transition is recorded with its reason (<code>reason_required_statuses</code>). ' +
      "It is the part nobody can reconstruct later.</div>" +
    (ask.error ? '<div class="reason-ask-error">' + escape(ask.error) + "</div>" : "") +
    '<textarea class="reason-ask-input" id="reasonAskInput" rows="2" maxlength="' + REASON_MAX_LENGTH +
      '" placeholder="one sentence about this change"></textarea>' +
    '<div class="reason-ask-actions">' +
      '<button type="button" class="reason-ask-save" onclick="submitReason()">Save</button>' +
      '<button type="button" class="reason-ask-cancel" onclick="cancelReason()">Cancel</button>' +
    "</div></section>";
}

function submitReason() {
  const ask = state.reasonAsk;
  if (!ask) return;
  const el = document.getElementById("reasonAskInput");
  const text = el ? el.value : "";
  // The value is passed back through saveField, so there is ONE write path: the
  // box cannot drift from what the ordinary edit does.
  saveField(ask.id, ask.field, ask.value, text);
}

function cancelReason() {
  state.reasonAsk = null;
  renderDetail();
}

function historyHtml(t) {
  const all = historyFor(t.id).slice().reverse();
  const shown = state.historyField ? all.filter(function (e) { return e.field === state.historyField; }) : all;
  const head = '<button type="button" class="history-toggle" onclick="toggleHistory()">' +
    (state.historyOpen ? "▾" : "▸") + " Change history (" + all.length + ")</button>" +
    (state.historyField
      ? '<span class="history-filter">only: ' + escape(fieldLabel(state.historyField)) +
        ' <button type="button" onclick="clearHistoryFilter()">×</button></span>'
      : "");
  if (!state.historyOpen) return '<section class="history-block" id="historyBlock">' + head + "</section>";

  let body;
  if (!all.length) {
    body = '<p class="history-empty">No recorded changes. The history is recorded from the moment ' +
      "the tool began keeping it — anything earlier lives in git.</p>";
  } else if (!shown.length) {
    body = '<p class="history-empty">No changes to this field.</p>';
  } else {
    body = '<ol class="history-list">' + shown.map(function (e) {
      const from = formatValue(e.from);
      const to = formatValue(e.to);
      // The three readings come from historyEntryKind() in the task-fields.mjs
      // pasted in by source, so the rule can be run by a test instead of being
      // asserted against this page's HTML (BL-1404 for the list, TL-99 for the
      // message kind). A pseudo-field usually reads as a label alone; when it
      // carries BOTH ends the label without them is half the fact, and a comment
      // is all content and no transition.
      const label = escape(fieldLabel(e.field));
      const kind = historyEntryKind(e);
      // A decision that answers a question says so, and says which one: the pair
      // is the point of the event type (TL-114), and a row that hid the link
      // would leave the reader to match ULIDs by eye.
      const answers = e.field === FIELD_DECISION && e.resolves
        ? ' <span class="hist-answers" title="Answers the event ' + escape(e.resolves) + '">answers a question above</span>'
        : "";
      const change = kind === "message"
        ? label + ": " + escape(to) + answers
        : kind === "event"
        ? label
        : label + ': <s>' + escape(from || "—") + "</s> → <b>" + escape(to || "—") + "</b>";
      // The reason is a SECOND line, not a tooltip: a why that has to be hovered
      // for is a why nobody reads. A sentinel gets a muted marker instead — it is
      // an answer about the kind of answer, and dressing it up as somebody's
      // sentence would be the lie this whole field exists to stop.
      // A message row carries its sentence as the content; the same sentence is
      // also its reason, because a reason belongs to the ACT (TL-105). Printed
      // twice it reads as two facts, so the second copy is dropped — the row
      // still shows every word, once.
      const reasonLine = hasStatedReason(e) && !(kind === "message" && e.reason === to)
        ? '<div class="hist-reason">' + escape(e.reason) + "</div>"
        : (e.reason === REASON_PROVEN
            ? '<div class="hist-reason is-sentinel">proven by the verification run</div>'
            : "");
      return '<li class="history-entry">' +
        '<span class="hist-when" title="' + escape(e.ts) + '">' + escape(histDay(e.ts)) + " " + escape(histTime(e.ts)) + "</span>" +
        actorHtml(e.actor) +
        '<span class="hist-what">' + change + reasonLine + "</span>" +
        '<span class="hist-source">' + escape(e.source || "") + "</span></li>";
    }).join("") + "</ol>";
  }
  return '<section class="history-block is-open" id="historyBlock">' + head + body + "</section>";
}

function renderDetail() {
  const el = document.getElementById("taskDetail");
  const t = TASKS.find(function (x) { return x.id === state.selectedId; });
  if (!t) {
    el.innerHTML = '<div class="empty-state">← Pick a task from the list, or use <code>#' + TASK_PREFIX + '-001</code> in the URL.</div>';
    return;
  }
  if (state.editing && state.editing.id !== t.id) state.editing = null;

  const rows = FIELDS.filter(function (spec) { return spec.key !== "title"; })
    .map(function (spec) { return metaRowHtml(t, spec); }).join("");

  const readOnlyRows =
    '<div class="meta-row"><div class="meta-label">Utworzony</div><div class="meta-value">' + escape(t.created || "—") + "</div></div>" +
    '<div class="meta-row"><div class="meta-label">Updated</div><div class="meta-value">' + escape(t.updated || "—") + "</div></div>";

  const titleEditing = state.editing && state.editing.id === t.id && state.editing.field === "title";
  const titleHtml = titleEditing
    ? '<h1 class="title-editing">' + editorHtml(t, fieldSpec("title", FIELDS)) + "</h1>"
    : "<h1" + (CAN_EDIT ? ' class="is-editable" tabindex="0" role="button" title="Click to edit the title"' +
        ' onclick="startEdit(\\'' + escape(t.id) + '\\',\\'title\\')"' : "") + ">" + escape(t.title) +
      (CAN_EDIT ? '<span class="edit-pen" aria-hidden="true">✎</span>' : "") + "</h1>";

  const editHint = CAN_EDIT
    ? ""
    : '<div class="status-changer-disabled-hint">The fields are read-only — editing and history recording work in server mode (<code>${N}</code> in a terminal).</div>'

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
      editHint +
      reasonAskHtml(t) +
      historyHtml(t) +
    "</div>" +
    '<div class="markdown-content">' + t.bodyHtml + "</div>";

  el.scrollTop = 0;
  if (SERVER_MODE) refreshHistory(t.id);
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
// reads, so the two can never disagree. Two honesty constraints are baked in:
//   1. There is no completion timestamp in the schema. "Completed on X" means
//      \`status: done\` AND \`updated: X\` — the last touch, not a proven close.
//      Every surface that uses it says so.
//   2. The dashboard ignores the task-list filters on purpose: it answers
//      "how the backlog stands", not "how my current filter stands".

const DASH_OPEN = CONFIG.dashboard.openStatuses;

function dashDay(s) { return (s || "").slice(0, 10); }
function dashIsDay(s) { return /^\\d{4}-\\d{2}-\\d{2}$/.test(s || ""); }
function dashToday() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function dashAddDays(key, n) {
  const d = new Date(key + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dashDiffDays(a, b) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}
function dashMedian(arr) {
  if (!arr.length) return null;
  const s = arr.slice().sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
function dashPct(a, b) { return b ? Math.round((a / b) * 100) : 0; }
function dashDaysLabel(n) { return n === 1 ? "1 day" : n + " days"; }

// Estimates are free text in the frontmatter ("30m", "2h", "0.5d", "1w", "1mo").
// Returns null — never 0 — for anything unparseable, so a typo shows up as
// "N with no countable estimate" instead of quietly shrinking the queue.
// dashHours / dashSumHours / dashHoursLabel → estimate.mjs (BL-1412)
function dashBlNum(id) { return taskNum(id); }

// Completion day: \`updated\` when it is a real date, else \`created\` (imported
// tasks that were born done). Returns "" when neither parses.
function dashDoneDay(t) {
  const u = dashDay(t.updated);
  if (dashIsDay(u)) return u;
  const c = dashDay(t.created);
  return dashIsDay(c) ? c : "";
}

// The burndown's scope predicate lives here, not inside computeDashboard, so
// the day panel under the chart selects exactly the same tasks the chart counts.
function dashInScope(t, burn) {
  if (t.status === "cancelled") return false;
  const kind = (burn && burn.kind) || BURN_DEFAULT.kind;
  if (kind === "label") return (t.labels || []).includes(burn.value);
  if (kind === "epic") return t.epic === burn.value;
  if (kind === "board") return (t.board || "") === burn.value;
  // Abolishing the \`focus\` field (BL-1386) took the burndown's default axis away.
  // The new one comes from the configuration (dashboard_burndown_*) — without it
  // the axis would be empty and the chart would lie with a zero instead of admitting
  // that it is measuring nothing.
  return (t.labels || []).includes(BURN_DEFAULT.value);
}

const BURN_DEFAULT = CONFIG.dashboard.burndown;

function dashScopeLabel(burn) {
  const kind = (burn && burn.kind) || BURN_DEFAULT.kind;
  if (kind === "label" || kind === "epic" || kind === "board") return burn.value;
  return BURN_DEFAULT.value;
}

function computeDashboard(tasks, range, burn) {
  const today = dashToday();
  const phaseLabels = CONFIG.labelAxes.timing || [];
  const createdByDay = Object.create(null);
  const doneByDay = Object.create(null);
  let minDay = today;

  for (const t of tasks) {
    const c = dashDay(t.created);
    if (dashIsDay(c)) {
      createdByDay[c] = (createdByDay[c] || 0) + 1;
      if (c < minDay) minDay = c;
    }
    if (t.status === "done") {
      const d = dashDoneDay(t);
      if (d) {
        doneByDay[d] = (doneByDay[d] || 0) + 1;
        if (d < minDay) minDay = d;
      }
    }
  }

  // Day axis, hard-capped so a typo'd year (2062-…) cannot spin the loop.
  const days = [];
  if (dashIsDay(minDay)) {
    let k = minDay;
    for (let i = 0; i < 4000 && k <= today; i++) { days.push(k); k = dashAddDays(k, 1); }
  }

  let cc = 0, dc = 0;
  const series = days.map((d) => {
    cc += createdByDay[d] || 0;
    dc += doneByDay[d] || 0;
    return { day: d, created: createdByDay[d] || 0, done: doneByDay[d] || 0, cumCreated: cc, cumDone: dc };
  });

  // ── Date range ────────────────────────────────────────────────
  // The range governs FLOW — what happened between two dates. It deliberately
  // does NOT govern STOCK (how many tasks are open, how epics stand, how the
  // queue is distributed): a range-filtered "open" would answer a question
  // nobody asks ("how many of those created in July were open") while
  // looking exactly like the one everybody asks.
  const first = series.length ? series[0].day : today;
  const last = series.length ? series[series.length - 1].day : today;
  const clamp = (v, fallback) => {
    if (!dashIsDay(v)) return fallback;
    if (v < first) return first;
    if (v > last) return last;
    return v;
  };
  let from = clamp(range && range.from, first);
  let to = clamp(range && range.to, last);
  // A window that lies entirely outside the data would otherwise render as a
  // backwards label ("2026-05-23 → 2026-02-01") over three empty charts.
  if (from > to) from = to;
  const rangeSeries = series.filter((s) => s.day >= from && s.day <= to);
  const rangeDays = rangeSeries.length || 1;

  let doneRange = 0, newRange = 0;
  for (const s of rangeSeries) { doneRange += s.done; newRange += s.created; }

  // Lead time for tasks closed INSIDE the range, plus all-time as the fallback
  // when the range holds no closures — the card says which sample it drew.
  const leadAll = [], leadRange = [];
  for (const t of tasks) {
    if (t.status !== "done") continue;
    const c = dashDay(t.created), d = dashDoneDay(t);
    if (!dashIsDay(c) || !d) continue;
    const days = dashDiffDays(c, d);
    if (days < 0) continue;
    leadAll.push(days);
    if (d >= from && d <= to) leadRange.push(days);
  }

  // ── Burndown ──────────────────────────────────────────────────
  // Whatever the scope is — a timing label, an epic, a board — it is a CURRENT
  // field, not a history. Nothing in the frontmatter records when a task
  // entered or left the set. This reconstructs the past of TODAY'S set: a task
  // promoted yesterday is drawn as if it had been there since it was created,
  // and one removed from the set is absent from the whole line. Enough to see
  // whether the set is shrinking; not an audit of what it held in July.
  const scopeKind = (burn && burn.kind) || BURN_DEFAULT.kind;
  const scopeValue = burn && burn.value;
  const burnTasks = tasks.filter((t) => dashInScope(t, burn));
  const burnSeries = rangeSeries.map(function (s) {
    let scope = 0, remaining = 0;
    for (const t of burnTasks) {
      const c = dashDay(t.created);
      if (!dashIsDay(c) || c > s.day) continue;
      scope++;
      const dd = t.status === "done" ? dashDoneDay(t) : "";
      if (!dd || dd > s.day) remaining++;
    }
    return { day: s.day, scope: scope, remaining: remaining };
  });
  let burnClosedInRange = 0, burnAddedInRange = 0;
  for (const t of burnTasks) {
    const c = dashDay(t.created);
    if (dashIsDay(c) && c >= from && c <= to) burnAddedInRange++;
    if (t.status !== "done") continue;
    const dd = dashDoneDay(t);
    if (dd && dd >= from && dd <= to) burnClosedInRange++;
  }

  const byStatus = Object.create(null);
  const byPriority = Object.create(null);
  const byType = Object.create(null);
  const byOwner = Object.create(null);
  const byLabel = Object.create(null);
  const epics = new Map();

  for (const t of tasks) {
    const st = t.status || "—";
    byStatus[st] = (byStatus[st] || 0) + 1;
    if (DASH_OPEN.includes(st)) {
      byPriority[t.priority || "—"] = (byPriority[t.priority || "—"] || 0) + 1;
      byType[t.type || "—"] = (byType[t.type || "—"] || 0) + 1;
      byOwner[t.owner || "(nobody)"] = (byOwner[t.owner || "(nobody)"] || 0) + 1;
      for (const l of (t.labels || [])) byLabel[l] = (byLabel[l] || 0) + 1;
    }
    const key = t.epic || "";
    if (!epics.has(key)) {
      epics.set(key, { epic: key, total: 0, done: 0, open: 0, in_progress: 0, blocked: 0, p0: 0, p1: 0, last: "" });
    }
    const e = epics.get(key);
    e.total++;
    if (t.status === "done") e.done++;
    else if (t.status !== "cancelled") {
      e.open++;
      if (t.status === "in_progress") e.in_progress++;
      if (t.status === "blocked") e.blocked++;
      if (t.priority === "P0") e.p0++;
      if (t.priority === "P1") e.p1++;
    }
    const u = dashDay(t.updated);
    if (dashIsDay(u) && u > e.last) e.last = u;
  }

  const openTasks = tasks.filter((t) => DASH_OPEN.includes(t.status));
  const stale = openTasks
    .filter((t) => dashIsDay(dashDay(t.updated)))
    .map((t) => ({ t: t, age: dashDiffDays(dashDay(t.updated), today) }))
    .filter((x) => x.age >= 0)
    .sort((a, b) => b.age - a.age);

  const blocked = tasks.filter((t) => t.status === "blocked");

  // ── Aging: age from \`created\`, per priority. The "no movement" lists already
  // cover \`updated\`; this answers a different question — how long the queue
  // has been carrying a thing, not when it was last touched.
  const AGE_BUCKETS = [
    { label: "0–7 days", max: 7 },
    { label: "8–30 days", max: 30 },
    { label: "31–90 days", max: 90 },
    { label: "over 90 days", max: Infinity },
  ];
  const PRIOS = ["P0", "P1", "P2", "P3"];
  const aging = AGE_BUCKETS.map((b) => ({ label: b.label, total: 0, P0: 0, P1: 0, P2: 0, P3: 0 }));
  for (const t of openTasks) {
    const c = dashDay(t.created);
    const a = dashIsDay(c) ? dashDiffDays(c, today) : 0;
    let i = AGE_BUCKETS.findIndex((b) => a <= b.max);
    if (i < 0) i = AGE_BUCKETS.length - 1;
    aging[i].total++;
    if (PRIOS.includes(t.priority)) aging[i][t.priority]++;
  }

  // ── Hygiene: cheap invariants over the queue. Each one is a claim the
  // backlog makes about itself that its own fields contradict.
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const isClosed = (id) => {
    const o = byId.get(id);
    return !!o && (o.status === "done" || o.status === "cancelled");
  };
  const hygiene = [
    { key: "p0-untouched", label: "P0 untouched",
      hint: "A blocker nobody has started — the next section in NOW.yaml.",
      tasks: openTasks.filter((t) => t.priority === "P0" && t.status === "pending") },
    { key: "blocked-noreason", label: "status blocked bez blocked_by",
      hint: "The task declares it is blocked but does not say by what.",
      tasks: openTasks.filter((t) => t.status === "blocked" && !(t.blocked_by || []).length) },
    { key: "blocked-dead", label: "blocked_by points at a task already closed",
      hint: "The blocker is gone, the status does not know it.",
      tasks: openTasks.filter((t) => t.status === "blocked" && (t.blocked_by || []).length
        && (t.blocked_by || []).every(isClosed)) },
    { key: "blocked-unmarked", label: "a live blocker, but a status other than blocked",
      hint: "The task is stuck, and the queue counts it as ready to take.",
      tasks: openTasks.filter((t) => t.status !== "blocked"
        && (t.blocked_by || []).some((b) => byId.has(b) && !isClosed(b))) },
    { key: "unassigned", label: "owner: unassigned",
      hint: "Nobody is answerable for it — neither you nor an agent.",
      tasks: openTasks.filter((t) => !t.owner || t.owner === "unassigned") },
    { key: "no-epic", label: "no epic",
      hint: "It does not belong to any larger whole.",
      tasks: openTasks.filter((t) => !t.epic) },
    { key: "low-conf", label: "confidence: low",
      hint: "Not a defect — a planning risk. The estimates of these tasks may fall apart.",
      tasks: openTasks.filter((t) => t.confidence === "low") },
    { key: "no-estimate", label: "estimate cannot be counted",
      hint: "It drops out of the hours total below.",
      tasks: openTasks.filter((t) => estimateHours(t.estimate) == null) },
  ].filter((h) => h.tasks.length);

  // ── Queue in hours ────────────────────────────────────────────────
  const closedInRange = tasks.filter((t) => {
    if (t.status !== "done") return false;
    const dd = dashDoneDay(t);
    return dd && dd >= from && dd <= to;
  });
  const hoursOpen = sumHours(openTasks);
  const hoursDone = sumHours(closedInRange);
  const hoursBy = (pred) => sumHours(openTasks.filter(pred)).hours;

  return {
    today: today,
    tasks: tasks,
    series: series,
    total: tasks.length,
    doneCount: tasks.filter((t) => t.status === "done").length,
    cancelled: tasks.filter((t) => t.status === "cancelled").length,
    open: openTasks.length,
    inProgress: tasks.filter((t) => t.status === "in_progress").length,
    blockedCount: blocked.length,
    blocked: blocked,
    p0Open: openTasks.filter((t) => t.priority === "P0").length,
    p1Open: openTasks.filter((t) => t.priority === "P1").length,
    // The breakdowns are computed PER VALUE from the vocabulary, not per value
    // hardcoded in the code (BL-1400): a project with no "phase" axis gets an
    // empty object rather than counters for somebody else's labels.
    openByPhase: phaseLabels.reduce(function (acc, l) {
      acc[l] = openTasks.filter((t) => (t.labels || []).includes(l)).length;
      return acc;
    }, {}),
    from: from, to: to, rangeDays: rangeDays, rangeSeries: rangeSeries,
    fullFrom: first, fullTo: last,
    doneRange: doneRange, newRange: newRange,
    burnSeries: burnSeries,
    burnTotal: burnTasks.length,
    burnRemaining: burnTasks.filter((t) => t.status !== "done").length,
    burnClosedInRange: burnClosedInRange,
    burnAddedInRange: burnAddedInRange,
    leadMedianAll: dashMedian(leadAll),
    leadMedianRange: dashMedian(leadRange),
    leadRangeCount: leadRange.length,
    leadAllCount: leadAll.length,
    scopeKind: scopeKind, scopeValue: scopeValue,
    aging: aging,
    hygiene: hygiene,
    hoursOpen: hoursOpen.hours,
    hoursUnknown: hoursOpen.unknown,
    hoursDoneRange: hoursDone.hours,
    hoursByPhase: phaseLabels.reduce(function (acc, l) {
      acc[l] = hoursBy((t) => (t.labels || []).includes(l));
      return acc;
    }, {}),
    hoursP0: hoursBy((t) => t.priority === "P0"),
    hoursP1: hoursBy((t) => t.priority === "P1"),
    hoursLowConf: hoursBy((t) => t.confidence === "low"),
    hoursByType: (CONFIG.types || []).reduce(function (acc, ty) {
      acc[ty] = hoursBy((t) => t.type === ty);
      return acc;
    }, {}),
    leadBuckets: dashLeadBuckets(leadRange.length ? leadRange : leadAll),
    leadBucketsFrom: leadRange.length ? "the range" : "the whole history",
    byStatus: byStatus, byPriority: byPriority, byType: byType, byOwner: byOwner, byLabel: byLabel,
    epics: [...epics.values()],
    stale: stale,
  };
}

function dashLeadBuckets(vals) {
  const defs = [
    ["0–1 days", function (v) { return v <= 1; }],
    ["2–3 days", function (v) { return v >= 2 && v <= 3; }],
    ["4–7 days", function (v) { return v >= 4 && v <= 7; }],
    ["8–14 days", function (v) { return v >= 8 && v <= 14; }],
    ["15–30 days", function (v) { return v >= 15 && v <= 30; }],
    ["31+ days", function (v) { return v > 30; }],
  ];
  return defs.map(function (d) {
    return { label: d[0], count: vals.filter(d[1]).length };
  });
}

// ─── Small SVG chart helpers (no libraries — the file must stay offline) ──
function dashPolyline(points, color, width, dash) {
  return '<polyline fill="none" stroke="' + color + '" stroke-width="' + width + '"'
    + (dash ? ' stroke-dasharray="' + dash + '"' : "")
    + ' stroke-linejoin="round" stroke-linecap="round" points="' + points + '"></polyline>';
}

function dashTimeTicks(days, x, H) {
  let out = "";
  const label = (i, text) => '<text x="' + x(i).toFixed(1) + '" y="' + (H - 8)
    + '" font-size="10" fill="var(--fg-muted)" text-anchor="middle">' + text + "</text>";
  if (days.length <= 70) {
    const every = Math.max(1, Math.round(days.length / 8));
    for (let i = 0; i < days.length; i += every) out += label(i, days[i].slice(5));
    return out;
  }
  let lastMonth = "";
  for (let i = 0; i < days.length; i++) {
    const m = days[i].slice(0, 7);
    if (m !== lastMonth) { lastMonth = m; out += label(i, m); }
  }
  return out;
}

// ─── Chart hover ──────────────────────────────────────────────────────
// Each chart ships the pixel positions the builder already computed alongside
// the values behind them. The hover code recomputes no scales: a second
// implementation of the same mapping is a second chance to disagree with the
// picture on screen — the tooltip would confidently name a point the line is
// not drawn through.
function dashHoverLayer(p) {
  const dots = p.series.map(function (sr, i) {
    return sr.y
      ? '<circle class="hover-dot" data-dot="' + i + '" r="3.5" fill="' + sr.color + '" cx="-99" cy="-99"></circle>'
      : "";
  }).join("");
  return '<g class="chart-hover" opacity="0" pointer-events="none">'
    + '<rect class="hover-band" x="-99" y="' + p.top + '" width="0" height="' + (p.bottom - p.top) + '"></rect>'
    + '<line class="hover-line" x1="-99" x2="-99" y1="' + p.top + '" y2="' + p.bottom + '"></line>'
    + dots
    + "</g>"
    + '<rect class="hover-capture" x="' + p.left + '" y="' + p.top + '" width="' + (p.right - p.left)
    + '" height="' + (p.bottom - p.top) + '" fill="transparent"></rect>';
}

function dashPinDay(pin) {
  const same = state.dashDay && pin && state.dashDay.day === pin.day && state.dashDay.source === pin.source;
  state.dashDay = same ? null : pin;   // clicking the same point again closes it
  renderDashboard();
  if (state.dashDay) {
    const panel = document.querySelector("#dashboardView .day-panel");
    if (panel) panel.scrollIntoView({ block: "nearest" });
  }
}

function dashHoverHide() {
  const tip = document.getElementById("chartTip");
  if (tip) tip.hidden = true;
  for (const g of document.querySelectorAll("#dashboardView .chart-hover")) g.setAttribute("opacity", "0");
}

// One lookup for both hover and click: if they resolved the index separately,
// clicking could open a different day than the tooltip under the cursor names.
function dashChartPointAt(target, clientX) {
  const svg = target && target.closest ? target.closest("svg.dash-chart") : null;
  if (!svg || !svg.dataset.chart) return null;
  const p = svg.chartPayload || (svg.chartPayload = JSON.parse(svg.dataset.chart));
  const box = svg.getBoundingClientRect();
  if (!box.width || !p.x.length) return null;
  // Viewport px → viewBox units. The SVG scales with the card, so the ratio has
  // to be read live rather than assumed to be 1.
  const vx = (clientX - box.left) * (p.W / box.width);
  let idx = 0, best = Infinity;
  for (let i = 0; i < p.x.length; i++) {
    const dx = Math.abs(p.x[i] - vx);
    if (dx < best) { best = dx; idx = i; }
  }
  return { svg: svg, p: p, idx: idx };
}

function dashHoverMove(e) {
  const hit = dashChartPointAt(e.target, e.clientX);
  if (!hit) { dashHoverHide(); return; }
  const svg = hit.svg, p = hit.p, idx = hit.idx;
  const cx = p.x[idx];

  // Clear the other charts, or the crosshair you left behind on one keeps
  // pointing at a day you are no longer reading.
  const g = svg.querySelector(".chart-hover");
  for (const other of document.querySelectorAll("#dashboardView .chart-hover")) {
    if (other !== g) other.setAttribute("opacity", "0");
  }
  g.setAttribute("opacity", "1");
  const band = g.querySelector(".hover-band");
  const line = g.querySelector(".hover-line");
  if (p.band) {
    band.setAttribute("x", (cx - p.band / 2).toFixed(1));
    band.setAttribute("width", p.band.toFixed(1));
    line.setAttribute("opacity", "0");
  } else {
    band.setAttribute("width", "0");
    line.setAttribute("opacity", "1");
    line.setAttribute("x1", cx.toFixed(1));
    line.setAttribute("x2", cx.toFixed(1));
  }
  for (const dot of g.querySelectorAll(".hover-dot")) {
    const sr = p.series[Number(dot.dataset.dot)];
    dot.setAttribute("cx", cx.toFixed(1));
    dot.setAttribute("cy", sr.y[idx]);
  }

  let rows = "";
  for (const sr of p.series) {
    rows += '<div class="tip-row"><i style="background:' + sr.color + '"></i><span>'
      + escape(sr.label) + "</span><strong>" + sr.values[idx] + "</strong></div>";
  }
  const tip = document.getElementById("chartTip");
  tip.innerHTML = '<div class="tip-day">' + escape(p.days[idx]) + "</div>" + rows
    + (p.foot ? '<div class="tip-foot">' + escape(p.foot[idx]) + "</div>" : "");
  tip.hidden = false;

  // Flip the box rather than let it run off the viewport edge.
  let left = e.clientX + 14;
  let top = e.clientY - tip.offsetHeight - 12;
  if (left + tip.offsetWidth > window.innerWidth - 8) left = e.clientX - tip.offsetWidth - 14;
  if (top < 8) top = e.clientY + 18;
  tip.style.left = Math.max(8, left) + "px";
  tip.style.top = top + "px";
}

function dashCumulativeChart(series) {
  if (series.length < 2) return '<p class="dash-empty">Too few days with data to draw a trend.</p>';
  const W = 900, H = 280, padL = 46, padR = 12, padT = 12, padB = 26;
  // A sliced range can open at 800 created / 600 closed. Anchoring the axis at
  // zero would squash the whole window into the top sliver and hide the very
  // movement the range was chosen to look at.
  const maxY = Math.max(series[series.length - 1].cumCreated, 1);
  const minY = Math.max(0, Math.floor(series[0].cumDone * 0.98));
  const span = Math.max(1, maxY - minY);
  const x = (i) => padL + (i * (W - padL - padR)) / (series.length - 1);
  const y = (v) => H - padB - ((v - minY) * (H - padT - padB)) / span;

  let created = "", done = "";
  for (let i = 0; i < series.length; i++) {
    created += x(i).toFixed(1) + "," + y(series[i].cumCreated).toFixed(1) + " ";
    done += x(i).toFixed(1) + "," + y(series[i].cumDone).toFixed(1) + " ";
  }
  // Open backlog = the gap between the two lines, drawn as a filled band.
  let band = created + " ";
  for (let i = series.length - 1; i >= 0; i--) {
    band += x(i).toFixed(1) + "," + y(series[i].cumDone).toFixed(1) + " ";
  }

  let grid = "", ticks = "";
  const steps = 4;
  for (let s = 0; s <= steps; s++) {
    const v = minY + Math.round((span / steps) * s);
    grid += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1)
      + '" stroke="var(--border)" stroke-width="1"></line>';
    grid += '<text x="' + (padL - 8) + '" y="' + (y(v) + 4).toFixed(1)
      + '" font-size="11" fill="var(--fg-muted)" text-anchor="end">' + v + "</text>";
  }
  ticks += dashTimeTicks(series.map((p) => p.day), x, H);

  const hover = {
    source: "cumulative",
    W: W, top: padT, bottom: H - padB, left: padL, right: W - padR,
    days: series.map((p) => p.day),
    x: series.map((_, i) => +x(i).toFixed(1)),
    series: [
      { label: "created", color: "var(--fg-muted)", values: series.map((p) => p.cumCreated),
        y: series.map((p) => +y(p.cumCreated).toFixed(1)) },
      { label: "completed", color: "var(--status-done)", values: series.map((p) => p.cumDone),
        y: series.map((p) => +y(p.cumDone).toFixed(1)) },
      { label: "open", color: "var(--accent)", values: series.map((p) => p.cumCreated - p.cumDone) },
    ],
      foot: series.map((p) => "that day: +" + p.created + " new, " + p.done + " closed"),
  };

  return '<svg class="dash-chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Backlog over time"'
    + ' data-chart="' + escape(JSON.stringify(hover)) + '">'
    + grid
    + '<polygon fill="var(--accent)" opacity="0.10" points="' + band + '"></polygon>'
    + dashPolyline(created, "var(--fg-muted)", 2)
    + dashPolyline(done, "var(--status-done)", 2)
    + ticks
    + dashHoverLayer(hover)
    + "</svg>";
}

function dashBurnChart(fseries) {
  if (fseries.length < 2) return '<p class="dash-empty">Too few days in the range to draw a burndown.</p>';
  const W = 900, H = 240, padL = 40, padR = 12, padT = 12, padB = 26;
  let maxY = 1;
  for (const p of fseries) if (p.scope > maxY) maxY = p.scope;
  const x = (i) => padL + (i * (W - padL - padR)) / (fseries.length - 1);
  const y = (v) => H - padB - (v * (H - padT - padB)) / maxY;

  let scope = "", remaining = "";
  for (let i = 0; i < fseries.length; i++) {
    scope += x(i).toFixed(1) + "," + y(fseries[i].scope).toFixed(1) + " ";
    remaining += x(i).toFixed(1) + "," + y(fseries[i].remaining).toFixed(1) + " ";
  }
  const area = remaining + x(fseries.length - 1).toFixed(1) + "," + y(0).toFixed(1) + " " + x(0).toFixed(1) + "," + y(0).toFixed(1);

  let grid = "";
  const steps = Math.min(4, maxY);
  for (let st = 0; st <= steps; st++) {
    const v = Math.round((maxY / steps) * st);
    grid += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1)
      + '" stroke="var(--border)" stroke-width="1"></line>'
      + '<text x="' + (padL - 8) + '" y="' + (y(v) + 4).toFixed(1)
      + '" font-size="11" fill="var(--fg-muted)" text-anchor="end">' + v + "</text>";
  }
  const ticks = dashTimeTicks(fseries.map((p) => p.day), x, H);

  const hover = {
    source: "burn",
    W: W, top: padT, bottom: H - padB, left: padL, right: W - padR,
    days: fseries.map((p) => p.day),
    x: fseries.map((_, i) => +x(i).toFixed(1)),
    series: [
      { label: "left to do", color: "var(--accent)", values: fseries.map((p) => p.remaining),
        y: fseries.map((p) => +y(p.remaining).toFixed(1)) },
      { label: "scope (created)", color: "var(--fg-muted)", values: fseries.map((p) => p.scope),
        y: fseries.map((p) => +y(p.scope).toFixed(1)) },
    ],
      foot: fseries.map((p) => "closed by that day: " + (p.scope - p.remaining)),
  };

  return '<svg class="dash-chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Burndown of the selected range"'
    + ' data-chart="' + escape(JSON.stringify(hover)) + '">'
    + grid
    + '<polygon fill="var(--accent)" opacity="0.12" points="' + area + '"></polygon>'
    + dashPolyline(scope, "var(--fg-muted)", 2, "4 3")
    + dashPolyline(remaining, "var(--accent)", 2)
    + ticks
    + dashHoverLayer(hover)
    + "</svg>";
}

function dashDailyChart(slice) {
  if (!slice.length) return '<p class="dash-empty">No daily data.</p>';
  const W = 900, H = 220, padL = 30, padR = 10, padT = 16, padB = 22;
  const maxUp = Math.max.apply(null, slice.map((d) => d.done).concat([1]));
  const maxDown = Math.max.apply(null, slice.map((d) => d.created).concat([1]));
  // ONE scale for both halves. Scaling each half to its own max would draw a
  // 5-task day and a 40-task day as the same bar height on opposite sides —
  // exactly the comparison this chart exists to make.
  const scale = (H - padT - padB) / (maxUp + maxDown);
  const upH = maxUp * scale, downH = maxDown * scale;
  const mid = padT + upH;
  const bw = (W - padL - padR) / slice.length;

  let bars = "";
  for (let i = 0; i < slice.length; i++) {
    const d = slice[i];
    const bx = padL + i * bw + bw * 0.12;
    const w = Math.max(1.5, bw * 0.76);
    if (d.done) {
      const h = (d.done / maxUp) * upH;
      bars += '<rect x="' + bx.toFixed(1) + '" y="' + (mid - h).toFixed(1) + '" width="' + w.toFixed(1)
        + '" height="' + h.toFixed(1) + '" fill="var(--status-done)" rx="1"></rect>';
    }
    if (d.created) {
      const h = (d.created / maxDown) * downH;
      bars += '<rect x="' + bx.toFixed(1) + '" y="' + mid + '" width="' + w.toFixed(1)
        + '" height="' + h.toFixed(1) + '" fill="var(--fg-muted)" opacity="0.55" rx="1"></rect>';
    }
  }
  let ticks = "";
  const every = Math.max(1, Math.round(slice.length / 10));
  for (let i = 0; i < slice.length; i += every) {
    ticks += '<text x="' + (padL + i * bw + bw / 2).toFixed(1) + '" y="' + (H - 6)
      + '" font-size="10" fill="var(--fg-muted)" text-anchor="middle">' + slice[i].day.slice(5) + "</text>";
  }
  const hover = {
    source: "daily",
    W: W, top: padT, bottom: H - padB, left: padL, right: W - padR,
    band: bw,
    days: slice.map((d) => d.day),
    x: slice.map((_, i) => +(padL + i * bw + bw / 2).toFixed(1)),
    series: [
      { label: "completed", color: "var(--status-done)", values: slice.map((d) => d.done) },
      { label: "new", color: "var(--fg-muted)", values: slice.map((d) => d.created) },
    ],
    foot: slice.map((d) => "balance for the day: " + (d.created - d.done > 0 ? "+" : "") + (d.created - d.done)),
  };

  return '<svg class="dash-chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Day by day"'
    + ' data-chart="' + escape(JSON.stringify(hover)) + '">'
    + '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + mid + '" y2="' + mid + '" stroke="var(--border)" stroke-width="1"></line>'
    + '<text x="4" y="' + (mid - upH) + '" font-size="10" fill="var(--fg-muted)">' + maxUp + "</text>"
    + '<text x="4" y="' + (mid + downH) + '" font-size="10" fill="var(--fg-muted)">' + maxDown + "</text>"
    + bars + ticks + dashHoverLayer(hover) + "</svg>";
}

function dashBars(rows, filterKey, sortId, defKey) {
  if (!rows.length) return '<p class="dash-empty">No data.</p>';
  let bar = "";
  if (sortId) {
    const def = { key: defKey || "value", dir: defKey === "name" ? "asc" : "desc" };
    bar = dashSortBar(sortId, BAR_COLUMNS, def);
    rows = dashSortItems(rows, sortId, BAR_COLUMNS, def, (a, b) => String(a.label).localeCompare(String(b.label)));
  }
  const max = Math.max.apply(null, rows.map((r) => r.count));
  return bar + '<div class="bars">' + rows.map(function (r) {
    const w = max ? Math.max(2, Math.round((r.count / max) * 100)) : 0;
    const color = r.color || "var(--accent)";
    const attrs = filterKey
      ? ' data-dash-filter="' + escape(filterKey) + '" data-dash-value="' + escape(r.value != null ? r.value : r.label) + '" title="Show in the task list"'
      : ' style="cursor:default"';
    return '<button type="button" class="bar-row"' + attrs + '>'
      + '<span class="bar-label">' + escape(r.label) + "</span>"
      + '<span class="bar-track"><span class="bar-fill" style="width:' + w + "%;background:" + color + '"></span></span>'
      + '<span class="bar-value">' + r.count + "</span>"
      + "</button>";
  }).join("") + "</div>";
}

/** The meta line of the "P0/P1" KPI: a breakdown by the phase axis, if the project has one. */
function dashPhaseMeta(d) {
  const parts = Object.keys(d.openByPhase).map((l) => d.openByPhase[l] + " " + l);
  return parts.join(" · ");
}

/**
 * A sentence about how the queue splits across kinds of work. Until BL-1400 it
 * spoke outright about one project's own types; now it describes the types the
 * project really has, and stays silent when there is nothing to describe.
 */
function dashTypeSentence(d) {
  const types = Object.keys(d.hoursByType).filter((ty) => d.hoursByType[ty] > 0);
  if (!types.length) return "";
  return types.map((ty) => "<strong>" + hoursLabel(d.hoursByType[ty]) + "</strong> to <code>" + escape(ty) + "</code>").join(", ") + ".";
}

function dashKpi(label, value, meta, color) {
  return '<div class="kpi"><div class="kpi-label">' + escape(label) + "</div>"
    + '<div class="kpi-value"' + (color ? ' style="color:' + color + '"' : "") + ">" + value + "</div>"
    + '<div class="kpi-meta">' + (meta || "&nbsp;") + "</div></div>";
}

function dashTaskLine(t, right) {
  return "<li>"
    + '<span class="dash-id">' + escape(t.id) + "</span>"
    + '<a data-dash-task="' + escape(t.id) + '">' + escape(t.title) + "</a>"
    + '<span class="dash-age">' + right + "</span></li>";
}

const DASH_PRESETS = [
  { key: "30", label: "30 days", days: 30 },
  { key: "60", label: "60 days", days: 60 },
  { key: "90", label: "90 days", days: 90 },
  { key: "all", label: "Whole history", days: null },
];
const DASH_RANGE_STORE = "origin-backlog-dash-range";

function dashLoadRange() {
  try {
    const raw = localStorage.getItem(DASH_RANGE_STORE);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object") return null;
    return { preset: p.preset || "all", from: p.from || null, to: p.to || null };
  } catch (e) { return null; }
}
function dashSaveRange() {
  try { localStorage.setItem(DASH_RANGE_STORE, JSON.stringify(state.dashRange)); } catch (e) { /* private mode */ }
}

function dashSetPreset(key) {
  const p = DASH_PRESETS.find((x) => x.key === key);
  if (!p) return;
  state.dashRange = p.days
    ? { preset: key, from: dashAddDays(dashToday(), -(p.days - 1)), to: null }
    : { preset: "all", from: null, to: null };
  dashSaveRange();
  renderDashboard();
}

function dashSetBound(which, value) {
  const v = dashIsDay(value) ? value : null;
  const next = {
    preset: "custom",
    from: which === "from" ? v : state.dashRange.from,
    to: which === "to" ? v : state.dashRange.to,
  };
  // A reversed range would silently render an empty dashboard; swap instead.
  if (next.from && next.to && next.from > next.to) {
    const tmp = next.from; next.from = next.to; next.to = tmp;
  }
  state.dashRange = next;
  dashSaveRange();
  renderDashboard();
}

function dashRangeBar(d) {
  const presets = DASH_PRESETS.map(function (p) {
    const active = state.dashRange.preset === p.key ? " is-active" : "";
    return '<button type="button" class="range-preset' + active + '" data-range-preset="' + p.key + '">' + p.label + "</button>";
  }).join("");
  const custom = state.dashRange.preset === "custom" ? " is-active" : "";
  return '<div class="range-bar">'
    + '<span class="range-title">Date range</span>'
    + '<span class="range-presets">' + presets + '<span class="range-preset' + custom + '" data-range-custom>Custom</span></span>'
    + '<label class="range-field">from <input type="date" data-range-input="from" value="' + escape(d.from) + '" min="' + escape(d.fullFrom) + '" max="' + escape(d.fullTo) + '"></label>'
    + '<label class="range-field">to <input type="date" data-range-input="to" value="' + escape(d.to) + '" min="' + escape(d.fullFrom) + '" max="' + escape(d.fullTo) + '"></label>'
    + '<span class="range-meta">' + dashDaysLabel(d.rangeDays) + " · " + escape(d.from) + " → " + escape(d.to) + "</span>"
    + '<span class="range-hint">The range measures <strong>flow</strong> (the charts, throughput, lead time). <strong>State</strong> — open tasks, epics, distributions — is always current.</span>'
    + "</div>";
}

// Tasks behind one point on a chart. Same two definitions the charts are drawn
// from — created day, and "closed" as status done + updated — so the list can
// never show a different count than the bar above it.
function dashDayPanel(day, source) {
  const onlyBurn = source === "burn";
  const pick = (t) => !onlyBurn || dashInScope(t, state.dashBurn);
  const created = TASKS.filter((t) => pick(t) && dashDay(t.created) === day);
  const closed = TASKS.filter((t) => pick(t) && t.status === "done" && dashDoneDay(t) === day);
  const daySort = { key: "id", dir: "asc" };
  const sortTasks = (list) => dashSortItems(list, "dayPanel", TASK_COLUMNS, daySort,
    (a, b) => dashBlNum(a.id) - dashBlNum(b.id));

  const list = (tasks, empty) => tasks.length
    ? '<ul class="dash-list">' + tasks.map(function (t) {
        return "<li>"
          + '<span class="dash-id">' + escape(t.id) + "</span>"
          + '<a data-dash-task="' + escape(t.id) + '">' + escape(t.title) + "</a>"
          + '<span class="dash-age"><span class="badge" style="background:var(--status-' + escape(t.status || "pending")
          + ');color:#fff">' + escape(t.status || "—") + "</span> " + escape(t.priority || "") + "</span>"
          + "</li>";
      }).join("") + "</ul>"
    : '<p class="dash-empty">' + empty + "</p>";

  const sortedCreated = sortTasks(created);
  const sortedClosed = sortTasks(closed);

  return '<div class="dash-grid wide"><div class="dash-card day-panel">'
    + '<button type="button" class="day-close" data-dash-day-close aria-label="Close">✕</button>'
    + "<h2>" + escape(day) + (onlyBurn ? " — " + escape(dashScopeLabel(state.dashBurn)) : "") + "</h2>"
    + '<p class="dash-sub">' + created.length + " created · " + closed.length + " closed"
    + (onlyBurn ? " (range only: " + escape(dashScopeLabel(state.dashBurn)) + ")" : "") + ". Click a title to open the task.</p>"
    + dashSortBar("dayPanel", TASK_COLUMNS, daySort)
    + '<div class="day-cols">'
    + "<div><h3>Created (" + created.length + ")</h3>" + list(sortedCreated, "Nothing was created that day.") + "</div>"
    + "<div><h3>Closed (" + closed.length + ")</h3>" + list(sortedClosed, "Nothing was closed that day.") + "</div>"
    + "</div>"
    + '<p class="dash-note">"Closed that day" means <code>status: done</code> plus an <code>updated</code> with that date. '
    + "A task edited after being closed moves to a later day — here and on the chart alike.</p>"
    + "</div></div>";
}

function dashDayPanelFor(source, from, to) {
  if (!state.dashDay || state.dashDay.source !== source) return "";
  // A pinned day outside the current range would sit under a chart that no
  // longer draws it.
  if (state.dashDay.day < from || state.dashDay.day > to) return "";
  return dashDayPanel(state.dashDay.day, source);
}

const DASH_BURN_STORE = "origin-backlog-dash-burn";

function dashLoadBurn() {
  try {
    const raw = localStorage.getItem(DASH_BURN_STORE);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object" || !p.kind) return null;
    return { kind: p.kind, value: p.value || null };
  } catch (e) { return null; }
}

function dashSetBurn(kind, value) {
  state.dashBurn = { kind: kind, value: value || null };
  try { localStorage.setItem(DASH_BURN_STORE, JSON.stringify(state.dashBurn)); } catch (e) { /* private mode */ }
  // A day pinned from the previous scope would keep showing that scope's tasks.
  if (state.dashDay && state.dashDay.source === "burn") state.dashDay = null;
  renderDashboard();
}

function dashBurnScopeBar(d) {
  const b = state.dashBurn || BURN_DEFAULT;
  const btn = (kind, value, label) => {
    const on = b.kind === kind && b.value === value;
    return '<button type="button" class="range-preset' + (on ? " is-active" : "") + '"'
      + ' data-burn-kind="' + kind + '" data-burn-value="' + escape(value || "") + '">' + escape(label) + "</button>";
  };
  const epics = d.epics
    .filter((e) => e.epic && e.open > 0)
    .sort((a, c) => c.open - a.open)
    .map((e) => '<option value="' + escape(e.epic) + '"' + (b.kind === "epic" && b.value === e.epic ? " selected" : "")
      + ">" + escape(e.epic) + " (" + e.open + ")</option>")
    .join("");
  return '<div class="burn-bar">'
    + '<span class="range-title">Burndown scope</span>'
    + '<span class="range-presets">'
    + (CONFIG.labelAxes.timing || []).map((l) => btn("label", l, l)).join("")
    + knownBoards().map((bd) => btn("board", bd.slug, bd.name)).join("")
    + "</span>"
    + '<label class="range-field">epic <select data-burn-epic><option value="">— pick one —</option>' + epics + "</select></label>"
    + "</div>";
}

// ─── Sorting, once, for every listing on the dashboard ──────────────
// A column declares its label, its value accessor and the direction it opens
// in. Header, comparator and cell therefore cannot drift into disagreeing
// about what "Blok." means, and the eight listings below cannot drift into
// eight slightly different sorting behaviours.
//
// A column with no \`get\` is the natural order — whatever order the caller
// built the rows in (lifecycle for statuses, P0→P3 for priorities, age buckets
// ascending). Sorting it "ascending" reverses that order rather than inventing
// a comparator for it.
const DASH_SORT_SPECS = {};   // id → { cols, def }; rebuilt on every render

function dashSortFor(id, def) {
  return state.dashSorts[id] || def;
}

function dashRegisterSort(id, cols, def) {
  DASH_SORT_SPECS[id] = { cols: cols, def: def };
  return dashSortFor(id, def);
}

function dashSetSort(id, key) {
  const spec = DASH_SORT_SPECS[id];
  if (!spec) return;
  const col = spec.cols.find((c) => c.key === key);
  const cur = dashSortFor(id, spec.def);
  state.dashSorts[id] = cur.key === key
    ? { key: key, dir: cur.dir === "asc" ? "desc" : "asc" }
    : { key: key, dir: (col && col.dir) || "desc" };
  renderDashboard();
}

function dashSortItems(items, id, cols, def, tie) {
  const cur = dashRegisterSort(id, cols, def);
  const col = cols.find((c) => c.key === cur.key);
  if (!col || !col.get) return cur.dir === "asc" ? items.slice().reverse() : items.slice();
  const dir = cur.dir === "asc" ? 1 : -1;
  return items.slice().sort(function (a, b) {
    const va = col.get(a), vb = col.get(b);
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    // Ties resolved deterministically, or rows with equal counts would swap
    // places between renders for no visible reason.
    return tie ? tie(a, b) : 0;
  });
}

function dashSortArrow(cur, key) {
  return cur.key === key ? (cur.dir === "asc" ? " ▲" : " ▼") : "";
}

function dashTableHead(id, cols, def) {
  const cur = dashRegisterSort(id, cols, def);
  return cols.map(function (c) {
    const on = cur.key === c.key;
    return "<th" + (c.num ? ' class="num"' : "")
      + (on ? ' aria-sort="' + (cur.dir === "asc" ? "ascending" : "descending") + '"' : "") + ">"
      + '<button type="button" class="th-sort' + (on ? " is-active" : "") + '" data-sort-id="' + escape(id)
      + '" data-sort-key="' + escape(c.key) + '">' + escape(c.label) + dashSortArrow(cur, c.key) + "</button></th>";
  }).join("");
}

function dashSortBar(id, cols, def) {
  const cur = dashRegisterSort(id, cols, def);
  return '<div class="sort-bar"><span>sort:</span>' + cols.map(function (c) {
    const on = cur.key === c.key;
    return '<button type="button" class="sort-btn' + (on ? " is-active" : "") + '" data-sort-id="' + escape(id)
      + '" data-sort-key="' + escape(c.key) + '">' + escape(c.label) + dashSortArrow(cur, c.key) + "</button>";
  }).join("") + "</div>";
}

const EPIC_COLUMNS = [
  { key: "epic", label: "Epic", num: false, dir: "asc", get: (e) => (e.epic || "").toLowerCase() },
  { key: "pct", label: "Progress", num: false, dir: "desc", get: (e) => dashPct(e.done, e.total) },
  { key: "total", label: "Total", num: true, dir: "desc", get: (e) => e.total },
  { key: "done", label: "Done", num: true, dir: "desc", get: (e) => e.done },
  { key: "open", label: "Open", num: true, dir: "desc", get: (e) => e.open },
  { key: "in_progress", label: "In progress", num: true, dir: "desc", get: (e) => e.in_progress },
  { key: "blocked", label: "Blocked", num: true, dir: "desc", get: (e) => e.blocked },
  { key: "p0", label: "P0", num: true, dir: "desc", get: (e) => e.p0 },
  { key: "p1", label: "P1", num: true, dir: "desc", get: (e) => e.p1 },
  { key: "last", label: "Last movement", num: true, dir: "desc", get: (e) => e.last || "" },
];
const EPIC_SORT_DEF = { key: "open", dir: "desc" };

// Rows for a bar list: their own order, their value, or their label.
const BAR_COLUMNS = [
  { key: "natural", label: "order" },
  { key: "value", label: "value", dir: "desc", get: (r) => r.count },
  { key: "name", label: "name", dir: "asc", get: (r) => String(r.label).toLowerCase() },
];

// Attention lists carry { t, age }; blocked rows have no age.
const ATTN_COLUMNS = [
  { key: "age", label: "age", dir: "desc", get: (x) => (x.age == null ? -1 : x.age) },
  { key: "id", label: "ID", dir: "asc", get: (x) => dashBlNum(x.t.id) },
  { key: "prio", label: "priority", dir: "asc", get: (x) => x.t.priority || "P9" },
];
const BLOCKED_COLUMNS = [
  { key: "id", label: "ID", dir: "asc", get: (x) => dashBlNum(x.t.id) },
  { key: "prio", label: "priority", dir: "asc", get: (x) => x.t.priority || "P9" },
  { key: "blockers", label: "number of blockers", dir: "desc", get: (x) => (x.t.blocked_by || []).length },
];
const TASK_COLUMNS = [
  { key: "id", label: "ID", dir: "asc", get: (t) => dashBlNum(t.id) },
  { key: "prio", label: "priority", dir: "asc", get: (t) => t.priority || "P9" },
  { key: "status", label: "status", dir: "asc", get: (t) => t.status || "" },
];

const AGING_COLUMNS = [
  { key: "natural", label: "Age" },
  { key: "P0", label: "P0", num: true, dir: "desc", get: (r) => r.P0 },
  { key: "P1", label: "P1", num: true, dir: "desc", get: (r) => r.P1 },
  { key: "P2", label: "P2", num: true, dir: "desc", get: (r) => r.P2 },
  { key: "P3", label: "P3", num: true, dir: "desc", get: (r) => r.P3 },
  { key: "total", label: "Total", num: true, dir: "desc", get: (r) => r.total },
];

function renderDashboard() {
  const el = document.getElementById("dashboardView");
  if (!el) return;
  const d = computeDashboard(TASKS, state.dashRange, state.dashBurn);
  const netFlow = d.newRange - d.doneRange;
  const pace = d.doneRange / d.rangeDays;
  const eta = netFlow < 0 ? Math.ceil(d.open / (-netFlow / d.rangeDays)) : null;
  const burnPace = d.burnClosedInRange / d.rangeDays;
  const burnEta = burnPace > 0 ? Math.ceil(d.burnRemaining / burnPace) : null;

  // ── Board scope ──────────────────────────────────────────────────
  // EVERY number below is computed from TASKS, that is, from the current scope.
  // Without this bar a board's dashboard and the whole backlog's dashboard look
  // identical while differing in everything — that is the entire reason a board is
  // a scope rather than a filter beside Epic.
  let scopeBar = "";
  if (state.board !== BOARD_ALL) {
    scopeBar = '<div class="dash-scope">Scope: <strong>' + escape(boardLabel(state.board)) + "</strong>"
      + " — " + TASKS.length + " of " + ALL_TASKS.length + " tasks. "
      + '<button type="button" class="btn-action" data-board-scope="' + BOARD_ALL + '">Show every board</button></div>';
  } else if (knownBoards().length > 1) {
    scopeBar = '<div class="dash-scope">Scope: <strong>every board</strong> — the numbers sum '
      + knownBoards().map(function (b) {
          return '<button type="button" class="board-btn" data-board-scope="' + escape(b.slug) + '">'
            + escape(b.name) + ' <span class="board-count">'
            + ALL_TASKS.filter(function (t) { return (t.board || "") === b.slug; }).length + "</span></button>";
        }).join(" ")
      + "</div>";
  }

  // ── Range bar + KPI row ──────────────────────────────────────────
  let html = scopeBar + dashRangeBar(d) + '<div class="kpi-row">'
    + dashKpi("All tasks", d.total, escape(String(d.doneCount)) + " done · " + d.cancelled + " cancelled")
    + dashKpi("Open", d.open, dashPct(d.doneCount, d.total) + "% of the backlog closed")
    + dashKpi("In progress", d.inProgress, d.inProgress > 10 ? "too many at once — NOW.yaml warns about it" : "the in_progress section in NOW.yaml", "var(--status-in_progress)")
    + dashKpi("Blocked", d.blockedCount, d.blockedCount ? "waiting to be unblocked" : "clear", d.blockedCount ? "var(--status-blocked)" : null)
    + dashKpi("P0 / P1 open", d.p0Open + " / " + d.p1Open, dashPhaseMeta(d), "var(--priority-P0)")
    + dashKpi("In the selected range", d.burnRemaining, d.burnClosedInRange + " closed · axis: " + escape(dashScopeLabel(state.dashBurn)), "var(--accent)")
    + dashKpi("Throughput in range", d.doneRange, "≈ " + pace.toFixed(1) + " tasks/day · " + dashDaysLabel(d.rangeDays), "var(--status-done)")
    + dashKpi("Balance in range", (netFlow > 0 ? "+" : "") + netFlow, d.newRange + " new vs " + d.doneRange + " closed",
        netFlow > 0 ? "var(--status-blocked)" : "var(--status-done)")
    + dashKpi("Median lead time", d.leadMedianRange != null ? d.leadMedianRange + " days" : "—",
        d.leadRangeCount + " closed in the range")
    + "</div>";

  // ── Burn-up ──────────────────────────────────────────────────────
  html += '<div class="dash-grid wide"><div class="dash-card">'
    + "<h2>Backlog over time (cumulative)</h2>"
    + '<p class="dash-sub">The gap between the lines is the open backlog. Growing means things are created faster than you close them. <strong>Click a day</strong> to see its tasks.</p>'
    + dashCumulativeChart(d.rangeSeries)
    + '<div class="dash-legend">'
    + '<span><i style="background:var(--fg-muted)"></i>created (cumulative)</span>'
    + '<span><i style="background:var(--status-done)"></i>completed (cumulative)</span>'
    + '<span><i style="background:var(--accent);opacity:.3"></i>open</span>'
    + "</div>"
    + '<p class="dash-note">The day of completion is a task&#39;s <code>updated</code> with status <code>done</code>. '
    + "The frontmatter has no separate closing-date field, so any later edit of a task moves it on the chart.</p>"
    + "</div></div>"
    + dashDayPanelFor("cumulative", d.from, d.to);

  // ── Day by day ───────────────────────────────────────────────────
  html += '<div class="dash-grid wide"><div class="dash-card">'
    + "<h2>Day by day — " + dashDaysLabel(d.rangeDays) + "</h2>"
    + '<p class="dash-sub">Above the axis: closed. Below the axis: newly created. In the range: ' + d.doneRange + " closed, " + d.newRange
    + " new. <strong>Click a day</strong> to see its tasks.</p>"
    + dashDailyChart(d.rangeSeries)
    + '<div class="dash-legend">'
    + '<span><i style="background:var(--status-done)"></i>completed</span>'
    + '<span><i style="background:var(--fg-muted);opacity:.55"></i>new</span>'
    + "</div></div></div>"
    + dashDayPanelFor("daily", d.from, d.to);

  // ── Burndown of the selected range ───────────────────────────────
  html += '<div class="dash-grid wide"><div class="dash-card">'
    + "<h2>Burndown: " + escape(dashScopeLabel(state.dashBurn)) + " — " + d.burnRemaining + " of " + d.burnTotal + " left to do</h2>"
    + dashBurnScopeBar(d)
    + '<p class="dash-sub">The solid line: how many of this range were still open on a given day. '
    + "The dashed line: how many tasks of the range existed at all then — a rise there is scope growth, not progress. "
    + "<strong>Click a day</strong> to see the range's tasks for that day.</p>"
    + dashBurnChart(d.burnSeries)
    + '<div class="dash-legend">'
    + '<span><i style="background:var(--accent)"></i>left to do</span>'
    + '<span><i style="background:var(--fg-muted)"></i>scope (created)</span>'
    + "</div>"
    + "<p>" + (d.burnRemaining === 0
        ? "This range is empty — there is nothing to burn down."
        : (burnEta != null
            ? "Closed in the range: <strong>" + d.burnClosedInRange + "</strong>, added <strong>"
              + d.burnAddedInRange + "</strong>. At that pace (" + burnPace.toFixed(2)
              + "/day) the remaining <strong>" + d.burnRemaining + "</strong> would reach zero in <strong>≈ "
              + burnEta + " days</strong>."
            : "No task from this range was closed in this window (" + d.burnAddedInRange
              + " were added), so there is nothing to compute a burn rate from."))
    + "</p>"
    + '<p class="dash-note">Mind the source: the label, the <code>epic</code> and the <code>board</code> are <strong>current</strong> fields, not history. '
    + "The chart reproduces the past of <strong>today's</strong> set — a task added to it yesterday "
    + "is drawn as though it had been in it since the day it was created, and a task removed from the set does not exist on the chart at all.</p>"
    + "</div></div>"
    + dashDayPanelFor("burn", d.from, d.to);

  // ── Epics ────────────────────────────────────────────────────────
  const epics = dashSortItems(d.epics.filter((e) => e.epic), "epics", EPIC_COLUMNS, EPIC_SORT_DEF,
    (a, b) => (a.epic || "").localeCompare(b.epic || ""));
  const noEpic = d.epics.find((e) => !e.epic);
  let epicRows = epics.map(function (e) {
    const pct = dashPct(e.done, e.total);
    return "<tr>"
      + '<td><span class="epic-name" data-dash-filter="filterEpic" data-dash-value="' + escape(e.epic) + '">' + escape(e.epic) + "</span></td>"
      + '<td><div class="mini-progress"><span class="bar-track"><span class="bar-fill" style="width:' + pct + '%;background:var(--status-done)"></span></span><span>' + pct + "%</span></div></td>"
      + '<td class="num">' + e.total + "</td>"
      + '<td class="num">' + e.done + "</td>"
      + '<td class="num">' + (e.open || "·") + "</td>"
      + '<td class="num">' + (e.in_progress || "·") + "</td>"
      + '<td class="num" style="color:' + (e.blocked ? "var(--status-blocked)" : "inherit") + '">' + (e.blocked || "·") + "</td>"
      + '<td class="num" style="color:' + (e.p0 ? "var(--priority-P0)" : "inherit") + '">' + (e.p0 || "·") + "</td>"
      + '<td class="num">' + (e.p1 || "·") + "</td>"
      + '<td class="num">' + (e.last || "—") + "</td>"
      + "</tr>";
  }).join("");
  if (noEpic) {
    epicRows += '<tr><td><span class="epic-name" data-dash-filter="filterEpic" data-dash-value="' + NO_EPIC + '">(no epic)</span></td>'
      + '<td><div class="mini-progress"><span class="bar-track"><span class="bar-fill" style="width:' + dashPct(noEpic.done, noEpic.total) + '%;background:var(--fg-muted)"></span></span><span>' + dashPct(noEpic.done, noEpic.total) + "%</span></div></td>"
      + '<td class="num">' + noEpic.total + '</td><td class="num">' + noEpic.done + '</td><td class="num">' + (noEpic.open || "·")
      + '</td><td class="num">' + (noEpic.in_progress || "·")
      + '</td><td class="num">' + (noEpic.blocked || "·") + '</td><td class="num">' + (noEpic.p0 || "·") + '</td><td class="num">' + (noEpic.p1 || "·")
      + '</td><td class="num">' + (noEpic.last || "—") + "</td></tr>";
  }
  html += '<div class="dash-grid wide"><div class="dash-card">'
    + "<h2>Epics — " + epics.length + " active</h2>"
    + '<p class="dash-sub">Click a name to filter the task list; click a column header to sort. '
    + 'The "(no epic)" row stays at the bottom whatever the sorting — it is not an epic, it is the remainder.</p>'
    + '<div class="dash-scroll"><table class="dash-table"><thead><tr>'
    + dashTableHead("epics", EPIC_COLUMNS, EPIC_SORT_DEF)
    + "</tr></thead><tbody>" + epicRows + "</tbody></table></div></div></div>";

  // ── Distributions ────────────────────────────────────────────────
  const statusRows = STATUSES.filter((s) => d.byStatus[s]).map(function (s) {
    return { label: s, value: s, count: d.byStatus[s], color: "var(--status-" + s + ")" };
  });
  const prioRows = ["P0", "P1", "P2", "P3"].filter((p) => d.byPriority[p]).map(function (p) {
    return { label: p, value: p, count: d.byPriority[p], color: "var(--priority-" + p + ")" };
  });
  const typeRows = Object.keys(d.byType).sort((a, b) => d.byType[b] - d.byType[a])
    .map((k) => ({ label: k, value: k, count: d.byType[k] }));
  const ownerRows = Object.keys(d.byOwner).sort((a, b) => d.byOwner[b] - d.byOwner[a]).slice(0, 8)
    .map((k) => ({ label: k, count: d.byOwner[k] }));
  const labelRows = Object.keys(d.byLabel).sort((a, b) => d.byLabel[b] - d.byLabel[a]).slice(0, 12)
    .map((k) => ({ label: k, value: k, count: d.byLabel[k] }));

  html += '<div class="dash-grid">'
    + '<div class="dash-card"><h2>Statuses</h2><p class="dash-sub">Every task. Click to filter.</p>'
    + dashBars(statusRows, "filterStatus", "barsStatus", "natural") + "</div>"
    + '<div class="dash-card"><h2>Priorities of open tasks</h2><p class="dash-sub">Without done and cancelled — this is the queue.</p>'
    + dashBars(prioRows, "filterPriority", "barsPriority", "natural") + "</div>"
    + '<div class="dash-card"><h2>Type of open tasks</h2><p class="dash-sub">How much of the queue an agent will do (<code>code</code>), and how much needs you.</p>'
    + dashBars(typeRows, "filterType", "barsType", "value") + "</div>"
    + '<div class="dash-card"><h2>Owners of open tasks</h2><p class="dash-sub">Top 8 by number of open tasks.</p>'
    + dashBars(ownerRows, null, "barsOwner", "value") + "</div>"
    + '<div class="dash-card"><h2>Labels on open tasks</h2><p class="dash-sub">Top 12. Click to filter.</p>'
    + dashBars(labelRows, "filterLabel", "barsLabel", "value") + "</div>"
    + '<div class="dash-card"><h2>Lead time of closed tasks</h2>'
    + '<p class="dash-sub">From <code>created</code> to the day of closing · sample: ' + escape(d.leadBucketsFrom)
    + " (" + (d.leadRangeCount || d.leadAllCount) + " closed).</p>"
    + dashBars(d.leadBuckets.map((b) => ({ label: b.label, count: b.count })), null, "barsLead", "natural")
    + '<p class="dash-note">Median: <strong>' + (d.leadMedianRange != null ? d.leadMedianRange + " days" : "—")
    + "</strong> (range) · <strong>" + (d.leadMedianAll != null ? d.leadMedianAll + " days" : "—") + "</strong> (whole history)</p>"
    + "</div></div>";

  // ── Attention lists ──────────────────────────────────────────────
  // Sort first, cut second, and say what was cut. Cutting first would make the
  // sort control a lie: it would reorder twelve rows chosen by a different key.
  const ATTN_CAP = 12;
  const capNote = (shown, total) => total > shown
    ? '<p class="dash-note">Showing ' + shown + " of " + total + " — change the sorting to see the rest.</p>"
    : "";
  const attnList = (items, id, cols, def, right) => {
    const sorted = dashSortItems(items, id, cols, def, (a, b) => dashBlNum(a.t.id) - dashBlNum(b.t.id));
    return dashSortBar(id, cols, def)
      + '<ul class="dash-list">' + sorted.slice(0, ATTN_CAP).map((x) => dashTaskLine(x.t, right(x))).join("") + "</ul>"
      + capNote(Math.min(ATTN_CAP, sorted.length), sorted.length);
  };

  const staleInProgress = d.stale.filter((x) => x.t.status === "in_progress" && x.age >= 7);
  const oldestOpen = d.stale.filter((x) => x.t.priority === "P0" || x.t.priority === "P1");
  const blockedItems = d.blocked.map((t) => ({ t: t, age: null }));

  html += '<div class="dash-grid">'
    + '<div class="dash-card"><h2>In progress with no movement for ≥ 7 days</h2>'
    + '<p class="dash-sub">' + (staleInProgress.length ? "Either finished and unmarked, or stuck." : "Nothing is hanging.") + "</p>"
    + (staleInProgress.length
        ? attnList(staleInProgress, "attnStale", ATTN_COLUMNS, { key: "age", dir: "desc" }, (x) => x.age + " days")
        : '<p class="dash-empty">None.</p>')
    + "</div>"
    + '<div class="dash-card"><h2>Blocked</h2><p class="dash-sub">Who is waiting for whom.</p>'
    + (blockedItems.length
        ? attnList(blockedItems, "attnBlocked", BLOCKED_COLUMNS, { key: "id", dir: "asc" }, function (x) {
            const by = (x.t.blocked_by || []).join(", ");
            return by ? "← " + escape(by) : "—";
          })
        : '<p class="dash-empty">Nothing is blocked.</p>')
    + "</div>"
    + '<div class="dash-card"><h2>Oldest open P0/P1</h2><p class="dash-sub">Age counted from the last <code>updated</code>.</p>'
    + (oldestOpen.length
        ? attnList(oldestOpen, "attnOldest", ATTN_COLUMNS, { key: "age", dir: "desc" }, (x) => x.age + " days")
        : '<p class="dash-empty">No open P0/P1.</p>')
    + "</div></div>";

  // ── Queue in hours ───────────────────────────────────────────────
  // Deliberately NOT "h/day". Estimates are planned effort per task, and most
  // of the queue is executed by an agent, so the sum closed in a 60-day window
  // exceeds the hours that exist in it. Divided by days it reads as a working
  // day and lands at an absurd 60 h — a true division producing a false claim.
  // Expressed as "how many such windows is the queue worth", the same ratio
  // says something the source can actually support.
  const hoursWindows = d.hoursDoneRange > 0 ? d.hoursOpen / d.hoursDoneRange : null;
  html += '<div class="dash-grid">'
    + '<div class="dash-card"><h2>The queue in hours</h2>'
    + '<p class="dash-sub">The sum of <code>estimate</code> over open tasks — ' + d.open + ' of them says nothing about time.'
    + (d.hoursUnknown ? " <strong>" + d.hoursUnknown + "</strong> with no countable estimate (outside the sum)." : "")
    + "</p>"
    + dashBars([{ label: "total", count: d.hoursOpen }]
        .concat(Object.keys(d.hoursByPhase).map((l) => ({ label: l, count: d.hoursByPhase[l] })))
        .concat([
          { label: "P0", count: d.hoursP0, color: "var(--priority-P0)" },
          { label: "P1", count: d.hoursP1, color: "var(--priority-P1)" },
        ])
        .concat(Object.keys(d.hoursByType).map((ty) => ({ label: ty, count: d.hoursByType[ty] }))),
      null, "barsHours", "natural")
    + "<p>" + dashTypeSentence(d)
    + (hoursWindows != null
        ? " In the selected window (" + dashDaysLabel(d.rangeDays) + ") you closed tasks with a combined estimate of <strong>"
        + hoursLabel(d.hoursDoneRange) + "</strong> — the current queue is worth <strong>≈ "
          + hoursWindows.toFixed(1) + "</strong> such windows."
        : "Nothing with a countable estimate was closed in the selected window, so there is nothing to compare this queue against.")
    + "</p>"
    + '<p class="dash-note">What this number does <strong>not</strong> mean: an estimate is a task&#39;s planned effort, not the clock time of your day. '
    + "A sum closed inside a window can exceed the number of hours that window even had — this compares portions of work, not a timetable. "
    + "On top of that, <strong>" + hoursLabel(d.hoursLowConf) + "</strong> of the queue sits in tasks marked <code>confidence: low</code>. "
    + "A working day counts as 8 h, a week as 40 h, a month as 160 h.</p>"
    + "</div>"

    // ── Aging ──────────────────────────────────────────────────────
    + '<div class="dash-card"><h2>Age of open tasks</h2>'
    + '<p class="dash-sub">Counted from <code>created</code>. Not the same as "no movement" below — that one counts <code>updated</code>.</p>'
    + '<table class="dash-table"><thead><tr>'
    + dashTableHead("aging", AGING_COLUMNS, { key: "natural", dir: "desc" })
    + "</tr></thead><tbody>"
    + dashSortItems(d.aging, "aging", AGING_COLUMNS, { key: "natural", dir: "desc" }).map(function (row) {
        return "<tr><td>" + escape(row.label) + "</td>"
          + '<td class="num" style="color:' + (row.P0 ? "var(--priority-P0)" : "inherit") + '">' + (row.P0 || "·") + "</td>"
          + '<td class="num">' + (row.P1 || "·") + "</td>"
          + '<td class="num">' + (row.P2 || "·") + "</td>"
          + '<td class="num">' + (row.P3 || "·") + "</td>"
          + '<td class="num"><strong>' + row.total + "</strong></td></tr>";
      }).join("")
    + "</tbody></table>"
    + '<p class="dash-note">Age is not a defect in itself — a P0 in the last row is.</p>'
    + "</div>"

    // ── Hygiene ────────────────────────────────────────────────────
    + '<div class="dash-card"><h2>Backlog hygiene</h2>'
    + '<p class="dash-sub">Places where the backlog contradicts its own fields. Expand a row to see the tasks.</p>'
    + (d.hygiene.length ? dashSortBar("hygiene", TASK_COLUMNS, { key: "id", dir: "asc" }) : "")
    + (d.hygiene.length
        ? d.hygiene.map(function (h) {
            return "<details class=\\"hyg\\"><summary><span class=\\"hyg-count\\">" + h.tasks.length + "</span> "
              + escape(h.label) + '<span class="hyg-hint">' + escape(h.hint) + "</span></summary>"
              + '<ul class="dash-list">' + dashSortItems(h.tasks, "hygiene", TASK_COLUMNS, { key: "id", dir: "asc" },
                  (a, b) => dashBlNum(a.id) - dashBlNum(b.id)).map(function (t) {
                  return "<li><span class=\\"dash-id\\">" + escape(t.id) + "</span>"
                    + '<a data-dash-task="' + escape(t.id) + '">' + escape(t.title) + "</a>"
                    + '<span class="dash-age">' + escape(t.priority || "") + "</span></li>";
                }).join("") + "</ul></details>";
          }).join("")
        : '<p class="dash-empty">Nothing to tidy up.</p>')
    + "</div></div>";

  // ── Forecast ─────────────────────────────────────────────────────
  html += '<div class="dash-grid wide"><div class="dash-card"><h2>Forecast to completion</h2>'
    + '<p class="dash-sub">A simple extrapolation of the throughput in the selected range — not a plan, just the consequence of the current rate.</p>'
    + "<p>" + (eta != null
        ? "At a balance of <strong>" + netFlow + "</strong> tasks / " + d.rangeDays + " days, the current <strong>" + d.open
          + "</strong> open would reach zero in <strong>≈ " + eta + " days</strong> (" + Math.round(eta / 30) + " months), "
          + "provided the rate at which new ones appear does not change."
        : (d.doneRange === 0
            ? "Nothing was closed in the selected range — there is nothing to extrapolate from."
            : "The backlog is growing: in " + d.rangeDays + " days <strong>" + d.newRange + "</strong> arrived and <strong>" + d.doneRange
              + "</strong> left. At that balance the queue never closes — either the scope has to be cut, or people have to stop adding."))
    + "</p></div></div>";

  el.innerHTML = html;
  dashSyncHash();
}

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
function dashEncodeHash() {
  const p = new URLSearchParams();
  const r = state.dashRange || {};
  p.set("range", r.preset && r.preset !== "custom" ? r.preset : (r.from || "") + ".." + (r.to || ""));
  const b = state.dashBurn || BURN_DEFAULT;
  p.set("burn", b.kind + ":" + (b.value || ""));
  if (state.dashDay) p.set("day", state.dashDay.day + ":" + state.dashDay.source);
  const sorts = Object.keys(state.dashSorts || {})
    .map((id) => id + ":" + state.dashSorts[id].key + ":" + state.dashSorts[id].dir);
  if (sorts.length) p.set("sort", sorts.join(","));
  return "dashboard?" + p.toString();
}

function dashApplyHash(query) {
  if (!query) return;                       // bare #dashboard — keep what you had
  const p = new URLSearchParams(query);

  const range = p.get("range");
  if (range) {
    if (range.indexOf("..") >= 0) {
      const parts = range.split("..");
      state.dashRange = { preset: "custom", from: parts[0] || null, to: parts[1] || null };
    } else if (DASH_PRESETS.some((x) => x.key === range)) {
      const preset = DASH_PRESETS.find((x) => x.key === range);
      state.dashRange = preset.days
        ? { preset: range, from: dashAddDays(dashToday(), -(preset.days - 1)), to: null }
        : { preset: "all", from: null, to: null };
    }
  }

  const burn = p.get("burn");
  if (burn) {
    const i = burn.indexOf(":");
    // An old \`burn=focus\` link (from before BL-1386) has nothing left to select —
    // it falls back to the default axis instead of showing an empty chart.
    state.dashBurn = i < 0 ? { ...BURN_DEFAULT } : { kind: burn.slice(0, i), value: burn.slice(i + 1) };
  }

  const day = p.get("day");
  if (day) {
    const i = day.lastIndexOf(":");
    const value = i < 0 ? day : day.slice(0, i);
    // An unparseable day would pin a panel to a date no chart draws.
    state.dashDay = dashIsDay(value) ? { day: value, source: i < 0 ? "daily" : day.slice(i + 1) } : null;
  } else {
    state.dashDay = null;
  }

  const sort = p.get("sort");
  state.dashSorts = {};
  if (sort) {
    for (const part of sort.split(",")) {
      const bits = part.split(":");
      if (bits.length === 3) state.dashSorts[bits[0]] = { key: bits[1], dir: bits[2] === "asc" ? "asc" : "desc" };
    }
  }
}

// replaceState, not a hash assignment: assigning fires hashchange, which would
// re-enter handleHash and re-apply the state that was just set.
function dashSyncHash() {
  if (state.view !== "dashboard") return;
  const next = "#" + dashEncodeHash();
  if (window.location.hash !== next) {
    history.replaceState(null, "", window.location.pathname + window.location.search + next);
  }
}

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
  host.innerHTML = renderExecution(vm);
  drawPlanEdges();
}

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
    now: Date.now(),
    // \`servedRoles\` is deliberately NOT passed: the map of roles to agent
    // commands lives in somebody's \`run\` invocation and the page has never seen
    // it. Guessing an empty one would put every task with any role into a
    // person's queue.
  });
  return state.decisionsMine ? minePanel(items, state.actor) : items;
}

function renderDecisions() {
  const host = document.getElementById("decisionsView");
  const rows = decisionRows();
  const head =
    '<div class="dec-head"><h2>Waiting on you</h2>' +
    '<button type="button" class="dec-filter' + (state.decisionsMine ? " is-on" : "") +
    '" onclick="toggleDecisionsMine()">' +
    (state.decisionsMine ? "only mine: " + escapeHtmlStr(state.actor || "(nobody declared)") : "everything") +
    "</button></div>" +
    '<p class="dec-lede">Work that cannot move until a person decides: tasks marked for a human, ' +
    "and questions somebody asked that nothing has answered. Ordered by how many tasks the " +
    "decision would release, counted through the chain — not by age.</p>";

  if (!rows.length) {
    host.innerHTML = head + '<p class="dec-empty">Nothing is waiting on a person. A task gets here by ' +
      'carrying <code>executor: human</code>, or when a handoff leaves a question nobody has answered yet.</p>';
    updateDecisionsCount();
    return;
  }

  host.innerHTML = head + rows.map(function (r) {
    const unblocks = r.unblocks
      ? '<span class="dec-unblocks">releases ' + r.unblocks + " task" + (r.unblocks === 1 ? "" : "s") + "</span>"
      : '<span class="dec-unblocks">releases nothing else</span>';
    const top =
      '<div class="dec-row">' +
      '<a class="dec-id" href="#' + escapeHtmlStr(r.id) + '">' + escapeHtmlStr(r.id) + "</a>" +
      '<span class="dec-title">' + escapeHtmlStr(r.title) + "</span>" +
      '<span class="dec-kind">' + (r.kind === "question" ? "question" : "for a person") + "</span>" +
      unblocks + "</div>";

    if (r.kind === "question") {
      const age = r.ageDays === null ? "" :
        " · asked " + (r.ageDays === 0 ? "today" : r.ageDays + " day" + (r.ageDays === 1 ? "" : "s") + " ago");
      return '<article class="dec-item is-question">' + top +
        '<div class="dec-question">' + escapeHtmlStr(r.question) + "</div>" +
        '<div class="dec-meta">' + escapeHtmlStr(r.asker || "somebody") + age + "</div>" +
        decisionForm(r.id, r.eventId) +
        "</article>";
    }
    const why = r.why.indexOf("executor") >= 0
      ? "marked <code>executor: human</code>"
      : "asks for the role <code>" + escapeHtmlStr(r.role) + "</code>, which no agent here serves";
    return '<article class="dec-item">' + top +
      '<div class="dec-meta">' + why + (r.owner ? " · " + escapeHtmlStr(r.owner) : "") + "</div>" +
      decisionForm(r.id, "") +
      "</article>";
  }).join("");
  updateDecisionsCount();
}

/** The one action the panel offers, and it writes through \`/api/decision\`,
 *  which calls the same function the \`decide\` command calls. A second write
 *  path would be a second set of rules about what a decision may say.
 *
 *  The handlers are DELEGATED rather than inline: a decision is free text and
 *  would break out of an onclick="…('…')" attribute the first time one carried
 *  an apostrophe — the reason the dashboard binds its own buttons that way. */
function decisionForm(id, eventId) {
  if (!CAN_EDIT) {
    return '<div class="dec-actions"><span class="dec-hint">Read-only: connect to the folder ' +
      "(or run the server) to record a decision from here.</span></div>";
  }
  return '<div class="dec-actions">' +
    '<input type="text" placeholder="What was decided, and why" ' +
    'data-decision-for="' + escapeHtmlStr(id) + '" data-resolves="' + escapeHtmlStr(eventId) + '">' +
    '<button type="button" class="btn-action primary" data-decision-submit="1">Record</button>' +
    "</div>";
}

async function submitDecision(input) {
  const text = String(input.value || "").trim();
  if (!text) { toast("A decision with no content records that something was settled and leaves out what", "error"); return; }
  if (!state.actor) { toast("Say who you are first — the actor picker is in the header", "error"); return; }
  try {
    const res = await fetch("api/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: input.dataset.decisionFor,
        reason: text,
        resolves: input.dataset.resolves || null,
        actor: state.actor,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
    toast(input.dataset.decisionFor + ": decision recorded", "success");
    // The history is what the panel counts from, so it is re-read before the
    // redraw — otherwise the answered question would still be sitting there.
    await refreshHistory(input.dataset.decisionFor, true);
    renderDecisions();
  } catch (e) {
    toast("The decision was not recorded: " + e.message, "error");
  }
}

function toggleDecisionsMine() {
  state.decisionsMine = !state.decisionsMine;
  renderDecisions();
  decisionsSyncHash();
}

/** The count on the tab, so the panel is visible from wherever you are. */
function updateDecisionsCount() {
  const tab = document.getElementById("tabDecisions");
  if (!tab) return;
  const n = decisionPanel(ALL_TASKS, HISTORY, { archivedStatuses: CONFIG.archivedStatuses }).length;
  tab.innerHTML = "Waiting on you" + (n ? '<span class="tab-count">' + n + "</span>" : "");
}

function decisionsSyncHash() {
  if (state.view !== "decisions") return;
  const next = "#decisions" + (state.decisionsMine ? "?mine=1" : "");
  if (window.location.hash !== next) {
    history.replaceState(null, "", window.location.pathname + window.location.search + next);
  }
}

document.getElementById("decisionsView").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-decision-submit]");
  if (btn) submitDecision(btn.previousElementSibling);
});
document.getElementById("decisionsView").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const input = e.target.closest("[data-decision-for]");
  if (!input) return;
  e.preventDefault();
  submitDecision(input);
});

window.toggleDecisionsMine = toggleDecisionsMine;

function setView(view) {
  state.view = view;
  document.body.classList.toggle("view-dashboard", view === "dashboard");
  document.body.classList.toggle("view-execution", view === "execution");
  document.body.classList.toggle("view-decisions", view === "decisions");
  for (const btn of document.querySelectorAll(".view-tab")) {
    btn.classList.toggle("is-active", btn.dataset.view === view);
  }
  if (view === "dashboard") renderDashboard();
  if (view === "execution") renderExecution_();
  if (view === "decisions") renderDecisions();
}

function dashFilterTo(key, value) {
  for (const spec of FILTER_SPECS) state[spec.key].clear();
  state.search = "";
  const input = document.getElementById("searchInput");
  if (input) input.value = "";
  if (state[key]) state[key].add(value);
  setView("tasks");
  // render() rewrites #dashboard into #tasks?<that filter>. Previously the hash was
  // only cleared here, because it had nothing to describe the drill-down result
  // with — and a reload came back to the dashboard with a filter silently applied.
  render();
}

function dashOpenTask(id) {
  for (const spec of FILTER_SPECS) state[spec.key].clear();
  setView("tasks");
  render();
  selectTask(id);
}

window.dashFilterTo = dashFilterTo;
window.dashOpenTask = dashOpenTask;

// Delegation, not inline onclick: epic names and label values are free text and
// would break out of an onclick="…('…')" attribute the first time one contained
// an apostrophe.
document.getElementById("dashboardView").addEventListener("click", (e) => {
  const scopeBtn = e.target.closest("[data-board-scope]");
  if (scopeBtn) { setBoardScope(scopeBtn.dataset.boardScope); return; }
  if (e.target.closest("[data-dash-day-close]")) { dashPinDay(null); return; }
  const hit = dashChartPointAt(e.target, e.clientX);
  if (hit) {
    dashPinDay({ day: hit.p.days[hit.idx], source: hit.p.source });
    return;
  }
  const sortEl = e.target.closest("[data-sort-id]");
  if (sortEl) { dashSetSort(sortEl.dataset.sortId, sortEl.dataset.sortKey); return; }
  const burnEl = e.target.closest("[data-burn-kind]");
  if (burnEl) { dashSetBurn(burnEl.dataset.burnKind, burnEl.dataset.burnValue); return; }
  const presetEl = e.target.closest("[data-range-preset]");
  if (presetEl) { dashSetPreset(presetEl.dataset.rangePreset); return; }
  const filterEl = e.target.closest("[data-dash-filter]");
  if (filterEl) {
    dashFilterTo(filterEl.dataset.dashFilter, filterEl.dataset.dashValue);
    return;
  }
  const taskEl = e.target.closest("[data-dash-task]");
  if (taskEl) dashOpenTask(taskEl.dataset.dashTask);
});

// Hover: one listener on the container, because every chart is re-created on
// each render. Hidden on leave AND on scroll — a fixed-position tooltip left
// behind by a scroll would point at whatever moved under it.
document.getElementById("dashboardView").addEventListener("pointermove", dashHoverMove);
document.getElementById("dashboardView").addEventListener("pointerleave", dashHoverHide);
document.getElementById("dashboardView").addEventListener("scroll", dashHoverHide, { passive: true });

// The date inputs are re-created on every render, so the listener lives on the
// container, not on the inputs.
document.getElementById("dashboardView").addEventListener("change", (e) => {
  const burnEpic = e.target.closest("[data-burn-epic]");
  if (burnEpic) {
    if (burnEpic.value) dashSetBurn("epic", burnEpic.value);
    else dashSetBurn(BURN_DEFAULT.kind, BURN_DEFAULT.value);
    return;
  }
  const input = e.target.closest("[data-range-input]");
  if (input) dashSetBound(input.dataset.rangeInput, input.value);
});

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
  // Live mode replaces TASKS wholesale — the dashboard has to follow, or it
  // silently shows the numbers from before the refresh.
  if (state.view === "dashboard") renderDashboard();
  // Same reason as the dashboard: the plan's state is computed from the tasks,
  // so a refresh that did not redraw it would leave a card in a status the rest
  // of the page no longer shows.
  else if (state.view === "execution") renderExecution_();
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
  if (id === "dashboard") {
    dashApplyHash(qi < 0 ? "" : raw.slice(qi + 1));
    if (state.view !== "dashboard") setView("dashboard");
    else renderDashboard();
    return;
  }
  if (id === "decisions") {
    state.decisionsMine = qi >= 0 && new URLSearchParams(raw.slice(qi + 1)).get("mine") === "1";
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
    if (ok) toast("Link skopiowany ✓", "success");
  else window.prompt("Copy the link to this view:", url);
  });
});

// ─── View tabs ───────────────────────────────────────────────────────
for (const btn of document.querySelectorAll(".view-tab")) {
  btn.addEventListener("click", () => {
    const v = btn.dataset.view;
    setView(v);
    if (v === "dashboard") window.location.hash = dashEncodeHash();
    else if (v === "execution") window.location.hash = "execution";
    else if (v === "decisions") window.location.hash = "decisions" + (state.decisionsMine ? "?mine=1" : "");
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
    try { wanted = localStorage.getItem(BOARD_STORAGE_KEY); } catch { /* prywatne okno */ }
  }
  const valid = wanted === BOARD_ALL || knownBoards().some((b) => b.slug === wanted);
  state.board = valid ? wanted : BOARD_ALL;
  applyScope();
})();

const savedDashRange = dashLoadRange();
if (savedDashRange) state.dashRange = savedDashRange;
const savedDashBurn = dashLoadBurn();
if (savedDashBurn) state.dashBurn = savedDashBurn;
render();
handleHash();
// Only now may the URL be overwritten: the link somebody arrived with has been
// read. The first write normalises the entry (\`#BL-123\`, no hash at all) into a
// form that can be copied from the address bar and sent.
hashRouted = true;
tasksSyncHash();
updateConnectionBar();
state.actor = loadActor();
renderActorPicker();

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
    // A change made outside the viewer only reaches the history after
    // reconciliation (a few seconds after the file is written) — which is why this
    // is a separate signal rather than an appendage to tasks-changed.
    es.addEventListener("history-changed", () => {
      if (state.selectedId) refreshHistory(state.selectedId, true);
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
