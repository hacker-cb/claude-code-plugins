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
node <plugin root>/scripts/branch-publish.mjs --new <name> [--old-name <name>]
  [--publish --push-remote <name>] [--base <name> --base-remote <name>]
```

**Every skill that renames writes that command itself**, the plugin root being substituted in
skill content and staying literal text here. `--publish` is opt-in rather than inferred from a
remote being named: a caller that forgot it would otherwise get a silent no-op where the push is
the whole point.

| field | what it settles |
|---|---|
| `read` | `false` renamed nothing and published nothing — a detached HEAD is the case |
| `branch.ships` | **the name it actually ships under**, which is not always the one asked for |
| `renamed` / `restored` | whether the rename happened, and whether it was *undone* — a request heading the name a caller renamed away pins that name |
| `published` | `true` on the remote under `ships`; **`null` is "not asked", never refused** |
| `publish.mode` | `first`, `fast-forward` or `leased` — which push the remote's state owed |
| `publish.reason` | why not, where `published` is `false` |
| `stale[].verdict` | per name it used to carry: `retired` taken off this run, `absent` not there, `kept` with the `reason` the report carries |
| `ran` | **every call that changed something**, in the order it was made — the rename, the fetches, the publish, a name taken off the remote. The proofs behind each are reads and stay out, so an empty `ran` is a run that read its state and touched none of it |
| `notes` | why the name it ships under is not the one asked for |

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
