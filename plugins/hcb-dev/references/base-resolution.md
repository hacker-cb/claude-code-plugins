# Resolving the base branch and its remote

Read by anything needing a base to diff against, a default branch to reason about, or a
remote to push to.

The one rule everything below serves: **never guess a name.** `master`, `main`, `dev`,
`trunk` — every repo picks its own, and `origin` is the same kind of guess. A guess that
*resolves* is not a guess that is *right*: it resolves to the wrong base, or the wrong
repository, and the run reports a plausible scope line over something else entirely.

## The remotes are a script's question

`scripts/resolve-base.mjs` answers them: which remotes exist and in what order to probe
them, which one to **read** a base from, which one a push actually goes to, and — given a
base — whether the ref for it is CURRENT.

```text
node <plugin root>/scripts/resolve-base.mjs [--base <name>] [--forge gh|glab]
```

| field | what it settles |
|---|---|
| `remotes.ranked` | the probing order — `upstream` and `origin` first, then every other remote, matched by whole name so `origin2` is neither taken for the real thing nor dropped |
| `remotes.read` | the ONE remote to read from: a preferred name, else a lone remote whatever it is called. `null` with a reason where several exist and none is preferred — **stop and ask**, since for a read that costs a wrong review and for a push it can publish a branch in somebody else's repository |
| `remotes.push` / `pushSource` | git's own routing, in its own order: `branch.<name>.pushRemote`, `remote.pushDefault`, `branch.<name>.remote` — the rung `git push -u <remote> <branch>` writes — then `origin`, then a lone remote. Never `@{upstream}`, which in a fork points at the canonical repository. **A configured route naming something that is not a remote here refuses**: falling past it answers with the one repository the configuration was written to avoid |
| `base.remote` / `base.ref` | which remote actually carries the base, found by probing the ranking rather than by asking the one picked outright — in a fork checkout a stack's parent is often on `origin` while `upstream` has never heard of it. Where several carry it and none is preferred, the same refusal as above: `base.ref` is what a caller diffs against, and taking the ranking's head there is the alphabetical pick by another route |
| `base.outcome` | `refreshed`, `silent`, `gone` or `local` (below) |
| `base.sharesHistory` | `false` refuses the base outright (below) |
| `requestBase` / `landings` | the open request's base, and where this repository's changes actually land, where `--forge` named one. Read, never chosen: which rung wins is the ladder's. A request whose head is in a **fork** is dropped — the filter is by branch name alone and matches across them, so its base is one somebody else chose — and open requests disagreeing about the base refuse rather than settle on the first. `--no-network` asks neither |

**The remote you *read* a base from is not the one you *write* a branch to**: in a fork
the base is in `upstream`, which you cannot push to.## The ladder — first hit wins

1. **A base the caller named.** An explicit base always wins.

2. **The base of the open change request** — `requestBase` above, a bare name to pair
   with whichever remote carries it.

3. **Where this repo's changes actually land** — `landings` above, ranked by count. A
   review usually runs *before* the request exists, so rung 2 comes back empty, and the
   default branch is the wrong guess in any repo targeting `dev`, `develop`, `release/*`.
   **If one non-default base dominates, use it and name it in the report** — that
   judgement is this rung's, not the script's.

4. **The repo default branch.** A question narrow enough to have its own script:
   `scripts/default-branch.mjs`, which the calling **skill** invokes — skill content is
   where the plugin root is substituted, while here the placeholder would stay literal
   text. It reads `<remote>/HEAD` without dereferencing it (after a rename that pointer
   keeps printing the old name with status 0 forever), verifies the ref it claims, asks
   the remote where the pointer is absent or dead, and materialises the tracking ref
   before answering. It refuses rather than guessing, and a refusal is "the question
   cannot be answered", never "nothing matched".

5. **`@{upstream}`** — last resort, narrowing the range to unpushed commits alone.

## What every rung owes the caller: a ref, and the name beside it

A resolved default gets used two ways, and they want opposite forms:

| the consumer wants | form | examples |
|---|---|---|
| a **ref** to read | `<remote>/<default>` | `diff`, `merge-base`, `rev-list`, `branch --merged`, `--set-upstream-to` |
| a **name** to become, merge into, or compare | bare `<default>` | `git switch`, `git merge`'s destination, `[ "$cur" = "$default" ]` |

Hand on **both**, and take each from the resolver's own answer rather than trimming
one out of the other — `${ref#*/}` over a fully qualified `refs/remotes/<remote>/<name>`
yields `remotes/origin/<name>`, which compares equal to nothing. Both are needed because
each direction of
the mistake fails differently and only one of them tells you.

