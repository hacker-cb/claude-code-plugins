#!/usr/bin/env node
/**
 * tb.mjs — companion for the 淘宝桌面版 (Taobao desktop client) CLI RPC.
 *
 * One line of JSON on stdout, always. `ok` is the only success signal: the
 * client reports most real failures inside a successful envelope
 * ({"result":{"error":"…"}}), which the vendor CLI reports as exit 0.
 *
 * Usage: node tb.mjs <up|doctor|tools|call|search|read|lock|hook-preflight|hook-release> [flags]
 * No dependencies beyond the node: builtins.
 */

import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not the URL's pathname: on Windows that pathname is `/C:/…`, which
// is not a path anything can open.
const HERE = import.meta.dirname ?? path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

const EXIT = { ok: 0, tool: 1, gate: 2, transport: 3, timeout: 4, lock: 5, pathology: 6, protocol: 7, unknown: 7 };

/**
 * Call timeouts by tool class. The client has no timeout of its own, so this is
 * the only clock: a tool that works for minutes inside the client needs more of
 * it than a page read does, and both stay under the host's own call window so a
 * stall comes back as this companion's TIMEOUT, with its hint, rather than
 * killed together with the command carrying it. `--timeout` outranks the table.
 */
const TIMEOUT_MS = { default: 60000, slow: 110000 };

/**
 * Tools that keep working inside the client long after the request lands: a
 * search drives a results page, an image search clicks through every category
 * card on it.
 */
const SLOW_TOOLS = new Set(['image_search', 'search_products']);

const DEFAULT_MAX_INLINE = 8192;
const DEFAULT_SOURCE_APP = 'claude';
const PING_TIMEOUT_MS = 2500;
const STARTUP_WAIT_MS = 90000;
const STARTUP_POLL_MS = 500;
const PORT_FILE = 'cli-rpc-port.json';
const STARTUP_READY_FILE = 'startup-ready.json';
const CONFIG_FILE = 'config.json';
const WINDOWS_PIPE = '\\\\.\\pipe\\taobao-cli-rpc';
const USER_DATA_NAMES = ['taobao', 'com.alibaba.taobao'];
const CHAT_CONSENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Tools that change client state. The list is explicit on purpose: a regex over
 * verbs would silently misclassify the next tool the vendor adds. Anything that
 * moves the single shared background tab, or writes the shared scan buffer,
 * counts as mutating even when it reads no user data.
 */
const MUTATING_TOOLS = new Set([
  'navigate',
  'navigate_to_url',
  'close_page',
  'scroll_page',
  'scan_page_elements',
  'click_element',
  'input_text',
  'search_products',
  'image_search',
  'get_product_skus',
  'add_to_cart',
  'open_chat',
  'send_chat_message',
  'submit_product_rating',
  'trigger_keyboard_event',
  'trigger_key_sequence',
  'hold_keyboard_key',
]);

/**
 * Tools known to change nothing, so repeating one is harmless. A name in neither
 * set is treated as mutating: an unrecognised tool is never re-run behind the
 * caller's back and never runs unlocked.
 */
const READ_ONLY_TOOLS = new Set([
  '_ping',
  '_help',
  'get_browse_history',
  'get_current_tab',
  'inspect_page',
  'list_available_pages',
  'read_page_content',
]);

const mutates = (tool) => MUTATING_TOOLS.has(tool) || !READ_ONLY_TOOLS.has(tool);

const envInt = (name, def) => {
  const raw = process.env[name];
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : def;
};
const envNum = (name, def) => {
  const raw = process.env[name];
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : def;
};

const LEASE = {
  ttlMs: Math.max(5000, envInt('HCB_TAOBAO_LEASE_TTL_MS', 120000)),
  // Past this a live pid proves nothing: the number gets recycled.
  pidGraceMs: envInt('HCB_TAOBAO_LEASE_PID_GRACE_MS', 900000),
};

/**
 * The least a call is worth sending with. Below it the answer would be a TIMEOUT
 * this companion invented while the tool ran on inside the client — which for a
 * mutating tool means a change made and disowned, and for the regulator a signal
 * of trouble taken off a healthy client. A budget that cannot pay for this buys a
 * verdict instead of a call.
 */
const MIN_CALL_MS = Math.max(1000, envInt('HCB_TAOBAO_MIN_CALL_MS', 5000));

/**
 * The clock a call had to actually get for its silence to describe the client. A
 * budget shorter than a tool's own clock trims that clock, and a trim of a
 * moment still leaves an ordinary call's worth of time — a TIMEOUT on it is the
 * client being slow. Cut below this the answer was taken away rather than never
 * given, and the regulator is told nothing by it. Distinct from `MIN_CALL_MS`:
 * that decides whether a call is worth sending, this whether its silence is
 * worth believing.
 */
const INFORMATIVE_TIMEOUT_MS = Math.max(MIN_CALL_MS, envInt('HCB_TAOBAO_INFORMATIVE_TIMEOUT_MS', TIMEOUT_MS.default));

const SEARCH = {
  backoffBaseMs: envInt('HCB_TAOBAO_SEARCH_BACKOFF_MS', 300000),
  backoffFactor: envNum('HCB_TAOBAO_SEARCH_BACKOFF_FACTOR', 1.5),
  backoffCapMs: envInt('HCB_TAOBAO_SEARCH_BACKOFF_CAP_MS', 900000),
  maxAttempts: Math.max(1, envInt('HCB_TAOBAO_SEARCH_ATTEMPTS', 6)),
  canaryKeyword: process.env.HCB_TAOBAO_SEARCH_CANARY || '手机',
  // The control keyword is a control only as a product search. Asked of a slice
  // that answers nothing for any keyword — shop search is one — it reports a
  // block on every call, which is why the type is fixed here rather than taken
  // from the search being checked.
  canaryType: 'all',
  canaryTtlMs: envInt('HCB_TAOBAO_SEARCH_CANARY_TTL_MS', 60000),
  // One process is one call: waiting longer than this belongs to the caller.
  // Under the host's own call timeout, so the throttle verdict is returned rather
  // than killed with the command that was carrying it.
  budgetMs: Math.max(1000, envInt('HCB_TAOBAO_SEARCH_BUDGET_MS', 90000)),
};

/**
 * The pace regulator. Every call to the client is paced, not only the searches:
 * what draws attention is how fast pages are opened and how densely the client
 * is driven, which no single tool name owns.
 *
 * `classes` are the starting intervals per class of call, in milliseconds; the
 * interval actually applied is that number times a factor the regulator moves on
 * its own — up by multiplication when the client shows a sign of trouble, down
 * by subtraction after a run of clean calls.
 */
const PACE = {
  classes: {
    probe: envInt('HCB_TAOBAO_PACE_PROBE_MS', 0),
    read: envInt('HCB_TAOBAO_PACE_READ_MS', 600),
    // Not only what a click costs: a click that resolves a variant repaints the
    // price, and a read taken sooner than this returns the figure from before it.
    action: envInt('HCB_TAOBAO_PACE_ACTION_MS', 3000),
    navigate: envInt('HCB_TAOBAO_PACE_NAV_MS', 4000),
    // The old search-only knob still sets the search class, so a machine already
    // tuned by hand keeps its number.
    search: envInt('HCB_TAOBAO_PACE_SEARCH_MS', envInt('HCB_TAOBAO_SEARCH_INTERVAL_MS', 3000)),
  },
  growth: envNum('HCB_TAOBAO_PACE_GROWTH', 2),
  softGrowth: envNum('HCB_TAOBAO_PACE_SOFT_GROWTH', 1.4),
  decay: envNum('HCB_TAOBAO_PACE_DECAY', 0.5),
  decayAfter: Math.max(1, envInt('HCB_TAOBAO_PACE_DECAY_AFTER', 3)),
  maxFactor: Math.max(1, envNum('HCB_TAOBAO_PACE_MAX_FACTOR', 6)),
  // How long one call will sleep for pacing when the caller sets no budget of
  // its own. Past it the wait is handed back as retryAfterMs.
  maxWaitMs: envInt('HCB_TAOBAO_PACE_MAX_WAIT_MS', 30000),
  // Idleness earns back what a run of clean calls would have: nothing is learned
  // while nothing is called, so a factor raised yesterday must not still be
  // charged today.
  relaxMs: envInt('HCB_TAOBAO_PACE_RELAX_MS', 900000),
  // The ceiling for a paced wait plus the call it precedes, so both fit inside
  // the host's own call window.
  callWindowMs: Math.max(5000, envInt('HCB_TAOBAO_CALL_WINDOW_MS', 120000)),
  // While the client is signed out every call is answered here instead. One call
  // per this interval is let through for real to notice a sign-in nobody
  // announced — long enough that the client's login window is not raised over
  // and over, short enough that a hold cannot outlive the sign-in by much.
  loginRecheckMs: envInt('HCB_TAOBAO_LOGIN_RECHECK_MS', 300000),
};

/**
 * Codes that mean the client is pushing back. `hard` is Taobao itself refusing —
 * the block page, the silent throttle. `soft` is the client answering late,
 * empty or half-rendered. Any other pathology counts as soft. A sign-out is in
 * neither: it is where the session stands, and nothing about the pace it was
 * driven at, so it moves the tempo in no direction at all.
 */
const PACE_HARD_SIGNALS = new Set(['ANTI_BOT_BLOCK', 'SEARCH_SILENT_THROTTLE']);
const PACE_SOFT_SIGNALS = new Set([
  'PAGE_NOT_RENDERED', 'PAGE_CONTENT_TOO_SHORT', 'SCAN_FOUND_NOTHING',
  'SERVICE_UNAVAILABLE', 'TIMEOUT', 'EMPTY_RESPONSE',
]);

// ---------------------------------------------------------------------------
// options + output
// ---------------------------------------------------------------------------

const OPT = {
  sub: null,
  pos: [],
  flags: {},
  ascii: false,
  raw: false,
  noLock: false,
  // null until --timeout says otherwise: only then is one number right for every tool.
  timeout: null,
  maxInline: DEFAULT_MAX_INLINE,
  out: null,
  sourceApp: DEFAULT_SOURCE_APP,
  transport: 'auto',
};

const BOOLEAN_FLAGS = new Set(['no-lock', 'raw', 'ascii', 'help']);

/** The clock one call gets: what the caller asked for, else what its class allows. */
const toolTimeout = (tool) => OPT.timeout ?? (SLOW_TOOLS.has(tool) ? TIMEOUT_MS.slow : TIMEOUT_MS.default);

/**
 * The clock a call inside a budgeted run gets. A slow tool's own timeout outlasts
 * the budget of a `search`, and a call started with the budget nearly spent would
 * run past the host's call window and be killed with the command carrying it —
 * taking the verdict with it. What is left of the budget is the ceiling instead,
 * and `affordable` false means there is not enough of it left to send the call at
 * all: a clock shorter than the caller asked for is a ceiling, a clock too short
 * to answer under is a fabricated TIMEOUT.
 */
function budgetedTimeout(tool, leftMs, explicitMs) {
  const wanted = Number.isFinite(explicitMs) ? explicitMs : toolTimeout(tool);
  if (!Number.isFinite(leftMs)) return { affordable: true, timeout: wanted, wanted, needMs: 0 };
  const left = Math.floor(leftMs);
  // A clock the caller asked for outranks the floor: the floor never demands more
  // budget than the call was going to be given anyway.
  const needMs = Math.min(wanted, MIN_CALL_MS);
  return { affordable: left >= needMs, timeout: Math.min(wanted, Math.max(0, left)), wanted, needMs, leftMs: left };
}

function parseArgv(argv) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { pos.push(...argv.slice(i + 1)); break; }
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq !== -1) { flags[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const name = a.slice(2);
    const next = argv[i + 1];
    if (BOOLEAN_FLAGS.has(name) || next === undefined || next.startsWith('--')) flags[name] = true;
    else { flags[name] = next; i++; }
  }
  return { flags, pos };
}

let emitted = false;
let hookMode = false;

