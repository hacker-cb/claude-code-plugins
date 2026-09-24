# A wave's issue — filing it, hanging its work under it, closing it

Read by the session coordinating an epic whenever a wave's plan is approved, an issue enters or
leaves a wave, or a wave closes. It owns the issue each wave has on the tracker and the edges that
hang work under it; what that issue's ledger holds is [`wave-ledger.md`](wave-ledger.md)'s, and
the labels and markers every epic's issue carries are [`epic-structure.md`](epic-structure.md)'s.

## Filing it

**On the word that approves the wave's plan**, and on that word alone — the role's authorization
covers its own structure as it covers the umbrella — the master files one issue for the wave
(`hcb-dev:issue-tracking`), before the first chip goes up:

- **title** `Wave <k> of epic #<epic>: <topic>`, in the tracker's language;
- **label** `wave`, read, created and applied as `epic-structure.md` says;
- **body** — the part of the approved plan that is this wave's: its batches, their file zones,
  the launch order, the gate that opens it, the base pin; then a `## Amendments` heading, each
  change to the plan a dated line under it. On a forge without hierarchy (below), the table of the
  issues it runs on too;
- **its parent** — the epic, hung as below;
- **its ledger** — opened on it at once (`wave-ledger.md`), and a line for it in the epic's header.

## Hanging an issue

Every issue the epic runs on hangs under the epic until a wave takes it, then under that wave, so
the forge counts it where the work is. **Read its parent first** — `p` on its line, per
[`issue-currency.md`](issue-currency.md), on GitLab the epic or wave among its `rel`, since a
related link is what it hangs by there — and a parent the token cannot see by the search
[`forge-behaviour.md`](forge-behaviour.md) names for it — since setting a parent moves an issue off
the one it has without a word. An issue under a parent outside the epic stays there and rides the
wave's table instead; one no wave has taken yet stays under the epic. Read the edges back once
they are written.

```bash
# From the epic's own checkout: the epic and its waves live there, the issue maybe elsewhere.
TO="<the epic or the wave, by number>"; FROM="<the one it hangs under now, read above, by number>"
N="<the issue — its URL where it lives in another repository>"
TO_URL="<TO's URL, where N is one: a bare number resolves in N's repository>"
# GitHub — a sub-issue; the parent set replaces the one it had
gh issue edit "$N" --parent "${TO_URL:-$TO}"
# GitLab — the issue named by its project's id and its number there: a related link from the new
# parent, then the old parent's link to it, matched by that number AND that project
P="<the id of the project the issue lives in>"; I="<its number in that project>"
glab api -X POST "projects/:fullpath/issues/$TO/links" -f target_project_id="$P" \
  -f target_issue_iid="$I" -f link_type=relates_to
LINK="$(glab api "projects/:fullpath/issues/$FROM/links" | jq -r --argjson i "$I" --argjson p "$P" \
  '.[] | select(.iid == $i and .project_id == $p) | .issue_link_id')"
[ -n "$LINK" ] && glab api -X DELETE "projects/:fullpath/issues/$FROM/links/$LINK"
```

**Where the forge carries no hierarchy** — a server older than the one
[`forge-docs.md`](forge-docs.md) names for parents — the wave's body keeps the table of its issues
and the label keeps the wave findable; nothing is hung, and `hcb-dev:status` counts from the table.

## Finding and counting them

`epics.mjs --epic` lists an epic's waves (`epic-structure.md`); where it answers
`hierarchy: false`, or a list not `complete`, the waves are the ones the epic's ledger header lists
as well.
The forge counts a parent's **direct** children only, and GitLab keeps no count at all, so the
epic's progress whole is added up: each wave's children, and the work no wave has taken — the
`rest` that same answer counts, in whichever repository it lives. What a closed child counts as is
[`forge-behaviour.md`](forge-behaviour.md)'s.

## Closing it

A wave closes once its round has: every batch of it ended, its returns accepted, its candidates
ruled (`hcb-dev:findings-pass`, reading the wave's ledger), its landings' checks read. Then, in
order: the wave's ledger takes its closing line; the wave's report goes on its issue as a comment
of its own, opening with `<!-- wave-close -->`; the issue is closed — the master's own structure,
closed on the role's authority; and the epic's body and header mark the wave closed.

```bash
N="<the wave>"; REASON="<completed | not planned>"   # not planned where the wave was called off whole
# GitHub
gh issue close "$N" --reason "$REASON"
# GitLab — no reason to give: the outcome stands in the closing comment
glab issue close "$N"
```

An issue the wave did not finish is hung back under the epic, or under the next wave, before the
wave closes — never left under a closed one.
