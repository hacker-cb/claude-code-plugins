---
name: label-taxonomy
description: >-
  Set up or rework a repository's whole label set and relabel what carries it:
  read every label and every issue, change request and discussion that holds
  one, propose the families, classify every carrier in batches, then rename,
  create, edit, relabel and delete on the user's word and verify the result.
  Use when the user asks to introduce labels, restructure or clean up the label
  set, migrate labels to new families, or relabel the backlog as a whole —
  "заведи метки", "перекрои метки", "переразметь issues", "наведи порядок в
  метках", "рефакторинг labels", "relabel the backlog", "set up a label
  taxonomy". Every write waits for two approvals: the set, then the exact plan.
  Not for labelling one issue or one change request as it is filed, split or
  closed (`hcb-dev:issue-tracking`), and not for surveying the backlog for what
  to work on (`hcb-dev:backlog-survey`).
---

# Label taxonomy

A whole label set, reworked in one run: read, proposed, classified, approved, applied, verified.
What each role means and how a set is read is [`../../references/classification.md`](../../references/classification.md)'s;
the families this plugin proposes and how a label leaves a set, [`../../references/label-model.md`](../../references/label-model.md)'s;
when each label is written afterwards, [`../../references/label-lifecycle.md`](../../references/label-lifecycle.md)'s.
Nothing is written to the forge before approval 2, and nothing the approvals did not name.
**Paths**, substituted at invocation — use verbatim: `<plugin root>` is `${CLAUDE_PLUGIN_ROOT}`.

## The run's files

One directory per repository, under `$HOME/.claude/plans` — literally, so a session resumed under
another configuration finds it — named `<repository>-labels`, its first line of `README` naming the
checkout ([`../../references/session-naming.md`](../../references/session-naming.md)). It holds
`snapshot.json`, `set.md` (approval 1), `roles.json`, `rows/<batch>.jsonl`, `plan.json` and
`journal.jsonl`; nothing of it goes into the repository.

## 1. Scope

Always: open issues, and open change requests into the default branch. By default: closed issues.
Merged change requests into the default branch only on the user's word, asked with the count of
them that settled an issue and of those that settled none. Discussions are read, never relabelled.

## 2. Read

```bash
D="$HOME/.claude/plans/<repository>-labels"; mkdir -p "$D/rows"
L="${CLAUDE_PLUGIN_ROOT}/skills/label-taxonomy/scripts/labels.mjs"
node "$L" snapshot --out "$D/snapshot.json"
```

`read` false is a stop; `complete` false is named in every report after it, and no deletion stands
on it. `unavailable` names what this forge or server does not carry — a parent without hierarchy, a
kind of work without native types. Then, on the default branch's tree, find every file that names a
label — workflow conditions, labeler and release configuration, permission wildcards
(`git grep -F -f <file of names> <remote>/<default>`) — and the project's own section on labels, if
it has one, with its history.

## 3. Approval 1 — the set

Write `set.md`: per family its prefix, role and colour; per label its name, colour, description,
and a line each for **when to apply** and **when not**; the renames, the deletions, and every
label kept as is. The families and values come from `label-model.md`, the values from this
project's issues and tree. Name the files that key on a name the set changes. Check the set's part
of the plan before showing it, a plan holding only `create`, `edit` and `delete`:

```bash
D="$HOME/.claude/plans/<repository>-labels"
L="${CLAUDE_PLUGIN_ROOT}/skills/label-taxonomy/scripts/labels.mjs"
node "$L" check-set --snapshot "$D/snapshot.json" --plan "$D/plan.json"
```

`ok` false is fixed before the ask. The ask shows `set.md` whole — a page or a file, never a
summary — and the approval covers that file as it stands.

## 4. Classify

Write `roles.json` from the approved set — per family the count a leaf, a parent and a change
request take (`classification.md`), `skip` the names outside the roles, `nativeKind` and
`nativeTypes` where the repository runs the kind of work as a native type, `parentLabel` where
the server carries no hierarchy — the format is in the script's header.

