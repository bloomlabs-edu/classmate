/**
 * tests/helpers/domGlobalsStub.mjs
 *
 * Minimal `window` stub for tests that import a module transitively
 * reaching config/appConfig.js's top-level `window.location` read (e.g.
 * services/workspaceService.js). Import this FIRST, before any such
 * module, in any test file that needs it — sibling top-level imports in
 * an ES module evaluate in the order they're written, so this always
 * finishes running before the next import's own module graph starts.
 * Node has no DOM; this is not a jsdom replacement, just enough of a
 * shape for that one read not to throw.
 */
if (typeof globalThis.window === 'undefined') {
  globalThis.window = { location: { origin: 'http://localhost', pathname: '/' } };
}
