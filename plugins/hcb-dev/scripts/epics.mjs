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
// A label name travels inside a search phrase and a URL: a quote would end the phrase it is
// quoted in, a comma is GitLab's list separator, and a control character is no label anyone wrote.
if (opts.label === '' || /[",\u0000-\u001f\u007f]/.test(opts.label) || opts.label.length > 100) {
  die('--label takes a label name');
}
// Held to the rule every path segment is; how many segments an owner may have is the forge's,
// settled once the forge is known.
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
const coord = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '') : null);

// Which forge, and which HOST, this checkout lives on — read off what answers for it. `gh repo
// view` resolves the repository and its host from the remote, where `gh api` would ask the
// default host; `glab api` resolves both from the checkout itself. Every later call names the
// host outright, since a search carries no repository to resolve one from.
const probe = (cmd) => {
  const args = cmd === 'gh' ? ['repo', 'view', '--json', 'url']
    : ['api', ...(opts.host ? ['--hostname', opts.host] : []), 'projects/:fullpath'];
  const r = runner(opts.dir, cmd)(args, 60000);
  if (!r.ok) return { cmd, ok: false, why: `${cmd}: ${r.timedOut ? 'no answer in time' : r.line()}` };
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
// is one epic.
const seen = new Set();
const add = ({ repo, number, title, url, updated, children }) => {
  const row = { repo: coord(repo), number: Number.isInteger(number) ? number : null, title: text(title),
    url: coord(url), updated: text(updated), children };
  const key = row.url ?? (row.repo && row.number !== null ? `${row.repo}#${row.number}` : null);
  if (key !== null && seen.has(key)) return;
  if (key !== null) seen.add(key);
  answer.epics.push(row);
};

const pagesOf = (r, what) => {
  if (!r.ok) { answer.reason = text(`${what} could not be read: ${r.timedOut ? 'no answer in time' : r.line()}`); out(); }
  const pages = parsePages(r.out);
  if (pages === null) { answer.reason = `${what} was not JSON`; out(); }
  return pages;
};

if (forge === 'gh') {
  // An owner here is one account, and the search refuses more of them than this in one query
  // (`references/forge-behaviour.md`).
  if (opts.owners.some((o) => o.includes('/'))) die('--owner takes an account on GitHub');
  if (opts.owners.length > 15) die('--owner takes at most 15 owners on GitHub');
  // Each owner is an organisation or a user, and the qualifier differs. Without owners,
  // `author:@me` — the account's own epics, wherever they stand — is one query over every owner.
  const quals = [];
  for (const o of opts.owners) {
    const who = cli(['api', '--hostname', host, `users/${encodeURIComponent(o)}`], 60000);
    let type = null;
    if (who.ok) { try { type = JSON.parse(who.out)?.type; } catch { /* no type */ } }
    if (type !== 'Organization' && type !== 'User') {
      answer.reason = text(`owner '${o}' could not be resolved: ${who.ok ? 'no type in the answer' : who.line()}`);
      out();
    }
    quals.push(`${type === 'Organization' ? 'org' : 'user'}:${o}`);
  }
  // Advanced search, asked for rather than defaulted to: it takes owners OR-ed in parentheses,
  // and the default search refuses that form outright instead of answering something else.
  const scope = quals.length ? `(${quals.join(' OR ')})` : 'author:@me';
  const q = `is:issue is:open label:"${opts.label}" ${scope}`;
  const pages = pagesOf(cli(['api', '--hostname', host, '--paginate', '-X', 'GET', 'search/issues',
    '-f', `q=${q}`, '-f', 'advanced_search=true', '-f', 'per_page=100'], 180000), 'the search');
  let total = null;
  let incomplete = false;
  for (const p of pages) {
    if (!p || typeof p !== 'object' || !Array.isArray(p.items)) {
      answer.reason = 'the search answered with something that is not a result page';
      out();
    }
    // The largest count any page reported: one that shrank between pages is no licence to call
    // a shorter list whole.
    if (typeof p.total_count === 'number') total = Math.max(total ?? 0, p.total_count);
    if (p.incomplete_results === true) incomplete = true;
    for (const it of p.items) {
      const sub = it?.sub_issues_summary;
      add({
        repo: typeof it?.repository_url === 'string' ? it.repository_url.split('/').slice(-2).join('/') : null,
        number: it?.number,
        title: it?.title,
        url: it?.html_url,
        updated: it?.updated_at,
        children: sub && Number.isInteger(sub.total)
          ? { total: sub.total, completed: Number.isInteger(sub.completed) ? sub.completed : null }
          : null,
      });
    }
  }
  // A search stops at 1 000 hits and says so only in its count, and one that timed out on the
  // forge's side says so only in its flag: either way the list is not the set.
  answer.count = total;
  answer.complete = !incomplete && total !== null && answer.epics.length >= total;
} else {
  // GitLab's own words for "none" and "any" are no label to list by.
  if (/^(none|any)$/i.test(opts.label)) die('--label takes a label name');
  // Without owners, what the account created — never `all`, which on a public instance is every
  // issue the account can see. An owner is a group, read through the group's own listing.
  // Archived projects included: an epic open there is still open.
  const q = `labels=${encodeURIComponent(opts.label)}&state=opened&non_archived=false&per_page=100`;
  const lists = opts.owners.length
    ? opts.owners.map((o) => ({ path: `groups/${encodeURIComponent(o)}/issues?${q}`, what: `group '${o}'`, group: true }))
    : [{ path: `issues?${q}&scope=created_by_me`, what: 'the listing', group: false }];
  for (const list of lists) {
    const r = cli(['api', '--hostname', host, '--paginate', list.path], 180000);
    if (!r.ok && list.group && /\(HTTP 404\)/.test(r.err)) {
      answer.reason = text(`${list.what} is not a group this account can read: ${r.line()}`);
      out();
    }
    for (const p of pagesOf(r, list.what)) {
      if (!Array.isArray(p)) { answer.reason = `${list.what} answered with something that is not a list`; out(); }
      for (const it of p) {
        const ref = typeof it?.references?.full === 'string' ? it.references.full : null;
        add({
          repo: ref ? ref.replace(/#\d+$/, '') : null,
          number: it?.iid,
          title: it?.title,
          url: it?.web_url,
          updated: it?.updated_at,
          // A related link is listed, not counted: GitLab keeps no child count for an issue.
          children: null,
        });
      }
    }
  }
  answer.count = answer.epics.length;
  answer.complete = true;
}

answer.read = true;
out();
