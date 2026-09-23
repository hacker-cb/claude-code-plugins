---
name: status
description: >-
  Say where the work stands right now, re-read rather than recalled, in
  whichever role this session holds — an epic and its batches, one batch of a
  wave, or a standalone run and its slices — and, for any session handed an
  epic number, that epic's state read from its ledger; with none named, which
  epics are open. Use when the user asks where things stand ("где мы", "что
  сейчас происходит", "на чём стоим", "какой статус", "статус эпика #N", "какие
  эпики открыты", "where do we stand", "what's the status"),
  and for what a run prints once it has recovered from a restart, where its
  own role routes that here. Read-only: it writes no ledger, no tracker and no message to
  another session, and a source it could not read it names as unread rather
  than printing it empty. Not the pass that recomputes what can start next
  (`hcb-dev:wave-refresh`); not the coordinating role itself
  (`hcb-dev:master-session`); not re-reading a plugin that moved
  (`hcb-dev:session-plugin-refresh`).
argument-hint: "[epic]"
---

# Status

Where the work stands now, read again rather than recalled. It writes nothing — no ledger, no
tracker, no message to another session — and marks nothing answered, which would be a write. The
report is [`../../references/report-format.md`](../../references/report-format.md)'s grammar, in
the occasion [`../../references/report-blocks.md`](../../references/report-blocks.md) lists for a
status. Read [`../../references/invariants.md`](../../references/invariants.md) first.
**Paths**, substituted at invocation — use verbatim: `<plugin root>` is `${CLAUDE_PLUGIN_ROOT}`.

## Which role, and which subject

**An epic number in the invocation fixes the subject** — that epic, read from its ledger — and
settles nothing about the role. Where this session also holds a role over another epic, both
readings stand, and the report says which is this session's own.

**The role** comes from what this session carries, each a candidate and never a verdict:

1. **The order it runs under** ([`../../references/order-anatomy.md`](../../references/order-anatomy.md)):
   a tag `<epic>/<id>` makes it a batch of that epic.
2. **The title it wears**, as the host answers it — never an identifier read out of a path
   ([`../../references/session-comms.md`](../../references/session-comms.md)) — read against
   [`../../references/session-naming.md`](../../references/session-naming.md)'s shapes: the
   master's makes it a master, a batch's a batch.
3. **Neither, and something says this session runs its own work** — a plan-doc, a task list, a
   branch of its own: a standalone run.
4. **Nothing answers** — the role is unread, never standalone by default: say which of the three
   came back empty and what that leaves unopened, and ask for the epic number rather than taking
   one out of a path, the open epics listed (below) so the ask names them.

A master or a batch is confirmed against the epic's ledger: the header's master name, a batch row
naming this session. Where the ledger contradicts the candidate — a variant the host handed back,
a row naming another session — the contradiction is printed first, as what it is, and the report
stands on the reading this session can defend. Correcting the ledger is the master's write.

## What is read

### The open epics — where no epic is named

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/epics.mjs"
```

Every epic the account opened, across every owner it reaches
([`../../references/epic-structure.md`](../../references/epic-structure.md)); `--owner` widens it
to one the user names. A list that came back not `complete` is printed as the part it is.

### The epic — for a master, and for any session handed a number

```bash
EPIC="<the number the invocation named, or the role's own>"
DEEP="<the issues of ONE repository: the epic, and the return's issue where it shares that repository>"
REPO="<owner/name, where the epic lives outside this checkout's>"
HOST="<the host it lives on, where that is not the one the CLI answers for by default>"
node "${CLAUDE_PLUGIN_ROOT}/scripts/ledger.mjs" --issue "$EPIC" ${REPO:+--repo "$REPO"} ${HOST:+--host "$HOST"}
node "${CLAUDE_PLUGIN_ROOT}/scripts/issue-slice.mjs" --deep "$DEEP" ${REPO:+--repo "$REPO"} ${HOST:+--host "$HOST"}
```

One repository a call: a tracking epic's batches often return in another, and a number read
against the wrong one answers with an unrelated issue rather than with nothing. A request and a
return each resolve against the repository they live in, in a call of their own where that is
not the epic's. `ledger.mjs` first — whether a ledger stands, and whether its
coordinate resolves to one comment — then that comment out of `--deep`'s, picked by the author
and moment `ledger.mjs` gave for it rather than by matching its marker again, read whole, as
prose: its batch rows, the merge queue and the gates, and the expectations the user owes
([`../../references/wave-ledger.md`](../../references/wave-ledger.md)). Each change request the
queue names is read as below. The live registry says which batch sessions answer now — presence,
never absence.

### This batch

The same two reads, the epic being the order's; from its ledger, this batch's row, the standing
constraints, the decisions, and the expectations naming this batch. Then its own change request,
as below; its branch against the order's base pin; and the coordinate the order names for its
return, read in the call above — a return written there and a return accepted are two states.

### This run

The plan-doc, where one was kept — named and placed per `session-naming.md`, its first line
naming this checkout — for the gate's
settlements; the task list for the slice in flight; then the tree, which outranks both: each
slice's branch, whether its parent's history carries it, and in request mode whether its request
merged.

```bash
SLICE="<the slice's branch>"
# Where THIS slice publishes — the checkout may stand on another branch, and in a fork workflow
# the two differ. `remotes.push` is a remote's NAME, and a remote may push somewhere else again.
PUSH_REMOTE="$(git config --get "branch.$SLICE.pushRemote" || git config --get remote.pushDefault \
  || git config --get "branch.$SLICE.remote" \
  || node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-base.mjs" | jq -r '.remotes.push // ""')"
