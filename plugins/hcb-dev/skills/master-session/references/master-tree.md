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

- on assuming the role, and first after a restart or a compaction;
- at every landing on the base — its batch's, another session's, the user's;
- before a read of its working tree where the check under *Reading* finds HEAD off the base.

```bash
BASE="$(cat <<'NAME'
<the branch the ledger's pins name — before any pin, the base the assignment named, else the default branch>
NAME
)"
LOCAL='<yes where the epic completes in local mode, no otherwise>'
S="<plugin root>/skills/master-session/scripts/master-tree.mjs"
R="$(node "<plugin root>/scripts/resolve-base.mjs" --base "$BASE")"; printf '%s' "$R" | jq '{base, reason}'
REF="$(printf '%s' "$R" | jq -r 'if .base.current and .base.sharesHistory then .base.ref else "" end')"
if [ -z "$REF" ]; then echo "no current base: the resolver's answer above says why"
elif [ "$LOCAL" = yes ]; then node "$S" --ref "refs/heads/$(printf '%s' "$R" | jq -r .base.name)" --contains "$REF" --move
else node "$S" --ref "$REF" --move; fi
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
| `movable: false` | what stands — another session in the tree (`others`), the `dirty` entries, the `ownWork` commits, an operation `inProgress`, a local parent that lags — goes to the user, recommendation first; clearing it is theirs, and until then the tree is read through refs only |
| `move: "done"`, or `"already"` | `head` is the base, and the sha every fact is read at |
| `move: "dirty"`, `"refused"` or `"unread"` | `moveError` goes to the user, with where `head` stands and what `dirty` lists; nothing else is tried |

## Reading

Per `base-resolution.md`: the base's own objects, and every claim naming the revision it was
read at — the `head` the last move left, or the sha a ref resolved to. The working tree is read
only on an answer `master-tree.mjs` gave just before that read — `--ref <that sha>`, without
`--move` — saying `head` is that sha, with nothing `dirty`, `hidden` or `sparse`; and
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
base as on any other ref. One subagent per question, handed the sha: it switches its own
worktree there (`git switch --detach <sha>`) and confirms `git rev-parse HEAD`, prepares what
the run needs, runs, removes what the run left that `git status` lists, switches back to its
own branch (`git switch -`), and returns what it ran, the exit and what it printed. The reads
above are not runs, and neither is `git merge-tree`.

A workflow's steps read through the sha and run nothing; a run goes to such a subagent. No
review round runs in this session: a review a return says was skipped is the reopened batch's
([`../../../references/order-return.md`](../../../references/order-return.md)).

## In this tree

The move is the only write to HEAD, the index, the working tree or the stash: nothing here
checks files out of another revision or back out of the index (`git checkout <ref> -- <paths>`,
`git checkout -- <path>`, `git restore`), stashes, resets, cleans, pulls, adds a worktree or
commits — what goes wrong goes to the user, with what stands.
