# 1c-odata

Thin Claude Code plugin wrapper around the [`@1c-odata/mcp`](https://github.com/hacker-cb/1c-odata)
MCP server — query 1C:Enterprise databases over the OData V3 protocol: live schema introspection
and read-only OData queries, straight from your assistant.

It exposes tools such as `list_entities`, `describe_entity`, `query`, `get_entity`, `count` and
`register_query` (balances, turnovers, slices), backed by the published npm package and started on
demand via `npx @1c-odata/mcp@latest serve` (see [`.mcp.json`](.mcp.json)).

## Install

```text
/plugin marketplace add hacker-cb/claude-code-plugins
/plugin install 1c-odata@hacker-cb-plugins
```

## Configure a connection

The server stores connection descriptors (base URL, login, server timezone) outside this wrapper —
passwords go to the OS keychain. Add a connection once before use:

```text
npx @1c-odata/mcp add my-base
```

See the upstream [README](https://github.com/hacker-cb/1c-odata) for non-interactive setup and the
`ONEC_<NAME>_PASSWORD` / `ONEC_MCP_DATA_DIR` environment variables.

## Layout

This is an **external MCP wrapper** (`external_plugins/`): a version-less, upstream-named thin wrapper
around a third-party / own npm MCP server, mirroring the `anthropics/claude-plugins-official` layout.
The server itself — source code, tests, and npm publishing — lives in its own repository,
[`hacker-cb/1c-odata`](https://github.com/hacker-cb/1c-odata).
