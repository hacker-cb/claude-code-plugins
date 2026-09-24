# An epic's shape — its labels, its title and body, how it closes, and its session group

Read by whatever files, labels, titles, closes or lists the epic a coordinating session runs.
It owns the shape that epic takes on the tracker and on the host — the two labels the plugin
brings, how the umbrella issue is titled and written, how it closes, and the group its
sessions share — so every epic is found the same way whichever session ran it. What its ledgers
hold is [`wave-ledger.md`](wave-ledger.md)'s, and each wave's issue — filed, hung, closed —
[`wave-issue.md`](wave-issue.md)'s.

## The labels

Two labels belong to the plugin's own process, spelled the same in every repository:

| label | colour | description | on |
|---|---|---|---|
| `epic` | `5319e7` | An epic run by a coordinating session: the issue its wave ledger hangs on | the umbrella issue — only one a ledger hangs on |
| `wave` | `c5def5` | One wave of an epic: its plan, its ledger and its batches' returns | each wave issue |

They are **not classification roles** ([`classification.md`](classification.md)): they say where
an issue stands in the coordination, never its kind of work, component or priority, and a reading
of a slice's roles, cardinality or tiers reads past them — **unless the repository's own set
already gives the name a role**. Then that label is read as the set reads it, and applying it is
a classification edit like any other, which goes to the user. The epic keeps the labels the
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
# GitHub — created only where the read answers 404; any other failure is unread, never absent
HOST="$(gh repo view --json url --jq '.url | split("/")[2]')"   # this checkout's, not gh's default
if ! out=$(gh api --hostname "$HOST" "repos/{owner}/{repo}/labels/$LABEL" 2>&1); then
  case "$out" in *"(HTTP 404)"*) gh label create "$LABEL" --color "$COLOUR" --description "$DESC" ;;
    *) echo "unread: $out"; false ;; esac
fi && gh issue edit "$N" --add-label "$LABEL"
# GitLab — the same
if ! out=$(glab api "projects/:fullpath/labels/$LABEL?include_ancestor_groups=true" 2>&1); then
  case "$out" in *"(HTTP 404)"*) glab label create --name "$LABEL" --color "#$COLOUR" --description "$DESC" ;;
    *) echo "unread: $out"; false ;; esac
fi && glab issue update "$N" --label "$LABEL"
```

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

A marker is the first line of the comment it marks, and a comment carrying one anywhere is read
as that marker's: no other text quotes one, and a comment is named by its link. The one text that
carries markers inside it is the ledger's own — its format line, its section openers and its
index of archives (`wave-ledger.md`).

| marker | opens |
|---|---|
| `<!-- wave-ledger -->` | a ledger, the epic's or a wave's; inside it, `<!-- wave-ledger-format: <n> -->` and each `<!-- wave-section: <name> -->` |
| `<!-- wave-journal-<n> -->` | an archive of the ledger; `<!-- wave-journal-kind: journal -->` its second line where `ledger.mjs` opened it |
| `<!-- wave-slice -->` | the graph of the slice's links a refresh leaves, rewritten whole each time |
| `<!-- wave-return <epic>/<id> -->` | a batch's return on its wave's issue, one per batch, a later word to it edited into it |
| `<!-- wave-close -->` | the closing comment of a wave or of the epic |

## What the epic learns

A fact about the forge or about this plugin, learned mid-epic, is proposed to the user as an issue
in the plugin's own tracker — the `repository` its manifest names — written with nothing of the
project in it, and filed through
`hcb-dev:issue-tracking` on the user's word. A fact about the project goes to the project's own documentation.
Either way the ledger keeps the rule in force and the link.

## Closing the epic

Once the ledger's closing line is written, the final report goes on the epic as a comment of its
own, opening with `<!-- wave-close -->`, and asks the user to close the issue — closed on their
word:

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

A master holding an epic without the `epic` label, or whose ledger header records no session
group — on assuming the role, after a restart, or once the plugin moved under it — brings it up
there and then: the labels as above, and the group, its name going into the header. A ledger in
format 1 is rebuilt later, at the point [`epic-migration.md`](epic-migration.md) names.

## Listing the open epics

[`../scripts/epics.mjs`](../scripts/epics.mjs) answers which epics are open — every issue carrying the label, across every
owner the account reaches rather than the one repository a session stands in:

```bash
node "<plugin root>/scripts/epics.mjs" [--forge gh|glab] [--host <host>] [--label <name>] \
  [--owner <owner>]... [--epic <n> [--repo <path>]] [--repo-dir <path>]
```

| field | what it settles |
|---|---|
| `read` | the forge answered to the end. `false` is unread, never "no epic open" |
| `forge` / `host` | which forge and host were asked — the checkout's own unless both were named |
| `epics[]` | one row per epic: `repo`, `number`, `title`, `url`, `updated`, and `children` where the forge counts sub-issues (`total`, `completed` — direct children only); `null` where it keeps no count |
| `count` / `complete` | how many epics are listed — one reached twice is listed once — and whether every query came back whole: `false` where a search stopped at its own cap or a walk came back short, `null` where the forge gave no count to check against |
| `waves[]` | with `--epic <n>`, the waves of that epic instead — in this checkout's repository or the one `--repo` names — its children carrying the label, `wave` unless another is named, open and closed: `number`, `title`, `url`, `state`, `reason` (GitHub's close reason), `children`; `count` and `complete` then answer for them |
| `reason` | why nothing could be listed |

Without `--owner` it lists what the account itself opened: GitHub's `author:@me` over every
owner, GitLab's `created_by_me`. Named owners widen it to any author there, one query each — on
GitHub an account, on GitLab a group with its subgroups. Archived projects are listed too.
