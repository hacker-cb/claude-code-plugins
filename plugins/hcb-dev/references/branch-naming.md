# Naming what lands in history — a branch, a commit, a change request

Read by anything that *creates* a branch, *normalizes* one it was handed,
*publishes* one, or writes the subject of a commit or the title of a change
request. It lives here, not in any one skill, because the shape of a name is
**forge-independent** — the repo's own authoring rule names branch naming as
exactly the kind of thing that belongs in one shared reference, since
prose copies drift and a fix then lands in some of them while the rest go on
saying something else.

The one rule everything below serves: **the name describes the change, and it is
chosen before anything reads it** — the merge commit, the change request, someone
scanning `git branch -a` six months from now. A name is cheap to fix while it is
local and expensive afterwards: published, it costs a network round trip; merged
with `--no-ff`, it is in the history for good.

## The shape

```text
<type>/[<issue>-]<name>
```

- `<type>` — a [Conventional Commits](https://www.conventionalcommits.org) type
- `<issue>` — the tracker number, where the work has one
- `<name>` — a short kebab-case description of what the change actually does

Examples: `fix/security-config`, `refactor/api-names`, `feat/420-csv-export`.

Pick both from the **diff and the task**, never from the old branch name — an
auto-generated name is precisely the thing carrying no information, and a
host-generated slug echoes the prompt that started the session, not the change
that came out of it. Lowercase ASCII, hyphens between words, a few words at most:
the name is read at a glance in a list, and every ref is also a path on disk.

## The commit subject and the change-request title take the same type

```text
<type>(<scope>): summary
```

One shape across all three, so the type chosen for the branch is the type the
history ends up carrying: where a change request is squashed, its title becomes
the commit's subject on the base.

Never write the change-request number into the title. Whether a number reaches
that subject at all is the forge's own merge setting, and where it does, a
hand-written one arrives twice.

## The repository's convention outranks this shape

Look before imposing anything. Where a repo clearly names its branches or writes
its subjects some other way — `JIRA-1234-…`, `<user>/…`, a bare description with
no type — follow it and
say in one line that you did; a house style that everyone's tooling already
expects beats a nicer shape imported from outside (`architecture-decisions.md`
§3: follow the rule, flag it non-blockingly if it fights good practice).

```bash
# GitHub
gh pr list --state merged --limit 30 --json headRefName -q '.[].headRefName'
# GitLab
glab mr list --merged --output json --per-page 30 | jq -r '.[].source_branch'
# Offline — whatever names the remote still carries. `lstrip=3` drops exactly
# `refs/remotes/<remote>/` and leaves the rest intact, so `feat/csv-export` stays
# two segments; `refname:short` would collapse `origin/HEAD` to a bare `origin`
# and seed the sample with a non-branch.
git for-each-ref --format='%(refname:lstrip=3)' refs/remotes | grep -vx HEAD
```

**A forge-side pattern is a gate, not a preference.** GitHub rulesets carry a
`branch_name_pattern` rule and GitLab push rules a `branch_name_regex`; where one
is configured, a name that does not match is rejected **at push time**, so a
branch named past it is unpushable rather than merely unconventional. Read it
where you can — mirrored, because a `gh`-only check leaves every GitLab repo to
discover its own rule from a rejected push:

"No rule configured" is a normal answer on both forges — GitHub returns a list
without the rule, GitLab answers 404 outright — so capture the result and read the
variable, rather than piping a failed call into `jq` and printing its error as if
it were a pattern:

```bash
# GitHub — rules already in force on that branch, ref_name conditions applied
gh_rule="$(gh api "repos/<owner>/<repo>/rules/branches/<branch>" 2>/dev/null \
  | jq -r '.[] | select(.type=="branch_name_pattern") | .parameters.pattern // empty' 2>/dev/null)"
echo "GitHub: ${gh_rule:-none}"
# GitLab — one push-rule object per project; <project> is URL-encoded ("group%2Frepo")
gl_rule="$(glab api "projects/<project>/push_rule" 2>/dev/null \
  | jq -r '.branch_name_regex // empty' 2>/dev/null)"
echo "GitLab: ${gl_rule:-none}"
```

`// empty` in the filter and `${var:-none}` in the shell: a default inside the jq
filter never fires on an empty body, which is what a missing rule leaves behind.

Treat a rejected push as a naming failure, not a permissions one.

## Sets — a feature branch and its slices

```text
feat/csv-export            # the shared feature branch
feat/csv-export--parser    # slice 1
feat/csv-export--writer    # slice 2
```

**Never nest a slice under its feature branch with a slash.** Refs are paths, so
the nested form needs one path to be both a file and a directory and git refuses
it. The `--` separator reads as the same nesting and cannot collide.

A single slice has no feature branch and no suffix: the one branch is named for
the change and lands on the base directly.

## Auto-generated, meaningful, and how to tell them apart

| The name is | Examples | Verdict |
|---|---|---|
| a host/tooling prefix | `claude/…`, `codex/…` | rename |
| a random or hashed suffix | `…-b29e59`, a bare uuid | rename |
| a placeholder | `wip`, `tmp`, `temp`, `branch-1`, `<user>-patch-1` | rename |
| a date or a bare number | `2026-07-28`, `1234` | rename, unless that *is* the repo convention |
| descriptive, but with no `<type>` | `csv-export`, `fix-login` | **leave it** — it is not auto-generated |
| already the shape | `feat/csv-export` | leave it — this step is a no-op |

The test is whether the name says what the change does. A descriptive name
missing its type prefix passes that test, so renaming it is cosmetics: it buys
nothing, and once the branch is published it costs a push plus a remote deletion.
Idempotence matters more than tidiness — every point below must be safe to run
over a name that is already fine.

## When it happens — three points, each idempotent

| Point | Who | What |
|---|---|---|
| **Creation** | whatever cuts the branch | name it correctly up front — nothing to rename later |
| **Normalization** | whatever completes the work, before it lands | rename a name that came from outside (a host worktree session, a hand-cut branch) |
| **Last resort** | the change-request driver | catch anything that reached the driver directly |

**Normalization is mode-blind.** A local completion needs it as much as a change
request does — arguably more: `git merge --no-ff` writes the branch name into the
merge commit (`Merge branch 'claude/…' into …`), where it stays in the parent's
history permanently. In request mode the name dies with the branch; in local mode
it is the part that survives.

**Do it before the first push, and always before a change request opens.** Both
are one-way doors: a pushed name needs a remote deletion to undo, and a name
under an open change request cannot be fixed at all (below).

## Renaming — the mechanics

The local half is plain git — no forge, no network — so it runs wherever
normalization happens, `shipping-workflow` step 0 included.

Two things are checked in advance, because only these two go wrong **quietly** —
an invalid name, a taken one, a directory/file collision, a detached HEAD all stop
`git branch -m` outright, naming the ref that blocked it.

```bash
cur="$(git symbolic-ref --short -q HEAD)" \
  || { echo "DETACHED HEAD — check out a branch first"; exit 1; }
NEW="<new>"
# QUIET #1 — `git branch -m <same-name>` exits 0 having done nothing, so a caller
# running this block for its push half would sail on to delete the ref it had just
# pushed under that same name. "Nothing to do" is a result, not a no-op.
[ "$cur" = "$NEW" ] && { echo "ALREADY $NEW — nothing to rename"; exit 0; }
# QUIET #2 — a branch checked out in ANOTHER worktree belongs to another session.
# Renaming it exits 0 and retargets that session's HEAD onto the new name without
# a word. Git normally holds one branch in one worktree, so for the CURRENT branch
# this fires only where
# `git worktree add --force` put it in two; the wider case the table below forbids
# is the two-argument `git branch -m <other> <new>`, which nothing in git prevents.
# Compare against THIS worktree's path, or the branch you stand on reads as
# someone else's.
here="$(git rev-parse --show-toplevel)"
git worktree list --porcelain | awk -v cur="refs/heads/$cur" -v here="$here" '
    /^worktree /{w=substr($0,10)}
    $0=="branch "cur && w!=here {print "  " w; found=1}
    END{exit !found}' \
  && { echo "CHECKED OUT ELSEWHERE — leave it to that session"; exit 1; }
git branch -m "$NEW"   # carries branch.<old>.* across, `pushRemote` included
```

- **Already published** — the local rename is then only half of it: the old name
  is on the remote and the new one is not. Push the new name, and delete the old
  ref **only** when the rename actually happened (the block above exits first when
  `cur == NEW`, which is what stops a caller from deleting the ref it just pushed)
  and **only** when no change request is open on that branch — deleting a head ref
  closes the request. Resolve the push remote *before* renaming — the ambiguity
  path exits, and exiting after `git branch -m` leaves a branch renamed locally
  with nothing pushed — per [`base-resolution.md`](base-resolution.md) ("Pushing is
  a different question"). The runnable version is `github-pr-workflow` Step 1.
- **Never `git branch -M`.** The force form overwrites an existing branch of that
  name — someone else's work, silently. On a collision pick a different name.

## Never

| ❌ | ✅ |
|---|---|
| rename a branch that already has an open change request | normalize *before* it opens — deleting the old head ref closes the change request and its review with it |
| rename a branch checked out in another worktree — `git branch -m <other> <new>` | probe `git worktree list` first (the block above); git performs that rename happily and retargets the other session's HEAD without a word |
| delete the old remote ref when the name did not change | the block exits on `cur == NEW`; a push followed by a delete of that same ref unpublishes the branch and closes any change request whose head it is |
| rename a shared branch others have pulled | leave it; a nicer name is not worth breaking someone's upstream |
| rename a host-session branch earlier than needed | Claude Code manages some of its own worktree sessions through undocumented bookkeeping ([`claude-worktrees.md`](claude-worktrees.md)) — normalize on the way into completion, not at cut |
| derive the new name from the old one | read the diff and the task; the old name is the thing with no information in it |
| nest a slice under its feature branch with `/` | `--` — refs are paths, and the nested form is a D/F collision |
| ask the user what to call a branch | a branch name is mechanical and reversible ([`architecture-decisions.md`](architecture-decisions.md) §1) — name it and narrate one line |
| impose this shape over the repo's own convention | read what the repo already does; flag a bad convention, follow it anyway |
