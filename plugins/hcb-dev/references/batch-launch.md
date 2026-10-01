# How a master session starts its batches

Read by the session coordinating an epic, wherever a batch goes out, comes back after a
restart, or ends. It owns the launch: the way a batch goes out, what it runs at, which
subscription carries it, and the commands that start, check, resume and close it. What
the order says differs by the way it went out, and that is
[`../skills/wave-dispatch/references/wave-order.md`](../skills/wave-dispatch/references/wave-order.md)'s.

## The way a batch goes out

First that answers, in this order:

| way | answers when | who starts it |
|---|---|---|
| `agterm-aimux` | `probe` says so: this session found in agterm's tree, `claude` and `aimux` able to start from the login shell, a profile with room | this session |
| `agterm` | `probe` says so: as above, a plain `claude` under this session's own configuration | this session |
| chip | this session holds the host's chip tool | the user's click |
| paste | always | the user, by hand |

The user's word overrides the way or the aimux profile — for the epic, for one wave ("this
time `main`"), or for one batch, the narrowest standing; each lands in the ledger it
belongs to ([`wave-ledger.md`](wave-ledger.md)). A way the word names that does not answer
here is not swapped for another: it goes to the user.

**Model and effort** are the settings' unless the user's word names others, and travel to
every way that can carry them: the terminal ways take them as flags; for a chip, set them on
the batch's session once its start report names it, where the host offers
`set_session_model` and `set_session_effort`. The start report says what the batch actually
runs at either way, and a difference goes to the user in a line.

## Reading the ground

```text
node "<plugin root>/scripts/batch-launch.mjs" probe <launch settings> [--limits [--held <profile>=<n>,...]]
```

| field | what it settles |
|---|---|
| `mode` / `modes[]` | the terminal way that answers first, and for each its `why` where it does not |
| `agterm` | this session's socket, window and workspace — found by its id, whatever window it moved to |
| `shell` / `claude` / `aimux` | the login shell, and where `claude` and `aimux` sit on the PATH it builds |
| `settings` | model, effort, profiles and ceilings, each with `from`: the user's `word`, the saved `config`, or the manifest's `default` |
| `load.holds` | the machine is busy enough that the next launch waits |
| `limits.profiles[]` | per allowed profile: both windows, `eligible`, `login` — `needed` is the user's to log into — `warmed`, `held`, `score` |
| `limits.pick` | the profile the next batch goes on: the most room per batch it already carries |
| `ran[]` | every aimux run it made — `auth status`, and a warm-up for a login that only needed refreshing |

`--held` names the batches of this epic in flight on each profile, counted from the wave
ledgers' rows. `probe` without `--limits` sends no request and is what a status reads.

## Pacing

Launches go one at a time: the next only once the one before it answered `started`, and
none while `load.holds`. **The first launch after any change of way or profile is a
canary**: launch one batch, wait for its start report, check it against the launch record
— the title, the worktree, the model and effort, the profile — and only then the rest.
The ledger's header records which way and profile have cleared their canary.

## Launching

```text
node "<plugin root>/scripts/batch-launch.mjs" launch --batch <epic>/<id> --pin <sha> \
  --mode agterm|agterm-aimux <launch settings> [--profile <name>] [--held <profile>=<n>,...] \
  [--dry-run] < <the order's file>
```

The order arrives on stdin, its first line carrying the batch's title in backticks. A
`--dry-run` answers everything the launch would do and writes nothing — the preview.

| field | what it settles |
|---|---|
| `started` | `true` the session wrote its transcript; `false` nothing was opened — `reason` says what stopped it; `null` a session opened and wrote nothing yet — read its screen (`agtermctl session text --target <its id>`) for what holds it, and launch nothing more until it is settled |
| `profile` | the profile and `from`: the user's `word` or the `spread`; `notes` says where a word overrode a ceiling |
| `worktree` | cut detached at the pin under the repository's `.claude/worktrees/<epic>-<id>`, or a clean idle one there `reused` |
| `trust` | the trust this session's configuration gives the repository, carried to the profile: `held`, `shared`, `wrote`; `absent-in-source` is the user's to give, under this session's own configuration — the one it is carried from |
| `record` | what goes into the batch's ledger row, whole |

## While it runs, and after a restart

```text
node "<plugin root>/scripts/batch-launch.mjs" check --batch <epic>/<id> --session <uuid> [--agterm <id>]
```

`live` is `true` while a session stands in the batch's worktree under any configuration
here, `null` where a registry did not read; `running` is `true` where any process carries the
session — resumed in another terminal or directory. `stalled` names the subscription window a session
stopped on and when it resets: say so to the user, with the batch and the reset time.
`agterm.idle` is a session agterm restored as a bare shell — its place kept, its claude gone:
`close` it first, then check again. `relaunchable` is `true` only where every reading
answered and nothing holds the batch.

A row from `launched` to `building`, or `blocked` from one of them, whose session is gone
after a restart is resumed — on `relaunchable` alone, never on a session merely not seen:

```text
node "<plugin root>/scripts/batch-launch.mjs" relaunch --batch <epic>/<id> --session <uuid> --agterm <id> \
  --title "<its title>" --mode agterm|agterm-aimux [--profile <name>] <launch settings> < <the nudge's file>
```

The way, the profile, the model and the effort are the record's — the last two passed as
`--model` and `--effort`; onto aimux the profile is always named, the recorded one or another
where the user's word or the recorded one's ceiling moves it.

The nudge, one paragraph in the epic's language: the batch's title in backticks, that its
session was restored after a restart, the name of the master it reports to, and to go on
from where it stopped — reading its order, the ledgers and its own transcript before it
acts. A resume is no change of way, so no canary.

## Closing it

Where the user's word says this session closes finished batches (`wave-ledger.md`'s header),
a batch's session is closed once its row reaches `accepted`, unless the user asked to keep
it or it waits on the user:

```text
node "<plugin root>/scripts/batch-launch.mjs" close --batch <epic>/<id> --agterm <id>
```

`closed` reads the tree again. It refuses a session standing anywhere but the batch's
worktree, one waiting on the user, and one holding a second pane. For a chip, the session is archived instead, where
the host offers `archive_session`. The transcript and the worktree stay. Without that word,
closing stays an ask in the report.