**A bare name where a ref belongs is loud** — in a clone that never checked out the
default, `git branch --merged <default>` and `git rev-list <default>..<branch>` die.

**A ref where a name belongs is quiet, and that is the direction that costs work.**
`git checkout <remote>/<name>` exits 0 and detaches HEAD, and a `git merge` from
there exits 0 too — writing onto the detached HEAD while the branch it was meant to
land on never moves. Comparisons go the same way: `[ "$cur" = "<remote>/<default>" ]`
is false while standing on the default branch — test `$cur` against the bare name.

The remote-tracking ref is not guaranteed present either: a clone that fetched
only feature branches has no `<remote>/<default>` until you fetch it. Materialise
it before any consumer runs, and **never compose a ref from an empty name** — an
unreachable remote returns nothing, and `<remote>/` is a bogus ref that makes
every consumer fatal. An unresolved default is "the question cannot be answered",
not "nothing matched": say so and treat what depended on it as unknown.

## A resolved name is not a current ref

The ladder answers *which* base; it says nothing about *when*. `<remote>/<base>` holds
whatever the last fetch left there, so a branch cut from it, a range diffed against it and
a merge landing on it can all be built on a base the remote moved past days ago. The
script refreshes it — four outcomes, and only two mean current:

- **refreshed** — the ref is the remote's tip, whether or not it moved; "already up to
  date" is this outcome and not a separate one;
- **the remote did not answer** — the age is unknown, not "no new commits". The local ref
  stays standing and every consumer reads it without complaint, so a run treating this as
  success reports a branch current with a base nothing checked. Say it is unverified and
  treat what depended on its freshness as unknown;
- **`gone`** — every remote answered and none carries the branch: it was renamed or
  deleted since, so re-resolve by the ladder rather than carrying a name nobody has, and
  the answer names no ref at all (`git remote set-head <remote> --auto` retires the
  pointer, and a refspec-restricted fetch prunes nothing);
- **`local`** — there is a branch of that name here and no remote counterpart: a stack's
  parent before its first push, a repo with no remote. **Nothing is missing**, and saying
  so once is the whole step.

A `silent` outcome still names whatever stale copy is standing, so a caller can say what
it is reading and how old that is. It is **not** a reason to take a copy from a remote
further down the ranking: a remote that did not answer is not one that lacks the branch,
and in a fork those two tips diverge.

The three are told apart by asking the remote — `ls-remote --exit-code` answers 0, 2 and
neither — and never by reading git's own sentence about it, which git translates.

A consumer that only **reads** the base brings nothing over: it reads against
the ref, and a claim it makes about the tree names the revision it was read at.
The checkout it stands in may be older than that ref, and where it is, what the
base moved past is unread rather than absent. So read the base's own objects
rather than the files on disk — a working tree answers a search either way, and
one on a feature branch or behind the base answers it wrongly without saying so:

```bash
git show "<remote>/<base>:<path>"                     # the file as the base has it
git grep -n <pattern> "<remote>/<base>" -- <pathspec> # a search across the base
```

Then bring the local side to what arrived:

| the consumer | what refreshing means |
|---|---|
| cutting a new branch | cut from the **ref**, `<remote>/<base>` — unless the local branch is *ahead* of it, which is exactly what a local completion leaves behind (it merges and never pushes): that work is the parent, so cut from the branch and say the remote does not carry it |
| landing a merge on the base | `git merge --ff-only <remote>/<base>` **where the base itself is checked out** — from the branch you happen to stand on it fast-forwards *that* instead, quietly, and which worktree holds the base is [`slice-completion.md`](slice-completion.md)'s. A refusal means the base carries commits the remote does not — work to report, never something to reset away |
| a branch already cut | a rebase or a merge, and which one depends on what is built on its tip — the skill doing it owns that call |

## A base with no shared history is not a base

`base.sharesHistory: false` refuses it. Empty means a shallow clone (`clone --depth 1`,
`actions/checkout` at default depth) fetched neither side's ancestry, or the ref is
genuinely unrelated. Diffing against such a base is worse than not diffing at all — it
reports the base's own files as deletions the branch never made, and a reviewer dutifully
files findings about them. And watch what it does to a coverage count: "unknown" is
neither zero nor a number, so it slips past both a zero-file check and a count gate.

## When nothing resolves, ask

With no remote there is nothing to derive a default branch *from*, and any local guess is the
same hardcoded name wearing a disguise. Say what is missing and ask, naming the cost concretely
— "no remote, so I can't tell what this branch was cut from: give me a base, or this covers only
the working tree and leaves 3 commits unread."
