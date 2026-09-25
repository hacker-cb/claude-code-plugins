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
// A project's PATH, on either forge: GitHub's is always two segments; GitLab's is the project
// under a namespace of up to twenty ancestors, twenty-two segments at most, and `glab --repo` takes
// it whole. Every segment follows the rules for a branch's segments, and none is `..` or `.`, which
// a server normalises into a request about somewhere else.
export const projectPathOk = (v) => {
  const n = typeof v === 'string' ? v.split('/').length : 0;
  return n >= 2 && n <= 22 && refOk(v);
};

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

// The requests that carry a commit, asked of either forge — mirrored, because the same
// question has two answers and neither forge is assumed. The repository goes in the PATH:
// neither CLI's `api` takes a `--repo`, and without it each reads the one the working
// directory names.
export const COMMIT_REQUESTS = {
  gh: {
    // Positionally, because this command has no `--repo`: passing one fails with
    // `unknown flag`, the probe then answers nothing, and the host goes unresolved.
    probe: (repo) => ['repo', 'view', ...(repo ? [repo] : []), '--json', 'url'],
    // The host this repository actually lives on, read from its own url: a self-hosted
    // instance asked of the SaaS answers about somebody else, or about nothing.
    host: (out) => { try { return new URL(JSON.parse(out).url).host; } catch { return null; } },
    path: (repo, oid) => `repos/${repo || '{owner}/{repo}'}/commits/${oid}/pulls`,
    // `--paginate` here prints ONE DOCUMENT PER PAGE, concatenated; `parsePages` splits
    // them. Parsed as one document it is a syntax error, and as the first page it is the
    // first page — the failure this whole reader exists to avoid.
    read: (out) => { const p = parsePages(out); return p === null ? null : p.flat(); },
    // `state` is open or closed, and `merged_at` is what tells a merged request from a
    // dropped one.
    row: (q) => ({
      number: Number.isInteger(q.number) ? q.number : null,
      state: q.state === 'open' ? 'open' : q.merged_at ? 'merged' : 'closed',
      mergeCommit: refOk(q.merge_commit_sha || '') ? q.merge_commit_sha : null,
      base: typeof q.base?.ref === 'string' ? q.base.ref : null,
    }),
  },
  glab: {
    // No url to read: this CLI takes the host from the checkout itself.
    probe: (repo) => ['api', `projects/${repo ? encodeURIComponent(repo) : ':id'}`],
    host: () => null,
    path: (repo, oid) => `projects/${repo ? encodeURIComponent(repo) : ':id'}`
      + `/repository/commits/${oid}/merge_requests`,
    // `--paginate` here is read either way: one array holding every page, or one array per
    // page as the other CLI prints them — a version may print either.
    read: (out) => { const p = parsePages(out); return p === null || !p.every(Array.isArray) ? null : p.flat(); },
    // `state` carries `merged` outright, and either commit field can hold the landing.
    row: (q) => ({
      number: Number.isInteger(q.iid) ? q.iid : null,
      state: q.state === 'opened' ? 'open' : q.state === 'merged' ? 'merged' : 'closed',
      mergeCommit: refOk(q.merge_commit_sha || '') ? q.merge_commit_sha
        : refOk(q.squash_commit_sha || '') ? q.squash_commit_sha : null,
      base: typeof q.target_branch === 'string' ? q.target_branch : null,
    }),
  },
};

// What a call that did not answer says: its last line, or that it ran out of time.
export const why = (r) => (r.timedOut ? 'timed out' : r.line());

// Which CLI answers for THIS REPOSITORY — whichever RESPONDS here, since a hostname cannot
// say it: a self-hosted instance answers on an arbitrary domain. BOTH answering is an
// ambiguity rather than a race the first one wins: a GitLab project mirrored to GitHub under
// the same path answers on both, and a first-success order asks the mirror. `cli` is how a
// caller settles it. `reader` null with `reason` where none can be asked.
export function forgeFor(cwd, cli, repo) {
  const answers = [];
  let reason = null;
  for (const c of cli ? [cli] : ['gh', 'glab']) {
    const p = runner(cwd, c)(COMMIT_REQUESTS[c].probe(repo));
    if (!p.ok) { if (!reason) reason = `${c}: ${p.line()}`; continue; }
    answers.push({ cli: c, out: p.out });
  }
  if (answers.length !== 1) {
    return { cli: null, reader: null, hostArgs: [], reason: answers.length ? `both ${answers.map((a) => a.cli).join(' and ')}`
      + ' answer for this repository — name one with --forge, since the wrong one answers about a mirror' : reason };
  }
  const { cli: c, out } = answers[0];
  const host = COMMIT_REQUESTS[c].host(out);
  return { cli: c, reader: COMMIT_REQUESTS[c], hostArgs: hostOk(host) ? ['--hostname', host] : [], reason: null };
}

