# Naming a session, an epic and a batch

Read by whatever titles a session, coins a batch id, or writes one of those
names where it is matched on later — a chip, an order, a ledger row, a
worktree. It lives here rather than in any one skill because the same name is
written by the coordinating session, by the dispatcher and by the receiver,
and prose copies drift.

The rule everything below serves: **the identifier leads, and it does not
change.** A title is an address — sessions resolve each other by it across
restarts ([`session-comms.md`](session-comms.md)) — so what stands first is
what a stranger matches on, and a name already sent out is not re-coined.

## The shapes

```text
master      <epic> — <topic> (master)
batch       <epic>/<id> — <topic> (<issues>)
standalone  <issue | nickname> — <topic>
```

Separator ` — ` throughout, em dash. `master` is the role marker and keeps
that spelling whatever language the topic is in; a batch needs no marker,
since the `/` is one. The standalone shape titles a session that belongs to no
epic and still expects to be contacted — an investigation dispatched on its
own, a session someone will come back to by message. A session whose only
return travels by hand needs no title from anyone; where an order expects its
answer to come back over the wire, the order says which title to answer
([`order-anatomy.md`](order-anatomy.md)).

Examples: `841 — UI widgets (master)`,
`841/P — DX odds and ends (#896, #881)`, `514 — OCC acceptance`.

## `<epic>`

The epic issue's number, digits alone: no `#`, since the same value goes into
a worktree name and into the ledger's file-name fallback. Where the repository
has no tracker, a short kebab-case nickname for the subject instead.

It is fixed once, when the ledger is opened, and the ledger takes its own
name from the same value. Resuming an epic reads it back rather than coining
it again — from the epic the ledger hangs on, or from the name of the ledger
file where there is no tracker.

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

## `<topic>`

A noun phrase of a few words, in the language the epic's tracker is written
in, saying what this work is about. Not a sentence, and never a generic word
standing alone — a stranger matching on "master" or "fixes" finds the wrong
session. A master wears the epic's own topic; a batch's says what that batch
does, which is never a restatement of the epic's.

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
   number and nothing else — the provisional title is the identifier and the
   marker, `<epic> — master`, and the topic arrives with step 2 rather than
   holding the title back. A session that was doing something else until now
   renames itself here, the assignment being the authorization; it renames
   only itself, as batches are titled by their chip or by themselves.
2. **When the ledger is in hand** — opened here, or read after a restart —
   it carries both halves, and the title is rewritten to the shape they make
   unless it already stands in it. A resume is the case that needs this: the
   number was right from the first line and the topic was the missing half.
3. **Before the first outgoing mention** — the final title stands before the
   first chip, order or message leaves, because an order carries the master's
   title as the address its batch resolves.

## Where these names travel

- **The chip's title is the batch session's title**: a dispatcher writing the
  batch shape into the chip has titled the receiver, and every later message
  matches on it.
- **A worktree a session cuts for itself leads with the identifier its title
  leads with** — `<epic>-<id>` for a batch, `<epic>` for a master; a hyphen
  where the title has a slash, since a ref is a path, and a prefix match reads
  the two spellings as one name. One the host generated is left alone —
  renaming a live session's directory is not a naming decision — so there the
  title carries the address by itself.
- **In a wave, the order's tag is `<epic>/<id>`** — no separate tag is coined
  (`order-anatomy.md`).
- **A branch takes none of this.** It is named for the change it carries
  ([`branch-naming.md`](branch-naming.md)) and outlives the epic that
  scheduled it.
