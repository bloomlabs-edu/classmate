# membershipLinks Rule — External Verification Harness

This directory exists because the environment that authored it has no network
access — it could not install `firebase-tools`, could not download the
Firestore emulator binary, and could not run any of this itself. Everything
here is real, ready-to-run code, prepared for you to execute on a machine
that *does* have normal network access. Nothing in this directory has been
executed. See the parent project's own Phase 1.1 report for exactly which
hosts were checked and blocked, if you want that detail.

**Nothing outside this directory was touched to build this.** The application
itself, `../firestore.rules`, and the app's own `../tests/` suite are all
completely unmodified — this harness only *reads* the real `../firestore.rules`
file; it never copies or edits it.

## What this tests

The `membershipLinks` rule introduced in Phase 1 (see `../firestore.rules`,
the `classrooms/{classroomId}/learningProgrammes/{programmeId}/membershipLinks/{uid}`
block). All 13 test cases specified for this phase, run against the real
Firestore Rules engine via the official
[`@firebase/rules-unit-testing`](https://firebase.google.com/docs/rules/unit-tests)
library — not a hand-written reimplementation of the rules language.

**Test 3 is intentionally not asserted pass/fail.** It's the known, open
question of whether the current rule can be tricked into letting one student
claim to be a different, real, active student — the test runs, reports the
actual result to the console either way, and never fails the suite regardless
of outcome. Don't "fix" this test to make it assert something — that would
defeat its entire purpose.

## A. Files in this directory

- `package.json` — the two dependencies this harness needs (not the app itself).
- `firebase.json` — a minimal, harness-only emulator config, pointing at the real `../firestore.rules`. Deliberately separate from the app's own `../firebase.json` (which configures hosting/deployment, not this).
- `membershipLinks.rules.verify.js` — the actual 13 tests, using Node's built-in `node:test` (matching the rest of this project's own testing convention — no new test framework introduced).

## B. Dependencies required

- **Node.js** (any version supporting `node:test` and top-level ESM — v18+; this project otherwise uses v22).
- **Java** (required by the Firestore emulator binary itself — any JRE/JDK 11+; this sandbox already had OpenJDK 21 available, so this is likely already satisfied on most developer machines too).
- **`firebase-tools`** — the CLI that launches the emulator (install globally, or use `npx` — see below).
- **`@firebase/rules-unit-testing`** and **`firebase`** — declared in this directory's own `package.json`.

## C. Exact commands to install dependencies

From inside this directory:

```bash
cd firebase-rules-verification
npm install
```

If you don't already have `firebase-tools` installed globally:

```bash
npm install -g firebase-tools
# or, without a global install:
# npx firebase-tools --version   (confirms npx can fetch it on first use)
```

## D. Exact command to start the Firestore emulator

From inside this directory (so it picks up this directory's own `firebase.json`, pointing at the real `../firestore.rules`):

```bash
firebase emulators:start --only firestore --project classmate-membershiplinks-rules-verification
```

Leave this running in its own terminal. You should see it log that the Firestore emulator is listening on `127.0.0.1:8080` — the same host/port `membershipLinks.rules.verify.js` connects to.

## E. Exact command to run the tests

In a second terminal, from inside this same directory, with the emulator still running:

```bash
node --test membershipLinks.rules.verify.js
```

(Or `npm test`, which runs exactly this.)

## F. Expected output format

Standard Node `node:test` TAP-like output — the same format every test in this project's own `../tests/` directory already produces:

```
▶ 1. own uid + own studentId -> ALLOW
✔ 1. own uid + own studentId -> ALLOW (Xms)
▶ 2. own uid attempts to create ANOTHER uid's path -> DENY
✔ 2. own uid attempts to create ANOTHER uid's path -> DENY (Xms)
▶ 3. own uid + a DIFFERENT real, active student's studentId -> report actual result, assert nothing
[TEST 3 RESULT] ALLOWED. This confirms the known, open trust-boundary gap...
✔ 3. own uid + a DIFFERENT real, active student's studentId -> report actual result, assert nothing (Xms)
...
# tests 13
# pass 13
# fail 0
```

**All 13 tests "passing" does NOT mean the security model has no gaps** — it means the rule behaves exactly as the manual trace predicted, including the intentionally-unasserted Test 3, whose actual `[TEST 3 RESULT]` line in the console output is the one piece of genuinely new information this harness produces that manual reading alone couldn't confirm.

If `membershipLinks.rules.verify.js` instead fails to even *start* (an error before any individual test result appears), that most likely means the rule failed to compile — read the error message directly; it will name the exact line and syntax problem, if there is one. That would be new, important information neither this harness's authoring environment nor the manual trace could produce.

## G. Cleanup

`Ctrl+C` the emulator process when done. No persistent state is created outside the emulator's own in-memory instance; nothing here touches a real Firestore project.
