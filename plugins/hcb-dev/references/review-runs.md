# Waiting on a review, and reading what it hands back

Read by whatever waits on a review it cannot watch finish — a forge's reviewer, a process it
started in the background, a subagent — and by whatever reads what a review handed back. It owns
how that wait is spent and when it ends, and how the answer is read: as it came, by the coverage it
states, and with a spent quota told apart from a review.

## Waiting

**A subagent is waited for by its own return.** Launch it with `run_in_background: false` where
the Agent tool offers it: a subagent always reports its end, and that report is the wait. Where the
call comes back at once, the agent running in the background, wait for its completion notice; what
it writes is never read while it runs.

**Anything else is waited on with a blocking call, never a loop.** One call that holds a single
turn for ten minutes, or until the answer is in; repeat it, window after window, nothing checked
between them — the window *is* the wait. **Never** wait by running commands in a loop, a `sleep`, a
`seq`, or a background watcher that sleeps and re-checks: a backgrounded call returns instantly, so
the wait becomes a spin billing a whole turn, with the whole context behind it, every few seconds.

**With several out, a window is spent on one of them.** Collect the ones that have already answered
before opening any window, and open the next on the one most likely to return, never on the same
silent one while finished answers sit unread. The ceiling is wall-clock across the whole wait:
three reviewers do not buy three hours.

**Ending the turn instead is for one case only**: an interactive session, a person present, and
nothing downstream blocked on the answer — there the harness's completion notification brings the
answer back. Two things make that case narrow: a process that hangs sends no notification at all,
so the ceiling never arrives and the wait is silent forever; and a subagent that ends its turn ends
the work the review was gating. **Anything autonomous — a subagent, a dispatched batch, an
orchestrated slice — waits on the windows**, and whoever ends a turn while reviewers are out says
which ones, and says nothing about what they found until their answers are in hand.

**A wait ends, but not soon.** A review takes minutes and the upper rungs tens of them: half an
hour of silence is a reviewer reading, and a window that expires is one window, not a verdict. What
ends a wait is an hour of it, on the clock rather than per reviewer. Before that hour waiting is the
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

- **A `coverage-warning:` is partial coverage.** The findings are real; what the warning names is
  not among them. Say which case it was.
- **A `run-warning:` is not.** Degraded is not narrowed — a fallback model answered, a boundary
  refused a command — so it never makes a review partial, and what it leaves undone is the
  caller's.

When a review fails, pass its own error through rather than guessing a cause.

**A spent quota is not one of those failures, and not a review either.** Nothing about the change is
wrong, and no coverage was lost to anything the caller controls. **Read which limit the notice
names**: the account's closes only at its reset time, so report the reviewer unavailable in its own
words and let whoever is completing the work decide whether to wait or proceed a reviewer short; a
single model's is closed now by running on another. **Never read such a notice as a review**: one
whose whole body is a sentence about a limit, or about switching models, is a reviewer to record as
unavailable.
