---
name: branchling-release
description: Run the pre-publication gate for branchling before it is pushed to a public repository, published to npm, or tagged as a release. Checks the license and package metadata, what the tarball actually ships, that no other project's data or vocabulary leaks into the public surface, that user-facing text is English, and that a stranger's first five minutes work. Use this skill for requests like "are we ready to publish", "prepare the release", "cut a version", "publish to npm", "open source this", "check the package contents", or before any commit that changes package.json, README.md, LICENSE or _template.md.
---

# Publication gate

Publication is the one step that cannot be undone quietly. A tarball on npm and
a public git history are both permanent, and both carry whatever was in them at
the moment of the push — including files nobody meant to ship. Run this gate
before the push, not after.

Work through it in order and report what fails rather than fixing silently; some
of these are decisions for the owner, not defects.

## 1. Can anyone legally use it

```bash
ls LICENSE && grep -E '"(license|private)"' package.json
```

`"private": true` blocks publishing entirely, and `"license": "UNLICENSED"` with
no `LICENSE` file means nobody inside a company can adopt it — legal review stops
at the missing file, whatever the README promises. The license choice belongs to
the owner; the gate's job is to make sure a choice was made.

## 2. What the tarball actually contains

```bash
npm pack --dry-run
```

Read every line. The `files` whitelist is the only thing standing between a
public package and this repository's own backlog. Nothing under `tasks/`,
`history/`, `archive/`, `boards/`, and no `config.yaml`, `boards.yaml` or
`viewer.html` may appear.

Then look at what *is* shipped as if you had never seen it. `_template.md` and
`README.md` are the first two files a stranger opens, and shipped content is
public whether or not the code reads it.

## 3. No other project inside the public surface

Build the pattern first — it is project-specific, and writing it out is part of
the check. Include the name of the project this code was extracted from, its
internal hostnames and service names, personal email addresses, and any board or
label vocabulary that belongs to it. Keep the pattern in your head or in a local
scratch file rather than committing it: a public repository that lists the
private names it is scrubbing has published them.

```bash
PAT='name1|name2|internal.example|someone@example.com'
grep -rniE "$PAT" README.md docs/ scripts/ _template.md backlog/config.yaml
```

Two different problems hide here, and both are easy to miss because the files
read fine to someone who knows the history:

**Vocabulary.** A template or README carrying another project's boards, labels,
epics or example tasks tells a new user those are the tool's categories. They
are that project's config values. The tool knows the *shape* of a field; a
config knows its *values* — public files must show the shape.

**Measurements.** A number from a repository nobody can access is not evidence to
a stranger, it is a request for trust, and it still leaks information about the
project it came from. Replace it with the mechanism and a command the reader can
run to measure their own tree. The command is more convincing anyway.

## 4. Is the public text English

```bash
grep -rlE '[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]' scripts/ bin/ README.md _template.md
grep -o 'html lang="[a-z]*"' backlog/viewer.html
```

Everything the user reads — CLI messages, help, errors, README, template
comments, viewer chrome — is public surface. Translate meaning, not words: the
`PO CO` / `DLACZEGO` comment blocks carry measured justifications for design
decisions, and a hurried translation shortens exactly the paragraphs that are
worth keeping. When a comment is long because the reasoning is long, keep it long.

The viewer's `lang` attribute comes from `build-viewer.mjs`; editing the
generated HTML does nothing.

## 5. Does it work

```bash
node --test scripts/tests/*.test.mjs
branchling check
```

Both green, and the test count in `AGENTS.md` updated if it moved.

## 6. A stranger's first five minutes

Run these from a directory that is not this repository — that is the situation
every new user is in, and the one this repo can never reproduce by accident,
because here the code sits above the data.

```bash
cd /tmp && npx --yes <path-to-repo> -- --help     # help without an install
cd /tmp && npx --yes <path-to-repo> -- query      # no backlog here: what happens?
cd /tmp/fresh && npx --yes <path-to-repo> -- init --dir ./backlog
```

What to look for:

- A missing backlog is a **predicted state**, so it must read as a message and an
  exit code, never as an unhandled exception with a stack trace. A stack trace on
  first contact says the tool is broken; this one is not.
- The error names the next command (`--dir`, `BACKLOG_DIR`, `branchling init`).
- Nothing is ever written inside the installed package directory. Co-location is
  the last resort when resolving the data directory, and it must stay silent when
  the code lives in `node_modules`.
- `branchling --version` prints a number that came from the manifest. An invented
  version number ends up in a bug report.

## 6b. Is the demo still telling the truth

The recording in the README header is a frozen claim about how `branchling done`
behaves. Once the wording of the refusal changes, that claim becomes a lie and
nothing says so — a stale recording is worse than none, because it is the first
thing a stranger trusts.

```bash
node --test scripts/tests/demo-scenario.test.mjs
```

That test replays `docs/demo/scenario.md` against the live CLI. It does not
prove the recording matches; it proves the SCRIPT still runs and still produces
the refusal the recording was made of. If it fails, the recording has to be made
again before the release — not after.

Then check by eye, because the test cannot:

