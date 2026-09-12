# Reporting to the user — one frame, two reports

Read by whatever reports to the user on a run of work — an epic in flight, a set
of slices finished, or the analysis that precedes either. One frame, and two
bodies under it:

- **the wave report** — an epic in flight, written by the session coordinating it
  (`hcb-dev:master-session`) and by the one launching its batches
  (`hcb-dev:wave-dispatch`);
- **the final report** — a finished run: a set of slices
  (`hcb-dev:implementation-workflow`), or a whole epic.

A change-request driver's report on one merged request sits at a different
altitude and keeps its own shape: this frame does not reach it, and neither
replaces the other. Nor does it reach a step whose whole answer is a line — a
cleanup verdict, a branch retired. A skill whose report has a body of its own — a backlog survey, a capacity pass, a plugin refresh — writes
that body and wears this frame around it.

Keep it scannable: short grouped bullets, a small table, not an essay.

## The frame

### The first line

What happened, and how many actions wait on the reader — of those, how many hold
work — or that none do. What the report goes on to ask about is never announced
there as settled.

### `## Without your word` — above anything the reader acts on

Two kinds, a line each, before the first table, chip or link the report offers:

- **what departed from what the reader approved** — `<what stood>` →
  `<what stands now>`, why, and what undoes it;
- **what this session settled inside the authority it holds**, with what undoes
  that.

Neither is a question: the answer to both is a veto, and a veto needs the item in
front of the reader. An empty section is left out — it is the ask block below that
is never omitted. Where a report's body keeps these in rows of its own — an
outcome column, a list of divergences — that is where they stand: what the frame
fixes is that they reach the reader ahead of anything to act on, not the heading
they sit under.

### The body

The wave report's or the final report's, below.

### `## Needs your word` — last, and the only place an ask stands

Every ask in full text — never a label, a count, or a pointer at an earlier
message. Each carries:

- **where it is acted on** — a word here, a click, an approval on the forge, a
  tracker write, an archival;
- **whether it holds work**, and behind which other ask it stands where it does;
- **the recommendation**, with what it rests on and what it turns down
  ([`architecture-decisions.md`](architecture-decisions.md) §2);
- **what standing means** — what stops until it is answered, or that nothing does;
- **how long it has been open**, for one carried over from an earlier report.

Two groups — what holds work, in the order dependency puts them in, then what
holds nothing — and a closing line saying how an answer can be given. A click, an
approval and an archival are asks exactly as a question is: "nothing waits on
you" is written only where this block is empty, and a chip nobody has clicked —
or an approval the repository's gates or the merge authorization actually leave
outstanding — is not empty. An ask leaves the block only with an
outcome — answered, deferred by the reader's word (which stops it holding work),
withdrawn, or overtaken by something that settles it — said in the line that
drops it. Where the session keeps a record of what it awaits — a
coordinating one keeps it in [`wave-ledger.md`](wave-ledger.md) — the block
prints that record rather than recall.

### What a report is not

The plan of what this session does next, the narration of a step under way, and
the account of a mistake it made. Those belong to the record the session keeps —
a journal, a plan-doc — and reach the report only as the one line that changes
what the reader decides.

## The wave report

Two sections between the frame's halves:

1. **What happened** — the events since the last report, each with the coordinate
   it was verified at and, over a landing, what its checks showed — `base_checks`,
   whose values [`slice-completion.md`](slice-completion.md) names. The round's candidates stand here too — what was
   ruled and what it was re-measured against — with the ones needing the reader
   in the ask block and the dropped ones named with their reason.
2. **Where it stands** — one row per batch: id, issues, state in the ledger's
   vocabulary, and what it waits on — nothing, its slot, the reader's approval,
   the reader's click with the age of the chip and the pin it stands on, another
   batch, or the condition holding it back, named: a blocker, a body to rewrite,
   a tracker write. Then the gate the next wave opens on.

An event that changes nothing for the reader earns no report: one line carries it
(`hcb-dev:master-session`).

### Template

