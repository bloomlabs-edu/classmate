# "Sign in with Phone" for Shared Classroom Devices (TV/Display)

**Status:** Design proposal only. No code implemented, no Firestore rules
changed, nothing deployed. Written in response to real co-teacher feedback:
she wants ClassMate on a school TV/shared display but will not type her
Google password on it.

**Scope:** a TV shows a short-lived QR code and/or one-time code. The
teacher authenticates and explicitly approves on her own phone (which keeps
the existing Google Sign-In flow unchanged). The TV becomes a normal,
fully-authenticated ClassMate session for her account — without her
password, or any credential at all, ever being entered on the TV.

---

## 1. Investigation — current Firebase Auth architecture

### 1.1 Identity model today
- **Teachers:** real Firebase Auth, Google Sign-In only (`js/services/authService.js`). `browserLocalPersistence` — a signed-in teacher stays signed in across browser restarts on that device. Email is deliberately never read/stored (`toSafeProfile()` strips every user down to `{uid, displayName, photoURL}}`).
- **Students:** no real account at all — a "trusted device" (`studentDeviceService.js`) holding up to 3 approved `{classroomId, studentId}` profiles in `localStorage`, each additionally backed by its **own independent Firebase Anonymous Auth identity** (`studentAuthService.js`) on a **separate, named Firebase App instance** (`studentSlot0/1/2`, never the default app) — this exists specifically so an anonymous identity can coexist with a teacher's own Google session without one silently signing the other out. **This is the single most relevant existing precedent** for "an unauthenticated device needs its own bootstrap identity, isolated from the primary Auth session."
- **Firestore security rules are uniformly uid-membership-based**, not role- or claim-based: essentially every rule in `firestore.rules` reduces to `request.auth.uid in get(classroom).data.memberUids`. No custom claims are used anywhere in this codebase today. This is the key fact the whole proposal below is built around: **whatever ends up authenticated on the TV must carry the teacher's own real uid**, or every existing rule would need to learn a second trust concept.

### 1.2 Existing short-lived-code / server-verified-secret precedents
Three already-shipped patterns are directly reusable:
1. **`classrooms/{id}/studentVerificationCodes/{codeHash}`** (Learner Identity Bridge) — the document ID *is* the SHA-256 hash of the real code; the raw code is never persisted anywhere; resolution happens only inside a trusted server module via Admin SDK, never through a client-readable Firestore rule. This is the exact shape a pairing secret should take.
2. **`functions/src/slack/stateToken.js`** — a short-TTL (5 min), HMAC-signed, server-issued token binding a flow to "the same already-authenticated uid who started it," verified with constant-time comparison. Good prior art for anti-tampering/anti-replay reasoning, even though the design below uses a Firestore document rather than a bearer token for the pairing state (see §3).
3. **`functions/index.js`'s `applyCorsIfAllowed()`** — an explicit origin allow-list for `onRequest` Cloud Functions reachable directly from a browser (not Firebase Hosting rewrites), with a documented reason the built-in `cors: [...]` option was rejected (it echoed arbitrary origins in testing). Any new browser-callable function in this design reuses this exact helper.
4. **`classroomInvitationCodes`'s own rule comment**: "resolution for this bridge always happens server-side (Admin SDK), bypassing this rule entirely" — i.e. this codebase already has a precedent for *not* writing a client Firestore rule at all for a sensitive lookup, instead routing it exclusively through a Cloud Function. The design below follows this for the new, most sensitive collection it introduces.

### 1.3 What does NOT exist today (and isn't needed)
- No custom claims, no App Check currently enabled anywhere (worth adding narrowly here — see §4).
- No `createCustomToken` usage anywhere yet — this proposal is the first.
- No QR-generation dependency in `package.json` yet (`@dicebear/core` is unrelated, avatar-only).

