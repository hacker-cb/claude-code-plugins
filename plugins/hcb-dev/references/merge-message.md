# Writing what lands in history — the request body and the merge message

Read by whatever *lands* work: a change-request driver on its way to a merge, and
a local merge that collapses a branch into one commit. It owns the text they
leave behind — what the body says from the request's opening to its merge, and
what the merge's own message says. Names — the branch, the commit subject, the request
title — are [`branch-naming.md`](branch-naming.md)'s; what becomes of the branch
afterwards is [`branch-retirement.md`](branch-retirement.md)'s.

## The body at opening

What changed and why, in the user's own framing where it is known — a short
summary, then the notable changes — and a closing keyword for every issue this
change settles: the `issues` a flow upstream threaded in, or on a direct entry
the ones the user names. The keyword is the forge's own word, verbatim, never
translated to match the prose around it — English on both forges by default;
which words a forge matches, and whether its pattern can be reconfigured, is
[`forge-docs.md`](forge-docs.md). Write it whatever the base: where the request
targets anything but the default branch the forge acts on none of them, and those
issues are closed explicitly once the work lands (`hcb-dev:issue-tracking`).

## The body describes what is landing

Before the merge, and again after every push that follows, re-read the
change-request body against the diff that is actually landing, and rewrite what
it now describes wrongly: a path since renamed or deleted, a mechanism the
review's own fixes replaced, an issue it claims to settle that moved out of this
change, a bullet for work that came back out of it. What the rewritten body
asserts about how something is configured is held to
[`architecture-decisions.md`](architecture-decisions.md) §4.

A rewrite carries the body's machine-read parts across intact, the closing
keywords above all, each in the forge's own word. Before the merge, read back
what the forge parsed out of the body rather than what the body appears to say.

The labels [`label-lifecycle.md`](label-lifecycle.md) gives the request are
re-derived at the same moments. A change request whose gates are green and whose
body or labels describe something else is not ready to merge.

## The message is written, not defaulted

Where the merge collapses the branch into one commit, compose that commit's
message — the summary, then what changed — and pass it to the merge explicitly,
rather than leaving it to be composed from whatever the tool reaches for. It is
written from the body above where a change request carries one, and from the
collapsed commits themselves where none does: a local merge reaches for no
forge.

The message says what the change **is**. The route the branch took to it — a fix
to its own earlier fix, a review round answered, a rebase — belongs to the
commits being collapsed, and stops there.

What does not stop there is anything in them a machine reads — a co-author's
trailer above all, which is the record of who else wrote the change. A written
message drops every one of them silently: carry them across.
