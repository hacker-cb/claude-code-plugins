# The model set of label families

Read wherever a label set is proposed — a repository with none, or one lacking a role the work
needs — and wherever a label is renamed or deleted. A rework of the whole set, and the relabelling
that comes with it, runs through `hcb-dev:label-taxonomy`. It owns the families this plugin
proposes, how they are spelled, where their values come from, and how a label leaves a set. What
each role means, and how a set already there is read, is
[`classification.md`](classification.md)'s; when each label is written is
[`label-lifecycle.md`](label-lifecycle.md)'s.

## The families

The starting point of a proposal, never a list to apply: a label is applied only under the name
the repository's own set answered with (`classification.md`).

| family | role | colour | values |
|---|---|---|---|
| `type:` | kind of work | `bug` `d73a4a` · `feature` `0e8a16` · `tech-debt` `fbca04` | these three, the role's own |
| `scope:` | component | `1d76db` | the project's modules and parts of the tree |
| `area:` | subsystem — only where the project has a second axis | `c5def5` | the project's subsystems |
| `concern:` | concern | `5319e7` | the project's |
| `resource:` | resource | `0b7285` | the project's |
| `awaits:` | parked reason | `d4c5f9` | `design`, `upstream`; `internal` only where the forge carries no dependency link ([`issue-links.md`](issue-links.md)); others the project's |
| `priority:` | priority | `high` `e11d21` · `low` `c2e0c6` | these two; no label means normal |

- **The separator is `:`**, or the one the set already uses, uniform across it. On GitLab a family holding one value per carrier —
  `type`, `awaits`, `priority` — may take `::` where the tier makes the platform keep it so
  ([`forge-behaviour.md`](forge-behaviour.md)); a family holding several never does.
- **Colour is a scanning aid on top of the name**, never the only thing carrying a distinction: a
  family whose values are peers shares one hue, `type` and `priority` colour each value by what it
  signals, and a hue a label in the set already wears for another meaning — the plugin's `epic` and
  `wave` included — is not proposed.
- **The description reads `<Family>: <when to apply> — <examples>`** and fits the forge's limit
  ([`forge-docs.md`](forge-docs.md)). A rule that will not fit its description is a label too
  fine to be applied alike: split it, or drop it.
- **A set carrying a role under a prefix of its own keeps it.** Moving it onto these families is
  proposed only where the whole set is being reworked, and done on the user's word.

## Where the values come from

- **The project.** Kinds of work from the commit types or changelog headings it writes;
  components from its real modules and directories — one that exists, or has a milestone of its
  own; subsystems, concerns and resources from what its issues are about.
- **A set the user names as the model** — another repository of theirs — may seed them. Each
  value still has to be one this project's issues carry.
- **A candidate concern or resource is a question to the issues** — a property of the result, or
  a budget, they keep coming back to — and enters only where they carry it.

## Proposing a set the repository does not have

Only where a role has no vocabulary and the work in hand needs it.

1. **Strike off what the platform already carries** — the native fields the repository runs a
   role in, and anything the tracker models as a field of its own: assignee, milestone or
   iteration, open/closed state and its reason.
2. **Propose only the roles the work needs**, in order: the kind of work, the component it lands
   in, then a parked reason, a concern or a resource where one is true. A priority family only
   where the user asks for one.
3. **Take the values** as the section above says.
4. **One proposal, one approval.** Each row: the name, a colour, and the description. In the same
   message name the roles the native fields carry, the roles nothing enforces here, and any role
   left unexpressed — and where an available field could carry a role being proposed for, name it
   as the alternative: taking it is the word that adopts it, and silence is never that word. The
   approval covers that batch and nothing later.
5. **Create it in the forge's own spelling** — six hex digits, bare on GitHub and `#`-led on
   GitLab, and always explicit: an omitted colour is chosen at random.

Never create a label that duplicates a native field the repository runs that role in, a variant
spelling of one the forge's own tooling matches by exact string, a component that neither exists
nor has a milestone, or anything as a side effect of applying a label.

## Renaming and deleting

Only on the user's explicit word, naming the labels:

- **Snapshot first** — the set, and every carrier: issues, change requests and discussions, in
  every state. A listing that reads some kinds of carrier and not others — GitLab's incidents
  beside its issues — leaves the rest unread, and a deletion standing on it goes to the user
  saying so.
- **Find what names it** — workflow conditions, labeler and release configuration, permission
  wildcards — by searching the default branch, and change it with the rename or deletion.
- **Rename rather than delete and create** — what a rename carries is `forge-behaviour.md`'s.
- **Delete last**, and only a label no carrier holds beyond the ones the approved plan relabels;
  a carrier found outside the plan stops the deletion.
- **A label a GitLab group passes down** is the group's: a rename or deletion from the project is
  refused. The plugin's own `epic` and `wave` are [`epic-structure.md`](epic-structure.md)'s.
- **Read back** the set and the carriers once written.

The invocations are `forge-docs.md`'s.

## The project's own documentation

Nothing by default: the set on the forge is the list. Where a project already documents its
labels, that text holds the concept — which roles its families carry, and where it departs from
this file — never the values, colours or paths the set itself carries.
