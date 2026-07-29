# Claude Code's own worktrees and sessions

Read by anything that acts on a worktree or on a branch a session may be standing
in. It describes **Claude Code**, not this plugin: it changes on the host's release
schedule, and asserting it in more than one skill is how the copies drift apart.

Most of it is **internal and undocumented**. Treat every shape below as a hint that
may be gone tomorrow, and let a failed probe mean *unknown* rather than *nothing
found*.

## What the host removes by itself

Do not duplicate or fight these:

- **Exiting an interactive worktree session.** A clean, unnamed session's worktree
  and branch are removed automatically; a named one, or one holding work, prompts
  first.
- **The periodic sweep** removes worktrees Claude created for **subagents and
  background sessions** once they are older than `cleanupPeriodDays`, skipping any
  that still hold work. It **never** removes a `--worktree` worktree.
- **`git worktree lock` while an agent runs.** The sweep releases a lock left by a
  session whose process exited; it never releases one set by hand.

**Automatic does not mean prompt.** `--worktree` and desktop-session worktrees, the
worktrees of `-p` runs (no exit prompt at all) and anything the sweep skipped for
holding work all sit there indefinitely — still the host's, just not yet collected.
**Branches** are the exception it never touches at all.

## A worktree is leased, not occupied

The host does not hand a worktree to a *process*. It **leases** it to a session:
a per-profile `git-worktrees.json` records `leasedBy: <sessionId>`, worktrees are
returned to a pool when released, and the host reuses them rather than cutting new
ones. A session that is merely closed — not archived — keeps its lease, because the
user is expected to resume into it.

So the lease outlives the process, and **a worktree with no running process is
routinely still someone's**.

Do not try to read the lease. That state lives in the desktop app's own storage,
one file per profile, outside `${CLAUDE_CONFIG_DIR}` and off any path this plugin
can derive; profiles disagree with each other about the same directory, and entries
outlive the directories they name. A check that reads one profile answers
confidently and wrongly.

## Which worktrees are running

The live-session registry answers this one, and only this one. Each file is one
running process and exists only while it runs:

```bash
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
[ -d "$CFG/sessions" ] || echo "REGISTRY-ABSENT"      # not the same as "nobody is working"
for f in "$CFG"/sessions/*.json; do
  [ -e "$f" ] || continue                             # unmatched glob stays literal
  pid=${f##*/}; pid=${pid%.json}
  kill -0 "$pid" 2>/dev/null || continue              # a file can outlive its session
  # One line per file, so a pretty-printed registry still matches. Never filter by
  # process name: an npm-installed Claude Code reports `node`, and a live session
  # read as dead is exactly the mistake that costs someone their work.
  tr -d '\n' < "$f" | grep -o '"cwd" *: *"[^"]*"' | head -1
done
```

A worktree is running when a live session's `cwd` **is that worktree's path, or
lies anywhere beneath it** — a session that stepped into a subdirectory is still
working in it. Compare in that direction only: the worktree is the ancestor, never
the descendant. More than one session can be in the same worktree at once (a second
client opened on the same directory), so any live match is enough.

An empty result is ambiguous, so separate the cases first: `REGISTRY-ABSENT`, or
zero `cwd` lines while session files exist, both mean the probe failed.

## The registry proves presence, never absence

**A live PID means occupied. No live PID means nothing at all** — the session may
be closed and resumable, holding its lease the whole time. Read the probe in that
one direction only, and let a worktree the host created stay the host's:

| what you can tell | what to do |
|---|---|
| a live session is in it | never touch it |
| no live session, and the host made it (`claude/…` branch, host worktree dir) | surface it; the lease is unreadable, and the host sweeps its own pool |
| it is yours — you cut it, or you are the session sitting in it | yours to remove |

The last row is the one exception to the row above, and it holds for one reason:
the lease-holder is the one asking. It does not extend to a *sibling* worktree of
the same host, whose holder is not in the room.

Which clients cut worktrees of their own is not established — the desktop app does,
and a session started elsewhere may simply be sitting in one the desktop made.
Treat an unfamiliar client as another host, not as an absence of one.

## What this answers, and what it does not

It answers **whose is this right now** — the question worth asking before an
irreversible act on shared state.

It does not answer what another session is *doing*. The registry carries `pid`,
`cwd`, `startedAt`, `kind`, `entrypoint` and a `name` derived from the worktree
directory: where and since when, never what. Nor is another session's uncommitted
working tree an answer — that is work its owner has not committed to, and it is
stale the moment you read it.

Git guards most of the collisions itself, loudly and with the offending path:
`git switch` and `git branch -f` on a branch checked out elsewhere both exit 128
naming the other worktree. The one that passes silently is `git branch -m`, which
retargets the other session's HEAD without a word — which is why
[`branch-naming.md`](branch-naming.md) probes for it before renaming.
