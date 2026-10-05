# What reads a fix

Read wherever a fix is made after a review raised its finding — after the round before a change
request opens, and in the loop driving one after. It owns which fix goes back to a reviewer and how
often a slice's may; how the finding it answers is rated and scoped is
[`findings.md`](findings.md)'s, and the forge's own reviewer is its driver's.

**The session reads every fix it makes**, against the finding it answers, before the fix is pushed
or merged. Nothing still to come stands in for that reading: a later review of the whole change is
not one ([`forge-behaviour.md`](forge-behaviour.md)), and may not run at all.

## Which fix a reviewer reads again

- **A fix that stays inside the finding it answers** is covered by that reading. Inside means it
  touches what the finding named and nothing the finding did not; a fix that has to be argued
  inside is outside.
- **A change with no behaviour in it** — a comment, prose that describes, wording, formatting — is
  covered the same way, each read against what it answers. Text something executes — a spec code is
  generated from, a schema, a skill an agent follows — is behaviour, not prose.
- **A fix that answers more than its finding asked, or would meet the high-risk test** of
  [`review-pipeline.md`](review-pipeline.md)'s *The rung*, goes back to a reviewer:
  `hcb-dev:codex-review` on the change's own base, or `hcb-dev:claude-review` at `medium` where
  Codex cannot run. A conflict resolution past a trivial one goes the same way.

**One such reading per slice**, whatever sent it there — the slice's own fixes, a change request's
reviewer, a conflict. Past it the session's own reading is the last one: the report names the fixes
no reviewer read again, and nothing stops for that. More only on the user's word.

A `Minor` never sends a fix to a reviewer (`findings.md`). Commit fixes naming the findings they
close, so what was closed is readable off the branch rather than out of a session's memory.

**A reading counts only as far as it covered**, read as any round's
([`review-pipeline.md`](review-pipeline.md), *The coverage it reports*).
