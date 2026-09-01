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

**Collect it yourself.** A finished background task reaches a turn that is still
running, so ending the turn is what forfeits it. Waiting is polling the output file
until it carries the coverage record **or the task itself has ended** — a run that
failed before it could launch prints its failure instead of a record, and polling
for one it will never print does not stop. What never waits is a turn closed on
"the reviewers are still out", which in a subagent ends the work entirely and
answers the caller with whatever the last reviewer said. Spend the wait on what
does not depend on the answer.

**The command lives in the engine's script, and its skill names it.** Run that
script as it stands, one plain command — an agent isolated in its own worktree has
anything more complicated refused as unverifiable, and a round hours into the work
is where a command gets rebuilt from memory rather than read. What a rebuild drops
is never the engine call, which is the memorable part: it is the flags that make a
headless run reviewable, the redirect, and the coverage record — leaving a run that
reports as a review nobody measured.

## The coverage record

Every run prints one line, before its findings and never merged into them:

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
