# Naming a branch — the shape, and when to apply it

Read by anything that *creates* a branch, *normalizes* one it was handed, or
*publishes* one. It lives here, not in any one skill, because the shape of a name
is **forge-independent** — the repo's own authoring rule names branch naming as
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
<type>/<name>
```

- `<type>` ∈ `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`
- `<name>` — a short kebab-case description of what the change actually does

Examples: `fix/security-config`, `refactor/api-names`, `feat/csv-export`.

Pick both from the **diff and the task**, never from the old branch name — an
auto-generated name is precisely the thing carrying no information, and a
host-generated slug echoes the prompt that started the session, not the change
that came out of it. Lowercase ASCII, hyphens between words, a few words at most:
the name is read at a glance in a list, and every ref is also a path on disk.

## The repository's convention outranks this shape

Look before imposing anything. Where a repo clearly names its branches some other
way — `JIRA-1234-…`, `<user>/…`, a bare description with no type — follow it and
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

`// empty` rather than `// "none"` in the filter: on an empty body — which is what
a 404 or an auth failure leaves behind — `jq` prints nothing and still exits 0, so
a default inside the filter never fires and `|| echo none` never runs. The shell's
`${var:-none}` is what actually covers that case.

Treat a rejected push as a naming failure, not a permissions one.

## Sets — a feature branch and its slices

```text
feat/csv-export            # the shared feature branch
feat/csv-export--parser    # slice 1
feat/csv-export--writer    # slice 2
```

**Never nest a slice under its feature branch with a slash.** Refs are paths:
`refs/heads/feat/csv-export` is a *file*, so `refs/heads/feat/csv-export/parser`
would require that same path to be a *directory* — git refuses one or the other
outright ("cannot lock ref"), and which one dies depends on the order they were
created. The `--` separator reads as the same nesting and cannot collide.

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

## When it happens

Name it right at creation; rename anything that arrived from outside on the way
into completion, before the work lands. Every application is idempotent, so
running it over a name that is already fine costs nothing.

**Do it before the first push, and always before a change request opens.** Both
are one-way doors: a pushed name needs a remote deletion to undo, and a name under
an open change request cannot be fixed at all.

**And do it in both completion modes.** A local merge needs it as much as a change
request does — arguably more: `git merge --no-ff` writes the branch name into the
merge commit (`Merge branch 'claude/…' into …`), where it stays in the parent's
history permanently. In request mode the name dies with the branch at merge; in
local mode it is the part that survives.

## Renaming — two rules, and git handles the rest

The rename itself is `git branch -m <new>`. Do not wrap it in checks for what git
already refuses: a taken name, a malformed name, a D/F collision (`refs/heads/docs`
as a file blocks `docs/…`, and vice versa), a detached HEAD — every one of those
fails loudly with a message that says what to do, and a loud failure teaches at
runtime for free.

Two cases git will **not** stop you on, because it cannot see them:

- **The branch is checked out in another worktree.** `git branch -m` succeeds, exit
  0, no warning — and silently retargets that worktree's `HEAD` (verified on git
  2.54). Someone may be working in there right now. Leave the name alone and say so.
  `git worktree list --porcelain` is how you find out.
- **The branch is published and carries an open change request.** There is no good
  ending: delete the old ref and the request closes, taking its review threads with
  it; leave the old ref and the request goes on tracking a branch that no longer
  receives your work. Either way the name is now fixed — so check before renaming,
  not after.

  Publication is the existence of a remote-tracking ref, **not** `@{upstream}`:
  upstream is push-time config, and `git push <remote> <branch>` without `-u`
  publishes the branch while setting nothing.

  ```bash
  # GitHub
  gh pr list --head "<branch>" --state open --json number
  # GitLab
  glab mr list --source-branch "<branch>" --output json
  ```

  **Require a positive answer, not the absence of a negative one.** These fail in
  ways that look like "no request": `gh` with the wrong default repo exits 0 with
  empty output, an expired token errors, neither CLI may be installed. No answer
  means keep the name.

**Already published and the rename went through** — push the new name, and delete
the old ref only if the check above actually cleared. Resolve the push remote
*before* renaming, per [`base-resolution.md`](base-resolution.md) ("Pushing is a
different question"), through its non-interactive guard. The runnable version is
`github-pr-workflow` Step 1, and the delete is the one irreversible step in it.


## Never

The script above enforces what a script can. These are the ones it cannot — either
because nothing local can detect them, or because they belong to the caller:

| ❌ | ✅ |
|---|---|
| `git branch -M` | never. The force form overwrites an existing branch of that name — someone else's work, silently. On a collision pick a different name |
| delete the old remote ref when the name did not change | read `renamed:` first; a push followed by a delete of that same ref unpublishes the branch and closes any change request whose head it is |
| rename a shared branch others have pulled | leave it; a nicer name is not worth breaking someone's upstream, and no local probe can see that they pulled |
| rename a host-session branch earlier than needed | the host owns `claude/…` and cleans up its own worktree sessions through internal, undocumented bookkeeping — normalize on the way into completion, not at cut |
| derive the new name from the old one | read the diff and the task; the old name is the thing with no information in it |
| nest a slice under its feature branch with `/` | `--` — refs are paths, and the nested form is a D/F collision |
| ask the user what to call a branch | a branch name is mechanical and reversible ([`architecture-decisions.md`](architecture-decisions.md) §1) — name it and narrate one line |
| impose this shape over the repo's own convention | read what the repo already does; flag a bad convention, follow it anyway |
