# Releasing

A release is a version number, a notes file, a signed tag and one workflow run.
The first two releases were published by hand, and what made them correct was
somebody remembering the steps; this document and
[`.github/workflows/release.yml`](../.github/workflows/release.yml) replace the
memory (TL-455).

## Before the tag

1. **Choose the version.** A change to a flag, a `--json` envelope or a
   `config.yaml` key that adds behaviour is a minor version; a fix that changes
   nothing a caller can name is a patch. While the major version is 0, a change
   that breaks a caller is also a minor version, and its notes say so first.
2. **Write `docs/releases/v<version>.md`.** It is the GitHub release body, so it
   is written for a stranger: one paragraph on what the release is, an
   `## Install or upgrade` block that names the exact version, `## Changes` with
   the task id beside each change, `## Upgrade notes` for anything a caller must
   do or will see differently, and `## Provenance`.
3. **Set `version` in `package.json`.** `scripts/tests/release-notes.test.mjs`
   fails until the notes file for that version exists and its install command
   names it, so the bump and the notes travel in one commit.
4. **Run the publication gate** — the `branchling-release` skill, in order, on
   the commit that will be tagged. Its findings are reported, not fixed
   silently; some of them are the owner's decisions.
5. **Wait for the `test` workflow on that exact commit** to be green on every
   job of the matrix. A local green run is not a substitute: the matrix exists
   because Linux, macOS and Windows disagree about files.

## The tag

```bash
git tag -s v<version> -m "v<version>"
git push origin v<version>
```

Pushing the tag is the publication. It needs the owner's explicit decision at
that moment, however many times it was approved before.

`release.yml` then refuses a tag that does not name the manifest's version or
has no notes, runs the suite and `branchling check` again, publishes to npm
with a provenance attestation, and creates the GitHub release from the same
notes file.

### The registry credential

The repository secret `NPM_TOKEN` holds the token `npm publish` runs with. npm
issues only granular access tokens, and the one that publishes from a workflow
has to satisfy all of these at once:

- it is created by an account that may publish the package — `branchling` is
  owned by the maintainer's personal account, not by the `branchling` npm
  organization, so an organization-scoped token does not cover it;
- it grants **read and write** on the package `branchling`;
- it **bypasses two-factor authentication**, because a workflow cannot answer a
  one-time password;
- the package's *Publishing access* setting allows tokens at all; "require
  two-factor authentication and disallow tokens" refuses every one of them.

A token that misses any of these fails the same way, after the suite, the
guards and the provenance signature have already passed:

```text
npm error 403 403 Forbidden - PUT https://registry.npmjs.org/branchling - You may not perform that action with these credentials.
```

The message does not say which condition failed. v0.2.0 met it twice before
the third token published.

## After the workflow

From a directory outside any clone, against the registry rather than the
checkout:

```bash
npx branchling@<version> --version
npx branchling@<version> init --dir ./scratch-backlog
```

Then confirm that the npm page shows the provenance badge, that the GitHub
release, the tag and the npm version name the same commit, and that the CI
badge in the README resolves to a green run on it. That is the `public-release`
entry of TL-455's contract, and it is a person's check: what a stranger sees is
not something the repository can measure about itself.

## When a release goes wrong

A run that failed before `npm publish` succeeded has published nothing, and
the tag is still right. Fix the cause — for an E403, replace the secret — and
rerun the failed job against the same tag:

```bash
gh run rerun <run-id> --failed
```

Moving or recreating the tag would make the signed tag name something other
than what it named when it was pushed. A rerun signs one more provenance
statement into the transparency log; that is harmless, because only the
statement of the publish that succeeds is attached to the version.

A published version cannot be reused. A broken release is fixed by the next
patch version, never by deleting and republishing the same number; `npm
deprecate branchling@<version> "<reason>"` marks the broken one for anybody
who pinned it.
