# markdown-docs

Thin Claude Code plugin wrapper around the [`markdown-docs-mcp`](https://github.com/hacker-cb/markdown-docs-mcp)
MCP server — efficient navigation of large markdown documents (datasheets, IEC/ISO standards, reference manuals)
without dumping the whole file into context.

It exposes four tools (`view_toc`, `read_section`, `search`, `analyze_document`) backed by the published
npm package, started on demand via `npx markdown-docs-mcp@latest` (see [`.mcp.json`](.mcp.json)).

## Install

```text
/plugin marketplace add hacker-cb/claude-code-plugins
/plugin install markdown-docs@hacker-cb-plugins
```

## Layout

This is an **external MCP wrapper** (`external_plugins/`): a version-less, upstream-named thin wrapper around a
third-party / own npm MCP server, mirroring the `anthropics/claude-plugins-official` layout. The server itself —
source code, tests, and npm publishing — lives in its own repository,
[`hacker-cb/markdown-docs-mcp`](https://github.com/hacker-cb/markdown-docs-mcp).
