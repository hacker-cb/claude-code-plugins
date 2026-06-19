# Design: dev baseline plugin + shared-rules synchronization

Status: **proposal** · Owner: hacker-cb · Last updated: 2026-06-19

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
`code.claude.com/docs` and the public issue tracker.

| # | Fact | Source / consequence |
|---|---|---|
| C1 | A plugin **cannot ship `.claude/rules/*.md`** to consuming projects. Rules are a project-local feature. | `memory.md`. The only plugin path to always-on context is a SessionStart hook printing to stdout (`additionalContext`). |
| C2 | `paths:` frontmatter scoping exists **only** for project-local rules, not hook-injected text. | `memory.md`. Hook-injected guidance is always-on and costs context every session. |
| C3 | Marketplace plugin install **does not initialize git submodules** (documented bug `anthropics/claude-code#17293`). | A submodule *inside a plugin* is dead. |
| C4 | An installed plugin **cannot reference files outside its own root** (`../shared` is not copied to cache). | Canonical content must be **vendored inside the plugin**, not linked. |
| C5 | A plugin **can bundle arbitrary non-component files** (`rules/`, `manifest.yml`); the whole plugin dir is copied to cache and is readable via `${CLAUDE_PLUGIN_ROOT}`. | Enables a canon-in-plugin + sync-skill design. |
| C6 | `${CLAUDE_PLUGIN_ROOT}` (plugin dir) and `CLAUDE_PROJECT_DIR` / hook `cwd` (project root) are both available to hooks and bin. | A hook can `sha256` a project file and compare against canon → drift detection works. |
| C7 | A plugin carries a `version` in `plugin.json`; consumers receive updates when that version bumps (explicit version) or per-commit (no version). There is **no per-project version pin** for a marketplace plugin. | The plugin's semver is the global propagation lever; per-project staging comes from sync being an explicit, reviewable action. |
| C8 | A SessionStart hook **cannot enumerate which plugins are loaded**. The stdin payload is `{ session_id, cwd, source, model }` only — no plugin list, no "first run" flag, and in cloud envs `.git` always exists (fresh clone). | Plugin-presence and new-project detection must be inferred, not read from an API. |

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
    session-baseline.sh         # NEW: drift warn + new-project + plugin-presence nudge
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

The sync skill records each managed file's expected hash inline in `rules.yml`,
so the drift guard can compare without network access.

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
markers: no `CLAUDE.md`, no `.claude/`, no `.claude/hcb-dev/project.yml`.

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

Honest scope: **partially solvable** — there is no hook API to list loaded
plugins (C8). The strategy:

1. The project declares its expected set in `.claude/hcb-dev/project.yml: expects_plugins`.
2. `session-baseline.sh` (guaranteed to run — it *is* `hcb-dev`) prints the
   expected set and a reminder: *"if any of these slash-commands / MCP tools are
   missing, the plugin failed to load — check `/plugin`"*.
3. **The model self-checks**: in-session it sees which skills / MCP tools are
   actually available and compares against the declared expectation. This is the
   most reliable detector available within current constraints.

`enabledPlugins` + `extraKnownMarketplaces` in `.claude/settings.json` (already
present in both repos) are what *should* auto-load; the nudge covers the case
where cloud load silently fails.

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

Claude Code has no plugin dependency/bundle mechanism, so this is a documentation
+ convention concern, surfaced through `expects_plugins` (§8).

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
- No attempt to auto-install plugins (unsupported — C7); onboarding only scaffolds
  `settings.json` and nudges the operator.
- No runtime plugin-load enforcement beyond declare + nudge + model self-check.
