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
own, a session whose answer someone will come back for.

Examples: `841 — UI widgets (master)`,
`841/P — DX odds and ends (#896, #881)`, `514 — OCC acceptance`.

## `<epic>`

The epic issue's number, digits alone: no `#`, since the same value goes into
a worktree name and into the ledger's file-name fallback. Where the repository
has no tracker, a short kebab-case nickname for the subject instead.

It is fixed once, when the ledger is opened
([`wave-ledger.md`](wave-ledger.md)), and the ledger takes its own name from
the same value.

## `<id>`

Capital ASCII letters in planning order — `A`, `B`, … `Z`, then `AA`, `AB`.
Never a digit: a digit collides with the wave number and with the issue
numbers standing beside it.

- **Assigned once at planning, never re-assigned.** A batch that moves to
  another wave, gets re-chipped or is restarted keeps its letter.
- **Never re-used inside the epic.** A withdrawn or failed batch takes its
  letter with it — re-issued, the same string would mean two things across the
  ledger, the branches and the orders already out.

## `<topic>`

A noun phrase of a few words, in the language the epic's tracker is written
in, saying what this work is about. Not a sentence, not a restatement of the
epic's own topic, and never a generic word standing alone — a stranger
matching on "master" or "fixes" finds the wrong session.

## The issue tail

The batch's issues in the order its `Work:` slot takes them, so a list of
sessions shows the composition without opening the ledger. Up to three
numbers; past that, the leading one and a count — `(#896 +5)`. A batch holding
no issue carries no tail.

The tail is never matched on — sessions resolve each other by `<epic>/<id>`
alone, which is what makes it safe to shorten or drop.

## When the title does not fit

The titling tool caps what it accepts, and a list of sessions truncates before
that. Trim right to left:

1. the tail collapses to its counted form, then goes entirely — the
   composition stands in the ledger either way;
2. the topic shortens;
3. `<epic>/<id>` is never touched: it is the address, and truncating it is
   losing the session.

## When a master titles itself

1. **On assuming the role** — before anything else, with whatever identifier
   is already in hand: the epic's number where the assignment named one,
   otherwise the nickname. A session that was doing something else until now
   renames itself here, the assignment being the authorization; it renames
   only itself, as batches are titled by their chip or by themselves.
2. **When the ledger is opened** — `<epic>` is fixed there, and the title is
   rewritten to the final shape where the provisional identifier differed.
3. **Before the first outgoing mention** — the final title stands before the
   first chip, order or message leaves, because an order carries the master's
   title as the address its batch resolves.

A title that changes after orders are out goes into the ledger and to the live
batches as a short notice; their fallback address — the session id — did not
change with it.

## Where these names travel

- **The chip's title is the batch session's title**: a dispatcher writing the
  batch shape into the chip has titled the receiver.
- **A worktree a session cuts for itself leads with the identifier its title
  leads with** — `<epic>-<id>` for a batch, `<epic>` for a master — so the
  name still carries the address where no title is set. One the host
  generated is left alone: renaming its directory is not a naming decision but
  a live session's footing.
- **In a wave, the order's tag is `<epic>/<id>`** — no separate tag is coined
  ([`order-anatomy.md`](order-anatomy.md)).
- **A branch takes none of this.** It is named for the change it carries
  ([`branch-naming.md`](branch-naming.md)) and outlives the epic that
  scheduled it.
