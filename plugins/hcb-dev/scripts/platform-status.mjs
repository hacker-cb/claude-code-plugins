#!/usr/bin/env node
// platform-status.mjs — is the platform itself down, and is the component a parked step
// waits on back yet? Prints JSON on stdout and answers with its EXIT CODE, because the
// caller is a sleep loop and a loop tests a status.
//
// `--feed` carries the whole url of the document and has NO default. Naming a host here
// would be identifying a forge by its hostname, which this plugin does not do, and a
// self-hosted instance nobody named is exactly the case where the honest answer is that
// nothing can be attributed. It is the whole url rather than a base because the path is
// not one shape: measured, GitHub publishes Statuspage at `/api/v2/summary.json` while
// GitLab publishes status.io at `api.status.io/1.0/status/<page id>` — a script building
// the path from a base gets the second wrong every time.
//
// Two document shapes are read, told apart by what the document CARRIES and never by
// where it came from: Statuspage (`components[]`) and status.io (`result.status[]`).
// Anything else is a stop, not a retry.
//
// Usage: node platform-status.mjs --feed <url> [--component <name>]
//   [--component-id <id>] [--timeout <seconds>]
//
// Exit codes, and each is a different step for the caller:
//   0  operational — the named component is up, or, with none named, nothing is down
//   3  degraded — wait and ask again
//   4  the feed was not reached — no answer, a timeout, or any HTTP status outside 2xx.
//      UNREAD IS NOT OPERATIONAL, and a loop that takes it for one resumes into an outage
//   2  a call this cannot answer — a bad argument, a 2xx body that is not a feed, a
//      document in neither shape, a component name matching none or several. Each of
//      these answers the same however long the caller waits, so the loop stops

import { spawnSync } from 'node:child_process';
import { text, writeAll } from './lib/forge.mjs';

const USAGE = 'usage: node platform-status.mjs --feed <url> [--component <name>]'
  + ' [--component-id <id>] [--timeout <seconds>]\n';
const die = (m) => { writeAll(2, `platform-status: ${m}\n${USAGE}`); process.exit(2); };

const argv = process.argv.slice(2);
const opts = { feed: null, component: null, componentId: null, timeout: 30 };
const takes = { '--feed': 'feed', '--component': 'component', '--component-id': 'componentId', '--timeout': 'timeout' };
for (let i = 0; i < argv.length; i += 1) {
  const key = takes[argv[i]];
  if (!key) die(`unknown argument '${argv[i]}'`);
  if (argv[i + 1] === undefined) die(`${argv[i]} needs a value`);
  opts[key] = argv[i + 1];
  i += 1;
}

if (opts.feed === null) die('--feed needs a value — this script carries no default host');
if (opts.component !== null && opts.componentId !== null) {
  die('name one of --component / --component-id, not both');
}
const seconds = Number(opts.timeout);
if (!Number.isInteger(seconds) || seconds < 1 || seconds > 600) {
  die(`--timeout '${opts.timeout}' is not a whole number of seconds between 1 and 600`);
}

// The url reaches `curl`, so what it may be is settled here rather than by whatever
// `curl` is willing to fetch: `file://` would read a local path instead. Credentials go
// too — a status feed is public everywhere it exists, and one carrying a password is a
// mistake worth saying out loud rather than forwarding.
let url;
try { url = new URL(opts.feed); } catch { die(`--feed '${opts.feed}' is not a url`); }
if (url.protocol !== 'https:' && url.protocol !== 'http:') die(`--feed '${opts.feed}' is not http(s)`);
if (url.username || url.password) die('--feed carries credentials — a status feed is public');

const answer = {
  // `read` is the feed answering in a shape this understands, never "the platform is fine".
  read: false,
  feed: text(opts.feed),
  shape: null,
  asked: { component: text(opts.component), componentId: text(opts.componentId) },
  component: null,
  degraded: [],
  incidents: [],
  maintenances: [],
  available: null,
  truncated: false,
  verdict: null,
  reason: null,
  notes: [],
};
const finish = (code) => { writeAll(1, `${JSON.stringify(answer, null, 2)}\n`); process.exit(code); };
const unread = (reason) => { answer.verdict = 'unread'; answer.reason = reason; finish(4); };
// A stop, not a retry: every case reaching here answers the same way however long the
// caller waits, so a loop sleeping on it sleeps forever.
const stop = (reason) => { answer.verdict = 'unresolved'; answer.reason = reason; finish(2); };

