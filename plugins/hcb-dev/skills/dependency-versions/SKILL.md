---
name: dependency-versions
description: >-
  Use when adding or updating a dependency, bumping or pinning a package
  version, editing a dependency manifest (package.json, Cargo.toml,
  pyproject.toml, go.mod, Gemfile, requirements.txt, …), choosing a Node.js
  runtime version, or pinning a GitHub Actions version. Resolve every version
  from the registry via the package manager's own add/install command — never
  type a version string from memory or hand-edit a manifest with a version
  literal. Apply this even for routine "just add X" requests.
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
- **GitHub Actions**: pin to the latest major (e.g. `@v4`). Find it with
  `gh release view -R <owner>/<repo> --json tagName --jq .tagName`.

## Why this matters

A version typed from memory may not exist, may have been yanked, or may be months
behind — and you usually won't find out until install or CI fails. Letting the
tool resolve it keeps the manifest and lockfile consistent and current with a
single command, with no guesswork.
