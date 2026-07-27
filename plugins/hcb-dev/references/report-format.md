# The final report

Shared by the skills that report on finished work — `implementation-workflow`
after a set, and `shipping-workflow` after a standalone slice — so the shape is
the same whichever ran and the wording does not drift. It sits at a different
altitude from `github-pr-workflow`'s Step 7: that one reports on a single merged
change request; this one reports on the *whole run*, across slices. In a
multi-slice request set you get several Step 7s (one per change request) **and**
one of these at the end; they don't compete because they cover different scopes —
don't fold one into the other.

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
   nits, follow-ups), grouped by category and rated on the reviewers' own scale —
   `Critical` / `Important` / `Minor` (the same scale Copilot findings are
   classified on; see `github-pr-workflow/references/copilot.md`). **If there are
   none, say so explicitly** — "no incidental findings" is a real result, and its
   absence must not read as an omission.

4. **Open offers and next steps** — any `deferred_offer` not taken (a change
   request the local run *could* open, per slice or whole-feature), follow-up
   issues worth filing, and — after a local set that left merged-but-unpushed
   branches — a pointer to `/hcb-dev:git-cleanup` for the residue.

## Template

```
## Run report

| Slice | What | Completion | State |
|---|---|---|---|
| <name> | <one line> | merged → <parent>  /  <CR-url> (merged\|ready) | done\|partial\|skipped |

**Coverage** — <per-slice coverage lines; name any gap; "fully covered" if clean>

**Incidental findings** — <grouped, rated Critical/Important/Minor; or "none">

**Offers & next steps** — <open change-request offers, follow-ups, cleanup pointer; or "none">
```

The `State` column is the honest-coverage discipline the plugin is built on,
applied to a whole run: a reader glancing at it must be able to tell a clean,
complete set from one that landed part of the work — the offer to open a
whole-feature change request over an incomplete branch must never be presented as
if the set were whole.