// The requests that carry one commit, read as `COMMIT_REQUESTS` rows: `rows`, or `error` where
// the forge did not answer. `--paginate`, or a request on page two is one nobody saw.
export function requestsOf(found, cwd, repo, oid) {
  const r = runner(cwd, found.cli)(['api', ...found.hostArgs, '--paginate', found.reader.path(repo, oid)]);
  if (!r.ok) return { error: why(r) };
  const rows = found.reader.read(r.out);
  if (rows === null) return { error: 'the answer was not JSON' };
  return { rows: rows.filter((q) => q && typeof q === 'object').map(found.reader.row) };
}

// A runner result's failure in words: a timeout names itself, since a killed process leaves no
// line of its own.
export const failureOf = (r) => (r.timedOut ? 'no answer in time' : r.line());

// A host as a URL reads it: only the scheme's own default port is dropped, and a port named on
// purpose stays, picking an endpoint of its own.
export const hostNorm = (h) => { try { return new URL(`https://${h}`).host.toLowerCase(); } catch { return h.toLowerCase(); } };
const hostBare = (h) => hostNorm(h).replace(/:\d+$/, '');
// An ssh alias is a word of the user's own configuration; a leading `-` would reach ssh as an option.
const aliasOk = (v) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v);

// The hosts a checkout's remotes name. A host no remote names and nobody passed is a server telling
// a run where to write — with the user's token for that host — and is refused. An SSH alias of the
// user's own ssh configuration stands for the host it names; `ssh.<host>` is the port-443 SSH front
// a forge keeps beside itself. A web remote keeps a port it names; an SSH remote's port is SSH's,
// and says nothing of the web endpoint.
export function remoteHosts(dir) {
  const r = runner(dir, 'git')(['remote', '-v'], 30000);
  const web = new Set();
  const ssh = new Set();
  for (const line of r.ok ? r.out.split('\n') : []) {
    const url = line.split(/\s+/)[1] ?? '';
    const scheme = url.match(/^([a-z][a-z0-9+.-]*):\/\/(?:[^@/]*@)?([^/]+)/i);
    const scp = scheme || url.includes('://') || /^[A-Za-z]:[\\/]/.test(url) ? null : url.match(/^(?:[^@/]*@)?([^/:]+):/);
    if (scheme && !/ssh/i.test(scheme[1])) {
      try { web.add(new URL(url).host.toLowerCase()); } catch { /* not a URL a web host reads from */ }
      continue;
    }
    const h = scheme ? scheme[2].replace(/:\d+$/, '') : scp?.[1];
    if (!h || !aliasOk(h)) continue;
    ssh.add(h.toLowerCase());
  }
  for (const h of [...ssh]) {
    const g = runner(dir, 'ssh')(['-G', '--', h], 10000);
    const name = g.ok ? g.out.split('\n').find((l) => l.startsWith('hostname '))?.slice(9).trim() : null;
    if (name && hostOk(name)) ssh.add(name.toLowerCase());
  }
  for (const h of [...ssh]) if (h.startsWith('ssh.')) ssh.add(h.slice(4));
  return { has: (h) => web.has(hostNorm(h)) || (hostNorm(h) === hostBare(h) && ssh.has(hostBare(h))) };
}

