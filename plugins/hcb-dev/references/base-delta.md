# What a base that moved brought to the work in flight

Read wherever a base is taken onto work in flight — a branch synced, a slice landed on its
parent, a feature branch brought current, an order's facts re-verified against a newer tip — and
the work has to be read against what arrived. This file owns where that delta starts, what it is
read for, and what the reader does with each kind of consequence. It lives outside any one skill
because a sync, a landing and a re-verification reading the same delta have to reach the same
conclusions about it.

**Take and read in one step.** Git already records how far a branch has absorbed its base: its
merge base. Where every take reads, in that same step, what it brought, the merge base is also how
far the work has been read against, and nothing else needs recording. A take whose delta goes
unread leaves the next reader starting past it.

## Where it starts

Three points, all fixed after the base is fetched and **before** it is taken — the take moves the
first, and a merge base read afterwards answers the new tip:

```bash
REF="<the refreshed base ref>"
M="$(git merge-base HEAD "$REF")"; H="$(git rev-parse HEAD)"
F="$(git merge-base --fork-point "$REF" HEAD)"   # the base's reflog, remembering tips it dropped
```

- **The delta** — `$M..$REF`: `git log --first-parent --oneline "$M..$REF"` for what landed,
  `git diff --name-only "$M" "$REF"` for what it touched. It is read through the ref, never
  through the working tree ([`base-resolution.md`](base-resolution.md)).
- **The work's own files** — `git diff --name-only "$M" "$H"`, plus whatever is uncommitted.
- **The facts the work rests on** — its issues, its plan — start earlier where they were read
  before `M`: a batch's order pin, until the batch has re-verified the order at its start; the
  point a build's analysis read the tree at, until its first cut. Read the facts from that point,
  and everything else from `M`.

**Where the start is no start**, say so rather than read a range that means nothing:

- **`M` empty** — a shallow clone, or a ref sharing no history with the work, which
  `base-resolution.md` refuses as a base: the delta is unread, and no range is built from it.
- **`F` a commit that is not an ancestor of `$REF`** — the base was rewritten under the work, and
  `M` alone cannot see it, being an ancestor of `$REF` by construction. What the base dropped
  would come back as the work's own under a rebase: the delta is unknown, and the take is a fork.
- **The facts' earlier point not an ancestor of `$REF`** — the same rewrite, seen from a pin.

## What it is read for

Four kinds. Whether a consequence is mechanical or a fork is
[`architecture-decisions.md`](architecture-decisions.md) §1's line — does the code contain the
answer — and nothing here is a fixed list of names: judge a file by what it does in this
repository.

**The code in flight.**

- Where the delta touched the work's own files, re-read them at `$REF`.
- Where it changed what the work's code calls — a signature, a name, a module that moved — find
  the callers.
- Where it changed how the repository is built or judged — its instructions to agents, a linter's
  or formatter's configuration, the checks CI runs — the work now answers to that.

The mechanical part is running the project's own checks on the synced tree: what git merged
cleanly, it did not prove works. A break the delta caused is named first. Whether it is repaired
in the same step is the reader's call — a landing repairs it before its review, a sync reports it.

**The environment.** Installing dependencies from a lockfile the delta changed, and regenerating
files the project generates locally, are mechanical. Anything that writes state outside this
checkout — a shared database migrated, a service redeployed — is a fork.

**The issues the work carries.** Rule again, per [`issue-currency.md`](issue-currency.md) and
against `$REF`, only the ones whose coordinates the delta touched or that a landing in it names;
the rest keep the verdict and the point they were ruled at. A change made in the tracker alone
leaves no trace in the delta, so the tracker side is unread, not unchanged.

**The plan.** A slice the delta already built, or one it reshaped — its files rewritten, its
premise gone — is a fork, not something to build around.

## Who a fork goes to

The addressee `issue-currency.md` names: the order this session runs under, where that order
names one, and otherwise the user. A master session reads no delta here: what landed is
`hcb-dev:wave-refresh`'s to read, from the point its ledger records.

## What it hands back

A line per kind: nothing there; what was done, with its outcome; or the fork, its recommendation
first (`architecture-decisions.md` §2). A kind that could not be read is unread, never "nothing"
([`invariants.md`](invariants.md)) — a tracker that did not answer, a check that would not run, a
delta whose start is not an ancestor.
