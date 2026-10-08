# "Sign in with Phone" — Production Failure Investigation (2026-10-08)

**Status:** Investigation complete, root cause confirmed with executable
evidence against the real Firestore emulator. **No fix has been applied**
— the only code change in this pass is additive, non-sensitive
diagnostic logging (see §8). The TTL value itself has not been changed.

**Trigger:** first real physical-device QA round. Phone reached the
approval screen correctly ("Sign in to this device? / Chrome device /
Requested at 4:41"), but tapping Approve produced "This code has expired
or is invalid — ask for a new one on the TV." The gap between the
screenshot's own timestamp and the failure was ~2 minutes — right at the
configured `PAIRING_SESSION_TTL_MS` (2 minutes).

---

## Summary of root cause

**Two independent, real phenomena can both produce this exact message,
and the evidence is consistent with the first one actually occurring:**

1. **A genuine race between the TV's own routine background poll and the
   teacher's in-flight approval.** `consumeApprovedSession()` (called by
   every `pollDeviceSignIn` request — the TV polls every ~2 seconds for
   the *entire* lifetime of a pairing session, independent of anything
   the teacher is doing) checks `expiresAt < now` **before** checking
   `status`. If the TTL has elapsed while the session is still
   `'pending'` (teacher hasn't tapped Approve/Deny yet), this branch
   **deletes the Firestore document** and reports `'expired'` — exactly
   the same as it would for a session nobody ever touched. The very next
   poll happens within ~2 seconds, so in practice a pending session is
   destroyed within ~2 seconds of its TTL elapsing, **regardless of
   whether the teacher is mid-approval at that exact moment.** If her
   `approveDeviceSignIn` call lands even one poll cycle after this, the
   document is already gone and she gets `reason: 'not_found'` — which
   looks identical to "expired or invalid" from the UI's own point of
   view, even though the actual proximate cause was the TV's own poll,
   not her own lateness.
2. **Genuinely taking longer than 2 minutes end-to-end.** Independent of
   the race above, `approveSession()` has its own direct expiry check
   (`reason: 'expired'`) that correctly rejects a late approval even if
   no poll had touched the session at all. 2 minutes is a tight budget
   for unlock phone → open camera → scan QR → Google account chooser →
   read the confirm screen → tap Approve, especially on a first attempt.

Both are confirmed below with real, executable tests against the
Firestore emulator — not just a reading of the code.

---

## Answers to the eight investigation questions

**1. Which exact endpoint/request returns `invalid_or_expired`?**
`approveDeviceSignIn` (Cloud Function) → `approveSession()` in
`functions/src/deviceSignIn/deviceSignInRepository.js`. Server-side
`reason` is `'not_found'` in the race case (§ evidence, scenario A) or
`'expired'` in the genuinely-late case (scenario B) — both map to the
identical client-facing `invalid_or_expired` message in
`deviceSignInEndpoints.js`'s `REASON_TO_MESSAGE`, which is itself why
the two causes were indistinguishable from the screenshot alone.

**2. Does the pairing actually expire before approval can complete?**
Yes, plausibly on its own merits (scenario B) — real onboarding time for
a first attempt can realistically approach or exceed 2 minutes. But the
race (scenario A) means the *effective* window is often shorter and
non-deterministic: a session can be destroyed by the TV's own poll
within ~2 seconds of the TTL elapsing, whether or not an approval is
already in flight.

**3. Can the phone approval UI remain visible after the underlying
pairing has expired?**
**Yes — confirmed gap.** `ApproveDeviceSignInView.js`'s confirm screen
has no countdown, no periodic re-validation, and no visual signal that
time is running out or has run out. Once `getDeviceSignInRequestInfo`
succeeds, the Approve/Deny buttons stay live indefinitely from the
phone's own point of view, with zero indication that the session could
already be gone until the moment she taps Approve and gets a generic
failure.

**4. Any client/server clock or timestamp interpretation issue?**
No evidence of one. `expiresAt` (set in `startDeviceSignIn`) and every
`nowIso` comparison (in `approveSession`, `denySession`,
`consumeApprovedSession`) are all computed from `Date.now()` inside the
same Cloud Functions runtime/region — no client clock is ever consulted
for TTL logic. Ruled out.

**5. Can TV polling cause the session to be consumed/invalidated
unexpectedly?**
**Yes — this is the core bug.** See scenario A below. A session's own
`status` is irrelevant to whether a poll will delete it once the TTL has
elapsed; `consumeApprovedSession()` treats "expired" as a terminal state
to clean up regardless of whether anything was ever decided.

**6. Race condition between approval and TV polling?**
**Yes**, directly caused by #5. Whichever call (the teacher's approve,
or the TV's own next poll) reaches Firestore first after the TTL boundary
"wins." Because the TV polls continuously every ~2s for the session's
entire life, it is very often the poll that wins, deleting the document
moments before or after the teacher's own attempt.

**7. Is the approval endpoint using the same identifiers the TV
created?**
Yes, confirmed — both `approveDeviceSignIn` and `pollDeviceSignIn`
resolve the exact same Firestore document via `sha256(pairingCode)` as
the document id. No identifier mismatch; this is not a contributing
factor.

**8. Production-safe diagnostics.**
Added — see below. Purely additive `console.log` calls (Cloud Logging
captures these automatically) at every outcome branch of
`createSession`/`approveSession`/`denySession`/`consumeApprovedSession`.
Fields logged: `event`, `ok`, `reason`, `statusAtExpiry` (the specific
signature of the race — see below), `ageMs` (elapsed time since
creation), and `codeHashPrefix` (first 8 hex characters of the
already-one-way-hashed document id, enough to correlate log lines for
one session across create/approve/poll without being any more
reversible than the full hash already is). **Never logged:** the raw
pairing code, the raw TV session token, the full hash, the custom
token, or the device label. Zero behavior change — confirmed by rerunning
the full automated suite (55/55 pass) after adding this.

The specific signature to watch for in Cloud Logging going forward:
```json
{"event":"poll","reason":"expired","statusAtExpiry":"pending", ...}
```
`statusAtExpiry: "pending"` on a `poll` event is the race (scenario A —
a poll destroyed a session nobody had decided on yet). Any other
`statusAtExpiry` there is ordinary, harmless cleanup of an abandoned
session.

---

## Evidence (executed against the real Firestore emulator)

**Scenario A — the race (matches the production symptom):**
```
1. TV creates session at 04:41:00, expiresAt=04:43:00. Phone loads the
   approval screen while still valid — this is the screenshot.
2. TV's routine poll at 04:43:01 (teacher has NOT approved yet):
   consumeApprovedSession() -> {"ok":false,"reason":"expired"}
   >>> DELETES the document, even though status was still "pending". <<<
3. Teacher taps Approve at 04:43:03 (2s after the TV's poll already
   deleted the session):
   approveSession() -> {"ok":false,"reason":"not_found"}
```

**Scenario B — control, no race, genuine lateness alone:**
```
approveSession() alone, no prior poll, 3s past TTL ->
  {"ok":false,"reason":"expired"}
```
Confirms genuine lateness is independently sufficient — fixing the race
alone would not eliminate every way to see this message; the TTL/UX
question in the next section still matters regardless.

**Test-coverage gap this revealed:** the existing automated suite
(`deviceSignInRepository.emulator.test.js`) tested "pending and not yet
expired" and "expired and not pending" as separate cases, but never the
combination "pending AND expired" — which is exactly where the bug
lives. This is a concrete gap to close when the actual fix is built.

---

## Recommendation (no code changed here — for your decision)

This is **not** simply "the teacher took too long" — it's a real,
reproducible defect in how expiry is enforced, independent of whatever
the "right" TTL turns out to be. Three things are worth fixing together,
none of which require weakening expiry, session binding, single-use
consumption, or rate limiting:

1. **Stop letting a routine TV poll destroy a still-`pending` session.**
   A poll discovering the TTL has elapsed on a `pending` session should
   report `expired` *without deleting* (or delete only via a separate,
   explicit cleanup path) — the destructive side effect of an
   information-only TV heartbeat is the actual bug, not the TTL
   enforcement itself. This directly removes the race regardless of
   what the TTL number is.
2. **Make the phone's approval screen expiry-aware.** It already
   receives the session's own timing implicitly; it should show a live
   countdown (same pattern as the TV's own) and disable/relabel Approve
   once time is up, rather than ever offering a tap that's guaranteed to
   fail. This directly addresses your own stated UX concern.
3. **TTL value** — my recommendation, once #1 and #2 are in place:
   modestly extend it (something in the 3–5 minute range) rather than
   keep exactly 2 minutes. 2 minutes is tight for a *first-time* flow
   that includes unlocking a phone and a full Google sign-in, and your
   own test needed almost exactly that long on just the second attempt.
   I would not rely on "auto-issue a new session" as the primary fix on
   its own — the TV already does this for itself, but the phone has no
   channel to learn a new code exists without the teacher noticing the
   TV screen changed and re-scanning, which is a worse experience than
   simply giving her enough time in the first place.

None of the three above are implemented in this pass — this document and
the diagnostic logging are the full extent of this round's changes.
