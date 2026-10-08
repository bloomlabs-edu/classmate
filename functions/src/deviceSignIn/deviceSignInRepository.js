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
 *   status            - 'pending' | 'connected' | 'approved' | 'denied' | 'expired'
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
 * STATE MACHINE (revised 2026-10-08 — see
 * docs/architecture/TV_PHONE_SIGNIN_RACE_INVESTIGATION.md for the real
 * production bug this fixes):
 *
 *   pending --(explicit Approve, before expiresAt)--> approved --(one successful poll)--> [deleted]
 *   pending --(explicit Deny, before expiresAt)-----> denied   --(one successful poll)--> [deleted]
 *   pending --(ANY caller notices expiresAt elapsed)-> expired --(one successful poll)--> [deleted]
 *   pending --(phone successfully loads getDeviceSignInRequestInfo)--> connected
 *
 * `connected` (added for the synchronized TV/phone UX — see
 * docs/architecture/TV_PHONE_SIGNIN_DESIGN.md's UX states) is a NON-
 * TERMINAL, PENDING-EQUIVALENT status: it exists purely so the TV can
 * show "Phone connected — waiting for approval" instead of the generic
 * "waiting for a phone to connect" the instant a phone has actually
 * loaded this exact session's own confirm screen (via deep link, the
 * in-app scanner, or manual code entry — all three funnel through the
 * same getPendingSessionInfo() call, so this is always the real signal,
 * never a separate/parallel mechanism). Every place that treats
 * `pending` as "still awaiting a decision, not yet expired" (TTL
 * enforcement, approve/deny eligibility) treats `connected` identically
 * — the two are EXACTLY equivalent for every security-relevant purpose,
 * differing only in what the TV displays while waiting. A session can
 * also go straight from `pending` to `approved`/`denied`/`expired`
 * without ever passing through `connected` (e.g. the phone's own
 * getDeviceSignInRequestInfo call itself fails or is never made) — that
 * is a perfectly normal path, not an error.
 *
 * `expired` is a REAL, terminal status now — reached by an ordinary
 * Firestore UPDATE, never a delete, whichever caller (an explicit
 * approve/deny attempt, or a routine TV poll) happens to be the first
 * to notice the TTL has elapsed on a still-`pending` document. This is
 * the actual fix: the previous version let `consumeApprovedSession()`
 * (i.e. every single routine TV poll, every ~2s, for the session's
 * entire life) DELETE a still-`pending`-but-expired document outright —
 * which meant a real, in-flight Approve attempt could lose a race
 * against the TV's own background heartbeat and find the document
 * simply gone (`not_found`), even though nothing had actually been
 * decided yet. Now, "the clock ran out" is recorded as a real state
 * exactly once (an UPDATE), which is idempotent and safe for every
 * other concurrent reader/writer to observe afterward — including an
 * approve/deny attempt that was already past the TTL anyway (correctly
 * still rejected, just via an explicit, visible `expired` status rather
 * than a vanished document) and a TV poll that arrives after someone
 * else already recorded it.
 *
 * Firestore's own transaction retry-on-conflict semantics are what make
 * this safe under real concurrency: `runTransaction()` re-reads and
 * re-runs its callback if the document changed since the transaction's
 * own read, so two callers racing to notice "pending + past TTL" at the
 * same instant can never both "win" — exactly one UPDATE commits, and
 * everyone else's retry observes the committed result. An APPROVED
 * session is never re-litigated against `expiresAt` once it has left
 * `pending` — collecting an already-approved token is not subject to
 * the same clock a not-yet-decided pairing code is (see
 * consumeApprovedSession()'s own comment).
 *
 * Every mutating function here is a single Firestore transaction — see
 * each function's own comment for exactly what race it closes. Nothing
 * in this module ever logs a raw pairing code or tv session token
 * (only already-hashed values ever reach it in the first place).
 *
 * DIAGNOSTIC LOGGING (added 2026-10-08, first real physical-device QA
 * round; kept, reduced in volume, after the fix below): every
 * STATE-CHANGING or TERMINAL outcome calls logOutcome() — plain
 * `console.log` (Cloud Functions ships this straight to Cloud Logging,
 * no extra setup). The one high-frequency, no-op poll outcome
 * (`reason: 'pending'`, i.e. "keep waiting, nothing happened") is
 * deliberately NOT logged — a TV polls every ~2s for up to the full
 * 5-minute TTL, and logging every single one of those would be pure
 * noise with no diagnostic value. Fields are deliberately narrow:
 * `event`, `reason`/`status`, `ageMs` (elapsed time since creation, when
 * known), and `codeHashPrefix` (the first 8 hex characters of the
 * ALREADY-hashed document id — enough to correlate the create/approve/
 * poll log lines for one session without being any more reversible than
 * the full hash already is, and short enough that it's obviously not
 * useful as a credential on its own). NEVER the raw pairing code, the
 * raw tv session token, the full hash, the custom token, or the device
 * label. See docs/architecture/TV_PHONE_SIGNIN_RACE_INVESTIGATION.md.
 */

const SESSIONS_COLLECTION = 'deviceSignInSessions';

function sessionRef(adminDb, codeHash) {
  return adminDb.collection(SESSIONS_COLLECTION).doc(codeHash);
}

function ageMs(createdAtIso, nowIso) {
  const created = Date.parse(createdAtIso);
  const now = Date.parse(nowIso);
  return Number.isFinite(created) && Number.isFinite(now) ? now - created : null;
}

/** See this file's own header comment ("DIAGNOSTIC LOGGING") for exactly what is and isn't included. */
function logOutcome(event, { codeHash, ...fields }) {
  console.log(
    JSON.stringify({
      log: 'deviceSignIn',
      event,
      codeHashPrefix: typeof codeHash === 'string' ? codeHash.slice(0, 8) : null,
      ...fields,
    })
  );
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
  logOutcome('create', { codeHash, ttlMs: ageMs(nowIso, expiresAtIso) });
}

/**
 * Read-only(-ish) lookup for the phone's own "what am I about to
 * approve?" screen — deliberately returns null for a missing OR expired
 * session (collapsed identically; an expired session is not
 * meaningfully different from a nonexistent one to a caller who can't
 * un-expire it) and for anything not currently 'pending'/'connected'
 * (nothing useful to preview about a session already resolved one way
 * or the other).
 *
 * NOT purely read-only: a successful lookup against a still-`pending`
 * session is ALSO the one and only signal that marks it `connected` —
 * see this file's own header comment on the state machine. This is a
 * single transaction (not a separate write afterward) so "read the
 * info" and "record that a phone just read it" can never observe two
 * different states of the same document. Calling this again on an
 * already-`connected` session is safe and idempotent (just re-reads;
 * no duplicate transition, no extra field churn).
 */
export async function getPendingSessionInfo(adminDb, codeHash, nowIso) {
  return adminDb.runTransaction(async (tx) => {
    const ref = sessionRef(adminDb, codeHash);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return null;

    const data = snapshot.data();
    if (lazilyExpireIfPastTtl(tx, ref, data, nowIso)) return null;
    if (data.status !== 'pending' && data.status !== 'connected') return null;

    if (data.status === 'pending') {
      tx.update(ref, { status: 'connected', connectedAt: nowIso });
    }

    // `expiresAt` is returned alongside the rest so the phone's own
    // approval screen can show a real, authoritative countdown (UX only —
    // see ApproveDeviceSignInView.js's own comment; the server remains the
    // sole authority at actual Approve/Deny time regardless of what this
    // value says by then).
    return { deviceLabel: data.deviceLabel, createdAt: data.createdAt, expiresAt: data.expiresAt };
  });
}

/**
 * Shared by approveSession()/denySession(): lazily transitions a
 * still-`pending` document whose TTL has elapsed into the real,
 * terminal `expired` status — an UPDATE, exactly like the state machine
 * this file's own header comment describes, never a delete. Must only
 * be called from within an already-open transaction, on a snapshot that
 * transaction itself just read. Returns `true` (and queues the update)
 * if this call is the one deciding "this session is now expired";
 * `false` if the session is not `pending`/`connected` at all (already
 * resolved one way or another, by this same check or by a real
 * approve/deny).
 */
function lazilyExpireIfPastTtl(tx, ref, data, nowIso) {
  if ((data.status === 'pending' || data.status === 'connected') && data.expiresAt < nowIso) {
    tx.update(ref, { status: 'expired' });
    return true;
  }
  return false;
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
 * An approve attempt landing on an already-past-TTL `pending` session
 * records the real `expired` state itself (lazilyExpireIfPastTtl) rather
 * than finding a document some OTHER caller already deleted — approval
 * after the authoritative server expiry is still correctly rejected
 * either way, just never via a vanished document.
 *
 * @returns {Promise<{ok: true} | {ok: false, reason: 'not_found'|'expired'|'not_pending'}>}
 */
export async function approveSession(adminDb, { codeHash, approvedByUid, customToken, nowIso }) {
  const result = await adminDb.runTransaction(async (tx) => {
    const ref = sessionRef(adminDb, codeHash);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return { ok: false, reason: 'not_found' };

    const data = snapshot.data();
    if (lazilyExpireIfPastTtl(tx, ref, data, nowIso)) {
      return { ok: false, reason: 'expired', createdAt: data.createdAt };
    }
    if (data.status !== 'pending' && data.status !== 'connected') {
      return { ok: false, reason: data.status === 'expired' ? 'expired' : 'not_pending', createdAt: data.createdAt, status: data.status };
    }

    tx.update(ref, { status: 'approved', approvedByUid, customToken, approvedAt: nowIso });
    return { ok: true, createdAt: data.createdAt };
  });

  logOutcome('approve', {
    codeHash,
    ok: result.ok,
    reason: result.reason || null,
    statusAtCheck: result.status || (result.ok ? 'pending' : null),
    ageMs: result.createdAt ? ageMs(result.createdAt, nowIso) : null,
  });

  const { createdAt, status, ...publicResult } = result;
  return publicResult;
}

/** Denies a pending session — same transactional re-check (and same lazy-expire behavior) as approveSession(), for the identical reason (a deny racing an approve must not "win" after the session has already been approved, and a deny landing after the TTL must record `expired`, never find a vanished document). */
export async function denySession(adminDb, { codeHash, nowIso }) {
  const result = await adminDb.runTransaction(async (tx) => {
    const ref = sessionRef(adminDb, codeHash);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return { ok: false, reason: 'not_found' };

    const data = snapshot.data();
    if (lazilyExpireIfPastTtl(tx, ref, data, nowIso)) {
      return { ok: false, reason: 'expired', createdAt: data.createdAt };
    }
    if (data.status !== 'pending' && data.status !== 'connected') {
      return { ok: false, reason: data.status === 'expired' ? 'expired' : 'not_pending', createdAt: data.createdAt, status: data.status };
    }

    tx.update(ref, { status: 'denied', deniedAt: nowIso });
    return { ok: true, createdAt: data.createdAt };
  });

  logOutcome('deny', {
    codeHash,
    ok: result.ok,
    reason: result.reason || null,
    statusAtCheck: result.status || (result.ok ? 'pending' : null),
    ageMs: result.createdAt ? ageMs(result.createdAt, nowIso) : null,
  });

  const { createdAt, status, ...publicResult } = result;
  return publicResult;
}

/**
 * THE atomic read-and-clear "claim the token" operation — the one
 * place a customToken is ever handed back out of this collection.
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
 *   2. Only once that passes does this function look at `status`/
 *      `expiresAt` at all — safe to be specific here, since by this
 *      point the caller has already proven it IS the real TV for this
 *      real session.
 *   3. FIX (2026-10-08 — see
 *      docs/architecture/TV_PHONE_SIGNIN_RACE_INVESTIGATION.md): a
 *      still-`pending` session whose TTL has elapsed is transitioned to
 *      the real, terminal `expired` status via lazilyExpireIfPastTtl()
 *      — an UPDATE, never a delete. This is the actual fix: the
 *      previous version deleted the document right here, on every
 *      routine poll, the instant it noticed the clock had run out,
 *      regardless of whether a real Approve attempt might be
 *      concurrently in flight. Now a poll can only ever discover
 *      "expired" as a real, stable, re-observable fact — it can never
 *      destroy a session nobody has decided on yet.
 *   4. `expiresAt` is NOT re-checked once status has left `pending` —
 *      collecting an already-`approved` token (or acknowledging an
 *      already-`denied` one) is not subject to the same clock a
 *      not-yet-decided pairing code is. "Approval before expiresAt must
 *      remain valid" means valid full stop, not "valid only if also
 *      collected before expiry" — the TV polls every ~2s, so collection
 *      is never meaningfully delayed anyway.
 *   5. A terminal outcome this SPECIFIC poll is the one to observe
 *      (approved-and-now-consumed, OR an already-recorded expired/
 *      denied being acknowledged) deletes the document in the SAME
 *      transaction that reads it — so a second, near-simultaneous poll
 *      for the same session either sees the still-pending/approved
 *      state and loses the race cleanly, or finds nothing at all.
 *      Firestore transactions guarantee the read-then-conditional-
 *      delete is atomic: two concurrent `consumeApprovedSession` calls
 *      for the same session can never both observe `status: 'approved'`
 *      and both walk away with a usable customToken — exactly the
 *      "pairing session cannot be reused after successful redemption" /
 *      "replayed approval/token" requirement, fully preserved.
 *   6. A still-`pending`, not-yet-expired session is left completely
 *      untouched — the real TV needs to keep polling it.
 *
 * @returns {Promise<
 *   {ok: true, customToken: string} |
 *   {ok: false, reason: 'not_found'|'expired'|'denied'|'pending'|'connected'}
 * >}
 */
export async function consumeApprovedSession(adminDb, { codeHash, tvSessionTokenHash, nowIso }) {
  const result = await adminDb.runTransaction(async (tx) => {
    const ref = sessionRef(adminDb, codeHash);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return { ok: false, reason: 'not_found', notFoundCause: 'no_document' };

    const data = snapshot.data();
    if (data.tvSessionTokenHash !== tvSessionTokenHash) {
      // never distinguishable from "no such session" in the RETURNED
      // value — see this function's own header comment — but safe to
      // log server-side-only, since logs are never client-reachable.
      return { ok: false, reason: 'not_found', notFoundCause: 'token_mismatch', createdAt: data.createdAt, status: data.status };
    }

    if (lazilyExpireIfPastTtl(tx, ref, data, nowIso)) {
      // This poll is the one recording "time ran out" for the first
      // time — leave the document in place as the new `expired` status
      // (not deleted) so this exact outcome is safe to observe again
      // (e.g. a second poll that raced this one) without anything being
      // lost. See point 3 above.
      return { ok: false, reason: 'expired', statusAtExpiry: 'pending', createdAt: data.createdAt };
    }

    if (data.status === 'expired') {
      // Already recorded (by a previous poll, or by approveSession()/
      // denySession()'s own identical lazy check) — the TV has now been
      // told; safe to clean up.
      tx.delete(ref);
      return { ok: false, reason: 'expired', createdAt: data.createdAt };
    }
    if (data.status === 'denied') {
      tx.delete(ref);
      return { ok: false, reason: 'denied', createdAt: data.createdAt };
    }
    if (data.status === 'pending') {
      return { ok: false, reason: 'pending', createdAt: data.createdAt }; // keep polling — not a terminal state, nothing to delete
    }
    if (data.status === 'connected') {
      // Same "keep polling, nothing to delete" shape as `pending` above —
      // `connected` is pending-equivalent for every purpose except what
      // the TV displays while it waits (see this file's own header
      // comment). Surfaced as its own distinct reason so the TV can show
      // "Phone connected — waiting for approval" instead of the generic
      // "waiting for a phone to connect".
      return { ok: false, reason: 'connected', createdAt: data.createdAt };
    }

    // status === 'approved' — expiresAt is deliberately not consulted here; see point 4 above.
    const { customToken } = data;
    tx.delete(ref);
    return { ok: true, customToken, createdAt: data.createdAt };
  });

  // The two high-frequency, no-op outcomes ("still pending"/"still
  // connected, keep waiting") are deliberately never logged — see this
  // file's own header comment on why.
  if (result.reason !== 'pending' && result.reason !== 'connected') {
    logOutcome('poll', {
      codeHash,
      ok: result.ok,
      reason: result.reason || null,
      notFoundCause: result.notFoundCause || null,
      statusAtExpiry: result.statusAtExpiry || null,
      ageMs: result.createdAt ? ageMs(result.createdAt, nowIso) : null,
    });
  }

  const { createdAt, status, notFoundCause, statusAtExpiry, ...publicResult } = result;
  return publicResult;
}

export { SESSIONS_COLLECTION };
