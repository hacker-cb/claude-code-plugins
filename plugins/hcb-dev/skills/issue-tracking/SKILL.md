---
name: issue-tracking
description: >-
  Keep deferred work in the forge's issue tracker — open one, update one, classify
  it, decompose it, close it. Use it when the user asks to file, update or triage
  an issue, ticket, bug or piece of tech debt; when something surfaces outside the
  current task that will not be fixed now — a defect, a missing test, a
  duplication, a TODO left behind; before substantive work, to find the issue that
  already covers it; when the user asks what to pick up next — though a survey
  of the whole backlog is `hcb-dev:backlog-survey`; and when a
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

- **Deferred work** — a defect, a follow-up, tech debt: consciously left for
  later, or found in passing and left alone by the test in
  [`../../references/fix-or-surface.md`](../../references/fix-or-surface.md).
- **Work conceived and finished in the same effort earns none** — the change
  request and `git log` already record it. A finding fixed where it was found is
  the same case.
- **Open-ended architectural direction** belongs to the project's roadmap.

## Searching the tracker

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

## What goes in the issue

Body: **what is deferred**, identifiers and paths verbatim · **the trigger** that
should reopen attention · **the source** (`<file>:<line>`, a change request, an
audit date).

Language follows the project; where nothing states one, the **newest** issues
carry the convention — read the top of a list ordered by creation date, never the
lowest numbers and never a relevance-ranked search hit. Identifiers and paths stay
verbatim whatever the language.

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
  of choosing one. An issue whose parked reason still holds is waiting, not
  ready. This is the single-pick question; laying out a whole slice is
  `hcb-dev:backlog-survey`.

## Citing and closing

Where a bare `#N` would not autolink — documentation, code comments, anything read
outside its own issue or change request — write `[#N](<url>)`.

The closing keyword is the forge's own — the word its pattern matches, verbatim,
never translated to match the prose around it. Both forges match English by
default, and only a self-managed instance can be configured to match anything
else; a word outside the pattern matches nothing and reports nothing, so the
issue is simply still open once the merge lands. What each forge matches is
`../../references/forge-docs.md`.

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
  it before applying anything to an issue, and before proposing one.
- [`../../references/fix-or-surface.md`](../../references/fix-or-surface.md) — the
  test deciding whether something found in passing is fixed where it was found or
  left, and, for a left one, what reaches the user, in what form, and what their
  answer authorizes. Read it before writing that proposal.
- [`../../references/forge-docs.md`](../../references/forge-docs.md) — where a
  flag, an endpoint or a concept name gets resolved on either forge, what each
  one matches to close an issue, and which hierarchy and dependency mechanism
  each one has. Read it before writing an invocation this skill does not spell
  out.
