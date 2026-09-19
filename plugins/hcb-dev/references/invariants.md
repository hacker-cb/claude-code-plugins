# Invariants — how a signal is read, and what an authority permits

Read once per run, by every skill in this plugin. Each line below holds wherever
a tool, a forge, a remote or another session answers, and no skill restates one:
a skill names the invariant it is leaning on and goes on.

## Reading a signal

- **Empty is not negative.** Nothing returned answers "nothing came back", never
  "the answer is no". A feed with no rows, a rollup over zero statuses, a review
  list with no entry, a search with no hit: each is the answer arriving, not the
  answer. Say which of the two you concluded.
- **Unread is not empty, and a failed call prints what an empty one prints.**
  Capture every read with its exit status rather than piping it onward; a
  non-zero exit is a third outcome that takes its own step.
- **An unrecognised shape is not an empty one.** Where a reading rests on a layout
  nobody published — a review body's blocks and counts, a bot's login — the markers
  going missing say the layout may have moved, never that nothing was there. Lean
  the reading toward what arrived, mark it unrecognised, and name it in the report;
  the run goes on.
- **A count is of the moment it was taken.** Whatever registers afterwards was
  not measured, so "none outstanding" is true only about that instant. Where a
  named aggregate exists, wait on it rather than on a count reaching zero.
- **A set on one surface is not the set on another.** What a summary rolls up,
  what a listing enumerates and what an object actually carries differ; a wait
  keyed to the wrong one has no moment of truth.
- **The first page is not the list.** Paginate to the end, or set the limit above
  the listing's own total where the listing honours one above its page cap,
  before counting, sweeping or concluding absence.
- **Configuration predicts nothing; read the result.** A setting says what was
  asked for, never what happened — so read what actually posted, landed or
  answered, whatever the configuration says it would do.
- **Never guess a name.** A branch, a remote, a label, a check, a field: a guess
  that resolves is not a guess that is right. Resolve it, or say the question
  cannot be answered.
- **A file read in part is not read.** A truncated read, or a read of the section
  that looked relevant, settles nothing — the line that decides is the one that
  would have been skipped.

## Acting under an authority

- **An authority narrows on the way down and never widens.** Holding one, you may
  hold back and say you did; you never give yourself what your caller did not.
- **Every stop carries its recommendation first**, with what it rests on and what
  it turns down. A bare question hands back the work the analysis was for.
- **A skill's own ask is the permission its caller needs.** Where a rule admits
  subagents, workflows or reviewers only on the user's or a skill's ask, the
  invocation that started this run and the skills it calls are that ask.
- **A promised outcome is closed with its outcome, whichever way it came out** —
  clean; red with what is red; nothing there to measure; not waited out, with the
  state it stood at; or **unread**, with what stands in the way, which stays owed
  until it can be taken. Silence carries nothing, so it is never made to, and a
  protocol announced as "only if it goes wrong" is that same silence with
  permission.
