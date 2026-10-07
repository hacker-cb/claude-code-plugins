# How a master session starts its batches

Read by the session coordinating an epic, wherever a batch goes out, comes back after a
restart, or ends. It owns the launch: the way a batch goes out, what it runs at and under,
and the commands that start, check, resume and close it. What
the order says differs by the way it went out, and that is
[`../skills/wave-dispatch/references/wave-order.md`](../skills/wave-dispatch/references/wave-order.md)'s.

## The way a batch goes out

First that answers, in this order:

| way | answers when | who starts it |
|---|---|---|
| `agterm` | `probe` says so: this session found in agterm's tree, `claude` — and the launcher, where one is named — able to start from the login shell | this session |
| chip | this session holds the host's chip tool | the user's click |
| paste | always | the user, by hand |

The user's word overrides the way, the launcher or the environment — for the epic, for one
wave, or for one batch, the narrowest standing; each lands in the ledger it belongs to
([`wave-ledger.md`](wave-ledger.md)). A way the word names that does not answer here is not
swapped for another: it goes to the user.

**A launcher and an environment**, alone or together, change how the terminal way starts
`claude`: the user's word names them, or the instructions this session runs under do — a
project's `CLAUDE.md`, the user's own rules. `--launcher '<command>'` runs in `claude`'s place,
`claude`'s own arguments after it — its words spaced, or a JSON array where one holds a space;
`--env NAME=VALUE`, as often as needed, is exported before it starts, and a `PATH` among them is
the one the launcher or `claude` is looked for on. `CLAUDE_CONFIG_DIR` among them is the
configuration the batch runs under — the one `check`, `relaunch` and `close` read it back from,
and the one the repository's trust is carried into — so a launcher that picks a configuration of
its own is handed that same directory, and a `HOME` comes with it. No secret travels as `--env`:
the record lands in the ledger. A key or a token is the launcher's or the login shell's to
supply. A record naming a `profile` rather than a launcher is the user's to translate into one
before it relaunches.

**Model and effort** are the settings' unless the user's word names others, and travel to
every way that can carry them: the terminal way takes them as flags; for a chip, set them on
the batch's session once its start report names it, where the host offers
`set_session_model` and `set_session_effort`. The start report says what the batch actually
runs at either way, and a difference goes to the user in a line.

## Reading the ground

```text
node "<plugin root>/scripts/batch-launch.mjs" probe <launch settings> [--launcher '<command>'] [--env NAME=VALUE ...]
```

| field | what it settles |
|---|---|
| `mode` / `modes[]` | the terminal way where it answers, and its `why` where it does not |
| `agterm` | this session's socket, window and workspace — found by its id, whatever window it moved to |
| `shell` / `claude` / `launcher` | the login shell, where `claude` sits on the PATH it builds, and the launcher's `path` there or its `why` |
| `env` / `configDir` | the variables the call names, by name, and the configuration the batch runs under |
| `settings` | model, effort and `batchesMax`, each with `from`: the user's `word`, the saved `config`, or the manifest's `default` |
| `load.holds` | the machine is busy enough that the next launch waits |
| `batches` | `running` — the worktrees of this repository a live session stands in, a batch's or anyone's, under the `configs` read (this session's own, the default, the call's), `live` naming them — against `max`, the `batches_max` setting; `running` is `null`, with `why`, where a registry did not read. A batch under another configuration is not counted: where the epic's batches run under several, its ledger's rows in flight hold a launch as well |

## Pacing

Launches go one at a time: the next only once the one before it answered `started`, and
none while `load.holds` or while `batches.running` stands at `batches.max` — `launch` and
`relaunch` refuse then, and a chip hung or an order pasted waits for the same room. A batch is
never launched twice at once. **The first launch after any change of way, launcher or
environment is a canary**: launch one batch, wait for its start report, check it against the
launch record — the title, the worktree, the model and effort, the configuration by its
`configDir`, a model the record names by alias matching what it resolves to — and only then the
rest. The ledger's header records which way, launcher and environment have cleared their canary.

## Launching

```text
node "<plugin root>/scripts/batch-launch.mjs" launch --batch <epic>/<id> \
  --mode agterm <launch settings> [--launcher '<command>'] [--env NAME=VALUE ...] \
  [--dry-run] < <the order's file>
```

The order arrives on stdin, its first line carrying the batch's title in backticks. A
`--dry-run` answers everything the launch would do and writes nothing — the preview.

