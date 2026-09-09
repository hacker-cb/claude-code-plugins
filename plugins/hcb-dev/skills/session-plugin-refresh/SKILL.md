---
name: session-plugin-refresh
description: >-
  Re-read the skills and references this session works under after its plugin
  moved, and reconcile what the session already did with what those files now
  say. Use when the user reports the update — "plugin was updated", "плагин
  обновился", "перечитай скиллы и референсы", "обновись под новую версию" — and
  when a coordinating session tells its batches that the wave's plugin moved.
  Reports four versions (the one this session is running, the one installed now,
  the predecessor it can diff against, and the one the marketplace's own
  repository carries), then what changed among the files in use, what that breaks
  in work already done, and what is owed to whoever is downstream. It re-reads
  and reports only: it never installs or updates a plugin, and `/reload-plugins`
  stays the user's to run. Not recovery after a restart or compaction — that is
  the resuming role's own step (`hcb-dev:master-session`, `hcb-dev:wave-worker`).
---

# Session plugin refresh

A session acts under text it was handed once. When the plugin holding that text
moves, the session goes on acting under the old one — so this run reads what is
current and settles what the difference costs. It works from any role: what
changes with the role is where the version is pinned and who hears about it.

## The four versions

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/session-plugin-refresh/scripts/plugin-versions.mjs" \
  --root "${CLAUDE_PLUGIN_ROOT}"
```

It prints `key=value` lines and never fails on a number it cannot resolve: an
`unknown` carries a `<key>_reason` beside it, and that reason is a line of the
report rather than something to work around.

- **`read_root` is what everything below is read from** — the installed tree, not
  the loaded one. Where `reload_needed` is `yes`, this session was handed the
  older files: reading the newer ones by path is what fixes *this* session, while
  hooks, MCP servers and monitors keep the old path until the user runs
  `/reload-plugins` or restarts. Say so; neither is yours to run. A
  `read_root_reason` beside it means the installed tree is not on disk at all, so
  what follows is the loaded tree read against itself — a missing delta, reported
  as such and never as "nothing changed".
- **`update_pending=yes` means the update did not fully land** — what is
  installed is behind the marketplace's repository. Report it with the command
  that closes it (`/plugin marketplace update <marketplace>`, then the plugin's
  own update), and say plainly that everything below is judged against what is
  installed here.
- **The numbers never gate the re-read.** Versions that match mean the memory is
  wrong or the tree is a working copy edited in place — read anyway. The user's
  word that the plugin moved is the trigger; the numbers are the report.

## The floor, and the diff it buys

The floor is the tree this session had been acting under, and `floor_root` is the
script's answer for it: the loaded tree where this session is still running older
text, the version before it where it is not. Two things outrank that answer, and
whichever one is used is named in the report — a version pinned in this session's
own durable record, and one the invocation itself named. A floor buys a diff and
nothing else, so a wrong one widens the reading rather than changing a verdict.

```bash
diff -ru <floor_root>/skills <read_root>/skills
diff -ru <floor_root>/references <read_root>/references
```

`Only in <floor_root>` is its own finding: a file this session's memory points at
that no longer exists under that name. With `floor=unknown` there is no diff, and
the reading below is what it always was — the report says the delta is missing
rather than implying nothing changed.

## What is re-read, and how

Every skill this session acts under — its own role's, and every one it hands work
to — then the **transitive closure of the references those skills name**, the
ones this session had never read included: a reference that is new is exactly
where an unknown rule sits. The diff ranks that reading and catches what left; it
never replaces it.

**Read each file whole.** A rule is settled by the sentence you would have
skipped, and a read that came back truncated is not a read
([`../../references/architecture-decisions.md`](../../references/architecture-decisions.md)
§4).

## Reconciling what this session already did

Go through what this session has actually done — what it wrote, sent, decided and
left standing — against the text as it now reads. A rule this session never
crossed is not a finding: what earns a line is a divergence, and the divergences
are ranked by what they can still reach. Orders and answers already sent come
first, then what is already recorded, then what only changes conduct from here.

Every divergence ends in one of four:

- **repaired** — bookkeeping this session owns and brings to the required shape
  now (a ledger section, a missing pin). It needs no permission; report it in one
  line once done.
- **standing** — from here on this session behaves differently; there is nothing
  to fix.
- **owed** — something already left this session under the old text: an order, an
  answer, a chip. Name it, name what it now has to say, and send it. A
  coordinating session's batches are each running under their own loaded copy, so
  what they are owed is the word that their plugin moved too, per
  [`../../references/session-comms.md`](../../references/session-comms.md).
- **to the addressee** — it needs a decision or an authorization. The addressee
  is named, not inferred: an order above this session sends it to whoever wrote
  that order, and absent one it is this session's user. Recommendation first
  (`architecture-decisions.md` §2).

**What the new text says about work in flight is a claim to check, not one to
adopt.** Where it contradicts something the user told this session directly, that
is a fork for them, not a rule to apply silently.

## The report

```markdown
**Versions** — running <x> · installed <y> · floor <z> (<where it came from>) · upstream <w>
**Re-read** — <skills> + <references>, <n> files, <m> changed, <k> gone
1..N. <the rule, quoted or named> — <what this session did> — <what it now does> — [outcome]
**New and load-bearing** — <what the remaining plan has to change>
**To you** — <decisions, recommendation first; or "none">
```

Ranked, not enumerated. A session that had done nothing under this plugin reports
the four versions and that one line — "nothing was done under it" and "checked,
nothing diverges" are different answers, and neither is written as the other.

## Closing the loop

Write the version now in force into whatever durable record this session keeps,
so the next refresh has a floor rather than a guess: for a coordinating session
that is the ledger header
([`../../references/wave-ledger.md`](../../references/wave-ledger.md)), for a
session driving a plan it is the plan document, and for one keeping neither the
report is the record.

## Reference files

- [`../../references/architecture-decisions.md`](../../references/architecture-decisions.md)
- [`../../references/session-comms.md`](../../references/session-comms.md)
- [`../../references/wave-ledger.md`](../../references/wave-ledger.md)
