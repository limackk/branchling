/**
 * The Jira source of `import` (TL-581): reading a Jira Cloud search response
 * into the issue shape `import.mjs` plans and writes.
 *
 * The six TL-67 decisions hold here unchanged — no network, one-off, an empty
 * `verification:` counted in the report, the conversation behind a link, local
 * numbers, mapping as an argument. Jira differs from GitHub in three places,
 * and each is settled below rather than left to a reader:
 *
 *   1. **The body is not markdown.** Jira Cloud REST API v3 returns
 *      `fields.description` as Atlassian Document Format, a JSON tree.
 *      `adfToMarkdown()` converts the common nodes with no dependency. A node it
 *      does not know keeps its text and is COUNTED, because a reader who cannot
 *      see an omission assumes there was nothing to omit.
 *      A description that is a STRING is the v2 API's wiki markup, and it is
 *      refused with a message naming v3 rather than accepted: wiki markup is not
 *      markdown, and copying it verbatim would write `h2.` and `{code}` into a
 *      body that renders as if nothing were wrong. Converting it is a second
 *      converter for a format Atlassian has superseded on Cloud.
 *   2. **Statuses belong to each project's workflow.** The name of a Jira status
 *      means nothing outside its workflow; its `statusCategory.key` (`new`,
 *      `indeterminate`, `done`) means the same everywhere. The category is
 *      therefore the default, and `--status <from>=<to>` names a status more
 *      precisely — as an argument, by the rule `--label` follows (Law 3).
 *   3. **Identity.** The issue's `self` is an API URL nobody follows. The link a
 *      person opens, and the one a re-import recognises, is
 *      `<site>/browse/<KEY>`, derived from `self` and `key`. The marker line
 *      `Imported from Jira: <browse url>` is a CONTRACT once it ships: the
 *      outbound pipe (proof comments on the ticket, TL-582) reads it.
 *
 * This module is PURE: no filesystem, no network, no process state.
 *
 * Tests: `node --test scripts/tests/import-jira.test.mjs`
 */

import { renderImportedBody } from "./import-body.mjs";

export const SOURCE_MARKER = "Imported from Jira: ";

/** What a Jira status category means here; `import.mjs` maps it onto the
 *  project's own statuses. */
export const STATUS_CATEGORIES = ["new", "indeterminate", "done"];

// ──────────────────────────────────────────────────────────────────────────
// Atlassian Document Format → markdown
// ──────────────────────────────────────────────────────────────────────────

const KNOWN_MARKS = new Set(["strong", "em", "code", "link"]);

/**
 * @param {object|null} doc an ADF `doc` node, or null for an issue with no description
 * @returns {{markdown: string, unknown: Map<string, number>}} `unknown` counts
 *   every node and mark type that was not converted; its text is kept either way
 */
