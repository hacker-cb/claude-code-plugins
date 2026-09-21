---
name: findings-pass
description: >-
  Rule a run's findings cold and together — verify each one independently, decide the outcome it
  ends in, and show them all in one table whose every row says whether it was verified. Use it
  once a session's work is done and findings it did not fix are still standing, its own or ones
  reported to it; when the user hands over findings from another session ("вот находки из
  сессии — реши по ним", "прогони холодный проход по находкам", "проверь эти находки"); and when
  a master session closes a round with its batches' candidates in hand. Report-only: it edits no
  code and writes nothing to the tracker — every write goes through `hcb-dev:issue-tracking` on
  the user's word. Not a review of a change (`hcb-dev:multi-review`), and never run by a batch
  inside a wave: a batch returns its candidates unverified and its master rules them
  (`hcb-dev:wave-worker`, `hcb-dev:master-session`).
---

# Findings pass

The pass [`../../references/findings.md`](../../references/findings.md) calls *Decided cold*: a
run's candidates read together, against each other and against what the tracker holds, each one
verified before it is ruled, and all of them shown in the table
[`../../references/findings-table.md`](../../references/findings-table.md) fixes. It edits no code
and writes nothing to the tracker. Read
[`../../references/invariants.md`](../../references/invariants.md) first: a check that came back
empty has refuted nothing.
**Paths**, substituted at invocation — use verbatim: `<plugin root>` is `${CLAUDE_PLUGIN_ROOT}`.

## When it runs, and on what

| who | when | the tree each check reads | the candidates |
|---|---|---|---|
| a session working alone | once its work is done — past the last completion, before the report that closes it | the base where the work landed, the branch carrying it where it has not | its own, from this session's context |
| a session handed findings | on the hand-over | the revision each one names, where this session can read it; the refreshed base otherwise | the text handed over |
| a master session | at a round's close — every batch of the round ended, every change request it lands merged | the refreshed base | the ledger's *Candidates*, which `hcb-dev:master-session` keeps |

A batch inside a wave never runs it: its candidates ride its return as `not measured — batch`, at
the revision they were read at. The base is resolved by the ladder in
[`../../references/base-resolution.md`](../../references/base-resolution.md) and refreshed before
any check reads it — a name is not a ref.

## 1. Collect

Every candidate of the run, whatever carried it: a reviewer's report, a step that noticed one while
working on something else, a completed slice's `incidental`, another session's findings table or
observations, a batch's return. Take each as a claim — what, where, the revision it was read at,
the severity its finder gave — and leave the finder's argument behind: it is not a check's input.

One this run already ruled on is not a candidate again (*The same finding twice*): its outcome
stands, and where that outcome was a fix, the fix is what gets looked at.

## 2. Dedupe

By the key `findings.md` fixes — `(file, line)` **and** mechanism. A mechanism behind several
instances is one candidate with its instances listed (*Count before deciding anything else*); one
that came out of work on an issue is measured against that issue first (*Where it came from*).

## 3. Verify

The re-measure `findings.md` asks for before a proposal, done by a check that did not find it.
Launch one subagent per candidate — a few together where they share a file — in parallel, each
handed three things and nothing else:

- the claim in one line, its coordinate, and the tree the table above names;
- what would show it: the failure scenario to reproduce, the call to run, the line to read;
- the answer it owes — `confirmed`, `unproven` with what would settle it, or `refuted` with what
  showed it does not hold — each naming the revision it read.

Never the finder's reasoning, its confidence, or another candidate's verdict: a check that reads
the argument grades the argument. A coordinate that no tree this session can read carries is
`not measured — unreachable`, never refuted. Where there are more candidates than the session can
check, check them in the order of the severity their finders gave and let the header say how many
went unchecked — a `Critical` is never among those.

A verdict is read, not counted: one that restates the claim without the evidence it read at the
coordinate is `unproven`.

## 4. Search the tracker, and read the classification

For every candidate the checks did not refute. The search — closed issues included, and what
closed a closed hit — is `hcb-dev:issue-tracking`'s: invoke it through the Skill tool for that.
The repository's classification is read once for the pass, per
[`../../references/classification.md`](../../references/classification.md). With no tracker to
reach, the rows still show, each saying there is nowhere to file it.

## 5. Rule

Each survivor takes its rating and the scope test from `findings.md`, the *Worth remembering*
questions below `Critical`, and exactly one of the five outcomes; then they are ranked against each
other and against what the backlog already holds (*Ranked, not enumerated*). The pass makes no
fix: a candidate ruled `FIX` stands as `proposed: FIX`, and the fix is the next step of whoever
holds the work — `hcb-dev:implementation-workflow` where no work in hand carries it. A refuted
candidate is not ruled at all: it leaves with its reason.

## 6. Show

The table `findings-table.md` fixes: the header line, the rows in rank order, the refuted line
under them, the blocks under that. Where the response wears a report's frame the table stands in
its body, and every `proposed:` row stands in its ask block as well, this session's
recommendation first.

## 7. Write — on the word only

A tracker write is `hcb-dev:issue-tracking`'s, on the answer that skill counts as one; a standing
instruction to work autonomously is not that answer, and nothing in this pass is. On the answer,
invoke that skill through the Skill tool with the rows the answer covers, each carrying its
`Verified` cell into the issue it opens or updates. Where no answer comes the rows stay undecided
rather than dropped.

## Reference files

- [`../../references/findings.md`](../../references/findings.md) — the rating, the scope test, the
  five outcomes and the ranking; read before step 2.
- [`../../references/findings-table.md`](../../references/findings-table.md) — the form, and what
  the `Verified` column may say; read before step 6.
- [`../../references/classification.md`](../../references/classification.md) — read before
  anything is proposed for an issue.
- [`../../references/base-resolution.md`](../../references/base-resolution.md) — read before the
  tree a check reads is named.
- [`../../references/invariants.md`](../../references/invariants.md) — read once, before the first
  check's answer is read.
