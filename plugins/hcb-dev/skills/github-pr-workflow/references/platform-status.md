# Is the platform down? — attribution, the wait, the resume

Read when a check is red, stuck, or missing and the cause is not plainly in the
diff. It answers one question — whether the failure is the forge's rather than
yours — and, once it is, how to wait it out and what to put back afterwards.

## Attribute it from the feed, never from the failure's shape

The tell that a failure is not yours: it touches nothing you changed, or it lands
on runs and repositories your branch never went near. That is a reason to look, not
a verdict. Read the **component** covering whatever is actually blocked — CI, the
API you are calling, the change requests themselves:

```bash
# Timeouts on every fetch of this feed: the network is part of what an outage
# takes down, and a hung curl is a stall where a verdict was the whole point.
curl -fsS --connect-timeout 10 --max-time 30 \
    https://www.githubstatus.com/api/v2/summary.json | jq -r '
  (.components[] | select(.status != "operational") | "component  \(.name): \(.status)"),
  (.incidents[]  | "incident   \(.name) — \(.status)")'
```

A self-hosted instance is **not** on that page — it is a separate deployment, and
its health lives wherever its operator publishes it. Where nothing publishes it,
say the failure could not be attributed and put the wait to the user rather than
reading a verdict off the failure's shape.

## The wait

Say in one line which component is down and which step is parked on it. Then
re-check every half hour **from a detached job**, never in the foreground — the
loop sleeps half an hour per pass, and running it in front parks the very session
it exists to keep usable.

```bash
COMPONENT="<the component that is down, spelled as the feed spells it>"
while :; do
  # Three outcomes, not two. A failed fetch and a body that is not JSON are both
  # "could not determine", which retries; an empty status out of a feed that DID
  # parse is a name matching no component, and sleeping on that waits forever.
  if ! feed="$(curl -fsS --connect-timeout 10 --max-time 30 \
        https://www.githubstatus.com/api/v2/components.json)" \
     || ! status="$(jq -r --arg c "$COMPONENT" \
        '.components[] | select(.name==$c) | .status' <<<"$feed" 2>/dev/null)"; then
    echo "FEED UNREADABLE — cannot attribute anything; retrying"
  else
    [ -n "$status" ] || { echo "NO COMPONENT NAMED $COMPONENT — take the name from the feed"; exit 1; }
    [ "$status" = operational ] && break
  fi
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
