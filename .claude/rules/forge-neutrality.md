---
paths:
  - "plugins/hcb-dev/**"
---

# hcb-dev — forge neutrality (authoring rule)

Guidance for editing this plugin's sources, loaded only while working under
`plugins/hcb-dev/`. It shapes how the plugin is *written*, not how it behaves
once installed — a rule in this repo never reaches the end user's session, so
anything the *user* must follow belongs in a `SKILL.md`, not here.

## Forge assumption

Work happens on **both GitHub and GitLab**, and on **self-hosted instances**
(GitHub Enterprise Server, self-managed GitLab) as much as on the SaaS ones.
Nothing in this plugin may assume a single forge or a single host.

- Never hardcode `github.com` / `gitlab.com`, and never identify the forge by
  hostname — a self-hosted instance answers on an arbitrary domain. Detect it
  from the remote plus what actually responds there (`gh auth status`,
  `glab auth status`, the API root).
- Self-hosted is feature-degraded: SaaS-only features may be missing (e.g.
  requesting a Copilot review via `gh pr edit --add-reviewer "@copilot"` is not
  supported on GHES). Name what is unavailable and continue — never let a
  missing SaaS feature stall a flow.

## Three ways to stay forge-neutral — pick the cheapest that fits

**1. Write it neutrally.** The default. When the guidance doesn't depend on the
forge, phrase it that way: "change request", "the review", "the required
checks", "the default branch". This covers the plugin's own metadata too —
`plugin.json` description, `README.md`, the marketplace entry: describe the
capability neutrally, name a forge only when listing the mirrors.

**2. Mirror the inline commands.** When otherwise-neutral guidance still needs a
concrete command, give **both**, adjacent and structurally identical — never
`gh` alone:

```bash
# GitHub
gh auth status && gh pr create --base <base> --fill
# GitLab
glab auth status && glab mr create --target-branch <base> --fill
```

The tool-detection ladder mirrors too: forge MCP server → CLI (`gh` / `glab`) →
REST API.

**3. Mirror the whole workflow.** When the procedure is so forge-specific that
neutral prose would lie (merge gates, rulesets vs. approval rules, Copilot vs.
Duo), split it into two mirrored skills instead of branching inside one:

- Name them `<forge>-<artifact>-workflow`: `github-pr-workflow` /
  `gitlab-mr-workflow`.
- Keep them **symmetric** — same steps, same headings, same order; only the
  forge mechanics differ.
- Each `description` routes explicitly ("on GitLab-hosted repos use
  `gitlab-mr-workflow` instead"), so the model can't pick the wrong twin.
- Cross-link them **both ways** in the body, near the top.
- Forge-independent parts (branch naming, severity classification, the final
  report format) live in one shared reference that both skills link by relative
  path — copy-paste drifts.

Editing a section that already leans one way — Actions pinning, Dependabot,
Copilot — means neutralising it or adding its mirror in the same change. Never
deepen one forge alone.

## Verify against the docs

Exact flags and endpoints get verified before they land in a skill — resolve,
never recall, same as `dependency-versions` demands of versions. Where to resolve
them, and what each forge calls the concept its counterpart names differently, is
[`../../plugins/hcb-dev/references/forge-docs.md`](../../plugins/hcb-dev/references/forge-docs.md).
It ships with the plugin rather than living here, so a skill that needs it links
it and reaches it at run time — this rule does not, and a skill that only relies
on the rule gets nothing.
