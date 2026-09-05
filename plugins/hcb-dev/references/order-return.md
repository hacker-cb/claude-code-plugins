# The return of an order — shape and acceptance

Read by whatever answers an order from [`order-anatomy.md`](order-anatomy.md),
over any carrier [`session-prompts.md`](session-prompts.md) admits, and by
whatever receives that answer.

## The shape

The tag rides on the first line. Then four parts, in this order — only the
session that did the work knows them:

1. **The premises of the order that did not survive** — first, because
   everything below stands on what remains.
2. **The deliverable**, answered in the terms it was asked for.
3. **The decision taken at each fork the order named.**
4. **What is left undone, and why.**

With them travel: the branch — or "nothing in the repository" where the result
lives in the tracker or in findings alone, findings naming the revision they
were read at; every change request the work touched at the state it stopped at,
and every issue with what became of it — opened, edited, commented, closed,
gone — a line each, and one that no longer exists still gets its line; and what
a review left uncovered or surfaced without fixing — a receiver given only the
outcome reads the work as reviewed clean.

A return is itself a crossing prompt, and the envelope of
[`session-prompts.md`](session-prompts.md) holds for it: the first line states
what this is and returns the tag with the subject in prose; the negative part
says what the receiver must not redo or unwind; and the closing act is the
acceptance below — the work the answer hands its receiver.
`hcb-dev:session-handoff` produces the same shape wrapped in the retrieval
steps a cold reader needs; on the way back to the session that wrote the order
the wrapping is optional — that session holds the order and re-checks in the
tracker itself, so an answer that arrives wrapped is not wrong.

## Acceptance

Match the tag against the record of orders out. Verify what the return claims
rather than adopting it — start with the premises it says did not survive, then
re-check the deliverable at its coordinates: in the tracker and the history
where the work landed there, and for findings alone by re-reading or re-running
the sources they cite at the revision the return names — never in the prose
alone. For those, a landing since that revision is not a gap in the return; the
verdict is re-checked against it before anything rests on it. A reviewer the
return says did not run on work it should have covered is not a note to file:
reopen, naming it, and run the review before acceptance; where the work already
merged, run it over the landed range, with the commit before the landing handed
to the reviewers as the explicit base. Then close that order, or reopen it
naming what is still missing.
