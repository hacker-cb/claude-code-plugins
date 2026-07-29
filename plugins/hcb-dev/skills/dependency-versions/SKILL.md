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

Never type a version string from memory. Whenever you add or change a dependency,
let the package manager resolve it from the registry instead of typing a literal
into a manifest.

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
  `@vN` — **not** a commit SHA. Release tags are usually full semver, so take the
  major:
  `gh release view -R <owner>/<repo> --json tagName --jq '.tagName | split(".")[0]'`
  — a tag that's already `vN` passes through unchanged; sanity-check any
  non-semver tag by hand. Dependabot (below) raises the major when one ships.

## GitHub repos: keep Dependabot in sync

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

`package-ecosystem` takes ecosystem names, not tool names: npm / pnpm / yarn
→ `npm`; pip / poetry → `pip`; uv → `uv`; Rust → `cargo`; Go → `gomod`; Ruby
→ `bundler`; workflow files → `github-actions`. For anything else, look the
value up in the
[supported ecosystems reference](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories.md)
— same rule: resolve, never recall.

A good default entry — weekly, minor + patch grouped into one PR, and a few
days of cooldown so unattended updates skip brand-new releases (the window
in which compromised versions are usually caught and yanked). Substitute the
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
repo has workflows — it keeps the pinned Action majors (see above) current.
With floating-major pins, Actions yield only major-bump PRs, so the
minor/patch grouping above doesn't apply to that entry — give it just a
schedule and cooldown.