// `spawnSync` directly rather than the shared `runner`: that one cannot tell a command
// that never started from one that failed, and here those are different exits — no
// `curl` on PATH is a stop (2), while a fetch that failed is a retry (4). Conflating
// them puts a machine without curl into a loop that never ends.
const connect = Math.min(10, seconds);
// No `-f`: the HTTP status is read here rather than collapsed into curl's exit code,
// because the two failures it hides take different steps. Measured on a url one segment
// short — `…/api/v2` without `summary.json` — the server answers **200 with HTML**, and
// a run that treats every non-JSON body as a retry sleeps on that typo forever. So a
// SUCCESSFUL answer that is not a feed is a stop, while any other status retries: a 5xx,
// a rate limit, a proxy's error page are all the outage this script exists to wait out.
const r = spawnSync('curl', [
  '-sS', '-w', '\n%{http_code}', '--connect-timeout', String(connect),
  '--max-time', String(seconds), '--', opts.feed,
], {
  encoding: 'utf8',
  timeout: (seconds + 5) * 1000,
  maxBuffer: 8 * 1024 * 1024,
  env: { ...process.env, LC_ALL: 'C', LANG: 'C', LC_MESSAGES: 'C' },
});
if (r.error && r.error.code === 'ENOENT') die('curl is not on PATH — nothing here can read a feed');
const errLine = () => (r.stderr || '').trim().split('\n').filter(Boolean).pop() || 'no detail';
if (r.status !== 0) unread(`the feed did not answer (${errLine()})`);

// `-w` appended the status to the body's own bytes, so the last line is the code and
// everything before it is the document.
const raw = String(r.stdout ?? '');
const cut = raw.lastIndexOf('\n');
const code = Number(cut === -1 ? raw.trim() : raw.slice(cut + 1).trim());
const body = cut === -1 ? '' : raw.slice(0, cut);
if (!Number.isInteger(code) || code < 100) unread('curl reported no HTTP status');
// Outside 2xx splits again. A 5xx is the outage this exists to wait out, and so are the
// two 4xx that say "not now" — 408 and 429. Every other 4xx, and every 3xx, says
// something waiting cannot change: the document is not there, or is not ours to read, or
// sits behind a redirect this deliberately does not follow. Measured: a Statuspage path
// under the wrong host answers 404 forever, and that is a url to fix, not an outage.
const TRY_AGAIN = [408, 429];
if (code >= 300 && code <= 499 && !TRY_AGAIN.includes(code)) {
  stop(`${opts.feed} answered HTTP ${code} — waiting cannot change that; check the url`);
}
if (code < 200 || code > 299) unread(`the feed answered HTTP ${code}`);

// From here the server answered SUCCESSFULLY, so what came back is what that url serves —
// and no amount of waiting turns it into a feed.
let doc;
try { doc = JSON.parse(body); } catch { stop(`${opts.feed} answered HTTP ${code} with something that is not JSON — check the url`); }
if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
  stop(`${opts.feed} answered HTTP ${code} with JSON that is not an object — check the url`);
}

const CAP = 20;
// The cap bounds what travels into a reader's context; it must not bound what gets
// COUNTED. A reason saying "20 components are down" over a feed carrying 25 is the cap
// deciding the answer, so every count below is taken before the slice.
const counts = { degraded: 0, incidents: 0, maintenances: 0 };
const cap = (rows) => {
  if (rows.length > CAP) answer.truncated = true;
  return rows.slice(0, CAP);
};
const str = (v) => (typeof v === 'string' ? v : null);
const arr = (v) => (Array.isArray(v) ? v : []);
// Written by somebody else's service, so it is quoted rather than repeated.
const named = (c) => text(str(c && c.name));

// --- the two shapes, told apart by what is inside
//
// A document that parsed but is in neither shape is a DIFFERENT case from one that did
// not parse: retrying cannot change its fields, and the usual cause is a url one segment
// off — `/api/v2` without `/summary.json`, a status page's HTML error body, an index.
const result = doc.result && typeof doc.result === 'object' && !Array.isArray(doc.result) ? doc.result : null;
let components = null;
if (Array.isArray(doc.components)) { answer.shape = 'statuspage'; components = doc.components; }
else if (result && Array.isArray(result.status)) { answer.shape = 'status.io'; components = result.status; }
else {
  stop(`${opts.feed} parsed but is neither a Statuspage summary nor a status.io status — check the url`);
}
answer.read = true;

// What "up" means per shape. status.io carries a NUMERIC code beside a display string,
// and 100 is its operational one; the string is what a page renders and is not the value
// to compare when the number is there.
const isUp = (c) => (answer.shape === 'statuspage'
  ? str(c.status) === 'operational'
  : (typeof c.status_code === 'number'
    ? c.status_code === 100
    : (str(c.status) || '').toLowerCase() === 'operational'));

// Statuspage nests components in groups, and the group is the only thing telling two
// components of one name apart. status.io has no groups, so the column stays null there.
const byId = new Map();
for (const c of components) { if (c && str(c.id)) byId.set(c.id, c); }
const groupOf = (c) => {
  const parent = answer.shape === 'statuspage' && c && str(c.group_id) ? byId.get(c.group_id) : null;
  return parent ? named(parent) : null;
};
// "Has something to judge" has to match what `isUp` actually judges by: a status.io row
// carrying a numeric code and no display string is a row this CAN rule on, while a row
// with neither is one nothing here can. Both paths ask it — the aggregate to leave such a
// row out, the named one to refuse rather than call it down.
const judgeable = (c) => str(c.status) !== null
  || (answer.shape === 'status.io' && typeof c.status_code === 'number');
const row = (c) => ({
  id: text(str(c.id)), name: named(c), group: groupOf(c),
  status: text(str(c.status)), up: isUp(c),
});

