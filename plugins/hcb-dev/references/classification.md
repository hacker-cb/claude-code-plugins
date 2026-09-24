# Classifying an issue

Read by anything that classifies an issue against what the repository itself defines: the families
as **roles**, their cardinality, how each role's set is read, and how one is proposed where none
exists. The roles travel between repositories; every literal is read from the repository at hand.

## The roles

| role | cardinality | what it names |
|---|---|---|
| kind of work | exactly one | a capability that does not exist yet · shipped behaviour deviating from spec or intent, latent defects included · internal quality with no new capability. A parent takes its children's dominant kind |
| component | at least one | where the work lands — the ones whose directories the diff actually touches; docs follow their subject. Three or more is a signal to decompose, not to label harder |
| parked reason | at most one | the pending trigger that should reopen attention — a decision, an upstream release, a dependency of the project's own. **Absence means ready to pick up** |
| priority | at most one | how far up the queue the work is wanted, ordinal within the family. **Absence means normal** |
| security | optional flag | on top of whatever component applies |

A deliberately deferred defect keeps its kind of work — the deferral lives in the parked reason.
The plugin's own `epic` and `wave` labels: [`epic-structure.md`](epic-structure.md).

## Read the set before proposing or applying anything

Read it whole, the labels to the newest issues — a short read is indistinguishable from a missing
family. Once per run, before anything is proposed.

```bash
# GitHub — `gh api` asks its own default host, so the repository's goes in explicitly; the types
# answer `null` where there are none, whatever REST lists, and a milestone's counts include PRs.
HOST="$(gh repo view --json url --jq '.url | split("/")[2]')"   # this checkout's, not gh's default
gh label list --limit <n> --json name,color,description,isDefault
gh api --hostname "$HOST" graphql -F o=<owner> -F r=<repo> -f query='query($o:String!,$r:String!){
  repository(owner:$o,name:$r){issueTypes(first:100){nodes{name description}}}}'
gh api --hostname "$HOST" --paginate "repos/<owner>/<repo>/milestones?state=all&per_page=100"
gh issue list --state all --limit <n> --json number,title,labels,issueType,milestone
# GitLab — <project> is URL-encoded ("group%2Frepo"); never apply an archived label.
glab api --paginate "projects/<project>/labels?per_page=100"
glab api --paginate "projects/<project>/milestones?include_ancestors=true&per_page=100"
NEW="$(glab api "projects/<project>/issues?state=all&order_by=created_at&per_page=<n up to 100>")" \
  && jq -c '.[] | {iid, title, type, labels, milestone: .milestone.title}' <<<"$NEW"
```

Map the roles onto the prefixes that set already uses, reading the descriptions and not only the
names. Where a family is ordinal, its order comes from what the descriptions and the values mean,
never from the order the names sort in; a colour ramp corroborates an order rather than
establishing one. Where nothing settles which end is which, the order is unresolved — say so, and
compare nothing by it.

**Never pass a name you did not just read**, and confirm what came back rather than the exit
status — what each forge does with an unread name is [`forge-behaviour.md`](forge-behaviour.md)'s.

## Resolve the mechanism — first hit wins

Availability carries nothing: a native field expresses a role here only where this repository's
issues carry it in one, or where it was adopted for them. Resolve role by role.

1. **What the user adopted** — the mechanism named by an explicit word of the user's, or by a
   rule of the project's own: the field, the family, or both. It stands whatever the issues
   carry, and it is the only thing that adopts a field nothing carries yet. A word given in
   conversation holds for that session; ask for it in the project's own rules to outlive one.
2. **What the newest issues carry** — the newest-first list above, read for what each role is
   carried in: a native field's value that names the role (the type an issue carries merely by being
   an issue names none), a label from a family, or both. What they carry it in **as a rule** is what
   carries it here — the field alone with nothing labelled for it; the family alone; or both, one
   value in each, and say the repository runs that role two ways. What only a few carry decides
   nothing, and a reading where neither is plainly the rule adopts no field at all: it falls to the
   rungs below, which is what keeps a doubt from moving the repository onto one.
3. **A label family the set declares** — where the newest issues carry it as a rule in neither.
4. **Neither** — apply what exists, and name the roles this repository has no vocabulary for, never
   inventing one silently. An available native field is not vocabulary until rung 1 adopts it; until
   then it is offered where a set is proposed below rather than applied for being there.