export function adfToMarkdown(doc) {
  const unknown = new Map();
  const note = (type) => unknown.set(type, (unknown.get(type) || 0) + 1);
  if (!doc) return { markdown: "", unknown };

  const children = (node) => (Array.isArray(node.content) ? node.content : []);
  /** The text an unknown LEAF carries in its attributes — a mention's `@Name`,
   *  an emoji's character, a card's URL. */
  const attrText = (node) => {
    const a = node.attrs || {};
    for (const key of ["text", "url", "shortName"]) if (typeof a[key] === "string" && a[key]) return a[key];
    return "";
  };

  function inline(nodes) {
    return nodes.map(inlineNode).join("");
  }

  function inlineNode(node) {
    if (!node || typeof node !== "object") return "";
    if (node.type === "text") return marked(typeof node.text === "string" ? node.text : "", node.marks);
    if (node.type === "hardBreak") return "\\\n";
    note(node.type || "(no type)");
    return Array.isArray(node.content) ? inline(node.content) : attrText(node);
  }

  function marked(text, marks) {
    if (!Array.isArray(marks) || !text) return text;
    const has = (t) => marks.some((m) => m && m.type === t);
    for (const m of marks) if (m && !KNOWN_MARKS.has(m.type)) note("mark:" + (m.type || "(no type)"));
    let out = text;
    if (has("code")) out = "`" + out + "`";
    if (has("em")) out = "*" + out + "*";
    if (has("strong")) out = "**" + out + "**";
    const link = marks.find((m) => m && m.type === "link");
    if (link && link.attrs && typeof link.attrs.href === "string") out = "[" + out + "](" + link.attrs.href + ")";
    return out;
  }

  /** Blocks are separated by a blank line; inside a list item they are tight. */
  function blocks(nodes, sep = "\n\n") {
    return nodes.map(blockNode).filter((s) => s !== "").join(sep);
  }

  function list(node, marker) {
    const start = node.attrs && Number.isInteger(node.attrs.order) ? node.attrs.order : 1;
    return children(node).map((item, i) => {
      const bullet = marker === "-" ? "- " : start + i + ". ";
      const pad = " ".repeat(bullet.length);
      const body = item && item.type === "listItem" ? blocks(children(item), "\n") : blockNode(item);
      return body.split("\n").map((line, j) => (j === 0 ? bullet : line ? pad : "") + line).join("\n");
    }).join("\n");
  }

  function blockNode(node) {
    if (!node || typeof node !== "object") return "";
    switch (node.type) {
      case "paragraph":
        return inline(children(node));
      case "heading": {
        const level = node.attrs && Number.isInteger(node.attrs.level) ? Math.min(Math.max(node.attrs.level, 1), 6) : 1;
        return "#".repeat(level) + " " + inline(children(node));
      }
      case "bulletList":
        return list(node, "-");
      case "orderedList":
        return list(node, "1.");
      case "codeBlock": {
        const lang = node.attrs && typeof node.attrs.language === "string" ? node.attrs.language : "";
        const text = children(node).map((t) => (t && typeof t.text === "string" ? t.text : "")).join("");
        return "```" + lang + "\n" + text + "\n```";
      }
      case "blockquote":
        return blocks(children(node)).split("\n").map((l) => (l ? "> " + l : ">")).join("\n");
      case "rule":
        return "---";
      case "text":
      case "hardBreak":
        return inlineNode(node);
      default:
        note(node.type || "(no type)");
        // Its children are rendered in the context it stands in: a panel holds
        // paragraphs, a table cell holds paragraphs, and those convert.
        return Array.isArray(node.content) ? blocks(node.content) : attrText(node);
    }
  }

  return { markdown: blocks(children(doc)).trim(), unknown };
}

// ──────────────────────────────────────────────────────────────────────────
// Reading the search response
// ──────────────────────────────────────────────────────────────────────────

/**
 * `<site>/browse/<KEY>` from the issue's API `self`. The site is everything
 * before `/rest/`, so a Jira served under a context path keeps it.
 */
