# How many agents run at once

Read by every skill that fans work out to subagents. It owns how many of them run side by side;
a review round paces its own launches, and how many batch sessions run is decided where they are
launched.

**At most four subagents at once.** Work split across subagents — readers over a slice, a second
blind reading, research for open decisions, runs in isolated worktrees — goes out four in one
message at most, the next only once those have returned. Work that needs more takes more waves,
never a larger one.

**Claude Code bounds a session too, and nothing bounds the sessions beside it.**
`CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` caps the subagents one session runs in parallel, and past
`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` the Agent tool refuses another launch, which is not retried
([env-vars](https://code.claude.com/docs/en/env-vars.md),
[sub-agents](https://code.claude.com/docs/en/sub-agents.md)). A launch refused that way is a
wave sent too wide: wait for the ones out, then send the rest.
