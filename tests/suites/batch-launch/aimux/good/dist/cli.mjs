#!/usr/bin/env node
// Stands in for the aimux CLI as batch-launch.mjs runs it, answering from $HOME/aimux.json:
// `run <profile> auth status --json` prints `auth.<profile>` and exits `auth_exit.<profile>`;
// a `-p` run marks the profile warmed for the fake core; a run carrying `--session-id` or
// `--resume` is a batch starting — its arguments go to $HOME/launch-argv, and a line goes to
// that session's transcript in the profile's directory. Anything else is a mistake worth
// naming.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const a = process.argv.slice(2);
const home = process.env.HOME;
const doc = JSON.parse(readFileSync(join(home, 'aimux.json'), 'utf8'));
const idAt = Math.max(a.indexOf('--session-id'), a.indexOf('--resume'));
if (a[0] === 'run' && a[2] === 'auth' && a[3] === 'status') {
  process.stdout.write(`${JSON.stringify((doc.auth || {})[a[1]] ?? null)}\n`);
  process.exit((doc.auth_exit || {})[a[1]] ?? 0);
} else if (a[0] === 'run' && a.includes('-p')) {
  writeFileSync(join(home, `warm.${a[1]}`), '');
  process.exit((doc.warm_exit || {})[a[1]] ?? 0);
} else if (a[0] === 'run' && idAt > 0) {
  writeFileSync(join(home, 'launch-argv'), `${JSON.stringify({ cwd: process.cwd(), argv: a })}\n`);
  const dir = (doc.config.profiles[a[1]].path || '').replace(/^~/, home);
  mkdirSync(join(dir, 'projects', '-repo'), { recursive: true });
  appendFileSync(join(dir, 'projects', '-repo', `${a[idAt + 1]}.jsonl`), `${JSON.stringify({ type: 'user', at: Date.now() })}\n`);
} else {
  process.stderr.write(`stub aimux: unexpected invocation: ${a.join(' ')}\n`);
  process.exit(64);
}
