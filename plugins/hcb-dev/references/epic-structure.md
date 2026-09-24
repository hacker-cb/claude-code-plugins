# An epic's shape — its labels, its title and body, how it closes, and its session group

Read by whatever files, labels, titles, closes or lists the epic a coordinating session runs.
It owns the shape that epic takes on the tracker and on the host — the two labels the plugin
brings, how the umbrella issue is titled and written, how it closes, and the group its
sessions share — so every epic is found the same way whichever session ran it. What the
ledger on it holds is [`wave-ledger.md`](wave-ledger.md)'s.

## The labels

Two labels belong to the plugin's own process, spelled the same in every repository:

| label | colour | description | on |
|---|---|---|---|
| `epic` | `5319e7` | An epic run by a coordinating session: the issue its wave ledger hangs on | the umbrella issue — only one a ledger hangs on |
| `wave` | `c5def5` | One wave of an epic: its plan, its ledger and its batches' returns | each wave issue |

They are **not classification roles** ([`classification.md`](classification.md)): they say where
an issue stands in the coordination, never its kind of work, component or priority, and a reading
of a slice's roles, cardinality or tiers reads past them — unless the repository's own set already
gives the name a role. The epic keeps the labels the
repository classifies it by; a wave issue carries `wave` alone.

**The role assignment authorizes them**, as it authorizes filing the umbrella: the master
creates either label where the repository lacks it and applies `epic` to its own epic and
`wave` to its own waves — nothing wider. Renaming or deleting one stays the user's.

**Read the name, create it, then apply it** — never apply a name first
([`forge-behaviour.md`](forge-behaviour.md)). A label of that name already in the set — on GitLab
one the group passes down counts — is the label, whatever colour it has.

```bash
# From a checkout of the epic's own repository, as every command here.
LABEL="<epic | wave>"; COLOUR="<its colour>"; DESC="<its description>"; N="<the issue>"
# GitHub — read; a 404 is the label absent, and only then is it created
HOST="$(gh repo view --json url --jq '.url | split("/")[2]')"   # this checkout's, not gh's default
gh api --hostname "$HOST" "repos/{owner}/{repo}/labels/$LABEL" --jq .name
gh label create "$LABEL" --color "$COLOUR" --description "$DESC"
gh issue edit "$N" --add-label "$LABEL"
# GitLab — the same three steps
glab api "projects/:fullpath/labels/$LABEL?include_ancestor_groups=true"
glab label create --name "$LABEL" --color "#$COLOUR" --description "$DESC"
glab issue update "$N" --label "$LABEL"
```

A read that failed for any reason but a 404 is unread, not absent — read it again rather than
create a second label beside the one it could not see.

## The title and the body

The umbrella is titled `Epic: <topic>`, the word `Epic` written in the tracker's language — the
topic is the master's own ([`session-naming.md`](session-naming.md)). Its body is written for
people and kept current by the master at every wave's opening and closing:

```text
## Goal      two or three sentences: what is true once the epic is done
## Slice     what the epic runs on — a milestone, a label, a list — and what it leaves out
## Waves     one row per wave: the wave, its issue once waves have one, its state, its dates
## Outcome   written when the epic closes
```

Headings in the tracker's language too. The body carries no working state — that is the
ledger's — and nothing the forge already counts.

## Markers

A marker — `<!-- wave-ledger -->`, `<!-- wave-close -->` and the rest — is the first line of the
comment it marks, and the only other place one is written is the ledger's own index of its
archives ([`wave-ledger.md`](wave-ledger.md)): no other text quotes one, and a comment is named by
its link. A comment carrying a marker is read as that marker's, whatever it meant.

## Closing the epic

Once the ledger's closing line is written, the final report goes on the epic as a comment of its
own, opening with `<!-- wave-close -->`, and then the issue closes:

```bash
N="<the epic>"; REASON="<completed | not planned>"
# GitHub — `not planned` where the epic was called off rather than met
gh issue close "$N" --reason "$REASON"
# GitLab — no reason to give: the outcome stands in the closing comment
glab issue close "$N"
```

## The session group

Where the host offers sidebar groups — the desktop app's Code tab — an epic's sessions share one,
named `<owner>/<repository> #<epic> — <topic>`, and the ledger header
records that name:

- **The master** lists the groups, takes the one of exactly that name where it stands, creates
  it where it does not, and files itself into it (`list_groups`, `create_group`,
  `move_sessions` with `self`).
- **A batch** files itself into the group its order names (`list_groups`, `move_sessions` with
  `self`) — never another session, and never a group of its own making.
- **At the epic's close** the master offers the user to delete the group or keep it; it is
  deleted only on their word.

## An epic in an older shape

A master holding an epic without the `epic` label — on assuming the role, after a restart, or
once the plugin moved under it — creates and applies the labels there and then, and takes the
session group, its name going into the ledger header.

## Listing the open epics

`scripts/epics.mjs` answers which epics are open — every issue carrying the label, across every
owner the account reaches rather than the one repository a session stands in:

```bash
node "<plugin root>/scripts/epics.mjs" [--forge gh|glab] [--host <host>] [--label <name>] \
  [--owner <owner>]... [--repo-dir <path>]
```

| field | what it settles |
|---|---|
| `read` | the forge answered to the end. `false` is unread, never "no epic open" |
| `forge` / `host` | which forge and host were asked — the checkout's own unless both were named |
| `epics[]` | one row per epic: `repo`, `number`, `title`, `url`, `updated`, and `children` where the forge counts sub-issues (`total`, `completed` — direct children only); `null` where it keeps no count |
| `count` / `complete` | how many epics are listed — one reached twice is listed once — and whether every query came back whole: `false` where a search stopped at its own cap or a walk came back short, `null` where the forge gave no count to check against |
| `reason` | why nothing could be listed |

Without `--owner` it lists what the account itself opened: GitHub's `author:@me` over every
owner, GitLab's `created_by_me`. Named owners widen it to any author there, one query each — on
GitHub an account, on GitLab a group with its subgroups. Archived projects are listed too.
