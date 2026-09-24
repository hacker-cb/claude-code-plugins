// forge.mjs — what every script here needs before it can answer anything: getting a
// whole answer onto stdout, reading a paginated `gh` response, and keeping a value
// that reaches a url inside one path segment.
//
// It lives beside the scripts rather than in each of them because all three were
// already written twice, and each was got wrong at least once — the exit that
// truncates, the page that is not a list, the guard that refuses `main`.

import { statSync, writeSync } from 'node:fs';
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
// A LOCAL ref name, by GIT's rules rather than a URL's. `git check-ref-format` is the
// authority and this mirrors the part of it a branch name can reach: git accepts `#` and
// `%`, which a URL-segment class refuses, and a sweep that cannot read those names simply
// leaves those branches out of the answer.
export const refNameOk = (v) => {
  if (typeof v !== 'string' || v === '' || v === '@') return false;
  if (v.startsWith('-') || v.startsWith('/') || v.endsWith('/')) return false;
  if (v.endsWith('.')) return false;
  if (/[\u0000-\u001f\u007f ~^:?*[\\]/.test(v)) return false;
  if (v.includes('..') || v.includes('//') || v.includes('@{')) return false;
  return v.split('/').every((c) => c !== '' && !c.startsWith('.') && !c.endsWith('.lock'));
};

// Safe to hand to a SHELL, which is a narrower question than either of the two above:
// git accepts `$ ( ) ` ; & | ' " < >` in a branch name, a caller pastes the name into a
// command, and the quoting is then the attacker's to choose. `false` does not stop a
// branch being read — it says the name has to reach the command through a variable
// rather than through the text of it.
export const nameSafe = (v) => typeof v === 'string' && v !== ''
  && !v.startsWith('-') && /^[A-Za-z0-9._/+#%@-]+$/.test(v);

// `--repo-dir` reaches `spawnSync` as `cwd`, where a path that is not there produces
// `status: null` with an EMPTY stderr — so a malformed invocation comes back as a forge
// that would not answer, or a checkout that is not a checkout. Answered here instead, by
// the argument, which is what the caller can actually fix.
export const dirOk = (v) => {
  try { return statSync(v).isDirectory(); } catch { return false; }
};

export const repoOk = (v) => {
  if (typeof v !== 'string') return false;
  const p = v.split('/');
  return p.length === 2 && p.every(readable);
};
// A project's PATH, on either forge: GitHub's is always two segments, GitLab's nests a project
// under up to twenty levels of groups, and `glab --repo` takes it whole. Each segment held as a
// branch's are — never `..` or `.`, which a server normalises into a request about somewhere else.
export const projectPathOk = (v) => refOk(v) && v.split('/').length >= 2 && v.split('/').length <= 21;

// `gh` by default because most callers ask a forge; `git` where the question is the
// checkout's. Same three-part answer either way — a caller that cannot tell a failed
// call from an empty one is the defect every script here is written against.
// A forge HOST, which is not a path segment: it may carry a port, and the segment class
// refuses the `:` that separates one. A self-hosted instance on a non-default port then
// gets no host passed at all and the request goes to the SaaS instead — which is the one
// thing reading the host was for.
export const hostOk = (v) => typeof v === 'string'
  && /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::[0-9]{1,5})?$/.test(v);

export const runner = (cwd, cmd = 'gh') => (args, timeout = 120000) => {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    timeout,
    maxBuffer: 32 * 1024 * 1024,
    // git TRANSLATES its diagnostics, and every reader here compares that text against
    // English. Measured: the same missing branch prints `couldn't find remote ref` under
    // `LC_ALL=C` and `Konnte Remote-Referenz … nicht finden` under a German locale, so a
    // classification resting on the words is right on one machine and silently wrong on
    // the next. Pinned here rather than at each call, because every `.err` read in this
    // plugin has the same exposure.
    env: { ...process.env, LC_ALL: 'C', LANG: 'C', LC_MESSAGES: 'C' },
  });
  return {
    ok: r.status === 0,
    // The exit CODE, not only whether it was zero: git says "these two share no history"
    // with 1 and "I could not answer" with 128, and a caller that cannot tell them apart
    // reports an unrelated base where it should report an unknown one.
    code: typeof r.status === 'number' ? r.status : null,
    // The timeout above KILLED it, which is not an answer of any kind — the process was
    // stopped before it said yes or no, and a caller reading that as a no states what it
    // never measured. `error.code` is the one mark of it: `signal` arrives as `SIGTERM`
    // or as `SIGPIPE` depending on where the kill landed, and a process killed by
    // somebody else carries a signal with no error at all.
    timedOut: Boolean(r.error && r.error.code === 'ETIMEDOUT'),
    out: (r.stdout || '').trim(),
    err: (r.stderr || '').trim(),
    // Split on BOTH separators: a progress line ends in `\r`, so a whole `Writing
    // objects` chain is one `\n`-line and reaches a reader as kilobytes of it.
    line: () => (r.stderr || '').split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean).pop()
      || 'no detail',
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

