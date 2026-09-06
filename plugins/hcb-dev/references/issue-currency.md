# Is the issue still true?

Read wherever an issue is about to be relied on — a backlog surveyed issue by
issue, or one taken in as the spec of work about to start. An issue is a claim
about a tree that has moved since it was written, and this file owns the verdict
on whether that claim still holds: the code it stands on, what is read to reach
it, and the four it can be. What a verdict then authorizes — a body rewritten,
an issue closed, a milestone moved — is `hcb-dev:issue-tracking`'s, and it waits
for the answer of whoever the reading session puts it to.

**Anything but `current` is a fork before it is work.** It goes to that person
with a recommendation, never resolved by building the issue as written and never
by quietly building something else.

## The code the verdict stands on

The refreshed base — resolved and fetched per
[`base-resolution.md`](base-resolution.md), never this checkout's own state,
which may be stale or mid-feature.

## What is read

The body, every comment, the labels, native type, milestone and state reason
(classified per [`classification.md`](classification.md)), the sub-issue and
dependency links (both sit past either CLI's issue commands — the entry points
are resolved per [`forge-docs.md`](forge-docs.md)), the change requests that
touch it — then the tree itself at the issue's coordinates.

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
