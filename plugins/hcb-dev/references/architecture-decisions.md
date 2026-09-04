# Deciding with the user — when to ask, how to ask, when to flag

Read wherever a decision is made *with* a person rather than for them — a
planning gate, a stop-and-ask point — and, for rule 4, before writing any sentence
that reports how something is configured, wherever that sentence lands and whether
or not anyone is being asked anything. Four rules, each with the test that applies
it to a case this file never named.

## 1. Ask about architecture; act on mechanics

- **Mechanical / reversible** — a branch name, the order of commits, a trivial
  conflict, a formatting choice, which allowed merge method to default to. Act,
  and narrate what you did in a line. Stopping here is friction with no payoff.
- **Architectural / irreversible / not answerable from the code** — the choice of
  an abstraction, a contract or schema, a wire format, the completion mode, a
  conflict that needs a real decision, anything that writes or publishes and
  can't be walked back. **Stop and ask.**

The test is not "is this important" but "does the code contain the answer". If two
readings are both defensible and only the person can say which they meant, that is
a fork, not a mechanic.

**Front-load, then run.** Ask everything *foreseeable* at the planning gate — all
at once, alongside the slice and branch layout — so the autonomous run afterwards
has no routine questions left. A genuinely **unforeseen** architectural fork that
surfaces mid-run still stops the run: pausing to ask beats guessing on something
irreversible. But it should be *rare* — its frequency is a measure of how well the
analysis was done, not a normal event. Everything the analysis could have
surfaced belongs at the gate.

## 2. Never ask a bare question — always show a recommendation

Every fork you put to the person carries your recommended option **first**, with a
one-line reason, framed as the choice you'd make. A bare "how should I do X?"
pushes work back onto them that the analysis was supposed to do; a recommendation
lets them agree in one word or correct with a target. The recommendation must be
grounded in the code and the constraints, not asserted; "I'd do A because the schema already
does A elsewhere" beats "A (recommended)".

Every stop-and-ask point inherits this rule — a finding that needs a product
decision, a coverage gap, an ambiguous merge strategy: present the options with a
recommendation, not an open question.

## 3. Follow the project's rules — but flag when one fights good architecture

A project's own rules (its `CLAUDE.md`, its conventions, its history) **outrank**
your preferences operationally: where a rule says how this repo does things, you
follow it. Every skill here already says so, and that does not change.

But *following* a rule and *silently endorsing* it are different. When a rule
pulls against what is architecturally sound, say so out loud — it may be a
deliberate constraint, or it may be drift: an accidental fixation of a wrong shape
that nobody has revisited. Name it, say why it looks off, recommend the better
shape, and let the person decide whether to keep following it or fix it. Concrete
beats vague: "the repo pins X, which forces Y; that reads like drift because Z —
I'd change it to W, but I'll follow the rule until you say otherwise."

**A flag is non-blocking.** Raise it in the report or in a one-line narration and
carry on following the rule; it stops the run only if the conflict actually blocks
correct work.

## 4. A file that describes configuration is not the authority on it

Rule 3 is about a rule the repository *states*. This one is about a sentence that
*reports* something enforced elsewhere — a workflow, a container build, a
manifest, a forge setting. There the enforcing artifact decides, and where the two
disagree it is the sentence that is wrong.

Read that artifact **in full** before writing or correcting such a sentence — not
the part that looks relevant, since the line that settles it is the one you would
have skipped — and assert nothing the read did not show. The same bar holds for
the commit message and the change-request body, where the claim gets restated as
fact.

Not being able to read the artifact is a third answer, not a "no": name the
artifact you could not open, rather than writing the sentence from memory. A read
that came back truncated is one of those — it is not a read in full.
