// claude-trust.mjs — the trust a user gave a repository under one Claude Code
// configuration, carried into another, the documented way: `hasTrustDialogAccepted` on the
// repository root's entry in that configuration's `.claude.json`.
//
// It only ever copies a decision the user already made: where the source configuration
// does not trust the root, nothing is written anywhere. The write takes the same lock
// Claude Code takes on that file — a `<file>.lock` directory — reads the file again under
// it, changes the one key, and replaces the file whole, so a session of that configuration
// writing at the same moment loses nothing and never reads half a file.

import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync,
  renameSync, rmdirSync, unlinkSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const real = (p) => { try { return realpathSync(p); } catch { return p; } };

// The global config file of a configuration: `$CLAUDE_CONFIG_DIR/.claude.json` where that
// directory is set, `~/.claude.json` where it is not — aimux leaves it unset for its
// source profile and sets it for every other one.
export function configFile(configDir) {
  return configDir ? join(configDir, '.claude.json') : join(homedir(), '.claude.json');
}

function readJson(file) {
  let raw;
  try { raw = readFileSync(file, 'utf8'); } catch (e) { return { ok: false, missing: e.code === 'ENOENT', why: e.code || e.message }; }
  try {
    const doc = JSON.parse(raw);
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, why: 'not a JSON object' };
    return { ok: true, doc };
  } catch { return { ok: false, why: 'not JSON' }; }
}

// The key the source writes for the root — its spelling, matched by where it points.
function trustedKey(doc, root) {
  const projects = doc.projects && typeof doc.projects === 'object' ? doc.projects : {};
  const want = real(root);
  for (const [k, v] of Object.entries(projects)) {
    if ((k === root || real(k) === want) && v && v.hasTrustDialogAccepted === true) return k;
  }
  return null;
}

const LOCK_WAIT_MS = 5000;
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// `state`: `held` (already trusted there), `shared` (one file for both), `wrote` (carried
// over), or a refusal — `absent-in-source`, `unread`, `no-config`, `linked`, `locked`.
// `wrote` is three-valued: true once the key reads back, false where nothing was written,
// null where a write ran and the read-back did not show it.
export function mirrorTrust({ from, into, root, dryRun = false }) {
  const answer = { root, from, into, key: null, state: null, wrote: false, why: null };
  if (real(from) === real(into)) { answer.state = 'shared'; return answer; }
  const src = readJson(from);
  if (!src.ok) { answer.state = 'unread'; answer.why = `the source configuration did not read (${src.why})`; return answer; }
  answer.key = trustedKey(src.doc, root);
  if (!answer.key) {
    answer.state = 'absent-in-source';
    answer.why = 'the configuration this session runs under does not trust the repository — that is the user\'s to give';
    return answer;
  }
  let st;
  try { st = lstatSync(into); } catch (e) {
    answer.state = e.code === 'ENOENT' ? 'no-config' : 'unread';
    answer.why = e.code === 'ENOENT' ? 'the profile has no configuration file yet — it has never been run' : e.code;
    return answer;
  }
  // A link is somebody's arrangement for sharing the file; writing through it changes
  // whatever it points at.
  if (st.isSymbolicLink()) { answer.state = 'linked'; answer.why = 'the profile\'s configuration file is a link'; return answer; }
  const dst = readJson(into);
  if (!dst.ok) { answer.state = 'unread'; answer.why = `the profile's configuration did not read (${dst.why})`; return answer; }
  if (trustedKey(dst.doc, root)) { answer.state = 'held'; return answer; }
  if (dryRun) { answer.state = 'would-write'; return answer; }

  const lock = `${into}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try { mkdirSync(lock); break; } catch (e) {
      if (e.code !== 'EEXIST') { answer.state = 'unread'; answer.why = `the lock could not be taken (${e.code})`; return answer; }
      // Never removed: a lock another process holds, stale or not, is not this one's.
      if (Date.now() > deadline) { answer.state = 'locked'; answer.why = `${lock} stayed held`; return answer; }
      sleep(100);
    }
  }
  let tmp = null;
  try {
    const now = readJson(into);
    if (!now.ok) { answer.state = 'unread'; answer.why = `the profile's configuration did not read under the lock (${now.why})`; return answer; }
    const doc = now.doc;
    if (!doc.projects || typeof doc.projects !== 'object' || Array.isArray(doc.projects)) doc.projects = {};
    const entry = doc.projects[answer.key];
    doc.projects[answer.key] = { ...(entry && typeof entry === 'object' ? entry : {}), hasTrustDialogAccepted: true };
    tmp = `${into}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`;
    const fd = openSync(tmp, 'wx', 0o600);
    try { writeSync(fd, `${JSON.stringify(doc, null, 2)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, into);
    tmp = null;
  } catch (e) {
    answer.state = 'unread';
    answer.why = `the write failed (${e.code || e.message})`;
    return answer;
  } finally {
    if (tmp) { try { unlinkSync(tmp); } catch { /* gone */ } }
    try { rmdirSync(lock); } catch { /* gone */ }
  }
  const back = readJson(into);
  answer.state = 'wrote';
  answer.wrote = back.ok && trustedKey(back.doc, root) !== null ? true : null;
  if (answer.wrote === null) answer.why = 'the key did not read back';
  return answer;
}
