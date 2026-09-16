// forge.mjs — what every script here needs before it can answer anything: getting a
// whole answer onto stdout, reading a paginated `gh` response, and keeping a value
// that reaches a url inside one path segment.
//
// It lives beside the scripts rather than in each of them because all three were
// already written twice, and each was got wrong at least once — the exit that
// truncates, the page that is not a list, the guard that refuses `main`.

import { writeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// `process.stdout.write` hands bytes to a pipe ASYNCHRONOUSLY, and `process.exit`
// drops whatever has not reached the OS — so an answer past the 64KB pipe buffer
// arrives truncated mid-token, as valid-looking JSON that will not parse. Writing
// from the write's own callback flushes it, but then the exit is asynchronous too:
// execution CONTINUES past the refusal that called it. Both have to hold, so the
// write is synchronous and the exit stays where it was.
export function writeAll(fd, text) {
  const buf = Buffer.from(text, 'utf8');
  let off = 0;
  while (off < buf.length) {
    try {
      off += writeSync(fd, buf, off, buf.length - off);
    } catch (e) {
      // A non-blocking pipe whose reader is behind says EAGAIN rather than writing
      // less; retrying is the whole handling. Anything else — a closed reader above
      // all — is not something to spin on.
      if (e.code !== 'EAGAIN') return;
    }
  }
}

// Not hex, and deliberately: a forge endpoint takes a ref, so `main` reaches it as
// legitimately as an object id, and a length floor would refuse the commonest branch
// names while admitting nothing safer. What matters is that a value is ONE url path
// segment and cannot steer the request elsewhere, so the class excludes everything
// that would: a separator, a query, a fragment, an escape, and git's own `^ ~ : ? *
// [`, which no ref may carry anyway. `{` and `}` go too — `gh api` substitutes
// `{owner}`, `{repo}` and `{branch}` from the repository of the CURRENT directory, so
// a branch actually named `{repo}` sends the request somewhere else.
export const SEGMENT = /^[^/\\\s?#%~^:*[\]{}]+$/;
export const readable = (v) => typeof v === 'string' && SEGMENT.test(v)
  && !v.includes('..') && !v.startsWith('-');
// A BRANCH name is many segments — `release/1.0` is ordinary. Each is held to the
// same rule; what keeps it inside the url is `encodeURIComponent` at the call site.
export const refOk = (v) => typeof v === 'string' && v !== ''
  && v.split('/').every((seg) => readable(seg) && seg !== '.');
export const repoOk = (v) => {
  if (typeof v !== 'string') return false;
  const p = v.split('/');
  return p.length === 2 && p.every(readable);
};

export const runner = (cwd) => (args, timeout = 120000) => {
  const r = spawnSync('gh', args, { cwd, encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024 });
  return {
    ok: r.status === 0,
    out: (r.stdout || '').trim(),
    err: (r.stderr || '').trim(),
    line: () => (r.stderr || '').trim().split('\n').filter(Boolean).pop() || 'no detail',
  };
};

// A paginated `gh api` prints one JSON document per page, concatenated. Parsed as one
// document that is a syntax error; parsed as the first page it IS the first page —
// the "first page is not the list" failure happening inside the reader written to
// prevent it. Split on brace depth outside strings.
//
// `null` for a body that is not JSON and `null` for no body at all: nothing printed
// by a call that exited 0 brought no answer, and returning `[]` would turn that into
// "this has nothing", which is the confusion these scripts exist to prevent.
export function parsePages(text) {
  const pages = [];
  let rest = String(text ?? '').trim();
  if (!rest) return null;
  while (rest) {
    let depth = 0; let inString = false; let escaped = false; let end = -1;
    for (let i = 0; i < rest.length; i += 1) {
      const c = rest[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') { inString = true; continue; }
      if (c === '[' || c === '{') depth += 1;
      else if (c === ']' || c === '}') {
        depth -= 1;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    if (end === -1) return null;
    try { pages.push(JSON.parse(rest.slice(0, end))); } catch { return null; }
    rest = rest.slice(end).trim();
  }
  return pages;
}

// ONE actor, a different login on every surface: `copilot-pull-request-reviewer[bot]`
// on the reviews feed, `Copilot` on comments and on the timeline,
// `copilot-pull-request-reviewer` in GraphQL. A filter pinned to one spelling matches
// nothing on the others, and the failure is SILENT — an empty result reads as "no
// findings" rather than as a filter that missed. Match the pair, which also survives
// the bot being renamed again.
export const isCopilot = (who) => {
  if (!who || typeof who !== 'object') return false;
  const type = typeof who.type === 'string' ? who.type : '';
  const login = typeof who.login === 'string' ? who.login : '';
  return type === 'Bot' && /^copilot/i.test(login);
};
