# Where each label comes from, and who writes it

Read by whatever files, splits or takes up an issue, opens a change request, or closes an issue.
It owns when each label on an issue or a change request is written, from what, and on which
authority. The roles are [`classification.md`](classification.md)'s, the invocations
[`forge-docs.md`](forge-docs.md)'s.

**Every write here reads the set first** — once per run — **passes only names it just read**, and
reads back what landed ([`forge-behaviour.md`](forge-behaviour.md)). A value the work needs and
the set lacks is named in the report, never created ([`label-model.md`](label-model.md)).

## Filing and splitting

A leaf takes its kind of work, its outcome as forecast from its body, and its queue labels; a
parent, its kind of work and its queue labels alone. Splitting an issue into children moves its
outcome labels onto them in the same edit. Both are `hcb-dev:issue-tracking`'s writes, on its
answer.

## Taken into work

A parked reason comes off where it no longer holds, or where the answer taking the work settles
it — never on the taking alone. The answer that takes it off names it:

- **a build** — the planning gate of `hcb-dev:implementation-workflow` names each issue whose
  parked reason comes off, and its approval is the write;
- **a wave** — the wave plan's table names them, and the master takes each off as it hangs the
  issue under the wave, on the word that approved the plan ([`wave-issue.md`](wave-issue.md));
- **a batch** writes none: its master did.

An open blocker is an edge ([`issue-links.md`](issue-links.md)), never this label, and stays.

## A change request

**Only a request into the default branch carries labels** — the default resolved per
[`base-resolution.md`](base-resolution.md); a request into any other base carries none, which is
not out of line. It carries the kind of work and the outcome of **its own diff**: the component
from the files it changes — a generated file follows the change that regenerated it, an
incidental edit earns none, a test follows what it checks, documentation its subject — and the
subsystems, concerns and resources its result changes, the issues it settles being where the
reading starts rather than the answer. Never a queue label. Where the repository runs the kind of
work as a native type, a request carries no kind of work.

```bash
L="<a label name just read from the set>"   # one --label per name; none where the set gives none
# GitHub
gh pr create --base <base> --head <branch> --title "<title>" --body "<body>" --label "$L"
gh pr view <pr> --json labels
# GitLab
glab mr create --target-branch <base> --source-branch <branch> --title "<title>" \
  --description "<body>" --label "$L"
glab mr view <mr> -F json | jq '.labels'
```

**Re-derived with the body** ([`merge-message.md`](merge-message.md)) — before the merge, and after
every push that follows: `gh pr edit <pr> --add-label … --remove-label …`, `glab mr update <mr>
--label … --unlabel …`. A set with no kind-of-work or outcome family gives the request none, said
in one line of the report, and nothing is proposed.

## At close

**An issue a change settled** takes that change's kind of work and outcome in place of its
forecast: from a request settling it alone, the request's labels; from one settling several, the
part that settled each, split by the session that did the work; a slice's child, from its slice's
diff. Where that session cannot tell, the issue keeps what it carried and the report says so.
**Any close** takes the parked reason off and keeps the priority; an issue closed with no change
behind it — not planned, a duplicate — keeps everything else.

```bash
N="<the issue>"; ADD="<a name just read>"; DEL="<a name it carries>"
# GitHub
gh issue edit "$N" --add-label "$ADD" --remove-label "$DEL" && gh issue view "$N" --json labels
# GitLab
glab issue update "$N" --label "$ADD" --unlabel "$DEL" && glab issue view "$N" -F json | jq '.labels'
```

## On what authority

| write | rides on |
|---|---|
| a change request's labels, at open and re-derived | opening the request: they are part of it |
| an issue's labels at close | the close — the merge authorization where a keyword closes it, the go-ahead where it is closed explicitly |
| a parked reason taken off | the answer that took the work and named it |

Nothing else here is written without its own answer (`hcb-dev:issue-tracking`). Each write above
stands in the report's `## Without your word` with what undoes it
([`report-format.md`](report-format.md)). A merge nobody here issued — by hand, on the forge —
aligns nothing.

## Where the forge falls short

- **GitLab has no change-request driver**: a request opened there takes its labels at open, and
  nothing re-derives them or aligns its issues at close.
- **A server without hierarchy** tells no parent from a leaf: every issue there is read as a leaf,
  and the report says so.
