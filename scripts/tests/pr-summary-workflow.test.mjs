/**
 * The transport: the workflow files that carry `pr-summary` into a pull
 * request (TL-89).
 *
 * WHY THIS FILE EXISTS BESIDE `pr-summary.test.mjs`. The command was proved
 * when it was written; the workflow was proved by four `assert.match` calls
 * over its text, which is the weakest thing a test can say about a file whose
 * whole job is to RUN something. Matching `/pr-summary/` still passes after
 * `--base` is renamed, after the binary name changes, and after the posting
 * step starts appending a new comment on every push. An Action whose only
 * proof is "it would work on GitHub" is an unfalsifiable contract, and this
 * repository stopped accepting those.
 *
 * WHAT IS PROVED HERE, WITHOUT A PULL REQUEST ANYWHERE:
 *
 *   1. The invocation in the YAML is one this CLI accepts — the flags go
 *      through `parsePrSummaryArgs`, the same parser the command uses, so a
 *      renamed flag fails here instead of in somebody else's CI.
 *   2. The job is a caller and not a second implementation: its `run:` blocks
 *      contain the invocation and nothing that reads the backlog.
 *   3. The posting step is EXECUTED — the inline script is lifted out of the
 *      YAML and run twice against a fake GitHub API. One comment after the
 *      first push, the SAME comment after the second. That is the only part
 *      of the file with behaviour, and it is the part a text match could
 *      never judge.
 *
 * WHAT NO LOCAL RUN CAN PROVE: that `actions/checkout@v4`,
 * `actions/setup-node@v4` and `actions/github-script@v7` behave as documented
 * on a runner. That is GitHub's contract, not this repository's, and the first
 * pull request against this repository exercises it — `.github/workflows/
 * pr-summary.yml` is here so that the tool's own repository is the first place
 * the claim is tested.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parsePrSummaryArgs, renderMarkdown, summarizeTask } from "../pr-summary.mjs";
import { PRODUCT_NAME, BLOCK_MARKER_NAME } from "../product.mjs";
import { isolateHome } from "./_repo.mjs";

// Nothing here reads a config file, but the rule is about the SET: a file that
// grows one later must not start reading the developer's own home.
isolateHome("pr-summary-workflow");

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

/** The template a consumer copies, and the one this repository runs on itself. */
const FILES = [
  { path: join(ROOT, "examples", "pr-summary.yml"), label: "examples/pr-summary.yml" },
  { path: join(ROOT, ".github", "workflows", "pr-summary.yml"), label: ".github/workflows/pr-summary.yml" },
];

const read = (f) => readFileSync(f.path, "utf8");

// ── Reading the YAML ──────────────────────────────────────────────────────
//
// Deliberately not a YAML parser: this package has no dependencies, and what
// is needed is the shell text of the `run:` steps and the body of the inline
// script. Both are indented blocks under a known key.

/** Every `<key>: |` block in the file, dedented, in order. */
export function blocksUnder(yml, key) {
  const lines = yml.split("\n");
  const re = new RegExp("^\\s*" + key + ":\\s*\\|\\s*$");
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    if (!re.test(lines[i])) continue;
    const indent = lines[i].match(/^\s*/)[0].length;
    const body = [];
    for (const line of lines.slice(i + 1)) {
      if (line.trim() && line.match(/^\s*/)[0].length <= indent) break;
      body.push(line.slice(indent + 2));
    }
    blocks.push(body.join("\n"));
  }
  return blocks;
}

/** The body of the first `<key>: |` block. */
export function blockUnder(yml, key) {
  const blocks = blocksUnder(yml, key);
  assert.ok(blocks.length, "no `" + key + ": |` block in the workflow");
  return blocks[0];
}

/** The command lines the runner would execute: every `run:` block, backslash
 *  continuations joined, `${{ … }}` expressions replaced by a stand-in. */