### 1.4 The one architectural decision this all hinges on
Firebase Auth's `admin.auth().createCustomToken(uid)` lets a trusted backend mint a token that, when redeemed client-side via `signInWithCustomToken()`, produces a real Firebase Auth session **for that exact uid** — indistinguishable afterward from any other sign-in method for that same account. Because this app's entire security model is "real uid in `memberUids`," minting a custom token for the teacher's own uid and redeeming it on the TV is the only option that requires **zero changes to any existing Firestore rule, role, or permission check**. Every alternative considered (a scoped "TV viewer" role, a new `tvSessions` identity concept, anonymous-auth-plus-claims) would require teaching every existing rule a second kind of session — rejected for exactly that reason.

---

## 2. Proposed flow

**Actors:** the shared TV (no account, browser only) and the teacher's own phone (already capable of normal Google Sign-In).

1. **TV requests a pairing session.** The TV calls a new public Cloud Function, `startDeviceSignIn`, with a short, sanitized device label (e.g. derived from `navigator.userAgent`, display-only, never trusted for security). The function:
   - Generates one high-entropy **pairing code** (not the existing 6-char `generateJoinCode()`'s `Math.random()` — see §4 for why this needs a CSPRNG and more entropy).
   - Stores a new document at `deviceSignInSessions/{sha256(pairingCode)}` with `{status: 'pending', createdAt, expiresAt (+2 min), deviceLabel}`. The raw code itself is never persisted anywhere, matching the `studentVerificationCodes` convention exactly.
   - Returns the raw pairing code to the TV once, in the function response only.
2. **TV displays the code.** Both as a QR code (encoding a deep link, e.g. `https://classmate.app/#/approve-sign-in/<code>`) and as a large plain-text code for manual entry, plus a visible countdown. When it expires unapproved, the TV silently requests a fresh one and swaps the display — a dead QR code is never left on screen.
3. **Teacher scans or types the code on her phone.** This opens an "Approve sign-in" view. If she isn't already signed in on her phone, she signs in first via the **existing, unchanged** `signInWithGoogle()` flow — this is the one and only place a credential is ever entered, and it was already true today. The approval view calls an authenticated Cloud Function, `getDeviceSignInRequestInfo`, passing her Firebase ID token + the code, and shows her the device label and request time so she can sanity-check this is actually her own TV.
4. **She explicitly approves (or denies).** Tapping **Approve** calls `approveDeviceSignIn` (ID token + code). The function:
   - Re-verifies her ID token → her real `uid`.
   - Looks up the session doc by `sha256(code)` via Admin SDK (bypassing any client rule, matching the `classroomInvitationCodes` precedent).
   - Rejects if expired, already approved, already denied, or already claimed.
   - Calls `admin.auth().createCustomToken(uid)` and writes the token into the session doc, `status: 'approved'`.
   - The phone never receives the custom token itself — only a plain `{ok: true}` — keeping the token exclusively on a server-to-TV path, strictly narrower than necessary but cheap to do and worth doing.
   - **Deny** sets `status: 'denied'` instead; no token is ever minted.
5. **TV claims the token.** The TV has been polling a public `pollDeviceSignIn` function (passing only the code) roughly every 2 seconds since step 2. The function performs an atomic read-then-clear: if `status === 'approved'`, it returns the custom token to the TV **exactly once** and immediately deletes the session document — so even a leaked/duplicated poll response can never be redeemed twice. If `status === 'denied'`, it returns that so the TV can show a clear message. If expired with no response, the TV's own countdown has already triggered a fresh `startDeviceSignIn` by this point.
6. **TV redeems the token.** The TV calls Firebase's own `signInWithCustomToken(auth, token)`. `auth.currentUser.uid` is now the teacher's real uid. `onAuthStateChanged` fires exactly as it does for Google Sign-In, so `main.js`'s existing boot flow needs **no changes** — from the app's own perspective this is just "a teacher signed in." Her classrooms, role, and every permission resolve identically to any other device she's ever used.

---

## 3. Security model / threat analysis

| Property | How it's achieved |
|---|---|
| Password never reaches the TV | Structural, not policy: the TV's code path never calls `signInWithPopup`/`GoogleAuthProvider` at all — only `signInWithCustomToken`. There is no code path on the TV that could even display a password field. |
| Pairing code can't be stored/leaked at rest | Only `sha256(code)` is ever persisted (`studentVerificationCodes` convention) — a Firestore data export or admin console browse never reveals a usable code. |
| Short exposure window | 2-minute TTL per code (tighter than the Slack state token's 5 minutes — this is meant to be scanned in the same room, not completed via an external redirect round trip). Auto-refresh on the TV keeps the *displayed* code always live without widening any single code's own window. |
| No replay | The custom token is deleted from its document the instant `pollDeviceSignIn` hands it out once (atomic read-then-clear). Firebase's own custom tokens additionally self-expire within ~1 hour if somehow never redeemed. |
| No brute force within the window | Entropy must come from a CSPRNG, not `Math.random()` (today's `generateJoinCode()` is fine for its own purpose — a Firestore-membership-gated join request — but is the wrong bar for a bearer credential that directly yields a live session; see §4 for the concrete recommendation). Combined with a per-code attempt count and, ideally, App Check on the two unauthenticated endpoints (`startDeviceSignIn`, `pollDeviceSignIn`) to blunt scripted abuse. |
| Confused deputy / wrong classroom | Not applicable by construction — the TV ends up signed in as the teacher's own real uid, so it sees exactly what she would see on any other device, nothing more, nothing less. No new role or scoped permission is introduced, which also means no new permission bug is possible here. |
| Explicit, informed consent | The approval screen must show device label + time before the Approve button is reachable — never an auto-approve, never a bare "tap to confirm" with no context. |
| Revocation (explicit limitation, not solved here) | Once the TV is signed in as her uid, it behaves like any other of her devices — Firebase has no native "sign out this one specific other session" for a custom-token-derived session, same as it has none for her own laptop today. The only guaranteed-immediate control is signing out directly on the TV. A forced `admin.auth().revokeRefreshTokens(uid)` exists but would also sign her out everywhere else — a real tradeoff to put in front of the product owner, not something to silently decide here. |
| Shared-device persistence | Recommend the TV's resulting session use `browserSessionPersistence` (or a capped/idle-timeout variant), **not** the `browserLocalPersistence` every other teacher sign-in uses today — a shared TV staying silently signed in as one specific teacher indefinitely is a different risk profile than her own laptop. This needs one new, narrow `authService.js` entry point (see §4) rather than changing the default for every sign-in. |

**Explicitly not solved by this design, and not necessary for it to work:** multi-classroom selection at pairing time (the TV just inherits her existing classroom list, exactly as her phone would), and remote session termination (noted above as a real, inherent limitation of any custom-token approach, not unique to this design).

---

## 4. Firebase changes required

1. **New Firestore collection**, `deviceSignInSessions/{codeHash}` — `{status, createdAt, expiresAt, deviceLabel, approvedByUid, customToken (transient)}`. **No new `firestore.rules` entries at all** are required for it — by design, both the TV and the phone only ever reach this collection through Cloud Functions using the Admin SDK, which bypasses rules entirely, the same choice already made for `classroomInvitationCodes`' own resolution step. This is deliberately the smallest-surface option: the single riskiest new collection in the app gets zero client-reachable rules, not a carefully-worded one.
2. **New Cloud Functions** (`functions/src/deviceSignIn/`, mirroring the existing `functions/src/slack/` folder convention):
   - `startDeviceSignIn` — public `onRequest`, generates the code (see below), creates the session doc.
   - `getDeviceSignInRequestInfo` — `onRequest`, requires a verified teacher ID token, returns device label + timestamp for the approval screen.
   - `approveDeviceSignIn` / `denyDeviceSignIn` — `onRequest`, requires a verified teacher ID token, mints the custom token on approve.
   - `pollDeviceSignIn` — public `onRequest`, atomic read-and-clear of an approved token.
   - All four reuse `applyCorsIfAllowed()` exactly as already written in `functions/index.js` — no new CORS logic invented.
3. **Code generation upgrade, scoped to this feature only**: a CSPRNG-based generator (Node's `crypto.randomInt`/`randomBytes`, Cloud-Functions-side — there is no client-side generation here at all, unlike `generateJoinCode()`), same unambiguous alphabet ClassMate already uses (`ABCDEFGHJKMNPQRSTUVWXYZ23456789`) for typing/display familiarity, but longer — 8 characters (~40 bits) rather than 6, since this code is a direct bearer path to a live session, not a membership-gated join request. This does not change `generateJoinCode()` itself or anything that depends on it.
4. **`js/services/authService.js`**: one new exported function, e.g. `signInWithCustomTokenForSharedDevice(token)`, that explicitly sets `browserSessionPersistence` (or equivalent) before calling Firebase's `signInWithCustomToken` — isolated from `initAuth()`'s existing `browserLocalPersistence` default so no other sign-in path is affected.
5. **New client services** (TV side and phone side), following the existing "no UI component touches Firebase/fetch directly" convention (`slackIntegrationService.js` precedent): a `deviceSignInService.js` (TV: start/poll/redeem) and a `deviceSignInApprovalService.js` (phone: fetch info/approve/deny).
6. **Recommended, not strictly required for V1**: enable Firebase App Check on `startDeviceSignIn` and `pollDeviceSignIn` specifically — these are the two endpoints reachable with zero authentication, the natural place to add bot/abuse resistance.
7. **QR rendering**: no existing dependency covers this; a small, well-known QR-generation library would need to be added to the client bundle (pure client-side rendering of a URL string — no new backend surface).

---

## 5. UX states

**TV:**
- *Offered*: a "Sign in with your phone" option alongside (not replacing) the existing Google Sign-In button.
- *Pairing displayed*: QR + plain 8-character code + visible countdown + "On your phone, scan this or go to Settings → Approve a device."
- *Auto-refresh*: on expiry with no approval, silently fetch a new code and swap the display, resetting the countdown — a TV must never show a dead code.
- *Denied*: "Sign-in request was denied on your phone," with a retry (fresh code).
- *Approved*: brief "Signed in ✓" transition straight into the normal Personal Hub — identical to any other successful sign-in from here on.
- *Network/error*: a clear retry affordance if `startDeviceSignIn`/`pollDeviceSignIn` itself is unreachable.

**Phone:**
- *Entry*: via QR deep link, or a manual "Approve a device" entry point (e.g. from Settings/Account) for typing the code by hand.
- *Sign-in gate*: if not already signed in, the existing Google Sign-In screen first, then returns into this flow with the code preserved.
- *Confirm*: "Approve sign-in on this device?" + device label + request time + Approve/Deny — the one mandatory explicit-consent screen.
- *Invalid/expired code*: "This code has expired or is invalid — ask for a new one on the TV."
- *Already completed*: "This sign-in has already been completed" (re-opening a used link/code).
- *Success*: "✅ [device label] is now signed in," with a one-line note that it will stay signed in on that device until someone signs out there — sets expectations given the shared-device persistence choice in §3.

---

## 6. Open decisions for product/security sign-off before implementation

1. **Session persistence on the TV** — `browserSessionPersistence` (signs out on browser/tab close — safest default for a shared device, but may surprise a teacher expecting the TV to "just stay signed in" like a classroom projector) vs. `browserLocalPersistence` with a visible, explicit "shared device — sign out" nudge instead. Recommend the former; flagging because it's a real usability tradeoff, not a technical constraint.
2. **App Check** — worth the setup cost now, or acceptable to ship V1 without it and add later if abuse is observed? Recommend adding it at launch specifically because these two endpoints are the only fully-unauthenticated surface this feature introduces.
3. **Pairing-code TTL** (proposed 2 minutes) and length (proposed 8 chars) are defaults, not fixed — easy to tune either way before implementation.
4. **Remote revocation** — explicitly out of scope per §3; confirm that's acceptable, or decide whether `revokeRefreshTokens` (with its "signs her out everywhere" side effect) should be offered as an explicit, clearly-labeled "panic button" in Settings regardless.

Nothing in this document has been implemented. No Firestore rules, Cloud Functions, or client code have been changed.
