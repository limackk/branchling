# The licence, the contribution model, and the open/cloud line

**Status: decided, 2026-09-02.** Decided by the owner; written down here by the
session that asked. This is the document a maintainer points at when a pull
request arrives, and the one a contributor reads before writing one.

It exists because of a date, not a priority. From the first accepted pull
request, every one of these answers requires the agreement of every contributor
to change. The decision does not get more expensive — it stops being available.

Already settled elsewhere and NOT reopened here: the tool is under **MIT**
(TL-48, 2026-09-01), and MIT and Apache-2.0 were shown there to be identical on
the only axis a cloud service cares about — both let a competitor run a service
on this code. AGPL and BSL/SSPL were rejected there with reasons. What follows
starts from that conclusion: **the service is protected by architecture and by
the name, never by the licence of the CLI.**

---

## 1. Do we accept outside contributions? — Yes, under a DCO

Contributions are welcome. Every commit carries a `Signed-off-by:` line
certifying the [Developer Certificate of Origin](https://developercertificate.org/)
1.1 — in practice, `git commit -s`.

```
Signed-off-by: Jane Doe <jane@example.com>
```

The DCO is a statement, not a transfer: the contributor says they have the right
to submit the code and that it goes out under the project's licence. Nothing
moves ownership.

**What this answer takes away.** The right to relicense. Once outside commits
are in, the code is co-owned, and any change of licence — including issuing the
same code commercially — needs the agreement of every contributor individually.
That is the cost of a DCO, and it is being paid deliberately: see §3.

A CLA was considered and rejected. It is the only instrument that keeps
relicensing available, and it buys that by asking every contributor to sign a
legal document before their first patch. For a tool whose adoption path is "drop
it into your own repository and see", that toll is paid by exactly the people
whose first contribution is a typo fix.

## 2. Dual licensing (the same code under MIT and a commercial licence)? — No

Ruled out. The code is MIT and stays MIT.

**What this answer takes away.** The option of ever selling this code under
other terms, and with it the usual "open core with a paid edition of the same
binary" business model. It follows from §1 rather than standing beside it: a DCO
makes dual licensing impossible in practice anyway, so keeping the question open
would have been a fiction.

**What it buys.** A contributor is never in the position of donating work that
someone else then sells under different terms — the asymmetry that makes
CLA-backed projects tiring to contribute to. And the project needs no
copyright-assignment paperwork, ever.

## 3. Where does the open/cloud line run?

The line is drawn by **scope, not by location**. Everything that serves one
person working in one clone is open source, permanently. The service sells what
needs a party that is not that person's machine: other people, other clones, and
the state that has to be shared between them.

That the paid side *could* also run locally is not an argument for putting it in
the CLI. Multi-user coordination is where the service's value is, and a version
of it in the open tool would be a competitor to it written by us.

### Open, permanently — never moved behind a paid boundary

- Reading, writing and closing tasks: `new`, `take`, `next`, `done`, `handoff`,
  `query`, `stats`, `plan`, `board`, `history`.
- The whole file format: task markdown, `config.yaml`, `boards.yaml`,
  `plan.yaml`, `backlog/history/*.jsonl`. A format nobody else can read is a
  tracker with a lock on it, which is what this project rejected external
  trackers for.
- Every guard `check` runs, and the test suite that holds them.
- The viewer as a generated, self-contained page, and `serve` bound to
  loopback — the single-machine viewer with its editing and its history.
- The unattended loop: `run`, the lock, the exit codes, the cross-branch scan.
- `init`, `seed`, `migrate-prefix`, `renumber`, `instructions`, the skills and
  the hooks that ship with the tool.
- `--json` on every reading command and a callable input on every writing one
  (law 4). Composition is the extension mechanism; taking it away would break
  every integration written against it.

### The service — where a paid product may live

- Hosting: a backlog readable and writable by people with no checkout, with
  accounts, sessions and permissions.
- Synchronisation between clones and machines — the case the lock explicitly
  does not cover, because a lockfile and local refs cannot.
- Aggregation across repositories: one queue, one report, many backlogs.
- Team coordination that spans more than one person: shared assignment,
  approvals, roles enforced across sessions, notifications.
- Organisation-level reporting and dashboards for readers who will never run a
  command.
- Anything requiring a server we operate: hosted agent runners, webhooks
  received from outside, integrations authenticated as the organisation.

### How to judge a concrete pull request

Ask in this order, and stop at the first answer:

1. **Does it work in one clone, for the person running it, with no server?**
   Then it belongs in the CLI and the answer is yes, on its merits.
2. **Does it need a party outside that machine** — another user, another clone,
   an account, an operated server? Then it is service territory: say so in the
   issue, explain this document, and do not merge it into the CLI.
3. **Is it a format, an export or a `--json` surface** that would let somebody
   else build case 2 themselves? That is case 1. Openness of the data is the
   project's first law and is not something the service is allowed to eat.

The honest consequence: a contributor may write a good patch for a real need and
be told no because of where it falls. That is why this file is linked from the
README rather than kept in someone's head — a boundary discovered at review time
is a boundary that wasted somebody's weekend.

## 4. The name

Not a licence question, and stated here because it is the other half of the
protection. MIT grants no rights to the project's name, and neither does any
other copyright licence. The name is therefore the one asset that separates this
project from a fork of it stood up beside it as a service. TL-81 tracks it.

---

## For contributors, in short

- The code is MIT. Your contribution goes out under MIT.
- Sign your commits off: `git commit -s`. No CLA, no paperwork.
- Before writing anything large, check §3 — the CLI is the single-machine tool,
  and coordination between people is out of its scope on purpose.
- The project's own backlog is in `backlog/`. An issue that turns into a task
  gets a file there, which is how it becomes work anyone can pick up.
