# An epic in format 1 — bringing it to the current shape

Read by the master holding an epic whose ledger `ledger.mjs` answers as `format.found: 1` — on
assuming the role, after a restart, or once the plugin moved under it. The labels and the session
group come at once ([`epic-structure.md`](epic-structure.md), *An epic in an older shape*); the
rest waits for the point below, and nothing already closed is touched.

## Until the transition point

The rebuild is an expectation in the ledger, owed by this session and named in the next wave
report. Until the point comes the ledger stays in format 1 and is written as it stands — a
format-1 body over a format-1 ledger, through `ledger.mjs --write` like any write
([`wave-ledger.md`](wave-ledger.md)): nothing moves out of it and no shape is asked of it. The
wave running now runs to its end in the old shape.

## The transition point

A wave closed, no batch of the epic running, and the next wave not launched yet — the one moment
nothing reads the ledger but this session. There, in order:

1. **Dump it** (`--dump`), and read it through against what the new shape keeps.
2. **The reasoning goes out first, verbatim.** Each case the rebuilt ledger will only link — why a
   decision went as it did, how a constraint came to be known, a long journal entry — goes into an
   archive with `--append-archive`, markers left out of the text, each run answering the link the
   new entry cites. Over a format-1 ledger the archive stands unlisted until step 3 indexes it —
   the one fault between the two steps, and one the next write settles.
3. **The epic's ledger, rebuilt**: its sections per `wave-ledger.md`, the header listing every
   wave — the closed ones pointing at the archive or comment their record stands in — decisions and
   constraints as one entry each with the link step 2 answered, the expectations the user owes,
   the journal's recent lines. Written with `--write --body-file` and the `--was` the dump's read
   answered; it indexes every archive standing, the old ones included.
4. **The next wave opens as an issue** with its own ledger ([`wave-issue.md`](wave-issue.md)): its
   batches, its queue, its expectations and the candidates still unruled move there from the dump,
   and the issues it takes move under it. The issues no wave takes stay under the epic.

What the old archives hold stays where it is: a closed wave's record is not rewritten into the new
shape, only pointed at. The journal line recording the rebuild names the dump's digest, so the
version it came from can be told.
