#!/usr/bin/env node
// epics.mjs — which epics are open: every issue carrying the epic label, across every owner the
// account reaches, not the one repository a session happens to stand in.
//
// A coordinating session's epic is an issue with the plugin's `epic` label on it
// (`references/epic-structure.md`). Where they are is a forge search, and three things there are
// mechanical and easy to get silently wrong: the host (a search asked without one goes to the
// CLI's default host, not to the one this checkout lives on), the scope (GitLab's `all` is every
// issue the account can SEE, public projects of strangers included), and whether the list that
// came back is the whole set.
//
// It READS and lists; what an epic's ledger says is `ledger.mjs`'s.

import { dirOk, hostOk, parsePages, refOk, runner, text, writeAll } from './lib/forge.mjs';

const usage = 'usage: node epics.mjs [--forge gh|glab] [--host <host>] [--label <name>]'
  + ' [--owner <owner>]... [--repo-dir <path>]';

const die = (msg) => { writeAll(2, `epics: ${msg}\n${usage}\n`); process.exit(2); };

const opts = { forge: null, host: null, label: 'epic', owners: [], dir: process.cwd() };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  const val = () => { if (i + 1 >= argv.length) die(`${a} takes a value`); return argv[i += 1]; };
  if (a === '--forge') opts.forge = val();
  else if (a === '--host') opts.host = val();
  else if (a === '--label') opts.label = val();
  else if (a === '--owner') opts.owners.push(val());
  else if (a === '--repo-dir') opts.dir = val();
  else die(`unknown argument '${a}'`);
}

if (!dirOk(opts.dir)) die(`--repo-dir '${opts.dir}' is not a directory`);
if (opts.forge !== null && opts.forge !== 'gh' && opts.forge !== 'glab') die('--forge takes gh or glab');
if (opts.host !== null && !hostOk(opts.host)) die('--host takes a forge host');
// A label name travels inside a quoted search phrase and a URL: a quote or a backslash would end
// or escape the phrase, a comma is GitLab's list separator, and a control character is no label
// anyone wrote.
if (opts.label === '' || /[",\\\u0000-\u001f\u007f]/.test(opts.label) || opts.label.length > 100) {
  die('--label takes a label name');
}
for (const o of opts.owners) {
  if (!refOk(o) || o.split('/').length > 20) die(`--owner '${o}' is not an owner`);
}

const answer = {
  read: false,
  forge: null,
  host: null,
  label: opts.label,
  owners: opts.owners,
  epics: [],
  count: null,
  complete: null,
  reason: null,
};
const out = () => { writeAll(1, `${JSON.stringify(answer, null, 2)}\n`); process.exit(0); };

// A coordinate travels whole: `text()` bounds prose at 200 characters, and a path or a url cut
// there names another issue.
const coord = (v) => {
  const c = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '') : '';
  return c === '' ? null : c;
};

// What a call that did not answer says about it — a timeout names itself, since a killed process
// leaves no line of its own.
const why = (r) => (r.timedOut ? 'no answer in time' : r.line());

// Which forge, and which HOST, this checkout lives on — read off what answers for it. `gh repo
// view` resolves the repository and its host from the remote, where `gh api` would ask the
// default host; `glab api` resolves both from the checkout itself. Every later call names the
// host outright, since a search carries no repository to resolve one from.
const probe = (cmd) => {
  const args = cmd === 'gh' ? ['repo', 'view', '--json', 'url']
    : ['api', ...(opts.host ? ['--hostname', opts.host] : []), 'projects/:fullpath'];
  const r = runner(opts.dir, cmd)(args, 60000);
  if (!r.ok) return { cmd, ok: false, why: `${cmd}: ${why(r)}` };
  let url = null;
  try { const parsed = JSON.parse(r.out); url = cmd === 'gh' ? parsed?.url : parsed?.web_url; } catch { /* no url */ }
  let host = null;
  try { host = new URL(url).host; } catch { /* no host */ }
  return { cmd, ok: true, host };
};

// Both named: nothing is left for a repository to answer, and the listing runs from anywhere.
const probed = opts.forge && opts.host ? [{ cmd: opts.forge, ok: true, host: opts.host }]
  : (opts.forge ? [opts.forge] : ['gh', 'glab']).map(probe);
const answered = probed.filter((p) => p.ok);
if (answered.length === 0) {
  answer.reason = text(`no forge CLI answered for this repository — ${probed.map((p) => p.why).join('; ')}`);
  out();
}
if (answered.length > 1) { answer.reason = 'both forges answer for this repository — name one with --forge'; out(); }
const forge = answered[0].cmd;
const host = opts.host ?? answered[0].host;
if (!hostOk(host)) { answer.reason = 'the repository answered without a host this run can name'; out(); }
answer.forge = forge;
answer.host = host;
const cli = runner(opts.dir, forge);

// One epic reached twice — two owners that overlap, a page that shifted under a paginated walk —
// is one epic. Answers the row's key, so a query can count what it reached apart from repeats.
const seen = new Set();
const add = ({ repo, number, title, url, updated, children }) => {
  const row = { repo: coord(repo), number: Number.isInteger(number) ? number : null, title: text(title),
    url: coord(url), updated: text(updated), children };
  const key = row.url ?? (row.repo && row.number !== null ? `${row.repo}#${row.number}` : null);
  if (key === null) { answer.epics.push(row); return {}; }
  if (!seen.has(key)) { seen.add(key); answer.epics.push(row); }
  return key;
};
// Refused after the forge is known: read, not a usage error, so the answer stays JSON.
const refuse = (msg) => { answer.reason = msg; out(); };

