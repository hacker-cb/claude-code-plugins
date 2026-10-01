// Stands in for aimux's published `./core`: the functions batch-launch.mjs calls, answering
// from the case's $HOME/aimux.json — `config` for loadConfig, `limits.<profile>` for
// fetchRateLimits (`"throw"` makes it throw), and `after_warm.<profile>` once the fake CLI
// has warmed that profile.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const home = () => process.env.HOME;
const doc = () => JSON.parse(readFileSync(join(home(), 'aimux.json'), 'utf8'));
export const expandHome = (p) => p.replace(/^~/, home());
export const loadConfig = () => doc().config ?? null;
export const rateLimitProfiles = (profiles) => Object.keys(profiles);
export async function fetchRateLimits(profile, dir) {
  const d = doc();
  const entry = Object.entries(d.config.profiles).find(([, p]) => expandHome(p.path) === dir);
  const name = entry ? entry[0] : null;
  const warmed = name && existsSync(join(home(), `warm.${name}`)) && d.after_warm && d.after_warm[name];
  const got = warmed ? d.after_warm[name] : (d.limits || {})[name];
  if (got === 'throw') throw new Error('probe exploded');
  return got ?? { status: null, error: 'unavailable' };
}
