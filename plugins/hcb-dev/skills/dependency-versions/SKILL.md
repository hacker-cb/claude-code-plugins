---
name: dependency-versions
description: >-
  Use when adding or updating a dependency, bumping or pinning a package
  version, editing a dependency manifest (package.json, Cargo.toml,
  pyproject.toml, go.mod, Gemfile, requirements.txt, …), choosing a Node.js
  runtime version, pinning a GitHub Actions version, or setting up / editing
  .github/dependabot.yml (enabling Dependabot, automating dependency updates).
  Resolve every version from the registry via the package manager's own
  add/install command — never type a version string from memory or hand-edit
  a manifest with a version literal. On GitHub-hosted repos, keep the
  Dependabot config in sync with the ecosystems actually in use. Apply this
  even for routine "just add X" requests.
---

# Dependency versions: resolve, never recall

Version numbers recalled from memory are routinely wrong or stale — the registry
is the source of truth. Whenever you add or change a dependency, let the package
manager resolve the version for you instead of typing a literal into a manifest.

## Rule

Never type a version string from memory. Always resolve it from the registry.

## How

Use the package manager's "add" command and let it resolve `latest`. It writes
the correct, current version into the manifest **and** the lockfile in one step:

- **Rust**: `cargo add <crate>`
- **Node** (pnpm / npm / yarn): `pnpm add <pkg>` (or `npm install <pkg>`, `yarn add <pkg>`)
- **Python**: `uv add <pkg>` (or `poetry add <pkg>`)
- **Go**: `go get <pkg>@latest`
- **Ruby**: `bundle add <gem>`

Don't hand-edit manifests with version literals. If you genuinely must edit a
manifest by hand, look the current version up from the registry first.

## Special cases

- **Node.js runtime**: pin to the active LTS major, not `latest`. Check with
  `nvm ls-remote --lts`.
- **GitHub Actions**: pin to a version tag — the floating latest major, e.g.
  `@vN` — **not** a commit SHA. The release tag is a full semver (e.g.
  `v7.0.0`), so take its major:
  `gh release view -R <owner>/<repo> --json tagName --jq '.tagName | split(".")[0]'`.
  A floating major tag keeps workflows readable and lets within-major fixes
  flow in automatically, while Dependabot (below) raises the major when one
  ships. SHA pins (`actions/checkout@<sha> # v6.0.2`) are the stricter
  supply-chain posture but noisy and unreadable — for trusted first-party
  `actions/*` this project takes legible, Dependabot-tracked tags instead.

## GitHub repos: keep Dependabot in sync

Resolving from the registry fixes a version *today*; Dependabot keeps it
current *afterwards* with automated update PRs. On a GitHub-hosted repo
(remote on `github.com` or a GitHub Enterprise host), whenever you add or
update dependencies, check `.github/dependabot.yml`. Entries are scoped by
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

`package-ecosystem` takes ecosystem names, not tool names: npm / pnpm / yarn
→ `npm`; pip / poetry → `pip`; uv → `uv`; Rust → `cargo`; Go → `gomod`; Ruby
→ `bundler`; workflow files → `github-actions`. For anything else, look the
value up in the
[supported ecosystems reference](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories)
— same rule: resolve, never recall.

A good default entry — weekly, minor + patch grouped into one PR, and a few
days of cooldown so unattended updates skip brand-new releases (the window
in which compromised versions are usually caught and yanked). Substitute the
ecosystem and directory of the manifest you touched, and check the
[options reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)
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
repo has workflows — it keeps the pinned Action majors (see above) current.
With floating-major pins, Actions yield only major-bump PRs, so the
minor/patch grouping above doesn't apply to that entry — give it just a
schedule and cooldown.

## Why this matters

A version typed from memory may not exist, may have been yanked, or may be months
behind — and you usually won't find out until install or CI fails. Letting the
tool resolve it keeps the manifest and lockfile consistent and current with a
single command, with no guesswork.
