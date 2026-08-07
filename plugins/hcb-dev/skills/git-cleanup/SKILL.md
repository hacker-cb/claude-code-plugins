---
name: git-cleanup
description: >-
  Manual-only. Sweep the git residue work leaves in this repository — merged and orphaned branches, stale or abandoned worktrees, dead upstream tracking. Two modes, given as the argument: (S) `session` — only the branches and worktrees this session created, run before closing it; (A) `all` — everything the repository has accumulated, other sessions' leftovers included. Deletes branches; a worktree Claude Code created for another session it reports rather than removes, because the host leases those to sessions that outlive their processes. Never edits files, never runs `git reset`, and never writes to a remote — it reads merged and open change requests through the forge CLI, but pushes, deletes and edits nothing there.
disable-model-invocation: true
argument-hint: "[session|all]"
---

# Git cleanup

Branches and worktrees only. Untracked junk in the working tree is not this
skill's business — `.gitignore` is, and `seeding-gitignore` owns that.

## Step 1 — Ground truth

```bash
git worktree list --porcelain | head -1        # 'worktree <path>' — the PRIMARY worktree
```

`PROJECT` is that primary worktree path, **not** cwd: running from inside a
worktree still means cleaning the repository as a whole.

**The default branch and its remote come from
[`../../references/base-resolution.md`](../../references/base-resolution.md)** —
its rung 4 answers this, and it owns every trap on the way: why a read symref goes
on naming a branch the forge renamed away, why the answer travels as the
remote-tracking ref and never as a bare name, and why that ref must be materialised
and re-verified before anything consumes it. Resolve it there, then carry two
values into the rest of the sweep:

```bash
D="<the remote-tracking ref, per base-resolution.md — EMPTY unless it resolved AND
    that reference's refresh verified it>"
DEF="${D#*/}"   # bare name — ONLY for comparing against a branch name, never as a ref
[ -n "$D" ] || echo "DEFAULT-UNRESOLVED"
```

**`DEFAULT-UNRESOLVED` is not "nothing is merged"** — it is "the merge question
cannot be answered", and holding those two apart is this skill's whole safety
margin. Every branch's status becomes **unknown**: surface them all, delete none,
and say the remote was unreachable. The reason it matters here more than anywhere
else is that both failing commands answer in the vocabulary of success — a
`branch --merged` that died prints nothing, which reads as "no branches are
merged", and a `rev-list --count` that died prints 0, which routes a branch
straight to deletion.

If there is no remote at all, ask the user — nothing local names the default.

## Step 2 — Who is still working here

A worktree with a live session in it must not be removed, and git alone cannot
tell you. Run the probe from
[`../../references/claude-worktrees.md`](../../references/claude-worktrees.md) and
carry its answer into step 5 — **in one direction only.** A live session proves
the worktree is in use. Its absence proves nothing: the host leases worktrees to
*sessions*, not to processes, and a session that was merely closed keeps its lease
until it is archived. The lease is not readable from here.

So a worktree the host created for another session is never this skill's to
remove, running or not. What is left after that is still worth the sweep:
worktrees you cut yourself, and — the larger share — **branches**, which no host
cleanup touches.

Where the probe itself failed (no registry, or no `cwd` lines while session files
exist) say so once and treat every worktree but the current one as in use.

## Step 3 — The mode

The argument picks it. With no argument, ask — do not guess.

| | **S — `session`** | **A — `all`** |
|---|---|---|
| Question | "what did *this* session create?" | "what has this repository accumulated?" |
| Scope | branches and worktrees created after this session started | every branch and worktree, any age |
| Typical use | before closing a session | periodic audit |

**Mode S is what you remember creating in this conversation.** That record is the
source, not a corroborating one — you were there for every branch cut and every
worktree added. A timestamp probe cannot overrule it and does not settle the case
it looks built for: a session that was resumed, or whose process restarted, has a
start time later than the worktree it made, so its own work dates as somebody
else's.

Where memory is genuinely unsure about one item, list it. Mode decides *what is
listed*, never how freely anything is deleted — the risk class does that, and
step 6 puts the whole list in front of the user before a single deletion.

## Step 4 — Discovery (read-only, one parallel batch)

