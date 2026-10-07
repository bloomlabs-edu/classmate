/**
 * functions/src/deviceSignIn/deviceSignInRepository.js
 *
 * Admin-SDK-only access to one new collection, `deviceSignInSessions/
 * {codeHash}` — the TV pairing session a "Sign in with Phone" flow
 * revolves around. Document id is `sha256(pairingCode)` (see
 * pairingSecret.js) — NEVER the raw code itself, mirroring
 * `classrooms/{id}/studentVerificationCodes/{codeHash}`'s own exact
 * convention (docs/architecture/STUDENT_PROFILE_BRIDGE_SECURITY_REVIEW.md).
 *
 * DELIBERATELY NO firestore.rules ENTRY EXISTS FOR THIS COLLECTION —
 * every read and write here happens exclusively through this module,
 * called only from functions/index.js's onRequest handlers (Admin SDK,
 * which bypasses security rules entirely). This mirrors the exact
 * choice already documented on `classroomInvitationCodes`' own rule
 * comment ("resolution for this bridge always happens server-side...
 * bypassing this rule entirely") — the single riskiest new collection
 * this feature introduces gets the SMALLEST possible client-reachable
 * surface: none. See docs/architecture/TV_PHONE_SIGNIN_DESIGN.md §4.
 *
 * Document shape:
 *   status            - 'pending' | 'approved' | 'denied'
 *   tvSessionTokenHash - sha256 of the TV's own private binding secret
 *                        (see pairingSecret.js) — checked before ANY
 *                        other field is ever revealed to a caller
 *                        claiming to be "the TV," so a caller who only
 *                        knows the pairing code (visible on screen)
 *                        can never learn or affect this session's real
 *                        state.
 *   deviceLabel       - TV-supplied, sanitized, DISPLAY-ONLY string
 *                        (never trusted for any security decision)
 *   createdAt/expiresAt - ISO strings
 *   approvedByUid     - the teacher's own real uid, set only on approval
 *   customToken       - set only between approval and the one
 *                        successful poll that consumes it; never
 *                        present otherwise
 *
 * Every mutating function here is a single Firestore transaction — see
 * each function's own comment for exactly what race it closes. Nothing
 * in this module ever logs a raw pairing code or tv session token
 * (only already-hashed values ever reach it in the first place).
 */

const SESSIONS_COLLECTION = 'deviceSignInSessions';

function sessionRef(adminDb, codeHash) {
  return adminDb.collection(SESSIONS_COLLECTION).doc(codeHash);
}

/**
 * Creates a brand-new pending session. Uses `.create()`, not `.set()`,
 * so a hash collision with an already-live session (astronomically
 * unlikely for a CSPRNG 8-digit code among a handful of concurrent
 * sessions, but not impossible) throws rather than silently
 * overwriting a different TV's in-flight session — the caller
 * (deviceSignInEndpoints.js) retries with a freshly generated code on
 * that specific failure, rather than this module ever making that call
 * itself.
 */
export async function createSession(adminDb, { codeHash, tvSessionTokenHash, deviceLabel, nowIso, expiresAtIso }) {
  await sessionRef(adminDb, codeHash).create({
    status: 'pending',
    tvSessionTokenHash,
    deviceLabel,
    createdAt: nowIso,
    expiresAt: expiresAtIso,
    approvedByUid: null,
  });
}

/**
 * Read-only lookup for the phone's own "what am I about to approve?"
 * screen — deliberately returns null for a missing OR expired session
 * (collapsed identically; an expired session is not meaningfully
 * different from a nonexistent one to a caller who can't un-expire it)
 * and for anything not currently 'pending' (nothing useful to preview
 * about a session already resolved one way or the other).
 */
export async function getPendingSessionInfo(adminDb, codeHash, nowIso) {
  const snapshot = await sessionRef(adminDb, codeHash).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data();
  if (data.status !== 'pending') return null;
  if (data.expiresAt < nowIso) return null;
  return { deviceLabel: data.deviceLabel, createdAt: data.createdAt };
}

/**
 * Approves a pending session — the ONE write that ever sets `status`
 * to 'approved' and stores a customToken. Transactional re-check of
 * 'pending' + not-expired closes the exact race two near-simultaneous
 * approve calls (or an approve racing a deny) would otherwise hit: only
 * the first to commit actually transitions the session; every other
 * caller gets a `reason` back and mints nothing further (the caller,
 * deviceSignInEndpoints.js, mints the actual customToken BEFORE calling
 * this — see that file's own comment on why that ordering is safe).
 *
 * @returns {Promise<{ok: true} | {ok: false, reason: 'not_found'|'expired'|'not_pending'}>}
 */