```markdown
**Wave <n>: <what changed, in a phrase> · needs you: <k>, holding work: <m>**

## Without your word
- Departed from what you approved: <what stood> → <what stands now>, because <why>. Undo: <how>.
- Settled here: <what>, inside <the authority it holds>. Undo: <how>.

## What happened
- <event> — verified <how> at <coordinate>; checks <the `base_checks` value, as `slice-completion.md` gives it>.
- Candidates of the round — <what was ruled, re-measured against what>; dropped: <what, and why>.

## Where it stands
| batch | issues | state | waiting on |
|---|---|---|---|
| <id> | <…> | <ledger state> | <nothing · its slot · your approval · your click (chip <age>, pin <sha>) · batch <id> · <the condition holding it>> |

Next wave opens on: <the gate>.

## Needs your word
**Holding work**
1. [<where it is acted on>] <the ask, in full> — open since <when>; recommended <what>, on <what it rests on>; turned down <what>, <why>. Standing: <what stops>.
2. [<where>] <the ask, in full> — open since <when>, behind 1; recommended <what>, on <what it rests on>; turned down <what>, <why>. Standing: <what stops>.

**Holding nothing**
3. [<where>] <the ask, in full> — open since <when>; recommended <what>, on <what it rests on>; turned down <what>, <why>. Standing: nothing stops.

<how to answer>
```

## The final report

It covers the *whole run*, across slices: a multi-slice set produces one of these
at the end, beside the change-request reports its slices produced. Five sections
between the frame's halves:

1. **Per-slice outcome** — one row per slice: what it did, how it completed
   (merged locally into `<parent>`, or the change-request URL and whether it
   merged), what the checks on that landing showed (`base_checks`, whose values
   `slice-completion.md` names), and its
   state (done / partial / skipped). An epic groups its rows by wave and ends each
   in what the ledger records for that batch — `released`, `withdrawn(<reason>)`
   or `failed(<what stands>)`. A set that ended partway — a slice failed or was
   skipped — says so here plainly; never let a summary read as complete when it
   isn't.

2. **The issues the run settles, at their state now** — one line each: closed, or
   still open and why. A merged slice row does not say what became of the issue
   behind it.

3. **Review coverage, and what stayed uncovered.** Carry the coverage lines from
   each slice's `multi-review` verbatim — a reviewer that could not run, ran over
   nothing, or ran over the wrong range is a gap, and a structural gap (a
   reviewer's own fixed limitation, which no answer could close) is labelled as
   such so the reader can tell it apart from one still worth closing. If every
   slice was fully covered, say that.

4. **Incidental findings, rated by importance.** The items surfaced-but-not-fixed
   during the run, grouped by category, rated on the ladder in
   [`findings.md`](findings.md), each with the outcome it ended in. One whose
   outcome is the reader's to give stands in the ask block instead, and this
   section says so rather than repeating it.
   **If there are none, say so explicitly** — "no incidental findings" is a real
   result, and its absence must not read as an omission.

5. **What the run leaves** — any ref a completion could not retire and why
   ([`branch-retirement.md`](branch-retirement.md)), the worktrees, the sessions
   this run is done with and which of them cannot be archived, with why —
   archiving the rest is an ask and stands in the block — an offer the user turned
   down (`declined_offer`), and a pointer to `/hcb-dev:git-cleanup`.

A follow-up worth filing is an ask and stands in the block with everything else
waiting on the reader. An offer already answered is not one: it is recorded above
rather than put again.

### Template

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

**Incidental findings** — <grouped, rated Critical/Important/Minor per the scale above, each with its outcome; the ones whose outcome is yours stand in the block below; or "none">

**What it leaves** — <refs left standing, worktrees, sessions to archive, an offer turned down, cleanup pointer; or "nothing">

## Needs your word
<the frame's block; or "nothing waits on you">
```

A reader glancing at the `State` column must be able to tell a clean, complete set
from one that landed part of the work: an offer made over an incomplete branch is
never presented as if the set were whole.
