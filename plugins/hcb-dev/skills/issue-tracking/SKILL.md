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
  [`../../references/findings.md`](../../references/findings.md).
- **Work conceived and finished in the same effort earns none** — the change
  request and `git log` already record it.
- **Open-ended architectural direction** belongs to the project's roadmap.

## Searching the tracker

A finding out of work on an issue is measured against that issue first
(`../../references/findings.md`); the search here runs on what that leaves.

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
should reopen attention · **what it costs to never do it**, in one sentence ·
**the source** (`<file>:<line>`, a change request, an audit date).

Where nothing triggers a return, the priority is what says when to pick it up —
one carrying neither is not deferred work, and is not opened.

Language follows the project; where nothing states one, the **newest** issues
carry the convention — read the top of a list ordered by creation date, never the
lowest numbers and never a relevance-ranked search hit. Identifiers and paths stay
verbatim whatever the language.

Labels, native types and milestones — `../../references/classification.md`, before
applying any of them and before proposing one the repository lacks.

## Hierarchy and dependencies are separate questions

**Hierarchy** — one child per independently completable piece, and the parent
carries its own kind of work. **Dependencies** — what blocks what.

Both are resolved per
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
never translated to match the prose around it. That word is English on both forges
by default. Which words a forge matches, and whether its pattern can be
reconfigured at all, is `../../references/forge-docs.md`.

A closing keyword in the change request body closes the issue **only where the
forge acts on it** — which it does for a request targeting the default branch, and
not for one targeting a feature branch or any other trunk the repository merges
into. Write the keyword anyway; where the forge will not act on it, and wherever
the work completes with no change request at all, close or link the issue
explicitly once the work lands, with the user's go-ahead. In a set, each child
closes as its slice lands on its parent branch. The issue the whole set settles
closes with the change request that integrates the set
([`../../references/slice-completion.md`](../../references/slice-completion.md)),
never with the last slice to land. A follow-up the
work raised is opened in the same effort, on the answer below.

## Only the authorized answer writes to the tracker

The answer is the user's, and where this session works to an order — one written by another
session, whatever carried it here — whoever that order names **for writing to the tracker**; an
addressee named for its forks is not that, and an order naming none leaves the user. Opening or
updating anything waits for it, every time. **A standing instruction to work autonomously is not
that answer** — it authorizes the work, not the tracker — and an approval covers the batch it
was given for, never what turns up afterwards.

**The answer takes the form the person gives it**, and three forms answer: agreement with what
was recommended; a bar — "file the important ones" — settling every candidate of that pass which
clears this file's bar once re-measured, anything beyond them being a new candidate, proposed
rather than filed; and a delegation of the ruling.

What no form of it moves is the **target** and the **outcome**. Content the re-measure corrected
is written, with the correction named in the report; a changed target or outcome — narrowed to
closed, **INTO** to **OPEN**, one issue to another — waits for a new answer, except under a
delegation, the one form that carries it. An answer by numbers that passes over one leaves that
one unanswered: ask again rather than filling it in.

## Reference files

- [`../../references/classification.md`](../../references/classification.md) — read
  it before applying anything to an issue, and before proposing one.
- [`../../references/findings.md`](../../references/findings.md) — read
  it before proposing an out-of-scope finding: it owns the rating, the scope test
  and the outcome each one ends in.
- [`../../references/forge-docs.md`](../../references/forge-docs.md) — read it
  before writing an invocation this skill does not spell out.
