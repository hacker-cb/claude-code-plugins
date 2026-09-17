# What a detached review run owes its caller

Read by anything that launches a review **engine of its own** — a separate process or session
that builds its own diff and answers with findings. It owns what is the same whichever engine
runs: which base the run is given, what that diff structurally cannot see, how the run is
launched, and the coverage record it hands back; the command, its flags, its ladder and the
shape of its findings stay with each engine. The waiting rules below are read as well by
whatever waits on a reviewer it did not launch, a forge's own among them.

## The base

Every run is scoped against a base ref, resolved by
[`base-resolution.md`](base-resolution.md) — the rungs, which remote answers which question, and
the rule that a base sharing no history with `HEAD` is not a base. Resolve it before launching
anything and hand the result to the run explicitly: an engine left to pick its own scope falls
back on a default range that, on an already-pushed branch, is near-empty. A caller may hand the
base down, and an explicit one wins over anything resolved here.

**Standing on the default branch is not an error.** The merge-base collapses onto `HEAD`, and
what that leaves depends on the engine: a working-tree diff where it reads the tree, an empty
range where it reads commits. Report what it actually covered either way. **With no base at
all**, a run reviews the working tree alone and covers no committed work — a
`coverage-warning:` below rather than a failure, and unfinished business: resolve a base and run
again, because nothing downstream turns those commits into reviewed ones.

## What the diff cannot see

`git diff` never shows untracked files, so a brand-new file is invisible to a run scoped by a
diff — which is most of them. The exception is an engine mode reading the working tree through
`git status`; where a skill says its mode does that, this section does not apply to it.

```bash
git ls-files --others --exclude-standard
```

Where it applies and that lists anything belonging to the change, say so **before launching**
and offer `git add -N <file>`, which makes the paths visible without staging their contents;
never run it yourself, the index being the user's. Write the run's report **outside the
repository under review** — a file left inside becomes an untracked file the next run reads as
part of the change.

## Running it detached

Launch with `Bash(run_in_background: true)`, whoever asked and however small the diff looks.
Read inline, the call is killed on the tool's own limit, and the kill takes the coverage record
and the failure branch with it — the run comes back as neither a review nor a named failure.
Give the call a `description` naming the engine, so the run is recognizable in the task list.
Detached is how it runs, not permission to answer without it: collect the finished task's output
and read it back before answering.

**Waiting is a blocking call, never a loop.** One call that holds a single turn for ten minutes,
or until the run answers; repeat it, window after window, nothing checked between them — the
window *is* the wait. **Never** wait by running commands in a loop, a `sleep`, a `seq`, or a
background watcher that sleeps and re-checks: a backgrounded call returns instantly, so the wait
becomes a spin billing a whole turn, with the whole context behind it, every few seconds. Where
no blocking wait is available, wait inside a single command that blocks until the run prints one
of the three lines below or the window is up.

**With several runs out, a window is spent on one of them.** Collect the ones that have already
answered before opening any window, and open the next on the run most likely to return, never on
the same silent one while finished records sit unread. The ceiling is wall-clock across the
whole wait: three reviewers do not buy three hours.

**Ending the turn instead is for one case only**: an interactive session, a person present, and
nothing downstream blocked on the answer — there the harness's completion notification brings
the run back and names the file to read. Two things make that case narrow: a run that hangs
sends no notification at all, so the ceiling never arrives and the wait is silent forever; and a
subagent that ends its turn ends the work the review was gating. **Anything autonomous — a
subagent, a dispatched batch, an orchestrated slice — waits on the windows**, and whoever ends a
turn while reviewers are out says which ones, and says nothing about what they found until their
records are in hand.

**A wait ends, but not soon.** These engines take minutes and the upper rungs tens of them: half
an hour of silence is a run reading, and a window that expires is one window, not a verdict.
What ends a wait is an hour of it, on the clock rather than per run. Before that hour waiting is
the whole of the job; at it, stop and record what happened — a run that never returned is a row
and a reason in the caller's report, never a reason to stall and never a review to claim. Spend
the wait itself on what does not depend on the answer.

**The command lives in the engine's script, and its skill names it.** Run that script as it
stands, one plain command: an agent isolated in its own worktree has anything more complicated
refused as unverifiable, and a round hours into the work is where a command gets rebuilt from
memory. What a rebuild drops is never the engine call — it is the flags that make a headless run
reviewable, the redirect, and the coverage record, leaving a run that reports as a review nobody
measured.

## The two lines a run prints

A run prints a `started:` line the moment it launches its engine, and then nothing until it is
done — the report is buffered to the end. An output file that has stopped being empty says only
that the run started:

```text
started: <engine and what fixed the run>, pid <n>, <time>
```

**What says a run finished is the record below, a failure line, or a line saying the reviewer
was unavailable** — never a file that is merely non-empty. All three are answers, and waiting
past any of them waits for something that already came; a wait keyed to emptiness ends at the
wrong moment in both directions — at once for a run still reading, never for one that died
before printing anything.

## The coverage record

Every finished run prints one record, before its findings and never merged into them:

```text
scope: <base or "working tree">, <N> files, <the level and whatever else fixed the run>
```

The count is what the *caller* computed from git — the ground the run was handed. Anything it
does not cover goes on its **own** line, never appended to that one:

```text
coverage-warning: <what is not covered, and why>
```

## Reading it back

Return the engine's findings **verbatim** — no paraphrase, no summary, no commentary wrapped
around them. Then judge the coverage by the record rather than by how the engine phrased itself:
each phrases an empty review differently, and one phrases it differently again between its own
modes.

- **`0 files` is not a pass** — nothing was reviewed; report coverage of zero, never a clean review.
- **A `coverage-warning:` is partial coverage.** The count and the findings are real; what the
  warning names is not among them. Say which case it was.
- **A count is what the run was *given*, not what it read.** An engine handed a scope it can set
  aside — prose rather than a mechanical range — can review other ground entirely and still come
  back under a full-looking count. Read the findings against the range: anchors outside it, or a
  "no findings" verdict on a range whose files the write-up never names, mean the run scoped
  itself elsewhere. That is partial, and the report says both what the count claims and what the
  review actually spoke about.

When a run fails, pass its own error through rather than guessing a cause.

**A spent quota is not one of those failures, and not a review either.** The run comes back at
once carrying the engine's notice; nothing about the change is wrong, and no coverage was lost
to anything the caller controls. **How it says so is the engine's own** — one has a line of its
own (`unavailable:` rather than `failed:`), another, whose CLI hands back an empty file rather
than an envelope, can only report it among its failures. Read the notice, not the prefix, and **read which limit it names**: the account's closes only at its reset time, so report the
reviewer unavailable in the engine's own words and let whoever is completing the work decide
whether to wait or proceed a reviewer short; a single model's says so, and where the engine
takes a model, rerunning on another family closes the gap now.

**Never read such a notice as a review.** A limit can arrive where the report belongs, under a
record that looks complete, so the count states a range handed over while the words beneath it
say nothing was read. Reading the write-up rather than the number above it is what catches that:
a review whose whole body is one sentence — about a limit, about switching models — is a
reviewer to record as unavailable.
