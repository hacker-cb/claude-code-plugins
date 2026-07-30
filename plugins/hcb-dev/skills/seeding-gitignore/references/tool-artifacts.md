# Artifacts the canonical templates leave out

Read where a project needs patterns for something a language template does not
carry: a test runner, a monorepo task cache, a hosting or deploy CLI.

## Where the names come from

A canonical template covers a language and its build system. Nothing else is in
it, so take the pattern from the tool itself — the lines its own scaffolding
command appends to `.gitignore`, or its docs.

## A reference snapshot is committed; what a run writes is not

The images a visual test compares against are the expectation and belong in git.
Reports, videos, traces, and the `-actual` / `-diff` pair a failed comparison
leaves behind do not.

**Classify by what a path holds, not by where it sits.** A runner is free to nest
its diff and received-image directories *inside* the reference directory, so
"the run writes elsewhere" is not a statement about the tree. Ignore the artifact
path itself — the nested one, where it is nested — and leave the reference path
tracked.

That call decides a removal as much as an ignore: the pre-commit step untracks
what it ignores, so a reference directory misread as run output has its reviewed
baselines leave the repository in that same commit. The author's copies stay on
disk and the suite goes on looking green there, while a run in a fresh checkout
has nothing to compare against — it fails on the missing reference, or writes a
fresh one and compares it to itself.

## Settled without judgement

- Anything holding a live session or a secret is ignored, however small — a saved
  browser storage state, a local `.env`.
- A lockfile is committed unless its own tool documents otherwise, and so is a
  provider lock.
