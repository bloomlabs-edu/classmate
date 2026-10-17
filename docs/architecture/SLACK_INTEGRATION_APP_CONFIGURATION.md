# ClassMate ↔ Slack — Phase 1 App Configuration Spec

**Status: specification only, nothing implemented or deployed.** No
Slack App has been created, no Cloud Function has been written, no
secret has been provisioned, and no Firestore data or rule has
changed. This document is the exact configuration to create once the
identity-linking design (see
`docs/architecture/SLACK_IDENTITY_LINKING_COMMITTEE_REVIEW.md`) is
approved, so that setup work has no open decisions left to make
ad hoc at build time.

Builds on the architecture proposed and agreed in this project's Slack
integration discussion (2026-09-22): direct Firestore triggers off
`weeklyPlanSubmissions`, no `classmateEvents`, no deadline reminders,
`models/WeeklyPlanSubmission.js` and its service/repository untouched.

---

## 1. App identity

| Field | Value |
|---|---|
| App name | `ClassMate` (internal name; display name in Slack shown to teachers, e.g. as the DM sender) |
| Distribution | **Internal only** — installed directly to the Teach For India workspace. Never submitted to the Slack App Directory. |
| Workspace | TFI's existing Slack workspace (confirm exact workspace/team ID before creating the app — open question, see §6) |
| Who creates it | Whoever holds Slack workspace admin rights to approve internal app installs (open question, see proposal §12) |

## 2. OAuth surfaces — there are two, deliberately kept separate

Slack apps in this shape have two distinct authorization flows that
must not be conflated:

1. **Bot installation** — a one-time, admin-performed OAuth grant that
   lets ClassMate's backend post messages at all. Happens once, ever
   (per workspace).
2. **Per-teacher identity linking ("Sign in with Slack")** — an
   OpenID Connect flow each individual teacher runs once, from inside
   ClassMate, to link their own Slack identity. Happens once per
   teacher who opts in.

These use different scope types (bot token scopes vs. OIDC user
scopes) and different redirect URIs, configured as two sections of the
same Slack App.

## 3. Bot token scopes (OAuth & Permissions → Bot Token Scopes)

| Scope | Why | Required for Phase 1? |
|---|---|---|
| `chat:write` | Post messages to the `#classmate` channel and to DM conversations the bot has open | **Yes** |
| `im:write` | Open a DM conversation with a specific Slack user ID via `conversations.open`, so the bot can message a teacher without already sharing a channel | **Yes** |
| `chat:write.public` | Post to public channels the bot hasn't been explicitly invited to | **No** — the bot will be manually `/invite`d to `#classmate`; requesting broader posting rights than needed is unnecessary privilege |
| `users:read` | Look up a Slack user's status (e.g. to detect a deactivated account proactively) | **No, defer** — Phase 1 failure handling reacts to the error Slack's send API already returns (`account_inactive`, `user_not_found`); no separate lookup call is needed to start |
| `channels:read` / `groups:read` | Resolve a channel name to an ID automatically | **No** — the `#classmate` channel ID is obtained once, manually (Slack UI → channel details → copy Channel ID) and stored as static config; no dynamic channel discovery needed |

No other bot scopes. Do not request anything from the `admin.*` scope
family — this app never needs workspace-administration access.

## 4. OIDC scopes for "Sign in with Slack" (identity linking)

| Scope | Requested? | Why |
|---|---|---|
| `openid` | **Yes** | The only scope requested. Includes at minimum the `sub` claim (Slack user ID) and the `https://slack.com/team_id` claim. |
| `profile` | **No** | Never requested. |
| `email` | **No** | Never requested. |

