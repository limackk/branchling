---
id: TL-179
title: "A trademark clearance search for the published name is not a curl away"
type: task
labels: [pre-launch]
board: main
epic: "Backlog — open source publication"
priority: P1
status: pending
owner: unassigned
role: ""
executor: human
estimate: 3h
confidence: low
created: 2026-09-03
updated: 2026-09-03
blocked_by: []
blocks: []
related_docs:
  - docs/license-and-contributions.md
verification:
  - id: the-registers
    manual: "For the name this project publishes under, the task records a dated result from EUIPO, USPTO and WIPO for the software and SaaS classes (Nice 9 and 42), each with the query and the source it was read from."
---

## Goal

Know whether the name this project publishes under is claimed as a registered
trademark for software or SaaS by anybody — above all by TaPo-IT OG, who has
operated "WorkTrail" as a commercial time-tracking service since 2013. The
deliverable is a dated, sourced result per register, not a reassurance.

## Context

**Why `executor: human` (TL-218).** The act only a person can perform is
running the register searches and standing behind the result. As the section
below records, all four machine routes were tried on 2026-09-03 and all four
refused: what is left is an OAuth credential somebody registers for, a session
in a browser a person is sitting at, or a professional search — and the output
is a dated legal clearance, which is a judgement with a name attached rather
than a query result. Drafting the queries, the classes and the place the finding
goes is agent work; being the person the clearance belongs to is not.

Surfaced 2026-09-03 in
[TL-169](TL-169-the-name-worktrail-is-already-a-github-organisation-the.md),  <!-- former-name: allow -->
which established what `github.com/worktrail` is and could not establish this.  <!-- former-name: allow -->
It is separate work, not a loose end of that task: TL-169 answers a question of
fact about one organisation, this one is a search across legal registers whose
result may be that a professional has to run it.

**Why it decides something.**
[TL-81](TL-81-kanaly-dystrybucji-i-kolizja-nazwy-tasklog-w-npx.md) raised the  <!-- former-name: allow -->
name from a label to a business asset with an argument that only works one way
round: under MIT, the licence does not stop a competitor standing a service up
on this code, so **the name is the only thing stopping them standing it up
under this identity** — see
[`docs/license-and-contributions.md`](../../docs/license-and-contributions.md)
§3 for where that line runs. A name somebody else has registered for the same
class of goods is not that asset. It is the reverse: a liability that grows
with every user who installs under it.

**Why it is not a `curl`.** Tried on 2026-09-03 and all four failed, which is
the reason this is three hours and not ten minutes: USPTO's search API refuses
`POST` (405), `trademarks.justia.com` answers a Cloudflare challenge (403),
WIPO's Global Brand Database serves its single-page shell to any API path, and
`euipo.europa.eu` and `tmdn.org` both reset the connection. EUIPO's own API is
OAuth-gated. So this needs either a registered API credential, a session in a
browser a person is sitting at, or a professional search — and choosing between
those is part of the task.

A negative result here is worth as much as a positive one, but only if it is
dated and says which registers and which classes it covers. "Nothing found" with
no scope attached is the shape of answer that gets re-asked at every release.

## Pre-flight reading

1. `backlog/tasks/TL-169-the-name-worktrail-is-already-a-github-organisation-the.md` — the `## Findings` section: who TaPo-IT OG are, what they operate, and exactly which register lookups failed and how.  <!-- former-name: allow -->
2. `backlog/tasks/TL-81-kanaly-dystrybucji-i-kolizja-nazwy-tasklog-w-npx.md` — the argument that makes the name a business asset rather than a label.  <!-- former-name: allow -->
3. `docs/license-and-contributions.md` §3 — the open/cloud line, which is the class of goods the search has to cover.
4. `.claude/skills/branchling-release/SKILL.md` §7 — where the finding belongs once it exists.

## Steps

1. Settle the scope first: which registers (EUIPO, USPTO, WIPO/Madrid at minimum, given an Austrian incumbent and a US-facing launch) and which Nice classes (9 and 42 for software and SaaS). Write the scope down before searching, so the result has a boundary.
2. Choose the route — a credentialed API, a manual search a person runs, or a paid clearance — and record why the others were rejected.
3. Run it for the name currently in `package.json`, and record each result with its query, its date and its source. Include a direct look for TaPo-IT OG as proprietor.
4. If a mark is found, do not decide the consequence here: hand it back to the naming decision in [TL-20](TL-20-domknij-nazwe-narzedzia-przed-publikacja.md) the way TL-169 does.
5. Add the check to the pre-publication gate as a step with a route attached, so the next name is not cleared with a `curl` that cannot reach a register.

## Acceptance criteria

- [ ] The scope — registers and classes — is written down before the result, and the result states it. [proof: the-registers]
- [ ] Each register has a dated answer with the query and the source it was read from; "nothing found" is acceptable, "probably fine" is not.
- [ ] Whether TaPo-IT OG holds a mark on this name is answered explicitly, not left to a general search.
- [ ] The route chosen is recorded together with the reason the other two were rejected.
- [ ] The pre-publication gate names this check and the route that actually reaches a register.

## Decisions

- **This does not block publication by itself.** It informs the naming decision;
  the decision stays in TL-20 and its consequences stay with the owner.
- **`executor: human`.** Every machine route into the registers was closed on
  2026-09-03, and the one that is not — a browser session, or engaging somebody
  to search — needs a person who can hold an account or sign an engagement.
