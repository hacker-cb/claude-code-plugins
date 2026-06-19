# Design: dev baseline plugin + shared-rules synchronization

Status: **proposal** · Owner: hacker-cb · Last updated: 2026-06-19 (rev 2 — constraints re-verified against the full `plugins-reference.md` + `hooks.md`; added C9–C11 and corrected the "no plugin dependencies" assumption)

This document proposes how the `hacker-cb-plugins` marketplace should deliver a
reusable development baseline across many repositories (DALI, NEXUS today; more
GitHub / GitLab-self-hosted / GitVerse projects later), and how shared "rules"
should be classified, distributed, and kept in sync.

It supersedes the ad-hoc duplication currently in use: the three files
`git-branches.md`, `github-issue-tracking.md`, `early-stage.md` are copied
**byte-for-byte** into every repo's `.claude/rules/`, with no source of truth and
no drift detection.

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
`code.claude.com/docs` — `plugins-reference.md` and `hooks.md` read **in full**
(not via summary), plus `memory.md` and the public issue tracker.

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
| **C9** | **Plugins can declare `dependencies` on other plugins** (optionally version-constrained). Installing a plugin **auto-installs** its deps; enabling **transitively enables** them (and fails if a dep is not installed). | `plugins-reference.md` (§manifest `dependencies`, `plugin enable`/`prune`), `/en/plugin-dependencies`. **Corrects the earlier "no dependency mechanism" assumption** — the baseline↔forge link is a real dependency, not a docs convention. |
| **C10** | `${CLAUDE_PLUGIN_DATA}` is a **persistent** per-plugin dir that survives updates; the docs give a canonical SessionStart pattern that `diff`s a bundled file against a copy there to detect "changed since last run". | `plugins-reference.md` (§Persistent data directory). The drift guard uses this idiom (stamp/hash cache) instead of a hand-rolled one. |
| **C11** | The **`InstructionsLoaded`** hook fires when a `CLAUDE.md` / `.claude/rules/*.md` loads (at start and on lazy load). | `plugins-reference.md` (hook table), `memory.md`. Lets the guard verify a managed rule's hash **at load time** and observe which rules actually loaded — partly softening C8. |

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

---

## 4. Distribution mechanism

Canon is **vendored inside `hcb-dev`** (plain committed files — C4/C5), and a
sync skill reconciles a project against it. No submodules anywhere (C3).

### 4.1 Three file operations (one per tier)

1. **Sync managed file verbatim** (T1, and T2 bodies): write the file into
   `.claude/rules/` with a `MANAGED — do not edit` header; guard = file hash.
2. **Validate companion against contract** (T2 slots): check `labels.yml` /
   `project.yml` against the stated invariant; guard = contract check.
3. **Lint project file against the authoring spec** (T3): frontmatter present,
   size budget, valid `paths:`, no copy of canonical content; guard = lint.

### 4.2 Plugin layout (proposed)

```
plugins/hcb-dev/
  .claude-plugin/plugin.json
  rules/
    manifest.yml                # T0: classifies every managed rule
    canonical/                  # T1 bodies + T2 bodies (verbatim)
      git-branches.md
      early-stage.md
      issue-tracking.md         # forge-neutral; references labels companion
      language.md               # describes scopes; values live in companion
      rule-authoring.md         # the T3 authoring spec (itself T1)
    contracts/                  # T2 companion contracts + starter templates
      labels.schema.yml
      labels.github.starter.yml
      project.schema.yml
  hooks/
    hooks.json
    inject-prefs.sh             # existing language injection (low-priority defaults)
    session-baseline.sh         # NEW: drift warn (SessionStart + InstructionsLoaded) + new-project + plugin-presence nudge
  skills/
    rules/                      # NEW: /hcb-dev:rules  (sync | check | diff)
    onboard/                    # NEW: /hcb-dev:onboard
    rule-new/                   # NEW (phase 3): scaffold a T3 rule per spec
    dependency-versions/        # existing
    library-docs/               # existing
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
bump hcb-dev version  ──▶  SessionStart drift guard warns "behind / diverged"
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

Revised after C9 — this splits into **hard** and **soft** dependencies:

- **Hard deps → real `dependencies`.** A forge plugin declares
  `dependencies: ["hcb-dev"]`; enabling the forge plugin in a project then
  **auto-installs and transitively enables** the baseline — no nudge needed, no way
  to "forget" it. This is the primary fix for the cloud-load worry. The exact
  cross-marketplace resolution + version-constraint semantics live in
  `/en/plugin-dependencies` (consult before relying on them).
- **Soft / optional companions → `expects_plugins` + nudge.** Recommended-but-not-
  required plugins (e.g. `markdown-docs`, project MCP servers) stay in
  `.claude/hcb-dev/project.yml: expects_plugins`. `session-baseline.sh` (guaranteed
  to run — it *is* `hcb-dev`) prints the expected set: *"if any of these
  slash-commands / MCP tools are missing, check `/plugin`"*.
- **Verification levers.** `InstructionsLoaded` (C11) confirms managed rules
  loaded; the model also self-checks which skills / MCP tools are present against the
  declared set. There is still no API to *enumerate* plugins (C8), but the hard-dep
  path means the critical ones can no longer go missing silently.

Residual gap: if the **marketplace itself** was never registered in the env, even
`dependencies` can't resolve — that stays a declare + nudge case (and an onboarding
concern: §7 scaffolds `extraKnownMarketplaces` + `enabledPlugins`).

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

Forge plugins declare a real **`dependency` on `hcb-dev`** (C9): enabling a forge
plugin in a project auto-installs and transitively enables the baseline, so the
"complete dev experience" pair is enforced by the dependency graph, not just
convention. `expects_plugins` (§8) is then reserved for *optional* companions.
`hcb-dev` depends on nothing and ships `defaultEnabled: true` (it is the baseline).

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
| **0** | Vendor canon into `hcb-dev` (`rules/canonical/*`, `manifest.yml`); build `/hcb-dev:rules` (sync/check/diff) + drift guard. | `hcb-dev` only |
| **1** | Adopt in DALI + NEXUS: replace the 3 duplicated files with synced managed files; add `.claude/hcb-dev/rules.yml`; verify `labels.yml` companion contract. | dali, nexus |
| **2** | Language refactor: `language.md` (T2) + `.claude/hcb-dev/project.yml: languages`; remove contradictions; collapse scattered policy. | hcb-dev, dali, nexus |
| **3** | Onboarding + plugin-presence: `/hcb-dev:onboard`, `session-baseline.sh`, `expects_plugins`. | hcb-dev (+ consuming repos opt-in) |
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

---

## 12. Non-goals

- No backward-compatibility shims for the current hand-copied files — they are
  replaced in place (per each repo's `early-stage` policy).
- Onboarding scaffolds `settings.json` (marketplace + `enabledPlugins`) and relies
  on plugin **`dependencies`** (C9) to pull the baseline in; it installs plugins by
  no other means, and for *optional* companions it only nudges.
- No runtime plugin-load enforcement beyond declare + nudge + model self-check.
