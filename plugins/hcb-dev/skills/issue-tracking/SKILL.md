---
name: issue-tracking
description: >-
  Keep deferred work in the forge's issue tracker — open one, update one, classify
  it, decompose it, close it. Use it when the user asks to file, update or triage
  an issue, ticket, bug or piece of tech debt; when something surfaces outside the
  current task that will not be fixed now — a defect, a missing test, a
  duplication, a TODO left behind; before substantive work, to find the issue that
  already covers it; when the user asks what to pick up next; and when a
  discussion lands on a topic whose earlier decisions may sit in an issue. GitHub
  and GitLab alike. Not for implementing an issue
  (`hcb-dev:implementation-workflow`), not for completing finished work
  (`hcb-dev:shipping-workflow`), and not a review of a diff
  (`hcb-dev:multi-review`) — each of those calls this skill where it needs the
  tracker.
---

# Issue tracking

The backlog holds work you are **not** doing now. Detect the forge from the remote
and what answers there, never from the hostname.

## What earns an issue

- **Deferred work** — a defect, a follow-up, tech debt: found in passing, or
  consciously left for later.
- **Work conceived and finished in the same effort earns none** — the change
  request and `git log` already record it.
- **Open-ended architectural direction** belongs to the project's roadmap.

## Search before opening

Closed ones too — a finding already decided against must not return under a new
number, with the decision left behind on the old one.

Both stop at a small default page, so ask for more than the tracker is likely to
return — a search that silently ends at the first page reads as "nothing covers
this".

```bash
# GitHub
gh issue list --state all --limit <n> --search "<terms>"
# GitLab
glab issue list --all --per-page <n> --search "<terms>"
```

Three outcomes — **covered** → cite it and open nothing; **covered, but the
finding adds something** (new facts, wider scope, a changed trigger) → update it;
**not covered** → open one.

## Surfacing a finding

A finding surfaces at the end of the response, under `## Drive-by observations`,
as the user's decision rather than yours:

- **untracked** → `<component> — one line`, and ask **OPEN / DEFER / DISMISS**;
- **tracked, and the finding adds something** → `#N — what changes`, and ask
  **UPDATE #N / DEFER / DISMISS**;
- **tracked as it stands** → no entry; say so where it came up.

Their answer is what opens or updates anything. At the natural end of a session —
the primary work done — re-surface whatever stayed undecided, or it goes with the
session.

## What goes in the issue

Body: **what is deferred**, identifiers and paths verbatim · **the trigger** that
should reopen attention · **the source** (`<file>:<line>`, a change request, an
audit date).

Language follows the project; where nothing states one, match the most recent
issue. Identifiers and paths stay verbatim whatever the language.

Labels, native types and milestones — `references/classification.md`, before
applying any of them and before proposing one the repository lacks.

## Hierarchy and dependencies are separate questions

**Hierarchy** — one child per independently completable piece, and the parent
carries its own kind of work. **Dependencies** — what blocks what.

Both sit past what either CLI's issue commands reach, and the two are separate
mechanisms on both forges — the entry points are in
[`../../references/forge-docs.md`](../../references/forge-docs.md).

## Consult the backlog at three moments

- **Before substantive work** — a multi-file change, a new capability, a refactor.
  Covered → say so and let the change request close it. Not covered → do the work,
  and open something only for what you defer along the way.
- **When a discussion lands on a topic** — search that area and bring what you
  find into the conversation; issues carry prior decisions and deferred scope.
- **When asked what to pick up** — surface the candidates with reasoning instead
  of choosing one. An issue whose parked reason still holds is waiting, not ready.

## Citing and closing

Where a bare `#N` would not autolink — documentation, code comments, anything read
outside its own issue or change request — write `[#N](<url>)`.

A closing keyword in the change request body closes the issue **only where the
forge acts on it** — which it does for a request targeting the default branch, and
not for one targeting a feature branch or any other trunk the repository merges
into. Write the keyword anyway; where the forge will not act on it, and wherever
the work completes with no change request at all, close or link the issue
explicitly once the work lands, with the user's go-ahead. In a set, each child
closes as its slice lands and the parent when the last one does. Follow-ups the
work raised become issues opened in the same effort.

## Reference files

- [`references/classification.md`](references/classification.md) — the label
  families as roles and the cardinality between them, which mechanism carries the
  kind of work in this repository, and milestones where a project uses them. Read
  it before applying anything to an issue.
- [`../../references/forge-docs.md`](../../references/forge-docs.md) — where a
  flag, an endpoint or a concept name gets resolved on either forge, and which
  hierarchy and dependency mechanism each one has. Read it before writing an
  invocation this skill does not spell out.
