# The two completion backends

Read by whatever *executes* a slice's completion — `hcb-dev:shipping-workflow` and nothing
above it. [`slice-completion.md`](slice-completion.md) owns the contract both backends run
under: the inputs, the outputs, `merge-auth` and what outranks it, and the ladder that picks
the mode. This file is only what each mode does once the mode is settled.

## Backend: local — merge into the parent, no forge

Pure git; works with **no remote at all**, and writes to the network for nothing — no push, no
forge call. Publishing is the escalation offer below, and only by consent.

- **The name lands with the merge.** `--no-ff` writes the branch name into the parent's history
  for good, unlike a change request's branch. A slice arriving here still carrying an
  auto-generated name means step 0 was skipped: rename it first, the local half of
  [`branch-naming.md`](branch-naming.md) and nothing more, recording what it was renamed away
  from as `old-name`. A ref published under that name earlier **stays** — local mode removes
  nothing from a network — and the report names it as possibly standing.
- **The merge runs from wherever `parent` is checked out — find that first**, and chain the
  commands: unchained, a refused switch still lets the merge run on the slice and report
  success. `git merge` lands into whatever is checked out, which on arrival is the slice, and a
  parent checked out in another worktree makes `git switch` refuse outright.
  `git worktree list --porcelain` names the directory holding it, and `git -C <that dir> merge`
  lands the slice without moving anyone's HEAD. Only where no worktree holds it do you switch,
  merge, and switch back.
- **Merge strategy** — the gate's shown default: `--no-ff`, so the slice stays a visible,
  revertible boundary and a later whole-feature request keeps its slices reviewable. `ff` only
  where the caller asked and the history is linear; `squash` where the caller wants one commit,
  its message composed per [`merge-message.md`](merge-message.md) and committed with, never the
  one `git merge --squash` leaves staged.
- **Conflict** — resolve a trivial one yourself (whitespace, a lockfile, a generated file
  re-run); one needing a real decision is an architectural fork
  ([`architecture-decisions.md`](architecture-decisions.md)), so stop and ask rather than
  silently corrupting an earlier slice's work. Past trivial the resolution is code no reviewer
  has read and this backend does not review: abort the merge and hand back to
  `shipping-workflow` step 3, which lands on this same parent and puts what that took through
  the reviewers. A conflict surviving that round trip is `parent` moving under the run, not a
  round to repeat: stop and ask.
- **The default-branch hard-gate.** Merging into a **feature** branch is autonomous under an
  `on-green` and takes what anything stricter says. Merging into the **default branch** is not
  practically reversible and bypasses every gate a forge would enforce, so **stop and ask first,
  whatever `merge-auth` was passed.** Resolve the default offline ([`base-resolution.md`](base-resolution.md)); where
  you cannot — no remote, or a pointer that will not verify — do not assume the parent is a
  feature branch, ask.
- **After the merge, the offer** — offer, never force, to open a change request on the landed
  work. Accepting is the consented **exit** from local mode: it pushes `parent` and hands to the
  request backend with the set's `issues`, and the escalated request carries `merge-auth` `ask`
  addressed to whoever accepted — accepting authorizes the request, never the merge behind it.
  **One offer per run**: after a set it is made once on the whole feature, not once per slice.

## Backend: request — a change request, by forge

- **Detect the forge from the remote and what actually answers there — never from the
  hostname**, a self-hosted instance living on an arbitrary domain: `gh auth status` → GitHub,
  `glab auth status` → GitLab. Name what a self-hosted instance cannot do rather than stalling.
- **Dispatch** to the installed driver with `parent` as the base plus `merge-strategy`,
  `merge-auth`, `issues`, and `old-name` where step 0 renamed: GitHub →
  `hcb-dev:github-pr-workflow`; GitLab → `hcb-dev:gitlab-mr-workflow` once it exists (deferred —
  until then GitLab falls to the inline path below).
- **No driver installed** — normalize the name **first**
  ([`branch-naming.md`](branch-naming.md)): there is no driver Step 1 behind this path,
  and once the request is open the name is fixed, renaming meaning a deleted head ref and
  a closed request. Then push and open it inline, mirrored, with a body per
  [`merge-message.md`](merge-message.md) carrying the closing keywords `issues` names — a
  body filled from the commits carries none — and the labels
  [`label-lifecycle.md`](label-lifecycle.md) gives it:
  ```bash
  # Title, body and label names are files the agent wrote — data, never pasted into this line.
  T="<title file>"; B="<body file>"; A="<the file of label names — a JSON array — per label-lifecycle.md>"
  W="<plugin root>/scripts/label-write.mjs"
  # GitHub
  OUT="$(gh pr create --base <parent> --head <branch> --title "$(cat "$T")" --body-file "$B")"
  # GitLab
  OUT="$(glab mr create --target-branch <parent> --source-branch <branch> --title "$(cat "$T")" \
    --description "$(cat "$B")" --yes)"
  # Either: the request's URL out of what it printed, then its labels.
  printf '%s\n' "$OUT"; URL="$(printf '%s' "$OUT" | grep -oE 'https?://[^ ]+/(pull|merge_requests)/[0-9]+' | tail -n 1)"
  [ -n "$URL" ] && node "$W" --url "$URL" --add "$A"
  ```
  Any flag beyond these comes from [`forge-docs.md`](forge-docs.md), the installed CLI's
  `--help` first. A ref published under `old-name` stays here too — nothing on this path proves
  it this branch's — and the report names it as standing. **Opening it is all this path does —
  say so**: no fix loop is being driven and no merge, so nobody who asked to "ship it" assumes
  the change is on its way. An `on-green` or `queued` goes unspent for the same reason.
- **Merge authorization.** Pass `merge-auth`, value and addressee both, into the driver, where a
  threaded value **outranks** whatever the driver would otherwise read out of the words that
  started the run. Completion never invents an authorization it was not handed, nor upgrades one.
- **Merge strategy.** Pass it and let the driver filter it to the repo's allowed methods; which
  request it governs is the topology question below.
