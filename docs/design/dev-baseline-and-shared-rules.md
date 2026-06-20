# Design: dev baseline plugin + shared-rules synchronization

Status: **proposal** — a *temporary working spec*. Before the feature merges, the
durable parts are distilled into `CLAUDE.md` / the `hcb-dev` README + a kept C1–C12
note, and this file is removed (not landed on `main` verbatim; git history is the
archive). · Owner: hacker-cb · Last updated: 2026-06-19 (rev 5 — **DECISION:** all
rule-sync magic lives in `hcb-dev`; forge plugins are **independent** standard plugins
(skills/agents) with **no rules and no dependency** on `hcb-dev`. The design no longer
uses plugin dependencies; §8/§9/§11.4/C9/C12 updated.)

This document proposes how the `hacker-cb-plugins` marketplace should deliver a
reusable development baseline across many repositories (DALI, NEXUS today; more
GitHub / GitLab-self-hosted / GitVerse projects later), and how shared "rules"
should be classified, distributed, and kept in sync.

It supersedes the ad-hoc duplication currently in use: the three files
`git-branches.md`, `github-issue-tracking.md`, `early-stage.md` are copied
**byte-for-byte** into every repo's `.claude/rules/`, with no source of truth and
no drift detection.

**At a glance.** Rules are vendored as canon inside the `hcb-dev` plugin and synced
into each project's `.claude/rules/` as real, drift-guarded files (no submodules, no
stdout injection). They are classified into four tiers — **T1** verbatim · **T2**
shared body + a contract-checked companion · **T3** project-authored to a shared form
· **T0** the manifest/spec that runs the system. Distribution rides plugin versioning
+ an explicit `/hcb-dev:rules sync`; a `PreToolUse` deny + drift guard protect the
synced files; `hcb-dev` owns **all** rule-sync, while forge plugins (`hcb-github`, …)
are independent standard plugins (skills/agents) with **no rules**.

---

## 1. Problem statement

Collected from the design discussion:

1. **Shared rules drift.** `git-branches.md`, `github-issue-tracking.md`,
   `early-stage.md` must stay 100% identical across repos but are hand-copied.
   We need a single source of truth (SSOT) and a synchronization system.
2. **Not all rules are identical.** Some rules are fully shared; some are shared
   *bodies* with project-specific data; some are project-authored but should
   follow a shared *form*. We need a classification, not a binary shared/local.
3. **Language (RU/EN) is scattered.** Per-scope language defaults live in the
   `hcb-dev` plugin; project policy lives in `CLAUDE.md` / `docs/CLAUDE.md` /
   `rust.md` / `frontend.md`, sometimes contradicting the plugin default. We
   need one mechanism: fresh-session defaults + a single project override.
4. **New-project onboarding.** When a fresh project is opened (no `CLAUDE.md` /
   no `.claude/`), the baseline should detect it and offer to scaffold.
5. **Plugin presence in cloud envs.** Required plugins sometimes fail to load in
   remote/cloud sessions. We want to detect and surface that.
6. **One dev baseline.** A single `hcb-dev` plugin should provide a complete dev
   experience for any project.

### Multi-forge horizon

Future projects will live on GitHub, GitLab (usually self-hosted), GitVerse, and
similar. Anything host-specific (PR vs MR, `gh` vs `glab`, Copilot, sub-issues,
`#N` linking) must be isolated from the forge-neutral baseline.

---

## 2. Hard constraints (verified against Claude Code docs)

These facts shape every decision below. Verified 2026-06-19 against
`code.claude.com/docs`, read raw (not via summarizer): `plugins-reference`,
`plugin-dependencies`, `plugin-marketplaces`, `skills`, `plugins` **in full**;
`hooks` + `settings` by their design-relevant sections; plus `memory` and the public
issue tracker.

