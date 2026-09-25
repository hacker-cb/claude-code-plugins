# The master's own tree

Where a master session's working tree stands, when it moves, and how the master reads and
runs anything off it.

## Where it stands

**Detached on the base, carrying nothing of its own**: on the ref the ledger's pins name
([`../../../references/wave-ledger.md`](../../../references/wave-ledger.md)), or on the local
parent where the epic completes in `local` mode
([`../../../references/slice-completion.md`](../../../references/slice-completion.md)). No
edit, no commit, no branch checked out — the switch to a newer tip is the only write it takes.
The branch the first switch leaves behind is residue for the epic's close to offer
`/hcb-dev:git-cleanup` for.

Only this session's own linked worktree moves, and only while no other session stands in it
([`../../../references/claude-worktrees.md`](../../../references/claude-worktrees.md)): nothing
here writes to the main checkout or to another session's worktree — no `cd` into one, no
`git -C` at one. A master that may not move its tree reads through refs only, and says so in
its first report.

## Moving it

First in every event of the master's loop, before anything in it is read — a report of a landing
among them — and on assuming the role, and first after a restart or a compaction. Where the base has not moved, the answer is `already`.

```bash
BASE="$(cat <<'NAME'
<the branch the ledger's pins name — before any pin, the base the assignment named, else the default branch>
NAME
)"
LOCAL='<yes where the epic completes in local mode, no otherwise>'
SINCE='<the commit the epic ledger's header says landings are taken up to — else its pin's sha; empty before either>'
S="<plugin root>/skills/master-session/scripts/master-tree.mjs"
R="$(node "<plugin root>/scripts/resolve-base.mjs" --base "$BASE")"; printf '%s' "$R" | jq '{base, reason}'
REF="$(printf '%s' "$R" | jq -r 'if .base.current and .base.sharesHistory then .base.ref else "" end')"
A=(); [ -n "$SINCE" ] && A=(--since "$SINCE")
if [ -z "$REF" ]; then echo "no current base: the resolver's answer above says why"
elif [ "$LOCAL" = yes ]; then node "$S" --ref "refs/heads/$(printf '%s' "$R" | jq -r .base.name)" --contains "$REF" "${A[@]}" --move
else node "$S" --ref "$REF" "${A[@]}" --move; fi
```

The resolver's outcomes are
[`../../../references/base-resolution.md`](../../../references/base-resolution.md)'s; what each
answer means here:

| what came back | here |
|---|---|
| `silent` | the tree stays where it stands, and what it reads is said to rest on a base not refreshed |
| `silent`, with `base.remote` null and several remotes named in `base.reason` | which remote carries the base is the user's to name: ask |
| `gone` | nobody carries the base's name: stop, and settle the base with the user before the ledger records another |
| `base.sharesHistory` false, or null | refused, or unknown: stop, saying which |
| `read: false` | nothing was measured: `reason` goes to the user, and nothing moves |
| `linked: false` | the main checkout: move nothing, read through refs only |
| `movable: false` | what stands — another session in the tree (`others`), the `dirty` entries, the `ownWork` commits, an operation `inProgress`, a local parent that lags — goes to the user, recommendation first, and not again while it stands unchanged; clearing it is theirs, and until then the tree is read through refs only |
| `move: "done"`, or `"already"` | `head` is the base, and the sha every fact of this event is read at; a `done` carrying `moveError` reached the base, and git's words go to the user all the same |
| `move: "dirty"`, `"refused"` or `"unread"` | `moveError` goes to the user, with where `head` stands and what `dirty` lists; nothing else is tried |
| the tree did not move | what this event reads, it reads through `ref.sha` — the tip just refreshed — never through `head`; through `contains.sha` where `contains.held` is false |
| `since.to` | `landed` is what the base took after `since.sha` up to `since.to`, newest first; where `landedCount` is more than it lists, the rest through `git log --first-parent <since.sha>..<since.to>`. Sort them into landings — the commits of one change request are one landing, the forge naming the request a commit belongs to; the commits none carries, together, are one push, its checks read at the newest of them. One the ledger already records is taken; every other is a landing as the master's loop takes one, reported or not. Once they are in the ledger, its header's mark moves to `since.to`. A reported landing neither the ledger records nor `landed` names is answered as not on the base yet, and looked for again at the next event |
| `since` null | run with no mark: the header's mark is set to the tip this event reads |
| `since.held` false | the base no longer holds the mark — rewritten past it: to the user, and the mark moves only on their word |
| `since.reason`, `held` not false | this event's landings are untold: said so; the mark stays, and the next event asks from it |

## Reading

Per `base-resolution.md`: the base's own objects, and every claim naming the revision it was
read at — the `head` this event's move left, or the sha a ref resolved to. The working tree is
read only in an event whose move answered `done` or `already` with nothing `dirty`, `hidden` or
`sparse` — and once that event has waited on anything (checks, a subagent, the user), only on
the script's answer taken again first, `--ref <head>` without `--move`, saying the same; and
never under a path `submodules` names, which is read through that submodule's own objects.

Another ref — a batch's branch, a change request's head, an older pin — is resolved to its sha
once and read through it: never checked out, and never resolved again between two reads of one
question. Git reads through `git show <sha>:<path>`, `git grep -e <pattern> <sha> --`, and
`git diff`, `git log -p` or `git show` of a commit with `--no-ext-diff --no-textconv`.

A reader subagent is handed the sha and reads through it, writing nothing; one reading a ref
other than the base runs isolated, as below.

## Running

Anything that runs the project's code or tools — tests, linters, a build, a generator, a probe,
a mutation — runs in a subagent launched with worktree isolation (`claude-worktrees.md`), on the
base as on any other ref. One subagent per question, handed the sha: it notes where it stands
(`git branch --show-current`, or `git rev-parse HEAD` where that is empty), switches its
worktree to the sha (`git switch --detach <sha>`)
and confirms `git rev-parse HEAD`, prepares what the run needs, runs, puts the worktree back
(`git reset --hard -q <sha> && git clean -fdq`, then `git status --porcelain` empty — what does
not clear is part of its answer), switches back to what it noted (`git switch <branch>`, or
`git switch --detach <commit>`), and returns what it
ran, the exit and what it printed. The
reads above are not runs, and neither is `git merge-tree`. A ref carrying commits from outside
this repository — a change request from a fork — runs only on the user's word, asked with what
would run.

A workflow's steps read through the sha and run nothing; a run goes to such a subagent. No
review round runs in this session: a review a return says was skipped is the reopened batch's
([`../../../references/order-return.md`](../../../references/order-return.md)).

## In this tree

The move is the only write to HEAD, the index, the working tree or the stash: nothing here
checks files out of another revision or back out of the index (`git checkout <ref> -- <paths>`,
`git checkout -- <path>`, `git restore`), stashes, resets, cleans, pulls, adds a worktree or
commits — what goes wrong goes to the user, with what stands.
