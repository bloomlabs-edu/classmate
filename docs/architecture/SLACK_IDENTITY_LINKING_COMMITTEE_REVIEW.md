# ClassMate ↔ Slack — Identity-Linking Data Flow, for AI Working Committee Review

**Status: proposal for review, nothing implemented or deployed.** No
Slack App has been created, no Cloud Function has been written, no
Firestore data or rule has changed. This document exists to be read
and decided on *before* any of that happens. Companion document:
`docs/architecture/SLACK_INTEGRATION_APP_CONFIGURATION.md` (the exact
technical Slack App configuration this design assumes).

**Correction, 2026-09-23 (before any real Slack connection was
authorized):** §4 below originally claimed the `openid`-only scope
request made it structurally impossible for Slack to ever return
email/name/profile-photo data to ClassMate. Live testing against a
real Slack App configured with ONLY `openid` (no `profile`, no
`email`) disproved that: Slack's own consent screen disclosed
*"Slack will share your name, email address, profile image, user ID,
and team ID"* regardless. §4 has been rewritten below to describe the
actual mechanism: ClassMate's own code, not Slack's scope grant, is
what enforces the privacy boundary. What ClassMate requests, stores,
and the Firestore schema are unchanged.

---

## 1. What we're asking to build, in one sentence

Let a teacher who has already signed in to ClassMate optionally link
their own Slack account, so ClassMate can send them Slack messages
about their own Weekly Plan status — nothing more.

## 2. Why this needs Committee review

Two of ClassMate's own existing, deliberate design rules are directly
relevant here:

- `services/authService.js` never reads, stores, or logs a teacher's
  email — by design, because email is contact information and any new
  use of it requires this Committee's sign-off first.
- `models/Member.js` states the same rule even more explicitly: *"no
  email, phone, or any other contact detail is collected... must be
  escalated to the AI Working Committee before any contact
  information is collected or stored."*

This proposal is designed to **not** violate either rule — no email,
phone, or contact detail is ever requested by ClassMate, and none is
ever stored or logged, regardless of what Slack itself discloses or
returns (see §4 for the corrected explanation of exactly how that's
enforced). But linking a teacher's ClassMate identity to an identity in an
external, third-party system is a new *kind* of thing this app has
never done, and it introduces Slack (a US-based SaaS vendor) as a new
data recipient. That combination is exactly the kind of decision these
existing rules say should get a second set of eyes, even though no
individual data element crosses the line the rules were written to
stop.

## 3. Who is affected

Teachers (Fellows) and Program Managers who use ClassMate and TFI's
Slack workspace. **Not students.** No student data, and no data about
any minor, is part of this flow in any form — see §6 for the explicit
boundary on what ClassMate is ever allowed to send into Slack.

## 4. Exactly what data moves, and what never does

**Requested from Slack, and stored:**

| Field | Stored where | Purpose |
|---|---|---|
| Slack user ID (`sub` claim) | `users/{uid}.slackIntegration.slackUserId` | Lets ClassMate address a DM to this specific teacher via Slack's API |
| Slack team ID | `users/{uid}.slackIntegration.slackTeamId` | Confirms the link is to TFI's own workspace |
| Link timestamp | `users/{uid}.slackIntegration.connectedAt` | Auditability |

**What ClassMate requests vs. what Slack may actually send back — these are not the same thing.** The "Sign in with Slack" flow requests **only** the `openid` scope; `profile` and `email` are never requested (see `SLACK_INTEGRATION_APP_CONFIGURATION.md` §4). We initially believed this made it structurally impossible for Slack to return anything beyond the user/team ID. **That belief was tested and disproven**: even with only `openid` configured on the Slack App, Slack's own consent screen disclosed sharing name, email, and profile image, and Slack's documentation does not guarantee the `openid.connect.userInfo` response excludes those fields for an `openid`-only grant.

**The actual privacy boundary is enforced entirely in ClassMate's own code, not by what scope was requested.** `functions/src/slack/slackClient.js`'s `fetchSlackIdentity()` is the one place Slack's raw response is read at all — it extracts only the `sub` and team-id claim from whatever Slack sends back, and discards everything else (email, display name, profile photo, or any other field) before it is ever logged, passed to a caller, or written anywhere. This is verified by an automated test that supplies a mock Slack response containing exactly this kind of extra data and asserts none of it survives (`tests/functions/slack/slackClient.test.js`).

