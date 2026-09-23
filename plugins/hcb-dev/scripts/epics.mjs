#!/usr/bin/env node
// epics.mjs — which epics are open: every issue carrying the epic label, across every owner the
// account reaches, not the one repository a session happens to stand in.
//
// A coordinating session's epic is an issue with the plugin's `epic` label on it
// (`references/epic-structure.md`). Where they are is a forge search, and two things there are
// mechanical and easy to get silently wrong: the host (a search asked without one goes to the
// CLI's default host, not to the one this checkout lives on), and the scope (GitLab's `all`
// is every issue the account can SEE, public projects of strangers included).
//
// It READS and lists; what an epic's ledger says is `ledger.mjs`'s.

import { dirOk, hostOk, parsePages, readable, runner, text, writeAll } from './lib/forge.mjs';

const usage = 'usage: node epics.mjs [--forge gh|glab] [--host <host>] [--label <name>]'
  + ' [--owner <owner>]... [--repo-dir <path>]';

const opts = { forge: null, host: null, label: 'epic', owners: [], dir: process.cwd() };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  const val = () => {
    if (i + 1 >= argv.length) { writeAll(2, `epics: ${a} takes a value\n${usage}\n`); process.exit(2); }
    return argv[i += 1];
  };
  if (a === '--forge') opts.forge = val();
  else if (a === '--host') opts.host = val();
  else if (a === '--label') opts.label = val();
  else if (a === '--owner') opts.owners.push(val());
  else if (a === '--repo-dir') opts.dir = val();
  else { writeAll(2, `epics: unknown argument '${a}'\n${usage}\n`); process.exit(2); }
}