export async function approveSession(adminDb, { codeHash, approvedByUid, customToken, nowIso }) {
  return adminDb.runTransaction(async (tx) => {
    const ref = sessionRef(adminDb, codeHash);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return { ok: false, reason: 'not_found' };

    const data = snapshot.data();
    if (data.expiresAt < nowIso) return { ok: false, reason: 'expired' };
    if (data.status !== 'pending') return { ok: false, reason: 'not_pending' };

    tx.update(ref, { status: 'approved', approvedByUid, customToken, approvedAt: nowIso });
    return { ok: true };
  });
}

/** Denies a pending session — same transactional re-check as approveSession(), for the identical reason (a deny racing an approve must not "win" after the session has already been approved). */
export async function denySession(adminDb, { codeHash, nowIso }) {
  return adminDb.runTransaction(async (tx) => {
    const ref = sessionRef(adminDb, codeHash);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return { ok: false, reason: 'not_found' };

    const data = snapshot.data();
    if (data.expiresAt < nowIso) return { ok: false, reason: 'expired' };
    if (data.status !== 'pending') return { ok: false, reason: 'not_pending' };

    tx.update(ref, { status: 'denied', deniedAt: nowIso });
    return { ok: true };
  });
}

/**
 * THE atomic read-and-clear "claim the token" operation — the one
 * place a customToken is ever handed back out of this collection, and
 * the one place a session document is ever deleted.
 *
 * Ordering is deliberate and security-relevant:
 *   1. tvSessionTokenHash is checked FIRST, before anything else about
 *      the session's real state is examined or revealed. A caller who
 *      presents the right pairing code but the WRONG (or missing) TV
 *      session token gets the exact same 'not_found' a caller with a
 *      wholly made-up pairing code would get — this is what makes
 *      "approval bound to the wrong TV session" and "cross-session/
 *      cross-device attempt" fail closed rather than leaking whether
 *      the pairing code itself was even real. The real TV is the only
 *      caller who was ever given the raw token (see startDeviceSignIn),
 *      so this check is a genuine proof-of-possession gate, not
 *      security theatre.
 *   2. Only once that passes does this function distinguish
 *      expired/denied/pending/approved — safe to be specific here,
 *      since by this point the caller has already proven it IS the
 *      real TV for this real session.
 *   3. A terminal outcome (expired, denied, or a successful approve
 *      claim) deletes the document in the SAME transaction that reads
 *      it — so a second, near-simultaneous poll for the same session
 *      either sees the still-pending/approved state and loses the
 *      race cleanly, or finds nothing at all. Firestore transactions
 *      guarantee the read-then-conditional-delete is atomic: two
 *      concurrent `consumeApprovedSession` calls for the same session
 *      can never both observe `status: 'approved'` and both walk away
 *      with a usable customToken — exactly the "pairing session cannot
 *      be reused after successful redemption" / "replayed approval/
 *      token" requirement.
 *   4. A still-'pending' session is left untouched (not deleted) — the
 *      real TV needs to keep polling it.
 *
 * @returns {Promise<
 *   {ok: true, customToken: string} |
 *   {ok: false, reason: 'not_found'|'expired'|'denied'|'pending'}
 * >}
 */
export async function consumeApprovedSession(adminDb, { codeHash, tvSessionTokenHash, nowIso }) {
  return adminDb.runTransaction(async (tx) => {
    const ref = sessionRef(adminDb, codeHash);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return { ok: false, reason: 'not_found' };

    const data = snapshot.data();
    if (data.tvSessionTokenHash !== tvSessionTokenHash) {
      return { ok: false, reason: 'not_found' }; // never distinguishable from "no such session" — see this function's own header comment
    }

    if (data.expiresAt < nowIso) {
      tx.delete(ref);
      return { ok: false, reason: 'expired' };
    }
    if (data.status === 'denied') {
      tx.delete(ref);
      return { ok: false, reason: 'denied' };
    }
    if (data.status === 'pending') {
      return { ok: false, reason: 'pending' }; // keep polling — not a terminal state, nothing to delete
    }

    // status === 'approved'
    const { customToken } = data;
    tx.delete(ref);
    return { ok: true, customToken };
  });
}

export { SESSIONS_COLLECTION };
