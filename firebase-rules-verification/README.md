# Firestore Rules Verification Harness — External Execution Handoff

This directory exists because the environment that authored it has no network
access — it could not install `firebase-tools`, could not download the
Firestore emulator binary, and could not execute a single test in either file
here. Everything in this directory is real, ready-to-run code, prepared for
you to execute on a machine with normal network access. **Nothing here has
been executed.** Every prior report from this project says so explicitly —
this handoff exists to close that gap.

**Nothing outside this directory was touched to build this.** The application
itself, `../firestore.rules`, and the app's own `../tests/` suite are all
completely unmodified — this harness only *reads* the real `../firestore.rules`
file directly; it never copies or edits it. Confirmed by both `.verify.js`
files' own code (`readFileSync('../firestore.rules', 'utf8')`) and by
`firebase.json`'s own `"rules": "../firestore.rules"` entry.

## A. Exact files in this handoff

| File | Purpose |
|---|---|
| `membershipLinks.rules.verify.js` | 13 tests for the `membershipLinks/{uid}` rule (Phase 1). |
| `studentEntries.rules.verify.js` | 23 tests for the `studentEntries/{studentId}` rule (Phase 3/3.2), including the field-ownership security fix and the special first-goal-after-attendance edge case (Test 9b). |
| `package.json` | The two dependencies this harness needs — `@firebase/rules-unit-testing` and `firebase` — completely separate from the main application's own dependency-free convention. |
| `firebase.json` | A minimal, harness-only emulator config, pointing at the real `../firestore.rules`. Deliberately separate from the app's own `../firebase.json` (which configures hosting/deployment, not this). |
| `run-verification.sh` / `run-verification.bat` | One simple, self-contained script that installs, starts the emulator, runs both test files, tears down, and returns a non-zero exit code on any asserted failure. Optional — the exact manual commands are documented below too, in case you'd rather run each step yourself. |

## B. Environment requirements

- **Node.js 18+** (this project otherwise uses v22; anything supporting `node:test` and top-level ESM works).
- **Java 11+** (required by the Firestore emulator binary itself — this sandbox already had OpenJDK 21 available, so this is likely already satisfied on your machine too).
- **npm**.
- **Firebase CLI** (`firebase-tools`) — install globally (`npm install -g firebase-tools`) or via `npx`.
- **Network access** to `registry.npmjs.org` (for `npm install`) and Firebase's own infrastructure (`storage.googleapis.com`, for the emulator binary download on first use).

**Do not use production Firestore.** The emulator runs entirely locally, in-memory, and is torn down when you're done — nothing here ever reads or writes the real `classmate-302c2` project.

## C. Exact commands

**IMPORTANT — the exact working directory matters at every step below. All commands in this section assume you start from the repository root (`classroom-tracker/`) unless a `cd` explicitly says otherwise. If you're already inside `firebase-rules-verification/`, do not `cd firebase-rules-verification` again.**

**Option 1 — the run script** (recommended, does all of the below in one step):

```bash
cd firebase-rules-verification
./run-verification.sh
```

On Windows: `run-verification.bat` instead. Both scripts install dependencies, start the emulator, run both test files in sequence, and stop the emulator afterward — the `.sh` version does this automatically via a cleanup trap; the `.bat` version currently requires you to close the emulator's own window manually when done (a known, documented asymmetry between the two — not silently glossed over).

**Option 2 — manual, step by step:**

```bash
cd firebase-rules-verification
npm install
npm install -g firebase-tools   # if not already installed

# terminal 1 — from inside firebase-rules-verification/
firebase emulators:start --only firestore --project classmate-rules-verification

# terminal 2 — also from inside firebase-rules-verification/
node --test membershipLinks.rules.verify.js
node --test studentEntries.rules.verify.js
```

Both options are equivalent; the script exists purely to reduce the chance of a step being skipped or mistyped.

## D. Emulator startup instructions

**Fixed this round — read this if you previously saw `Error: ../firestore.rules is outside of project directory`.** That error came from `firebase-rules-verification/firebase.json`'s own former `"firestore": {"rules": "../firestore.rules"}` entry — the Firebase CLI validates, at startup, that any path referenced there stays inside the directory containing that `firebase.json`, and `../firestore.rules` legitimately fails that check.

**The fix:** that entry has been removed entirely from `firebase-rules-verification/firebase.json` — it was never actually load-bearing for how these tests get the real rules. Both `.verify.js` files read `../firestore.rules` directly, in Node, via `readFileSync()`, and hand that exact text to `@firebase/rules-unit-testing`'s own `initializeTestEnvironment({ firestore: { rules: <text>, host, port } })` — which installs those rules into the *running* emulator instance at test-setup time, over its own admin connection, entirely independent of whatever `firebase.json` the CLI parsed when the emulator process itself started. The CLI-level `firestore.rules` config key was only ever telling the CLI what to load for itself; it was never what the tests actually run against. Removing it stops the CLI's own validation error without losing anything the tests depend on.

