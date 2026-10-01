// An aimux whose `./core` no longer exports fetchRateLimits — what a release renaming it
// would look like from here.
export { classifyProfile, expandHome, loadConfig, rateLimitProfiles } from '../../good/dist/core.mjs';