// An incident naming no component is ordinary, and it is still an incident: the caller's
// check can be down under one nobody has mapped to a component yet.
const OVER = ['resolved', 'postmortem', 'completed'];
const open = (i) => i && typeof i === 'object' && !OVER.includes((str(i.status) || '').toLowerCase());
const incidentRows = (answer.shape === 'statuspage' ? arr(doc.incidents) : arr(result.incidents))
  .filter(open);
counts.incidents = incidentRows.length;
answer.incidents = cap(incidentRows
  .map((i) => ({
    name: named(i), status: text(str(i.status)), impact: text(str(i.impact)),
    // Capped like every other list: one incident can name every component a forge has,
    // and an uncapped nested array puts the whole response into a reader's context under
    // a `truncated` that still reads false.
    components: cap(arr(i.components).map((c) => (typeof c === 'string' ? text(c) : named(c))).filter(Boolean)),
  })));
const maintenanceRows = answer.shape === 'statuspage'
  ? arr(doc.scheduled_maintenances).filter((m) => m && !['scheduled', 'completed'].includes(str(m.status) || ''))
  : arr(result.maintenance && result.maintenance.active);
counts.maintenances = maintenanceRows.length;
answer.maintenances = cap(maintenanceRows.map((m) => ({ name: named(m), status: text(str(m.status)) })));

// --- one component, which is the wait
if (opts.component !== null || opts.componentId !== null) {
  const matches = opts.componentId !== null
    ? components.filter((c) => c && str(c.id) === opts.componentId)
    : components.filter((c) => c && str(c.name) === opts.component);
  const asked = opts.componentId !== null
    ? `--component-id '${opts.componentId}'` : `--component '${opts.component}'`;
  if (matches.length === 0) {
    // The names it DOES carry, because the usual repair is spelling one of them right.
    answer.available = cap(components.filter((c) => c && str(c.name)).map(row));
    stop(`${asked} matches no component in this feed — take a name from 'available'`);
  }
  // Two components of one name is ordinary at Statuspage, where every group has its own
  // set. Taking the first would park the caller on whichever the feed happened to list
  // first, under the name of the one it asked for — so the ambiguity IS the answer, and
  // `--component-id` is what settles it.
  if (matches.length > 1) {
    answer.available = cap(matches.map(row));
    stop(`${asked} matches ${matches.length} components — name one with --component-id`);
  }
  // A row carrying nothing to judge by is not a row that is down. Answering 3 here put
  // the documented loop to sleep every half hour on a component whose state the feed
  // never stated — and the aggregate path had already been taught to leave it out.
  if (!judgeable(matches[0])) {
    answer.component = row(matches[0]);
    stop(`${asked} carries no status this can rule on — the feed states none for it`);
  }
  answer.component = row(matches[0]);
  if (answer.component.up) {
    answer.verdict = 'operational';
    // Said, not acted on: the component this caller waits for is up, and an incident
    // elsewhere is not its business — but a caller reading only the exit code would
    // never learn one was open.
    if (counts.incidents) answer.notes.push(`${counts.incidents} incident(s) open elsewhere`);
    finish(0);
  }
  answer.verdict = 'degraded';
  answer.reason = `${answer.component.name} is ${answer.component.status}`;
  finish(3);
}

// --- everything, which is the attribution
// A group row is a roll-up of the components under it, not a component anyone parks on,
// and one with no status at all is a row this cannot rule on either way.
const degradedRows = components.filter((c) => c && c.group !== true && judgeable(c) && !isUp(c));
counts.degraded = degradedRows.length;
answer.degraded = cap(degradedRows.map(row));
if (!counts.degraded && !counts.incidents && !counts.maintenances) {
  // Nothing found is only "nothing is wrong" where everything that could be wrong was
  // actually looked at. A MISSING array is not an empty one — measured: Statuspage's
  // `components.json` carries the components and neither the incidents nor the
  // maintenances, so a reader taking absence for emptiness calls an active incident an
  // operational platform. Strictness belongs to this verdict alone: a degradation already
  // found stands whatever else the document lacks.
  const missing = [];
  if (!components.length) missing.push('no components');
  if (answer.shape === 'statuspage') {
    if (!Array.isArray(doc.incidents)) missing.push('no incidents');
    if (!Array.isArray(doc.scheduled_maintenances)) missing.push('no scheduled_maintenances');
  } else {
    if (!Array.isArray(result.incidents)) missing.push('no incidents');
    if (!Array.isArray(result.maintenance && result.maintenance.active)) missing.push('no maintenance.active');
  }
  if (missing.length) {
    stop(`${opts.feed} carries ${missing.join(', ')} — nothing here says the platform is up; name the whole document`);
  }
  answer.verdict = 'operational';
  finish(0);
}
answer.verdict = 'degraded';
answer.reason = [
  counts.degraded ? `${counts.degraded} component(s) not operational` : null,
  counts.incidents ? `${counts.incidents} open incident(s)` : null,
  counts.maintenances ? `${counts.maintenances} maintenance(s) in progress` : null,
].filter(Boolean).join(', ');
finish(3);