Split the carriers into batches of about 40 and give each to a subagent, several at once, with:
`set.md`, `roles.json`, its own list of numbers, and the one file it writes, `rows/<batch>.jsonl`
— never another. Each carrier gets one row, `{"kind", "number", "add", "remove", "why", "sure"}`,
`add` and `remove` its change from what it carries now, empty where it stays. What it reads:

- an issue — its body and every comment;
- a closed issue — the change that settled it, read as a change request's labels are read;
- a change request — its title, body and the files it changes, `scope:` from the files;
- a merged change request that settled issues — the union of their labels, checked against its
  files.

Once every batch is back, the rows are checked for coverage, each carrier exactly once:

```bash
D="$HOME/.claude/plans/<repository>-labels"
L="${CLAUDE_PLUGIN_ROOT}/skills/label-taxonomy/scripts/labels.mjs"
node "$L" check-roles --snapshot "$D/snapshot.json" --roles "$D/roles.json" --rows "$D/rows" --population all
```

`missing` goes back to a batch; `twice` and `unreadable` are fixed in the file that holds them.

## 5. Doubts

Every row with `sure` false goes to a second subagent that has not seen the first verdict, with
the same material. Where the two agree, that row stands; where they do not, the carrier goes to
the user with both readings.

## 6. Approval 2 — the exact plan

Fold the rows into `plan.json` beside the set's part — one `relabel` row a carrier that changes —
and check both:

```bash
D="$HOME/.claude/plans/<repository>-labels"
L="${CLAUDE_PLUGIN_ROOT}/skills/label-taxonomy/scripts/labels.mjs"
node "$L" check-set --snapshot "$D/snapshot.json" --plan "$D/plan.json"
node "$L" check-roles --snapshot "$D/snapshot.json" --roles "$D/roles.json" --plan "$D/plan.json"
```

Each `violations` entry is fixed, or named in the ask as the reason it stands; `bothWays` is read
for a native type and a label that disagree. The ask, per
[`../../references/report-format.md`](../../references/report-format.md): the counts per operation,
the order they run in (renames, creates, edits, relabels, deletions), the files that key on a
changed name and the change to each, the carriers the user settled — and the whole table as a page
or a file. A workflow run on `labeled` or `unlabeled` fires on each relabel: say how many runs.

## 7. Apply, then verify

```bash
D="$HOME/.claude/plans/<repository>-labels"
L="${CLAUDE_PLUGIN_ROOT}/skills/label-taxonomy/scripts/labels.mjs"
node "$L" apply --snapshot "$D/snapshot.json" --plan "$D/plan.json" --journal "$D/journal.jsonl"
node "$L" snapshot --out "$D/after.json"
node "$L" verify --snapshot "$D/after.json" --plan "$D/plan.json"
```

`stopped` names the step and why: fix the cause, then run `apply` again over the same journal —
it skips what is done. A step `skipped` — a carrier whose labels moved since the snapshot, a label
something still holds — is named in the report with what it would take; it is not retried on its
own. `verify` answering `ok` true over a `complete` snapshot is the end of the write.

## 8. The project's files

Every file step 2 found naming a changed label changes with it, and a section on labels in the
project's documents shrinks to the concept (`label-model.md`) — one change, handed to
`hcb-dev:shipping-workflow` through the Skill tool.

## 9. Tell the epic

Where an epic of this repository is running ([`../../references/epic-structure.md`](../../references/epic-structure.md)),
its master session is told the set changed and which names moved.

## After a restart

The run's directory is the state: `set.md` approved or not, the rows present, `plan.json`, the
journal. The approvals the conversation lost are asked again — a file on disk is not a word.

## Reference files

| file | read it |
|---|---|
| [`../../references/invariants.md`](../../references/invariants.md) | once, before the first answer a script or the forge gives |
| [`../../references/forge-docs.md`](../../references/forge-docs.md) | before writing an invocation this skill does not spell out |
| [`../../references/issue-links.md`](../../references/issue-links.md) | before a parked reason is turned into a link |