| # | Fact | Source / consequence |
|---|---|---|
| C1 | A plugin **cannot ship `.claude/rules/*.md`** or a context-loaded `CLAUDE.md`. A plugin-root `CLAUDE.md` is explicitly **not** loaded; plugins contribute context only through **skills, agents, and hooks**. | `plugins-reference.md` (§Plugin directory structure), `memory.md`. Always-on context from a plugin = a SessionStart hook printing to stdout (`additionalContext`). |
| C2 | `paths:` frontmatter scoping exists **only** for project-local rules, not hook-injected text. | `memory.md`. Hook-injected guidance is always-on and costs context every session. |
| C3 | Marketplace plugin install **does not initialize git submodules** (documented bug `anthropics/claude-code#17293`). | A submodule *inside a plugin* is dead. |
| C4 | An installed plugin **cannot reference files outside its own root** (`../shared` is not copied to cache). **Exception:** a symlink whose target resolves **elsewhere in the same marketplace** is *dereferenced* — its content is copied into the cache (the documented "meta-plugin" pattern). | `plugins-reference.md` (§Plugin caching and file resolution). Canon is **vendored inside `hcb-dev`**; the symlink exception is a fallback if another hcb plugin ever needs the same canon. |
| C5 | A plugin **can bundle arbitrary non-component files** (`rules/`, `manifest.yml`); the whole plugin dir is copied to cache and is readable via `${CLAUDE_PLUGIN_ROOT}`. | Enables a canon-in-plugin + sync-skill design. |
| C6 | `${CLAUDE_PLUGIN_ROOT}` (plugin dir) and `${CLAUDE_PROJECT_DIR}` / hook `cwd` (project root) are available to hooks and bin. | A hook can `sha256` a project file and compare against canon → drift detection works. |
| C7 | A plugin carries a `version` in `plugin.json`; with an explicit version consumers update **only** when it bumps, else per-commit (git-SHA version). There is **no per-project version pin** for a marketplace plugin. | The plugin's semver is the global propagation lever; per-project staging comes from sync being an explicit, reviewable action. |
| C8 | A SessionStart hook **cannot enumerate which plugins are loaded** (stdin: `session_id, cwd, source, model`; no plugin list, no "first run" flag; in cloud `.git` always exists). | New-project / plugin-presence detection is **inferred** — but C9/C11 give stronger levers than this doc first assumed. |
| **C9** | **Plugins can declare `dependencies` on other plugins** (optionally version-constrained). Installing a plugin **auto-installs** its deps; enabling **transitively enables** them (and fails if a dep is not installed). | `plugins-reference.md` (§manifest `dependencies`, `plugin enable`/`prune`), `/en/plugin-dependencies`. Verified capability — but this design **deliberately does not use it** (forge plugins are independent — §9, §11.4); the fact is kept so a future version-pinned dependency knows the mechanics. |
| **C10** | `${CLAUDE_PLUGIN_DATA}` is a **persistent** per-plugin dir that survives updates; the docs give a canonical SessionStart pattern that `diff`s a bundled file against a copy there to detect "changed since last run". | `plugins-reference.md` (§Persistent data directory). The drift guard uses this idiom (stamp/hash cache) instead of a hand-rolled one. |
| **C11** | The **`InstructionsLoaded`** hook fires when a `CLAUDE.md` / `.claude/rules/*.md` loads (at start and on lazy load). | `plugins-reference.md` (hook table), `memory.md`. Lets the guard verify a managed rule's hash **at load time** and observe which rules actually loaded — partly softening C8. |
| **C12** | Plugin dependency **version constraints** resolve only against `{plugin-name}--v{version}` **git tags** (`claude plugin tag`). A **bare** dependency (no version) tracks the marketplace's current version and needs no tags. Deps resolve **within the same marketplace** unless the root marketplace lists the target in `allowCrossMarketplaceDependenciesOn`. | `plugin-dependencies.md`, `plugin-marketplaces.md`. **Informational** — the design uses no plugin deps (§9). Recorded so a future version-pinned dep knows it needs `--v` tags + same-marketplace (or the cross-marketplace allowlist). |

> **On `memory.md`:** this cites the docs page *How Claude remembers your project*
> (`code.claude.com/docs/en/memory.md`) for its **`CLAUDE.md` / `.claude/rules/` /
> `@`-import** behavior only — **not** the *auto-memory* feature described on the same
> page. The design relies on **none** of auto-memory: both DALI and NEXUS run
> `autoMemoryEnabled: false` (it is unpredictable by design), and every mechanism here
> is CLAUDE.md / rules / hooks / skills / committed companion files.

**Net:** drop submodules entirely; vendor canon inside `hcb-dev`; distribute via
an explicit, drift-guarded sync skill that writes real files into the project's
`.claude/rules/` (preserving native rule semantics from C1/C2 that hook injection
would lose).

---

## 3. Rule taxonomy (the core model)

Rules are classified by **what is synchronized** and **what the guard checks** —
because those are genuinely different operations, not one with a flag.

| Tier | Meaning | Synchronized | Guard | Examples |
|---|---|---|---|---|
| **T1 — Canonical** | 100% shared, verbatim | the whole file | hash of whole file; drift = error | `git-branches.md`, `early-stage.md` |
| **T2 — Parameterized** | shared body + project "slots" | the body verbatim; **not** the slots | hash of body + companion contract | `issue-tracking.md` (+ `labels.yml`); `language.md` (+ values) |
| **T3 — Conventional** | project-authored, follows a shared *form* | nothing | lint against the authoring spec | `rust.md`, `iec.md`, `dbml.md`, `frontend.md`, NEXUS domain rules |
| **T0 — Meta** | the system itself | the manifest + the authoring spec | — | new: `manifest.yml`, `rule-authoring.md` |

Notes:

- **T1.** A managed mirror. `early-stage.md` is deleted when a project matures —
  modeled as `enabled: false` in the project lock, not an edit to the body.
- **T2 — key simplification.** Do **not** merge regions inside a file (fragile
  `<!-- managed -->` blocks). Keep the body **verbatim** (mechanically a T1 file)
  and push *all* variability into a separate, project-owned companion file with a
  contract. This is exactly what `issue-tracking.md` already does: the body is
  identical everywhere and references `.github/labels.yml`, whose content differs
  per project, plus a stated invariant ("exactly one `type:*` …"). So T2 ≈ "T1
  body + a contract-checked companion".
- **T3 — "rules written by rules".** What is shared is the *form*, not the
  content: a single canonical authoring convention (frontmatter, `paths:`
  discipline, size budget, "know vs follow" split, no duplication of canon).
  DALI's `docs-and-rules.md` is effectively this already; we promote a
  project-neutral version to a T1 rule and give it teeth via tooling (a linter
  and a `rule-new` scaffolder).
- **T0 — the synchronization system.** A manifest in the plugin classifies every
  managed rule; a small project-side lock records what the project adopted.
- **Naming note.** Examples use the **canonical** names. `issue-tracking.md` is the
  forge-neutral canon name; the file is `github-issue-tracking.md` in the repos today
  and is renamed in phase 4 (§9).

---

## 4. Distribution mechanism

Canon is **vendored inside `hcb-dev`** (plain committed files — C4/C5), and a
sync skill reconciles a project against it. No submodules anywhere (C3).

