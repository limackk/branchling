# Public repository metadata

The public GitHub card and the npm manifest describe the same product. GitHub
settings are external state, so an owner reviews them before each release
rather than treating a successful local test as proof that they are current.

## Canonical values

- Description: `Git-native task execution for people and coding agents with verification-gated closure.`
- Homepage: `https://github.com/limackk/branchling#readme`
- Topics: `git`, `markdown`, `task-management`, `coding-agents`, `cli`,
  `verification`
- Issues: `https://github.com/limackk/branchling/issues`
- License: `MIT`

The npm keyword list may additionally name the storage format, but the six
topics above are the focused discovery vocabulary shared with GitHub.

## Owner-reviewed checklist

Before a public release, open `https://github.com/limackk/branchling` while
signed out and confirm that:

- the description, homepage and topics match the canonical values above;
- the homepage opens the public README and the issues link opens the public
  issue tracker;
- GitHub identifies the repository license as MIT;
- the landing card is understandable without repository-private context; and
- the social preview uses no private image or generated backlog artifact. Leave
  the custom social preview unset until a stable public image is versioned in
  the repository.

The public settings can be inspected without changing them:

```bash
gh repo view limackk/branchling \
  --json description,homepageUrl,repositoryTopics,url,licenseInfo
```

The local half is checked by:

```bash
node --test scripts/tests/publish-gate.test.mjs \
  scripts/tests/repository-metadata.test.mjs
```
