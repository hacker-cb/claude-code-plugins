# Keeping Dependabot in sync with what the repo uses

Read by `hcb-dev:dependency-versions` on a GitHub-hosted repo, after a manifest
changed or when the user asks about automated updates.

Resolving from the registry fixes a version *today*; Dependabot keeps it
current *afterwards* with automated update PRs. On a GitHub-hosted repo,
whenever you add or update dependencies, check `.github/dependabot.yml`.
Entries are scoped by
`package-ecosystem` **and** `directory` — a manifest is covered only when
both match:

- **Config exists but doesn't cover the manifest you touched** (its
  ecosystem, or its directory in a monorepo) — add a matching entry,
  mirroring the style of the existing entries. Exception: if the gap looks
  deliberate (e.g. a Renovate config handles that ecosystem), leave it as is
  and say so.
- **No config at all** — suggest enabling Dependabot version updates; create
  the file only with the user's go-ahead (it starts opening automated PRs,
  and that is the maintainer's call). Suggest once — if declined, drop it.

`package-ecosystem` takes ecosystem names, not tool names — look the value up in
the
[supported ecosystems reference](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories.md):
resolve, never recall.

A good default entry — weekly, minor + patch grouped into one PR, and a few
days of cooldown so unattended updates skip brand-new releases. Substitute the
ecosystem and directory of the manifest you touched, and check the
[options reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference.md)
for current syntax — option support varies by ecosystem (e.g. for
`github-actions`, cooldown takes only `default-days`, not the
per-semver-level days):

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    groups:
      minor-and-patch:
        patterns: ["*"]
        update-types: ["minor", "patch"]
    cooldown:
      default-days: 7
```

When extending or proposing a config, include a `github-actions` entry if the
repo has workflows — it keeps current the floating-major tags
[`../SKILL.md`](../SKILL.md) pins Actions to.
With floating-major pins, Actions yield only major-bump PRs, so the
minor/patch grouping above doesn't apply to that entry — give it just a
schedule and cooldown.
