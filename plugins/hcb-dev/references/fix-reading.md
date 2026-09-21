# What reads a fix

Read wherever a fix is made after a review raised its finding — in the rounds before a change
request opens, and in the loop driving one after. It owns which fix goes back to a reviewer and
when those rounds end; how the finding it answers is rated and scoped is
[`findings.md`](findings.md)'s, and the forge's own reviewer is its driver's.

**Nothing still to come stands in for this reading.** A later review of the whole change is not a
reading of the fix ([`forge-behaviour.md`](forge-behaviour.md)), and may not run at all: what this
file sends to a reviewer goes there before the fix is pushed, whatever else is due to read the
head.

## Which fix a reviewer reads again

- **A fix that stays inside the finding it answers** was covered by the pass that raised it.
  Inside means it touches what the finding named and nothing the finding did not; a fix that has
  to be argued inside is outside.
- **A change with no behaviour in it** — a comment, prose that describes, wording, formatting —
  earns no reviewer either. Each is still read against what it answers, and a rewritten comment
  against the code it describes. Text something executes — a spec code is generated from, a
  schema, a skill an agent follows — is behaviour, not prose.
- **A fix that would meet `hcb-dev:multi-review`'s own high-risk test** (its *Scope*), **or
  answers more than its finding asked**, is code no reviewer has read: it goes back through
  that skill on the change's own base, never one narrowed to the fixes.
- **A borderline call goes to a reviewer.**

A `Minor` never opens a round on its own (`findings.md`); it rides one opened for something
else, or it goes to the report. Commit each round's fixes naming the findings they close, so what
the rounds spent and closed is readable off the branch rather than out of a session's memory.

## When the rounds end

**On what they find, not on how many there were.** A round that turns up no new `Critical` or
`Important` finding belonging to this change is the last one; so is a round whose finding lands
where an earlier round already fixed something, which is the loop trading one break for another.
Up to ~3 rounds otherwise — counted per series, each set of fixes that sends something to a
reviewer opening one — then stop and ask. Running out is a stop and never a completion: never
complete, never merge, and never re-rate a finding to get under the line. The rounds belong to
the loop that opened them and spend its budget; no other loop's is drawn into them.

**A round counts only as far as it covered.** One whose coverage report carries a gap other than
`n/a` or `partial (structural)` (`hcb-dev:multi-review`, *Report*) ends nothing, however clean its
findings: it is a stop at whoever the loop answers to, with the gap named.