```bash
git -C "$PROJECT" worktree list --porcelain     # locked / prunable / detached, with reasons
# lstrip=2, NOT refname:short — the latter shortens to `heads/<branch>` wherever a
# tag shares the name, and every use below re-prefixes `refs/heads/`.
git -C "$PROJECT" for-each-ref refs/heads/ \
    --format='%(refname:lstrip=2) | %(worktreepath) | %(upstream:short) %(upstream:track)'
# Both read $D, so neither runs where step 1 left it empty: their answer is unknown,
# and it is these two whose failure shapes read as success.
git -C "$PROJECT" branch --merged "$D"
git -C "$PROJECT" rev-list --count "$D..refs/heads/<branch>"   # 0 -> carries nothing of its own
git -C "<each worktree path>" status --porcelain -unormal   # clean vs dirty — nothing else reports it
git -C "<each worktree path>" submodule status              # a line WITHOUT a leading '-' — populated
# --absolute-git-dir, NOT --git-dir: the latter answers `.git` for a primary
# worktree, and `ls` would resolve that against the caller's cwd. `-d` so an
# empty modules dir still prints, instead of leaving both branches silent.
ls -d "$(git -C "<each worktree path>" rev-parse --absolute-git-dir)/modules" 2>/dev/null || echo none
```

`for-each-ref` gives branch → worktree → upstream → `[gone]` in one pass; prefer
it over parsing `branch -vv`. `worktree list` never mentions modified or
untracked files, so without that per-worktree `status` there is no clean/dirty
signal at all and step 5 cannot tell a removable worktree from one holding work.
Read the two submodule commands for state, not for dirt: no line at all, or `-`
on every line, **and** `none` for the directory — that combination is the only
answer meaning nothing is there.

**Squash-merged branches look unmerged to git.** When the repo is on a hosted
forge and that forge's CLI is authed, close the gap read-only — asking, per
branch, **which requests carry its tip commit**. A branch name is the wrong
question: a merged `fix/login` may have come from a fork, or the local branch of
that name may have been recreated since, and a list of requests filtered by name
stops at a page where absence and a busy project look alike. The tip is the
identity, and a request carrying it carries every commit under it.

```bash
TIP="$(git -C "$PROJECT" rev-parse "refs/heads/<branch>")"
# Both CLIs read the repository from the directory they run in, and neither takes
# git's -C, so they run from $PROJECT: cwd may be another checkout entirely.
# --paginate on both, since these endpoints page and an open request on page two is
# an open request the sweep would delete over.
# GitHub — `api` resolves :owner/:repo from the checkout but not its host, so a
# self-hosted instance is asked of github.com unless --hostname says otherwise. The
# endpoint answers with merged AND open requests for a commit outside the default
# branch, which every squash merge leaves its tip; merged reads as state `closed`
# carrying a merged_at.
( cd "$PROJECT" || exit
  HOST="$(gh repo view --json url --jq '.url' | sed -E 's|^https?://([^/]+)/.*|\1|')"
  gh api --hostname "$HOST" --paginate "repos/:owner/:repo/commits/$TIP/pulls" \
    --jq '.[] | [.number, .state, (.merged_at // ""), (.merge_commit_sha // "")] | @tsv' )
# GitLab — `api` takes the host from that checkout itself. @tsv so an empty column
# keeps its place; either one can hold the commit
( cd "$PROJECT" || exit
  glab api --paginate "projects/:id/repository/commits/$TIP/merge_requests" \
    | jq -r '.[] | [.iid, .state, (.merge_commit_sha // ""), (.squash_commit_sha // "")] | @tsv' )
```

**An open request in that answer keeps the branch**, whatever else it says. A
merged one is a candidate, and where its merge landed settles it:

```bash
git -C "$PROJECT" merge-base --is-ancestor "<the merge commit>" "$D"
```

On GitLab that commit is **the first of the two columns that is non-empty**;
whichever is set is a commit on the target branch, and both empty leaves nothing
to check against. An answer naming no merged request at all is the same nothing:
the tip reached no request the forge merged.

Exit 1 leaves the branch standing — the request landed somewhere `$D` does not
carry. An object this repository does not have makes the check die instead
(`fatal`, not exit 1), and that is **unknown**: the branch stands too, and the
report says unknown rather than somebody else's work. An empty `$D` is unknown
for every branch — the check cannot run at all, which is what step 1 leaves
behind wherever the base did not verify.

**Spell every branch `refs/heads/<branch>`**, here and in step 5's rows. A tag of
the same short name wins the lookup, so the bare form measures the tag and routes
the branch to deletion on a proof that never described it.

Without a forge CLI, a branch outside `--merged "$D"` has **unknown** merge
status: surface it, never delete it.

## Step 5 — Classification

**Worktrees** — occupancy first, git state second.

