---
name: render-dbml
argument-hint: "[path/to/schema.dbml]"
description: >-
  Render a DBML database schema into an entity-relationship diagram (SVG +
  PNG) and show the image directly in the chat. Use whenever the user wants to
  visualize, render, draw, or "see" a database schema as a diagram: a .dbml
  file in the repo, a dbdiagram.io export, a DBML snippet pasted into chat, or
  schema sources that can be translated to DBML first (SQL DDL, migrations,
  ORM models). Trigger on requests like "render this dbml", "draw the database
  schema", "ER diagram for these tables", "покажи схему базы как диаграмму" —
  in any language, even when the word "DBML" never appears. Invoke this skill
  FIRST, before opening the schema file or attempting to render anything
  yourself — it bundles the entire working pipeline (no native graphviz
  needed, just node + npm).
---

# Render DBML → ER diagram in the chat

Turn a DBML schema into a diagram image and put the **image itself** in front
of the user — a bare file path is not the deliverable. The bundled
`scripts/render-dbml.sh` does the whole pipeline:
[dbml-renderer](https://github.com/softwaretechnik-berlin/dbml-renderer)
renders SVG via WASM graphviz (no system graphviz needed), then resvg
rasterizes a PNG using system fonts. The first run downloads two npm packages
into `~/.cache/hcb-diagrams/` and needs network; later runs work offline.

## Step 1 — Get the schema into a `.dbml` file

- A `.dbml` file already exists → use it as-is.
- DBML pasted in chat → write it verbatim to a temp file
  (e.g. `/tmp/schema.dbml`).
- SQL DDL, migrations, ORM models, or a verbal description → translate to
  DBML yourself, then render. Read [references/dbml.md](references/dbml.md)
  first — it has the syntax essentials and the parser pitfalls that cause
  most render failures.

## Step 2 — Render

Run the bundled script (resolve `<skill-dir>` to the directory containing
this SKILL.md):

```bash
bash <skill-dir>/scripts/render-dbml.sh -i schema.dbml [-o OUTDIR] [-w WIDTH] [--svg-only]
```

- On success it prints `SVG: <path>` and `PNG: <path>` (defaults: next to the
  input file).
- `-w` sets the PNG width in px (default 2400 — readable for most schemas).
  For very large schemas (30+ tables) raise it to 4000–6000; the SVG is
  always full, lossless quality.
- `--svg-only` skips the PNG step (use when rasterization fails or the user
  only wants SVG).
- On a parse error dbml-renderer reports the offending line. Fix the DBML —
  see the Troubleshooting section of
  [references/dbml.md](references/dbml.md) — and re-run; rendering is cheap,
  iterate freely.

## Step 3 — Show the diagram in the chat

This is the point of the skill — the user should see the picture without
leaving the conversation:

- If a file-sending tool is available (e.g. `SendUserFile` in Claude Code web
  / remote sessions), send the **PNG** — it displays as an inline image
  widget. Send the **SVG** alongside it so the user also gets the zoomable
  lossless original.
- In a local terminal session with no file-sending tool, give both absolute
  paths and offer to open the image (`open` / `xdg-open`).

Then glance at the result before declaring success: if the diagram is
obviously wrong (empty, missing tables the user asked about), say so and fix
it rather than presenting it as correct.

## Edge cases

- **Huge schemas** render tall/wide by nature. To focus on one subsystem,
  write a subset `.dbml` (just those tables plus the `Ref`s between them) and
  render that — offer this when a full diagram is unreadable.
- **The user iterates** ("now add the orders table", "rename that column"):
  edit the DBML, re-render, re-send. Each render takes a couple of seconds.
- **No network on first run**: the dependency install fails with a clear npm
  error. Tell the user the first run needs registry access (or a pre-warmed
  `~/.cache/hcb-diagrams/`).
- **PNG text looks empty/boxy**: no usable system fonts for resvg. Fall back
  to `--svg-only` and send the SVG.

## Supporting files

- [references/dbml.md](references/dbml.md) — DBML syntax essentials,
  SQL→DBML translation notes, troubleshooting parser errors. Read it before
  writing or fixing DBML by hand.
- `scripts/render-dbml.sh` — the rendering pipeline (execute, don't read).
- `scripts/svg-to-png.mjs` — resvg rasterizer used by the script.