- The recording is linked from the README header by an **absolute URL**. README
  ships inside the tarball, and a relative path to `docs/demo/` is dead there —
  `files` is an allowlist and does not carry `docs/`.
- The refusal is on screen long enough to read, and the final frame is the one
  saying the task file was not touched.
- No `node scripts/cli.mjs` anywhere in the recording. That is a developer path,
  not a way to use the tool.

## 7. Name and metadata

If the package name or binary name is still provisional, settle it before the
first publish — the cost rises with every README, alias, skill and external link
that repeats it. Check the registry and the `PATH` collision (`npm view <name>`,
`which <name>`), including binaries installed by *other* packages that would
shadow this one.

`package.json` should also carry `repository`, `bugs`, `homepage`, `keywords`
and `description` before the first publish; without them the npm page is a blank
box, and that is the page a developer reads before deciding whether to try it.

**Check `npx <name>` separately from `npm view <name>`.** A free name in the
registry does not tell you where `npx` lands. `npx` resolves the PACKAGE name,
never the binary name, so a package whose `bin` key differs from its `name`
hands `npx <binary>` to whoever owns that package name. This is not theoretical:
`backlog.md` declares `bin: { backlog: "cli.js" }`, while `backlog` is an
unrelated agent orchestrator by another author — so `npx backlog` runs a
stranger's code, and they had to document it as a trap. The check is one
command, and the only safe answer is that package name and binary name are the
same string:

```bash
npm view <name> name version      # registry: is the name free
cd /tmp && npx --yes <name>       # where npx actually lands today
which <name>                      # PATH: a binary from another package shadowing this one
```

Settled for branchling on 2026-09-01 (TL-81): registry 404, search 0 results,
no `PATH` collision, no Homebrew formula, and `name` == the single `bin` key, so
the trap above cannot open. The name is free but **not reserved** — that window
closes only at the first publish.

**A free registry is not a free name (TL-169).** A package registry answers one
question: can I publish under this string. It says nothing about who already
sells a product called that, and the answer to the second question is the one
that decides whether the name is an asset or a liability. `branchling` was
cleared on npm in 2026-09-01 and turned out on 2026-09-03 to belong, on the
largest forge and on the `.net` domain, to a commercial time-tracking service
running since 2013 — on the same shelf as this tool. Nothing in the checks above
could have caught it, because none of them looks outside npm.

So run these too, and read the ANSWERS rather than the status codes — a 200 on a
forge is the start of the question, not the end of it:

```bash
curl -s https://api.github.com/users/<name>                 # a forge namespace: 200 = someone holds it
curl -s "https://api.github.com/search/repositories?q=<name>&sort=stars"
curl -s -o /dev/null -w '%{http_code}\n' https://gitlab.com/api/v4/groups/<name>
curl -s -o /dev/null -w '%{http_code}\n' https://hub.docker.com/v2/users/<name>/
curl -s -o /dev/null -w '%{http_code}\n' https://pypi.org/pypi/<name>/json
for t in com net org io dev app sh; do host "<name>.$t" >/dev/null 2>&1 \
  && echo "<name>.$t resolves"; done
```

Then read what you found, with three questions in this order:

1. **Is anything behind the namespace?** Follow the `blog`/`homepage` field and
   the repository descriptions. Six repositories named after a product, with
   JIRA and git integrations, are a product; an empty account is an account.
2. **Is it alive?** Not one signal but the spread of them — a renewed TLS
   certificate, the last commit, the last blog post, the copyright year, whether
   the mobile apps are still listed. They disagree, and the disagreement is the
   answer: a live checkout page over a 2015 blog is an incumbent in maintenance,
   which is neither free to take nor safe to ignore.
3. **Is it on this shelf?** Adjacency is what costs, not identity of product. A
   collision in an unrelated field is normal and can be accepted on the record;
   one in developer tooling or project management sends the name back to the
   decision that chose it.

**Record why a collision was ACCEPTED, never that nothing was found.** "Nothing
found" has no scope attached and gets re-asked at every release, which is how a
known fact gets discounted twice — TL-20 saw `github.com/branchling` was taken on
2026-08-29 and wrote it off as "only an account".

**The registers are not part of this and cannot be `curl`ed.** Whether somebody
holds a registered mark on the name is a separate route — USPTO, Justia, WIPO,
EUIPO and TMview all refuse an unauthenticated request — and it is TL-179, not a
line to add to the block above.

**Channels: npm only, decided 2026-09-01 (TL-81).** The README promises
`npm i -g branchling` and `npx branchling`, and nothing else. Homebrew and Nix each
add a release ritual and a second place a version can go stale; a tap lagging the
npm version is worse than no tap. They get their own task when someone asks for
them, not before.

## 8. What developers look for and this repo does not have yet

Not blockers for a private tag, but they are what make a stranger trust the
project enough to run it:

- CI that runs the test suite on every push, with the badge in the README —
  "263 tests pass" is a claim until it is a green check someone else can see.
- `CONTRIBUTING.md` saying how to run the tests and what a good change looks like.
- A `CHANGELOG.md`, or generated release notes, so upgrades are legible.
- Issue templates, and a stated answer to "will you take my pull request".

Report which of these are missing rather than creating them unasked — each is a
commitment the owner has to keep.
