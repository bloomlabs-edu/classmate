/**
 * services/firestoreEnvironment.js
 *
 * The one place the "production Firestore, or a local emulator?"
 * decision is made — a pure function, deliberately kept separate from
 * services/firebaseApp.js's own DOM-reading/connectFirestoreEmulator()
 * wiring so the *policy* itself is unit-testable without a browser.
 *
 * The policy this round exists to enforce (see this project's own
 * memory "never-seed-production-data" for the 2026-09-12 incident that
 * prompted it): TEST/DEVELOPMENT DEFAULTS TO THE EMULATOR; PRODUCTION
 * IS OPT-IN, not the other way around. A prior version of this
 * safeguard (services/firebaseApp.js alone) required an explicit flag
 * to REACH the emulator — meaning an automated test/harness that
 * simply forgot to pass that flag would silently fall through to real
 * production. This rewrite flips the default: only a request whose
 * `hostname` matches this app's own known, real Hosting domains is
 * ever treated as production; every other hostname (localhost, a
 * scratchpad static-server port, a CI runner, `127.0.0.1`, anything
 * unrecognized) defaults to the LOCAL Firestore emulator instead,
 * unless a developer deliberately opts back into production with an
 * explicit, separate flag.
 */

/**
 * This app's own real Firebase Hosting domains — the ONLY hostnames
 * treated as production by default. Deliberately a short, explicit
 * allowlist, not an "everything except localhost" heuristic — a typo'd
 * or unexpected hostname should default to the SAFE side (emulator),
 * not the dangerous one. Matches config/firebaseConfig.js's own
 * `authDomain` plus Hosting's standard `.web.app` alias; there is no
 * custom domain configured for this project (confirmed via README.md/
 * docs/CLASSMATE_ARCHITECTURE_CURRENT_STATE.md, both of which only ever
 * reference these two).
 */
export const PRODUCTION_HOSTNAMES = Object.freeze(['classmate-302c2.web.app', 'classmate-302c2.firebaseapp.com']);

/** Matches firebase-rules-verification/*.rules.verify.js's own established `host: '127.0.0.1', port: 8080` convention — the same default `firebase emulators:start --only firestore` binds to. */
export const DEFAULT_EMULATOR_HOST = '127.0.0.1';
export const DEFAULT_EMULATOR_PORT = 8080;

/**
 * `hostname`: `window.location.hostname` (or an equivalent string in a
 *   non-browser context) — `null`/`undefined`/anything not in
 *   PRODUCTION_HOSTNAMES is treated as non-production.
 * `getSearchParam(key)`: a function reading one URL query param (e.g.
 *   `(key) => new URLSearchParams(window.location.search).get(key)`) —
 *   passed as a function, not a raw string, so this stays trivially
 *   callable from a plain object in tests without constructing a real
 *   URLSearchParams.
 * `allowProductionGlobal`: the value of
 *   `window.__CLASSMATE_ALLOW_PRODUCTION_FIRESTORE__`, or `undefined`.
 *
 * Returns one of:
 *   `{ mode: 'production' }`
 *   `{ mode: 'emulator', host, port }`
 *
 * Precedence, most specific first:
 *   1. An explicit `?firestoreEmulator=host:port` ALWAYS wins, even on
 *      a production hostname — an explicit emulator request can only
 *      ever redirect AWAY from production, never toward it, so honoring
 *      it unconditionally is safe by construction.
 *   2. A recognized production hostname → production (the normal case
 *      for real users on the real deployed site).
 *   3. An explicit `?firestoreProduction=1` query param, or the
 *      `allowProductionGlobal` flag, on a NON-production hostname → a
 *      deliberate, separate escape hatch for a developer who genuinely
 *      wants their local session to read/write real production data —
 *      never the default, always an affirmative, unmistakable opt-in.
 *   4. Otherwise (the new default) → the local emulator.
 */
export function determineFirestoreTarget({ hostname = null, getSearchParam = () => null, allowProductionGlobal = false } = {}) {
  const emulatorOverride = safeGetParam(getSearchParam, 'firestoreEmulator');
  if (emulatorOverride) return parseEmulatorOverride(emulatorOverride);

  const isKnownProductionHostname = typeof hostname === 'string' && PRODUCTION_HOSTNAMES.includes(hostname);
  if (isKnownProductionHostname) return { mode: 'production' };

  const productionOptIn = safeGetParam(getSearchParam, 'firestoreProduction') === '1' || allowProductionGlobal === true;
  if (productionOptIn) return { mode: 'production' };

  return { mode: 'emulator', host: DEFAULT_EMULATOR_HOST, port: DEFAULT_EMULATOR_PORT };
}

function safeGetParam(getSearchParam, key) {
  try {
    return typeof getSearchParam === 'function' ? getSearchParam(key) : null;
  } catch {
    return null;
  }
}

/** A malformed `?firestoreEmulator=` value (missing/non-numeric port) still returns an emulator target — never falls through to production just because the override was typed wrong. */
function parseEmulatorOverride(value) {
  const [host, portText] = String(value).split(':');
  const port = Number(portText);
  if (host && Number.isFinite(port)) return { mode: 'emulator', host, port };
  return { mode: 'emulator', host: DEFAULT_EMULATOR_HOST, port: DEFAULT_EMULATOR_PORT };
}