// A bot the pair above does not take for Copilot. Nothing is decided on it: it is what a
// reader is TOLD, because the reviewer answering under a login the pair no longer matches
// looks, from inside every filter here, exactly like the reviewer not being there at all.
export const otherBot = (who) => Boolean(who) && typeof who === 'object'
  && who.type === 'Bot' && !isCopilot(who);

// Another process wrote it, so it is quoted rather than repeated: a string, with the
// control characters that would end a line or a record taken out, and bounded — a value
// of any length or shape would otherwise travel into a reader's context whole.
export const text = (v) => (typeof v === 'string'
  ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200) : null);
// A coordinate — a path, a url — travels whole: bounded like prose at 200 characters, it would name
// another issue. Only the control characters leave; an empty one is none.
export const coord = (v) => {
  const c = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '') : '';
  return c === '' ? null : c;
};

// What `git worktree list` says about each worktree, and nothing about who is in it.
// `-z` because `--porcelain` alone does not escape a path: a worktree whose directory
// carries a newline prints what reads as the start of another record. Older git does not
// take the flag, so the line form is the fallback — the records are separated the same
// way in both, by an empty one.
//
// `null` where the listing could not be read at all. An empty ARRAY would say this
// repository has no worktrees, which is never true of one that answered.
export function worktrees(git) {
  let list = git(['worktree', 'list', '--porcelain', '-z']);
  let records;
  if (list.ok) records = `${list.out}\0`.split('\0');
  else {
    list = git(['worktree', 'list', '--porcelain']);
    if (!list.ok) return { trees: null, error: list.line() };
    records = `${list.out}\n`.split('\n');
  }
  const trees = [];
  let wt = null;
  const push = () => { if (wt) trees.push(wt); };
  for (const line of records) {
    if (line.startsWith('worktree ')) {
      push();
      wt = { path: line.slice('worktree '.length), branch: null, detached: false,
        bare: false, locked: false, lockReason: null, prunable: false, pruneReason: null,
        // The first entry `worktree list` prints is the main working tree, and
        // `worktree remove` refuses it outright: `fatal: '<path>' is a main working tree`.
        isPrimary: trees.length === 0 };
    } else if (!wt) continue;
    else if (line.startsWith('branch ')) wt.branch = line.slice('branch '.length);
    else if (line === 'detached') wt.detached = true;
    else if (line === 'bare') wt.bare = true;
    else if (line === 'locked' || line.startsWith('locked ')) {
      wt.locked = true;
      wt.lockReason = line.length > 'locked '.length ? text(line.slice('locked '.length)) : null;
    } else if (line === 'prunable' || line.startsWith('prunable ')) {
      wt.prunable = true;
      wt.pruneReason = line.length > 'prunable '.length
        ? text(line.slice('prunable '.length)) : null;
    }
  }
  push();
  return { trees, error: null };
}
