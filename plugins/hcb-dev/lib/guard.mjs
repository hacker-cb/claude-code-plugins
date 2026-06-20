import { isManagedRulePath } from "./paths.mjs";

/** Tool calls that write files; the guard only ever blocks these. */
const WRITE_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);

/**
 * Decide a PreToolUse outcome for an attempted tool call. Returns a deny payload
 * when an `Edit`/`Write`/`NotebookEdit` targets a managed rule file, or `null`
 * ("no decision" — allow) otherwise. Bash file-commands are out of scope here;
 * the project's optional `permissions.deny` covers those.
 *
 * @param {{cwd?: string, tool_name?: string, tool_input?: Record<string, any>} | null | undefined} input
 *   parsed PreToolUse JSON (stdin)
 * @returns {{hookSpecificOutput: object} | null}
 */
export function guardDecision(input) {
  if (!input || !input.tool_name || !WRITE_TOOLS.has(input.tool_name)) return null;
  const filePath = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  if (!filePath || !isManagedRulePath(input.cwd ?? ".", filePath)) return null;
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        "This is an hcb-dev managed rule (.claude/rules/hcb/). Edit the canon in the " +
        "hcb-dev plugin and run `/hcb-dev:rules sync`; do not edit the synced copy.",
    },
  };
}