What each forge's native type field is, and what its definitions endpoint does and does not prove,
are `forge-behaviour.md`'s; [`forge-docs.md`](forge-docs.md) has the entry points — a GitLab type
configured on the group among them, which only GraphQL carries. What this file adds: a field whose
values nothing available can read is **not** a field the issues carry nothing in — say so and leave
the role unresolved, rather than settle it a rung down on evidence nobody could read.

Reading one issue, the role is what that issue carries it in, whatever the repository runs: where
field and label disagree the role is unresolved there — say so rather than pick one.

**Hold the cardinality yourself wherever the platform will not** — what either forge enforces is
`forge-behaviour.md`'s, and neither is enough. Before adding from a single-value family: read the
issue's current labels, drop the sibling, then add. Where the repository has a triage-state
family, apply the value meaning untriaged, never the one meaning a human accepted it.

## An issue out of line

One carrying a role outside the mechanism resolved above — a native field nobody adopted, a
family the repository has moved off — one carrying it in a mechanism that resolution names but
not in another it names as well, and one carrying two contradicting values. An issue carrying the
role nowhere is not out of line but unclassified. Align it to a single value, carried in every
mechanism resolution names and in none it does not: added where missing, cleared where it stands
outside them, and put in place of a value that contradicts it. Which value that is, is the user's
wherever the two disagree. It is a tracker edit — proposed, and made only on the answer that
authorizes one (`hcb-dev:issue-tracking`), never as a side effect of classifying something else.

## Proposing a set the repository does not have

Only where a role has no vocabulary and this issue needs it.

1. **Strike off what the platform already carries** — the native fields the repository runs a
   role in, and anything the tracker models as a field of its own: assignee, milestone or
   iteration, open/closed state and its reason.
2. **Propose only the roles this issue needs**, in order: the kind of work, the component it
   lands in, then a parked reason or the security flag where either is true. A priority family
   only where the user asks for one.
3. **Derive the values from the project's own vocabulary** — kind from the commit types or
   changelog headings it already writes, component from its real modules and directories. Never
   from a set carried in from elsewhere.
4. **One proposal, one approval.** Each row: the name, a colour, and a one-line description
   saying *when* to apply it. In the same message name the roles the native fields carry, the
   roles nothing enforces here, and any role left unexpressed — and where an available field
   could carry a role being proposed for, name it as the alternative: taking it is the word that
   adopts it, and silence is never that word. The approval covers that batch and nothing later.
5. **Create it in the forge's own spelling** — six hex digits, bare on GitHub and `#`-led on
   GitLab, and always explicit: an omitted colour is chosen at random.

Never create a label that duplicates a native field the repository runs that role in, a variant
spelling of one the forge's own tooling matches by exact string, a component that does not exist
yet, or anything as a side effect of applying a label. **Never delete or rename** — propose
either and let the user run it.

## Naming and colour

One prefix per role, in the separator the set already uses, uniform across it — the prefix is
what automation and permission wildcards key off, and where scoped labels are available `::` is
the separator the platform reads. One hue per family, a ramp where the family is ordinal; colour
is a scanning aid on top of the name, never the only thing carrying a distinction. Fill the
description on every label you propose: the mapping above reads descriptions, so an undescribed
label is invisible to the next run.

## Milestones — optional

An issue carries at most one milestone — an ancestor group's space is a wider vocabulary, not a
second slot — so the repository runs **one** of two patterns. **Release**: the milestone is a version and
closes when that version ships, its shape taken from where the repository already writes one —
tags, manifest, changelog — never from a shape you bring. **Phase**: the milestone
is a body of work with an exit criterion in its description, closing when the criterion holds,
named `M<nnn>: <phase>` in three digits numbered by tens (`M010`, `M020`) so a phase discovered
later takes a free number between its neighbours.

Which is in force: whatever the existing milestones are named for; where there are none, a
repository that publishes versioned releases takes **release** and one that publishes none takes
**phase**. Whichever dimension is left over goes to a label family, and a version already shipped
needs no grouping. Either pattern may hold one milestone meaning *in no release*. Never run a phase
ladder beside releases: an issue would be in a phase and slated for a version at once, in one slot.

An issue joins a milestone only where the release or phase cannot close without it; no milestone
is the default. Never renumber or rename one — the title is the handle every CLI and saved filter
resolves it by. Give a due date only where the work has a real one. Close it when it is done,
never delete it, and re-triage the leftovers explicitly.
