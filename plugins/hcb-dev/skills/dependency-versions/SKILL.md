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

On a GitHub-hosted repo, an ecosystem in use and not in `.github/dependabot.yml`
is a gap — [`references/dependabot.md`](references/dependabot.md) owns what to do
about it. Read it after the manifest change lands.
