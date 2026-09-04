# Classifying an issue

The families as **roles**, the cardinality between them, how the set that carries
each role is read, and how one is proposed where none exists. The roles are what
travels between repositories; every literal is read from the repository at hand.

## The roles

| role | cardinality | what it names |
|---|---|---|
| kind of work | exactly one | a capability that does not exist yet · shipped behaviour deviating from spec or intent, latent defects included · internal quality with no new capability. A parent takes its children's dominant kind |
| component | at least one | where the work lands — the ones whose directories the diff actually touches; docs follow their subject. Three or more is a signal to decompose, not to label harder |
| parked reason | at most one | the pending trigger that should reopen attention — a decision, an upstream release, a dependency of the project's own. **Absence means ready to pick up** |
| priority | at most one | how far up the queue the work is wanted, ordinal within the family. **Absence means normal** |
| security | optional flag | on top of whatever component applies |

A deliberately deferred defect keeps its kind of work — the deferral lives in the
parked reason.

## Read the set before proposing or applying anything

Read it whole — both CLIs stop at a small default page, and a short read is
indistinguishable from a missing family.
[`fix-or-surface.md`](fix-or-surface.md)
sets when this read happens relative to a proposal, and how often.

```bash
# GitHub
gh label list --limit <n> --json name,color,description,isDefault
# GitLab — <project> is URL-encoded ("group%2Frepo"). The listing carries the
# group's inherited labels, which apply here, and archived ones, which do not:
# never apply an archived label.
glab api --paginate "projects/<project>/labels?per_page=100"
```

Map the roles onto the prefixes that set already uses, reading the descriptions
and not only the names. Where a family is ordinal, its order comes from those
descriptions and the colour ramp, never from the order the names sort in.

**Never pass a name you did not just read.** On GitLab an unknown name handed to a
label parameter is created as a new label, so a typo becomes part of the set
permanently; on GitHub labels passed while creating or updating an issue are
dropped in silence when the caller has no push access. Confirm the labels that came
back, not the exit status.

## Resolve the mechanism — first hit wins

1. **A native field.** GitHub issue types belong to organisation-owned
   repositories and hold one type per issue; GitLab's configurable work item types
   are a paid-tier feature configured on the top-level group. A `404` from either
   endpoint reads the same whether the feature is absent or merely invisible to
   this token, so treat it as absent only once something else confirms the token
   reaches this repository, and say which of the two you concluded. Where a native
   field carries a role, nothing is labelled for it. Neither forge's `issue`
   commands reach these —
   [`forge-docs.md`](forge-docs.md) has the
   entry points.
2. **A label family** — the set read above.
3. **Neither** — apply what exists, and name the roles this repository has no
   vocabulary for. Never invent one silently.

**Hold the cardinality yourself wherever the platform will not.** GitHub enforces
none of it. GitLab enforces one-value-per-key for `key::value` labels on a paid
tier only, by *replacing* the sibling when the new one is applied rather than
refusing it, and it splits the key at the **last** `::` — probe whether that is
available here instead of assuming it. So before adding from a single-value
family: read the issue's current labels, drop the sibling, then add.

Where the repository has a triage-state family, apply the value that means
untriaged and never the one that means a human accepted it.

## Proposing a set the repository does not have

Only where a role has no vocabulary and this issue needs it.

1. **Strike off what the platform already carries** — the native fields resolved
   above, and anything the tracker models as a field of its own: assignee,
   milestone or iteration, open/closed state and its reason.
2. **Propose only the roles this issue needs**, in order: the kind of work, the
   component it lands in, then a parked reason or the security flag where either
   is true. A priority family only where the user asks for one.
3. **Derive the values from the project's own vocabulary** — kind from the commit
   types or changelog headings it already writes, component from its real modules,
   packages and directories. Never from a set carried in from elsewhere.
4. **One proposal, one approval.** Each row: the name, a colour, and a one-line
   description saying *when* to apply it. In the same message name the roles the
   native fields carry, the roles nothing enforces here, and any role left
   unexpressed. The approval covers that batch and nothing later.
5. **Create it in the forge's own spelling** — six hex digits, bare on GitHub and
   `#`-led on GitLab, and always explicit: an omitted colour is chosen at random.

Never create a label that duplicates a native field, a variant spelling of one the
forge's own tooling matches by exact string, a component that does not exist yet,
or anything as a side effect of applying a label.

**Never delete or rename.** Deleting strips the label from everything carrying it,
irreversibly on both forges; renaming keeps the associations but breaks every
reference held by name — automation, templates, saved searches. Propose either and
let the user run it.

## Naming and colour

One prefix per role, in the separator the set already uses, uniform across it —
the prefix is what automation and permission wildcards key off. Where scoped
labels are available, `::` is the separator the platform reads.

One hue per family, a ramp where the family is ordinal. Colour is a scanning aid
on top of the name, never the only thing carrying a distinction.

Fill the description on every label you propose: the mapping above reads
descriptions, so an undescribed label is invisible to the next run.

## Milestones — optional

An issue carries at most one milestone — an ancestor group's space is a wider
vocabulary, not a second slot — so the repository runs **one** of two patterns:

- **Release** — the milestone is a version, and closes when that version ships.
  Take the version's shape from where the repository already writes it — its tags,
  its manifest, its changelog — never from a shape you bring.
- **Phase** — the milestone is a body of work with an exit criterion in its
  description, and closes when the criterion holds. `M<nnn>: <phase>` — three
  digits numbered in tens (`M010`, `M020`), so a phase discovered later takes a
  free number between its neighbours (`M015`).

Which pattern is in force: whatever the existing milestones are named for. Where
there are none, a repository that publishes versioned releases takes **release**,
one that publishes none takes **phase**. Whichever dimension is left over goes to
a label family; a version already shipped needs no grouping at all, since the tag
and its notes carry it. Either pattern may hold one milestone meaning *in no
release* — a backlog or holding pen. Never run a phase ladder beside releases: an
issue is in a phase and slated for a version at the same time, and there is one
slot.

An issue joins a milestone only where the release or phase cannot close without
it; no milestone is the default. Never renumber or rename one — the title is the
handle every CLI and saved filter resolves it by. Give a due date only where the
work has a real one, never to force a position in a list. Close it when it is
done, never delete it, and re-triage the leftovers explicitly.
