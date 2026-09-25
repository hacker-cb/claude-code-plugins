# Classifying issues and change requests

Read by anything that classifies an issue or a change request against what the repository itself
defines: the families as **roles** in three layers, how many of each a carrier takes, and how
each role's set is read. The roles travel between repositories; every literal is read from the
repository at hand, the model set [`label-model.md`](label-model.md) proposes included.
Setting up or reworking the whole set is `hcb-dev:label-taxonomy`'s.

## The roles

| role | layer | leaf issue | parent issue | change request that carries labels | what it names |
|---|---|---|---|---|---|
| kind of work | goal | exactly one | exactly one — its children's dominant kind | exactly one, unless the kind is a native type | a capability that does not exist yet · shipped behaviour deviating from spec or intent, latent defects included · internal quality with no new capability |
| component | outcome | at least one | none | at least one | where the work lands — the parts of the tree its diff changes; docs follow their subject. Three or more on a leaf is a signal to decompose, not to label harder |
| subsystem | outcome | any | none | any | a second axis where the project has one: the subsystem the result belongs to, judged where the component is derived |
| concern | outcome | any | none | any | a property of the result across components — security among them |
| resource | outcome | any | none | any | a budget the result changes: its use, its peak, what happens when it runs out |
| parked reason | queue | at most one, while open | at most one, while open | none | the pending trigger that should reopen attention — a decision, an upstream release, a dependency the tracker cannot link ([`issue-links.md`](issue-links.md)). **Absence means ready to pick up**, unless an open blocker holds it |
| priority | queue | at most one | at most one | none | how far up the queue the work is wanted, ordinal within the family. **Absence means normal** |

**A label goes by what the result changes, never by what the text mentions**; in doubt, none. A
parent is an issue with sub-issues. A deliberately deferred defect keeps its kind of work — the
deferral lives in the parked reason. When each label is written, from what, on which authority,
and which change requests carry any, is [`label-lifecycle.md`](label-lifecycle.md)'s.

Outside the roles, and read past: labels a tool applies to its own requests, the plugin's own
`epic` and `wave` ([`epic-structure.md`](epic-structure.md)), and a single label no role claims.
An issue carrying `wave`, where the set gives that name no role, is outside them altogether.

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
   then it is offered where a set is proposed (`label-model.md`) rather than applied for being there.

What each forge's native type field is, and what its definitions endpoint does and does not prove,
are `forge-behaviour.md`'s; [`forge-docs.md`](forge-docs.md) has the entry points — a GitLab type
configured on the group among them, which only GraphQL carries. What this file adds: a field whose
values nothing available can read is **not** a field the issues carry nothing in — say so and leave
the role unresolved, rather than settle it a rung down on evidence nobody could read.

Reading one issue, the role is what that issue carries it in, whatever the repository runs: where
field and label disagree the role is unresolved there — say so rather than pick one.

**Hold the cardinality yourself wherever the platform will not** — what either forge enforces is
`forge-behaviour.md`'s, and neither is enough. Adding from a single-value family, the sibling the
carrier holds goes in the same write's removals (`label-lifecycle.md`); a family holding several
drops nothing. Where the repository has a triage-state family, apply the value meaning untriaged,
never the one meaning a human accepted it.

## A carrier out of line

One carrying a role outside the mechanism resolved above — a native field nobody adopted, a family
the repository has moved off — one carrying it in a mechanism that resolution names but not in
another it names as well, one carrying two contradicting values, and one carrying a role its column
in the table above gives none: a parent with an outcome label, a closed issue still parked, a change
request with a queue label. One carrying a role nowhere is not out of line but unclassified. Align
it to the values its role allows — one, for a single-value role — carried in every mechanism
resolution names and in none it does not: added where missing, cleared where it stands outside them,
and put in place of a value that contradicts it — or, for a role its column gives none, cleared.
Which value that is, is the user's wherever the two disagree; the last case is the carrier's own,
the same value elsewhere not out of line with it. It is a tracker edit — proposed, and made only on
the answer that authorizes one (`hcb-dev:issue-tracking`), never as a side effect of classifying
something else, save the writes `label-lifecycle.md` names.

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
