import { syncFiles } from "./sync.mjs";
import { checkFiles } from "./drift.mjs";
import { guardDecision } from "./guard.mjs";
import { sessionStartReport } from "./session.mjs";

/**
 * @typedef {object} CliContext
 * @property {string} cwd          project directory (`process.cwd()` for user commands)
 * @property {string} pluginRoot   `${CLAUDE_PLUGIN_ROOT}`
 * @property {string} stdinText    raw stdin — the hook payload for `guard` / `session-start`, `""` otherwise
 * @property {(s: string) => void} log     stdout sink
 * @property {(s: string) => void} errlog  stderr sink
 */

/**
 * Parse a JSON string, returning `null` on any failure (used for hook stdin,
 * where a malformed payload must never throw).
 *
 * @param {string} text
 * @returns {any}
 */
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** @param {CliContext} ctx @returns {number} */
function cmdSync(ctx) {
  const r = syncFiles(ctx.pluginRoot, ctx.cwd);
  const parts = [];
  if (r.written.length) parts.push(`wrote ${r.written.join(", ")}`);
  if (r.unchanged.length) parts.push(`unchanged ${r.unchanged.join(", ")}`);
  if (r.removed.length) parts.push(`removed ${r.removed.join(", ")}`);
  ctx.log(`hcb-rules sync: ${parts.length ? parts.join("; ") : "nothing to do"}`);
  return 0;
}

/** @param {CliContext} ctx @returns {number} */
function cmdCheck(ctx) {
  const r = checkFiles(ctx.pluginRoot, ctx.cwd);
  if (r.ok) {
    ctx.log(`hcb-rules check: ${r.checked.length} managed rule(s) in sync`);
    return 0;
  }
  for (const d of r.drift) ctx.errlog(`  ${d.reason}: ${d.name} — ${d.detail}`);
  ctx.errlog(`hcb-rules check: ${r.drift.length} issue(s); run \`/hcb-dev:rules sync\` to reconcile`);
  return 1;
}

/** @param {CliContext} ctx @returns {number} */
function cmdGuard(ctx) {
  const decision = guardDecision(parseJson(ctx.stdinText));
  if (decision) ctx.log(JSON.stringify(decision));
  return 0;
}

/** @param {CliContext} ctx @returns {number} */
function cmdSessionStart(ctx) {
  const input = parseJson(ctx.stdinText);
  const cwd = input && typeof input.cwd === "string" ? input.cwd : ctx.cwd;
  try {
    const text = sessionStartReport(ctx.pluginRoot, cwd);
    if (text) ctx.log(text);
  } catch (e) {
    // A SessionStart hook must never break the session — degrade to a soft note.
    ctx.errlog(`hcb-rules session-start: ${String(e)}`);
  }
  return 0;
}

/**
 * Run the `hcb-rules` CLI. Pure over its injected {@link CliContext} (no direct
 * process / fs-cwd access), so it is fully unit-testable; the `bin/hcb-rules`
 * wrapper supplies the real process streams and environment. Returns the
 * process exit code.
 *
 * @param {string[]} argv arguments after the program name
 * @param {CliContext} ctx
 * @returns {number}
 */
export function runCli(argv, ctx) {
  const [cmd] = argv;
  try {
    switch (cmd) {
      case "sync":
        return cmdSync(ctx);
      case "check":
        return cmdCheck(ctx);
      case "guard":
        return cmdGuard(ctx);
      case "session-start":
        return cmdSessionStart(ctx);
      default:
        ctx.errlog(`hcb-rules: unknown command '${cmd ?? ""}'; expected one of sync, check, guard, session-start`);
        return 2;
    }
  } catch (e) {
    ctx.errlog(`hcb-rules ${cmd}: ${String(e)}`);
    return 1;
  }
}
