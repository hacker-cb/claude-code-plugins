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

- `fixtures/claude-review/<name>.json` — the result envelope, as the CLI would write it.
- `cases/claude-review.tsv` — one row: the fixture, the exit status the run must end
  on, and what the case is there to hold.
- `stub/claude` — the stand-in engine, which prints whatever `STUB_ENVELOPE` names.

The exit statuses are the contract callers read: **0** a review, with a `scope:`
record; **1** a failure, quoted; **3** a reviewer that could not run. The runner
checks the line as well as the number, so a case cannot pass by reaching the right
status through the wrong branch.

## Where the envelopes come from

Six are verbatim captures of real runs — a full report, a clean working tree, a run
that found nothing, a connection refused inside the local command, a rejected login,
and a CLI with no login at all. They are kept whole, down to the fields nothing reads,
because they are the evidence of what an envelope actually looks like.

The rest are built from those six, trimmed to the seven fields the script reads
(`result`, `errors`, `is_error`, `terminal_reason`, `api_error_status`, `modelUsage`,
`permission_denials`) so that each one can be read at a glance and edited without
guessing which fields matter. Their wordings are not invented: the notices come from
the CLI binary's own notice list, and the verdicts from what reviews of this repository
actually write — which is the point, since a review of the quota branch quotes every
phrase a quota notice contains.

## Adding one

Write the envelope, add the row, run the file. A case earns its place when it pins
behaviour some plausible edit would break — a wording that must not be read as a
notice, a status that must not be read as a limit — and not when it merely exercises
a line. Name it for what it holds rather than for what it is.
