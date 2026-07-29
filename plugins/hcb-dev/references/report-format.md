# The final report

Read by whatever reports on finished work, so the shape is the same whichever ran
and the wording does not drift. It sits at a different altitude from a
change-request driver's own report: that one covers a single merged change
request, this one the *whole run*, across slices. A multi-slice request set
produces several of the first and one of these at the end — different scopes,
so don't fold one into the other.

Keep it scannable: short grouped bullets, a small table, not an essay.

## What it must contain

1. **Per-slice outcome** — one row per slice: what it did, how it completed
   (merged locally into `<parent>`, or the change-request URL and whether it
   merged), and its state (done / partial / skipped). A set that ended partway —
   a slice failed or was skipped — says so here plainly; never let a summary read
   as complete when it isn't.

2. **Review coverage, and what stayed uncovered.** Carry the coverage lines from
   each slice's `multi-review` verbatim — a reviewer that could not run, ran over
   nothing, or ran over the wrong range is a gap, and a structural gap (a
   reviewer's own fixed limitation, which no answer could close) is labelled as
   such so the reader can tell it apart from one still worth closing. If every
   slice was fully covered, say that.

3. **Incidental findings, rated by importance.** The lower-severity items
   surfaced-but-not-fixed during the run (out-of-scope observations, deferred
   nits, follow-ups), grouped by category and rated `Critical` / `Important` — as
   [`../skills/github-pr-workflow/references/copilot.md`](../skills/github-pr-workflow/references/copilot.md)
   defines those two — or `Minor`, this report's own tier for the below-Important
   items that guidance lumps under `Skip` (its don't-fix-in-the-loop bucket).
   **If there are none, say so explicitly** — "no incidental findings" is a real
   result, and its absence must not read as an omission.

4. **Open offers and next steps** — a `declined_offer` (a change request the local
   run *could* have opened and the user turned down), follow-up
   issues worth filing, and — after a local set that left merged-but-unpushed
   branches — a pointer to `/hcb-dev:git-cleanup` for the residue.

## Template

```markdown
## Run report

| Slice | What | Completion | State |
|---|---|---|---|
| <name> | <one line> | merged → <parent>  /  <CR-url> (merged\|ready) | done\|partial\|skipped |

**Coverage** — <per-slice coverage lines; name any gap; "fully covered" if clean>

**Incidental findings** — <grouped, rated Critical/Important/Minor per the scale above; or "none">

**Offers & next steps** — <open change-request offers, follow-ups, cleanup pointer; or "none">
```

A reader glancing at the `State` column must be able to tell a clean, complete set
from one that landed part of the work: an offer made over an incomplete branch is
never presented as if the set were whole.
