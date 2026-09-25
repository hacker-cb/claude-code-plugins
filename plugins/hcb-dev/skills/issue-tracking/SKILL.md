---
name: issue-tracking
description: >-
  Keep deferred work in the forge's issue tracker — open one, update one, classify
  it, decompose it, close it. Use it when the user asks to file, update or triage
  an issue, ticket, bug or piece of tech debt; when something surfaces outside the
  current task that will not be fixed now — a defect, a missing test, a
  duplication, a TODO left behind; before substantive work, to find the issue that
  already covers it; when the user asks whether an issue is still current — still
  true of the code ("#42 ещё актуален?"); when the user asks what to pick up next —
  though a survey of the whole backlog is `hcb-dev:backlog-survey`; and when a
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
**Paths**, substituted at invocation — use verbatim: `<plugin root>` is `${CLAUDE_PLUGIN_ROOT}`.

## What earns an issue

- **Deferred work** — a defect, a follow-up, tech debt: consciously left for
  later, or found in passing and left alone by the test in
  [`../../references/findings.md`](../../references/findings.md).
- **Work conceived and finished in the same effort earns none** — the change
  request and `git log` already record it.
- **Open-ended architectural direction** belongs to the project's roadmap.
- **An epic's umbrella and its waves** are the coordination's own, filed by
  `hcb-dev:master-session` ([`../../references/epic-structure.md`](../../references/epic-structure.md)).

## Searching the tracker

A finding out of work on an issue is measured against that issue first
(`../../references/findings.md`); the search here runs on what that leaves.

Closed ones too — a finding already decided against must not return under a new
number, with the decision left behind on the old one.

Both answer a page, and a cap they do not announce
([`../../references/forge-behaviour.md`](../../references/forge-behaviour.md)) — a
search that silently ends at the first page reads as "nothing covers this". Read
on past a full page, and narrow the terms of a search that came back at its cap.
Each hit arrives with its state, and on GitHub its state reason, in that same
call; what closed a closed one, which the table below turns on, is read for that
hit alone.

```bash
# GitHub — --state all, or gh adds state:open itself; 1 000 hits is the cap, not a total
gh issue list --state all --limit 1000 --search "<terms>" \
  --json number,title,state,stateReason,url
# GitLab — -A is every state, not every page, and -P stops at 100: after a full page, -p 2
HITS="$(glab issue list -A -P 100 -p <page> --search "<terms>" --output json)" \
  && jq -c '.[] | {iid, title, state, web_url}' <<<"$HITS"   # captured: jq alone exits 0 on nothing
```

Three outcomes — **covered** → cite it and open nothing; **covered, but the
finding adds something** (new facts, wider scope, a changed trigger) → update it;
**not covered** → open one. The first two are for an open issue; a closed one goes
by the table below.

## What a closed issue takes

An issue's state is the one it stands in **once the work in hand lands** — a
closing keyword the forge will act on counting as closed, and a ruling decided
cold being read after that landing. A closed issue takes no comment as the
record. What closed it decides instead — the change, the words, the label on the
closure, never its closed state alone — measured against what the issue says
rather than what its fix touched, the same for a search hit and for the issue a
finding came out of:

| what closed it | the record |
|---|---|
| **done**, and the finding lies beside what the issue set out to settle — another input, another path, a part left for later, a consequence of the fix | a finding of its own — searched, weighed and proposed like any other — linked both ways |
| **done**, and what the issue says is fixed is not — the same defect back included | **INTO** it, reopened, naming what does not hold |
| **another issue** — a duplicate, a rewrite, a split | the issue that took this finding's part is the target: open, **INTO** it; closed, this table again. None having taken it, a finding of its own |
| **a decision against it** | the decision stands: **DROP** citing it, unless the finding carries what overturns it — and then **INTO** it, reopened, proposed as the reversal it is |
| **nothing that decided anything** — a sweep, a timeout | **INTO** it, reopened |

## What goes in the issue

Body: **what is deferred**, identifiers and paths verbatim · **the trigger** that
should reopen attention · **what it costs to never do it**, in one sentence ·
**the source** (`<file>:<line>`, a change request, an audit date) — for a finding, with the
`Verified` cell it carried and the revision it was read at. What it waits on is an edge (below).