**I could not execute this fix myself to confirm it works** — this sandbox still has no network access to run `firebase emulators:start` at all (see the standing limitation documented in every prior phase's own report). This is a reasoned fix based on how `@firebase/rules-unit-testing` is documented to work, not a verified one. Start the emulator **from inside `firebase-rules-verification/`**, exactly as before:

```bash
firebase emulators:start --only firestore --project classmate-rules-verification
```

You should see something like `✔ firestore: Firestore Emulator running on 127.0.0.1:8080` — confirm this line specifically before running any test file.

**If this fix does not work for some reason, here is the alternative this phase's own instructions proposed, as a documented fallback — untested here for the same reason:** run the emulator from the repository root instead, using the *application's own* `firebase.json`/`firestore.rules` (neither of which needs any modification for this — the root `firebase.json` already has a `"firestore": {"rules": "firestore.rules", ...}` entry pointing at a file *inside* its own directory, so the same CLI validation that rejected `../firestore.rules` should accept this without complaint):

```bash
cd ..                          # from firebase-rules-verification/, back to classroom-tracker/
firebase emulators:start --only firestore
```

Firebase's own default Firestore emulator port (8080) should apply here even with no explicit `emulators` block in the root `firebase.json` — matching what both test files already expect. If it doesn't, that would be the one case where a root `firebase.json` change might seem necessary — per this phase's own explicit instruction, **stop and report that rather than making the change**, don't decide it yourself in the moment. Whichever way you start the emulator, run the actual test files from a *second* terminal, `cd`'d into `firebase-rules-verification/`, exactly as in Option 2 above — the tests connect by host/port only and don't care which directory the emulator process itself was launched from.

## E. Expected test matrix

**36 tests total across two files** — 13 in `membershipLinks.rules.verify.js`, 23 in `studentEntries.rules.verify.js` (22 numbered tests plus Test 9b, a special edge case). Two are deliberately unasserted (see F) — every other test uses `assertSucceeds`/`assertFails` and will show as a standard Node `node:test` pass/fail.

## F. Security scenarios covered

Per your own required list — every one of these is a real, executable test in `studentEntries.rules.verify.js`:

**Student:** own StudentEntry read (ALLOW) · another student's StudentEntry (DENY) · parent ProgrammeSession (DENY) · valid goal (ALLOW) · goal with outcome (DENY) · goal with reflection (DENY) · later outcome update (DENY) · later reflection update (DENY) · attendance write (DENY) · arbitrary nested field (DENY) · arbitrary top-level field (DENY) · inactive student (DENY) · cross-programme access (DENY).

**Teacher:** StudentEntry read (ALLOW) · attendance write (ALLOW) · outcome edit (ALLOW) · reflection edit (ALLOW).

**Special case (Test 9b):** teacher creates an attendance-only StudentEntry (no `goals` field at all yet) → student adds their first goal via `updateDoc()` → expected ALLOW. This specifically exercises the rule's own `resource.data.get('goals', {})` safe-accessor, added precisely because a naive direct field access would throw on this exact, legitimate scenario.

## G. What constitutes a PASS

A test **passes** when `node --test` reports it as `ok` — meaning its own `assertSucceeds`/`assertFails` call resolved the way the test itself expects. **Two tests are the exception, by design, not a bug:** `membershipLinks.rules.verify.js`'s own Test 3, and `studentEntries.rules.verify.js`'s own Test 22. Neither asserts a specific outcome — both `try`/`catch` the real attempt and `console.log` whichever result actually happens. They will always show as `ok` in the `node --test` output (since they never throw an unhandled assertion failure), but **that "ok" does not mean "the security question is resolved"** — read the console output for the actual `[TEST 3 RESULT]`/`[TEST 22 RESULT]` line to see what the real rules engine actually did. Both are known, already-disclosed, deliberately-deferred limitations (student self-attestation without cryptographic identity proof; category-ID values not validated against programme configuration) — a real ALLOW result for either is expected, not a surprise, and not something to "fix" by editing the rule.

## H. What constitutes a FAIL

Any test **other than** Test 3/Test 22 reporting `not ok` in the `node --test` output. This means the real Firestore Rules engine did not behave the way the code-level review (see the Phase 3/3.1/3.2/3.3 reports) concluded it should. **Do not modify `firestore.rules` to make a failing test pass.** Per Phase 3.3's own explicit instruction, still in force: capture the exact `TEST` / `EXPECTED` / `ACTUAL` / `ERROR` for each failure and report it — a failure here is input for a separately authorized fix phase, not something to patch in the moment.

## I. If compilation fails

If the emulator refuses to start, or errors immediately upon loading `../firestore.rules`, this means the rules file itself did not compile — a different, more fundamental problem than any individual test failing. **Stop immediately.** Capture the exact compiler error message the emulator prints (it will typically name the exact line/construct that failed) and report:

```
RULE COMPILATION = FAILED
<exact error text>
```

Do not interpret this as a test failure, and do not attempt to edit `firestore.rules` to fix it yourself — report it back for a separately authorized fix phase, exactly like any other failure.

## J. No production Firestore

**This harness must never connect to, read from, or write to the real `classmate-302c2` Firestore project, or any other real project.** Every test uses `initializeTestEnvironment()` against a local emulator only, with a synthetic project ID (`classmate-rules-verification`/`classmate-studententries-rules-verification`) that doesn't correspond to any real, deployed project. No real classroom IDs, student IDs, or UIDs appear anywhere in either test file — confirmed by direct inspection of both.

## K. No production files should be modified

**Running this harness — installing its own dependencies, starting the emulator, running the tests — must never modify anything outside this directory.** `../firestore.rules` is only ever *read* (`readFileSync`), never written. If any test fails, the correct response is to report it, not to edit `firestore.rules`, any application source file, or the application's own `package.json`/dependency structure to "make it pass."

## Cleanup

`Ctrl+C` the emulator process (or close its window, on Windows) when done, or let `run-verification.sh`'s own cleanup trap do it for you. No persistent state is created outside the emulator's own in-memory instance; nothing here touches a real Firestore project, ever.
