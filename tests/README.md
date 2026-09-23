# Tests

What runs here is the part of a script that must behave the same every time: how it
reads what its engine returned, and what it therefore tells the caller. The engines
themselves are not tested — they cost money, take minutes and answer differently on
every run — so a stub on `PATH` plays the CLI and prints a saved envelope instead.

```bash
bash tests/run.sh                          # every case of every suite
bash tests/run.sh quota org                # only cases whose name contains "quota" or "org"
bash tests/run.sh --suite review-round     # only that suite
```

Needs `jq`, a git checkout, and whatever the scripts under test run under (`bash`, and
`node` for one written in JavaScript). Nothing else: no engine, no network,
no account, no history beyond the current commit — the runs are pinned to an empty
range on purpose, since what is under test is the classification and not the count.

## What a suite is

A suite is one directory under [`suites`](suites) — one script under test, with
everything that run needs beside it:

```text
suites/pr-state/
  suite.conf      what to run, and the environment to run it in
  cases.tsv       one row per case
  fixtures/       the envelopes those rows name
  stub/           the stand-in engines, one file per command it replaces
```

Three of those are the directory itself, so only `suite.conf` has anything to say —
one `key value` per line, paths relative to the repo root:

| key | |
|---|---|
| `script` | the script under test; required. Its suffix picks the interpreter — `.mjs` and `.js` run under `node`, anything else under `bash` |
| `args` | what every case of this suite is invoked with, before its own `args` column |
| `env` | a `NAME=value` put in every run's environment; may repeat |

A case's own `NAME=value` word overrides its suite's `env` — that is how one case
pins a locale of its own. Neither overrides what the runner sets to make the run
observable (`PATH`, `STUB_ENVELOPE`, `STUB_MARKER_FILE`): those are applied last, so
a suite cannot walk its own stubs off the search path and stay green.

Anything else is a typo, and the runner says so rather than ignoring it — an unknown
key, and an `env` that is not `NAME=value` (which `env(1)` would otherwise read as a
program to run, failing every case of the suite instead of naming the line). `run.sh`
holds no suite's name, path or flag: it finds the suites by looking.

What it looks for is the *directory*, not the `suite.conf` inside it, so a suite that
declares nothing fails loudly instead of dropping out of the run — and a `cases.tsv`
holding no case fails the same way. Both are the shape a lost suite takes: the script
still has a suite's name against it, and nothing runs.

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
  case is there to hold. A fragment opening `NOT:` asserts the rest is **absent** —
  presence is all a substring test says by itself, so a guarantee shaped *the answer
  does not carry this* (a field deliberately left out, a value that must not reach a
  reader) had nothing to hold it, and putting it back read as green. A path written
  into that second column is relative to the
  repository root, which is where the runner works from whatever directory it was
  called in. One word there is the runner's own rather than the script's:
  `WORKTREE=1` runs that case from a fresh linked worktree of this repository — the
  topology where a checkout's git directory and its common directory are different
  paths — and removes it afterwards.
- `stub/<command>` — the stand-in engine, named for the command it replaces. It
  prints the named envelope, and on request records the argv it was given, keeps what
  it was handed on stdin, writes to stderr, or exits non-zero — so a case can assert
  what the run did, not only what it returned. What a stub implements is
  its own suite's business:
  [`suites/pr-state/stub/gh`](suites/pr-state/stub/gh) answers on stdout because that
  script reads it there, while a script that takes an output path needs a stub that
  writes to it.

The exit statuses are each script's contract with its callers, written in its header,
and every case pins one. **2** means the same everywhere: the script was *called* wrong
(a flag without its value, an argument it does not know) and never reached what it
reads, which is a different thing from a call that reached it and could not answer.
Cases pin it too, since an argument guard is what keeps a value from smuggling in a
flag.

What each case must *print* is written out per row rather than derived from the
status, because every refusal opens the same way: the status implies its opening, and
checking one against the other asserts nothing. The reason underneath is what separates
the branches, so that is what the fragments hold.

## Where the envelopes come from

By two routes. A captured one comes through the collector below and sits under a
suite's `captured/`, marked as such —
[`suites/copilot-state/captured`](suites/copilot-state/captured) holds one request's
reviews, timeline and rules. It is kept whole, down to the fields nothing reads, because
it is the evidence of what an answer actually looks like; the fixtures a case names are
trimmed to the fields the script reads, so that each can be read at a glance and edited
without guessing which fields matter.

[`suites/plugin-versions/fixtures`](suites/plugin-versions/fixtures) is written
rather than captured: each envelope is the registry and marketplace answer one
case needs, and the version trees those answers point at sit beside them under
`trees/`, which is where a case's `--root` and the paths it expects come from.

## Data out of a private repository comes in one way only

`scripts/collect-fixtures.mjs` takes it, sanitizes it, and writes a `CAPTURED` marker beside
what it wrote. `scripts/check-fixtures.mjs` then holds everything under that marker to the
invented shapes — an allow-list, so a value nobody thought of in advance fails too.

**An unmarked capture is recognised by its shape.** A forge's reply carries bookkeeping nobody
sits down and invents — `node_id` beside `gravatar_id`, `site_admin`, the `*_url` fields — and
the collector keeps only what its allow-list names, so none of it survives sanitizing. Two such
keys in one object of an *unmarked* fixture is therefore a reply that went through no sanitizer
at all, and the gate fails on it. It reads inside an envelope too: a reply pasted into the
string a stub prints is parsed and walked like any other document, which is where the key
shapes used to stop — a marked capture's envelope is now held to the invented shapes through
the string as well.

**What it cannot recognise is a reply somebody trimmed by hand,** and the key list is a list
rather than a law — a shape neither forge writes today is a shape this does not know. Strip the
bookkeeping and what is left — a login, a branch naming a customer, a repository path — is
exactly what a hand-written fixture legitimately spells however it likes, and on a self-hosted
instance the host check does not fire either. So the rule stands ahead of the gate: **never
paste a forge's answer into a fixture.** Run the collector, which marks what it writes, or write
the envelope yourself with invented values.

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

A script whose subcommands only mean something after one another — a store that `init`
opens and later calls fill — cannot be tested one call per case. Its suite's `script` is
then a driver kept in the suite, which runs the chain a case names and prints only the
last answer; [`suites/review-round/drive.sh`](suites/review-round/drive.sh) is the one to
copy.
