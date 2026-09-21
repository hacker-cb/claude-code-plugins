# Reporting to the user — one frame, two reports

Read by whatever reports to the user on a run of work. One frame, and two bodies under it: **the
wave report**, an epic in flight, written by the session coordinating it
(`hcb-dev:master-session`) and by the one launching its batches (`hcb-dev:wave-dispatch`); and
**the final report**, a finished run — a set of slices (`hcb-dev:implementation-workflow`), or a
whole epic. A change-request driver's report on one merged request sits at a different altitude
and keeps its own shape; nor does this frame reach a step whose whole answer is a line. A skill
whose report has a body of its own — a backlog survey, a capacity pass, a plugin refresh —
writes that body and wears this frame around it. Keep it scannable: short grouped bullets, a
small table, not an essay.

## The frame

**The first line** of a report says what happened and how many actions wait on the reader — of those, how
many hold work — or that none do; what it goes on to ask about is never
announced there as settled.

**`## Without your word`** stands above anything the reader acts on: before the first table, chip
or link, two kinds, a line each — **what departed from what the reader approved** (`<what stood>`
→ `<what stands now>`, why, and what undoes it), and **what this session settled inside the
authority it holds**, with what undoes that. Neither is a question: the answer to both is a veto,
and a veto needs the item in front of the reader. An empty section is left out — it is the ask
block that is never omitted. Where a report's body keeps these in rows of its own, that is where
they stand: the frame fixes that they reach the reader ahead of anything to act on, not the
heading they sit under. **The body** between them is the wave or final report's, below.

**`## Needs your word`** comes last and is the only place an ask stands — every ask in full text,
never a label, a count, or a pointer at an earlier message. Each carries **where it is acted on**
(a word here, a click, an approval on the forge, a tracker write, an archival); **whether it
holds work**, and behind which ask it stands where it does; **the recommendation**, with what it
rests on and what it turns down ([`architecture-decisions.md`](architecture-decisions.md) §2);
**what standing means** — what stops until it is answered, or that nothing does; and **how long
it has been open**, for one carried over.

Two groups — what holds work, in the order dependency puts them in, then what holds nothing —
and a closing line saying how an answer can be given. A click, an approval and an archival are
asks exactly as a question is: "nothing waits on you" is written only where this block is empty,
and a chip nobody has clicked, or an approval the gates or the merge authorization leave
outstanding, is not empty. An ask leaves the block only with an outcome — answered, deferred by
the reader's word (which stops it holding work), withdrawn, failed with what still stands, or
overtaken — said in the line that drops it. Where the session keeps a record of what it awaits
([`wave-ledger.md`](wave-ledger.md) for a coordinating one), the block prints that record rather
than recall.

**What a report is not**: the plan of what this session does next, the narration of a step under
way, the account of a mistake it made. Those belong to the record the session keeps and reach the
report only as the one line that changes what the reader decides.

## The wave report

Two sections between the frame's halves:

1. **What happened** — the events since the last report, each with the coordinate it was
   verified at and, over a landing, what its checks showed (`base_checks`, whose values
   [`slice-completion.md`](slice-completion.md) names). A round that closed brings its candidates,
   in the table [`findings-table.md`](findings-table.md) fixes, with the rows needing the reader in
   the ask block as well.
2. **Where it stands** — one row per batch: id, issues, state in the ledger's vocabulary, and
   what it waits on: nothing, its slot, the reader's approval, the reader's click with the chip's
   age and the pin it stands on, another batch, or the condition holding it back — a blocker, a
   body to rewrite, a tracker write. Then the gate the next wave opens on.

An event that changes nothing for the reader earns no report: one line carries it
(`hcb-dev:master-session`). Template:

