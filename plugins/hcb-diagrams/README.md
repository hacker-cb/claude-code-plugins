# hcb-diagrams

Diagram-rendering skills for Claude Code — currently: render
[DBML](https://dbml.dbdiagram.io/docs/) database schemas into ER diagrams and
show them right in the chat. Part of the
[`hacker-cb-plugins`](https://github.com/hacker-cb/claude-code-plugins)
marketplace.

## Install

```text
/plugin marketplace add hacker-cb/claude-code-plugins
/plugin install hcb-diagrams@hacker-cb-plugins
```

## Skills

### `render-dbml` — `/hcb-diagrams:render-dbml`

Render a DBML schema (a `.dbml` file, a dbdiagram.io export, a snippet pasted
in chat — or SQL DDL that Claude first translates to DBML) into an
entity-relationship diagram, and show the image directly in the chat where the
environment supports it (e.g. Claude Code web / remote sessions); otherwise it
reports the output paths. The source `.dbml` is always referenced alongside
the images — important when it was generated on the fly (from SQL DDL, ORM
models, or a chat snippet), so the editable source isn't lost.

The pipeline is pure npm — **no native graphviz install needed**:

1. [`@softwaretechnik/dbml-renderer`](https://github.com/softwaretechnik-berlin/dbml-renderer)
   renders DBML → SVG (graphviz compiled to WASM);
2. [`@resvg/resvg-js`](https://github.com/thx/resvg-js) rasterizes
   SVG → PNG using system fonts.

Both outputs are produced: PNG for inline display, SVG as the lossless
zoomable original.

**Requirements:** `node` ≥ 18 and `npm`. The first render downloads the two
packages into `~/.cache/hcb-diagrams/` (network needed once); subsequent
renders work offline.

The bundled script can also be used standalone:

```bash
bash skills/render-dbml/scripts/render-dbml.sh -i schema.dbml [-o OUTDIR] [-w WIDTH] [--svg-only]
```

| Option | Default | Meaning |
| --- | --- | --- |
| `-i, --input` | — | DBML file (required) |
| `-o, --outdir` | input file's directory | where to write `*.svg` / `*.png` |
| `-w, --width` | `2400` | PNG width in px (raise for very large schemas) |
| `--svg-only` | off | skip PNG rasterization |

### Troubleshooting

- **Parse errors** — dbml-renderer points at the offending line; the skill's
  `references/dbml.md` lists the common causes (types with spaces, default
  quoting, unquoted reserved names).
- **PNG text renders as boxes** — no usable system fonts for resvg; use
  `--svg-only`.
- **First run fails to install** — npm registry access is required once to
  populate the cache.
