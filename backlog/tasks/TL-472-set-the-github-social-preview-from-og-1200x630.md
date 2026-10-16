---
id: TL-472
title: "Set the GitHub social preview from og-1200x630"
type: task
labels: []
board: main
epic: "Brand identity"
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 30m
confidence: medium                 # how much you trust the estimate
created: 2026-10-16
updated: 2026-10-16
blocked_by: [TL-469]                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [docs/repository-metadata.md]                   # paths relative to the repository root
verification:
  - id: metadata-names-image
    bash: "test -f docs/brand/social/og-1200x630.png && grep -q 'docs/brand/social/og-1200x630.png' docs/repository-metadata.md && ! grep -q 'Leave the custom social preview unset' docs/repository-metadata.md"
  - id: github-uses-custom-preview
    bash: "gh api graphql -f query='{repository(owner:"limackk",name:"branchling"){usesCustomOpenGraphImage}}' --jq .data.repository.usesCustomOpenGraphImage | grep -qx true"
---

## Goal

The GitHub repository `limackk/branchling` shows a custom social preview made from `docs/brand/social/og-1200x630.png`, and `docs/repository-metadata.md` names that versioned file as the canonical image instead of telling the owner to leave the preview unset.

## Context

Depends on TL-469, which versions `docs/brand/social/og-1200x630.png` (1200x630, the size GitHub recommends; it must stay under 1 MB).

`docs/repository-metadata.md` currently says, in its owner-reviewed checklist, to leave the custom social preview unset 'until a stable public image is versioned in the repository'. Once the brand import lands, that condition is met, so the document has to change in the same task that changes the setting — otherwise the document and GitHub disagree.

The setting is external state. GitHub offers no REST or GraphQL mutation for uploading a social preview; it is set by the owner in the repository's Settings → General → Social preview. That step is a human's; an agent can prepare the document and verify the result. The GraphQL field `usesCustomOpenGraphImage` on `Repository` reads whether a custom image is set.

The repository must be reachable by `gh` with the owner's credentials for the verification to run; if the repository is still private, a social preview is visible only to people with access, which is worth noting in the document.

## Steps

1. Update `docs/repository-metadata.md`: replace the 'leave unset' line with the canonical image path and the rule that the uploaded image must be the versioned file.
2. Owner uploads `docs/brand/social/og-1200x630.png` in GitHub Settings → General → Social preview.
3. Confirm with the GraphQL query in the verification, and open the repository URL signed out (or in a link-preview tool) to see the card.

## Acceptance criteria

- [ ] The repository metadata document names the versioned social preview image and no longer says to leave it unset. [proof: metadata-names-image]
- [ ] GitHub reports that the repository uses a custom social preview image. [proof: github-uses-custom-preview]