Where nothing triggers a return, the priority is what says when to pick it up —
one carrying neither is not deferred work, and is not opened.

Language follows the project; where nothing states one, the **newest** issues
carry the convention — read the top of the newest-first list
[`../../references/classification.md`](../../references/classification.md) gives,
and the bodies of those issues (the deep tier) where their titles do not settle
it; never the lowest numbers and never a relevance-ranked search hit. Identifiers
and paths stay verbatim whatever the language.

Labels, native types and milestones — that same reference, before applying any of
them; proposing one the repository lacks is
[`../../references/label-model.md`](../../references/label-model.md)'s.

## Hierarchy and dependencies are separate questions

**Hierarchy** — one child per independently completable piece, the labels of both per
[`../../references/label-lifecycle.md`](../../references/label-lifecycle.md); written per
[`../../references/forge-docs.md`](../../references/forge-docs.md).

**Dependencies** — what blocks what: when an edge is written, in what, and what stands in
where the forge carries none is [`../../references/issue-links.md`](../../references/issue-links.md).

## Consult the backlog at three moments

- **Before substantive work** — a multi-file change, a new capability, a refactor.
  Covered → say so and let the change request close it. Not covered → do the work,
  and open something only for what you defer along the way.
- **When a discussion lands on a topic** — search that area and bring what you
  find into the conversation; issues carry prior decisions and deferred scope.
- **When asked what to pick up** — surface the candidates with reasoning instead
  of choosing one. An issue whose parked reason still holds, or that an open blocker
  holds, is waiting, not ready. This is the single-pick question; a whole slice is
  `hcb-dev:backlog-survey`.

## Is it still true?

Asked whether one issue or a few still hold — "is #42 still current?", "перепроверь #42" — rule
each by [`../../references/issue-currency.md`](../../references/issue-currency.md): one of its four
verdicts, with the coordinate on the refreshed base it stands on. A verdict past `current` is
proposed with the edit it calls for — the body rewritten, the issue closed or reclassified — and
made only on the answer below; an `unverifiable` one carries its reason and proposes no closure at
all. A whole slice is `hcb-dev:backlog-survey`'s.

## Citing and closing

Where a bare `#N` would not autolink — documentation, code comments, anything read
outside its own issue or change request — write `[#N](<url>)`.

The closing keyword goes into the change request body per
[`../../references/merge-message.md`](../../references/merge-message.md), and closes
the issue **only where the forge acts on it** (`../../references/forge-docs.md`).
Where it will not, and wherever the work completes with no change request at all,
close or link the issue explicitly once the work lands, with the user's go-ahead —
the close carrying what settled it, which the table above reads back, and the labels
an issue takes at close (`label-lifecycle.md`):

```bash
# The comment goes from a file: inline in quotes, the shell runs the backquotes it holds.
# GitHub — completed | not planned; a duplicate: --reason duplicate --duplicate-of <m>
gh issue comment <n> --body-file "<file>" && gh issue close <n> --reason "<reason>"
# GitLab — the close takes no reason, so the comment carries it; -F reads the file, -f not
glab api "projects/<project>/issues/<n>/notes" -F body=@"<file>" && glab issue close <n>
```

In a set, each child
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
was given for, never what turns up afterwards. The label writes `label-lifecycle.md` names ride
on another answer instead.

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
  it before applying anything to an issue; [`../../references/label-model.md`](../../references/label-model.md) before proposing one.
- [`../../references/findings.md`](../../references/findings.md) — read
  it before proposing an out-of-scope finding: it owns the rating, the scope test
  and the outcome each one ends in.
- [`../../references/issue-currency.md`](../../references/issue-currency.md) — read it
  before ruling whether an issue is still true.
- [`../../references/issue-links.md`](../../references/issue-links.md) — read it
  before filing or splitting an issue that waits on another.
- [`../../references/forge-docs.md`](../../references/forge-docs.md) — read it
  before writing an invocation this skill does not spell out.
