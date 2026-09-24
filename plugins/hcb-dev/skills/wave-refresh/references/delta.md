# What moved, and what the open change requests are writing

Read by `hcb-dev:wave-refresh` for the two reads whose obvious form answers
wrongly and says nothing: the tracker's delta, which a filter by update time
takes without the link changes a wave is planned on, and the files an open
change request touches, whose list is cut at a hundred with no count beside it.
What each forge actually does here is
[`../../../references/forge-behaviour.md`](../../../references/forge-behaviour.md);
this file is the form.

## The tracker's delta

One call per hundred issues, on either forge: the wide tier read again and set
against the graph of the last whole reading. What that tier is, and every flag
that narrows it, is
[`../../../references/issue-currency.md`](../../../references/issue-currency.md);
these two are what make it a delta.

```bash
S="<plugin root>/scripts/issue-slice.mjs"; W="<the graph file>"
node "$S" --since "<moment>" --was "$W" <the slice's own flags, as that file gives them>
```

Those flags are the ones the pinned graph was read under — the script refuses a
graph of any other slice — and `<moment>` is the moment the ledger records
beside it. The verdict's `delta` is what the pass acts on — save for the epic the slice runs under
and its `wave` issues, structure taking no verdict ([`../../../references/epic-structure.md`](../../../references/epic-structure.md)):

| key | what it obliges |
|---|---|
| `entered`, `left` | in the slice now and not then, and the other way: an entered issue is ruled from scratch, a left one takes its verdict line out of the ledger |
| `edited` | `updatedAt` moved — the issue's own content or state |
| `linked` | a link key differs from the pinned graph: added, removed, reparented, or an end that changed state — `hid` among them, since an end out of sight moves nothing else |
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

`unavailable` carrying `ev.<key>` is a kind nothing counts events for here — a
closing change request on either forge among them, and the hierarchy on GitLab;
the comparison stands alone there, and `check` cannot speak for that kind. An
end the token cannot see is in neither the count nor any list of edges: the
line's `hid` counter is its only mark, which is why the comparison carries it
and why a slice holding one says so in the report.

**The moment for the next pass is `delta.moment`** — the forge's own clock, read
before the slice was and less the margin an event's timestamp needs — never this
session's clock, which is not the one the events are stamped by. A reading that
names none leaves its graph all the same, the comparison needing no clock: the
ledger then keeps the moment it already carried, and the next pass asks from
there — a window wider than it needs, never shorter.

## The graph to compare against

The pinned graph is the same script's own delta output — a reading taken
without `--since` carries no children by name — projected down to the verdict
line, the numbers and the link keys:

```bash
jq -c 'if .slice then {slice: (.slice | {tier, forge, repo, host, filter, read, complete, reason, delta: {since: .delta.since, moment: .delta.moment}})} else {n} + with_entries(select(.key | IN("p","ch","chl","bb","bl","rel","pr","hid"))) end' <reading> > <graph file>
```

**It lives in a comment of its own** on the epic, opening with `<!-- wave-slice -->` above the
graph file in a `jsonl` fence, byte for byte; the header's row for the last whole reading of the
slice ([`../../../references/wave-ledger.md`](../../../references/wave-ledger.md)) links it beside
the file's digest (`shasum -a 256 <graph file>`). It belongs to this pass alone: written here, read
here, **replaced** whole rather than archived — created the first time, edited in place after, the
body passed as `-F body=@<file>` and read back as any write is (`forge-behaviour.md`). A graph whose
digest is not the one the header records is no graph: a pass stopped between the two writes left
it, and the delta is taken as where none stands. Where it will not fit a comment, it is not written
and the header says so.

**Where no graph stands** — after a survey, after one that did not fit, or the
first pass of an epic — the call is made without `--was`: the links are then
read whole rather than diffed, and this reading is what seeds the graph.

## The files an open change request touches

Every open request, not only the running batches': one that nothing in the
ledger claims is occupied ground all the same, and the disagreement is itself a
finding. The file list comes back cut at a hundred with no count, so the count
travels beside it; a request that list marks short, and one that renamed a file —
whose old path is the ground it still holds and which only the second read
carries — are read again:

```bash
# GitHub — every open request, with the counts that say whether either list is whole
H="<host>"  # gh api answers from the SaaS unless the host is named; glab reads it off the checkout
gh api graphql --hostname "$H" -F owner='{owner}' -F name='{repo}' -F endCursor='' -f query='query($owner: String!, $name: String!, $endCursor: String) { repository(owner: $owner, name: $name) { pullRequests(states: OPEN, first: 100, after: $endCursor) { totalCount pageInfo { hasNextPage endCursor } nodes { number baseRefName changedFiles files(first: 100) { nodes { path changeType } } } } } }' \
  --jq '.data.repository.pullRequests | {open: .totalCount, more: .pageInfo.hasNextPage, cursor: .pageInfo.endCursor}, (.nodes[] | {n: .number, base: .baseRefName, changed: .changedFiles, read: (.files.nodes | length), renamed: [.files.nodes[] | select(.changeType == "RENAMED") | .path], files: [.files.nodes[].path]})'
# GitHub — one marked short or renaming: both paths, and each page's own record count beside them
N="<number>"; gh api --hostname "$H" --paginate "repos/{owner}/{repo}/pulls/$N/files" --jq '{records: length}, (.[] | .filename, (.previous_filename // empty))'
# GitLab — the listing, a hundred a call: the paths, and the count to hold them against
glab api graphql -f query='query($endCursor: String) { project(fullPath: "<path>") { mergeRequests(state: opened, first: 100, after: $endCursor) { pageInfo { hasNextPage endCursor } count nodes { iid targetBranch diffStatsSummary { fileCount } diffStats { path } } } } }'
# GitLab — both paths, which only this field carries: the requests named, ten to a call
glab api graphql -f query='query { project(fullPath: "<path>") { mergeRequests(iids: ["<iid>", "<iid>"]) { nodes { iid diffs(first: 100) { pageInfo { hasNextPage } nodes { newPath oldPath renamedFile } } } } } }'
```

**Where `more` is true, the next call takes `endCursor` as `$endCursor`** — the
requests past the first hundred hold ground like any other, and a pass that
stopped at the page boundary measured less than it claims.

**A renamed file holds the path it came from as much as the one it went to.**
GitHub's listing marks the rename and its REST read carries the old path;
GitLab's listing marks nothing, so the field that carries both paths is read by
`iids` for every request whose zone could meet a candidate — ten to a call, and
its own counts left out of that one, which the complexity limit refuses — and a
request left unread is a zone nobody measured.

**Every read is checked against the count that belongs to it**: GitHub's REST
files stop at three thousand however far the pages run — each page states its
own `records`, and their sum is what `changedFiles` is held against — while on
GitLab the two counts can part. A read short of `changedFiles` or of `fileCount` leaves
that request's zone unmeasured rather than small: it then holds everything a
candidate would touch, by the rule [`../SKILL.md`](../SKILL.md) gives for a zone
no source settles.

A request whose files reach past the zone its order drew, and one no batch row
claims, both go to the user as the disagreements they are.