| field | what it settles |
|---|---|
| `started` | `true` the session read its launch file and wrote its transcript; `false` nothing was opened — `reason` says what stopped it; `null` a session opened and wrote nothing yet — read its screen (`agtermctl session text --target <its id>`) for what holds it, and launch nothing more until it is settled; the launch file it has not read stays in `launchDir` |
| `configDir` | the configuration the batch runs under |
| `worktree` | the repository's `.claude/worktrees/<epic>-<id>`, which Claude Code makes as the session starts: the session starts at the repository's root and is handed `--worktree <epic>-<id>`. `confirmed` is `true` where the registry puts the session's claude there, `false` where it stands elsewhere — `reason` names it, and the user settles it before anything rests on the batch — and `null` where no live claude answered. The launch stops on what stands already — anything at the path, a link pointing nowhere included, a branch `worktree-<epic>-<id>`, a claude of this repository still making that worktree: a batch launched before is checked and relaunched, never launched over — and on an `<epic>-<id>` that names no branch, or is longer than Claude Code takes for a worktree's name |
| `trust` | where `--env CLAUDE_CONFIG_DIR` names another configuration, the trust this session's gives the repository, carried there: `held`, `shared`, `wrote`; `absent-in-source` is the user's to give, under this session's own configuration — the one it is carried from |
| `record` | what goes into the batch's ledger row, whole — its `env` carrying this session's `CLAUDE_CONFIG_DIR` where the launch exported it |

## While it runs, and after a restart

```text
node "<plugin root>/scripts/batch-launch.mjs" check --batch <epic>/<id> --session <uuid> [--agterm <id>] [--env NAME=VALUE ...]
```

`check` and `close` take the record's `--env` too, so they read the configuration the batch
runs under; `configs` names the ones read, and every reading below holds for them alone.
`live` is `true` while a session stands in the batch's worktree under any of them, `null` where
a registry did not read; `running` is `true` where any process carries the session — resumed
in another terminal or directory. `transcript.under` names the configurations that reach the
session's transcript. `agterm.idle` is `true` for a bare shell agterm restored — its place
kept, its claude gone: `close` it first, then check again — and `null` where agterm could not read what runs in the
session, a pane held open after claude exited among it: closing that one is the user's.
`relaunchable` is `true` only where every reading answered and nothing holds the batch.
`leftover` is `true` where nothing holds the batch, no transcript stands, and its worktree is as
Claude Code made it — clean, on `worktree-<epic>-<id>`, no commit of its own: what a start that
never reached its first prompt left. Removing that worktree and its branch is the user's, and
then the batch launches again.

A row from `launched` to `building`, or `blocked` from one of them, whose session is gone
after a restart is resumed — on `relaunchable` alone, never on a session merely not seen:

```text
node "<plugin root>/scripts/batch-launch.mjs" relaunch --batch <epic>/<id> --session <uuid> --agterm <id> \
  --title "<its title>" --mode agterm <launch settings> [--launcher '<command>'] [--env NAME=VALUE ...] \
  < <the nudge's file>
```

The way, the launcher, the environment, the model and the effort are the record's — the last
two passed as `--model` and `--effort`, the `launcher` as its JSON array, each `env` entry as
its own `--env` — unless the user's word moves them; a `CLAUDE_CONFIG_DIR` among them is one
of those `check`'s `transcript.under` names. A relaunch refused for a configuration that cannot
see the transcript goes to the user with its `reason`.

The nudge, one paragraph in the epic's language: the batch's title in backticks, that its
session was restored after a restart, the name of the master it reports to, and to go on
from where it stopped — reading its order, the ledgers and its own transcript before it
acts. A resume is no change of way, so no canary.

## Closing it

Where the user's word says this session closes finished batches (`wave-ledger.md`'s header),
a batch's session is closed once its row reaches `accepted`, unless the user asked to keep
it or it waits on the user:

```text
node "<plugin root>/scripts/batch-launch.mjs" close --batch <epic>/<id> --session <uuid> --agterm <id> [--env NAME=VALUE ...]
```

`closed` reads the tree again. It refuses a session running anything whose arguments do not
carry the batch's session id, or whose claude stands anywhere but the batch's worktree — one git
still registers; a bare shell standing anywhere but that worktree or, under a name carrying
the batch's address, the repository's root; one whose running program agterm could not read;
one waiting on the user; and one holding a second pane. For a chip, the session is archived instead, where
the host offers `archive_session`. The transcript and the worktree stay. Without that word,
closing stays an ask in the report.