const failed = (r, what) => text(`${what} could not be read: ${why(r)}`);
const pagesOf = (r, what) => {
  if (!r.ok) { answer.reason = failed(r, what); out(); }
  const pages = parsePages(r.out);
  if (pages === null) { answer.reason = `${what} was not JSON`; out(); }
  return pages;
};

let complete = true;
if (forge === 'gh') {
  // One query per owner, each an organisation or a user by its own qualifier; without owners,
  // `author:@me` — the account's own epics, wherever they stand — is one query over every owner.
  // A single owner reads alike in the default search and the advanced one, where several joined
  // in one query do not (`references/forge-behaviour.md`).
  const scopes = [];
  for (const o of opts.owners) {
    if (o.includes('/')) refuse(`owner '${o}' is a path, and a GitHub owner is one account`);
    const who = cli(['api', '--hostname', host, `users/${encodeURIComponent(o)}`], 60000);
    let type = null;
    if (who.ok) { try { type = JSON.parse(who.out)?.type; } catch { /* no type */ } }
    if (type !== 'Organization' && type !== 'User') {
      answer.reason = text(`owner '${o}' could not be resolved: ${who.ok ? 'no type in the answer' : why(who)}`);
      out();
    }
    scopes.push(`${type === 'Organization' ? 'org' : 'user'}:${o}`);
  }
  if (scopes.length === 0) scopes.push('author:@me');
  for (const scope of scopes) {
    // Each page cut down to what a row takes before it reaches this process: issue bodies would
    // otherwise ride along, a page at a time, into one buffer.
    const pages = pagesOf(cli(['api', '--hostname', host, '--paginate', '-X', 'GET', 'search/issues',
      '-f', `q=is:issue is:open label:"${opts.label}" ${scope}`, '-f', 'per_page=100', '--jq',
      '{total_count, incomplete_results, items: [.items[]? | {number, title, html_url, repository_url, updated_at, sub_issues_summary}]}'],
    180000), `the search over ${scope}`);
    let total = null;
    const reached = new Set();
    for (const p of pages) {
      if (!p || typeof p !== 'object' || !Array.isArray(p.items)) {
        answer.reason = 'the search answered with something that is not a result page';
        out();
      }
      // The largest count any page reported: one that shrank between pages is no licence to
      // call a shorter list whole.
      if (typeof p.total_count === 'number') total = Math.max(total ?? 0, p.total_count);
      // A search the forge timed out on says so only in its flag.
      if (p.incomplete_results === true) complete = false;
      for (const it of p.items) {
        const sub = it?.sub_issues_summary;
        // Counted by key, never as delivered: a row a shifted page repeats is not the one it
        // pushed off.
        reached.add(add({
          repo: typeof it?.repository_url === 'string' ? it.repository_url.split('/').slice(-2).join('/') : null,
          number: it?.number,
          title: it?.title,
          url: it?.html_url,
          updated: it?.updated_at,
          children: sub && Number.isInteger(sub.total)
            ? { total: sub.total, completed: Number.isInteger(sub.completed) ? sub.completed : null }
            : null,
        }));
      }
    }
    const got = reached.size;
    // A search stops at 1 000 hits and says so only in its count; one that gave no count leaves
    // nothing to check against.
    if (total === null) complete = complete === false ? false : null;
    else if (got < total) complete = false;
  }
} else {
  // GitLab's own words for "none" and "any" are no label to list by.
  if (/^(none|any|no label)$/i.test(opts.label)) refuse(`'${opts.label}' is GitLab's own word, not a label to list by`);
  // Without owners, what the account created — never `all`, which on a public instance is every
  // issue the account can see. An owner is a group, read through the group's own listing.
  // Archived projects included: an epic open there is still open.
  const q = `labels=${encodeURIComponent(opts.label)}&state=opened&non_archived=false`;
  const lists = opts.owners.length
    ? opts.owners.map((o) => ({ path: `groups/${encodeURIComponent(o)}/issues?${q}`, what: `group '${o}'` }))
    : [{ path: `issues?${q}&scope=created_by_me`, what: 'the listing' }];
  for (const list of lists) {
    // The count first, from the header a one-row page carries: a paginated walk says nothing
    // about how many there were. GitLab leaves the header out past a size it will not count, and
    // the list is then of unknown completeness rather than complete.
    const head = cli(['api', '--hostname', host, '-i', `${list.path}&per_page=1`], 60000);
    if (!head.ok) {
      answer.reason = /\(HTTP 404\)/.test(head.err) && opts.owners.length
        ? text(`${list.what} is not a group this account can read: ${head.line()}`)
        : failed(head, list.what);
      out();
    }
    const header = /^x-total:\s*(\d+)\s*$/im.exec(head.out.split(/\r?\n\r?\n/)[0] ?? '');
    const total = header ? Number(header[1]) : null;
    const reached = new Set();
    for (const p of pagesOf(cli(['api', '--hostname', host, '--paginate', `${list.path}&per_page=100`], 180000), list.what)) {
      if (!Array.isArray(p)) { answer.reason = `${list.what} answered with something that is not a list`; out(); }
      for (const it of p) {
        const ref = typeof it?.references?.full === 'string' ? it.references.full : null;
        reached.add(add({
          repo: ref ? ref.replace(/#\d+$/, '') : null,
          number: it?.iid,
          title: it?.title,
          url: it?.web_url,
          updated: it?.updated_at,
          // A related link is listed, not counted: GitLab keeps no child count for an issue.
          children: null,
        }));
      }
    }
    const got = reached.size;
    if (total === null) complete = complete === false ? false : null;
    else if (got < total) complete = false;
  }
}

answer.count = answer.epics.length;
// Whether every query came back whole: `null` where one of them could not be counted.
answer.complete = complete;
answer.read = true;
out();
