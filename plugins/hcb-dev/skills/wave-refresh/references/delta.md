# What moved, and what the open change requests are writing

Read by `hcb-dev:wave-refresh` for the two reads whose obvious form answers
wrongly and says nothing: the tracker's delta, which a filter by update time
takes without the link changes a wave is planned on, and the files an open
change request touches, whose list is cut at a hundred with no count beside it.
What each forge actually does here is
[`../../../references/forge-behaviour.md`](../../../references/forge-behaviour.md);
this file is the form.

## The tracker's delta

One call per hundred issues, on either forge, reading the slice's edges again
and setting them against the graph of the last whole reading:

```bash
node "<plugin root>/scripts/issue-slice.mjs" --since <moment> --was <graph file> \
  [--state open|closed|all] [--label <name>] [--milestone <number|title>]
```

The filters are the ones the pinned graph was read under — the script refuses a
graph of any other slice — and `<moment>` is the moment the ledger records
beside it. The verdict's `delta` is what the pass acts on:

| key | what it obliges |
|---|---|
| `entered`, `left` | in the slice now and not then, and the other way: an entered issue is ruled from scratch, a left one takes its verdict line out of the ledger |
| `edited` | `updatedAt` moved — the issue's own content or state |
| `linked` | a link key differs from the pinned graph: added, removed, reparented, or an end that changed state |
| `cut` | a link list one reading or the other only saw a window of — no edge is taken from it, and what fell outside the window shows nowhere else |
| `events` | the forge's own count of link events since the moment |
| `added`, `removed`, `moved` | the edges themselves, each written once whichever end it was read from, and the ends whose state changed — what the report's *what moved* prints |
| `check` | the comparison and the count disagree on an issue; read it whole (`--deep`) and name it in the report |
| `complete`, `reason` | whether this is a delta at all |

**The re-verification list is the union** of `entered`, `edited`, `linked`,
`cut` and `events` — every verdict it names is re-derived, every other one
carried from the ledger. A `cut` issue's links are past what the forge shows at
all, so its verdict is re-derived against the tree and the report names it as
the one this pass could not compare.

**`delta.complete: false` is not a delta.** The tracker half is then read over
the slice whole — every candidate's verdict re-derived — and the report says
which half was a delta and why the other was not.

`unavailable` carrying `ev.<key>` is a kind this server counts no events for;
the comparison stands alone there, and `check` cannot speak for that kind. An
end the token cannot see is in neither the comparison nor the count: the line's
own `hid` is the only sign, and a slice carrying one says so in the report.

**The moment for the next pass is `delta.moment`** — the forge's own clock at
the first page, less the margin an event's timestamp needs — never this
session's clock, which is not the one the events are stamped by. A reading that
names none leaves its graph all the same, the comparison needing no clock: the
ledger then keeps the moment it already carried, and the next pass asks from
there — a window wider than it needs, never shorter.

## The graph to compare against

The pinned graph is the same script's output, projected down to the verdict
line, the numbers and the link keys:

```bash
jq -c 'if .slice then {slice: (.slice | {tier, forge, repo, host, filter, read, complete, reason, delta: {moment: .delta.moment}})} else {n} + with_entries(select(.key | IN("p","ch","bb","bl","rel","pr"))) end' <reading> > <graph file>
```

**It lives in the ledger** ([`../../../references/wave-ledger.md`](../../../references/wave-ledger.md)),
in a collapsed `<details>` block beside the header's row for the last whole
reading of the slice, and it belongs to this pass alone: written here, read
here, **replaced** rather than archived, since it is state and not history. The
write is measured like any other (`ledger.mjs --body-file`); where it will not
fit, the graph is not written and the header says so.

**Where no graph stands** — after a survey, after one that did not fit, or the
first pass of an epic — the call is made without `--was`: the links are then
read whole rather than diffed, and this reading is what seeds the graph.

## The files an open change request touches

Every open request, not only the running batches': one that nothing in the
ledger claims is occupied ground all the same, and the disagreement is itself a
finding. The file list comes back cut at a hundred with no count, so the count
travels beside it and the requests it marks short are read again:

```bash
# GitHub — every open request beside the counts that say whether either list is whole
gh api graphql -F owner='{owner}' -F name='{repo}' -F endCursor='' -f query='query($owner: String!, $name: String!, $endCursor: String) { repository(owner: $owner, name: $name) { pullRequests(states: OPEN, first: 100, after: $endCursor) { totalCount pageInfo { hasNextPage endCursor } nodes { number baseRefName changedFiles files(first: 100) { nodes { path } } } } } }' \
  --jq '.data.repository.pullRequests | {open: .totalCount, more: .pageInfo.hasNextPage, cursor: .pageInfo.endCursor}, (.nodes[] | {n: .number, base: .baseRefName, short: (.changedFiles > (.files.nodes | length)), files: [.files.nodes[].path]})'
# GitHub — the files of one whose count marked it short
N="<number>"; gh api --paginate "repos/{owner}/{repo}/pulls/$N/files" --jq '.[].filename'
# GitLab — the same, its own two counts beside it
glab api graphql -f query='query($endCursor: String) { project(fullPath: "<path>") { mergeRequests(state: opened, first: 100, after: $endCursor) { pageInfo { hasNextPage endCursor } count nodes { iid targetBranch diffStatsSummary { fileCount } diffStats { path } } } } }'
```

**Where `more` is true, the next call takes `endCursor` as `$endCursor`** — the
requests past the first hundred hold ground like any other, and a pass that
stopped at the page boundary measured less than it claims.

**A short list that cannot be read again** — GitLab's `fileCount` above the
`diffStats` it came with — leaves that request's zone unmeasured rather than
small: it then holds everything a candidate would touch, by the rule
[`../SKILL.md`](../SKILL.md) gives for a zone no source settles.

A request whose files reach past the zone its order drew, and one no batch row
claims, both go to the user as the disagreements they are.
