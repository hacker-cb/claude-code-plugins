# Is the issue still true?

Read wherever an issue is about to be relied on or is asked about — a backlog
surveyed issue by issue, one taken in as the spec of work about to start, or one
someone asks is still true. An issue is a claim
about a tree that has moved since it was written, and this file owns the verdict
on whether that claim still holds: the code it stands on, what is read to reach
it, and the four it can be. It lives outside any one skill because a survey and
a build reading the same issue have to reach the same verdict on it. What a
verdict then authorizes — a body rewritten, an issue closed, a milestone moved —
is `hcb-dev:issue-tracking`'s, and it waits for the answer of whoever the reading
session puts it to.

**Anything but `current` is a fork before it is work.** It goes to that
addressee with a recommendation, never resolved by building the issue as
written and never by quietly building something else. **The addressee is named,
not inferred**: an order above this session names it, one that named none
leaves the session that wrote it — the premise is that session's own — and
absent any order it is this session's user. A person is the addressee only
where the session answers to one directly.

## The code the verdict stands on

The refreshed base — resolved and fetched per
[`base-resolution.md`](base-resolution.md), never this checkout's own state,
which may be stale or mid-feature.

## What is read

The body, every comment, the labels, native type, milestone and state reason
(classified per [`classification.md`](classification.md)), the sub-issue and
dependency links (read per [`forge-docs.md`](forge-docs.md)), the change
requests that touch it — then the tree itself at the issue's coordinates.

**One call reads it for every issue at once, rather than a call per issue**: the
script's deep tier reads each number named whole — the body, every comment, and on its
line the fields above, with the change requests that close it and its children as a
count — and its wide tier a slice without bodies and comments, one call per hundred
issues, from which a set too big to read deep is picked. Where the line carries no
children by name, they are read by the forms `forge-docs.md` gives, for the issues whose
verdict turns on them; a change request that touches an issue without closing it is on
neither tier's line at all. The script's first line says whether what came back is
whole: read it before any other line, against the contract in
[`../scripts/issue-slice.mjs`](../scripts/issue-slice.mjs)'s header, and carry what it
names as not read — a key `unavailable` here, a list `cut`, an end `hidden`, a number
`unread` — into the verdict as unread, never as nothing there.

```bash
# A label and a milestone title are the forge's own text, so each goes in through a
# variable — assigned from the listing that named it, since a quote of either kind
# pasted into the command would be the shell's.
S="<plugin root>/scripts/issue-slice.mjs"; L='<one>'; M='<number|title>'
node "$S" --deep "<n>[,<n>…]"                                       # these issues, whole
node "$S" [--state open|closed|all] [--label "$L"] [--milestone "$M"]          # a slice
#   [--skip-label <name>]... leaves an epic's own structure out (epic-structure.md)
# A milestone is GitHub's number, GitLab's title. Either tier: --repo <path> [--host <host>]
# for another repository; --forge gh|glab where both CLIs answer for the same path.
```

A parked reason that still holds is read with the rest and named with the
verdict: work can be `current` and still not be for picking up.

## The verdict

One of:

- **current** — the defect or gap is still there; cite the coordinate that shows
  it.
- **stale** — the tree moved; cite what fixed or invalidated it.
- **needs rewrite** — real, but the body misleads; say which part, and what the
  tree makes true instead.
- **unverifiable** — the trigger cannot be checked from here: an unreproduced
  defect, an environment this session lacks. Say why; it stays out of every
  closure proposal.

A verdict covers one issue whole. Where its asks diverge — one met by the tree,
one still open — that is `needs rewrite`, naming the split rather than averaging
it into a verdict that fits neither half.
