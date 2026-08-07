---
name: session-handoff
description: >-
  Manual-only. What this session FINISHED, turned into a prompt to paste into
  another session — in whatever form the result took: code on a branch or in a
  change request, an investigation that changed no files, issues rewritten or
  reclassified, a documentation change. Carries the result, the complete list of
  change requests and issues it touched, and what to do next, starting with how
  to reach the work from the reader's own checkout. Also how a session returns
  its answer to an order from `hcb-dev:session-dispatch`. For work NOT done,
  that another session is to implement, use `hcb-dev:session-dispatch` — the
  discriminator is whether the work is done, not how the ask is worded.
disable-model-invocation: true
---

# Session handoff

The envelope every crossing prompt obeys is
[`../../references/session-prompts.md`](../../references/session-prompts.md).
This skill fills it with what this session finished.

## Posture

Whether an order preceded the work decides the first line and the closing steps.
Everything between them is the same either way.

| | **Answering an order** | **Unbidden** |
|---|---|---|
| This session holds | a tag and the ask that came with it | nothing — the user started it |
| First line | returns the tag | says the work is offered, not requested |
| Closing steps | reconcile against the order | weigh against the reader's own work |

A tag this session was never given is not a posture — an order recalled without
its ask is unbidden.

## What the prompt carries

1. **What was done** — the result: what holds now that did not before. It need
   not be code — an investigation that touched no files, a tracker left
   reorganized, a documentation change all count, and each is stated as what now
   holds rather than as what was looked at. Short, and complete: brevity comes
   from leaving out how it got there, never from leaving out an outcome.
   Something unfinished is said to be unfinished.

   **What a review left uncovered, and what it surfaced without fixing, goes
   here too.** A reader given only the outcome reads the work as reviewed clean.

2. **Where it is** — the branch, where there is one. Where the work belongs
   outside the reader's current track, say so and say which base it was cut
   from.

3. **Every change request and issue touched** — the complete list, a line each,
   not the notable ones. A change request carries the state it stopped at; an
   issue carries what became of it — opened, edited, commented on, closed, gone.
   A comment is a touch like any other, and often the whole result: an issue this
   session only commented on still earns its line, and the line says what the
   comment settled. Closed by a merged change request is not closed by hand, and
   an issue that no longer exists still needs its line, or the reader reads a
   dead number as a mistake in the prompt.

   **Where no files changed and the result is findings alone** this part carries
   them instead: each claim at the repo-relative coordinate it was read at, and
   beside them what was ruled out and by what. Work that lives in the tracker is
   not this case — there the list above *is* the result. What was *not* checked goes here too — a reader
   told only what is known treats the rest as known.

4. **How to get it, and check it** — the opening step depends on where the work
   landed:

   | Landed | Opening step |
   |---|---|
   | merged into the base | fetch the base and read what arrived first; rebase the reader's own work onto it only once that work's overlap is known |
   | an open change request | read it — it is not in the base yet |
   | a branch, unmerged | check out or fetch the branch |
   | the tracker alone — issues rewritten, reclassified or closed | read those issues in full; the repository is untouched |
   | nowhere — findings only | re-establish the load-bearing claims from their sources before building on them |

   Then the reader re-reads every number on the forge **in full, comments
   included** — a discussion may have moved since this was written, and what
   stands there now outranks what the prompt says.

5. **The closing part**, by posture — and the two postures put it in different
   places.

   **Answering an order** — this *is* the answer, so it goes in the body of the
   prompt, never among the reader's steps: the premises of the order that did
   not survive, first; then the deliverable, answered in the terms it was asked
   for; then the decision taken at each fork the order named; then what is left
   undone and why. Only this session knows these four. The tag rides on the
   first line.

   **Unbidden** — these are the reader's steps: work out what this changes for
   what it is already doing — what it overlaps, what it conflicts with, what
   assumption it breaks, what it has already done for them — then summarize that
   back to the user, saying plainly where it changes nothing, and put the
   non-obvious consequences up before acting on them
   ([`../../references/architecture-decisions.md`](../../references/architecture-decisions.md)).
   Silence reads as "not checked".

   A reader already mid-flight is told what this breaks for it whichever posture
   applies: where the handoff invalidates a premise it stands on, name it, and
   name what is settled versus what is open again.

6. **What not to do** — the envelope's, plus this: where this session left
   something temporary that the reader's work makes removable, name it, name
   what covers it, and say who unwinds it.

## The prompt

```text
<origin — one of:>
Return for `<tag>`: <the ask, in one line>. Work from another Claude Code
session; verify it rather than adopting it.
Work from another Claude Code session — nobody asked for it; this is input.

What it did:
<the result, in a few lines>
Not covered / not fixed: <review gaps, and findings surfaced but left alone; or
"none">

<answering an order — the four below go here, filled in, in this order:>
Premises of the order that did not survive: <...>
Delivered: <the deliverable, in the terms the order asked for>
Decisions at the forks the order named: <...>
Left undone: <what, and why>

Branch <branch, or "nothing in the repository — it is all in the tracker" / "no
files changed — findings only"><, repo <name> — only where the reader may not be
in it>

Change requests and issues touched — everything, from this session's own recall:
- <change request — `#<n>` on GitHub, `!<n>` on GitLab> — <open / merged / draft> — <one line>
- #<n> issue — <created / edited / commented / closed by #n / reopened / deleted> — <what it says now>
<or, where no files changed: the findings, each at a repo-relative file:line —
and what was ruled out, by what, and what was never checked>

Do this, in order:
1. <the opening step from the table above>
2. Read the changes yourself — start at <where>
3. Re-read every issue and change request above in full, comments included —
   the discussion may have moved on, and what is there now outranks this. One
   marked deleted you confirm is still gone
4. <answering an order — check the four answers above against what the order
   asked for>
   <unbidden — weigh this against your own work in flight, summarize it back to
   me including a plain "changes nothing", and raise the non-obvious parts
   before acting, each with your recommendation>

Don't <what would duplicate or undo it, and the tracks that are not yours to touch>
```

## Afterwards

Offer `/hcb-dev:git-cleanup session` for the branches and worktrees this session
leaves behind — offer it, never run it.

## Reference files

- [`../../references/session-prompts.md`](../../references/session-prompts.md)
- [`../../references/architecture-decisions.md`](../../references/architecture-decisions.md)
