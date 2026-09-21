---
name: status
description: >-
  Say where the work stands right now, re-read rather than recalled, in
  whichever role this session holds — an epic and its batches, one batch of a
  wave, or a standalone run and its slices — and, for any session handed an
  epic number, that epic's state read from its ledger. Use when the user asks
  where things stand ("где мы", "что сейчас происходит", "на чём стоим",
  "какой статус", "статус эпика #N", "where do we stand", "what's the status"),
  and for the report a role gives once it has recovered from a restart or
  compaction. Read-only: it writes no ledger, no tracker and no message to
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
status. Read [`../../references/invariants.md`](../../references/invariants.md) first: a source
that did not answer is unread, and an unread one is never printed as empty.
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
3. **Neither** — a standalone run.

A master or a batch is confirmed against the epic's ledger: the header's master name, a batch row
naming this session. Where the ledger contradicts the candidate — a variant the host handed back,
a row naming another session — the contradiction is printed first, as what it is, and the report
stands on the reading this session can defend. Correcting the ledger is the master's write.

## What is read

### The epic — for a master, and for any session handed a number

```bash
EPIC="<the number the invocation named, or the role's own>"
node "${CLAUDE_PLUGIN_ROOT}/scripts/ledger.mjs" --issue "$EPIC"
node "${CLAUDE_PLUGIN_ROOT}/scripts/issue-slice.mjs" --deep "$EPIC"
```

`--repo <owner/name>` on both where the epic lives outside this checkout's repository.
`ledger.mjs` first — whether a ledger stands, and whether its coordinate resolves to one comment
— then the ledger itself out of `--deep`'s comments by its `<!-- wave-ledger -->` marker, read
whole, as prose: its batch rows, the merge queue and the gates, and the expectations the user owes
([`../../references/wave-ledger.md`](../../references/wave-ledger.md)). Each change request the
queue names is read as below. The live registry says which batch sessions answer now — presence,
never absence.

### This batch

The same two reads, the epic being the order's; from its ledger, this batch's row, the standing
constraints, the decisions, and the expectations naming this batch. Then its own change request,
as below; its branch against the order's base pin; and the coordinate the order names for its
return — a return written there and a return accepted are two states, not one.

### This run

The plan-doc, where one was kept — named per `session-naming.md`, under
`${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plans`, its first line naming this checkout — for the gate's
settlements; the task list for the slice in flight; then the tree, which outranks both: each
slice's branch, whether its parent's history carries it, and in request mode whether its request
merged.

```bash
SLICE="<the slice's branch>"
# GitHub
gh pr list --head "$SLICE" --state merged --json number,url,mergedAt
# GitLab
glab mr list --source-branch "$SLICE" --merged --output json
```

A run kept without a plan-doc — the common case for a small one — prints its settlements as
unread, never as their defaults. What the task list says and the tree does not confirm is
unknown, not done.

### A change request, in any role

```bash
PR="<n>"
# GitHub — its state and outstanding blockers, then the checks as one verdict
node "${CLAUDE_PLUGIN_ROOT}/scripts/pr-state.mjs" --pr "$PR"
node "${CLAUDE_PLUGIN_ROOT}/scripts/commit-checks.mjs" --pr "$PR" --sha head
# GitLab — its state and the pipeline the forge names
glab mr view "$PR" --output json
```

Where no script takes a verdict for the forge, what the forge said is printed as it said it, and
the report says the verdict was not taken here.

## What the report prints

- **The first line** — the circle of the worst state read, what the report covers (the epic, the
  batch or the run, and the pin or moment it was read at), and what waits on the user.
- **`## The picture`**, only where something did not answer — a bullet per source: what it was,
  what it would have settled, and what therefore stands on the record alone.
- **`## Where it stands`** — a row per unit: a batch of an epic, as the catalogue's rows while an
  epic runs; a slice of a run; and in a batch, its own build, request and return. A row the
  record carries and the tree does not confirm reads unknown, never done.
- **`## Needs your word`** — what the user owes, printed from the record as it stands: the
  ledger's expectations for an epic or a batch, the open gates for a run. This reading answers
  none and opens none; an ask it found that the record does not carry says so.

## When the ledger does not answer as a ledger

| `ledger.mjs` says | what prints |
|---|---|
| `read: false` | no batch row: `## The picture` says the rows are unread, and the rest stands on what else answered — never "no batches" |
| `ledger.ambiguous` | nothing drawn from the ledger: both comments by URL in `## The picture`, and their repair — the master's write, on the user's word — leads the ask block |
| `ledger.found: false`, the read answered | no ledger on that issue, with its number: for a master, the role not yet opened or another epic; for a batch, the order's epic carrying none |
| `faults[]` | a bullet each in `## The picture`; one that holds the next write rides the ask block |

## Reference files

- [`../../references/invariants.md`](../../references/invariants.md) — once, before the first read.
- [`../../references/report-format.md`](../../references/report-format.md)
- [`../../references/report-blocks.md`](../../references/report-blocks.md)
- [`../../references/wave-ledger.md`](../../references/wave-ledger.md)
- [`../../references/session-naming.md`](../../references/session-naming.md)
- [`../../references/session-comms.md`](../../references/session-comms.md)
- [`../../references/order-anatomy.md`](../../references/order-anatomy.md)
