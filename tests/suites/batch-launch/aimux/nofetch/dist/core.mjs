// An aimux whose `./core` no longer exports fetchRateLimits — what a release renaming it
// would look like from here.
export { expandHome, loadConfig, rateLimitProfiles } from '../../good/dist/core.mjs';
