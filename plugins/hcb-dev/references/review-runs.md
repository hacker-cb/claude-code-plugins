# What a detached review run owes its caller

Read by anything that launches a review **engine of its own** — a separate process
or session that builds its own diff and answers with findings. It owns what is the
same whichever engine runs: which base the run is given, what that diff structurally
cannot see, how the run is launched, and the coverage record it hands back. It lives
outside any one skill because a copy per engine drifts, and a coverage rule that
drifted is one that reports a review nobody performed.

What stays with each engine is its own: the command, its flags, its ladder, and the
shape of its findings.

## The base

Every run is scoped against a base ref, resolved by
[`base-resolution.md`](base-resolution.md) — the rungs, which remote answers which
question, and the rule that a base sharing no history with `HEAD` is not a base.
Resolve it before launching anything, and hand the result to the run explicitly:
an engine left to pick its own scope falls back on a default range that, on an
already-pushed branch, is near-empty.

A caller may hand the base down, and an explicit one wins over anything resolved
here.

**Standing on the default branch is not an error.** The merge-base collapses onto
`HEAD`, and what that leaves depends on the engine: a working-tree diff where the
engine reads the tree, an empty range where it reads commits. Report what it
actually covered either way.

**With no base at all**, a run reviews the working tree alone and covers no
committed work. That is a `coverage-warning:` below rather than a failure — and it
is also unfinished business: resolve a base and run again, because nothing
downstream turns those commits into reviewed ones.

## What the diff cannot see

`git diff` never shows untracked files, so a brand-new file is invisible to a run
scoped by a diff — which is most of them. The exception is an engine mode that
reads the working tree through `git status` rather than a diff; where a skill says
its mode does that, this section does not apply to it.

```bash
git ls-files --others --exclude-standard
```

Where it applies and that lists anything belonging to the change, say so **before
launching**, and offer `git add -N <file>`, which makes the paths visible without
staging their contents. Never run it yourself: the index is the user's.

Write the run's report **outside the repository under review**. A file left inside
becomes an untracked file the next run reads as part of the change.

## Running it detached

Launch with `Bash(run_in_background: true)`, whoever asked and however small the
diff looks. Read inline, the call is killed on the tool's own limit, and the kill
takes the coverage record and the failure branch with it — the run then comes back
as neither a review nor a named failure. Give the `Bash` call a `description`
naming the engine, so the run is recognizable in the task list.

Detached is how it runs, not permission to answer without it: collect the finished
task's output and read it back before answering.

**Waiting is a blocking call, never a loop.** The engine takes minutes, and how
those minutes are spent differs by two orders of magnitude in what it costs.

**Wait on blocking windows.** One `TaskOutput` call with `block: true` and
`timeout: 600000` holds a single turn for ten minutes; repeat it, window after
window, until the run answers or the ceiling below is reached. Six windows are the
hour. Nothing is checked between them — the window *is* the wait.

**Ending the turn instead is for one case only**: an interactive session, with a
person present, where nothing downstream is blocked on the answer. There the
harness's completion notification is what brings the run back, and it names the
output file to read. Two things make that case narrow. A run that hangs sends no
notification at all, so the ceiling below never arrives and the wait is silent
forever. And a subagent that ends its turn ends the work the review was gating,
answering its caller with whatever the last reviewer said. **Anything autonomous —
a subagent, a dispatched batch, an orchestrated slice — waits on the windows**, and
whoever ends a turn while reviewers are out says which ones, and says nothing about
what they found until their records are in hand.

**Never wait by running commands in a loop** — a `sleep`, a `seq` loop, a
background "watcher" that sleeps and re-checks. A backgrounded call returns
instantly, so the wait becomes a spin that bills a whole turn, with the whole
context behind it, every few seconds; sessions doing this have spent a fifth of
their turns and a quarter of their context on nothing, and on a shared quota they
starve the very runs they are waiting for.

**A wait ends, but not soon.** These engines take minutes, and the upper rungs take
tens of them — half an hour of silence is a run reading, not a run lost, and a
window that expires is one window, not a verdict — open the next one. What ends a
wait is the sixth: an hour with nothing back. Before that hour, waiting is the
whole of the job; at it, stop and
record what actually happened — a run that never returned is a row and a reason in
the caller's report, not a reason to stall, and not a review to claim. Spend the
wait itself on what does not depend on the answer.

The hour is a ceiling on waiting, not a claim about how long a review may take: it
is there because the failures that leave nothing in the output file at all —
against which no amount of further waiting helps — now return at once, so silence
that outlasts an hour is worth reporting rather than sitting through.

**The command lives in the engine's script, and its skill names it.** Run that
script as it stands, one plain command — an agent isolated in its own worktree has
anything more complicated refused as unverifiable, and a round hours into the work
is where a command gets rebuilt from memory rather than read. What a rebuild drops
is never the engine call, which is the memorable part: it is the flags that make a
headless run reviewable, the redirect, and the coverage record — leaving a run that
reports as a review nobody measured.

## The two lines a run prints

A run prints a `started:` line the moment it launches its engine, and then nothing
until it is done — the report is buffered to the end. So an output file that has
stopped being empty says only that the run started:

```text
started: <engine and what fixed the run>, pid <n>, <time>
```

**What says a run finished is the record below, or a failure line** — never a file
that is merely non-empty. A wait keyed to emptiness ends at the wrong moment in
both directions: at once for a run still reading, and never for one that died
before it could print anything.

## The coverage record

Every finished run prints one record, before its findings and never merged into
them:

```text
scope: <base or "working tree">, <N> files, <the level and whatever else fixed the run>
```

The count is what the *caller* computed from git — the ground the run was handed.
Anything the count does not cover goes on its **own** line, never appended to that
one:

```text
coverage-warning: <what is not covered, and why>
```

## Reading it back

Return the engine's findings **verbatim** — no paraphrase, no summary, no
commentary wrapped around them. Then judge the coverage by the record rather than
by how the engine phrased itself; each phrases an empty review differently, and one
engine phrases it differently again between its own modes.

- **`0 files` is not a pass.** Nothing was reviewed. Report coverage of zero, never
  a clean review.
- **A `coverage-warning:` is partial coverage.** The count and the findings are
  real; what the warning names is not among them. Say which case it was.
- **A count is what the run was *given*, not what it read.** An engine handed a
  scope it can set aside — prose rather than a mechanical range — can review other
  ground entirely and still come back under a full-looking count. Read the findings
  against the range: anchors outside it, or a "no findings" verdict on a range whose
  files the write-up never names, mean the run scoped itself elsewhere. That is
  partial, and the honest report says what the count claims and what the review
  actually spoke about.

When a run fails, pass its own error through rather than guessing a cause.

**A spent quota is not one of those failures, and not a review either.** Where the
engine's account has hit its limit, the run comes back at once saying so, on its own
line — `unavailable:` rather than `failed:` — carrying the engine's notice. Nothing
about the change is wrong, and no coverage was lost to anything the caller controls.
**Read which limit it names.** One is the account's, and only its reset time closes
it: report the reviewer as unavailable, in the engine's own words, and let whoever
is completing the work decide whether to wait or proceed a reviewer short. The other
is a single model's, and says so — where the engine takes a model, rerunning on
another family closes the gap now, and a reviewer recorded as unavailable without
that attempt is a gap nobody needed to accept.

**Never read such a notice as a review.** A limit can arrive inside a *successful*
envelope, with the notice where the report would be, so a run that read nothing
prints a full file count beside it unless something checks. That is the shape of
every fail-open here: the count is what the run was handed, and the words beside it
are what it actually did.