**Never persisted, never logged, regardless of what Slack sends:** Slack email address, display name, profile photo, phone number, or any other Slack profile field. This mirrors `services/authService.js`'s existing handling of Google Sign-In exactly — that flow also technically receives an email from Google, and this app's own design strips it out before it's ever used (`toSafeProfile()`). The Slack design is the same posture (receive, then discard in code), not a stronger one — the earlier claim that it avoided receiving the data at all was the error being corrected here.

## 5. Data flow, step by step

1. Teacher is already signed in to ClassMate (existing Google Sign-In; ClassMate already knows their `uid`).
2. Teacher clicks "Connect Slack" in Settings — an explicit, opt-in action; nothing happens automatically or by default.
3. ClassMate redirects the teacher's browser to Slack's own consent screen (`openid` scope only), with a signed token binding this specific attempt to their ClassMate `uid`.
4. Teacher approves on Slack's own UI (standard Slack consent screen, Slack's own wording, not ClassMate's).
5. Slack redirects back to a ClassMate Cloud Function with a short-lived code.
6. The Cloud Function exchanges that code for the teacher's Slack user ID and team ID, verifies the signed token from step 3 matches, and writes only those two IDs plus a timestamp to Firestore, under that teacher's own `users/{uid}` document (a location only that teacher and ClassMate's backend can read).
7. From then on, when that teacher's own Weekly Plan status changes, a Cloud Function sends a Slack direct message to that Slack user ID.

## 6. What ClassMate is allowed to put in a Slack message

A fixed allow-list, enforced in the message-formatting code, never a
raw document dump:

- Classroom display name, subject name.
- The week being referenced (e.g. "21–27 Sep").
- The Weekly Plan's status (submitted / changes requested / approved) and, if changes were requested, the section labels the reviewer flagged (e.g. "Lesson 2 assessment") — never the reviewer's free-text comment content in this phase, and never any student-identifying information.
- A link back to the relevant ClassMate screen.

**Explicitly excluded, permanently:** student names, scores, behavioral
records, attendance, health/medical information, caste/religion data,
or anything else in this organization's sensitive-data categories.
None of that data has any path into this feature at all — the Weekly
Plan status object it reads from (`models/WeeklyPlanSubmission.js`)
doesn't contain any of it either (see the architecture proposal's
findings: that model deliberately carries no planning content, only
status).

## 7. Consent and revocation

- **Opt-in only.** No teacher is auto-enrolled; nothing is linked until they click "Connect Slack" themselves.
- **Visible.** The Settings screen always shows current status ("Connected" / "Not connected") — mirrors the existing FCM push-notification toggle's UI pattern.
- **Revocable at will.** A "Disconnect Slack" action deletes the `users/{uid}/integrations/slack` document immediately; ClassMate can no longer address that teacher on Slack from that point on. No approval or delay required to revoke.
- **Revocable by Slack, too.** If a teacher instead removes ClassMate's access from their own Slack account settings, or leaves the TFI Slack workspace, ClassMate detects this the next time it tries to send (Slack's API returns an error) and treats them as unlinked — see the failure-handling section of the architecture proposal.

## 8. Third-party processor note

This is the first ClassMate feature that sends any ClassMate-originated
data to a system outside Google Cloud/Firebase. Slack Technologies
(Salesforce) is already TFI's approved communication vendor for staff
— this isn't introducing a new vendor relationship, only a new
*system-to-system* data flow to an existing one. The data leaving
Firebase's infrastructure for Slack's is limited to what's described
in §4 and §6 above: two opaque IDs at link time, and allow-listed
workflow metadata at message time — never learner data, never contact
information.

## 9. What we're asking the Committee to decide

1. Is this identity-linking design (Slack user ID + team ID only, `openid`-scope-only, teacher-opt-in, freely revocable) acceptable, or does it need additional restriction?
2. Is the message-content allow-list in §6 sufficient, or should specific fields be removed/added before Phase 1 ships?
3. Should DMs be in scope for Phase 1 at all, or should the Committee prefer starting with `#classmate`-channel-only posts (no per-teacher linking, no external-identity mapping at all) until this pattern has a track record?
4. Any objection to Slack (as TFI's existing vendor) receiving this category of workflow metadata, distinct from the contact-information concern this doc already addresses?
5. **New, per the §4 correction:** is a code-enforced discard (Slack may transmit email/name/profile photo to ClassMate's backend; ClassMate's code reads and stores none of it, verified by an automated test) an acceptable privacy posture, or does the Committee require a guarantee that this data never reaches ClassMate's infrastructure at all — which is not achievable with Slack's current OIDC behavior for this app?

No implementation proceeds until this is answered.
