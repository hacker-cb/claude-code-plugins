#!/usr/bin/env node
// Stands in for the aimux CLI as batch-launch.mjs runs it: `run <profile> auth status
// --json` answers `auth.<profile>` from $HOME/aimux.json, and a `-p` run marks the profile
// warmed for the fake core. Anything else is a mistake worth naming.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const a = process.argv.slice(2);
const doc = JSON.parse(readFileSync(join(process.env.HOME, 'aimux.json'), 'utf8'));
if (a[0] === 'run' && a[2] === 'auth' && a[3] === 'status') {
  process.stdout.write(`${JSON.stringify((doc.auth || {})[a[1]] ?? null)}\n`);
} else if (a[0] === 'run' && a.includes('-p')) {
  writeFileSync(join(process.env.HOME, `warm.${a[1]}`), '');
  process.exit((doc.warm_exit || {})[a[1]] ?? 0);
} else {
  process.stderr.write(`stub aimux: unexpected invocation: ${a.join(' ')}\n`);
  process.exit(64);
}
