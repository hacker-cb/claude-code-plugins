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
const DEFAULT_SOURCE_APP = 'claude-code';
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

/** Every tool that spends a search slot, so every one of them is paced. */
const SEARCH_TOOLS = new Set(['search_products', 'image_search']);

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

const SEARCH = {
  minIntervalMs: envInt('HCB_TAOBAO_SEARCH_INTERVAL_MS', 25000),
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
 * taking the verdict with it. What is left of the budget is the ceiling instead.
 */
const budgetedTimeout = (tool, leftMs) => (Number.isFinite(leftMs)
  ? Math.max(1000, Math.min(toolTimeout(tool), leftMs))
  : toolTimeout(tool));

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

/** Returns a classification plus timing and the wire envelope. */
async function callTool(tool, args, opts = {}) {
  const t0 = Date.now();
  const timeout = opts.timeout ?? toolTimeout(tool);
  const body = { tool, arguments: args ?? {} };
  const wantCli = OPT.transport === 'cli';
  const addr = wantCli ? null : await resolveAddress();

  if (!wantCli && !addr) {
    return {
      ...transportFailure({ status: 'error', error: { code: 'ENOENT' } }, tool),
      ms: Date.now() - t0, via: 'socket',
    };
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
  if (res.status !== 'ok') return { ...transportFailure(res, tool), ms, via };
  if (res.status === 'ok' && res.envelope === undefined) {
    return { kind: 'unknown', code: 'EMPTY_ENVELOPE', message: 'the client answered with nothing', hint: 'Not a success. Run `doctor`.', retriable: false, ms, via, tool };
  }
  const cls = classify(res.envelope, tool, opts.suppress);
  return { ...cls, ms, via, tool, envelope: res.envelope };
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
  if (cls.kind === 'ok') {
    return finishOk(cls.tool, cls.ms, cls.result, { ...(cls.via ? { via: cls.via } : {}), ...extra, ...raw });
  }
  const { kind, code, message, hint, retriable, retryAfterMs, evidence, tool, ms, via } = cls;
  fail({
    kind, code, message, hint, retriable: Boolean(retriable),
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    ...(evidence ? { evidence } : {}),
    ...(tool ? { tool } : {}), ...(ms !== undefined ? { ms } : {}), ...(via ? { via } : {}),
    ...extra, ...raw,
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
// search pacing
// ---------------------------------------------------------------------------

const pacePath = () => path.join(stateDir(), 'search-pace.json');

function readPace() {
  const d = readJsonFile(pacePath());
  return d && typeof d === 'object' ? d : {};
}

function writePace(patch) {
  if (!ensureStateDir()) return false;
  return writeJsonAtomic(pacePath(), { ...readPace(), ...patch });
}

/** Pacing is per client, not per process, so the last call time lives in a file. */
function paceWaitMs() {
  const last = Number(readPace().lastSearchAt);
  if (!Number.isFinite(last)) return 0;
  return Math.max(0, last + SEARCH.minIntervalMs - Date.now());
}

/** Sleeps out the pacing interval; null when the wait outlasts the budget left. */
async function respectPace(budgetLeftMs = Infinity) {
  const wait = paceWaitMs();
  if (wait <= 0) return 0;
  if (wait > budgetLeftMs) return null;
  await sleep(wait);
  return wait;
}

const markPace = () => writePace({ lastSearchAt: Date.now() });

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
  const paced = await respectPace(budgetLeftMs);
  if (paced === null) return { verdict: 'unknown', cached: false, outOfBudget: true, waitMs: paceWaitMs() };
  // `type` after the spread, so the caller's own is overwritten rather than
  // carried: what the control keyword has to prove is that the client still
  // answers searches at all.
  const cls = await callTool(searchTool, { ...baseArgs, type: SEARCH.canaryType, keyword: SEARCH.canaryKeyword }, {
    suppress: new Set(['SEARCH_SILENT_THROTTLE']),
    timeout: budgetedTimeout(searchTool, budgetLeftMs - paced),
  });
  markPace();
  let verdict = 'unknown';
  if (cls.kind === 'ok') {
    const n = productCount(cls.result);
    if (n === null) verdict = 'unknown';
    else verdict = n > 0 ? 'alive' : 'blocked';
  }
  writePace({ canary: verdict === 'blocked' ? { at: Date.now(), verdict, keyword: SEARCH.canaryKeyword, type: SEARCH.canaryType } : null });
  return { verdict, cached: false, failure: cls.kind === 'ok' ? null : cls };
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
  // Pacing is per client and per search slot, not per subcommand: a search tool
  // reached through `call` spends the same slot `search` does.
  const paced = SEARCH_TOOLS.has(tool) ? await respectPace() : 0;
  const cls = await callTool(tool, withSourceApp(args));
  if (SEARCH_TOOLS.has(tool)) markPace();
  emitClassified(cls, { ...lockFragment, ...(paced ? { waits: [{ reason: 'pacing', ms: paced }] } : {}) });
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
  if (OPT.raw) return finishOk('tools', cls.ms, { count: tools.length, tools }, { via: cls.via });
  // Descriptions and schemas run to tens of kilobytes; the registry is about names.
  const compact = tools.map((t) => ({ name: t?.name, description: trunc(String(t?.description ?? '').replace(/\s+/g, ' ').trim(), 160) }));
  finishOk('tools', cls.ms, { count: compact.length, tools: compact }, { via: cls.via });
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
    ...(waits.length ? { waits } : {}), ...lockFragment, ...extra,
    ...(OPT.raw && lastZero?.envelope !== undefined ? { raw: lastZero.envelope } : {}),
  });

  while (attempt < SEARCH.maxAttempts) {
    const paced = await respectPace(budgetLeft());
    if (paced === null) {
      return throttled(
        `the client's search pacing still needs ${paceWaitMs()} ms and this call's ${SEARCH.budgetMs} ms budget is spent`,
        paceWaitMs(), { verdict: 'unattempted' },
      );
    }
    if (paced) waits.push({ reason: 'pacing', ms: paced });
    attempt++;

    const cls = await callTool(searchTool, { ...base, keyword }, { suppress, timeout: budgetedTimeout(searchTool, budgetLeft()) });
    markPace();
    if (cls.kind !== 'ok') return emitClassified(cls, { ...lockFragment, attempts: attempt });

    const count = productCount(cls.result);
    if (count === null) {
      return emitClassified({
        kind: 'unknown', code: 'SEARCH_SHAPE_UNKNOWN',
        message: 'the search answer carried neither a count nor a products array',
        hint: 'Not a success. Run `doctor`; the client may no longer match the recorded baseline.',
        retriable: false, tool: searchTool, ms: cls.ms, via: cls.via,
        evidence: { result: previewValue(cls.result) }, envelope: cls.envelope,
      }, { ...lockFragment, attempts: attempt });
    }
    if (count > 0) {
      return finishOk(searchTool, Date.now() - t0, cls.result, {
        via: cls.via, attempts: attempt, ...(waits.length ? { waits } : {}), ...lockFragment,
        ...(OPT.raw ? { raw: cls.envelope } : {}),
      });
    }

    lastZero = cls;
    const canary = await canaryVerdict(searchTool, base, budgetLeft());
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
        ...(waits.length ? { waits } : {}), ...lockFragment,
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
    if (config.usernick) report.client.account = String(config.usernick);
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
  const probe = await callTool('get_current_tab', withSourceApp({}), { timeout: Math.max(toolTimeout('get_current_tab'), 15000) });
  report.probe = { tool: 'get_current_tab', ms: probe.ms, kind: probe.kind, via: probe.via };
  if (probe.kind !== 'ok') {
    report.probe.code = probe.code;
    return fail({
      kind: probe.kind, code: probe.code, message: probe.message, hint: probe.hint,
      retriable: Boolean(probe.retriable),
      ...(probe.retryAfterMs !== undefined ? { retryAfterMs: probe.retryAfterMs } : {}),
      ...(probe.evidence ? { evidence: probe.evidence } : {}),
      ms: Date.now() - t0, report,
    });
  }
  report.probe.url = trunc(probe.result?.url, 120);
  report.probe.title = trunc(probe.result?.title, 80);

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

  if (observed.reachable) {
    const help = await callTool('_help', {});
    if (help.kind === 'ok' && Array.isArray(help.result?.tools)) {
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
    matchesBaseline: diff.length === 0,
    baseline: baseline ? { version: baseline.client?.version, toolCount: baseline.toolCount, baselineVersion: baseline.baselineVersion } : null,
    observed,
    diff,
    lockMode: OPT.noLock ? 'off (--no-lock)' : modeInfo.mode,
    lockModeSource: OPT.noLock ? '--no-lock' : modeInfo.source,
    callTimeoutMs: OPT.timeout
      ? { explicit: OPT.timeout }
      : { default: TIMEOUT_MS.default, slow: TIMEOUT_MS.slow, slowTools: [...SLOW_TOOLS] },
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