function toJsonLine(obj) {
  let s = JSON.stringify(obj);
  if (s === undefined) s = 'null';
  // --ascii escapes every non-ASCII code point so a console with a narrow
  // codepage cannot mangle the Chinese that comes back.
  if (OPT.ascii) s = s.replace(/[\u007f-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return s;
}

function emit(payload, exitCode) {
  if (emitted) return;
  emitted = true;
  // The lease outlives the process on purpose — see acquireLease.
  let line;
  try {
    line = toJsonLine(STATE.warning && payload && typeof payload === 'object' && payload.stateWarning === undefined
      ? { ...payload, stateWarning: STATE.warning }
      : payload);
  } catch {
    line = JSON.stringify({
      ok: false, kind: 'unknown', code: 'UNSERIALISABLE_RESULT',
      message: 'the answer could not be serialised to JSON',
      hint: 'Re-run with --out <path> so the raw answer is spilled to a file.',
      retriable: false,
    });
  }
  process.exitCode = exitCode;
  try {
    process.stdout.write(line + '\n', () => process.exit(exitCode));
  } catch {
    process.exit(exitCode);
  }
}

function succeed(obj) {
  emit({ ok: true, ...obj }, EXIT.ok);
}

function fail(f) {
  // A hook has no stdout to spend and no exit code to spare — see hookDone.
  if (hookMode) return hookDone(f.message ? `hook stopped: ${f.message}` : null);
  const kind = f.kind || 'unknown';
  const exitCode = f.code === 'TIMEOUT' ? EXIT.timeout : (EXIT[kind] ?? EXIT.unknown);
  const { kind: _k, ...rest } = f;
  emit({ ok: false, kind, retriable: false, ...rest }, exitCode);
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

/** Not unref'd: a sleep is the work itself, so it must hold the process open. */
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

const trunc = (s, n) => {
  const t = String(s ?? '');
  return t.length <= n ? t : t.slice(0, n) + '…';
};

/** Anything the companion remembers between calls, degraded rather than fatal. */
const STATE = { dir: null, warning: null };

/**
 * State sits next to Claude Code's own configuration. `CLAUDE_CONFIG_DIR` is a
 * real environment variable, so a hook and a plain Bash call resolve the same
 * path — which is the whole point, since the lease is written by one and read by
 * the other.
 */
function stateDir() {
  if (STATE.dir) return STATE.dir;
  const override = process.env.HCB_TAOBAO_STATE_DIR;
  if (override && override.trim()) {
    STATE.dir = path.resolve(override.trim());
    return STATE.dir;
  }
  const cfg = process.env.CLAUDE_CONFIG_DIR;
  let base = cfg && cfg.trim() ? path.resolve(cfg.trim()) : '';
  if (!base) {
    let home = '';
    try { home = os.homedir() || ''; } catch { /* fall through */ }
    if (!home) home = process.env.HOME || process.env.USERPROFILE || os.tmpdir();
    base = path.join(home, '.claude');
  }
  STATE.dir = path.join(base, 'hcb-taobao');
  return STATE.dir;
}

/** 0700 throughout: the lease, the pace file and the spills are this user's. */
function ensureDir(p) {
  try { fs.mkdirSync(p, { recursive: true, mode: 0o700 }); return true; } catch { return false; }
}

/** Returns the state directory, or null once — and records why it is gone. */
function ensureStateDir() {
  const d = stateDir();
  if (ensureDir(d)) return d;
  if (!STATE.warning) STATE.warning = `the state directory ${d} could not be created`;
  return null;
}

function readJsonFile(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

/** Durable small write: a torn owner.json or pace file would be worse than none. */
function writeFileAtomic(p, text) {
  const tmp = `${p}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
  try {
    fs.writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, p);
    return true;
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
    if (!STATE.warning) STATE.warning = `state could not be written to ${p} (${e.message})`;
    return false;
  }
}

const writeJsonAtomic = (p, obj) => writeFileAtomic(p, JSON.stringify(obj, null, 2));

const nonce = () => process.pid.toString(36) + Math.random().toString(36).slice(2, 8);

// ---------------------------------------------------------------------------
// classification data
// ---------------------------------------------------------------------------

const UNSUPPORTED_PREDICATES = new Set();

function loadData() {
  const p = path.join(HERE, 'pathologies.json');
  const d = readJsonFile(p);
  if (!d) return { dataVersion: 0, gates: [], toolErrors: [], pathologies: [], _missing: p };
  return {
    dataVersion: d.dataVersion ?? 0,
    gates: Array.isArray(d.gates) ? d.gates : [],
    toolErrors: Array.isArray(d.toolErrors) ? d.toolErrors : [],
    pathologies: Array.isArray(d.pathologies) ? d.pathologies : [],
  };
}

function loadBaseline() {
  return readJsonFile(path.join(HERE, 'protocol-baseline.json'));
}

const DATA = loadData();

const containsSignature = (haystack, signatures) => {
  if (!Array.isArray(signatures)) return null;
  const lower = haystack.toLowerCase();
  for (const s of signatures) {
    if (typeof s !== 'string' || !s) continue;
    if (haystack.includes(s) || lower.includes(s.toLowerCase())) return s;
  }
  return null;
};

/** Full page length, not the slice returned: --max 400 must not read as a stub. */
function pageLength(result) {
  if (typeof result.totalLength === 'number') return result.totalLength;
  if (typeof result.content === 'string') return result.content.length;
  return null;
}

function evalStructure(structure, result) {
  const evidence = {};
  // No structural test at all is a rule decided by its signatures alone.
  if (structure == null) return { ok: true, evidence };
  if (typeof structure !== 'object' || Array.isArray(structure)) return { ok: false, evidence };
  for (const [name, arg] of Object.entries(structure)) {
    switch (name) {
      case 'pageLengthAtMost': {
        const len = pageLength(result);
        if (len === null || !(len <= arg)) return { ok: false, evidence };
        evidence.pageLength = len;
        break;
      }
      case 'titleBlank': {
        const blank = !String(result.title ?? '').trim();
        if (blank !== Boolean(arg)) return { ok: false, evidence };
        evidence.titleBlank = blank;
        break;
      }
      case 'countEquals': {
        if (result.count !== arg) return { ok: false, evidence };
        evidence.count = result.count;
        break;
      }
      case 'hasArrayField': {
        if (!Array.isArray(result[arg])) return { ok: false, evidence };
        evidence[arg] = result[arg].length;
        break;
      }
      case 'numberFieldEquals': {
        if (!arg || typeof arg !== 'object') return { ok: false, evidence };
        if (result[arg.field] !== arg.value) return { ok: false, evidence };
        evidence[arg.field] = result[arg.field];
        break;
      }
      default:
        // An unknown predicate disables its rule rather than matching loosely;
        // `doctor` surfaces the name so the data file can be fixed.
        UNSUPPORTED_PREDICATES.add(name);
        return { ok: false, evidence };
    }
  }
  return { ok: true, evidence };
}

function signatureHaystack(result) {
  const parts = [];
  for (const k of ['content', 'title', 'message', 'text', 'dom']) {
    if (typeof result[k] === 'string') parts.push(result[k]);
  }
  if (!parts.length) {
    try { parts.push(JSON.stringify(result).slice(0, 4000)); } catch { /* ignore */ }
  }
  return parts.join('\n').slice(0, 8000);
}

function matchPathology(result, tool, suppress) {
  const hay = signatureHaystack(result);
  for (const rule of DATA.pathologies) {
    if (!rule || typeof rule.code !== 'string') continue;
    if (suppress && suppress.has(rule.code)) continue;
    if (Array.isArray(rule.appliesTo) && rule.appliesTo.length && !rule.appliesTo.includes(tool)) continue;
    const st = evalStructure(rule.structure, result);
    if (!st.ok) continue;
    const sig = containsSignature(hay, rule.signatures);
    if (rule.requireSignature && !sig) continue;
    return {
      kind: 'pathology',
      code: rule.code,
      message: rule.message || `the answer matched the ${rule.code} pathology`,
      hint: rule.hint,
      retriable: Boolean(rule.retriable),
      retryAfterMs: rule.retryAfterMs,
      evidence: { ...st.evidence, ...(sig ? { signature: sig } : {}) },
    };
  }
  return null;
}

/** The same gate the client would have answered with, raised without asking it. */
function gateOutcome(code) {
  const g = DATA.gates.find((x) => x.code === code);
  if (!g) return { kind: 'gate', code, message: code, retriable: false };
  return {
    kind: 'gate', code: g.code, message: g.message || g.code, hint: g.hint,
    retriable: Boolean(g.retriable), retryAfterMs: g.retryAfterMs,
  };
}

function fromErrorText(text, where) {
  for (const g of DATA.gates) {
    if (containsSignature(text, g.signatures)) {
      return {
        kind: 'gate', code: g.code, message: text, hint: g.hint,
        retriable: Boolean(g.retriable), retryAfterMs: g.retryAfterMs,
        evidence: { errorAt: where },
      };
    }
  }
  for (const t of DATA.toolErrors) {
    if (containsSignature(text, t.signatures)) {
      return {
        kind: 'tool', code: t.code, message: text, hint: t.hint,
        retriable: Boolean(t.retriable), retryAfterMs: t.retryAfterMs,
        evidence: { errorAt: where },
      };
    }
  }
  return {
    kind: 'tool', code: 'TOOL_ERROR', message: text,
    hint: 'The tool ran and refused. Read the message — it is the client\'s own wording; usually an argument is wrong or the page is not the one the tool expects.',
    retriable: false,
    evidence: { errorAt: where },
  };
}

const previewValue = (v) => {
  try { return trunc(JSON.stringify(v), 400); } catch { return String(v).slice(0, 400); }
};

/**
 * Order is the whole point: top-level error, then result.error (the client's
 * main defect — a refusal wrapped in a success envelope), then structural
 * pathologies, then ok. Anything unrecognised is `unknown`, never a success.
 */
function classify(envelope, tool, suppress) {
  if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return {
      kind: 'unknown', code: 'NOT_AN_ENVELOPE',
      message: 'the client answered with something that is not a {result}/{error} object',
      hint: 'Report this and pass the evidence on. Run `doctor` — the client may no longer match the recorded baseline.',
      retriable: false, evidence: { answer: previewValue(envelope) },
    };
  }

  const hasError = Object.prototype.hasOwnProperty.call(envelope, 'error');
  const hasResult = Object.prototype.hasOwnProperty.call(envelope, 'result');

  if (hasError && envelope.error != null) {
    if (typeof envelope.error !== 'string') {
      return {
        kind: 'unknown', code: 'NON_STRING_ERROR',
        message: 'the client returned a non-string error',
        hint: 'Report this and pass the evidence on.',
        retriable: false, evidence: { error: previewValue(envelope.error) },
      };
    }
    return fromErrorText(envelope.error, 'envelope.error');
  }

  if (!hasResult) {
    return {
      kind: 'unknown', code: 'NO_RESULT_FIELD',
      message: 'the answer carried neither result nor error',
      hint: 'Not a success. Run `doctor`; the client may no longer match the recorded baseline.',
      retriable: false, evidence: { answer: previewValue(envelope) },
    };
  }

  const result = envelope.result;

  if (result && typeof result === 'object' && !Array.isArray(result)) {
    if (result.error != null) {
      if (typeof result.error !== 'string') {
        return {
          kind: 'unknown', code: 'NON_STRING_ERROR',
          message: 'the client nested a non-string error inside a successful envelope',
          hint: 'Report this and pass the evidence on.',
          retriable: false, evidence: { error: previewValue(result.error) },
        };
      }
      if (result.error.trim()) return fromErrorText(result.error, 'result.error');
    }
    if (result.success === false || result.found === false) {
      const msg = [result.message, result.reason, result.detail].find((m) => typeof m === 'string' && m.trim());
      if (msg) return fromErrorText(msg, result.success === false ? 'result.success' : 'result.found');
      return {
        kind: 'tool', code: 'TOOL_REPORTED_FAILURE',
        message: `the tool reported ${result.success === false ? 'success:false' : 'found:false'} without a message`,
        hint: 'The tool ran and did not do what was asked. Check the arguments against the live schema (`tools --raw`) and the page the client is actually on (get_current_tab).',
        retriable: false, evidence: { result: previewValue(result) },
      };
    }
    const pathology = matchPathology(result, tool, suppress);
    if (pathology) return pathology;
  }

  return { kind: 'ok', result };
}

// ---------------------------------------------------------------------------
// address, runtime, app
// ---------------------------------------------------------------------------

function userDataCandidates() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (process.platform === 'win32') {
    // The vendor drops into its Linux branch when APPDATA is empty; derive it instead.
    const base = process.env.APPDATA || (home ? path.join(home, 'AppData', 'Roaming') : '');
    if (!base) return [];
    return USER_DATA_NAMES.map((n) => path.join(base, n));
  }
  if (process.platform === 'darwin') {
    const base = path.join(home, 'Library', 'Application Support');
    return USER_DATA_NAMES.map((n) => path.join(base, n));
  }
  const bases = [];
  if (process.env.XDG_CONFIG_HOME) bases.push(process.env.XDG_CONFIG_HOME);
  if (home) bases.push(path.join(home, '.config'));
  const out = [];
  for (const b of bases) for (const n of USER_DATA_NAMES) out.push(path.join(b, n));
  return out;
}

function addressCandidates() {
  const override = process.env.HCB_TAOBAO_SOCKET_PATH;
  if (override && override.trim()) return [{ socketPath: override.trim(), userDataDir: null, source: 'env' }];
  const out = [];
  for (const dir of userDataCandidates()) {
    const file = path.join(dir, PORT_FILE);
    const data = readJsonFile(file);
    if (!data) continue;
    if (data.socketPath != null) out.push({ socketPath: String(data.socketPath), userDataDir: dir, file, source: 'port-file' });
    else if (data.port != null) {
      // An unusable port has to be dropped here: net.createConnection throws on NaN
      // or an out-of-range number, which would escape the classifier as a crash.
      const port = Number(data.port);
      if (Number.isInteger(port) && port > 0 && port < 65536) out.push({ port, userDataDir: dir, file, source: 'port-file' });
    }
  }
  if (!out.length && process.platform === 'win32') {
    // The pipe name is fixed, so a missing address file is not fatal on Windows.
    out.push({ socketPath: WINDOWS_PIPE, userDataDir: userDataCandidates()[0] ?? null, source: 'well-known-pipe' });
  }
  return out;
}

let addressCache = null;

/**
 * A port file outlives the client that wrote it, so the first one parsed is not
 * the address — the one that answers is. A single candidate is handed back
 * unprobed: the call about to be made is its own probe.
 */
async function resolveAddress(opts = {}) {
  if (addressCache && !opts.fresh) return addressCache;
  if (opts.fresh) addressCache = null;
  const cands = addressCandidates();
  if (!cands.length) return null;
  if (cands.length === 1) { addressCache = cands[0]; return addressCache; }
  for (const c of cands) {
    if ((await ping(c, opts.timeoutMs ?? PING_TIMEOUT_MS)).alive) {
      addressCache = { ...c, verified: true };
      return addressCache;
    }
  }
  // Nothing answered: name a real candidate so the failure is about an address.
  return { ...cands[0], verified: false };
}

function activeUserDataDir() {
  for (const dir of userDataCandidates()) {
    if (fs.existsSync(path.join(dir, PORT_FILE)) || fs.existsSync(path.join(dir, CONFIG_FILE))) return dir;
  }
  return null;
}

/** The Wangwang consent runs out on a clock the client records; null when unset. */
function chatConsent(config) {
  const at = Number(config?.mcpChatAgreedAt);
  if (!Number.isFinite(at) || at <= 0) return null;
  const leftMs = at + CHAT_CONSENT_TTL_MS - Date.now();
  return { leftMs, expiresInDays: Math.round((leftMs / 86400000) * 10) / 10, lapsed: leftMs <= 0 };
}

function resolveRuntime() {
  if (process.versions.electron) {
    return { kind: 'electron', exec: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' }, node: process.versions.node };
  }
  return { kind: 'node', exec: process.execPath, env: {}, node: process.versions.node };
}

function resolveAppPath() {
  const override = process.env.HCB_TAOBAO_APP_PATH;
  if (override && fs.existsSync(override)) return override;
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (process.platform === 'darwin') {
    const names = ['淘宝桌面版.app', 'Taobao.app'];
    for (const base of ['/Applications', home ? path.join(home, 'Applications') : null].filter(Boolean)) {
      for (const n of names) {
        const p = path.join(base, n);
        if (fs.existsSync(p)) return p;
      }
    }
    try {
      const r = spawnSync('mdfind', ["kMDItemCFBundleIdentifier == 'com.alibaba.taobao'"], { encoding: 'utf8', timeout: 5000 });
      const hit = String(r.stdout || '').split('\n').map((s) => s.trim()).find((s) => s.endsWith('.app') && fs.existsSync(s));
      if (hit) return hit;
    } catch { /* ignore */ }
    return null;
  }
  if (process.platform === 'win32') {
    const roots = [
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs') : null,
      process.env.ProgramFiles || null,
      process.env['ProgramFiles(x86)'] || null,
    ].filter(Boolean);
    for (const root of roots) {
      let entries = [];
      try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const exe = path.join(root, e.name, '淘宝桌面版.exe');
        if (fs.existsSync(exe)) return exe;
      }
    }
    return null;
  }
  return null;
}

function readAppVersion(appPath) {
  if (!appPath || process.platform !== 'darwin') return null;
  const plist = path.join(appPath, 'Contents', 'Info.plist');
  try {
    const raw = fs.readFileSync(plist, 'utf8');
    const m = raw.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]*)<\/string>/);
    if (m) return m[1].trim();
  } catch { /* fall through to the binary-plist path */ }
  try {
    const r = spawnSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', plist], { encoding: 'utf8', timeout: 5000 });
    if (r.status === 0 && r.stdout) return r.stdout.trim();
  } catch { /* ignore */ }
  return null;
}

function vendorCliPath(appPath) {
  if (!appPath) return null;
  const candidates = process.platform === 'darwin'
    ? [path.join(appPath, 'Contents', 'bin', 'cli-rpc.js')]
    : [path.join(path.dirname(appPath), 'bin', 'cli-rpc.js'), path.join(appPath, 'bin', 'cli-rpc.js')];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

// ---------------------------------------------------------------------------
// transport
// ---------------------------------------------------------------------------

function parseWireLine(s) {
  const t = String(s).trim();
  if (!t) return { status: 'closed' };
  try { return { status: 'ok', envelope: JSON.parse(t) }; } catch { return { status: 'badjson', raw: trunc(t, 400) }; }
}

/** One connection carries exactly one request and one line of answer. */
function rpcSocket(addr, body, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let buf = '';
    let socket = null;
    const done = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket?.destroy(); } catch { /* ignore */ }
      resolve(r);
    };
    const timer = setTimeout(() => done({ status: 'timeout', timeoutMs }), timeoutMs);
    timer.unref?.();
    try {
      socket = addr.socketPath != null ? net.createConnection(addr.socketPath) : net.createConnection(addr.port, '127.0.0.1');
    } catch (e) {
      return done({ status: 'error', error: e });
    }
    // utf8 decoding on the stream: a Chinese code point split across two chunks
    // would otherwise arrive as replacement characters.
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buf += chunk;
      const i = buf.indexOf('\n');
      if (i !== -1) done(parseWireLine(buf.slice(0, i)));
    });
    socket.on('error', (e) => done({ status: 'error', error: e }));
    socket.on('close', () => {
      // The server closes right after answering; an answer without its newline still counts.
      if (buf.trim()) done(parseWireLine(buf));
      else done({ status: 'closed' });
    });
    try { socket.write(JSON.stringify(body) + '\n', 'utf8'); } catch (e) { done({ status: 'error', error: e }); }
  });
}

/**
 * The vendor CLI rewrites the request JSON before parsing it (its CMD-quoting
 * repair), which corrupts empty strings and strings ending in whitespace. Detect
 * those rather than hand it a payload it will silently alter.
 */
function cliPayloadUnsafe(body) {
  let s;
  try { s = JSON.stringify(body); } catch { return 'the payload is not serialisable'; }
  if (/"\s*"\s*[,}\]]/.test(s) || /"\s*"\s*$/.test(s)) return 'an empty string value would be rewritten by the vendor CLI';
  if (/\s"\s*[,}\]]/.test(s)) return 'a string ending in whitespace would be trimmed by the vendor CLI';
  return null;
}

function rpcCli(body, timeoutMs) {
  return new Promise((resolve) => {
    const app = resolveAppPath();
    const cli = vendorCliPath(app);
    if (!cli) return resolve({ status: 'error', error: Object.assign(new Error('vendor cli-rpc.js not found'), { code: 'ENOENT_CLI' }) });
    const unsafe = cliPayloadUnsafe(body);
    if (unsafe) return resolve({ status: 'unsafe', reason: unsafe });

    const dir = ensureStateDir() ?? os.tmpdir();
    const reqFile = path.join(dir, `req-${nonce()}.json`);
    try { fs.writeFileSync(reqFile, JSON.stringify(body), { encoding: 'utf8', mode: 0o600 }); } catch (e) { return resolve({ status: 'error', error: e }); }

    const rt = resolveRuntime();
    let child;
    let out = '';
    let settled = false;
    const done = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { fs.rmSync(reqFile, { force: true }); } catch { /* ignore */ }
      try { child?.kill('SIGKILL'); } catch { /* ignore */ }
      resolve(r);
    };
    const timer = setTimeout(() => done({ status: 'timeout', timeoutMs }), timeoutMs);
    timer.unref?.();
    try {
      child = spawn(rt.exec, [cli, '--request', reqFile], {
        env: { ...process.env, ...rt.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      return done({ status: 'error', error: e });
    }
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { out += c; });
    child.on('error', (e) => done({ status: 'error', error: e }));
    child.on('close', () => {
      const line = out.split('\n').map((s) => s.trim()).filter(Boolean).pop();
      if (!line) return done({ status: 'closed' });
      done(parseWireLine(line));
    });
  });
}

function transportFailure(res, tool) {
  if (res.status === 'timeout') {
    return {
      kind: 'transport', code: 'TIMEOUT',
      message: `the client did not answer within ${res.timeoutMs ?? toolTimeout(tool)} ms`,
      hint: 'The client has no timeout of its own, so the call is probably still running server-side. Wait before repeating anything that changes state; raise --timeout for a cold client, whose first call after idling takes several seconds.',
      retriable: true, tool,
    };
  }
  if (res.status === 'unsafe') {
    return {
      kind: 'transport', code: 'CLI_TRANSPORT_UNSAFE_ARGS',
      message: res.reason,
      hint: 'Use --transport socket. The vendor CLI rewrites request JSON before parsing it, so these arguments would reach the client altered.',
      retriable: false, tool,
    };
  }
  if (res.status === 'badjson') {
    return {
      kind: 'protocol', code: 'BAD_JSON',
      message: 'the client answered with something that is not JSON',
      hint: 'Not a success. Run `doctor` — the client may no longer match the recorded baseline. The companion never repairs malformed JSON, because a repaired request is a silently different request.',
      retriable: false, tool, evidence: { raw: res.raw },
    };
  }
  if (res.status === 'closed') {
    return {
      kind: 'transport', code: 'EMPTY_RESPONSE',
      message: 'the client closed the connection without answering',
      hint: 'Run `up`. If the client is running, it may still be loading — give it a few seconds.',
      retriable: true, tool,
    };
  }
  const code = res.error?.code;
  if (code === 'ENOENT' || code === 'ECONNREFUSED' || code === 'ENOENT_CLI') {
    return {
      kind: 'transport', code: 'CLIENT_NOT_RUNNING',
      message: `cannot reach the client (${code})`,
      hint: 'The client is not running, or its address file is stale. Run `up` — it starts the client and waits for the home page.',
      retriable: true, tool,
    };
  }
  return {
    kind: 'transport', code: 'CONNECT_FAILED',
    message: `connection failed: ${res.error?.message || code || 'unknown error'}`,
    hint: 'Run `up`.',
    retriable: true, tool,
  };
}

/**
 * Verdicts this companion reached without asking the client, because what the
 * caller had left would not pay for the call. Nothing ran, so nothing about them
 * describes the client.
 */
const OUT_OF_BUDGET = new Set(['PACE_WAIT_EXCEEDS_BUDGET', 'CALL_BUDGET_EXHAUSTED']);

/**
 * The one door to the client: every call goes through here, so the pace
 * regulator and the sign-out hold are applied to all of them rather than to a
 * chosen few. Returns a classification plus timing, the pace fragment and the
 * wire envelope.
 *
 * `opts.paceBudgetMs` is what the caller can still afford to wait; without one
 * the regulator's own ceiling applies. `opts.bypassLoginHold` is for the call
 * that asks the client for real while a hold stands.
 */
async function callTool(tool, args, opts = {}) {
  const t0 = Date.now();
  const body = { tool, arguments: args ?? {} };
  const klass = paceClass(tool, body.arguments);
  const st = paceState(t0);

  // `_ping` is answered by the transport before the client's own layers see it,
  // so liveness can still be asked while a hold stands; `up` asks for real
  // because the user may have just signed in.
  const bypassHold = Boolean(opts.bypassLoginHold) || tool === '_ping';
  if (st.hold && !bypassHold) {
    // A pseudo-tool is diagnostics, so it is answered out of the hold whatever
    // the clock says: it cannot prove the session is back, and spending the one
    // recheck a real call is waiting for would hold that call another interval.
    if (klass === 'probe' || t0 - st.hold.lastAskedAt < PACE.loginRecheckMs) return heldForLogin(st, klass, tool, t0);
    // The self-check is one real call, and it counts as an ask whatever comes
    // back: a process that dies mid-call must not free the next one to ask again.
    writePace({ loginHold: { ...st.hold, lastAskedAt: t0 } });
    st.hold = { ...st.hold, lastAskedAt: t0 };
  }

  const { intervalMs, waitMs } = paceWait(st, klass, Date.now());
  const budgetMs = Number.isFinite(opts.paceBudgetMs) ? opts.paceBudgetMs : PACE.maxWaitMs;
  if (waitMs > budgetMs) {
    // One process is one call: a wait that does not fit is handed back rather
    // than slept through past the window the caller has.
    return {
      kind: 'pathology', code: 'PACE_WAIT_EXCEEDS_BUDGET',
      message: `the pace regulator holds the next ${klass} call for another ${waitMs} ms and only ${Math.max(0, Math.round(budgetMs))} ms of this call's budget is left`,
      hint: 'Nothing was asked of the client. Wait out `retryAfterMs`, then repeat the same call. The interval grows when the client shows trouble and shrinks again after a run of clean calls — `pace.raisedBy` names what raised it.',
      retriable: true, retryAfterMs: Math.max(1000, waitMs),
      tool, ms: Date.now() - t0, via: 'pace',
      pace: { class: klass, intervalMs, factor: st.factor, pendingMs: waitMs, ...(st.raisedBy ? { raisedBy: st.raisedBy } : {}) },
    };
  }
  // The clock left for the call itself, so a paced wait plus a slow tool still
  // fits the host's call window and the verdict comes back rather than being
  // killed with the command carrying it. Decided before the wait is slept: a call
  // the budget cannot pay for is one to hand back now, not after sleeping for it.
  const clockBudgetMs = (Number.isFinite(opts.paceBudgetMs) ? opts.paceBudgetMs : PACE.callWindowMs) - waitMs;
  const clock = budgetedTimeout(tool, clockBudgetMs, opts.timeout);
  if (!clock.affordable) {
    // Nothing is asked of the client: a call given a remainder this small comes
    // back as a TIMEOUT this companion invented, while the tool it started runs
    // on inside the client with nobody left to read the answer.
    return {
      kind: 'pathology', code: 'CALL_BUDGET_EXHAUSTED',
      message: `the call was not sent: ${Math.max(0, clock.leftMs)} ms of this call's budget would be left for it, short of the ${clock.needMs} ms a ${tool} call needs to be worth starting`,
      hint: 'Nothing was asked of the client, so nothing changed there. Repeat the same call with a budget of its own — a call handed the remainder of a spent one is abandoned mid-flight while the tool keeps running inside the client.',
      retriable: true, retryAfterMs: Math.max(1000, waitMs),
      tool, ms: Date.now() - t0, via: 'budget',
      pace: { class: klass, intervalMs, factor: st.factor, pendingMs: waitMs, ...(st.raisedBy ? { raisedBy: st.raisedBy } : {}) },
    };
  }

  if (waitMs > 0) await sleep(waitMs);
  const waited = waitMs > 0 ? waitMs : 0;
  const timeout = clock.timeout;

  const finish = (outcome, extra = {}) => {
    const pace = recordPace(klass, outcome, st, waited, intervalMs, tool);
    const hold = paceState().hold;
    return {
      ...outcome, tool, ...extra, pace,
      ...(hold ? { loginHold: { waitingForLoginMs: Math.max(0, Date.now() - hold.since), nextClientCheckInMs: Math.max(0, hold.lastAskedAt + PACE.loginRecheckMs - Date.now()) } } : {}),
    };
  };

  const wantCli = OPT.transport === 'cli';
  const addr = wantCli ? null : await resolveAddress();

  if (!wantCli && !addr) {
    return finish(transportFailure({ status: 'error', error: { code: 'ENOENT' } }, tool), { ms: Date.now() - t0, via: 'socket' });
  }

  let via = wantCli ? 'cli' : 'socket';
  let res = wantCli ? await rpcCli(body, timeout) : await rpcSocket(addr, body, timeout);

  const shapeIsWrong = res.status === 'badjson'
    || (res.status === 'ok' && ['NOT_AN_ENVELOPE', 'NO_RESULT_FIELD'].includes(classify(res.envelope, tool, opts.suppress).code));

  // Auto-fallback only for a tool known to change nothing: any other call has
  // already executed server-side even when its answer was unreadable, and a tool
  // this build has never heard of is exactly the one not to run twice.
  if (OPT.transport === 'auto' && shapeIsWrong && READ_ONLY_TOOLS.has(tool)) {
    const alt = await rpcCli(body, timeout);
    if (alt.status === 'ok') { res = alt; via = 'cli-fallback'; }
  }

  const ms = Date.now() - t0;
  if (res.status !== 'ok') {
    const failure = transportFailure(res, tool);
    // A clock this side cut to fit the caller's budget is worth saying so on. What
    // the regulator does with the timeout turns on how deep the cut went: a slow
    // tool trimmed by a moment still had more than an ordinary call gets and its
    // silence is the client's, while one cut to a fraction of its clock was taken
    // away rather than left unanswered, so the regulator is told nothing by it.
    if (failure.code === 'TIMEOUT' && clock.timeout < clock.wanted) {
      const informative = clock.timeout >= Math.min(clock.wanted, INFORMATIVE_TIMEOUT_MS);
      failure.evidence = {
        ...(failure.evidence || {}),
        clockMs: clock.timeout, wantedMs: clock.wanted,
        ...(informative ? {} : { budgetTruncated: true }),
      };
      const verdict = informative
        ? `still past the ${INFORMATIVE_TIMEOUT_MS} ms an ordinary call gets, so the pace was raised for it`
        : 'too little for the silence to be the client\'s, so the pace was not raised for it';
      failure.hint = `${failure.hint} This call's clock was cut to ${clock.timeout} ms to fit the budget it was given, short of the ${clock.wanted} ms the tool would otherwise have had — ${verdict}.`;
    }
    return finish(failure, { ms, via });
  }
  if (res.envelope === undefined) {
    return finish({ kind: 'unknown', code: 'EMPTY_ENVELOPE', message: 'the client answered with nothing', hint: 'Not a success. Run `doctor`.', retriable: false }, { ms, via });
  }
  return finish(classify(res.envelope, tool, opts.suppress), { ms, via, envelope: res.envelope });
}

async function ping(addr, timeoutMs = PING_TIMEOUT_MS) {
  const res = await rpcSocket(addr, { tool: '_ping', arguments: {} }, timeoutMs);
  if (res.status !== 'ok') return { alive: false, res };
  return { alive: true, envelope: res.envelope };
}

// ---------------------------------------------------------------------------
// spill + summaries
// ---------------------------------------------------------------------------

const parsePrice = (v) => {
  const n = Number(String(v ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : NaN;
};

const stripImageSuffix = (u) => String(u ?? '').replace(/_\.webp$/i, '');

function summarise(tool, r) {
  if (r === null || typeof r !== 'object') return { value: trunc(String(r), 200) };
  if (Array.isArray(r)) return { length: r.length, sample: r.slice(0, 3).map((x) => trunc(previewValue(x), 120)) };

  if (Array.isArray(r.products)) {
    const ps = r.products;
    const prices = ps.map((p) => parsePrice(p?.price)).filter(Number.isFinite);
    const s = {
      keyword: r.keyword,
      type: r.type,
      count: typeof r.count === 'number' ? r.count : ps.length,
      shops: new Set(ps.map((p) => p?.shopName).filter(Boolean)).size,
    };
    if (prices.length) s.priceRange = [String(Math.min(...prices)), String(Math.max(...prices))];
    s.samples = ps.slice(0, 3).map((p) => ({
      itemId: p?.itemId, title: trunc(p?.title, 70), price: p?.price, shopName: trunc(p?.shopName, 40),
    }));
    return s;
  }
  // An image search groups its products under categories instead of returning
  // them flat, so the count the caller is asking about is one level down.
  if (Array.isArray(r.categories)) {
    const ps = r.categories.flatMap((c) => (Array.isArray(c?.products) ? c.products : []));
    return {
      count: typeof r.totalProducts === 'number' ? r.totalProducts : ps.length,
      categories: r.categories.length,
      shops: new Set(ps.map((p) => p?.shopName).filter(Boolean)).size,
      samples: ps.slice(0, 3).map((p) => ({
        itemId: p?.itemId, title: trunc(p?.title, 70), price: p?.price, shopName: trunc(p?.shopName, 40),
      })),
    };
  }
  if (typeof r.content === 'string') {
    return {
      title: trunc(r.title, 80), url: trunc(r.url, 160),
      chars: r.content.length, totalLength: r.totalLength, truncated: r.truncated,
      remainingLength: r.remainingLength, preview: trunc(r.content.replace(/\s+/g, ' ').trim(), 200),
    };
  }
  if (Array.isArray(r.items)) {
    return {
      type: r.type, count: typeof r.count === 'number' ? r.count : r.items.length,
      samples: r.items.slice(0, 3).map((i) => ({
        itemId: i?.itemId, title: trunc(i?.title, 70), shopName: trunc(i?.shopName, 40),
        price: i?.discountedPrice ?? i?.originalPrice, imageUrl: trunc(stripImageSuffix(i?.imageUrl), 120),
      })),
    };
  }
  if (Array.isArray(r.pages)) {
    return { count: r.pages.length, names: r.pages.slice(0, 16).map((p) => p?.name).filter(Boolean) };
  }
  if (Array.isArray(r.tools)) {
    return { count: r.tools.length, names: r.tools.map((t) => t?.name).filter(Boolean) };
  }
  if (typeof r.dom === 'string') {
    return { totalElements: r.totalElements, chars: r.dom.length, preview: trunc(r.dom.replace(/\s+/g, ' ').trim(), 200) };
  }
  const s = { keys: Object.keys(r).slice(0, 24) };
  for (const [k, v] of Object.entries(r)) {
    if (Array.isArray(v)) s[`${k}Length`] = v.length;
    else if (typeof v === 'string' && v.length > 200) s[`${k}Chars`] = v.length;
  }
  return s;
}

function spillDir() {
  const base = path.join(stateDir(), 'results');
  ensureDir(base);
  return base;
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '') + '-' + Math.random().toString(36).slice(2, 6);

/** Large results go to a file; stdout keeps a summary that answers "did anything turn up". */
function finishOk(tool, ms, result, extra = {}) {
  const head = { tool, ms, ...extra };
  let bytes = 0;
  try { bytes = Buffer.byteLength(JSON.stringify(result) ?? 'null', 'utf8'); } catch { bytes = Infinity; }

  if (!OPT.out && bytes <= OPT.maxInline) return succeed({ ...head, result });

  const file = OPT.out ? path.resolve(OPT.out) : path.join(spillDir(), `${tool}-${stamp()}.json`);
  try {
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, JSON.stringify({ tool, ms, ...extra, result }, null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch (e) {
    if (bytes === Infinity) {
      return fail({
        kind: 'unknown', code: 'UNSERIALISABLE_RESULT',
        message: `the result could not be written: ${e.message}`,
        hint: 'Pass --out <path> to a writable directory.', retriable: false, tool, ms,
      });
    }
    return succeed({ ...head, result, spillError: e.message });
  }
  return succeed({ ...head, resultFile: file, bytes, summary: summarise(tool, result) });
}

function emitClassified(cls, extra = {}) {
  const raw = OPT.raw && cls.envelope !== undefined ? { raw: cls.envelope } : {};
  // The tempo travels with every answer: a caller that is being slowed down has
  // to be able to see it, and by what.
  const meta = {
    ...(cls.pace ? { pace: cls.pace } : {}),
    ...(cls.loginHold ? { loginHold: cls.loginHold } : {}),
  };
  if (cls.kind === 'ok') {
    return finishOk(cls.tool, cls.ms, cls.result, { ...(cls.via ? { via: cls.via } : {}), ...meta, ...extra, ...raw });
  }
  const { kind, code, message, hint, retriable, retryAfterMs, evidence, tool, ms, via } = cls;
  fail({
    kind, code, message, hint, retriable: Boolean(retriable),
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    ...(evidence ? { evidence } : {}),
    ...(tool ? { tool } : {}), ...(ms !== undefined ? { ms } : {}), ...(via ? { via } : {}),
    ...meta, ...extra, ...raw,
  });
}

// ---------------------------------------------------------------------------
// cross-session lease
// ---------------------------------------------------------------------------

const lockDirPath = () => path.join(stateDir(), 'client.lock.d');
const ownerPath = (dir) => path.join(dir, 'owner.json');
const lockModePath = () => path.join(stateDir(), 'lock-mode');

/** Set from a hook payload's session_id, which outranks the environment. */
let sessionOverride = null;

function sessionId() {
  if (sessionOverride) return sessionOverride;
  for (const k of ['HCB_TAOBAO_SESSION_ID', 'CLAUDE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID']) {
    const v = process.env[k];
    if (v && v.trim()) return v.trim();
  }
  return `ppid:${process.ppid}`;
}

const LOCK_MODES = ['off', 'warn', 'ask', 'deny'];

/**
 * `CLAUDE_PLUGIN_OPTION_LOCK_MODE` is exported only into processes Claude Code
 * spawns from plugin config, which a Bash call is not — so the preflight hook,
 * which does see it, writes it down and every later call reads it from there.
 * The first source that has anything to say decides; a value that names no known
 * mode means warn rather than a silent `off`.
 */
function lockModeInfo() {
  const sources = [
    ['HCB_TAOBAO_LOCK_MODE', process.env.HCB_TAOBAO_LOCK_MODE],
    ['CLAUDE_PLUGIN_OPTION_LOCK_MODE', process.env.CLAUDE_PLUGIN_OPTION_LOCK_MODE],
    ['state', readLockModeFile()],
  ];
  for (const [source, raw] of sources) {
    if (raw == null) continue;
    const v = String(raw).trim().toLowerCase();
    if (!v) continue;
    return LOCK_MODES.includes(v) ? { mode: v, source } : { mode: 'warn', source, unknown: v };
  }
  return { mode: 'warn', source: 'default' };
}

const lockMode = () => lockModeInfo().mode;

function readLockModeFile() {
  try { return fs.readFileSync(lockModePath(), 'utf8'); } catch { return null; }
}

/** Hook-only: carries the plugin option across to plain Bash calls. */
function persistLockMode() {
  const raw = process.env.CLAUDE_PLUGIN_OPTION_LOCK_MODE;
  if (raw == null || !String(raw).trim()) return null;
  const v = String(raw).trim().toLowerCase();
  if (!ensureStateDir()) return null;
  if (readLockModeFile()?.trim().toLowerCase() === v) return null;
  return writeFileAtomic(lockModePath(), `${v}\n`) ? v : null;
}

const leaseTtlOf = (owner) => {
  const ttl = Number(owner?.leaseMs);
  return Number.isFinite(ttl) && ttl > 0 ? ttl : LEASE.ttlMs;
};

function leaseLeftMs(owner) {
  const at = Number(owner?.renewedAt);
  if (!Number.isFinite(at)) return null;
  return at + leaseTtlOf(owner) - Date.now();
}

function pidLooksAlive(owner) {
  if (!owner || owner.host !== os.hostname()) return false;
  const pid = Number(owner.pid);
  if (!Number.isInteger(pid) || pid <= 1) return false;
  const at = Number(owner.renewedAt);
  if (!Number.isFinite(at) || Date.now() - at > LEASE.pidGraceMs) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/**
 * A lease, not a process. The holder's process exits between calls — a chain of
 * navigate → read → click is one driver across several of them — so liveness is
 * the freshness of the lease. A process still running past its lease is a call
 * in flight and holds it too, which is why the pid is recorded.
 */
function holderIsAlive(dir, owner) {
  if (!owner) {
    // The winner of mkdir has not written owner.json yet; a brand-new directory
    // is a lease being taken, not an orphan.
    try {
      const st = fs.statSync(dir);
      return Date.now() - Math.max(st.birthtimeMs || 0, st.ctimeMs || 0) < 2000;
    } catch { return false; }
  }
  const left = leaseLeftMs(owner);
  if (left !== null && left > 0) return true;
  return pidLooksAlive(owner);
}

const ownerMatches = (owner, expect) => Boolean(
  owner && expect && (
    (expect.nonce && owner.nonce === expect.nonce)
    || (expect.sessionId && owner.sessionId === expect.sessionId)
  ),
);

/**
 * Removes at most one socket, and only one this companion could have written:
 * an `endpoint` in a lease record is data, and data never names a path to delete.
 */
function removeStateSocket(p) {
  if (typeof p !== 'string' || !p || process.platform === 'win32') return;
  const abs = path.resolve(p);
  const root = path.resolve(stateDir()) + path.sep;
  if (!abs.startsWith(root)) return;
  try { if (!fs.lstatSync(abs).isSocket()) return; } catch { return; }
  try { fs.rmSync(abs, { force: true }); } catch { /* ignore */ }
}

/**
 * rename is atomic, so exactly one racer reaps a given record. With `expect`,
 * the record is dropped only when it is still the one named — releasing another
 * session's live lease is how two drivers end up on one tab.
 */
function reapLock(dir, expect) {
  if (expect) {
    const owner = readJsonFile(ownerPath(dir));
    if (!ownerMatches(owner, expect)) return false;
    // A holder that came back renews the record it already had, so the nonce is
    // still the same one: only the timestamp tells a lease judged dead apart
    // from that lease alive again.
    if (expect.renewedAt !== undefined && Number(owner?.renewedAt) !== Number(expect.renewedAt)) return false;
  }
  const dead = `${dir}.dead.${nonce()}`;
  try { fs.renameSync(dir, dead); } catch { return false; }
  removeStateSocket(readJsonFile(ownerPath(dead))?.endpoint);
  try { fs.rmSync(dead, { recursive: true, force: true }); } catch { /* ignore */ }
  return true;
}

function ownerRecord(reason, prev) {
  return {
    nonce: prev?.nonce ?? nonce(),
    sessionId: sessionId(),
    pid: process.pid,
    host: os.hostname(),
    since: prev?.since ?? new Date().toISOString(),
    renewedAt: Date.now(),
    leaseMs: LEASE.ttlMs,
    reason: reason || null,
    argv: process.argv.slice(2, 6).join(' '),
  };
}

/**
 * Takes the lease, or renews the one this session already holds. It is not
 * dropped when the process exits: the next call of the same chain renews it, an
 * abandoned one expires on its own, and the session hooks end it early.
 */
async function acquireLease(reason) {
  if (!ensureStateDir()) return { state: 'unavailable', error: STATE.warning };
  const dir = lockDirPath();

  for (let attempt = 0; attempt < 4; attempt++) {
    let mine = false;
    try {
      // No `recursive`: EEXIST is what makes this the mutual exclusion.
      fs.mkdirSync(dir, { mode: 0o700 });
      mine = true;
    } catch (e) {
      if (e.code !== 'EEXIST') return { state: 'unavailable', error: e.message };
    }

    if (mine) {
      const rec = ownerRecord(reason, null);
      if (!writeJsonAtomic(ownerPath(dir), rec)) {
        // An unidentifiable record blocks everyone for a whole lease; drop it.
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
        return { state: 'unavailable', error: 'the lease record could not be written' };
      }
      return { state: 'acquired', owner: rec };
    }

    const owner = readJsonFile(ownerPath(dir));
    if (owner && owner.sessionId && owner.sessionId === sessionId()) {
      const rec = ownerRecord(reason, { nonce: owner.nonce, since: owner.since });
      const written = writeJsonAtomic(ownerPath(dir), rec);
      return { state: 'renewed', owner: written ? rec : owner, ...(written ? {} : { degraded: 'the lease could not be renewed on disk; it will expire on its own schedule' }) };
    }
    if (holderIsAlive(dir, owner)) return { state: 'held', owner };
    // Drop the record that was judged dead, not whatever sits there now: the
    // holder renewing in this gap is a live lease, and taking it would put two
    // drivers on one tab. A record too damaged to name its holder is reaped
    // unconditionally — nothing else would ever clear it.
    if (!reapLock(dir, owner?.nonce ? { nonce: owner.nonce, renewedAt: owner.renewedAt } : null)) await sleep(80);
  }
  return { state: 'held', owner: readJsonFile(ownerPath(dir)) };
}

/** The lease another session holds right now, or null. */
function foreignLease() {
  const dir = lockDirPath();
  if (!fs.existsSync(dir)) return null;
  const owner = readJsonFile(ownerPath(dir));
  if (owner && owner.sessionId && owner.sessionId === sessionId()) return null;
  if (!holderIsAlive(dir, owner)) return null;
  return owner || {};
}

const describeOwner = (owner) => (owner.sessionId
  ? `session ${owner.sessionId}, pid ${owner.pid ?? '?'}${owner.since ? `, since ${owner.since}` : ''}`
  : 'another session is claiming it right now and has not identified itself yet');

/** Returns a payload fragment, or null once the refusal has been emitted. */
function refuseOrWarn(owner, mode) {
  const who = describeOwner(owner);
  if (mode === 'warn') return { lockWarning: `another session is driving the client (${who}); proceeding anyway because lock_mode is warn` };
  const left = leaseLeftMs(owner);
  fail({
    kind: 'lock', code: 'LOCK_HELD',
    message: `another session is driving the client (${who})`,
    hint: mode === 'ask'
      ? 'Ask the user whether to take over. To go ahead re-run with --no-lock; to drop a lease whose holder is gone run `lock release`.'
      : 'Wait for the other session to finish, or run `lock release` if you know its holder is gone.',
    retriable: true, owner, lockMode: mode,
    ...(left !== null && left > 0 ? { retryAfterMs: left } : {}),
  });
  return null;
}

/**
 * A mutating call takes or renews the lease. A read takes none — but the client
 * drives one shared tab, so a read issued while another session is steering it
 * answers about that session's page, and the mode decides what to do about it.
 */
async function guardLock(tool) {
  const mode = OPT.noLock ? 'off' : lockMode();
  if (mode === 'off') return {};

  if (!mutates(tool)) {
    const foreign = foreignLease();
    return foreign ? refuseOrWarn(foreign, mode) : {};
  }

  const res = await acquireLease(tool);
  if (res.state === 'acquired' || res.state === 'renewed') {
    const left = leaseLeftMs(res.owner);
    return {
      lock: res.state,
      ...(left !== null ? { leaseExpiresInMs: Math.max(0, left) } : {}),
      ...(res.degraded ? { lockWarning: res.degraded } : {}),
    };
  }
  if (res.state === 'unavailable') {
    return { lockWarning: `the lease could not be recorded${res.error ? ` (${res.error})` : ''}; proceeding without a lock` };
  }
  return refuseOrWarn(res.owner || {}, mode);
}

// ---------------------------------------------------------------------------
// pace regulator
// ---------------------------------------------------------------------------

const pacePath = () => path.join(stateDir(), 'pace.json');
const legacyPacePath = () => path.join(stateDir(), 'search-pace.json');

function readPace() {
  const d = readJsonFile(pacePath());
  if (d && typeof d === 'object' && !Array.isArray(d)) return d;
  // An older file described a pace that only guarded search, so its intervals and
  // factor mean nothing here; only the canary verdict is about the client rather
  // than about pacing. Take that and leave the rest behind.
  const legacy = readJsonFile(legacyPacePath());
  return legacy && typeof legacy === 'object' && !Array.isArray(legacy) && legacy.canary
    ? { canary: legacy.canary }
    : {};
}

function writePace(patch) {
  if (!ensureStateDir()) return false;
  const ok = writeJsonAtomic(pacePath(), { ...readPace(), ...patch });
  // Only once the carried-over state is safely in the new file: dropping it at
  // read time loses the verdict whenever no write follows.
  if (ok) try { fs.unlinkSync(legacyPacePath()); } catch { /* nothing to clear */ }
  return ok;
}

const finiteOrNull = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const round2 = (n) => Math.round(n * 100) / 100;

/** Arguments that name a search to run, whatever the tool calling for it is named. */
const SEARCH_ARGS = ['keyword', 'imageUrl', 'imagePath'];

/**
 * Arguments that name something the client has to open before the tool can do
 * anything: a page key, a URL, or the id of an item, shop or order. Asking for
 * the skus of an item and putting one in the cart both carry an id and both move
 * the shared tab to that item's page first, which is the traffic the regulator
 * exists for.
 */
const NAVIGATION_ARGS = ['url', 'page', 'pageName', 'pageKey', 'itemId', 'productId', 'shopId', 'orderId'];

/**
 * The class of a call, from what can be observed about it rather than from a
 * list of names: the registry is the client's to change, and a name this build
 * has never heard of is exactly the one to pace carefully.
 *
 * `probe` is a pseudo-tool answered by the transport, `search` spends a search
 * slot, `navigate` opens a page, `read` is a name known to change nothing, and
 * `action` is everything else known. An unknown name is paced as a navigation.
 */
function paceClass(tool, args) {
  const t = String(tool ?? '');
  if (t.startsWith('_')) return 'probe';
  const a = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  // An id arrives as a string from one caller and as a number from the next, and
  // the page it opens is the same one either way.
  const filled = (k) => {
    const v = a[k];
    return (typeof v === 'string' && v.trim() !== '') || (typeof v === 'number' && Number.isFinite(v));
  };
  if (/search|query/i.test(t) || SEARCH_ARGS.some(filled)) return 'search';
  if (/navigat|open|goto|visit|jump/i.test(t) || NAVIGATION_ARGS.some(filled)) return 'navigate';
  if (!MUTATING_TOOLS.has(t) && !READ_ONLY_TOOLS.has(t)) return 'navigate';
  return mutates(t) ? 'action' : 'read';
}

const classIntervalMs = (klass) => PACE.classes[klass] ?? PACE.classes.navigate;

function normalizeHold(raw, now) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const since = finiteOrNull(raw.since);
  if (since === null) return null;
  // A stamp in the future is a clock that moved, not an ask that happened. The
  // last ask is read as due instead, so the next call asks the client for real
  // and writes a stamp this side of now — the hold repairs itself rather than
  // staying shut until the clock catches up.
  const asked = finiteOrNull(raw.lastAskedAt) ?? since;
  return {
    since: Math.min(since, now),
    lastAskedAt: asked > now ? now - PACE.loginRecheckMs : asked,
    tool: typeof raw.tool === 'string' ? raw.tool : null,
  };
}

/**
 * The regulator's state, normalised and with the idle relaxation applied. It is
 * read from a file because one call is one process: a tempo nobody remembers
 * between calls is not a tempo.
 */
function paceState(now = Date.now()) {
  const raw = readPace();
  const st = {
    factor: Math.min(PACE.maxFactor, Math.max(1, finiteOrNull(raw.factor) ?? 1)),
    cleanRun: Math.max(0, Math.floor(finiteOrNull(raw.cleanRun) ?? 0)),
    lastCallAt: finiteOrNull(raw.lastCallAt),
    lastClass: typeof raw.lastClass === 'string' ? raw.lastClass : null,
    // Idleness is measured from here rather than from the last call: while the
    // client is signed out the recheck keeps touching the clock, and a session
    // nobody is driving would never earn its factor back.
    relaxFrom: finiteOrNull(raw.relaxFrom) ?? finiteOrNull(raw.lastCallAt),
    raisedBy: typeof raw.raisedBy === 'string' ? raw.raisedBy : null,
    raisedAt: finiteOrNull(raw.raisedAt),
    hold: normalizeHold(raw.loginHold, now),
    relaxedSteps: 0,
  };
  if (st.relaxFrom !== null && st.relaxFrom > now) st.relaxFrom = now;
  // Where the idle clock stood before this read spent any of it. `relaxFrom` moves
  // forward by the steps just credited, so reporting idleness off it would shrink
  // the longer the run had been idle; this is the number a reader means by it.
  st.idleFrom = st.relaxFrom;
  if (st.factor > 1 && st.relaxFrom !== null && PACE.relaxMs > 0) {
    const steps = Math.floor((now - st.relaxFrom) / PACE.relaxMs);
    if (steps > 0) {
      const eased = Math.max(1, round2(st.factor - steps * PACE.decay));
      if (eased < st.factor) {
        st.factor = eased;
        st.relaxedSteps = steps;
        // The steps just spent are spent: leaving the clock where it was would
        // ease the factor again on the next call for the same idleness.
        st.relaxFrom += steps * PACE.relaxMs;
        if (eased === 1) { st.raisedBy = null; st.raisedAt = null; }
      }
    }
  }
  return st;
}

/**
 * What one call owes before it may go out. The interval is the larger of the
 * class about to run and the class that ran last: a page opened a moment ago
 * needs settling before anything reads it, whichever tool does the reading.
 */
function paceWait(st, klass, now) {
  const mine = classIntervalMs(klass);
  // A pseudo-tool reads no page and leaves no trace, so it waits for nothing to
  // settle — only for its own interval, which is what keeps `doctor` quick.
  const prev = st.lastClass && klass !== 'probe' ? classIntervalMs(st.lastClass) : 0;
  const intervalMs = Math.round(Math.max(mine, prev) * st.factor);
  // Never longer than one interval: a wall clock that moved backwards leaves the
  // last call in the future, and a wait taken from that would exceed every
  // budget — refusing every call, `up` included, until the clock caught up.
  const waitMs = st.lastCallAt === null ? 0 : Math.min(intervalMs, Math.max(0, st.lastCallAt + intervalMs - now));
  return { intervalMs, waitMs };
}

/** hard: the client refused or blocked. soft: it answered late, empty or unrendered. */
function troubleTier(outcome) {
  // An answer this side stopped waiting for early is not the client being slow.
  if (!outcome || outcome.evidence?.budgetTruncated) return null;
  if (PACE_HARD_SIGNALS.has(outcome.code)) return 'hard';
  if (PACE_SOFT_SIGNALS.has(outcome.code)) return 'soft';
  return outcome.kind === 'pathology' ? 'soft' : null;
}

/**
 * Multiplicative increase, from an observed signal — never from a guess. `base`
 * is the fragment the raised call already reported, so what comes back is the
 * same shape every other answer carries rather than a second one.
 */
function raisePace(code, tier = 'hard', base = null, st = paceState()) {
  const factor = Math.min(PACE.maxFactor, round2(Math.max(1, st.factor) * (tier === 'hard' ? PACE.growth : PACE.softGrowth)));
  const written = writePace({ factor, cleanRun: 0, raisedBy: code, raisedAt: Date.now() });
  return {
    ...(base && typeof base === 'object' ? base : {}),
    factor, previousFactor: st.factor, raisedBy: code, change: 'raised',
    ...(written ? {} : { degraded: 'the pace state could not be written, so the next call is not paced against this one' }),
  };
}

/**
 * Writes down what this call did to the tempo: the trouble that raised it, the
 * run of clean answers that eases it back, and when the client was last touched
 * — which is what the next process paces against.
 */
function recordPace(klass, outcome, st, waitedMs, intervalMs, tool) {
  const now = Date.now();

  // A pseudo-tool is answered without a page being touched: it opens nothing for
  // the next call to wait on, earns nothing back, and says nothing about the
  // client. Diagnostics run between two real calls must leave no mark on either,
  // so this one writes no state at all.
  if (klass === 'probe') {
    return {
      class: klass, waitedMs, intervalMs, factor: st.factor,
      ...(st.raisedBy ? { raisedBy: st.raisedBy } : {}),
    };
  }

  const patch = { lastCallAt: now, lastClass: klass, factor: st.factor, cleanRun: st.cleanRun };
  // A sign-out is where the session stands, not how hard the client is being
  // driven, so it leaves the idle clock alone as well as the factor: an hour
  // signed out is an hour of idleness, whatever the rechecks did to lastCallAt.
  const signedOut = outcome?.kind === 'gate' && outcome.code === 'NOT_LOGGED_IN';
  patch.relaxFrom = signedOut ? (st.relaxFrom ?? now) : now;
  if (st.relaxedSteps && st.factor === 1) { patch.raisedBy = null; patch.raisedAt = null; }
  let change = st.relaxedSteps ? 'relaxed' : null;

  const tier = troubleTier(outcome);
  if (tier) {
    patch.factor = Math.min(PACE.maxFactor, round2(Math.max(1, st.factor) * (tier === 'hard' ? PACE.growth : PACE.softGrowth)));
    patch.cleanRun = 0;
    patch.raisedBy = outcome.code || 'TROUBLE';
    patch.raisedAt = now;
    change = 'raised';
  } else if (outcome.kind === 'ok') {
    // Nothing to earn back at the floor, so the run is not counted there.
    const clean = st.factor > 1 ? st.cleanRun + 1 : 0;
    if (st.factor > 1 && clean >= PACE.decayAfter) {
      patch.factor = Math.max(1, round2(st.factor - PACE.decay));
      patch.cleanRun = 0;
      change = 'eased';
      if (patch.factor === 1) { patch.raisedBy = null; patch.raisedAt = null; }
    } else {
      patch.cleanRun = clean;
    }
  }

  Object.assign(patch, holdTransition(st, outcome, klass, tool, now));
  const written = writePace(patch);
  const raisedBy = patch.raisedBy !== undefined ? patch.raisedBy : st.raisedBy;
  return {
    class: klass,
    waitedMs,
    intervalMs,
    factor: patch.factor,
    ...(patch.factor !== st.factor ? { previousFactor: st.factor } : {}),
    ...(raisedBy ? { raisedBy } : {}),
    ...(change ? { change } : {}),
    ...(written ? {} : { degraded: 'the pace state could not be written, so the next call is not paced against this one' }),
  };
}

/**
 * The sign-out hold. It is set by the client refusing a call for being signed
 * out, and lifted by one thing only: a real tool the client ran and answered.
 * Every other outcome leaves it standing — a gate is another refusal, a
 * pathology is a page that came back wrong, a transport failure never reached
 * the client, and a pseudo-tool is answered without a session to begin with.
 * None of them is anyone signing in, and a hold lifted without a sign-in puts
 * the client's login window back in the user's face once per call.
 */
function holdTransition(st, outcome, klass, tool, now) {
  if (!outcome || klass === 'probe') return {};
  if (outcome.kind === 'gate' && outcome.code === 'NOT_LOGGED_IN') {
    return { loginHold: { since: st.hold?.since ?? now, lastAskedAt: now, tool: tool ?? null } };
  }
  return st.hold && outcome.kind === 'ok' ? { loginHold: null } : {};
}

/** The whole regulator, in the shape `up` and `doctor` report it. */
function paceReport(now = Date.now()) {
  const st = paceState(now);
  const classes = {};
  for (const [name, baseMs] of Object.entries(PACE.classes)) {
    classes[name] = { baseMs, effectiveMs: Math.round(baseMs * st.factor) };
  }
  return {
    factor: st.factor,
    classes,
    ...(st.raisedBy ? { raisedBy: st.raisedBy } : {}),
    ...(st.raisedAt !== null ? { raisedAgoMs: Math.max(0, now - st.raisedAt) } : {}),
    cleanRun: st.cleanRun,
    easesAfterCleanCalls: PACE.decayAfter,
    growth: PACE.growth,
    softGrowth: PACE.softGrowth,
    decay: PACE.decay,
    maxFactor: PACE.maxFactor,
    maxWaitMs: PACE.maxWaitMs,
    relaxMs: PACE.relaxMs,
    ...(st.lastCallAt !== null ? { lastCall: { class: st.lastClass, agoMs: Math.max(0, now - st.lastCallAt) } } : {}),
    ...(st.idleFrom != null ? { idleForMs: Math.max(0, now - st.idleFrom) } : {}),
    loginHold: st.hold
      ? {
        waitingForLoginMs: Math.max(0, now - st.hold.since),
        nextClientCheckInMs: Math.max(0, st.hold.lastAskedAt + PACE.loginRecheckMs - now),
        recheckMs: PACE.loginRecheckMs,
        lastRefusedTool: st.hold.tool,
      }
      : null,
    stateFile: pacePath(),
  };
}

/** The gate raised here, without asking the client and without raising its login window. */
function heldForLogin(st, klass, tool, now) {
  const hold = st.hold;
  const waitingForLoginMs = Math.max(0, now - hold.since);
  const nextClientCheckInMs = Math.max(0, hold.lastAskedAt + PACE.loginRecheckMs - now);
  return {
    ...gateOutcome('NOT_LOGGED_IN'),
    message: 'nobody is signed in to the client, so this call was not sent',
    hint: 'The client is signed out and its login page is already open. Ask the user to sign in there and to say when they are done, then run `up` — it is what asks the client and lifts this hold. Until then every call is answered here, so the client stops raising its login window once per refused call.',
    retriable: false,
    tool,
    ms: 0,
    via: 'login-hold',
    evidence: { askedClient: false, waitingForLoginMs, nextClientCheckInMs },
    // Nothing was waited for, but where the tempo stands travels with this answer
    // too: a hold is exactly when a caller asks why the run stopped moving.
    pace: {
      class: klass, waitedMs: 0, intervalMs: paceWait(st, klass, now).intervalMs, factor: st.factor,
      ...(st.raisedBy ? { raisedBy: st.raisedBy } : {}),
    },
    loginHold: { waitingForLoginMs, nextClientCheckInMs, since: new Date(hold.since).toISOString() },
  };
}

function backoffMs(attempt) {
  const raw = SEARCH.backoffBaseMs * Math.pow(SEARCH.backoffFactor, attempt - 1);
  const capped = Math.min(raw, SEARCH.backoffCapMs);
  const jitter = capped * 0.15 * (Math.random() * 2 - 1);
  return Math.max(1000, Math.round(capped + jitter));
}

function productCount(result) {
  if (typeof result?.count === 'number') return result.count;
  if (Array.isArray(result?.products)) return result.products.length;
  return null;
}

/**
 * A throttled search and an honestly empty one look identical, so a control
 * keyword decides. Only a `blocked` verdict is remembered, and only briefly:
 * "alive" is the verdict that turns a block into "nothing was found", so it is
 * earned again for every search rather than read off a cache.
 */
async function canaryVerdict(searchTool, baseArgs, budgetLeftMs = Infinity) {
  const cached = readPace().canary;
  if (cached && cached.verdict === 'blocked' && Number.isFinite(cached.at) && Date.now() - cached.at < SEARCH.canaryTtlMs) {
    return { verdict: 'blocked', cached: true };
  }
  // `type` after the spread, so the caller's own is overwritten rather than
  // carried: what the control keyword has to prove is that the client still
  // answers searches at all.
  const cls = await callTool(searchTool, { ...baseArgs, type: SEARCH.canaryType, keyword: SEARCH.canaryKeyword }, {
    suppress: new Set(['SEARCH_SILENT_THROTTLE']),
    paceBudgetMs: budgetLeftMs,
  });
  if (OUT_OF_BUDGET.has(cls.code)) {
    return { verdict: 'unknown', cached: false, outOfBudget: true, waitMs: cls.retryAfterMs, pace: cls.pace };
  }
  let verdict = 'unknown';
  if (cls.kind === 'ok') {
    const n = productCount(cls.result);
    if (n === null) verdict = 'unknown';
    else verdict = n > 0 ? 'alive' : 'blocked';
  }
  writePace({ canary: verdict === 'blocked' ? { at: Date.now(), verdict, keyword: SEARCH.canaryKeyword, type: SEARCH.canaryType } : null });
  // The throttle pathology is suppressed for this call, so the block it proves
  // has to be handed to the regulator here or the empty answer reads as clean.
  const raised = verdict === 'blocked' ? raisePace('SEARCH_SILENT_THROTTLE', 'hard', cls.pace) : null;
  return { verdict, cached: false, failure: cls.kind === 'ok' ? null : cls, pace: raised ?? cls.pace };
}

// ---------------------------------------------------------------------------
// subcommands
// ---------------------------------------------------------------------------

function withSourceApp(args) {
  const a = { ...(args || {}) };
  if (a.sourceApp === undefined) a.sourceApp = OPT.sourceApp;
  return a;
}

function parseArgsFlag() {
  const file = OPT.flags['args-file'];
  const inline = OPT.flags.args;
  let raw = null;
  if (typeof file === 'string') {
    try { raw = fs.readFileSync(file, 'utf8'); } catch (e) {
      fail({
        kind: 'tool', code: 'ARGS_FILE_UNREADABLE', message: e.message,
        hint: 'Point --args-file at a readable file holding one JSON object.', retriable: false,
      });
      return null;
    }
  } else if (typeof inline === 'string') {
    raw = inline;
  } else if (inline === true) {
    fail({ kind: 'tool', code: 'BAD_ARGS_JSON', message: '--args was given no value', hint: 'Pass --args \'{"…":"…"}\', or --args-file <path> when the value contains quotes, newlines or a URL.', retriable: false });
    return null;
  } else {
    return {};
  }
  let parsed;
  try {
    parsed = JSON.parse(String(raw).trim() || '{}');
  } catch (e) {
    fail({
      kind: 'tool', code: 'BAD_ARGS_JSON', message: `arguments are not valid JSON: ${e.message}`,
      hint: 'Pass the arguments with --args-file whenever a value contains quotes, newlines or a URL — the shell mangles them otherwise. This companion never "repairs" JSON, so what you write is what the client gets.',
      retriable: false, evidence: { raw: trunc(raw, 200) },
    });
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail({ kind: 'tool', code: 'BAD_ARGS_JSON', message: 'arguments must be a JSON object', hint: 'Wrap them in {}.', retriable: false });
    return null;
  }
  return parsed;
}

async function cmdCall() {
  const tool = OPT.pos[1];
  if (!tool) {
    return fail({ kind: 'protocol', code: 'USAGE', message: 'call needs a tool name', hint: 'node tb.mjs call <tool> --args \'{"…":"…"}\'. Run `tools` for the live registry.', retriable: false });
  }
  const args = parseArgsFlag();
  if (args === null) return;
  const lockFragment = await guardLock(tool);
  if (lockFragment === null) return;
  // Pacing is the client's, not the subcommand's: a tool reached through `call`
  // is paced exactly as the same tool reached through `search` or `read`.
  const cls = await callTool(tool, withSourceApp(args));
  emitClassified(cls, lockFragment);
}

async function cmdRead() {
  const args = {};
  if (typeof OPT.flags.scope === 'string') args.scope = OPT.flags.scope;
  const max = Number(OPT.flags.max ?? OPT.flags['max-length']);
  if (Number.isFinite(max) && max > 0) args.maxLength = Math.floor(max);
  const offset = Number(OPT.flags.offset);
  if (Number.isFinite(offset) && offset >= 0) args.offset = Math.floor(offset);
  const lockFragment = await guardLock('read_page_content');
  if (lockFragment === null) return;
  const cls = await callTool('read_page_content', withSourceApp(args));
  emitClassified(cls, lockFragment);
}

async function cmdTools() {
  const cls = await callTool('_help', {});
  if (cls.kind !== 'ok') return emitClassified(cls);
  const tools = Array.isArray(cls.result?.tools) ? cls.result.tools : [];
  const head = { via: cls.via, ...(cls.pace ? { pace: cls.pace } : {}) };
  if (OPT.raw) return finishOk('tools', cls.ms, { count: tools.length, tools }, head);
  // Descriptions and schemas run to tens of kilobytes; the registry is about names.
  const compact = tools.map((t) => ({ name: t?.name, description: trunc(String(t?.description ?? '').replace(/\s+/g, ' ').trim(), 160) }));
  finishOk('tools', cls.ms, { count: compact.length, tools: compact }, head);
}

async function cmdSearch() {
  const keywordFlag = typeof OPT.flags.keyword === 'string' ? OPT.flags.keyword : '';
  const extra = OPT.pos.slice(1);
  const keyword = [keywordFlag, ...extra].filter(Boolean).join(' ').trim();
  if (!keyword) {
    return fail({ kind: 'protocol', code: 'USAGE', message: 'search needs --keyword', hint: 'node tb.mjs search --keyword "<words>". Search Chinese: Chinese keywords return whole pages where the English equivalent returns a handful.', retriable: false });
  }
  // Test seam: lets the pacing and canary machinery be exercised without a live search.
  const searchTool = process.env.HCB_TAOBAO_SEARCH_TOOL || 'search_products';

  const lockFragment = await guardLock(searchTool);
  if (lockFragment === null) return;

  const base = withSourceApp(typeof OPT.flags.type === 'string' ? { type: OPT.flags.type } : {});
  const t0 = Date.now();
  const budgetLeft = () => SEARCH.budgetMs - (Date.now() - t0);
  const suppress = new Set(['SEARCH_SILENT_THROTTLE']);
  const waits = [];
  let lastZero = null;
  let attempt = 0;
  let pace = null;

  /**
   * One process is one call, so a wait that does not fit the budget is handed
   * back as `retryAfterMs` instead of slept through: the caller comes back later
   * and keeps its own turn responsive.
   */
  const throttled = (message, retryAfterMs, extra = {}) => fail({
    kind: 'pathology', code: 'SEARCH_THROTTLED',
    message,
    hint: 'The client is being throttled, not asked a bad question. Wait out `retryAfterMs` before searching again — the working recipe is a long pause, not a faster retry — and tell the user why the shortlist is incomplete.',
    retriable: true, retryAfterMs: Math.max(1000, Math.round(retryAfterMs)),
    tool: searchTool, ms: Date.now() - t0, attempts: attempt, budgetMs: SEARCH.budgetMs,
    ...(waits.length ? { waits } : {}), ...(pace ? { pace } : {}), ...lockFragment, ...extra,
    ...(OPT.raw && lastZero?.envelope !== undefined ? { raw: lastZero.envelope } : {}),
  });

  while (attempt < SEARCH.maxAttempts) {
    const cls = await callTool(searchTool, { ...base, keyword }, { suppress, paceBudgetMs: budgetLeft() });
    if (cls.pace) pace = cls.pace;
    if (cls.code === 'PACE_WAIT_EXCEEDS_BUDGET') {
      return throttled(cls.message, cls.retryAfterMs, { verdict: 'unattempted' });
    }
    // A budget too small to send a search with is the caller's turn running out,
    // not the client throttling: it keeps its own verdict rather than being
    // reported as a block nobody observed.
    if (cls.code === 'CALL_BUDGET_EXHAUSTED') {
      return emitClassified(cls, { ...lockFragment, attempts: attempt, verdict: 'unattempted' });
    }
    attempt++;
    if (cls.pace?.waitedMs) waits.push({ reason: 'pacing', ms: cls.pace.waitedMs });
    if (cls.kind !== 'ok') return emitClassified(cls, { ...lockFragment, attempts: attempt });

    const count = productCount(cls.result);
    if (count === null) {
      return emitClassified({
        kind: 'unknown', code: 'SEARCH_SHAPE_UNKNOWN',
        message: 'the search answer carried neither a count nor a products array',
        hint: 'Not a success. Run `doctor`; the client may no longer match the recorded baseline.',
        retriable: false, tool: searchTool, ms: cls.ms, via: cls.via, pace: cls.pace,
        evidence: { result: previewValue(cls.result) }, envelope: cls.envelope,
      }, { ...lockFragment, attempts: attempt });
    }
    if (count > 0) {
      return finishOk(searchTool, Date.now() - t0, cls.result, {
        via: cls.via, attempts: attempt, ...(waits.length ? { waits } : {}),
        ...(pace ? { pace } : {}), ...lockFragment,
        ...(OPT.raw ? { raw: cls.envelope } : {}),
      });
    }

    lastZero = cls;
    const canary = await canaryVerdict(searchTool, base, budgetLeft());
    if (canary.pace) pace = canary.pace;
    // A gate or a dead transport is not something backing off can fix.
    if (canary.failure && ['gate', 'transport', 'protocol'].includes(canary.failure.kind)) {
      return emitClassified(canary.failure, { ...lockFragment, attempts: attempt, duringCanary: true });
    }
    if (canary.outOfBudget) {
      return throttled(
        `search returned zero products and this call's ${SEARCH.budgetMs} ms budget ran out before the control keyword "${SEARCH.canaryKeyword}" could tell an empty query from a block`,
        canary.waitMs, { verdict: 'unverified' },
      );
    }
    if (canary.verdict === 'alive') {
      return finishOk(searchTool, Date.now() - t0, cls.result, {
        via: cls.via, attempts: attempt, verdict: 'empty-confirmed',
        note: `the control keyword "${SEARCH.canaryKeyword}" still returns products, so this query is genuinely empty rather than blocked`,
        ...(waits.length ? { waits } : {}), ...(pace ? { pace } : {}), ...lockFragment,
      });
    }

    if (attempt >= SEARCH.maxAttempts) break;
    const delay = backoffMs(attempt);
    if (delay > budgetLeft()) {
      return throttled(
        `search returned zero products on ${attempt} attempt${attempt === 1 ? '' : 's'} and the control keyword "${SEARCH.canaryKeyword}" came back ${canary.verdict}; the next back-off of ${delay} ms does not fit this call's ${SEARCH.budgetMs} ms budget`,
        delay, { verdict: canary.verdict },
      );
    }
    waits.push({ reason: canary.verdict === 'blocked' ? 'throttle-backoff' : 'unverified-backoff', ms: delay });
    await sleep(delay);
  }

  throttled(
    `search returned zero products on every one of ${attempt} attempt${attempt === 1 ? '' : 's'}, and the control keyword "${SEARCH.canaryKeyword}" came back empty too`,
    SEARCH.backoffCapMs, { verdict: 'exhausted' },
  );
}

function removeStartupMarkers() {
  for (const dir of userDataCandidates()) {
    try { fs.rmSync(path.join(dir, STARTUP_READY_FILE), { force: true }); } catch { /* ignore */ }
  }
}

function startupMarkerPresent() {
  return userDataCandidates().some((dir) => fs.existsSync(path.join(dir, STARTUP_READY_FILE)));
}

function launchApp(appPath) {
  return new Promise((resolve, reject) => {
    try {
      if (process.platform === 'darwin') {
        const c = spawn('open', ['-a', appPath], { detached: true, stdio: 'ignore' });
        c.on('error', reject);
        c.on('spawn', () => { c.unref(); resolve(); });
      } else if (process.platform === 'win32') {
        const env = { ...process.env };
        // The exe must start as the app, not as a node runtime.
        delete env.ELECTRON_RUN_AS_NODE;
        const c = spawn(appPath, [], { env, detached: true, stdio: 'ignore' });
        c.on('error', reject);
        c.on('spawn', () => { c.unref(); resolve(); });
      } else {
        reject(new Error('starting the client is not supported on this platform'));
      }
    } catch (e) { reject(e); }
  });
}

async function cmdUp() {
  const t0 = Date.now();
  const runtime = resolveRuntime();
  const report = {
    runtime: { kind: runtime.kind, node: runtime.node, exec: runtime.exec },
    client: { running: false, launched: false, appPath: null, version: null },
    gates: {},
    warnings: [],
  };

  let addr = await resolveAddress();
  let alive = addr ? (await ping(addr)).alive : false;

  if (!alive) {
    // Locating the application costs an mdfind; only a client that has to be
    // started needs it.
    const appPath = resolveAppPath();
    report.client.appPath = appPath;
    report.client.version = readAppVersion(appPath);
    if (!appPath) {
      return fail({
        kind: 'transport', code: 'CLIENT_NOT_FOUND',
        message: 'the Taobao desktop client is not running and its application could not be located',
        hint: 'Ask the user to start 淘宝桌面版, or set HCB_TAOBAO_APP_PATH to the application path, then run `up` again.',
        retriable: false, ms: Date.now() - t0,
      });
    }
    // A stale marker would make the wait succeed before this start finished.
    removeStartupMarkers();
    try {
      await launchApp(appPath);
    } catch (e) {
      return fail({
        kind: 'transport', code: 'LAUNCH_FAILED', message: `could not start the client: ${e.message}`,
        hint: 'Ask the user to start 淘宝桌面版 by hand, then run `up` again.', retriable: true, ms: Date.now() - t0,
      });
    }
    report.client.launched = true;

    const deadline = Date.now() + STARTUP_WAIT_MS;
    while (Date.now() < deadline) {
      await sleep(STARTUP_POLL_MS);
      if (!startupMarkerPresent()) continue;
      addr = await resolveAddress({ fresh: true });
      if (addr && (await ping(addr)).alive) { alive = true; break; }
    }
    if (!alive) {
      // The marker is written on home-page load; liveness is decided by _ping.
      addr = await resolveAddress({ fresh: true });
      alive = addr ? (await ping(addr)).alive : false;
    }
    if (!alive) {
      return fail({
        kind: 'transport', code: 'STARTUP_TIMEOUT',
        message: `the client did not become answerable within ${STARTUP_WAIT_MS} ms`,
        hint: 'The client was started but its home page has not finished loading. Ask the user to check the window — a login or an update prompt may be waiting.',
        retriable: true, ms: Date.now() - t0,
      });
    }
  }

  report.client.running = true;
  report.client.socketPath = addr?.socketPath ?? null;
  report.client.port = addr?.port ?? null;
  report.client.addressSource = addr?.source ?? null;
  report.client.userDataDir = addr?.userDataDir ?? activeUserDataDir();

  const config = report.client.userDataDir ? readJsonFile(path.join(report.client.userDataDir, CONFIG_FILE)) : null;
  if (config) {
    report.gates.aiAgent = config.mcpEnabled === false ? 'off' : 'on';
    report.gates.ordering = config.mcpOrderEnabled === true ? 'on' : 'off';
    report.gates.chat = config.mcpChatEnabled === true ? 'on' : 'off';
    const consent = chatConsent(config);
    if (consent) {
      report.gates.chatConsentExpiresInDays = consent.expiresInDays;
      if (consent.lapsed) report.warnings.push('the Wangwang chat consent has lapsed; the user must re-authorise it before any chat tool works');
    }
    // From the client's stored config — the last account it knew, not proof of a live session.
    if (config.usernick) report.client.lastKnownAccount = String(config.usernick);
    if (report.gates.aiAgent === 'off') {
      const gate = DATA.gates.find((g) => g.code === 'AI_AGENT_DISABLED');
      return fail({
        kind: 'gate', code: 'AI_AGENT_DISABLED',
        message: 'the client config has the AI agent switched off (mcpEnabled=false)',
        hint: gate?.hint, retriable: false, ms: Date.now() - t0, report,
      });
    }
  } else {
    report.warnings.push('the client config could not be read, so the gate states below come only from the probe call');
  }

  // _ping is answered by the transport; the probe is the first thing that proves
  // a tool actually runs. Preflight that passes on a failed probe passes on
  // nothing, so the probe decides `up`.
  // The probe reads the account's own history rather than the current tab: the
  // client serves its local home page whether or not anyone is signed in, so a
  // tab read says nothing about the session the skills are about to rely on.
  // `up` is how the user checks after signing in, so it always asks the client.
  const PROBE_TOOL = 'get_browse_history';
  const probe = await callTool(PROBE_TOOL, withSourceApp({ type: 'product' }), {
    timeout: Math.max(toolTimeout(PROBE_TOOL), 15000), bypassLoginHold: true,
  });
  report.probe = { tool: PROBE_TOOL, ms: probe.ms, kind: probe.kind, via: probe.via };
  report.pace = paceReport();
  if (probe.kind !== 'ok') {
    report.probe.code = probe.code;
    return fail({
      kind: probe.kind, code: probe.code, message: probe.message, hint: probe.hint,
      retriable: Boolean(probe.retriable),
      ...(probe.retryAfterMs !== undefined ? { retryAfterMs: probe.retryAfterMs } : {}),
      ...(probe.evidence ? { evidence: probe.evidence } : {}),
      ...(probe.pace ? { pace: probe.pace } : {}),
      ...(probe.loginHold ? { loginHold: probe.loginHold } : {}),
      ms: Date.now() - t0, report,
    });
  }
  // What the probe answered with, and nothing the probe does not return: a field
  // read off the wrong tool comes out empty and reads as a client sitting on a
  // blank page. An empty history is a real answer, so a count of zero is one too.
  const entries = typeof probe.result?.count === 'number'
    ? probe.result.count
    : (Array.isArray(probe.result?.items) ? probe.result.items.length : null);
  if (entries !== null) report.probe.entries = entries;

  if (report.gates.ordering === 'off') report.warnings.push('ordering is not authorised in the client; work stops at the cart');
  if (report.gates.chat === 'off') report.warnings.push('chatting with sellers is not authorised in the client');

  finishOk('up', Date.now() - t0, report);
}

async function cmdDoctor() {
  const t0 = Date.now();
  const baseline = loadBaseline();
  const appPath = resolveAppPath();
  const addr = await resolveAddress();
  const observed = {
    platform: process.platform,
    appPath,
    version: readAppVersion(appPath),
    reachable: false,
    address: addr ? { socketPath: addr.socketPath ?? null, port: addr.port ?? null, source: addr.source } : null,
    dataFiles: {
      pathologies: DATA.dataVersion ? 'loaded' : 'missing',
      baseline: baseline ? 'loaded' : 'missing',
    },
  };
  const diff = [];
  // What could not be compared at all. It is kept apart from `diff`, which is for
  // drift actually observed, and it is what stops a check that never ran from
  // being reported as one that passed.
  const unchecked = [];

  if (!baseline) {
    diff.push({ field: 'baseline', expected: 'protocol-baseline.json next to tb.mjs', observed: 'missing' });
  }
  if (!DATA.dataVersion) {
    diff.push({ field: 'pathologies', expected: 'pathologies.json next to tb.mjs', observed: 'missing' });
  }

  if (addr) {
    const p = await ping(addr, Math.min(toolTimeout('_ping'), 8000));
    observed.reachable = p.alive;
    if (p.alive) {
      observed.pingEnvelope = p.envelope;
      const expected = baseline?.pseudoTools?._ping;
      if (expected && JSON.stringify(expected) !== JSON.stringify(p.envelope)) {
        diff.push({ field: '_ping', expected, observed: p.envelope });
      }
    } else {
      diff.push({ field: 'reachable', expected: true, observed: false });
    }
  } else {
    diff.push({ field: 'address', expected: `${PORT_FILE} under the client's userData`, observed: 'not found' });
  }

  if (baseline?.client?.version && observed.version && baseline.client.version !== observed.version) {
    diff.push({ field: 'client.version', expected: baseline.client.version, observed: observed.version });
  }

  if (!observed.reachable) {
    unchecked.push({ field: 'tools', reason: 'the client did not answer, so the registry was not read' });
  } else {
    const help = await callTool('_help', {});
    if (help.via === 'login-hold') {
      // Held, not asked: the registry is unknown right now, and that is a state
      // of the session rather than a drift from the baseline. Unknown is what it
      // is reported as — nothing was compared, so nothing matched either.
      observed.helpFailure = { kind: help.kind, code: help.code, message: 'held: the client is signed out' };
      unchecked.push({ field: 'tools', reason: 'the client is signed out, so the registry was not read' });
    } else if (help.kind === 'ok' && Array.isArray(help.result?.tools)) {
      const names = help.result.tools.map((t) => t?.name).filter(Boolean).sort();
      observed.toolCount = names.length;
      observed.tools = names;
      if (typeof baseline?.toolCount === 'number' && baseline.toolCount !== names.length) {
        diff.push({ field: 'toolCount', expected: baseline.toolCount, observed: names.length });
      }
      const expectedTools = Array.isArray(baseline?.tools) ? baseline.tools : [];
      const added = names.filter((n) => !expectedTools.includes(n));
      const missing = expectedTools.filter((n) => !names.includes(n));
      if (added.length) diff.push({ field: 'tools.added', expected: [], observed: added });
      if (missing.length) diff.push({ field: 'tools.missing', expected: missing, observed: [] });
      const unknownMutating = [...MUTATING_TOOLS].filter((n) => !names.includes(n));
      if (unknownMutating.length) observed.mutatingToolsNotInRegistry = unknownMutating;
      // A name in neither set is driven as mutating and never re-run; naming it
      // here is what gets it classified properly.
      const unclassified = names.filter((n) => !MUTATING_TOOLS.has(n) && !READ_ONLY_TOOLS.has(n));
      if (unclassified.length) {
        diff.push({ field: 'tools.unclassified', expected: [], observed: unclassified });
      }
    } else {
      observed.helpFailure = { kind: help.kind, code: help.code, message: trunc(help.message, 160) };
      diff.push({ field: '_help', expected: '{result:{tools:[…]}}', observed: `${help.kind}/${help.code}` });
    }
  }

  if (UNSUPPORTED_PREDICATES.size) {
    diff.push({ field: 'pathologies.structure', expected: 'predicates tb.mjs implements', observed: [...UNSUPPORTED_PREDICATES] });
  }

  const modeInfo = lockModeInfo();

  // doctor reports; it never fails the run.
  finishOk('doctor', Date.now() - t0, {
    // True only where every axis was compared and every comparison held. Read
    // `diff` for what drifted and `unchecked` for what could not be looked at.
    matchesBaseline: diff.length === 0 && unchecked.length === 0,
    baseline: baseline ? { version: baseline.client?.version, toolCount: baseline.toolCount, baselineVersion: baseline.baselineVersion } : null,
    observed,
    diff,
    unchecked,
    lockMode: OPT.noLock ? 'off (--no-lock)' : modeInfo.mode,
    lockModeSource: OPT.noLock ? '--no-lock' : modeInfo.source,
    callTimeoutMs: OPT.timeout
      ? { explicit: OPT.timeout }
      : { default: TIMEOUT_MS.default, slow: TIMEOUT_MS.slow, slowTools: [...SLOW_TOOLS] },
    pace: paceReport(),
    leaseTtlMs: LEASE.ttlMs,
    stateDir: stateDir(),
    ...(STATE.warning ? { stateWarning: STATE.warning } : {}),
  });
}

async function cmdLock() {
  const action = OPT.pos[1] || 'status';
  const dir = lockDirPath();
  const owner = readJsonFile(ownerPath(dir));
  const exists = fs.existsSync(dir);
  const mine = Boolean(owner && owner.sessionId && owner.sessionId === sessionId());
  const modeInfo = lockModeInfo();

  if (action === 'status') {
    const alive = exists ? holderIsAlive(dir, owner) : false;
    const left = owner ? leaseLeftMs(owner) : null;
    return finishOk('lock', 0, {
      held: exists,
      alive,
      mine,
      owner,
      leaseExpiresInMs: left,
      leaseTtlMs: LEASE.ttlMs,
      lockDir: dir,
      stateDir: stateDir(),
      mode: OPT.noLock ? 'off (--no-lock)' : modeInfo.mode,
      modeSource: OPT.noLock ? '--no-lock' : modeInfo.source,
      sessionId: sessionId(),
      ...(STATE.warning ? { stateWarning: STATE.warning } : {}),
    });
  }
  if (action === 'release') {
    if (!exists) return finishOk('lock', 0, { released: false, held: false, lockDir: dir, note: 'no lease was held' });
    const alive = holderIsAlive(dir, owner);
    // Ours goes only if it is still ours when the record is read again. Someone
    // else's is the operator's call — this subcommand is the way out of a lease
    // whose holder is gone for good.
    const done = reapLock(dir, mine ? { sessionId: sessionId() } : null);
    return finishOk('lock', 0, {
      released: done, previousOwner: owner, holderWasAlive: alive, mine, lockDir: dir,
      ...(alive && !mine ? { warning: 'the holder still looked alive; it will not notice the lease is gone' } : {}),
      ...(!done ? { note: 'the record changed hands while it was being read; nothing was released' } : {}),
    });
  }
  fail({ kind: 'protocol', code: 'USAGE', message: `unknown lock action: ${action}`, hint: 'node tb.mjs lock status | node tb.mjs lock release', retriable: false });
}

// ---------------------------------------------------------------------------
// session hooks
// ---------------------------------------------------------------------------

/**
 * The hook payload carries the session id this process would otherwise have to
 * guess. Reading it is best-effort: a hook that hangs on stdin delays the very
 * events it is attached to.
 */
function readHookInput(timeoutMs = 300) {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve(null);
    let buf = '';
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { process.stdin.pause(); } catch { /* ignore */ }
      try { resolve(JSON.parse(buf.trim() || 'null')); } catch { resolve(null); }
    };
    const timer = setTimeout(done, timeoutMs);
    timer.unref?.();
    try {
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (c) => { buf += c; if (buf.length > 65536) done(); });
      process.stdin.on('end', done);
      process.stdin.on('error', done);
    } catch { done(); }
  });
}

/**
 * Hooks answer on stderr and always exit 0. Stdout is off limits: on
 * SessionStart it is injected into the session as context, and a lock note is
 * not something Claude should read. A non-zero exit would surface a hook error
 * in the transcript for a housekeeping step the user never asked for.
 */
function hookDone(note) {
  // writeSync, because process.exit truncates a pending async write to a pipe.
  if (note) { try { fs.writeSync(2, `tb.mjs: ${note}\n`); } catch { /* ignore */ } }
  process.exit(0);
}

async function adoptHookSession() {
  hookMode = true;
  const input = await readHookInput();
  const id = input && typeof input.session_id === 'string' ? input.session_id.trim() : '';
  if (id) sessionOverride = id;
}

/**
 * SessionStart: write down the plugin option a plain Bash call cannot see, and
 * clear a lease left behind by a holder that is gone.
 */
async function cmdHookPreflight() {
  await adoptHookSession();
  const notes = [];
  const mode = persistLockMode();
  if (mode) notes.push(`recorded lock_mode=${mode}`);

  const dir = lockDirPath();
  if (fs.existsSync(dir)) {
    const owner = readJsonFile(ownerPath(dir));
    if (owner && owner.sessionId && owner.sessionId === sessionId()) {
      if (reapLock(dir, { sessionId: sessionId() })) notes.push('swept a client lease left by an earlier process of this session');
    } else if (!holderIsAlive(dir, owner)) {
      if (reapLock(dir)) notes.push('swept an orphaned client lease');
    }
  }
  hookDone(notes.length ? notes.join('; ') : null);
}

/**
 * Stop / idle / SessionEnd: end the lease this session holds early. Only this
 * session's — another session's lease is its own to release, and a hook firing
 * mid-call there would hand the client to two drivers at once.
 */
async function cmdHookRelease() {
  await adoptHookSession();
  const reason = typeof OPT.flags.reason === 'string' ? OPT.flags.reason : 'hook';
  const dir = lockDirPath();
  if (!fs.existsSync(dir)) return hookDone(null);
  const owner = readJsonFile(ownerPath(dir));
  if (!owner || !owner.sessionId || owner.sessionId !== sessionId()) return hookDone(null);
  hookDone(reapLock(dir, { sessionId: sessionId() }) ? `released the client lease held by this session (${reason})` : null);
}

// ---------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------

function applyFlags() {
  const f = OPT.flags;
  OPT.ascii = f.ascii === true || f.ascii === 'true';
  OPT.raw = f.raw === true || f.raw === 'true';
  OPT.noLock = f['no-lock'] === true || f['no-lock'] === 'true';
  const t = Number(f.timeout);
  if (Number.isFinite(t) && t > 0) OPT.timeout = Math.floor(t);
  const mi = Number(f['max-inline']);
  if (Number.isFinite(mi) && mi >= 0) OPT.maxInline = Math.floor(mi);
  if (typeof f.out === 'string') OPT.out = f.out;
  if (typeof f['source-app'] === 'string' && f['source-app'].trim()) OPT.sourceApp = f['source-app'].trim();
  if (typeof f.transport === 'string' && ['socket', 'cli', 'auto'].includes(f.transport)) OPT.transport = f.transport;
}

const USAGE = {
  usage: 'node tb.mjs <up|doctor|tools|call|search|read|lock> [flags]',
  subcommands: {
    up: 'preflight: client running, gates open, protocol as expected',
    doctor: 'protocol fingerprint against the recorded baseline',
    tools: 'the live tool registry',
    call: 'call <tool> --args \'<json>\' | --args-file <path>',
    search: 'search --keyword <words> [--type <all|shop|tmall|pc_taobao|22pc_b>]',
    read: 'read [--scope <css>] [--max <chars>] [--offset <n>]',
    lock: 'lock status | lock release',
    'hook-preflight': 'session hook: record lock_mode and clear a client lease whose holder is gone (no stdout)',
    'hook-release': 'session hook: end the client lease this session holds (no stdout)',
  },
  flags: ['--timeout <ms> (overrides the per-tool default; a search tool already gets a longer one)', '--out <path>', '--max-inline <bytes>', '--no-lock', '--source-app <name>', '--raw', '--ascii', '--transport socket|cli|auto'],
};

async function main() {
  const { flags, pos } = parseArgv(process.argv.slice(2));
  OPT.flags = flags;
  OPT.pos = pos;
  applyFlags();
  OPT.sub = pos[0] || null;

  if (flags.help === true) return finishOk('help', 0, USAGE);
  if (!OPT.sub) {
    return fail({ kind: 'protocol', code: 'USAGE', message: 'no subcommand given', hint: USAGE.usage, retriable: false, ...USAGE });
  }

  switch (OPT.sub) {
    case 'up': return cmdUp();
    case 'doctor': return cmdDoctor();
    case 'tools': return cmdTools();
    case 'call': return cmdCall();
    case 'search': return cmdSearch();
    case 'read': return cmdRead();
    case 'lock': return cmdLock();
    case 'hook-preflight': return cmdHookPreflight();
    case 'hook-release': return cmdHookRelease();
    default:
      return fail({ kind: 'protocol', code: 'USAGE', message: `unknown subcommand: ${OPT.sub}`, hint: USAGE.usage, retriable: false, ...USAGE });
  }
}

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    fail({
      kind: 'transport', code: 'INTERRUPTED', message: `interrupted by ${sig}`,
      hint: 'A call already sent still runs to completion inside the client — it has no timeout of its own. Any lease this session took expires on its own; `lock release` ends it now.',
      retriable: true,
    });
  });
}
process.on('uncaughtException', (e) => {
  fail({ kind: 'unknown', code: 'INTERNAL_ERROR', message: `${e?.message || e}`, hint: 'This is a companion bug, not a client answer. Report it with the stack below.', retriable: false, evidence: { stack: trunc(e?.stack, 800) } });
});
process.on('unhandledRejection', (e) => {
  fail({ kind: 'unknown', code: 'INTERNAL_ERROR', message: `${e?.message || e}`, hint: 'This is a companion bug, not a client answer. Report it with the stack below.', retriable: false, evidence: { stack: trunc(e?.stack, 800) } });
});

main().catch((e) => {
  fail({ kind: 'unknown', code: 'INTERNAL_ERROR', message: `${e?.message || e}`, hint: 'This is a companion bug, not a client answer. Report it with the stack below.', retriable: false, evidence: { stack: trunc(e?.stack, 800) } });
});
