# Naming a session, an epic and a batch

Read by whatever titles a session — another's or its own — coins a batch id, or
writes one of those names where it is matched on later: a chip, an order, a ledger
row, a worktree.

The rule everything below serves: **the address leads, and it does not change.** A
title is an address — sessions resolve each other by it across restarts
([`session-comms.md`](session-comms.md)), and the user picks one run out of a list
by it. The address is the identifier, preceded by the role marker where the role
has one. A name that changes regardless — a host renaming a session whose name was
taken — is announced to whoever already holds the old one (`session-comms.md`).

## The shapes

```text
master      [master] <epic> — <topic>
batch       <epic>/<id> — <topic> (<issues>)
standalone  <tasks | nickname> — <topic>
```

Separator ` — ` throughout, em dash. `[master]` stands first, ahead of the
identifier, in that spelling and those brackets whatever language the topic is in.
What follows it is the name a session without one wears, so anything matching on
`<epic>` matches a master exactly as it does a batch. A batch needs no marker —
the `/` is one.

The standalone shape titles a session belonging to no epic: an investigation
dispatched on its own, one someone will come back to by message, one simply running
its own work. Where an order expects its answer over the wire, the order says which
title to answer ([`order-anatomy.md`](order-anatomy.md)).

Examples: `[master] 841 — UI widgets`,
`841/P — DX odds and ends (#896, #881, #877, #870)`, `514 — OCC acceptance`,
`95, 96, 97 — link hygiene in the skills`.

## `<epic>`

The epic issue's number, digits alone — no `#`, since the same value goes into a
worktree name. An epic always ends with one, the ledger hanging on an umbrella
issue ([`wave-ledger.md`](wave-ledger.md)), so a nickname stands here only while
that issue is being filed and gives way to the number the moment it is.

Fixed once, when the ledger is opened. Resuming an epic reads it back from the
issue the ledger hangs on rather than coining it again.

**The value is unique inside its repository and nowhere else**, while the live
registry spans the machine — so a name matched there is a candidate, and the
challenge line settles it (`session-comms.md`). Both sides hand their own over
early: the order carries the master's name, the confirmation opening a batch
carries the batch's.

## `<id>`

Capital ASCII letters in planning order — `A`, `B`, … `Z`, then `AA`, `AB`. Never a
digit, which collides with the wave number and with the issue numbers beside it.

A batch is addressed by `<epic>/<id>`, never the letter alone: the letter repeats
in every other epic.

- **Assigned once at planning, never re-assigned.** A batch that moves wave, gets
  re-chipped or restarts keeps its letter.
- **Never re-used inside the epic.** A withdrawn or failed batch takes its letter
  with it.

## `<tasks>`

The numbers a standalone session is running, digits alone — no `#`, for `<epic>`'s
reason. Comma-separated in the order the work takes them, and **all of them**: a
list of sessions is read for who holds what, which a leading number and a count of
the rest answers for none of them, and two slices both starting at `95` would wear
one address.

Where there are no numbers — free-text work, no tracker, a slice of the backlog —
a short kebab-case nickname stands in their place, and so does a list too long for
the title: an identifier is never trimmed once it stands, so a list that will not
fit is settled here, when the address is coined.

## `<topic>`

A noun phrase of a few words saying what the work is about, in the language of the
tracker it is written in — or, with neither tracker nor number, the language the
task was given in. Not a sentence, and never a generic word standing alone: a
stranger matching on "master" or "fixes" finds the wrong session. A master wears
the epic's own topic; a batch's says what that batch does, never a restatement of
the epic's.

## The issue tail

The batch's issues in the order its `Work:` slot takes them, all of them, so a list
of sessions shows the composition without opening the ledger. No issue, no tail. A
chip re-issued before its click carries the composition the batch now has; a batch
already running keeps the title it started with.

**The tail is never matched on** — sessions resolve each other by `<epic>/<id>`
alone — which is what makes it safe to shorten or drop under a cap.

## When the title does not fit

The titling tool caps what it accepts, and a list of sessions truncates before that. What gives
way, in this order: the tail gives up its trailing numbers for a count — `(#896 +5)` is six
issues, the `+` saying the list was cut rather than short — and then goes entirely, the
composition standing in the ledger either way; then the topic shortens; and **the identifier and
the role marker are never touched**, being together the address. A standalone identifier that
would not fit is settled where it is coined, by `<tasks>`'s nickname, never by trimming here.

## When a session titles itself

Twice, never a third time: once with whatever is in hand, once when what was missing arrives.

**A master** titles itself **on assuming the role**, before anything else, with whatever
identifier is in hand — the epic's number where the assignment named one, otherwise the
nickname. Carrying no topic, the provisional title is `[master] <epic>`, and the topic arrives
with the second step; a session that was doing something else renames itself here, the
assignment being the authorization, and renames only itself. **When the ledger is in hand** —
opened here, or read after a restart — it carries both halves, and where it already records a
title, that string is the address every order already out is carrying: wear it as recorded. The
final title stands **before the first chip, order or message leaves**.

**A session running its own work** — a build, a completion, a survey — wears the standalone
shape: **on intake**, with whatever is in hand (the task numbers, else the nickname, and the
topic the work was asked for, provisional being enough); then **when the scope is settled**, a
plan approved or a slice named, rewritten to what that scope makes — unless it already stands in
it **or has gone out as an address**, an order carrying it or a session answered on it, which is
worn as sent while the scope reaches the report instead.

**The entry point titles.** A skill invoked inside a run already under way touches the title at
neither step — a completion called per slice, a survey a master runs before planning: what
stands there stays.

## Where these names travel

- **The chip's title is what the batch session is asked to wear.** Later messages
  match on it until the receiver's start report says what it answers to — the two
  part company where a host hands back a variant (`session-comms.md`).
- **A worktree a session cuts for itself leads with its title's identifier** —
  `<epic>-<id>` for a batch, `<epic>-master` for a master, whose bare number would
  otherwise prefix every batch's name. A hyphen where the title has a slash, and
  one for each comma between numbers, the space after it going into the same hyphen
  — a ref is a path, and a prefix match reads two spellings as one name. The role
  marker's brackets stay out of a ref, being shell glob characters. One the host
  generated is left alone.
- **A plan-doc a session keeps for itself is named for its repository and its title's
  identifier**, in that same ref form, under `$HOME/.claude/plans` — literally, so a session
  resumed under another configuration finds it — where the identifier alone would collide. Its first line names the checkout it was written for, and a
  writer finding another checkout's there adds its own to the name rather than overwriting it.
- **In a wave, the order's tag is `<epic>/<id>`** — no separate tag is coined
  (`order-anatomy.md`).
- **A branch takes none of this.** It is named for the change it carries
  ([`branch-naming.md`](branch-naming.md)) and outlives the epic that scheduled it.