const die = (msg) => { writeAll(2, `epics: ${msg}\n${usage}\n`); process.exit(2); };
if (!dirOk(opts.dir)) die(`--repo-dir '${opts.dir}' is not a directory`);
if (opts.forge !== null && opts.forge !== 'gh' && opts.forge !== 'glab') die('--forge takes gh or glab');
if (opts.host !== null && !hostOk(opts.host)) die('--host takes a forge host');
// A label name travels inside a search query and a URL: a quote would end the phrase it is
// quoted in, and a control character is no label anyone wrote.
if (opts.label === '' || /["\u0000-\u001f\u007f]/.test(opts.label) || opts.label.length > 100) {
  die('--label takes a label name');
}
// An owner is one path segment on GitHub and a group path on GitLab.
for (const o of opts.owners) {
  const segs = o.split('/');
  if (segs.length > 20 || !segs.every((s) => readable(s) && s !== '.')) die(`--owner '${o}' is not an owner`);
}
// GitHub refuses a search over more owners than this, whichever syntax carries them
// (`references/forge-behaviour.md`).
if (opts.owners.length > 15) die('--owner takes at most 15 owners');

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

// Which forge, and which HOST, this checkout lives on — read off what answers for it. `gh repo
// view` resolves the repository and its host from the remote, where `gh api` would ask the
// default host; `glab api` resolves both from the checkout itself. Every later call names the
// host outright, since a search carries no repository to resolve one from.
const probe = (cmd) => {
  const args = cmd === 'gh' ? ['repo', 'view', '--json', 'url']
    : ['api', ...(opts.host ? ['--hostname', opts.host] : []), 'projects/:fullpath'];
  const r = runner(opts.dir, cmd)(args, 60000);
  if (!r.ok) return null;
  let parsed = null;
  try { parsed = JSON.parse(r.out); } catch { return null; }
  const url = cmd === 'gh' ? parsed?.url : parsed?.web_url;
  let host = null;
  try { host = new URL(url).host; } catch { host = null; }
  return { cmd, host };
};

// Both named: nothing is left for a repository to answer, and the listing runs from anywhere.
const answered = opts.forge && opts.host ? [{ cmd: opts.forge, host: opts.host }]
  : (opts.forge ? [probe(opts.forge)] : ['gh', 'glab'].map(probe)).filter(Boolean);
if (answered.length === 0) {
  answer.reason = opts.forge
    ? `${opts.forge} did not answer for this repository`
    : 'no forge CLI answered for this repository';
  out();
}
if (answered.length > 1) { answer.reason = 'both forges answer for this repository — name one with --forge'; out(); }
const { cmd: forge } = answered[0];
const host = opts.host ?? answered[0].host;
if (host === null || !hostOk(host)) { answer.reason = 'the repository answered without a host this run can name'; out(); }
answer.forge = forge;
answer.host = host;
const cli = runner(opts.dir, forge);

const pagesOf = (r, what) => {
  if (!r.ok) { answer.reason = text(`${what} could not be read: ${r.line()}`); out(); }
  const pages = parsePages(r.out);
  if (pages === null) { answer.reason = `${what} was not JSON`; out(); }
  return pages;
};

if (forge === 'gh') {
  // Owners named: each is an organisation or a user, and the qualifier differs. Without them,
  // `author:@me` — the account's own epics, wherever they stand — is one query over every owner.
  const quals = [];
  for (const o of opts.owners) {
    const who = cli(['api', '--hostname', host, `users/${encodeURIComponent(o)}`], 60000);
    let type = null;
    if (who.ok) { try { type = JSON.parse(who.out)?.type; } catch { type = null; } }
    if (type !== 'Organization' && type !== 'User') {
      answer.reason = text(`owner '${o}' could not be resolved: ${who.ok ? 'no type in the answer' : who.line()}`);
      out();
    }
    quals.push(`${type === 'Organization' ? 'org' : 'user'}:${o}`);
  }
  // Several owner qualifiers are OR-ed by the default search and AND-ed with the rest of the
  // query — the one form in which "any of these owners" is a single query.
  const q = ['is:issue', 'is:open', `label:"${opts.label}"`, ...(quals.length ? quals : ['author:@me'])].join(' ');
  const pages = pagesOf(cli(['api', '--hostname', host, '--paginate', '-X', 'GET', 'search/issues',
    '-f', `q=${q}`, '-f', 'per_page=100'], 180000), 'the search');
  let total = null;
  let incomplete = false;
  for (const p of pages) {
    if (!p || typeof p !== 'object' || !Array.isArray(p.items)) {
      answer.reason = 'the search answered with something that is not a result page';
      out();
    }
    if (typeof p.total_count === 'number') total = p.total_count;
    if (p.incomplete_results === true) incomplete = true;
    for (const it of p.items) {
      if (it?.pull_request) continue;
      const repo = typeof it?.repository_url === 'string'
        ? it.repository_url.split('/').slice(-2).join('/') : null;
      const sub = it?.sub_issues_summary;
      answer.epics.push({
        repo: text(repo),
        number: Number.isInteger(it?.number) ? it.number : null,
        title: text(it?.title ?? null),
        url: text(it?.html_url ?? null),
        updated: text(it?.updated_at ?? null),
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
  // `created_by_me`, never `all`: on a public instance `all` is every issue the account can see.
  // An owner is a group, read through the group's own listing.
  const lists = opts.owners.length
    ? opts.owners.map((o) => `groups/${encodeURIComponent(o)}/issues`)
    : ['issues'];
  for (const base of lists) {
    const scope = base === 'issues' ? '&scope=created_by_me' : '';
    const pages = pagesOf(cli(['api', '--hostname', host, '--paginate',
      `${base}?labels=${encodeURIComponent(opts.label)}&state=opened${scope}&per_page=100`], 180000),
    `the listing ${base}`);
    for (const p of pages) {
      if (!Array.isArray(p)) { answer.reason = `the listing ${base} answered with something that is not a list`; out(); }
      for (const it of p) {
        const ref = typeof it?.references?.full === 'string' ? it.references.full : null;
        answer.epics.push({
          repo: text(ref ? ref.replace(/#\d+$/, '') : null),
          number: Number.isInteger(it?.iid) ? it.iid : null,
          title: text(it?.title ?? null),
          url: text(it?.web_url ?? null),
          updated: text(it?.updated_at ?? null),
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
