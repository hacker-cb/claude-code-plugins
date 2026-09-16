# Naming what lands in history — a branch, a commit, a change request

Read by anything that *creates* a branch, *normalizes* one it was handed,
*publishes* one, or writes the subject of a commit or the title of a change
request. The shape of a name is **forge-independent**.

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

That covers the work the branch is *for*. A commit riding along with it — a fix
the work made in passing ([`findings.md`](findings.md)) — takes the
type of that fix instead, so the history says which commit is the change and which
is the passenger.

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
# `lstrip=3`, NOT `refname:short`: it drops exactly `refs/remotes/<remote>/`, keeping
# `feat/csv-export` two segments, where `refname:short` collapses `origin/HEAD` to a
# bare `origin` and seeds the sample with a non-branch.
git for-each-ref --format='%(refname:lstrip=3)' refs/remotes | grep -vx HEAD
```

**A forge-side pattern is a gate, not a preference**, and a name past it is rejected
**at push time** — a naming failure, never a permissions one. Read it mirrored: a
`gh`-only check leaves every GitLab repo to discover its rule from a refused push.

```bash
# GitHub — the rules already in force on that branch, ref_name conditions applied
gh api "repos/{owner}/{repo}/rules/branches/<branch>" 2>/dev/null \
  | jq -r '.[] | select(.type=="branch_name_pattern") | .parameters.pattern // empty'
# GitLab — one push-rule object per project; <project> is URL-encoded ("group%2Frepo")
glab api "projects/<project>/push_rule" 2>/dev/null | jq -r '.branch_name_regex // empty'
```

"No rule configured" is an ordinary answer on both and each spells it differently —
GitHub a list without that row, GitLab a 404 on the whole object. Capture the result
and read the variable: a `// empty` default inside the filter never fires on the empty
body a missing rule leaves behind, and a failed call piped onward prints its own error
where a pattern should be.

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

## Renaming and publishing — the mechanics

`scripts/branch-publish.mjs` answers one question and acts on it: **what name does this
branch ship under, is that name on the remote, and what of the names it used to carry
comes off**. Unlike the scripts beside it this one acts, and the ORDER it acts in is the
whole hazard — a rename is refused wherever a change request pins a name, the publish is
unconditional, and a name comes off the remote only after the new one is up.

```text
node <plugin root>/scripts/branch-publish.mjs --new <name> [--old-name <name>]
  [--publish --push-remote <name>] [--base <name> --base-remote <name>]
```

**Every skill that renames writes that command itself**, the plugin root being substituted
in skill content and staying literal text here. `--publish` is opt-in rather than inferred
from a remote being named: a caller that forgot it would otherwise get a silent no-op
where the push is the whole point.

| field | what it settles |
|---|---|
| `read` | `false` renamed nothing and published nothing — a detached HEAD is the case |
| `branch.ships` | **the name it actually ships under**, which is not always the one asked for |
| `renamed` / `restored` | whether the rename happened, and whether it was *undone* — a request heading the name a caller renamed away pins that name |
| `published` | `true` on the remote under `ships`; **`null` is "not asked", never refused** |
| `publish.mode` | `first`, `fast-forward` or `leased` — which push the remote's state owed |
| `publish.reason` | why not, where `published` is `false` |
| `stale[].verdict` | per name it used to carry: `retired` taken off this run, `absent` not there, `kept` with the `reason` the report carries |
| `notes` | why the name it ships under is not the one asked for |

**Every proof before a name comes off the remote is required, and one that cannot run keeps
the ref**: no open change request heads it, since deleting a head ref closes the request
along with its review; no other worktree stands on it; the remote answered and the ref is
there; its tip is one this branch stood on, by `HEAD` or by its reflog; and it holds
something past the base. **The base itself is refused by name, not by that last proof** —
pushing to a fork while basing on the upstream inverts it, the fork's own base legitimately
holding what the upstream has not.

**The request probe is asked only where something is published**, because that is where a
ref can be destroyed: a rename alone strands nothing, so a local normalization renames with
no network call at all. And the probe speaks `gh`; on GitLab it cannot answer, so a
publication there keeps every name and retires none until the same reading is done by hand.

**A hit belongs to the repository being PUSHED to, not to the one the CLI speaks for.**
The filter is by branch name, which is not unique across forks — and in a fork checkout the
CLI answers for the base, where the request lives, while the head ref a deletion would
remove is on the fork. Compared the wrong way round it drops exactly the request about to
be closed and keeps the ones nothing could reach, so the comparison is against the push
remote's own url, and a remote that names no repository — a filesystem path — keeps every
hit.

- **Never `git branch -M`.** The force form overwrites an existing branch of that name —
  someone else's work, silently. On a collision pick a different name.
- **A second worktree can stand on this same branch** (`git worktree add -f`), and the
  one-argument rename moves it for that session too. The script refuses the rename there,
  and refuses it again where the worktree listing could not be read at all.
- **Resolve the push remote before renaming**, per
  [`base-resolution.md`](base-resolution.md) ("Pushing is a different question"):
  `branch.<name>.pushRemote` is read under the name the branch carries now, and an
  ambiguity that exits after the rename leaves a branch renamed locally and nothing
  pushed.
- Where the rename and the publication happen in different steps, the old name travels
  between them as `old-name` ([`slice-completion.md`](slice-completion.md)).

## Never

| ❌ | ✅ |
|---|---|
| rename a branch checked out in another worktree — `git branch -m <other> <new>` | probe `git worktree list` first; git performs that rename happily and retargets the other session's HEAD without a word. The one-argument form renames the branch you stand on and cannot reach another's |
| rename a shared branch others have pulled | leave it; a nicer name is not worth breaking someone's upstream |
| rename a host-session branch earlier than needed | Claude Code manages some of its own worktree sessions through undocumented bookkeeping ([`claude-worktrees.md`](claude-worktrees.md)) — normalize on the way into completion, not at cut |
| derive the new name from the old one | read the diff and the task; the old name is the thing with no information in it |
| nest a slice under its feature branch with `/` | `--` — refs are paths, and the nested form is a D/F collision |
| ask the user what to call a branch | a branch name is mechanical and reversible ([`architecture-decisions.md`](architecture-decisions.md) §1) — name it and narrate one line |
| impose this shape over the repo's own convention | read what the repo already does; flag a bad convention, follow it anyway |
