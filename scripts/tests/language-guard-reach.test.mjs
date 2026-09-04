/**
 * The guard reads the configuration files it says it reads (TL-198).
 *
 * WHAT TL-201 CLOSED AND WHAT IT DID NOT. `Tryb snapshot` shipped in the
 * viewer's connection bar past every signal the guard had — no accent, no
 * digraph, no inflected ending, on neither word list — and TL-201 answered it
 * with a dictionary: a word this project has never written is unknown, and an
 * unknown word fails. That closes the WORD half of TL-198 by construction.
 *
 * THE HALF STILL OPEN IS THE FILE HALF. A word can only be judged on a line
 * somebody opened, and `walk()` in `scripts/check-public-language.mjs` collects
 * `.mjs`, `.js` and `.md` — nothing else. `backlog/config.yaml`,
 * `backlog/plan.yaml` and `backlog/boards.yaml` are therefore never opened,
 * while the header of that same file states they are covered "as a side effect
 * of adding the directory", and CLAUDE.md says the guard reads "the whole
 * `backlog/` directory". Measured on 2026-09-04: a tree whose only public file
 * is a `backlog/config.yaml` carrying a Polish label is audited as 0 files,
 * 0 lines, 0 findings — and 0 findings is what the tick is printed over.
 *
 * WHY THESE THREE FILES AND NOT ANY FILE WITH A COLON IN IT. `config.yaml`
 * holds this project's VOCABULARY — the status names, the labels, the board
 * titles — under law 3, which is the whole reason they are not literals in the
 * code. That text is read by a stranger before any comment in `scripts/` is,
 * and it is the one part of the public surface where a label is written by
 * hand, in a hurry, in whatever language the author was thinking in. It is the
 * shape of every earlier miss this guard has been widened for: the text with
 * the least around it for a detector to hold on to.
 *
 * WHAT THIS FILE DOES NOT DECIDE. Which of `backlog/`'s YAML files the walk
 * should take is the implementing hand's problem, and it is not "all of them":
 * `NOW.yaml`, `INDEX.yaml`, `archive/done.yaml` and `boards/` are COMPUTED
 * views, deletable by law 2, and dragging a generated file into a guard makes
 * the guard fail on output rather than on a decision anybody took. The
 * assertions below name only the three files the guard's own header claims,
 * and they name a Polish label in them — never a line count, never a walk, and
 * never a list of extensions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ALLOW_MARKER, auditTree } from "../check-public-language.mjs";

import { isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166), as every test file here
// does: one call covers every case, and without it a test reads the
// developer's own configuration and the suite answers differently on
// different machines.
isolateHome("language-guard-reach");

/** A throwaway tree in the shape `auditTree()` walks. */
function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "branchling-lang-reach-"));
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, text);
  }
  return dir;
}

function withFixture(files, body) {
  const dir = fixture(files);
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── The positive control comes first ──────────────────────────────────────

// A guard that passes on a zero sample is green with no evidentiary force, and
// every assertion below is about a file the walk does NOT open — so the first
// thing to prove is that this harness opens anything at all. Same throwaway
// root, same `backlog/` directory, one file the walk already collects.
test("POSITIVE CONTROL: the fixture tree is really walked", () => {
  withFixture(
    {
      // language-guard: allow — deliberately Polish, the sample this control plants
      "backlog/tasks/TL-9998-fixture.md": "---\nid: TL-9998\n---\n\nTen plik nie jest po angielsku.\n",
    },
    (dir) => {
      const { findings, filesChecked } = auditTree(dir);
      assert.equal(filesChecked, 1, "the fixture root was not walked at all");
      assert.ok(
        findings.some((f) => f.file.includes("TL-9998-fixture.md")),
        "a Polish task file in the fixture was not reported — this harness proves nothing"
      );
    }
  );
});

// ── What is still missed ──────────────────────────────────────────────────

test("FINDS: a Polish label in backlog/config.yaml, where the vocabulary lives", () => {
  withFixture(
    {
      // language-guard: allow — deliberately Polish, the sample this test plants
      "backlog/config.yaml": 'statuses:\n  - id: open\n    label: "Otwarte zadania"\n',
    },
    (dir) => {
      const { findings } = auditTree(dir);
      assert.ok(
        findings.some((f) => f.file.includes("config.yaml")),
        "a Polish status label in backlog/config.yaml was reported as clean — the guard never opened the file that holds this project's own words"
      );
    }
  );
});

test("FINDS: a Polish line in backlog/plan.yaml and in backlog/boards.yaml", () => {
  withFixture(
    {
      // language-guard: allow — deliberately Polish, the sample this test plants
      "backlog/plan.yaml": 'waves:\n  - name: "Nowa fala"\n    rationale: "Kolejnosc wykonania"\n',
      // language-guard: allow — deliberately Polish, the sample this test plants
      "backlog/boards.yaml": 'boards:\n  - slug: main\n    title: "Tablica glowna"\n',
    },
    (dir) => {
      const { findings } = auditTree(dir);
      const hit = (name) => findings.some((f) => f.file.includes(name));
      assert.ok(hit("plan.yaml"), "a Polish line in backlog/plan.yaml was reported as clean");
      assert.ok(hit("boards.yaml"), "a Polish line in backlog/boards.yaml was reported as clean");
    }
  );
});

test("the exception marker still works in a file the guard has just started reading", () => {
  // ONE finding, not two: the marked line is a decision written down, the
  // unmarked one is the defect. Asserting the count is what makes this a test
  // of reach rather than of silence — a walk that opens nothing answers zero.
  withFixture(
    {
      "backlog/config.yaml":
        "statuses:\n" +
        // language-guard: allow — deliberately Polish, the sample this test plants
        `  # ${ALLOW_MARKER} — quoted historical output\n  # Zapisano zmiany w pliku\n` +
        // language-guard: allow — deliberately Polish, the sample this test plants
        '  - id: open\n    label: "Otwarte zadania"\n',
    },
    (dir) => {
      const { findings } = auditTree(dir);
      assert.equal(
        findings.length,
        1,
        `expected exactly one finding — the unmarked label — and got ${findings.length}`
      );
      // language-guard: allow — the Polish sample is what the assertion names
      assert.match(findings[0].text, /Otwarte/);
    }
  );
});

// ── The control against a guard that flags everything ─────────────────────

test("SILENT: an English configuration file is not a finding", () => {
  // The fix may not be "every line of YAML is suspect". This one is silent
  // today for the wrong reason — the file is never opened — and stays silent
  // afterwards for the right one; it is here so the widening cannot be a guard
  // that flags the config file it was pointed at.
  withFixture(
    {
      "backlog/config.yaml": [
        'prefix: "TL"',
        "statuses:",
        "  - id: pending",
        '    label: "Pending"',
        "  - id: done",
        '    label: "Done"',
        "",
      ].join("\n"),
      "backlog/boards.yaml": ["boards:", "  - slug: main", '    title: "Main board"', ""].join("\n"),
    },
    (dir) => {
      assert.deepEqual(auditTree(dir).findings, [], "ordinary English configuration was flagged");
    }
  );
});