### 4.1 Three file operations (one per tier)

1. **Sync managed file verbatim** (T1, and T2 bodies): the sanctioned `bin/` writer
   (§4.6) writes the file into `.claude/rules/` with a `MANAGED — do not edit` header
   — never the model's `Edit`/`Write`, which are denied on managed paths; guard = file hash.
2. **Validate companion against contract** (T2 slots): check `labels.yml` /
   `project.yml` against the stated invariant; guard = contract check.
3. **Lint project file against the authoring spec** (T3): frontmatter present,
   size budget, valid `paths:`, no copy of canonical content; guard = lint.

### 4.2 Plugin layout (proposed)

Node layout mirroring `openai/codex-plugin-cc` (runtime `.mjs` in the plugin; dev
tooling — `package.json` / `tests/` / `tsconfig.json` — at the **marketplace repo root**):

```
plugins/hcb-dev/
  .claude-plugin/plugin.json
  rules/
    manifest.json               # T0: classifies every managed rule (JSON — Node stdlib)
    canonical/                  # T1 bodies + T2 bodies (verbatim)
      git-branches.md  early-stage.md  issue-tracking.md  language.md  rule-authoring.md
    contracts/                  # T2 companion contracts (JSON Schema) + starters
      labels.schema.json  labels.github.starter.yml  project.schema.json
  bin/
    hcb-rules.mjs               # engine CLI: sync | check | diff   (#!/usr/bin/env node)
  lib/                          # engine modules, one tested *.mjs per concern
    manifest.mjs  sync.mjs  drift.mjs  contracts.mjs  lint.mjs  guard.mjs  settings.mjs
  hooks/
    hooks.json                  # commands: node "${CLAUDE_PLUGIN_ROOT}/hooks/<x>.mjs"
    session-start.mjs           # drift + new-project + settings/presence nudge (shares lib/)
    guard.mjs                   # PreToolUse deny on managed rule paths (§4.6)
    inject-prefs.mjs            # language injection (replaces inject-prefs.sh)
  skills/
    rules/                      # /hcb-dev:rules → node bin/hcb-rules.mjs (allowed-tools)
    onboard/                    # /hcb-dev:onboard  (+ --fix for settings)
    rule-new/                   # phase 4: scaffold a T3 rule per spec
    dependency-versions/  library-docs/   # existing
# repo root: package.json ("type":"module", devDeps typescript + @types/node),
#            tests/*.test.mjs (node --test), tsconfig.json (allowJs/checkJs/noEmit)
```

### 4.3 Manifest (plugin-side SSOT)

```yaml
# plugins/hcb-dev/rules/manifest.yml
version: 1
rules:
  - name: git-branches
    tier: canonical
    source: canonical/git-branches.md
  - name: early-stage
    tier: canonical
    source: canonical/early-stage.md
    optional: true                  # project may disable when matured
  - name: issue-tracking
    tier: parameterized
    source: canonical/issue-tracking.md
    companions:
      - path: .github/labels.yml    # default; project may relocate
        contract: contracts/labels.schema.yml
        starter: contracts/labels.github.starter.yml
  - name: language
    tier: parameterized
    source: canonical/language.md
    companions:
      - path: .claude/hcb-dev/project.yml   # languages: { chat, plans, comments, docs, issues }
        contract: contracts/project.schema.yml
  - name: rule-authoring
    tier: canonical
    source: canonical/rule-authoring.md
```

### 4.4 Project lock (project-side opt-in)

```yaml
# .claude/hcb-dev/rules.yml  (committed; the project's adoption record)
managed_by: hcb-dev
adopted:
  - git-branches
  - issue-tracking
  - language
  - rule-authoring
  - { name: early-stage, enabled: false }   # this project has matured
# T3 rules are not listed here; they are linted, not synced.
```

The sync skill records each managed file's expected hash inline in `rules.yml`.
The drift guard follows the documented `${CLAUDE_PLUGIN_DATA}` idiom (C10): it
compares the project's managed files — and the canon stamp cached in the persistent
data dir — against `${CLAUDE_PLUGIN_ROOT}`, so it works offline and detects both
"project edited a managed file" and "canon changed since last sync".

### 4.5 Propagation flow

```
change canon (a rule file / manifest `version`)  ──▶  drift guard warns "behind / diverged"
                      ──▶  /hcb-dev:rules sync   (writes managed files)
                      ──▶  review the diff in a PR
                      ──▶  merge
```

This is the **same model both repos already use** for generated, drift-guarded
artifacts (DBML, OpenAPI snapshot, TS codegen, `.env.example`): a managed file
with a "do not edit" header plus a CI drift check. No new mental model.

The drift-guard hook is **harness-only — no model context cost** unless it emits
(`plugins-reference.md` §plugin details): a clean, in-sync project pays ~0 tokens;
the warning text enters context only when there is actual drift to report.

The drift trigger is the **canon content** (per-file hashes + the manifest `version`),
**not** the plugin semver — a code-only `hcb-dev` release (e.g. a skill fix) does not
nag for a rules sync, and a canon edit without a plugin-code change still does.

### 4.6 Protecting managed files from edits

Two layers — **prevent in-session, detect everything else**:

- **Prevention (in-session, hard).** `hcb-dev` ships a **`PreToolUse` hook**
  matching `Edit`/`Write` (and recognized Bash file-commands) against the managed
  rule paths from `rules.yml`, returning `permissionDecision: "deny"` with: *"managed
  by hcb-dev — edit the canon and run `/hcb-dev:rules sync`."* This is the **only**
  layer that blocks regardless of what the model decides; the docs explicitly
  recommend `PreToolUse` for hard blocks (`memory.md`, `hooks.md`).
