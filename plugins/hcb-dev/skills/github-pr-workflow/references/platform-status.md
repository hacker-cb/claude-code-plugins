# Is the platform down? — attribution, the wait, the resume

Read when a check is red, stuck, or missing and the cause is not plainly in the
diff. It answers one question — whether the failure is the forge's rather than
yours — and, once it is, how to wait it out and what to put back afterwards.

## Attribute it from the feed, never from the failure's shape

The tell that a failure is not yours: it touches nothing you changed, or it lands
on runs and repositories your branch never went near. That is a reason to look, not
a verdict. **`scripts/platform-status.mjs` reads the feed and answers with its exit
code**, because what asks is a loop. Unnamed it reports everything that is not
operational, which is the attribution; named it answers about one component, which is
the wait:

```text
node <plugin root>/scripts/platform-status.mjs --feed <url>
  [--component <name> | --component-id <id>] [--timeout <seconds>]
```

| code | what it found | what the caller does |
|---|---|---|
| `0` | the named component is up — or, with none named, nothing is down and nothing is open | resume the parked step |
| `3` | degraded: a component down, an incident open, or maintenance running | wait and ask again |
| `4` | the feed was not reached — no answer, a timeout, or any HTTP status outside 2xx | wait and ask again. **Unread is not operational**, and a loop reading it as one resumes into the outage |
| `2` | a call it cannot answer — a 2xx body that is not a feed, a document in neither shape it reads, a component name matching none or several | **stop.** Each of these answers the same however long anyone waits |

**`--feed` carries the whole url and has no default.** Which url that is per forge is
[`../../../references/forge-behaviour.md`](../../../references/forge-behaviour.md) —
measured, and the two are not one shape, so a path built from a base is wrong for one of
them. A host written into the plugin would be identifying a forge by its hostname, which
[`../../../references/invariants.md`](../../../references/invariants.md) does not do.

**A self-hosted instance is on nobody's page** — it is a separate deployment, and its
health lives wherever its operator publishes it. Where nothing publishes it there is no
url to pass: say the failure could not be attributed and put the wait to the user, rather
than reading a verdict off the failure's shape.

**A name resolving to two components resolves to neither.** The script refuses instead of
taking the first, and `--component-id` is what settles it: a tie broken silently parks the
caller on whichever the feed happened to list first, under the name of the other.

## The wait

Say in one line which component is down and which step is parked on it. Then re-check
every half hour **from a detached job**, never in the foreground — the loop sleeps half an
hour per pass, and running it in front parks the very session it exists to keep usable.

```bash
FEED="<the url for this forge, per forge-behaviour.md>"
COMPONENT="<the component, spelled as the feed spells it>"
while :; do
  node "<plugin root>/scripts/platform-status.mjs" --feed "$FEED" --component "$COMPONENT"
  code=$?
  [ "$code" = 0 ] && break
  [ "$code" = 2 ] && { echo "the feed cannot answer this — read what it printed"; exit 1; }
  sleep 1800
done
echo "$COMPONENT is back — resume the parked step"
```

## The resume

Once it clears, put back what the outage took, then resume at the step you parked
on. A run that *failed* reruns — `gh run rerun --failed <run-id>`. A run that
**never started** has no event left to replay and no amount of polling produces
one: trigger it again (`gh workflow run` where the workflow is dispatchable, a
push, or reopening the PR), and confirm the check reports against the current
head. A check still red on a healthy platform is yours again.
