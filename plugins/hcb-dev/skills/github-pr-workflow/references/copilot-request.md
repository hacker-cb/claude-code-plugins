# A Copilot request of the driver's own

Read when [`copilot.md`](copilot.md) sends you here: the one case in which this driver asks
Copilot for a review itself, and how. Every other review it waits for was requested by the base's
rules or by someone else, and a fix, however large or risky, is read locally
([`copilot-findings.md`](copilot-findings.md), *What reads the fix*).

## When

**The pull request Copilot reviewed is no longer the one landing.** Bringing the body back to the
head ([`../../../references/merge-message.md`](../../../references/merge-message.md)) rewrote its
account of what the change does — its purpose, its approach, its scope — rather than correcting
what it describes wrongly: an owner's decision turned the approach, the scope was cut or grown,
the rule the change implements moved. The test is the change turning, never the text moving. A
renamed path, a stale count, a mechanism a fix replaced inside its own finding, a body inaccurate
the day it was written — each still describes the change Copilot read, and earns nothing.

These hold as well, each read off `copilot-state.mjs` rather than remembered:

- a Copilot review of an earlier head is in hand — where it never reviewed, there is nothing to
  ask again;
- no rule in force reviews pushes (`expects.onPush` false) — where one does, the push itself
  brings the head its review, and a request beside it is a duplicate;
- the pull request is open ready for review, and `verdict` is `unrequested` past the cutoff
  (`copilot.md`) — before it a request still registering reads as none, and where one stands
  the review it brings reads the head it posts on;
- the local review of the turn has settled (`copilot-findings.md`), and the head it settled on is
  pushed — a request placed before the push reviews the head behind it.

**One request per turn, not one per pull request.** Nothing else earns one: not a fix, not a
rebase, not a head the cutoff left unreviewed on its own, not an approval still outstanding, not
findings you would like more of.

## How

```bash
REPO="<owner/name>"; PR="<n>"
node "<plugin root>/scripts/copilot-state.mjs" --pr "$PR" --repo "$REPO"   # the reading before
# The login with its [bot] suffix: the bare login answers 422.
gh api --silent -X POST "repos/$REPO/pulls/$PR/requested_reviewers" \
  -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
```

**Confirm it on the timeline, never from the call.** The call answers alike whether it placed a
request or not, and the request list reads empty either way
([`../../../references/forge-behaviour.md`](../../../references/forge-behaviour.md)): re-read
`copilot-state.mjs` until it moves. `verdict` `waiting` is the request standing — the ordinary
wait from there (`copilot.md`, *Wait for the review of the CURRENT head*); `reviewed`, with the
head's own review in hand, is the request already answered — its findings are next
(`copilot-findings.md`). A reading still `unrequested` at the end of the first wait window placed
nothing: it is not placed twice — the addressee `merge-auth` names hears it.
