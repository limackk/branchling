# First-contact demo — 60 seconds

The script for the recording that sits in the README's header. **This file
is executable in the literal sense**:
`scripts/tests/demo-scenario.test.mjs` replays the commands below on every
test run and fails if the CLI stops behaving the way this document describes.
A screenshot rots silently; this scenario does not.

## What the viewer should see

One scene that no other tool in this category can record: **`branchling done`
REFUSES to close a task**, because its own verification failed. It shows the
test's output, leaves the file untouched, and says so outright. Only after
the code is fixed does the same call succeed and tick the criterion itself.

The order is the reverse of a typical demo — **failure comes first**. Success
with no preceding refusal looks like every other tracker.

Everything visible on screen — commands, comments, task content — is in
English. The recording travels into other people's repositories, like the
rest of the public surface.

## Recording conditions

- A fresh, empty directory with `git init` — the viewer should see a start
  from zero.
- The `branchling` binary on `PATH` (`npm link` or a global install). The
  recording must never show `node …/scripts/cli.mjs` — that is a developer
  path, not how the tool is used.
- The prompt shortened to one character; a wide terminal (min. 100 columns),
  so the red refusal block does not wrap mid-sentence.

## Scenario

### Scene 0 — start from zero (~8 s)

```bash
mkdir parser && cd parser && git init -q
branchling init --dir ./backlog
```

Expected: a list of created directories and one `next:` line.

### Scene 1 — a task that promises proof (~12 s)

```bash
branchling new --title "Parser accepts an empty file"
```

In the generated file we swap two things from the template — the only
manual edit in the whole recording:

```yaml
verification:
  - id: empty-file
    bash: "node --test parse.test.mjs"
```

```markdown
- [ ] `parse("")` returns no rows. [proof: empty-file]
```

and `status: in_progress`.

That is the whole contract: the criterion points to the verification entry
that proves it.

### Scene 2 — code that "almost" works (~8 s)

`parse.mjs`:

```js
export function parse(text) {
  return text.split("\n").map((line) => line.trim());
}
```

`parse.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "./parse.mjs";

test("an empty file parses to no rows", () => {
  const rows = parse("");
  assert.equal(rows.length, 0, `expected 0 rows, got ${JSON.stringify(rows)}`);
});
```

Empty text splits into one empty line. The bug is unambiguous and fits on
screen — it is not the point here.

### Scene 3 — REFUSAL (~18 s, this is the whole point)

```bash
branchling done TASK-2
```

Expected output, in this order:

```
  TASK-2 — 1 verification entry, run in /…/parser

  1/1  empty-file  bash: node --test parse.test.mjs
✖ an empty file parses to no rows
  AssertionError [ERR_ASSERTION]: expected 0 rows, got [""]
  …

✗ branchling done: TASK-2: verification failed (exit 1)
  `node --test parse.test.mjs`

  The task file was NOT touched — its status is still `in_progress`.
```

Exit code: **non-zero**. Three things must be legible on the freeze frame:
the command that failed, the real test's output, and the sentence about the
untouched file. That last line is the whole tool's thesis — status is not a
declaration.

If the recording gets one frame in the GIF thumbnail, this is it.

### Scene 4 — the fix and a green close (~14 s)

```js
export function parse(text) {
  if (text.trim() === "") return [];
  return text.split("\n").map((line) => line.trim());
}
```

```bash
branchling done TASK-2
```

Expected:

```
  1/1  empty-file  bash: node --test parse.test.mjs
  ✓ passed

  ✓ TASK-2 closed — status in_progress → done
    ticked 1 criterion from the run
```

### Scene 5 — who ticked it (~6 s)

```bash
git diff --stat
```

The criterion is ticked `[x]`, `## Log` has a new line, and the entry in
`backlog/history/` says who and by what. Nobody clicked "done".

## Out of frame

- No tour of commands. `query`, `stats`, the viewer — not in this recording.
- No speeding up scene 3; the viewer needs time to read the refusal.
- The recording files (`.cast`, `.gif`) **do not ship in the npm package** —
  `files` in `package.json` is an allowlist and does not include `docs/`.
  For the same reason the link in the README must be an absolute URL: the
  README ships in the tarball, and a relative path would be dead there.