- **Sanctioned-writer carve-out.** The sync must still write these files, so it
  writes through a bundled `bin/` script — **not** the `Edit`/`Write` tools — and the
  tool-level deny does not cover an arbitrary subprocess (it covers Edit/Write and
  *recognized* file-commands only). So the only sanctioned mutation path is the sync.
  The `/hcb-dev:rules` skill invokes it via `allowed-tools: Bash(hcb-rules *)` (`bin/` is
  on `PATH` while the plugin is enabled).
- **Optional project-side `deny`.** A project may also pin
  `permissions.deny: ["Edit(.claude/rules/<managed>)"]` in its own
  `.claude/settings.json`. A plugin **cannot** ship this (plugin `settings.json`
  supports only `agent`/`subagentStatusLine`), so onboarding writes it, not the plugin.
- **Detection (out-of-session).** Hooks intercept only edits made *through Claude
  Code*. A human editor, a formatter, or a `git` op bypasses `PreToolUse` entirely;
  those are caught after the fact by the **drift guard** (SessionStart +
  `InstructionsLoaded`) and the **CI drift gate** (blocks the PR) — like any managed
  artifact. The `MANAGED — do not edit` header is advisory on top.

**Boundary, stated plainly:** in-session accidental edits are **prevented**;
out-of-session edits are **detected, not prevented**. This is a guardrail, not DRM —
a human can deliberately remove the hook/deny, after which detection still flags the
divergence for review.

---

## 5. Project-specific overlay style (unified)

Generalize the proven `labels.yml` pattern into one rule:

> A shared rule body stays **byte-identical** everywhere and **delegates every
> project-specific literal** to a named, project-owned companion file (or a key
> in `.claude/hcb-dev/project.yml`) that satisfies a stated contract.

- `issue-tracking.md` → `.github/labels.yml` (label set; invariant = exactly one
  `type:*`, ≥1 component, ≤1 `awaits:*`, ≤1 `priority:*`, optional `security`).
- `git-branches.md` → trunk/base branch names and CI triggers move to
  `.claude/hcb-dev/project.yml` / CI config (the body already delegates CI literals).
- `language.md` → values in `.claude/hcb-dev/project.yml: languages`.

Extensions that have no home in canon go into a **project-owned sibling**
(`<rule>.local.md`) — never as an edit to a synced body. The synced body remains
verbatim; project additions are reviewed on their own.

All hcb-managed project state lives under a **plugin-namespaced `.claude/hcb-dev/`
directory** — not a generic `.claude/project.yml`, which would squat a name in the
Claude-Code-owned `.claude/` namespace, hide provenance, and scatter the system's
several files (config + adoption record) across the `.claude/` root. The directory
is owned by the baseline plugin; forge plugins (`hcb-github` / `hcb-gitlab`) read
from it (a plugin's hook/skill runs in the project `cwd`, so reading project files
is fine — C4 only restricts a plugin's own bundled files). The one trade-off — a
forge-neutral canonical rule references an `hcb-dev`-named path — is acceptable:
the canon is delivered and synced by `hcb-dev` regardless, and a future baseline
rename is a one-shot managed-file migration (permitted by `early-stage.md`).

It nests under `.claude/` rather than a repo-root `.hcb-dev/` because this is
Claude-Code tooling config that belongs beside `.claude/settings.json` (where
`expects_plugins` mirrors `enabledPlugins`), adds no new repo-root entry (projects
already carry `.claude/`), is self-documenting in context, and scales to a family
of hcb plugins (`.claude/hcb-dev/`, `.claude/hcb-github/`) without cluttering the
root. A repo-root home would only win once **non-Claude tooling** (CI, git hooks, a
standalone CLI) must read these facts — an absent consumer today (`early-stage.md`),
and a near-zero migration if it appears. Claude Code reads only its known
subpaths under `.claude/` (`rules/**`, `skills/`, `agents/`, `commands/`, `hooks/`,
`settings.json`), so an `hcb-dev/` subdir is ignored, never parsed as a rule.

`.claude/hcb-dev/project.yml` is the single companion contract for cross-cutting literals:

```yaml
# .claude/hcb-dev/project.yml
forge: github            # github | gitlab | gitverse
trunk: master
default_base: dev
early_stage: false
languages:
  chat: ru
  plans: ru
  comments: en
  docs: en
  issues: ru
expects_plugins:
  - hcb-dev@hacker-cb-plugins
  - hcb-github@hacker-cb-plugins
  - markdown-docs@hacker-cb-plugins
```

---

## 6. Language model (refactor)

Three layers, single vocabulary of scopes (`chat / plans / comments / docs /
issues / other`), explicit precedence:

```
plugin userConfig defaults   (fresh-session baseline, low priority)
        ▼  overridden by
project values               (.claude/hcb-dev/project.yml: languages — the project SSOT)
        ▼  overridden by
explicit request in the conversation
```

- The `hcb-dev` `inject-prefs.sh` hook keeps printing the **defaults** framed as
  low-priority (it already does this).
- `language.md` (T2 canonical body) explains *how scopes work* and that project
  values win; the **values** live in the companion, not in the prose.
- This resolves the current contradiction (plugin default `comments=en` vs DALI's
  `rust.md` "entity comments RU"): the project redefines the scope; the plugin
  default never fights it.

---

## 7. Onboarding a new project

Detection signal is **not** `.git` (always present in cloud — C8). Use absence of
markers: no `CLAUDE.md`, no `.claude/`, no `.claude/hcb-dev/project.yml`. The
`InstructionsLoaded` hook (C11) additionally reports which rule files actually
loaded, so the baseline can tell an *uninitialized* project from one whose managed
rules merely failed to sync.

- `session-baseline.sh` (SessionStart, part of `hcb-dev`) prints a soft nudge when
  the project looks uninitialized: *"this project isn't set up for hcb — run
  `/hcb-dev:onboard`"*.
- `/hcb-dev:onboard` (skill): detect forge from `git remote`; scaffold
  `.claude/settings.json` (enable `hcb-dev` + the right forge plugin); run
  `/hcb-dev:rules sync` for T1/T2; drop a starter `.github/labels.yml` (or GitLab
  equivalent); create `.claude/hcb-dev/project.yml` (languages, trunk, `early_stage`);
  self-check.

---

## 8. Plugin presence in cloud envs

We **don't** use plugin dependencies for this (forge plugins stay independent — §9).
The layers:

- **Committed-settings bootstrap.** The project's `.claude/settings.json` ships
  `extraKnownMarketplaces` + `enabledPlugins` (`hcb-dev` and any forge plugin), so Claude
  Code **prompts to install/enable on folder-trust** — one click per clone. This is the
  primary in-app mechanism that makes the expected set present, no dependency graph needed.
- **Soft / optional companions → `expects_plugins` + nudge.** Recommended-but-not-
  required plugins (e.g. `markdown-docs`, project MCP servers) stay in
  `.claude/hcb-dev/project.yml: expects_plugins`. `session-baseline.sh` (guaranteed
  to run — it *is* `hcb-dev`) prints the expected set: *"if any of these
  slash-commands / MCP tools are missing, check `/plugin`"*.
- **Verification levers.** `InstructionsLoaded` (C11) confirms managed rules
  loaded; the model also self-checks which skills / MCP tools are present against the
  declared set. There is still no API to *enumerate* plugins (C8), but the hard-dep
  path means the critical ones can no longer go missing silently.

Residual gap: if neither the committed settings (trust-prompt) nor a seed dir made the
**marketplace** available, even `dependencies` can't resolve — that stays a declare +
nudge case, plus the cloud levers below.

### Settings presence: auto-add vs check

- **Bootstrap is committed, not self-served.** A *plugin* can't lift itself in (the
  `hcb-dev` hook runs only once `hcb-dev` is enabled). But **committed project
  `.claude/settings.json`** — `extraKnownMarketplaces` + `enabledPlugins` — makes Claude
  Code **prompt the user to install/enable on folder-trust** (`plugin-marketplaces.md`
  §Require marketplaces for your team). So onboarding writes those once
  (`/hcb-dev:onboard`, or a manual `/plugin marketplace add`), and every later clone is a
  one-click trust-prompt away from the full set.
