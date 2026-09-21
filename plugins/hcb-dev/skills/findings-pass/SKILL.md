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
| a session handed findings | on the hand-over | the refreshed base — the revision each one names is read only to find a coordinate the base has since moved | the text handed over |
| a master session | at a round's close — every return of the round accepted, every change request it lands merged | the tree the round landed on: the refreshed base, or the local parent where it landed in `local` mode | the ledger's *Candidates*, which `hcb-dev:master-session` keeps |

A batch inside a wave never runs it: its candidates ride its return as `not measured — batch`, at
the revision they were read at. The base is resolved by the ladder in
[`../../references/base-resolution.md`](../../references/base-resolution.md) and read only where
that resolution says the ref is current **and** shares history with what the claims name — a name
is not a ref, a refresh that answered nothing leaves a stale one standing, and a ref sharing no
history is refused there rather than diffed. Failing either, the candidates stay
`not measured — base`: a check against objects of unknown age, or against an unrelated tree, is no
verification.

## 1. Collect

Every candidate of the run, whatever carried it: a reviewer's report, a step that noticed one while
working on something else, a completed slice's `incidental`, another session's findings table or
observations, a batch's return. Take each as a claim — what, where, the revision it was read at,
the severity its finder gave — and leave the finder's argument behind: it is not a check's input.

A candidate this run already ruled on is not one again (*The same finding twice*): its outcome
stands, and where that outcome was a fix, the fix is what gets looked at.

## 2. Dedupe

By the key `findings.md` fixes (*The same finding twice*): one defect reported more than once — at
one `(file, line)`, or anchored at several by reviewers naming the same mechanism — is one
candidate. Distinct defects sharing a cause stay apart here; step 4 joins them once they are
measured. One that came out of work on an issue is measured against that issue first (*Where it
came from*).

## 3. Verify

The re-measure `findings.md` asks for before a proposal, done by a check that did not find it.
Launch one subagent per candidate — a few together where they share a file — in parallel and
read-only: told to edit, commit and write to the tracker nothing, and to put whatever a
reproduction writes in a scratch directory, never the tree the other checks read. Each is handed
three things and nothing else:

- the claim in one line, its coordinate, and the tree the table above names;
- what would show it: the failure scenario to reproduce, the call to run, the line to read;
- the answer it owes — `confirmed`, `unproven` with what would settle it, or `refuted` with what
  showed it does not hold — each naming the revision it read.

Never the finder's reasoning, its confidence, or another candidate's verdict: a check that reads
the argument grades the argument. A coordinate that no tree this session can read carries is
`not measured — unreachable`, never refuted. Where there are more candidates than the session can
check, every `Critical` is checked before a budget applies at all, and the rest read
`not measured — budget` in the order of the severity their finders gave. Where the `Critical` ones
alone outrun what the session can check, the pass stops and says so: none of them is ruled
unverified.

A verdict is read, not counted: one that restates the claim without the evidence it read at the
coordinate is `unproven`. A check that was refused, could not run or never answered gave no verdict
at all: its candidate is `not measured — failed`, carried to a later pass and neither searched nor
ruled here — an unread answer is not a negative one.

## 4. Group by mechanism

The confirmed and unproven, read together now that each is measured (*Count before deciding
anything else*). For every cluster, two questions: do they share one cause, and could one gate
hold them all? Where either is yes, the cluster is one row — the mechanism, or the gate — and its
members are that row's instances: the row rated by the most severe of them and verified as the
least — `unproven` where any instance is — each instance's own verdict and revision kept in the
row's block. The grouping stays provisional through step 6: an instance that the search or the
ruling sets apart — an issue carrying it alone, a fix cheaper than any record — leaves the row and
stands as one of its own. A `not measured` candidate is never grouped; it stays a row of its own.

## 5. Search the tracker, and read the classification

For every row the checks confirmed or left unproven — a mechanism searched for as the mechanism,
then for each instance no hit on the mechanism carries; a hit carrying only some instances takes
those out of the row, as the target of their own outcome. One `not measured` is neither searched
nor ruled — its outcome waits for a pass that can check it — save an `unreachable` one, which is
`HAND OVER` to whoever holds a tree carrying its coordinate. The search — closed issues included,
and what closed a closed hit — is `hcb-dev:issue-tracking`'s: invoke it through the Skill tool. The
repository's classification is read once for the pass, per
[`../../references/classification.md`](../../references/classification.md). With no tracker to
reach, the rows still show, each saying there is nowhere to file it.

## 6. Rule

Each confirmed or unproven row takes its rating and the scope test from `findings.md`, then
exactly one outcome, its target set by step 5's search: `INTO` the issue already carrying the
mechanism, `DROP — tracked as #N` where one carries it as it stands, a record of its own where none
does — and no proposal at all where no tracker could be reached. A row headed for a record of its
own below `Critical` first passes the *Worth remembering* questions, asked in turn and answered in
its block: the first *yes* ends it as `DROP — <the question>`. The pass rules no `FIX` — that
outcome is settled where the finding is found (*Decided cold*): one that still wants fixing in
work someone holds, or whose fix costs less than its record, is `HAND OVER` to the work that will
take it — a master session's next batch order included — never `OPEN`, and where an issue carries
it as well, the hand-over names that issue for the work to close. Then the rows are ranked against
each other and against what the backlog already holds (*Ranked, not enumerated*). A `not measured`
row keeps the proposal it arrived with, and a refuted candidate is not ruled at all: it leaves with
its reason.

**A `Critical` or `Important` on the code the run itself wrote is not this pass's to rule.**
`findings.md` has it fixed and blocking the completion, so the run goes back to its own fix path
with it — ruling it here would let a severe in-scope defect leave as a tracker entry.

## 7. Show

The table `findings-table.md` fixes: the header line, the rows in rank order, the footer line
under them, the refuted lines under that, then the blocks. Where the response wears a report's frame the table stands in
its body, and every `proposed:` row stands in its ask block as well, this session's
recommendation first.

## 8. Write — on the word only

A tracker write is `hcb-dev:issue-tracking`'s, on the answer that skill counts as one; a standing
instruction to work autonomously is not that answer, and nothing in this pass is. On the answer,
invoke that skill through the Skill tool with the rows the answer covers, each carrying its
`Verified` cell into the issue it opens or updates. Where no answer comes the rows stay undecided
rather than dropped.

## Reference files

- [`../../references/findings.md`](../../references/findings.md) — the rating, the scope test, the
  five outcomes and the ranking; read before step 2.
- [`../../references/findings-table.md`](../../references/findings-table.md) — the form, and what
  the `Verified` column may say; read before step 7.
- [`../../references/classification.md`](../../references/classification.md) — read before
  anything is proposed for an issue.
- [`../../references/base-resolution.md`](../../references/base-resolution.md) — read before the
  tree a check reads is named.
- [`../../references/invariants.md`](../../references/invariants.md) — read once, before the first
  check's answer is read.
