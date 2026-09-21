# Claude Code's own worktrees and sessions

Read by anything that acts on a worktree, or on a branch a session may be standing in.
It describes **Claude Code**, not this plugin, and changes on the host's release
schedule. Most of it is internal and undocumented: treat every shape here as a hint that
may be gone tomorrow, and let a failed probe mean *unknown* rather than *nothing found*.

## What the host removes by itself

Do not duplicate or fight these:

- **Exiting an interactive worktree session.** A clean, unnamed session's worktree and
  branch are removed automatically; a named one, or one holding work, prompts first.
- **The periodic sweep** removes worktrees Claude created for **subagents and background
  sessions** once they are older than `cleanupPeriodDays`, skipping any that still hold
  work. It **never** removes a `--worktree` worktree.
- **`git worktree lock` while an agent runs.** The sweep releases a lock left by a
  session whose process exited; it never releases one set by hand.

**Automatic does not mean prompt.** `--worktree` and desktop-session worktrees, the
worktrees of `-p` runs and anything the sweep skipped for holding work all sit there
indefinitely — still the host's, just not yet collected. **Branches** are the exception
it never touches at all.

## A worktree is leased, not occupied

The host does not hand a worktree to a *process*. It **leases** it to a session, returns
it to a pool when released, and reuses it rather than cutting a new one. A session merely
closed — not archived — keeps its lease, because the user is expected to resume into it.
So the lease outlives the process, and **a worktree with no running process is routinely
still someone's**.

Do not try to read the lease. That state lives off any path this plugin can derive, and
what can be reached of it disagrees with itself about the same directory and outlives the
directories it names. A check built on it answers confidently and wrongly.

## Whose is it right now

`scripts/worktree-owners.mjs` answers that, and only that — for every worktree of a
repository at once:

```text
node "<plugin root>/scripts/worktree-owners.mjs" [--repo-dir <path>]
```

| field | what it settles |
|---|---|
| `owner` | `you` the worktree this run stands in — git's answer, which the registry cannot overrule; `another session` a live session is in it; `the host` it cut this one and the lease is unreadable; `unknown` the probe failed; `null` nothing known against it |
| `removable` / `unsettled` | the two lists a caller acts on: yours with nothing in the way, and the ones turning on the single thing this cannot know |
| `mayRemove` / `callerDecides` | the same two per worktree — `callerDecides` is **did you cut it**, which is your own memory of this conversation and nothing a probe can overrule |
| `blockers` | why not, in words a report can carry |
| `read` | `false` says which reading could not be taken, in `reason`. It answers nothing about any worktree — not "none of them are yours", which is what an empty list beside it would read as |
| `sessions` | the live ones in it: `pid`, `cwd`, `startedAt` — where and since when, never what. `isThisRun` marks the one this run IS |
| `probeFailed` | no registry, or **any** record that would not read — one unreadable record beside a live one still leaves the worktree that record is in looking free. **Not** a registry that read cleanly and found nobody, which is an answer |

**The registry proves presence, never absence.** A live pid means occupied; no live pid
means nothing at all ([`invariants.md`](invariants.md), *Empty is not negative*). So a
worktree the host made stays the host's, running or not — with one exception, which the
`you` verdict is: the lease-holder is the one asking. It does not extend to a *sibling*
worktree of the same host, whose holder is not in the room. Treat an unfamiliar client as
another host, not as an absence of one.

**And standing in a worktree does not make every session in it yours.** A second client
on the same directory, or a session this host cannot even verify, is somebody whose tree
the removal would take as well. Which record IS this run is answered by the process
chain — the session that spawned the run is an ancestor of it — and never by a directory,
which a record holds from its own start and two sessions can share: infer it that way and
a session that stepped into somebody else's worktree takes their record for its own.

**Occupancy does not stop at the worktree that holds it.** Removal is recursive, so a
live session in a worktree nested inside another goes with it — and a nested checkout is
not what makes the outer one dirty. Attribution stays innermost, which is who is where;
the verdict looks down.

Three measurements the script is built on, each of which a caller doing this by hand gets
wrong:

- **`kill -0` reads a live session as dead.** A process another user owns answers
  `EPERM` — which says it EXISTS — and the shell collapses that into failure. The script
  separates `EPERM` from `ESRCH`, and that is the one direction this must never get
  wrong.
- **The registry's `procStart` is not `ps`'s `lstart`.** Measured on the same pid:
  `Sat Sep 12 15:08:19 2026` against `Sat Sep 12 18:08:19 2026` — one instant in two
  zones. Comparing them as text calls every live session a stranger, so pid recycling is
  not guarded that way here.
- **The host leases its worktrees from a directory inside the repository.** Every one of
  them is therefore also under the main working tree, and attributing a session by
  containment alone reads that tree as occupied by people nowhere near it. The innermost
  worktree holding a `cwd` is the one that has it.

**The registry is written by other processes, so what it says is quoted, not repeated.**
A record also carries `kind`, `entrypoint` and a `name` Claude Code derived from that
session's own conversation — so a session that read something hostile can carry a
sentence of the attacker's choosing, and a sweep reading it would have that beside the
paths it is about to delete. None of the three answers a question this script was asked,
so none is carried out of it; `cwd` is, with the characters that would end a line or a
record taken out and a bound on its length. `startedAt` is epoch milliseconds, a number
— measured, whatever its name suggests.

Another session's uncommitted working tree is not an answer either — that is work its
owner has not committed to, and it is stale the moment you read it.

Git guards most collisions itself, loudly and with the offending path: `git switch` and
`git branch -f` on a branch checked out elsewhere both exit 128 naming the other
worktree. The one that passes silently is `git branch -m`, which retargets the other
session's HEAD without a word — so a rename reads this listing first and refuses where another
worktree stands on the name.
