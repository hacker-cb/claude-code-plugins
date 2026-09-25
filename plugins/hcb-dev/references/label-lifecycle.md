# Where each label comes from, and who writes it

Read by whatever files, splits or takes up an issue, opens a change request, or closes an issue.
It owns when each label on an issue or a change request is written, from what, and on which
authority. The roles are [`classification.md`](classification.md)'s, the invocations
[`forge-docs.md`](forge-docs.md)'s.

**Every write passes only names the set holds**, and reads back what landed
([`forge-behaviour.md`](forge-behaviour.md)). A value the work needs and the set lacks is named in
the report, never created ([`label-model.md`](label-model.md)).

**A name something keys on is the user's to write.** Before the first write of a run, read what
in the repository reacts to a label — a workflow triggered on `labeled` or `unlabeled`, a merge,
release or deploy rule matching a name; a name it matches, added or taken off, goes to the user
rather than onto the carrier.

## Writing them

Every label write this file names goes through one script: the names arrive as a JSON array in a file written out
of the set's answer, and leave in a JSON body — never on a command line, never through a CLI's
label flag, which splits a name on its commas. It refuses a name the set does not hold, and reads
the carrier back.

```bash
node "<plugin root>/scripts/label-write.mjs" --number <n> --kind <issue|request> --forge <gh|glab> \
  [--add <file>] [--remove <file>] [--repo <path of another repository>]
```

`wrote` true is done; false wrote nothing — `reason` says whether nothing was needed, a name was
`unknown`, or the forge refused, as an account that may not label is refused; null is a write that
did not read back as meant, `missing`, `standing` and `lost` naming what differs, and is a stop.

## Filing and splitting

A leaf takes its kind of work, its outcome as forecast from its body, and its queue labels; a
parent, its kind of work and its queue labels alone. Splitting an issue into children divides its
outcome labels among them by what each child's body covers, in the same edit. Both are
`hcb-dev:issue-tracking`'s writes, on its answer.

## Taken into work

A parked reason comes off where it no longer holds, or where the answer taking the work settles
it — never on the taking alone. The answer that takes it off names it:

- **a build** — the planning gate of `hcb-dev:implementation-workflow` names each issue whose
  parked reason comes off, and its approval is the write;
- **a wave** — the wave plan's table names them, and the master takes each off on the word that
  approved the plan, whether or not the forge hangs the issue ([`wave-issue.md`](wave-issue.md));
- **a batch** writes none: its master did.

An open blocker stays: an edge ([`issue-links.md`](issue-links.md)), or where the forge carries
none, the stand-in that file names — never taken off with the work.

## A change request

**Only a request into the default branch carries labels** — the default resolved per
[`base-resolution.md`](base-resolution.md). It carries the kind of work and the outcome of **its
own diff**: the component from the files it changes — a generated file follows the change that
regenerated it, an incidental edit earns none, a test follows what it checks, documentation its
subject — and the subsystems, concerns and resources its result changes, the issues it settles
being where the reading starts rather than the answer. Never a queue label; no kind of work where
the repository runs that as a native type. A set with no kind-of-work or outcome family gives the
request none, said in one line of the report.

**Re-derived with the body** ([`merge-message.md`](merge-message.md)) — before the merge, and after
a push that changes which files the request touches. A request whose labels describe something
else is not ready to merge — save where the account cannot label it: the script is refused, and
the report names the labels for someone who can.

## At close

**An issue a change settled** — one threaded in or named by the user, never one the body's keywords
alone name — takes that change's reading in place of its forecast: a leaf its kind of work and
outcome; a parent no outcome, and its children's dominant kind, read again. A leaf's reading is the
request's labels where it settled that issue alone and carries them, a role the request cannot carry
— a kind of work run as a native type — read from its diff; otherwise the part of the diff that
settled it, read as a request's are above, split by the session that did the work. The kind of work
goes into the mechanism the repository runs it in, a native type included. An issue in another
repository is aligned against that repository's own set, a role it has no vocabulary for left and
named. Where the session cannot tell, the issue keeps what it carried and the report says so.

**Any close** takes the parked reason off and keeps the priority; an issue closed with no change
behind it — not planned, a duplicate — keeps everything else.

## On what authority

| write | rides on |
|---|---|
| a change request's labels, at open and re-derived | opening the request: they are part of it |
| an issue's labels at close | the close — the merge authorization where a keyword closes it, the go-ahead where it is closed explicitly |
| a parked reason taken off | the answer that took the work and named it |

Nothing else here is written without its own answer (`hcb-dev:issue-tracking`). Each write above
stands in the report's `## Without your word` with what undoes it
([`report-format.md`](report-format.md)). A merge nobody here issued — by hand, on the forge —
aligns nothing.

## Where the forge falls short

- **Without a change-request driver** — GitLab's today — a request takes its labels at open
  ([`completion-backends.md`](completion-backends.md)), and nothing re-derives them or aligns its
  issues at close.
- **A server without hierarchy** tells no parent from a leaf: every issue there is read as a leaf,
  save one carrying `epic`, and the report says so.
