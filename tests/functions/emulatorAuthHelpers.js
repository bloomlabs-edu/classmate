/**
 * tests/functions/emulatorAuthHelpers.js
 *
 * Shared test-only helper for minting REAL, verifiable Firebase ID
 * tokens against the Auth emulator, for a given (fake) project id and
 * uid — used by both tests/functions/learningHubAuth.test.js and
 * tests/functions/verifyLearnerConnectionEndpoint.test.js so that
 * "wrong Firebase project" and "valid Learning Hub token" cases are
 * proven against the real Admin SDK + real Auth emulator wire protocol,
 * not a hand-rolled JWT stand-in.
 *
 * Not a *.test.js file — not picked up by `node --test` globbing.
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const mintingApps = new Map();

function getMintingApp(projectId) {
  const appName = `token-minter-${projectId}`;
  const existing = getApps().find((app) => app.name === appName);
  if (existing) return existing;
  const app = initializeApp({ projectId }, appName);
  mintingApps.set(projectId, app);
  return app;
}

/**
 * Mints a real, Auth-emulator-issued ID token for `uid` under
 * `projectId`, by creating a custom token (Admin SDK, emulator-mode —
 * requires no real service-account credential) and exchanging it via
 * the emulator's own `signInWithCustomToken` REST endpoint, exactly as
 * a real client SDK would.
 */
export async function mintEmulatorIdToken({ authEmulatorHost, projectId, uid }) {
  const app = getMintingApp(projectId);
  const customToken = await getAuth(app).createCustomToken(uid);

  const response = await fetch(
    `http://${authEmulatorHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=any-string-works-in-the-emulator`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`emulator signInWithCustomToken failed: ${response.status} ${text}`);
  }
  const data = await response.json();
  return data.idToken;
}