- **Once we're in, the plugin graph is automatic.** Forge plugins `depend` on
  `hcb-dev` (C9), so installing/enabling a forge plugin pulls the baseline in — we do
  **not** hand-edit `enabledPlugins` for that.
- **Recurring check, not silent rewrite.** The SessionStart hook (it is running, so it
  can read `.claude/settings.json`) verifies the required marketplace + `expects_plugins`
  are present and **warns + offers** `/hcb-dev:onboard --fix` to write any missing
  entries. It does **not** silently rewrite `settings.json` — that is the unpredictable
  mutation we avoid (same principle as §4.6; cf. `autoMemoryEnabled: false`), and a hook
  edit would only take effect next session anyway (enablement resolves at start). Writes
  go through the sanctioned skill, reviewable in the diff.

### Cloud / CI loading (the real fix for "plugins didn't load")

Plugins failing to load in remote/cloud sessions is usually a **git failure at
startup**, not a config gap — Claude Code clones marketplaces/plugins at launch with a
120 s timeout. The levers (env, set by the cloud environment), from `plugin-marketplaces.md`:

- **`CLAUDE_CODE_PLUGIN_SEED_DIR`** — pre-seed `marketplaces/` + `cache/` into the image
  at build time; Claude Code uses them in place with **no runtime clone**. The robust fix
  for ephemeral cloud envs.
- **`CLAUDE_CODE_PLUGIN_KEEP_MARKETPLACE_ON_FAILURE=1`** — keep the last-good cache when a
  `git pull` fails (offline/airgapped) instead of wiping it.
- **`CLAUDE_CODE_PLUGIN_GIT_TIMEOUT_MS`** — raise the 120 s git timeout on slow links.
- Private marketplace → set `GH_TOKEN` / `GL_TOKEN` for background auto-update (the DALI
  `session-start.sh` already injects `GH_TOKEN`).

### New-version notification + offer to update

Two layers compose:

- **The plugin itself** updates through Claude Code natively — `/plugin update` /
  auto-update, gated by the `hcb-dev` version bump (C7). We do not reinvent plugin
  self-update.
- **The rule canon** is then checked by the drift guard: it compares the canon stamp in
  `${CLAUDE_PLUGIN_ROOT}` against the project's last-synced stamp cached in
  `${CLAUDE_PLUGIN_DATA}` (C10) and **notifies** — *"hcb-dev canon advanced to vX; this
  project is on vY — run `/hcb-dev:rules sync`"* — with the offer to apply. So "new
  version → notify → offer update" is covered for the part that actually lands in the
  project, riding the same harness-only hook (no cost unless it fires).

---

## 9. Plugin topology

Recommended: **baseline + per-forge**, not one mega-plugin.