PUSH_URL="$(git remote get-url --push "$PUSH_REMOTE")"
# GitHub — `--head` matches the branch NAME across every head repository, forks included
gh repo view "$PUSH_URL" --json id,nameWithOwner
gh pr list --head "$SLICE" --state merged --json number,url,mergedAt,headRepository
# GitLab — `source_project_id` against the project's own, which the same view answers
glab repo view "$PUSH_URL" --output json
glab mr list --source-branch "$SLICE" --merged --output json
```

An empty `PUSH_REMOTE` or `PUSH_URL` leaves the identity unread, and with it the slice's merged state —
that is a bullet of `## The picture`, never a slice printed unmerged. A request whose head is not
that repository by identity is another project's
([`../../references/forge-behaviour.md`](../../references/forge-behaviour.md)) — a fork keeps the
upstream's name — and the slice stays unmerged until one of that repository's own says otherwise.

A run kept without a plan-doc — the common case for a small one — prints its settlements as
unread, never as their defaults. What the task list says and the tree does not confirm is
unknown, not done.

### A change request, in any role

```bash
PR="<n>"; REPO="<owner/name, where the request is not this checkout's>"
# GitHub — its state and outstanding blockers, then the checks against the gates its base requires
node "${CLAUDE_PLUGIN_ROOT}/scripts/pr-state.mjs" --pr "$PR" ${REPO:+--repo "$REPO"}
node "${CLAUDE_PLUGIN_ROOT}/scripts/commit-checks.mjs" --pr "$PR" ${REPO:+--repo "$REPO"} \
  --sha "<head while it is open, merge once it has merged>" --require-from-gates
# GitLab — its state and the pipeline the forge names
glab mr view "$PR" --output json ${REPO:+--repo "$REPO"}
```

Where no script takes a verdict for the forge, what the forge said is printed as it said it, the
report says the verdict was not taken here, and the readings no script covers there — the
unresolved threads, the base's required checks — stand in `## The picture` as unread. On a merged
request a gate that runs only on requests never reports over the landing: that is `none` among
the shapes [`../../references/slice-completion.md`](../../references/slice-completion.md) names
for `base_checks`, not a run still going. Nor is a merge commit whose verdict is `covered`: its
rows still running are printed as not waited for.

## What the report prints

- **The first line** — the circle of the worst state read, what the report covers (the epic, the
  batch or the run, and the pin or moment it was read at), and what waits on the user.
- **`## The picture`**, where something did not answer or a fault stands — a bullet per source: what it was,
  what it would have settled, and what therefore stands on the record alone.
- **`## Where it stands`** — the catalogue's rows for a status.
- **`## Needs your word`** — what the user owes, printed from the record as it stands: the
  ledger's expectations for an epic or a batch, the open gates for a run. This reading answers
  none and opens none; an ask it found that the record does not carry says so.

## When the ledger does not answer as a ledger

| `ledger.mjs` says | what prints |
|---|---|
| `read: false` | no batch row: `## The picture` says the rows are unread, and the rest stands on what else answered — never "no batches" |
| `ledger.ambiguous` | the first row that matches wins, and this one outranks the next: nothing is drawn from the ledger, the ids its `faults[]` carries stand in `## The picture`, and the repair — the master's write, on the user's word — leads the ask block |
| `ledger.found: false`, the read answered, nothing ambiguous | no ledger on that issue, with its number: for a master, the role not yet opened or another epic; for a batch, the order's epic carrying none |
| `faults[]` | a bullet each in `## The picture`, which stands for them even where every source answered; one that holds the next write rides the ask block. In a batch the ledger is the master's, so a fault saying the comment is not this session's is the normal case and not one |

## Reference files

- [`../../references/invariants.md`](../../references/invariants.md) — once, before the first read.
- [`../../references/report-format.md`](../../references/report-format.md)
- [`../../references/report-blocks.md`](../../references/report-blocks.md)
- [`../../references/wave-ledger.md`](../../references/wave-ledger.md)
- [`../../references/session-naming.md`](../../references/session-naming.md)
- [`../../references/session-comms.md`](../../references/session-comms.md)
- [`../../references/order-anatomy.md`](../../references/order-anatomy.md)
- [`../../references/forge-behaviour.md`](../../references/forge-behaviour.md) — before acting on
  what a listing, a check or a merge setting the forge reports.
