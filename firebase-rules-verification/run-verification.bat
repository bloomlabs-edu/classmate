@echo off
REM firebase-rules-verification/run-verification.bat
REM
REM PHASE 3.4 — Windows equivalent of run-verification.sh. See that
REM file's own header comment for the full reasoning; this does
REM exactly the same five steps.
REM
REM Requires: Node.js 18+, Java 11+, npm, firebase-tools installed
REM globally, network access to Firebase/npm infrastructure.
REM
REM This script always changes to its own directory first (cd /d
REM "%~dp0"), so it works correctly regardless of where your shell
REM was sitting when you ran it.
REM
REM PHASE 3.5 FIX — firebase.json in this directory no longer
REM references ..\firestore.rules at all; that entry caused Firebase
REM CLI's own project-directory validation to reject it. See
REM README.md's own section D for the full explanation.
REM
REM Usage:
REM   cd firebase-rules-verification
REM   run-verification.bat

cd /d "%~dp0"

echo === 1. Installing dependencies (isolated to this directory only) ===
call npm install
if errorlevel 1 (
  echo npm install failed - see output above.
  exit /b 1
)

where firebase >nul 2>nul
if errorlevel 1 (
  echo firebase-tools CLI not found on PATH. Install it globally first:
  echo   npm install -g firebase-tools
  exit /b 1
)

echo.
echo === 2. Starting the Firestore emulator (reads the real ..\firestore.rules) ===
start "firestore-emulator" /min cmd /c "firebase emulators:start --only firestore --project classmate-rules-verification"

echo Waiting for the emulator to become ready...
timeout /t 8 /nobreak >nul

echo.
echo === 3. Running membershipLinks.rules.verify.js (13 tests) ===
call node --test membershipLinks.rules.verify.js
set MEMBERSHIP_EXIT=%ERRORLEVEL%

echo.
echo === 4. Running studentEntries.rules.verify.js (23 tests) ===
call node --test studentEntries.rules.verify.js
set STUDENT_ENTRY_EXIT=%ERRORLEVEL%

echo.
echo === Summary ===
echo membershipLinks.rules.verify.js exit code: %MEMBERSHIP_EXIT%
echo studentEntries.rules.verify.js exit code:  %STUDENT_ENTRY_EXIT%
echo.
echo Remember: Test 3 (membershipLinks) and Test 22 (studentEntries) are
echo deliberately unasserted - they report their own actual result via
echo console.log above, and never cause a non-zero exit on their own.
echo.
echo Stop the emulator manually (close its minimized window) when done -
echo unlike the .sh version, this script cannot reliably auto-kill a
echo separately-started background process on Windows.

if not "%MEMBERSHIP_EXIT%"=="0" exit /b 1
if not "%STUDENT_ENTRY_EXIT%"=="0" exit /b 1
exit /b 0
