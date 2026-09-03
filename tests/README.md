# Tests

What runs here is the part of a review script that must behave the same every time:
how it reads the envelope its engine returned, and what it therefore tells the caller.
The engines themselves are not tested — they cost money, take minutes and answer
differently on every run — so a stub on `PATH` plays the CLI and prints a saved
envelope instead.

```bash
bash tests/run.sh              # every case
bash tests/run.sh quota org    # only cases whose name contains "quota" or "org"
```

Needs `jq`, `bash`, and a git checkout to run in. Nothing else: no engine, no network,
no account, no history beyond the current commit — the runs are pinned to an empty
range on purpose, since what is under test is the classification and not the count.

## What a case is

Three files meet for each one:

- `fixtures/claude-review/<name>.json` — the result envelope, as the CLI would write
  it; `-` in the row's place of a fixture means the run must be refused before the
  engine is reached at all.
- [`cases/claude-review.tsv`](cases/claude-review.tsv) — one row of five columns:
  the fixture, what the case adds to the invocation, the exit status, the fragments
  the output must contain, and what the case is there to hold.
- [`stub/claude`](stub/claude) — the stand-in engine. It prints the named envelope,
  and on request records the argv it was given, writes to stderr, touches a file in
  the tree, or exits non-zero — so a case can assert what the run did, not only what
  it returned.

The exit statuses are the contract callers read: **0** a review, with a `scope:`
record; **1** a failure, quoted; **3** a reviewer that could not run. What each case
must *print* is written out per row rather than derived from the status, because
every failure opens with the same line: the status implies its line, and checking one
against the other asserts nothing. The advice underneath is what separates the
branches, so that is what the fragments hold.

## Where the envelopes come from

Six are verbatim captures of real runs — a full report, a clean working tree, a run
that found nothing, a connection refused inside the local command, a rejected login,
and a CLI with no login at all. They are kept whole, down to the fields nothing reads,
because they are the evidence of what an envelope actually looks like.

The rest are built from those six, trimmed to the seven fields the script reads
(`result`, `errors`, `is_error`, `terminal_reason`, `api_error_status`, `modelUsage`,
`permission_denials`) so that each one can be read at a glance and edited without
guessing which fields matter. Every notice is quoted from the CLI binary's own notice
list rather than paraphrased — a fixture worded from memory would let a phrase list
look confirmed by data it was itself written from. The verdicts are what reviews of
this repository actually write, which is the point: a review of the quota branch
quotes every phrase a quota notice contains.

## Adding one

Write the envelope, add the row, run the file. A case earns its place when it pins
behaviour some plausible edit would break — a wording that must not be read as a
notice, a status that must not be read as a limit — and not when it merely exercises
a line. Name it for what it holds rather than for what it is.

**Then break the thing it guards and watch it fail.** A case that passes against the
mutation it was written for is worse than no case: it reports the guard as held. Most
of the rows here exist because a mutation survived the suite that was supposed to
catch it — deleting a status arm, reordering two predicates, dropping the flag that
tells a diagnosis from a report — and each was added only once the deletion turned
the suite red.
