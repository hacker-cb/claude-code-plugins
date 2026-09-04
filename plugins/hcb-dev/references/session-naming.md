# Naming a session, an epic and a batch

Read by whatever titles a session — another's or its own — coins a batch id,
or writes one of those names where it is matched on later: a chip, an order, a
ledger row, a worktree. It lives here rather than in any one skill because the
same name is written by the coordinating session, by the dispatcher, by the
receiver and by a session titling itself for the run it opens, and prose copies
drift.

The rule everything below serves: **the address leads, and it does not
change.** A title is an address — sessions resolve each other by it across
restarts ([`session-comms.md`](session-comms.md)), and the user picks one run
out of a list of them by it — so what stands first is what a stranger matches
on, and a name already sent out is not re-coined. The address is the
identifier, preceded by the role marker where the role has one.

## The shapes

```text
master      [master] <epic> — <topic>
batch       <epic>/<id> — <topic> (<issues>)
standalone  <tasks | nickname> — <topic>
```

Separator ` — ` throughout, em dash. `[master]` is the role marker: it stands
first, ahead of the identifier, and keeps that spelling and those brackets
whatever language the topic is in. What follows the marker is the name a session
without one wears, so anything matching on `<epic>` matches a master exactly as
it does a batch.
A batch needs no marker, since the `/` is one.

The standalone shape titles a session that belongs to no epic: an
investigation dispatched on its own, a session someone will come back to by
message, and a session simply running its own work, which wears it so its user
can pick that run out of a list. Who puts it on differs — a session titles
itself for the run it opens (below), and where an order expects its answer to
come back over the wire, the order says which title to answer
([`order-anatomy.md`](order-anatomy.md)).

Examples: `[master] 841 — UI widgets`,
`841/P — DX odds and ends (#896, #881)`, `514 — OCC acceptance`,
`95, 96, 97 — link hygiene in the skills`.

## `<epic>`

The epic issue's number, digits alone: no `#`, since the same value goes into
a worktree name and into the ledger's file-name fallback. Where the repository
has no tracker, a short kebab-case nickname for the subject instead.

It is fixed once, when the ledger is opened, and the ledger takes its own
name from the same value. Resuming an epic reads it back rather than coining
it again — from the epic the ledger hangs on, or from the name of the ledger
file where there is no tracker.

The value is unique inside its repository and nowhere else: two repositories
can each hold an issue 841, while the live registry spans the machine. A title
matched there is therefore a candidate, not a destination. What addresses a
session is its session id, and both sides hand one over early — the order
carries the master's, the confirmation that opens a batch carries the batch's.
Until one is in hand, a message on a matched title leads with the challenge
line (`session-comms.md`) and waits for its answer.

## `<id>`

Capital ASCII letters in planning order — `A`, `B`, … `Z`, then `AA`, `AB`.
Never a digit: a digit collides with the wave number and with the issue
numbers standing beside it.

A batch is addressed by `<epic>/<id>`, never by the letter alone — the letter
repeats in every other epic, so anything recording or matching a batch records
the pair.

- **Assigned once at planning, never re-assigned.** A batch that moves to
  another wave, gets re-chipped or is restarted keeps its letter.
- **Never re-used inside the epic.** A withdrawn or failed batch takes its
  letter with it — re-issued, the same string would mean two things across the
  ledger and the orders already out.

## `<tasks>`

The numbers of the tasks a standalone session is running, digits alone — no
`#`, for `<epic>`'s reason: the value goes into a worktree name. Comma-separated
in the order the work takes them, so the number leading the work leads the
address; up to three, and past that the leading number and a count of the rest
— `95 +5` is six tasks.

Where there are no numbers — free-text work, a repository without a tracker, a
slice of the backlog — a short kebab-case nickname for the subject stands in
their place.

## `<topic>`

A noun phrase of a few words saying what this work is about, in the language of
the tracker it is written in — and where there is neither a tracker nor a
number, the language the task was given in. Not a sentence, and never a generic
word standing alone — a stranger matching on "master" or "fixes" finds the
wrong session. A master wears the epic's own topic; a batch's says what that
batch does, which is never a restatement of the epic's.

## The issue tail

The batch's issues in the order its `Work:` slot takes them, so a list of
sessions shows the composition without opening the ledger. Up to three
numbers; past that, the leading one and a count of the rest — `(#896 +5)` is
six issues. A batch holding no issue carries no tail. An amendment that moves
an issue between batches moves the tail with it; the address is untouched, so
nothing has to be matched again.

The tail is never matched on — sessions resolve each other by `<epic>/<id>`
alone, which is what makes it safe to shorten or drop.

## When the title does not fit

The titling tool caps what it accepts, and a list of sessions truncates before
that. What gives way, in this order:

1. the tail collapses to its counted form, then goes entirely — the
   composition stands in the ledger either way;
2. the topic shortens;
3. the identifier and the role marker are never touched: together they are the
   address, and truncating either is losing the session.

## When a master titles itself

1. **On assuming the role** — before anything else, with whatever identifier
   is already in hand: the epic's number where the assignment named one,
   otherwise the nickname. Where it carries no topic — a resume naming the
   number and nothing else — the provisional title is the marker and the
   identifier, `[master] <epic>`, and the topic arrives with step 2 rather than
   holding the title back. A session that was doing something else until now
   renames itself here, the assignment being the authorization; it renames
   only itself, as batches are titled by their chip or by themselves.
2. **When the ledger is in hand** — opened here, or read after a restart —
   it carries both halves, and the title is rewritten to the shape they make
   unless it already stands in it. A resume is the case that needs this: the
   number was right from the first line and the topic was the missing half.
   Where the ledger already records a title, that string is the address every
   order already out is carrying: wear it as recorded, and leave restyling to
   the epics opened under this shape.
3. **Before the first outgoing mention** — the final title stands before the
   first chip, order or message leaves, because an order carries the master's
   title as the address its batch resolves.

## When a session titles itself for its own run

A session running its own work — a build, a completion, a survey — wears the
standalone shape:

1. **On intake** — with whatever is already in hand: the task numbers, else
   the nickname, and the topic the work was asked for. A provisional topic is
   enough; the title does not wait for the analysis behind it.
2. **When the scope is settled** — a plan approved, a slice named — the
   title is rewritten to what that scope makes, unless it already stands in it
   or has gone out as an address: an order carrying it, a session answered on
   it. That one is worn as sent, and the scope reaches the report instead.

**The entry point titles.** A skill invoked inside a run already under way
touches the title at neither step — a completion called per slice by the
workflow above it, a survey a master runs before planning its waves: what
stands there stays.

## Where these names travel

- **The chip's title is the batch session's title**: a dispatcher writing the
  batch shape into the chip has titled the receiver, and every later message
  matches on it.
- **A worktree a session cuts for itself leads with its title's identifier**
  — `<epic>-<id>` for a batch, `<epic>-master` for a master, whose bare number
  would otherwise prefix every batch's name; a hyphen where the title has a
  slash, and one for each comma between numbers, since a ref is a path and a
  prefix match reads the two spellings as one name. A counted identifier gives
  the ref its leading number alone: a ref takes neither the space nor the `+`.
  The role marker's brackets stay out of a ref, where they are shell glob
  characters and buy nothing the trailing `-master` does not. One the host
  generated is left alone — renaming a live session's directory is not a
  naming decision — so there the title carries the address by itself.
- **In a wave, the order's tag is `<epic>/<id>`** — no separate tag is coined
  (`order-anatomy.md`).
- **A branch takes none of this.** It is named for the change it carries
  ([`branch-naming.md`](branch-naming.md)) and outlives the epic that
  scheduled it.