**Correction (2026-09-23), from live testing against a real Slack App configured with ONLY `openid` under User Token Scopes:** requesting only `openid` does **not** reliably prevent Slack from disclosing or returning additional identity fields. Slack's own consent screen, on this exact app, told the teacher *"Slack will share your name, email address, profile image, user ID, and team ID"* — and Slack's reference docs for `openid.connect.userInfo` list `email`, `name`, `picture`, and similar fields as possible response fields without documenting which scope excludes which field. **The privacy boundary this feature relies on is therefore enforced entirely in ClassMate's own code, not by the scope request:** `functions/src/slack/slackClient.js`'s `fetchSlackIdentity()` reads only `sub` and the team_id claim out of whatever Slack returns, and discards everything else before it ever reaches a caller, a log line, or Firestore. See that function's own test (`tests/functions/slack/slackClient.test.js`) for a mock response containing `email`/`name`/`picture`, asserting none of them survive.

This does not change what ClassMate requests, stores, or the Firestore schema (`{ slackUserId, slackTeamId, connectedAt, disconnectedAt }`, unchanged) — only the accuracy of *why* email/name/profile never reach storage.

Redirect URL for this flow (see §5) is a **separate** endpoint from
the bot-install redirect, even though both may be implemented by the
same Cloud Function, so that `state` handling for the two flows can
never be confused with each other.

## 5. Endpoints Slack needs to reach (Redirect URLs)

Two redirect URIs, registered under OAuth & Permissions → Redirect URLs:

- `https://<region>-classmate-302c2.cloudfunctions.net/slackOAuthInstall` — bot installation callback (run once, by an admin).
- `https://<region>-classmate-302c2.cloudfunctions.net/slackIdentityLinkCallback` — per-teacher "Connect Slack" callback.

Both are plain `onRequest` HTTPS functions (same pattern as the
existing `verifyLearnerConnection` function in `functions/index.js`),
not `onCall` — consistent with this codebase's existing reasoning that
callable functions auto-verify against ClassMate's own project only,
which is fine here (unlike the Learning Hub bridge, both these
callbacks *are* ClassMate-project callers) but `onRequest` is still
correct because Slack itself is the caller, not an authenticated
Firebase client.

## 6. Features to leave OFF for Phase 1

| Feature | Status |
|---|---|
| Event Subscriptions | Off — nothing needs to flow Slack → ClassMate yet (Phase 4) |
| Interactivity & Shortcuts | Off — no buttons/actions yet (Phase 4) |
| Slash Commands | Off — none proposed until Phase 4 |
| Socket Mode / App-Level Tokens | Off — not needed without Events API |
| Org-wide app install | Off — single-workspace install only |

Leaving these off is a real security boundary, not just an unused
setting: it means this Slack App has **no inbound surface at all** in
Phase 1 — nothing external can call into ClassMate through it. The
only traffic is ClassMate calling Slack's API outward, plus the two
OAuth redirect callbacks above.

## 7. Secrets — where they live

All of the following are Cloud Functions v2 Secret Manager secrets
(`defineSecret(...)`), never Firestore fields, never anything under
`js/` (the entire `js/` tree ships to the browser):

- `SLACK_BOT_TOKEN` — from bot installation, step 2 above.
- `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` — from the Slack App's Basic Information page, used by both OAuth flows to exchange codes for tokens.
- `SLACK_STATE_SIGNING_SECRET` — a ClassMate-generated secret (not from Slack) used to HMAC-sign the `state` parameter that binds an identity-link attempt to a specific, already-authenticated ClassMate `uid`.

Non-secret config (safe to keep as a plain Functions config value or
a `config/slackApp` Firestore doc): `classmateChannelId` (the
`#classmate` channel's Slack ID).

## 8. Rate limits (informational, not a blocker)

`chat.postMessage` is Tier 3 (Slack's standard messaging tier,
currently ~50+ requests/minute per workspace) — orders of magnitude
above Phase 1's expected volume (one submission-status message per
Weekly Plan transition). No special handling needed beyond the
existing "log and drop on failure" plan already specified in the
architecture proposal.

## 9. Open questions before this app can actually be created

1. Confirm the exact TFI Slack workspace/team to install into.
2. Confirm who holds admin rights to approve an internal app install (needed to actually click "Install to Workspace").
3. Confirm the `#classmate` channel already exists (or should be created) and get its Slack Channel ID once the app is being wired up.
