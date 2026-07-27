-----------------------------------
Feature:
Learning Record – Phase 2 (Teacher Workflow) — Integration Fix

This is a corrected re-delivery. The previous ZIP contained the actual
feature but it had no working entry point on a classroom with zero
students — see "What changed" below for the root cause. This package
supersedes the previous one entirely; apply it the same way (extract,
copy everything, paste into your project root, allow replace).

-----------------------------------
WHERE TO FIND THE FEATURE AFTER APPLYING THIS UPDATE

Open any classroom, then:

  - If the classroom has NO students yet:
      You'll see the normal "Welcome to [Classroom Name]" screen.
      Directly below the "Add Students" card, there is now a button:
          "Build Your Learning Record →"
      Click it.

  - If the classroom already has students:
      Scroll down the Dashboard to the "Teaching" section (same area
      as the existing "Activities" shortcut). You'll see a chip/button
      labeled:
          "Learning Record"
      Click it.

Either path takes you to the same screen: Subjects list → tap "Open
Units" on a subject → Units list → tap "Open Concepts" on a unit →
Concepts list with Add/Rename/Delete and the Taught/Not Taught toggle.

Direct URL (once you know a classroom's id), if you'd rather type it:
  #/classroom/{classroomId}/learning-record

-----------------------------------
Files Added

Phase 1 — architecture (unchanged from previous delivery):
- js/config/learningRecordConfig.js
- js/models/LearningConcept.js
- js/models/LearningUnit.js
- js/models/LearningSubject.js
- js/models/StudentConceptRecord.js

Phase 2 — teacher UI (unchanged from previous delivery):
- js/ui/views/LearningRecordView.js

Docs:
- docs/LEARNING_RECORD.md

-----------------------------------
Files Modified

Unchanged from the previous delivery:
- js/models/Student.js
- js/models/Classroom.js
- js/ui/router.js
- js/main.js

Changed again in THIS delivery (the actual fix):
- js/ui/views/DashboardView.js
    The zero-student ("pre-roster") welcome screen now also renders
    the Learning Record entry point. Previously the entry point only
    existed in the post-roster Dashboard, which never renders at all
    for a classroom with no students yet — see "What changed" below.
- css/styles.css
    Small spacing addition for the new pre-roster link.
- CHANGELOG.md
    Added a new entry documenting the bug and the fix, and reordered
    the previous entry to its correct chronological position (it had
    been inserted mid-file rather than appended at the end).

-----------------------------------
Files Deleted

- (none)

-----------------------------------
What changed

Root cause of "no visible entry anywhere": `DashboardView.js` replaces
its ENTIRE contents with a minimal welcome screen for any classroom
with zero students — by design, since every other Dashboard feature
(Start Class Mode, Recognition, Groups, Notebook Tracker) genuinely
needs a roster to do anything useful. Learning Record was wired into
the *normal* (post-roster) Dashboard only, so on a brand-new or still-
empty classroom — the most likely first thing to test — it had no
entry point at all.

Fix: the pre-roster welcome screen now also shows a "Build Your
Learning Record →" link, since syllabus-building doesn't require any
students to exist. The post-roster entry point from before is
unchanged and still there once a classroom has a roster.

-----------------------------------
What to test

□ Open a classroom with ZERO students — confirm "Build Your Learning
  Record →" appears below the Add Students card
□ Open a classroom WITH students — confirm "Learning Record" appears
  in the Teaching section
□ Create Subject
□ Create Unit (inside a Subject)
□ Create Concept (inside a Unit)
□ Mark Concept as Taught
□ Mark Concept back to Not Taught
□ Rename a Subject / Unit / Concept
□ Delete a Concept
□ Delete a Unit (confirm its Concepts are removed too)
□ Delete a Subject (confirm its Units and Concepts are removed too)
□ Back navigation at each level lands in the right place
□ Refreshing the browser on a deep link
  (#/classroom/{id}/learning-record/{subjectId}/{unitId}) loads the
  right screen directly

-----------------------------------
Known limitations

- Still not tested in an actual browser — this environment has no
  network access at all, including to install any browser-testing
  tool. What changed this round: rather than relying on reading the
  code (which is exactly how the previous miss happened), the actual,
  unmodified project files were executed under Node this time, using a
  minimal hand-built DOM shim and a loader that stubs only the three
  Firebase CDN imports (nothing about this project's own code was
  faked). Against that real execution: the router correctly resolved
  all Learning Record URLs, the real Dashboard produced a working,
  clickable "Learning Record" entry in both the zero-student and
  has-students cases, and a full scripted run through the real
  LearningRecordView.js — add Subject, rename it, add a Unit, add 4
  Concepts, mark one Taught, toggle it back, delete a Concept, delete
  the Unit (confirmed its concepts were removed too), delete the
  Subject — passed all 11 steps against real data. This is stronger
  evidence than a code read, but it is still not the same as clicking
  through it in an actual browser, which should still happen before
  relying on this in front of a class.
- No Timeline logging yet for taught-status changes (unchanged from
  previous delivery — see learningRecordTeacherService.js).
- No notebook-status UI yet (unchanged from previous delivery — the
  service-layer support exists, no screen for it yet).
-----------------------------------