- `hcb-dev` = forge-neutral baseline: language defaults, shared-rules
  sync/onboarding, env/plugin-presence checks, `dependency-versions`,
  `library-docs`.
- Forge workflow lives in dedicated plugins: `hcb-github` (exists), future
  `hcb-gitlab`, `hcb-gitverse`.
- A project enables `hcb-dev` **plus** its forge plugin. "Complete dev experience"
  is the pair; the baseline stays portable and free of GitHub-only logic.

Forge plugins are **independent standard plugins** — they declare **no `dependency` on
`hcb-dev`** and carry **no rules** (decision §11.4); they live on their own and provide
only what the standard plugin system offers (skills / agents / MCP / hooks). The
"complete dev experience" pair is enabled by the **project's committed
`.claude/settings.json: enabledPlugins`** (onboarding scaffolds it; the trust-prompt
installs/enables on clone — §8), not by a plugin dependency graph. `hcb-dev` is enabled
directly in every project; a forge plugin is an optional add-on enabled alongside, and is
equally usable on its own (e.g. just the PR-workflow skill). This keeps baseline and forge
concerns fully orthogonal and sidesteps the dependency machinery entirely (no version
floor, no `--v` tags, no cross-marketplace allowlist — C12 is informational).

### Forge-neutrality work

- Rename `github-issue-tracking.md` → `issue-tracking.md`; keep the label
  taxonomy (neutral — labels exist on GitHub and GitLab) and move GitHub-only bits
  (`gh`, Copilot, sub-issues) into the forge plugin.
- `git-branches.md` is already forge-neutral — stays canonical as-is.
- `#N` issue/PR linking and PR-vs-MR vocabulary belong to the forge adapter.

---

## 10. Phased rollout

| Phase | Scope | Touches |
|---|---|---|
| **0** | Vendor canon (`rules/canonical/*`, `manifest.yml`); the `bin/` writer + `/hcb-dev:rules` (sync/check/diff); drift guard + the `PreToolUse` edit-protection hook (§4.6). | `hcb-dev` only |
| **1** | Adopt in DALI + NEXUS: replace the 3 duplicated files with synced managed files; add `.claude/hcb-dev/rules.yml`; verify `labels.yml` companion contract. | dali, nexus |
| **2** | Language refactor: `language.md` (T2) + `.claude/hcb-dev/project.yml: languages`; remove contradictions; collapse scattered policy. | hcb-dev, dali, nexus |
| **3** | Onboarding + presence: `/hcb-dev:onboard` (+ `--fix`), `session-baseline.sh`, `expects_plugins`, settings presence-check + new-version notification (§8). | hcb-dev (+ consuming repos opt-in) |
| **4** | Forge-neutrality: rename to `issue-tracking.md`; scaffold `hcb-gitlab`; `rule-authoring.md` + T3 linter + `rule-new`. | hcb-dev, hcb-github, new hcb-gitlab |

Phases 0–1 deliver ~90% of the value (no more duplication, SSOT, drift guard) and
are nearly ready today because the `labels.yml` delegation already exists.

---

## 11. Open decisions

Captured with the recommended default (to revisit before each phase):