```markdown
**Wave <n>: <what changed, in a phrase> · needs you: <k>, holding work: <m>**

## Without your word   <— the section stands only where something belongs in it>
- Departed from what you approved: <what stood> → <what stands now>, because <why>. Undo: <how>.
- Settled here: <what>, inside <the authority it holds>. Undo: <how>.

## What happened
- <event> — verified <how> at <coordinate>; checks <the `base_checks` value, as `slice-completion.md` gives it>.
- Candidates — <where a round closed: its table follows this list, header line first, footer line under it>.

## Where it stands
| batch | issues | state | waiting on |
|---|---|---|---|
| <id> | <…> | <ledger state> | <nothing · its slot · your approval · your click (chip <age>, pin <sha>) · batch <id> · <the condition holding it>> |

Next wave opens on: <the gate>.

## Needs your word
**Holding work**
1. [<where it is acted on>] <the ask, in full> — open since <when>; recommended <what>, on <what it rests on>; turned down <what>, <why>. Standing: <what stops>.
2. [<where>] <the ask, in full> — open since <when>, behind 1; …

**Holding nothing**
3. [<where>] <the ask, in full> — open since <when>; recommended <what>, …; turned down <what>, <why>. Standing: nothing stops.

<how to answer>
```

## The final report

It covers the *whole run*, across slices: a multi-slice set produces one at the end, beside the
change-request reports its slices produced. Five sections between the frame's halves:

1. **Per-slice outcome** — one row per slice: what it did, how it completed (merged locally into
   `<parent>`, or the change-request URL and whether it merged), what the checks on that landing
   showed (`base_checks`, whose values `slice-completion.md` names), and its state (done /
   partial / skipped). An epic groups its rows by wave and ends each in what the ledger records
   for that batch — `released`, `withdrawn(<reason>)` or `failed(<what stands>)`. A set that
   ended partway says so here plainly; never let a summary read as complete when it isn't.
2. **The issues the run settles, at their state now** — closed, or still open and why; a merged
   slice row does not say what became of the issue behind it.
3. **Review coverage, and what stayed uncovered.** Carry each slice's `multi-review` coverage
   lines verbatim — a reviewer that could not run, ran over nothing, or ran over the wrong range
   is a gap, and a structural one (a reviewer's own fixed limitation, which no answer could
   close) is labelled as such. If every slice was fully covered, say that.
4. **Incidental findings** — surfaced but not fixed, in the one table `findings-table.md` fixes,
   as the pass that ruled them left it: each row rated on the ladder in [`findings.md`](findings.md)
   and saying whether it was verified. A row whose outcome is the reader's to give stands in the
   ask block as well. **With none, the header line says `0 after dedup`**: an absent section must
   not read as an omission.
5. **What the run leaves** — any ref a completion could not retire and why
   ([`branch-retirement.md`](branch-retirement.md)), the worktrees, the sessions this run is done
   with and which of them cannot be archived, with why — archiving the rest is an ask and stands
   in the block — an offer the user turned down (`declined_offer`), and a pointer to
   `/hcb-dev:git-cleanup`.

A follow-up worth filing is an ask and stands in the block with everything else waiting on the
reader. An offer already answered is not one: it is recorded above rather than put again.
Template:

```markdown
**<what the run did> · needs you: <k>, holding work: <m>**

## Without your word
- <as the frame gives it; or the section is absent>

## Run report

| Slice | What | Completion | State |
|---|---|---|---|
| <name> | <one line> | merged → <parent>  /  <CR-url> (merged\|ready) · checks <green\|red: each row + what it is attributed to\|not waited out: state at <when>\|unchecked: what is left unguaranteed\|none> | done\|partial\|skipped; an epic's row: released\|withdrawn(<reason>)\|failed(<what stands>) |

**Issues** — <one line per issue the run settles: closed, or open with why; or "none">

**Coverage** — <per-slice coverage lines; name any gap; "fully covered" if clean>

**Incidental findings** — <the table, header line first, footer line under it; its `proposed:` rows stand in the block below as well; or the header line alone, `0 after dedup`>

**What it leaves** — <refs left standing, worktrees, sessions to archive, an offer turned down, cleanup pointer; or "nothing">

## Needs your word
<the frame's block; or "nothing waits on you">
```
