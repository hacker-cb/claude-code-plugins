# Waiting on a review, and reading what it hands back

Read by whatever waits on a review it cannot watch finish — a forge's reviewer, a process it
started in the background — and by whatever reads what a review handed back. It owns how that wait
is spent and when it ends, and how the answer is read: as it came, by the coverage it states, and
with a notice of a spent limit told apart from a review.

## Waiting

**A wait is a blocking call, never a loop.** One call that holds a single turn for ten minutes, or
until the answer is in; repeat it, window after window, nothing checked between them — the window
*is* the wait. **Never** wait by running commands in a loop, a `sleep`, a `seq`, or a background
watcher that sleeps and re-checks: a backgrounded call returns instantly, so the wait becomes a spin
billing a whole turn, with the whole context behind it, every few seconds. Where nothing offers a
blocking wait, wait inside a single command that blocks until the answer is in or the window is up.

**Ending the turn instead is for one case only**: an interactive session, a person present, nothing
downstream blocked on the answer, and a background task of this session's own to wait for — the
harness's notice of its end brings the answer back, where a forge's reviewer sends none.
**Anything autonomous — a subagent, a dispatched batch, an orchestrated slice — waits on the
windows**, and whoever ends a turn while reviewers are out says which ones, and says nothing about
what they found until their answers are in hand.

**A wait ends, but not soon.** Half an hour of silence is a reviewer reading, and a window that
expires is one window, not a verdict. What ends
a wait is an hour of it, on the clock rather than per reviewer. Before that hour waiting is the
whole of the job; at it, stop and record what happened — a reviewer that never returned is a row
and a reason in the caller's report, never a reason to stall and never a review to claim. Spend the
wait itself on what does not depend on the answer.

## Reading it back

Pass the findings on **as they came** — no paraphrase, no summary, no commentary wrapped around
them. Then judge the coverage by what the review states it covered rather than by how it phrased
itself, two kinds of line apart:

```text
coverage-warning: <what is not covered, and why>
run-warning: <what happened to the run, and what it leaves the caller to do>
```

- **Nothing reviewed is not a pass** — a review that covered no file reports coverage of zero,
  never a clean review.
- **A `coverage-warning:` is partial coverage.** The findings are real; what the warning names is
  not among them. Say which case it was.
- **A `run-warning:` is not.** Degraded is not narrowed — a fallback model answered, a boundary
  refused a command — so it never makes a review partial, and what it leaves undone is the
  caller's.

When a review fails, pass its own error through rather than guessing a cause. **A notice of a spent
limit is not a review**: one whose whole body is a sentence about a limit, or about switching
models, is a reviewer to record as unavailable, in its own words.
