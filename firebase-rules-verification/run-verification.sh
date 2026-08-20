#!/usr/bin/env bash
#
# firebase-rules-verification/run-verification.sh
#
# PHASE 3.4 — one simple, self-contained script for an operator on a
# machine with real network access to run. Does exactly what this
# directory's own README.md documents by hand, in one command, so
# there's no chance of a step being skipped or mistyped.
#
# Requires: Node.js 18+, Java 11+, npm, network access to
# registry.npmjs.org and Firebase's own infrastructure. See README.md
# for the full requirements list.
#
# Deliberately does NOT touch the main ClassMate application at all —
# every command below runs with this directory as its own working
# directory, against its own package.json, never the application's.
#
# This script itself always `cd`s to its own directory first (see
# SCRIPT_DIR below), so it works correctly regardless of where you
# were sitting in your shell when you ran it — including the mistake
# an earlier verification attempt made (running `cd firebase-rules-
# verification` a second time while already inside that directory).
#
# PHASE 3.5 FIX — firebase.json in this directory no longer references
# ../firestore.rules at all; that entry was what caused Firebase CLI's
# own project-directory validation to reject it
# ("Error: ../firestore.rules is outside of project directory"). See
# README.md's own §D for the full explanation of why removing it loses
# nothing the tests actually depend on.
#
# Usage:
#   cd firebase-rules-verification
#   ./run-verification.sh
#
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

OVERALL_EXIT=0
EMULATOR_PID=""

cleanup() {
  if [ -n "$EMULATOR_PID" ] && kill -0 "$EMULATOR_PID" 2>/dev/null; then
    echo ""
    echo "Stopping the Firestore emulator (pid $EMULATOR_PID)..."
    kill "$EMULATOR_PID" 2>/dev/null
    wait "$EMULATOR_PID" 2>/dev/null
  fi
}
trap cleanup EXIT

echo "=== 1. Installing dependencies (isolated to this directory only) ==="
npm install || { echo "npm install failed — see output above."; exit 1; }

if ! command -v firebase >/dev/null 2>&1; then
  echo ""
  echo "firebase-tools CLI not found on PATH. Install it globally first:"
  echo "  npm install -g firebase-tools"
  echo "or run this script's remaining steps manually via npx firebase-tools."
  exit 1
fi

echo ""
echo "=== 2. Starting the Firestore emulator (reads the real ../firestore.rules) ==="
firebase emulators:start --only firestore --project classmate-rules-verification &
EMULATOR_PID=$!

# Give the emulator a moment to actually start listening before the
# test files try to connect — a fixed, generous wait rather than a
# fragile port-polling loop, since this script only needs to work
# reliably once per verification run, not repeatedly or quickly.
echo "Waiting for the emulator to become ready..."
sleep 8

echo ""
echo "=== 3. Running membershipLinks.rules.verify.js (13 tests) ==="
node --test membershipLinks.rules.verify.js
MEMBERSHIP_EXIT=$?
[ "$MEMBERSHIP_EXIT" -ne 0 ] && OVERALL_EXIT=1

echo ""
echo "=== 4. Running studentEntries.rules.verify.js (23 tests) ==="
node --test studentEntries.rules.verify.js
STUDENT_ENTRY_EXIT=$?
[ "$STUDENT_ENTRY_EXIT" -ne 0 ] && OVERALL_EXIT=1

echo ""
echo "=== Summary ==="
echo "membershipLinks.rules.verify.js exit code: $MEMBERSHIP_EXIT"
echo "studentEntries.rules.verify.js exit code:  $STUDENT_ENTRY_EXIT"
echo "Overall exit code: $OVERALL_EXIT"
echo ""
echo "Remember: Test 3 (membershipLinks) and Test 22 (studentEntries) are"
echo "deliberately unasserted — they report their own actual result via"
echo "console.log above, and never cause a non-zero exit on their own."
echo ""
echo "The emulator will now be stopped (see cleanup trap above)."

exit $OVERALL_EXIT
