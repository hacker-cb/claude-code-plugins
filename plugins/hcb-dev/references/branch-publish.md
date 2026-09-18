# Renaming a branch, and putting it on a remote

Read by whatever renames a branch or publishes one — `hcb-dev:shipping-workflow` step 0 and the
change-request driver's first step. [`branch-naming.md`](branch-naming.md) owns what a name
should be; this owns the act of taking one on and the old one off.

`scripts/branch-publish.mjs` answers one question and acts on it: **what name does this
branch ship under, is that name on the remote, and what of the names it used to carry
comes off**. Unlike the scripts beside it this one acts, and the ORDER it acts in is the
whole hazard — a rename is refused wherever a change request pins a name, the publish is
unconditional, and a name comes off the remote only after the new one is up.

```text
node "<plugin root>/scripts/branch-publish.mjs" --new <name> [--old-name <name>]
  [--publish --push-remote <name>] [--base <name> --base-remote <name>]
  [--push-timeout <seconds>] [--settle <seconds>]
```

`--publish` is opt-in rather than inferred from a
remote being named: a caller that forgot it would otherwise get a silent no-op where the push is
the whole point. `--push-timeout` bounds each push — the publication and every deletion, each of
which runs the repository's pre-push hook — and `--settle` is how long the remote is read again
after one that gave no verdict, so a run can spend both once per push. With `--publish`, run the
call with the Bash tool's `timeout` at its ceiling, and detached where those budgets, taken per
push, add up past it: a call outlasting the tool's limit comes back without its answer.

| field | what it settles |
|---|---|
| `read` | `false` renamed nothing and published nothing — a detached HEAD is the case |
| `branch.ships` | **the name it actually ships under**, which is not always the one asked for |
| `renamed` / `restored` | whether the rename happened, and whether it was *undone* — a request heading the name a caller renamed away pins that name |
| `published` | what a **read of the remote** showed: `true` it carries `ships` at this branch's tip and the checkout tracks it; `false` it does not, a refusal among the ways; `null` with `publish.asked` true, **nothing settled it** — below. `null` with `asked` false is "not asked", never refused |
| `publish.mode` | `first`, `fast-forward` or `leased` — which push the remote's state owed |
| `publish.reason` | why `published` is not a plain `true` — and, for a `true` the push itself never reported, how the read settled it |
| `stale[].verdict` | per name it used to carry: `retired` taken off this run, `absent` not there, `kept` with the `reason` the report carries, `unknown` a deletion no read settled — possibly standing, possibly gone |
| `ran` | **every call that changed something**, in the order it was made — the rename, the fetches, the publish, a name taken off the remote. The proofs behind each are reads and stay out, so an empty `ran` is a run that read its state and touched none of it |
| `notes` | why the name it ships under is not the one asked for |

**An unsettled publication is neither a refusal nor a publication.** `null` with `asked` true is a
push that ended without a verdict — not waited out, or stopped by an error rather than refused —
or one the remote could not be read after, or one sent to several push urls, which no single read
settles; its `reason` quotes the last line git got to. Re-run the same call: the answer is read off
the remote, so a ref that landed in the meantime comes back `true` whether or not the new push is
waited out. Where that last line is the repository's own pre-push hook rather than git's transfer,
raise `--push-timeout` past what the hook takes, since every re-run runs the hook again; where it is
an error no re-run changes — access refused, a url that does not resolve — report it instead.

**A proof that cannot run keeps the ref.** Five have to hold before a name comes off the remote —
no open change request heads it (deleting a head ref closes the request along with its review),
no other worktree stands on it, the remote answered and the ref is there, its tip is one this
branch stood on, and it holds something past the base — and the script owns all five. **The base
itself is refused by name, not by that last proof**: pushing to a fork while basing on the
upstream inverts it, the fork's own base legitimately holding what the upstream has not.

**The request probe runs only where something is published**, because that is where a ref can be
destroyed — a rename alone strands nothing, so a local normalization makes no network call at
all. The probe speaks `gh`; on GitLab it cannot answer, so a publication there keeps every name
until the same reading is done by hand.

- **Never `git branch -M`.** The force form silently overwrites an existing branch of that name.
  On a collision pick a different name.
- **Resolve the push remote before renaming** — `remotes.push` in
  [`base-resolution.md`](base-resolution.md): `branch.<name>.pushRemote` is read under the name
  the branch carries now, and an ambiguity that exits after the rename leaves a branch renamed
  locally and nothing pushed.
- Where the rename and the publication happen in different steps, the old name travels between
  them as `old-name` ([`slice-completion.md`](slice-completion.md)).