1. **Canon SSOT location** — *recommend:* vendor directly in `hcb-dev` now; only
   split into a separate canon repo (fed into the plugin by the plugin repo's CI)
   if non-Claude tooling ever needs the same canon. Consistent with the projects'
   own `early-stage` "no premature abstraction" policy.
2. **T2 depth** — *recommend:* "verbatim body + contract-checked companion" only;
   no in-file managed-region merging.
3. **Start scope** — *recommend:* ship T0/T1/T2 (manifest + sync + drift) first;
   defer the T3 linter and `rule-new` to phase 4.
4. **Forge plugins — DECIDED (no rules at all).** All sync magic lives in `hcb-dev`.
   Forge plugins (`hcb-github`, future `hcb-gitlab`) are **pure standard plugins** —
   skills / agents / MCP / hooks only — with **no rules, no rule-sync, no companion
   involvement**, and **no dependency on `hcb-dev`** (they "live on their own"). Rules
   stay **forge-neutral**; forge-specific behaviour (PR vs MR, `gh` / `glab`, Copilot,
   `#N` linking, sub-issues) lives in the forge plugin's **skills**, applied at workflow
   time. The project's `forge:` value (companion) is the only forge hook a neutral rule
   might name. Enablement of "baseline + forge" is settings-driven (§8), not a dep graph.
5. **Managed-rules location** — *recommend:* sync into a segregated
   `.claude/rules/hcb/` subdir, not flat in `.claude/rules/`. Claude Code discovers
   **all `.md` under `.claude/rules/` recursively** (`memory.md`: subdirs like `frontend/`
   are an explicit documented pattern), so a subdir loads **always-on exactly like a
   top-level rule** — no `paths:` needed. The subdir makes the `PreToolUse` deny-glob
   trivial (`Edit(.claude/rules/hcb/**)`), makes "what is managed" obvious, and avoids
   collisions with project-authored rules. The sync engine must also **delete** de-adopted
   managed files (e.g. `early-stage` once matured), not just stop writing.
6. **Forge abstraction depth** — *recommend:* keep `forge: github|gitlab|gitverse` a
   simple enum for now; defer a capability model until the 2nd forge (`hcb-gitlab`)
   actually lands (`early-stage`: don't pre-abstract).
7. **Engine language — DECIDED: Node, plain `.mjs` ESM, no build (option a).** Validated
   by the official **`openai/codex-plugin-cc`**, which uses exactly this stack: `.mjs` ESM
   (`"type": "module"`), `node --test` (+ `node:assert/strict`), type-checking via `tsc`
   with `allowJs/checkJs/noEmit` (non-strict), and dev-deps **only** `typescript` +
   `@types/node`. The engine is **zero runtime dependency** (Node stdlib
   `node:fs`/`node:crypto`/`JSON`; machine files in **JSON**); `node` is guaranteed present
   (Claude Code is Node). Hooks call `node "${CLAUDE_PLUGIN_ROOT}/hooks/<name>.mjs"` directly
   — **no bash shims** (the example does the same). Full TypeScript-with-a-build (option b)
   stays available but is not needed. (Open impl detail: the human companion `project.yml`
   may stay YAML — then either accept a tiny `yaml` dep or make it JSON too; machine files
   stay JSON.)

---

## 12. Non-goals

- No backward-compatibility shims for the current hand-copied files — they are
  replaced in place (per each repo's `early-stage` policy).
- Onboarding scaffolds `settings.json` (marketplace + `enabledPlugins`) and relies
  on plugin **`dependencies`** (C9) to pull the baseline in; it installs plugins by
  no other means, and for *optional* companions it only nudges.
- No runtime plugin-load enforcement beyond declare + nudge + model self-check.

---

## 13. Testing & CI

### What "business logic" means here

The deterministic core is the **`bin/hcb-rules` engine**: manifest parse + tier
classification, T1/T2 verbatim sync (idempotent, managed header, hash recorded),
companion-contract validation, T3 lint, drift detection (file hashes + the
`${CLAUDE_PLUGIN_DATA}` canon stamp — C10), de-adopt deletion, the `PreToolUse` guard
decision (§4.6), and the settings/version checks (§8). **100% coverage targets this
engine.** Skills and agents are prompts, **not** unit-testable — they are *evaluated*
(model-in-the-loop), not covered.

**Reference implementation:** `openai/codex-plugin-cc` is a production plugin using this
exact stack (`.mjs` ESM, `node --test`, `tsc --checkJs --noEmit`, token-free CI) — mirror it.

### Consolidate logic into one tested engine (§11.7)

Put **all** logic in **`bin/hcb-rules.mjs` + `lib/*.mjs`** (Node, zero runtime deps); the
hooks are **node entry scripts** that share `lib/` — **no bash shims** (mirroring the
example). `hooks.json` calls them directly:

- `hooks/guard.mjs` ← `PreToolUse` (reads the tool JSON on stdin, emits the deny)
- `hooks/session-start.mjs` ← `SessionStart` (drift + settings + new-version nudge)
- `hooks/inject-prefs.mjs` ← `SessionStart` (language injection; replaces the bash version)
- the `/hcb-dev:rules` skill → `node bin/hcb-rules.mjs sync | check | diff`

Then "100% business logic" = 100% of the `lib/` modules (one `tests/*.test.mjs` per module,
the example's layout). Machine files (manifest / lock / stamp) are **JSON** (Node stdlib);
T2 contracts are **JSON Schema** (`*.schema.json`); the human companion may stay YAML
(§11.7 impl note). Type safety = JSDoc + `tsc --checkJs --noEmit`; dev-only deps never ship.

### Test suite (100% of the engine)

- **Unit tests** (`node --test`, built-in — the example's runner) per concern: sync
  idempotence / managed-header / hash recording; drift (project-edit, canon-change); T2
  contract pass+fail; T3 lint pass+fail; de-adopt deletion; guard deny-vs-allow (feed the
  `PreToolUse` JSON on stdin); settings presence; version-notify.
- **Integration smoke** (temp dir + real git, per the example's `helpers.mjs`): `hcb-rules
  sync` against a temp project → assert the written tree + lock, and that a re-run is a
  no-op; `hcb-rules check` exits non-zero on drift.
- **Type-check** the whole engine with `tsc --checkJs --noEmit`.

### CI — a separate `test.yml`

Keep `validate.yml` (structural: `scripts/validate.sh` + `claude plugin validate`). Add
**`test.yml`** gating PRs + push to `main`, triggered on `plugins/hcb-dev/**` + `tests/**`:

- `test`: `node --test --experimental-test-coverage --test-coverage-lines=100` (built-in
  coverage gate, zero deps).
- `typecheck`: `tsc --checkJs --noEmit`.
- matrix ubuntu + macOS; pin action SHAs + `timeout-minutes` + `engines.node` floor (per
  the example).

**The same `hcb-rules check`** powers both the local drift guard and the **drift gate in
consumer CI** (dali / nexus, phase 1) — one command, two homes.

### Claude token in CI — not needed for the gate

The required CI is **deterministic and offline**: `scripts/validate.sh`,
`claude plugin validate` (the existing `validate.yml` already runs it with
`permissions: contents: read` and **no token** — it is a schema/frontmatter checker, not
a model call), and the engine tests (`node --test`). **No `ANTHROPIC_API_KEY` required** —
`openai/codex-plugin-cc`'s CI is the live proof (`permissions: contents: read`, no secrets;
tests run against a fake fixture). A token is needed **only** for optional
**model-in-the-loop skill evals** (skill-creator: does a
skill trigger / is its output good) — paid and non-deterministic, so keep them
**non-gating**: a manual `workflow_dispatch` / nightly job behind an `ANTHROPIC_API_KEY`
repo secret, never the PR gate.

This testing scaffold is built **with** the engine in **phase 0** (§14).

---

## 14. Implementation plan (end-to-end)

Each phase is **one reviewable PR** and merges only when its **gate** is green; `hcb-dev`'s
`version` bumps once per phase. Marketplace work continues on `feat/hcb-dev-baseline`;
consumer work lands on each repo's own branch. Reference implementation throughout:
`openai/codex-plugin-cc` (§13).

### Phase 0 — Engine, canon, guards (marketplace repo only; **no consumer changes**)

- **Dev tooling (repo root):** `package.json` (`"type":"module"`; scripts `test`,
  `typecheck`; devDeps `typescript` + `@types/node`), `tsconfig.json`
  (`allowJs/checkJs/noEmit`), `tests/helpers.mjs` (temp-dir + fixture-project + `run`).
- **Engine** `plugins/hcb-dev/`:
  - `bin/hcb-rules` (`#!/usr/bin/env node`, on PATH) → dispatch `sync | check | diff | guard | session-start | lang`.
  - `lib/*.mjs`: `hash` (sha256), `manifest` (load+validate `manifest.json`), `paths`
    (resolve `.claude/rules/hcb/**`), `sync` (write verbatim + managed header + record
    hashes in the lock; **delete de-adopted**), `drift` (files + `${CLAUDE_PLUGIN_DATA}`
    canon stamp), `contracts` (companion vs JSON Schema), `guard` (PreToolUse decision),
    `settings` (read `.claude/settings.json`).
- **Canon** `rules/`: `manifest.json` + `canonical/{git-branches,early-stage,issue-tracking}.md`
  (`issue-tracking` = today's `github-issue-tracking.md`, forge-neutral name) +
  `contracts/{labels.schema.json, labels.github.starter.yml, project.schema.json}`.
- **Hooks** `hooks/`: `hooks.json` (`PreToolUse`→`guard.mjs`; `SessionStart`→
  `session-start.mjs` + `inject-prefs.mjs`) + the three `.mjs` (`inject-prefs` ports the
  current bash output verbatim).
- **Skills** `skills/rules/SKILL.md` (`/hcb-dev:rules`, `allowed-tools: Bash(hcb-rules *)`);
  keep `dependency-versions`, `library-docs`.
- **Tests** `tests/*.test.mjs` — 100% of `lib/` (`node --test`).
- **CI** `.github/workflows/test.yml` (`node --test --test-coverage-lines=100`, `tsc`,
  matrix ubuntu+macOS, pinned SHAs, `timeout-minutes`).
- README/CONTRIBUTING updated; `hcb-dev` version bumped.

**Gate:** `node --test` 100% · `tsc` clean · `scripts/validate.sh` + `claude plugin validate`
pass · `test.yml` green. No consumer repo touched.

### Phase 1 — Adopt in DALI + NEXUS (consumer repos)

- Run `hcb-rules sync` in each → writes `.claude/rules/hcb/{git-branches,early-stage,issue-tracking}.md`
  + `.claude/hcb-dev/rules.json` (lock) + `.claude/hcb-dev/project.yml` (companion).
- **Delete** the hand-copied `.claude/rules/{git-branches,github-issue-tracking,early-stage}.md`.
- Verify `.github/labels.yml` satisfies the labels contract.
- **Consumer CI drift gate** — `hcb-rules check`, two levels: self-consistency (managed
  files vs recorded hashes; **no plugin needed**) always; up-to-date-vs-canon (needs the
  plugin installed) optional.

**Gate:** both repos load identical shared rules from `.claude/rules/hcb/`; no dups; drift
gate green.

### Phase 2 — Language refactor

- Canon `language.md` (T2) + `project.yml: languages` companion + schema.
- In DALI/NEXUS: collapse scattered language policy into the companion SSOT; remove the
  `comments=en` vs `rust.md` "entity comments RU" contradiction (project redefines the scope).
- Tests for `lang`.

**Gate:** one language SSOT per repo; plugin defaults defer; tests green.

### Phase 3 — Onboarding + presence + version notice

- `skills/onboard/SKILL.md` (`/hcb-dev:onboard [--fix]`): detect forge from `git remote`;
  scaffold `.claude/settings.json` (`extraKnownMarketplaces` + `enabledPlugins`) + `project.yml`;
  run sync; starter labels; self-check.
- `hooks/session-start.mjs`: new-project detection, settings-presence warn + offer `--fix`,
  drift warn, canon-version notice (`${CLAUDE_PLUGIN_DATA}` stamp), `expects_plugins` nudge.
- Tests.

**Gate:** onboard scaffolds a fresh project; `session-start` nudges correctly; tests green.

### Phase 4 — T3 tooling + forge expansion

- Canon `rule-authoring.md` (T1) + `lib/lint.mjs` (T3 lint: frontmatter / size / `paths:` /
  no-canon-dup) + `skills/rule-new/SKILL.md`.
- `hcb-gitlab` plugin scaffold — **independent** (skills/agents for MR workflow; no rules,
  no deps), mirroring `hcb-github`.
- Tests for lint.

**Gate:** T3 lint available in consumer CI; `hcb-gitlab` installable; tests green.

### Phase 5 — Distill + retire the design doc

- Distill durable parts → marketplace `CLAUDE.md` (tiers, companion contract,
  `.claude/rules/hcb/`, language layering, forge-independence) + `hcb-dev` README + a kept
  `docs/notes/claude-code-constraints.md` (C1–C12).
- **Remove this design doc**; merge the feature to `main`.

**Gate:** `CLAUDE.md` / README updated; proposal doc removed; PR merged.

> **Status:** design complete. Awaiting ratification of §11 **1 / 3 / 5** (7 locked by the
> reference, §13) to begin Phase 0.