| Signal | Verdict |
|---|---|
| primary worktree | never touch |
| the current session's own worktree | removable — its lease-holder is the one asking — but never from inside it: see step 7 |
| path is a live session's `cwd` | keep — someone is working there |
| **another** worktree the host made — a `claude/…` branch, or a directory in the host's own worktree dir — **that is still on disk** | **surface, never remove** — its lease survives the process and is unreadable from here (`claude-worktrees.md`). A registration whose directory is already gone is not this case: nothing is left to destroy, so it falls to the `prunable` rows below |
| `locked` | keep — Claude Code locks a worktree while its agent runs |
| `prunable`, and its path's parent directory exists | `worktree prune` (class 1) |
| `prunable` because the whole path is unreachable | surface (class 3) — an unmounted volume looks identical to a deleted worktree, and pruning strands the work it still holds |
| clean, its branch merged, and **this session cut it** | `remove` (class 2) |
| a populated submodule, or a `modules` directory in its admin dir | surface (class 3), and name that git dir at the gate: it lives in this worktree alone, so the removal takes whatever history it holds. Do not try to prove it empty — nothing here does |
| uncommitted or untracked changes | surface (class 3) — never `--force` unasked |
| on disk but absent from `worktree list` | a filesystem orphan: class 1 only if `git status` in it is empty, otherwise surface (class 3) — it is still someone's working tree |
| its branch has an open change request | keep |

**Branches**

| Signal | Verdict |
|---|---|
| the default branch, or checked out in a worktree you are keeping | never delete |
| checked out in a worktree being removed in this same run | delete after that worktree is gone — this is the common case, not an exception |
| in `branch --merged "$D"` | delete (class 2) |
| a merged request carries the branch tip, its merge commit is in `$D`, and no request on that tip is open | delete (class 2) — only the forge knows about a squash merge |
| a merged request carries the tip, and its merge commit is not in `$D` | surface (class 3) — it landed somewhere the base does not carry |
| no merged request carries the tip | surface (class 3) — the branch moved past every request, or the forge never had it |
| the merge commit is a commit this repository does not have, or `$D` is empty | surface (class 3) — unknown, which is not "not merged" |
| `[gone]` upstream **and** merged | delete (class 2) |
| `[gone]` upstream, **not** merged | surface (class 3) — may hold the only copy |
| the forge CLI says its PR/MR is `OPEN` | keep |
| no upstream, `$D` non-empty, and `rev-list --count "$D..refs/heads/<branch>"` = 0 | delete (class 2) — nothing to lose |
| no upstream, unique commits | surface (class 3) |

**Rows overlap.** An open request keeps the branch whatever else matched. A
surface row beats a delete row **within the same proof** — the forge's unknown row
stops the forge's own delete, and says nothing about a branch git itself proved
merged, which `branch --merged` settles without the forge answering at all. A
branch reaching a delete row by no row of its own — the worktree row above is the
case — is deleted only by what step 7 will still prove.

**Risk classes** decide the gate, whatever the mode:

| Class | Meaning | Gate |
|---|---|---|
| 1 | no data loss — `worktree prune` of a reachable `prunable` entry | act, then report |
| 2 | recoverable — a merged branch, a clean worktree, an upstream repair | inside the confirmed plan |
| 3 | irreversible — unmerged branch, dirty worktree, **any working-tree file** | explicit confirmation, always |

Anything that deletes a file someone could still want is class 3, whichever
table routed it there. An `rm -rf` is never class 1.

## Step 6 — The gate

Present one table: item, what it is, age or state, verdict, risk class. Then ask
once, naming what is irreversible and what it would destroy. Wait for an explicit
answer; a subset means only that subset.

## Step 7 — Execute, in this order

```bash
git -C "$PROJECT" worktree remove "<path>"         # 1. --force ONLY on a confirmed class-3 item:
                                                   #    a dirty worktree, or one remove refuses
                                                   #    over a submodule. Plain remove re-checks
                                                   #    clean at execution time; --force does not
rm -rf "<orphan-worktree-dir>"                     # 2. approved class-3 items only
git -C "$PROJECT" worktree prune --verbose         # 3. AFTER the rm, or the entry it just
                                                   #    orphaned still blocks its branch
git -C "$PROJECT" branch -D "<branch>"             # 4. ONLY behind the branch's own re-proof
                                                   #    below — nothing else authorizes a delete
```

**`-d` is not a lighter `-D`, and neither command is the proof.** `-d` re-checks
against `PROJECT`'s HEAD, or the branch's own upstream where it has one — never
against `$D` — so it deletes what these rows keep and refuses what they proved.
What authorizes a deletion is the re-proof the branch's own row calls for, **run
here and not read off step 4**: step 6 waits on a human, and both what the branch
carries and what the forge says about it can move while it waits. A branch with no
proof of its own is not deleted at all — report it instead.

