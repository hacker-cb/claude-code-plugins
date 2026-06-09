---
name: library-docs
description: >-
  Use whenever asked about a library, framework, SDK, API, CLI, or cloud
  service — how to call an API, configure something, migrate between versions,
  scaffold a project, or use a CLI command. Pull current documentation from the
  Context7 MCP server first, even for well-known tools (React, Django, Next.js,
  AWS, …) and even when you think you already know the answer, because training
  data may be stale. Prefer Context7 over web search; fall back to web search
  only if Context7 returns nothing. Requires the Context7 MCP server.
---

# Library documentation via Context7

Training data goes stale: APIs change, options get renamed, new majors ship.
When a question is about how to *use* a library, framework, SDK, API, CLI, or
cloud service, fetch current docs from Context7 rather than answering from
memory.

## When to use

Any time the task touches a third-party (or first-party) library / framework /
SDK / API / CLI / cloud service:

- API syntax and usage
- configuration and setup
- migrations and version differences
- CLI commands and flags

This applies **even to well-known tools** (React, Django, Next.js, AWS, …) and
**even when you think you know the answer** — verify against current docs first.

## How

1. Resolve the library to a Context7 ID, then fetch its docs via the Context7
   MCP tools (`resolve-library-id` → `get-library-docs`).
2. Base the answer on what Context7 returns — quote concrete option names,
   signatures, and config keys from the docs instead of recalling them.
3. **Fallback**: only if Context7 returns nothing useful, fall back to a web
   search.

## Requirements

Needs the Context7 MCP server connected. If it isn't available, say so plainly
and use web search as the fallback.