export function shellLines(yml) {
  return blocksUnder(yml, "run")
    .join("\n")
    .replace(/\\\n\s*/g, " ")
    .split("\n")
    .map((l) => l.replace(/\$\{\{[^}]*\}\}/g, "EXPRESSION").trim())
    .filter((l) => l && !l.startsWith("#"));
}

/** The tokens of every command line that runs `pr-summary`. */
function invocations(yml) {
  return shellLines(yml)
    .filter((l) => l.includes("pr-summary"))
    .map((l) => l.replace(/>\s*\S+$/, "").replace(/["']/g, "").trim().split(/\s+/));
}

// ── The invocation ────────────────────────────────────────────────────────

for (const file of FILES) {
  test(file.label + " invokes a command line this CLI accepts", () => {
    const calls = invocations(read(file));
    assert.equal(calls.length, 1, "one invocation — a second one is a second answer in one comment");
    const tokens = calls[0];
    const at = tokens.indexOf("pr-summary");

    // The binary is either the published name or this checkout's entry point.
    // Both are spelled from `product.mjs`, so a rename fails here rather than
    // leaving a template that installs a package nobody publishes.
    const before = tokens.slice(0, at).join(" ");
    assert.ok(
      before === "npx --yes " + PRODUCT_NAME || before === "node scripts/cli.mjs",
      "the invocation is `npx --yes " + PRODUCT_NAME + "` or `node scripts/cli.mjs`, not: " + before,
    );

    // The parser the command itself uses. A renamed or withdrawn flag fails
    // here, in this repository, instead of in a stranger's pull request.
    const parsed = parsePrSummaryArgs(tokens.slice(at + 1));
    assert.notEqual(parsed.base, "main", "the base comes from the pull request, not from the default");
    assert.equal(parsed.cost, false, "cost information must not be on by default in a public place");
    assert.equal(parsed.json, false, "the comment is markdown for a person to read");
  });

  test(file.label + " is a caller, not a second implementation", () => {
    const yml = read(file);
    const lines = shellLines(yml);
    assert.ok(lines.length, "no `run:` block was found at all — this check would pass on any file");
    // Whatever the job runs must be the invocation and the echo of it. Reading
    // the backlog in the workflow is the failure this split exists to prevent:
    // the same decision would then live in every consumer's copy.
    for (const line of lines) {
      assert.ok(
        line.includes("pr-summary") || /^cat\b/.test(line),
        "the job runs something of its own beside the invocation: " + line,
      );
    }
    assert.match(yml, /fetch-depth: 0/, "a shallow checkout has no base commit to compare against");
    assert.match(yml, /pull-requests: write/, "the job writes one comment");
  });

  test(file.label + " keys its comment on the frozen marker, not the display name", () => {
    const script = blockUnder(read(file), "script");
    const marker = "<!-- " + BLOCK_MARKER_NAME + "-pr-summary -->";
    assert.ok(script.includes(marker), "the marker in the workflow is not " + marker);
    // `BLOCK_MARKER_NAME` and not `PRODUCT_NAME`: this string identifies a
    // comment that already exists in somebody's pull request. Derived from the
    // display name, a rename would post a SECOND comment beside the first, in
    // repositories nobody can reach to fix.
    assert.equal(
      (script.match(/-pr-summary -->/g) || []).length, 1,
      "the marker literal appears more than once — two spellings of one key is how a second comment appears",
    );
    assert.ok(
      (script.match(/\bmarker\b/g) || []).length >= 3,
      "the marker is bound once and then used to FIND and to WRITE the comment",
    );
  });
}

// ── The posting step, executed ────────────────────────────────────────────

/**
 * Runs an `actions/github-script` body against a fake API and returns the
 * comments that exist afterwards. `summary.md` is answered from memory: the
 * script reads it with `fs`, and a test that wrote the file would be testing
 * the filesystem.
 */
async function post(script, bodies) {
  const comments = [];
  let nextId = 100;
  const listComments = function listComments() {};
  const github = {
    paginate: async (fn) => {
      assert.equal(fn, listComments, "the script must page the comment list, not read one page");
      return comments.map((c) => ({ ...c }));
    },
    rest: {
      issues: {
        listComments,
        createComment: async ({ issue_number, body }) => {
          assert.equal(issue_number, 7);
          comments.push({ id: nextId++, body });
        },
        updateComment: async ({ comment_id, body }) => {
          const found = comments.find((c) => c.id === comment_id);
          assert.ok(found, "the script updated a comment that does not exist");
          found.body = body;
        },
      },
    },
  };
  const context = { repo: { owner: "o", repo: "r" }, issue: { number: 7 } };
  let current = "";
  const require_ = (id) => {
    assert.equal(id, "node:fs", "the posting step needs nothing but the file it just wrote");
    return { readFileSync: () => current };
  };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const fn = new AsyncFunction("github", "context", "require", script);
  for (const body of bodies) {
    current = body;
    await fn(github, context, require_);
  }
  return comments;
}

for (const file of FILES) {
  test(file.label + ": the second push updates the comment instead of adding one", async () => {
    const script = blockUnder(read(file), "script");
    const after = await post(script, ["## first summary\n", "## second summary\n"]);
    assert.equal(after.length, 1, "a new comment on every push turns a busy pull request into a wall");
    assert.match(after[0].body, /second summary/, "the comment still shows the first push's summary");
    assert.equal(
      (after[0].body.match(/-pr-summary -->/g) || []).length, 1,
      "the marker was pasted a second time into its own comment",
    );
  });
}

test("positive control: the harness catches a step that appends instead of updating", async () => {
  // Without this, every assertion above would also pass against a harness that
  // silently did nothing. This is the same script with the update branch
  // removed — the shape of the mistake the marker exists to prevent.
  const naive = [
    'const fs = require("node:fs");',
    'const body = fs.readFileSync("summary.md", "utf8");',
    "const { owner, repo } = context.repo;",
    "await github.rest.issues.createComment({ owner, repo, issue_number: context.issue.number, body });",
  ].join("\n");
  const after = await post(naive, ["one\n", "two\n"]);
  assert.equal(after.length, 2, "the harness cannot tell an append from an update");
});

test("positive control: a renamed flag breaks the workflow's invocation", () => {
  // The invocation check is only worth its line if it can fail. `--since` is
  // what `--base` would plausibly be renamed to.
  const mutated = read(FILES[0]).replace("--base", "--since");
  const tokens = invocations(mutated)[0];
  assert.throws(
    () => parsePrSummaryArgs(tokens.slice(tokens.indexOf("pr-summary") + 1)),
    /unknown flag: --since/,
  );
});

// ── The markdown a pull request will render ───────────────────────────────

test("the summary is a well-formed GFM table — the same count in every row", () => {
  // What "renders correctly as a comment" reduces to, for a table: a header, a
  // delimiter row, and body rows that all declare the same number of cells.
  // GitHub drops the surplus and pads the shortfall silently, so a miscounted
  // row looks like data that went missing.
  const md = renderMarkdown({
    scanned: true, reason: "ok", base: "main", cost: null,
    engaged: { tasks: [{ task: "TL-1", minutes: 9 }], unknownRatio: 0 },
    tasks: [
      summarizeTask("TL-1", [
        { field: "status", from: "pending", to: "done", actor: "agent:x", reason: "proven", source: "done" },
      ], { title: "A | title | with pipes", status: "done", estimate: "2h" }),
      summarizeTask("TL-2", [], { title: "Another", status: "pending" }, "added"),
    ],
  });

  let header = null;
  for (const line of md.split("\n")) {
    if (!line.startsWith("|")) { header = null; continue; }
    const cells = line.slice(1, -1).split(/(?<!\\)\|/).length;
    if (header === null) { header = cells; continue; }
    assert.equal(cells, header, "a row with a different cell count than its header: " + line);
  }
  // A line indented by four spaces is a code block, not prose, and swallows
  // whatever follows it.
  for (const line of md.split("\n")) assert.ok(!/^ {4}\S/.test(line), "an accidental code block: " + line);
});