Two things come first, in this order, on every branch reaching this step:

- **Re-resolve `$D` and `$DEF` together**, through `base-resolution.md`. The
  repair block at the end of this step reads `$DEF`, so a `$D` emptied here and a
  `$DEF` left standing sends every surviving branch through `--unset-upstream`.
- **Re-ask step 4's query on the tip as it stands now**, wherever a forge CLI
  answered it there. A tip that moved while the gate waited belongs to no merged
  request, so the answer that authorized the deletion is simply gone; an open
  request in it keeps the branch whatever any proof says.

Then the branch's own proof, whichever routed it:

```bash
# EMPTY where no forge CLI answered — which is "not asked", not "none open", so the
# git rows below still stand on their own proof.
OPEN="<step 4's open count for this tip, re-asked now — EMPTY without a forge CLI>"
if [ -n "$OPEN" ] && [ "$OPEN" != 0 ]; then
  echo "a request on this tip is open — keep the branch"
elif [ -z "$D" ]; then
  echo "skipping -D — default branch unresolved"
# the forge's row: where the merge of the request carrying this tip landed
elif git -C "$PROJECT" merge-base --is-ancestor "<the merge commit>" "$D"; then
  git -C "$PROJECT" branch -D "<branch>"
# git's own rows: the count that routed it
elif [ "$(git -C "$PROJECT" rev-list --count "$D..refs/heads/<branch>")" = 0 ]; then
  git -C "$PROJECT" branch -D "<branch>"
else
  echo "the proof no longer holds — surface it, saying whether it failed or could not run"
fi
```

Name in the report which proof each deletion stood on.

To remove the worktree **you are standing in**, physically leave first
(`git worktree remove` inspects the real cwd):

```bash
cd "<PROJECT>"                                 # a separate Bash call — cwd must truly change
git -C "<PROJECT>" worktree remove "<old-cwd>"
```

Then tell the user cwd moved to `PROJECT` — their old path no longer exists.

**Last, repair the tracking** — one branch at a time, and only on branches that
survived the deletions above. `$D` and `$DEF` are step 1's ref and its bare name;
which belongs where is `base-resolution.md`'s ref-versus-name rule, and swapping
them here unsets the tracking this was meant to repair.

```bash
CURRENT="<the branch being repaired>"

# Re-point at the default ONLY when this IS the default branch; on any other
# branch drop the dead upstream and let `git push -u <remote> "$CURRENT"` restore
# it. Skip entirely on DEFAULT-UNRESOLVED: an empty $DEF matches no branch, so the
# else arm would strip every upstream on the one run told it cannot answer.
if [ -z "$DEF" ]; then
  echo "skipping upstream repair — default branch unresolved"
elif [ "$CURRENT" = "$DEF" ]; then
  git -C "$PROJECT" branch --set-upstream-to="$D" "$CURRENT"
else
  git -C "$PROJECT" branch --unset-upstream "$CURRENT"
fi
```

## Step 8 — Verify and report

Re-run discovery. Report what went, what was kept and why, and — separately —
what was surfaced and left for the user to decide. List the class-1 actions taken
without asking.

## Never

| ❌ | ✅ |
|---|---|
| remove a worktree Claude Code created, however idle it looks | report it — the lease outlives the process and is unreadable from here |
| read "no live session" as "nobody needs it" | the probe proves presence only; absence is not an answer |
| `git worktree unlock` something Claude Code locked | leave it; the periodic sweep releases stale locks itself |
| `git submodule deinit` to get past `worktree remove`'s refusal | `--force` — a linked worktree shares `.git/config`, so the deinit unregisters the submodule for the **primary** worktree too, and the removal refuses all the same |
| `rm -rf` a path outside this repository's worktree directories | resolve it from `worktree list` / the git dir, never from a name |
| push, or delete a **remote** branch | keep the forge CLI read-only — never merge/close/edit a PR/MR |
| `git reset`, stage, commit, or edit files | git plumbing and worktree removal only |
| hardcode `~/.claude` | `${CLAUDE_CONFIG_DIR:-$HOME/.claude}` |

## Edge cases

- **The forge CLI offline or rate-limited mid-run** — degrade to git-only for the
  rest of the pass and downgrade every forge-derived "merged" to "surface". The
  sweep gets narrower, never wider.
- **Detached HEAD worktree** — classify by clean/dirty only; no branch to delete.
- **A branch checked out in a worktree of a *different* repository** — leave both
  alone; this skill stays within `PROJECT`.
- **Submodules** — never operate on one. Removing a worktree that contains one is
  step 7's `--force`, not a submodule operation.