export function browseUrl(self, key) {
  if (typeof self !== "string" || typeof key !== "string" || !key) return null;
  let url;
  try {
    url = new URL(self);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const at = url.pathname.indexOf("/rest/");
  if (at < 0) return null;
  return url.origin + url.pathname.slice(0, at) + "/browse/" + key;
}

const V3_HINT = "use the v3 API (`/rest/api/3/search/jql`), which returns the description as Atlassian Document Format";

/**
 * The input is what the search endpoint prints — one page, `{"issues": [...]}`
 * — or an ARRAY of such pages, which is what `jq -s .` makes of a paging loop.
 * Everything wrong is reported at once, and a refusal imports nothing.
 */
export function parseJiraIssues(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { issues: [], errors: ["the input is not valid JSON: " + e.message] };
  }
  const pages = Array.isArray(data) ? data : [data];
  const errors = [];
  const raws = [];
  pages.forEach((page, p) => {
    const where = Array.isArray(data) ? "page " + (p + 1) : "the input";
    if (!page || typeof page !== "object" || Array.isArray(page)) {
      errors.push(where + " is not a search response object");
      return;
    }
    if (!Array.isArray(page.issues)) {
      errors.push(
        where + " has no `issues` array — pass the search response as Jira prints it" +
          (typeof page.key === "string" ? " (this looks like ONE issue, not a page of them)" : "")
      );
      return;
    }
    page.issues.forEach((raw, i) => raws.push({ raw, where: where + ", issue " + (i + 1) }));
  });

  const issues = [];
  const seen = new Map();
  for (const { raw, where: position } of raws) {
    if (!raw || typeof raw !== "object") {
      errors.push(position + " is not an object");
      continue;
    }
    const key = typeof raw.key === "string" && raw.key.trim() ? raw.key.trim() : null;
    const where = key ? "issue " + key : position + " (no `key`)";
    const problems = [];
    if (!key) problems.push("no `key` — that is the ticket's identity, with `self` it makes the link a re-import recognises");
    const url = key ? browseUrl(raw.self, key) : null;
    if (key && !url) {
      problems.push("`self: " + (raw.self === undefined ? "(missing)" : raw.self) + "` is not a Jira REST URL — the browse link is derived from it");
    }
    const f = raw.fields;
    if (!f || typeof f !== "object") {
      errors.push(where + ": no `fields` — request them with `fields=summary,description,status,labels,priority`");
      continue;
    }
    if (typeof f.summary !== "string" || !f.summary.trim()) {
      problems.push("no `fields.summary` — a task with no title is useless to the next person");
    }
    const category = f.status && f.status.statusCategory && f.status.statusCategory.key;
    if (STATUS_CATEGORIES.indexOf(category) < 0) {
      problems.push(
        "`fields.status.statusCategory.key: " + (category === undefined ? "(missing)" : category) +
          "` is none of " + STATUS_CATEGORIES.join(" | ")
      );
    }
    let body = { markdown: "", unknown: new Map() };
    if (typeof f.description === "string") {
      problems.push("`fields.description` is a string — that is the v2 API's wiki markup, not markdown; " + V3_HINT);
    } else if (f.description !== undefined && f.description !== null) {
      if (typeof f.description !== "object" || f.description.type !== "doc") {
        problems.push("`fields.description` is not an Atlassian Document Format `doc` node");
      } else {
        body = adfToMarkdown(f.description);
      }
    }
    if (f.labels !== undefined && f.labels !== null && (!Array.isArray(f.labels) || f.labels.some((l) => typeof l !== "string"))) {
      problems.push("`fields.labels` is not an array of strings");
    }
    if (key && seen.has(key)) {
      // Overlapping pages, not two tickets. Refused rather than merged quietly:
      // the paging that produced them may have missed others too.
      problems.push("appears more than once in the input (also at " + seen.get(key) + ") — the pages overlap");
    }
    if (key && !seen.has(key)) seen.set(key, position);
    if (problems.length) {
      for (const p of problems) errors.push(where + ": " + p);
      continue;
    }
    issues.push({
      ref: key,
      title: f.summary.trim(),
      body: body.markdown,
      url,
      labels: Array.isArray(f.labels) ? f.labels.slice() : [],
      category,
      statusName: typeof f.status.name === "string" ? f.status.name : "",
      sourceState: typeof f.status.name === "string" ? f.status.name : category,
      priority: f.priority && typeof f.priority.name === "string" ? f.priority.name : "",
      unknownNodes: body.unknown,
    });
  }
  if (errors.length) return { issues: [], errors };
  return { issues, errors };
}

/** Lines the body carries beyond the shared ones: what was read but not mapped. */
export function extraNotes(issue) {
  const notes = [];
  if (issue.priority) {
    notes.push("Jira priority: " + issue.priority + " — not mapped onto this project's priorities.");
  }
  if (issue.unknownNodes && issue.unknownNodes.size) {
    const list = [...issue.unknownNodes.entries()].map(([t, n]) => t + " ×" + n).join(", ");
    notes.push("The description held content the converter does not know (" + list + "); its text was kept, its formatting was not.");
  }
  return notes;
}

/** The body of an imported Jira issue: the shared shape, this source's marker,
 *  and what was read but not mapped. */
export function renderBody(issue) {
  return renderImportedBody({ marker: SOURCE_MARKER, text: issue.body, url: issue.url, notes: extraNotes(issue) });
}