// Which forge, host and repository a run writes to — resolved from what answers, never from a
// hostname, and only onto a host a remote of the checkout names or the caller named after checking.
// With `url`, a change request's URL a CLI printed: its repository is the one the forge answers for
// at that host — on GitLab under the instance's relative root, so the path is tried from its longest
// and taken where the project's own URL is the request's. Answers { forge, host, path } or
// { reason }.
export function resolveRepository({ dir, forge = null, host = null, repo = null, url = null, number = null }) {
  const fail = (reason) => ({ reason });
  let remotes = null;
  const named = (h) => { remotes ??= remoteHosts(dir); return remotes.has(h); };
  const probe = (cmd, checkout = false) => {
    const r0 = checkout ? null : repo;
    const h0 = checkout ? null : host;
    const target = r0 && h0 && cmd === 'gh' ? `${h0}/${r0}` : r0;
    const args = cmd === 'gh'
      ? ['repo', 'view', ...(target ? [target] : []), '--json', 'url,nameWithOwner']
      : ['api', ...(h0 ? ['--hostname', h0] : []), r0 ? `projects/${encodeURIComponent(r0)}` : 'projects/:fullpath'];
    const r = runner(dir, cmd)(args, 60000);
    if (!r.ok) return { cmd, ok: false, why: `${cmd}: ${failureOf(r)}` };
    try {
      const v = JSON.parse(r.out);
      const u = new URL(cmd === 'gh' ? v?.url : v?.web_url);
      const p = cmd === 'gh' ? v?.nameWithOwner : v?.path_with_namespace;
      if (typeof p !== 'string') throw new Error('no path');
      return { cmd, ok: true, host: u.host, path: p };
    } catch {
      return { cmd, ok: false, why: `${cmd}: answered without a repository and its path` };
    }
  };
  let answer;
  if (url) {
    const h = url.host;
    // A host the user named and checked stands for the remotes; otherwise a remote must name it.
    if (host !== null ? hostNorm(host) !== hostNorm(h) : !named(h)) {
      return fail(`the request's URL names ${h}, which ${host !== null ? 'is not the --host named' : 'no remote of this checkout names'}`);
    }
    const segs = url.pathname.split('/').filter(Boolean);
    const whole = `${url.origin}${url.pathname}`.replace(/\/+$/, '');
    if (forge === 'gh') {
      const p = segs.slice(0, 2).join('/');
      if (segs.length !== 4 || !repoOk(p)) return fail('the request\'s URL names no owner/name');
      answer = { forge: 'gh', host: h, path: p };
    } else {
      const project = segs.slice(0, segs.lastIndexOf('-'));
      let last = 'nothing asked';
      for (let k = 0; k < project.length - 1 && !answer; k += 1) {
        const r = runner(dir, 'glab')(['api', '--hostname', h, `projects/${encodeURIComponent(project.slice(k).join('/'))}`], 60000);
        if (!r.ok) { last = failureOf(r); continue; }
        try {
          const v = JSON.parse(r.out);
          if (`${String(v?.web_url).replace(/\/+$/, '')}/-/merge_requests/${number}` === whole
            && typeof v.path_with_namespace === 'string') answer = { forge: 'glab', host: h, path: v.path_with_namespace };
        } catch { /* not this one */ }
      }
      if (!answer) return fail(`no project on that host answers for the request's URL — the last answer: ${last}`);
    }
  } else {
    // A repository named without a host is looked for on the host this checkout lives on, never on
    // whichever host the CLI would otherwise default to.
    if (repo !== null && host === null) {
      const here = probe(forge, true);
      if (!here.ok) return fail(`--repo without --host takes this checkout's host, and it did not answer — ${here.why}`);
      if (!named(here.host)) return fail(`this checkout answered with ${here.host}, which none of its remotes names — pass --host`);
      host = here.host;
    }
    const probed = (forge ? [forge] : ['gh', 'glab']).map((c) => probe(c));
    for (const p of probed) {
      if (p.ok && host && hostNorm(p.host) !== hostNorm(host)) {
        Object.assign(p, { ok: false, why: `${p.cmd}: this repository lives on ${p.host}` });
      } else if (p.ok && !host && !named(p.host)) {
        Object.assign(p, { ok: false, why: `${p.cmd}: answered with ${p.host}, which no remote of this checkout names — pass --host` });
      }
    }
    const answered = probed.filter((p) => p.ok);
    if (answered.length === 0) return fail(`no forge CLI answered for this repository — ${probed.map((p) => p.why).join('; ')}`);
    if (answered.length > 1) return fail('both forges answer for this repository — name one with --forge');
    answer = { forge: answered[0].cmd, host: answered[0].host, path: answered[0].path };
    // gh opens a request wherever GH_REPO points while `gh repo view` answers for the checkout.
    if (answer.forge === 'gh' && process.env.GH_REPO && repo === null) {
      return fail('GH_REPO is set: name the repository with --repo, or the request with --url');
    }
  }
  if (!hostOk(answer.host) || !projectPathOk(answer.path)) return fail('the repository answered without a host and path this run can name');
  return answer;
}
