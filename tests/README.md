# Tests

What runs here is the part of a script that must behave the same every time: how it
reads what its engine returned, and what it therefore tells the caller. The engines
themselves are not tested — they cost money, take minutes and answer differently on
every run — so a stub on `PATH` plays the CLI and prints a saved envelope instead.

```bash
bash tests/run.sh                          # every case of every suite
bash tests/run.sh quota org                # only cases whose name contains "quota" or "org"
bash tests/run.sh --suite claude-review    # only that suite
```

Needs `jq`, `bash`, and a git checkout to run in. Nothing else: no engine, no network,
no account, no history beyond the current commit — the runs are pinned to an empty
range on purpose, since what is under test is the classification and not the count.

## What a suite is

A suite is one directory under [`suites`](suites) — one script under test, with
everything that run needs beside it:

```text
suites/claude-review/
  suite.conf      what to run, and the environment to run it in
  cases.tsv       one row per case
  fixtures/       the envelopes those rows name
  stub/           the stand-in engines, one file per command it replaces
```

Three of those are the directory itself, so only `suite.conf` has anything to say —
one `key value` per line, paths relative to the repo root:

| key | |
|---|---|
| `script` | the script under test; required |
| `args` | what every case of this suite is invoked with, before its own `args` column |
| `env` | a `NAME=value` put in every run's environment; may repeat |

Anything else is a typo, and the runner says so rather than ignoring it. `run.sh`
holds no suite's name, path or flag: it finds the suites by looking.

`fixtures/` may be absent when no case names an envelope. `stub/` may not: a case
asserting it was refused *before* its engine needs something standing where that
engine would be, or the assertion passes just as happily against a `command not
found`. Every file in it must be executable — without the bit a `PATH` search walks
past the stub and finds the real CLI, which would spend an account's quota and answer
differently every run while reporting some of it as green.

## What a case is

Three things meet for each one, all inside the suite:

- `fixtures/<name>.json` — the result envelope, as the CLI would write it; `-` in the
  row's place of a fixture means the run must be refused before the engine is reached
  at all.
- `cases.tsv` — one row of five columns: the fixture, what the case adds to the
  invocation, the exit status, the fragments the output must contain, and what the
  case is there to hold.
- `stub/<command>` — the stand-in engine, named for the command it replaces. It
  prints the named envelope, and on request records the argv it was given, writes to
  stderr, touches a file in the tree, or exits non-zero — so a case can assert what
  the run did, not only what it returned. What a stub implements is its own suite's
  business: [`suites/claude-review/stub/claude`](suites/claude-review/stub/claude)
  answers on stdout because that script reads it there, while a script that takes an
  output path needs a stub that writes to it.

The exit statuses are the contract callers read: **0** a review, with a `scope:`
record; **1** a failure, quoted; **3** a reviewer that could not run. A fourth, **2**,
sits outside that contract on purpose — it means the script was *called* wrong (a flag
without its value, an argument it does not know) and never reached an engine at all,
which is a different thing from a run that reached one and failed. Cases pin it too,
since an argument guard is the only thing standing between `--narrow` and a flag that
would let the run write.

What each case must *print* is written out per row rather than derived from the
status, because every failure opens with the same line: the status implies its line,
and checking one against the other asserts nothing. The advice underneath is what
separates the branches, so that is what the fragments hold.

## Where the envelopes come from

This is [`suites/claude-review/fixtures`](suites/claude-review/fixtures), the one
suite that reads envelopes so far. Six are verbatim captures of real runs — a full
report, a clean working tree, a run that found nothing, a connection refused inside
the local command, a rejected login, and a CLI with no login at all. They are kept
whole, down to the fields nothing reads, because they are the evidence of what an
envelope actually looks like.

The rest are built from those six, trimmed to the seven fields the script reads
(`result`, `errors`, `is_error`, `terminal_reason`, `api_error_status`, `modelUsage`,
`permission_denials`) so that each one can be read at a glance and edited without
guessing which fields matter. Every notice is quoted from the CLI binary's own notice
list rather than paraphrased — a fixture worded from memory would let a phrase list
look confirmed by data it was itself written from. The verdicts are what reviews of
this repository actually write, which is the point: a review of the quota branch
quotes every phrase a quota notice contains.

## Adding a case

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

## Adding a suite

Make the directory, write `suite.conf` and `cases.tsv`, put a stub in `stub/` for
every command the script shells out to, and run `bash tests/run.sh`. Nothing else is
registered anywhere — the runner discovers suites, and `--suite <name>` takes the
directory's name.

Name the suite for the script it tests. A suite that reaches no engine still gets its
stubs: they are what turns "the run was refused early" from a claim into a check.
