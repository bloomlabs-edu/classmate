-----------------------------------
Feature:
Learning Record — Rebuilt as a Self-Contained "📚 Manage Lessons" Action

This DISCARDS all previous Learning Record UI integration attempts
(the routed screen, the Dashboard chip, the "+ Add Lesson" button) and
replaces them entirely, per explicit direction. Apply the same way:
extract, copy everything, paste into your project root, allow
replace.

-----------------------------------
CHECKLIST — RUN BEFORE THIS WAS PACKAGED (all confirmed passing
against the real, executed application code before this ZIP was
created — see "How this was verified" below)

☑ I can see the Manage Lessons button.
☑ Clicking it opens the Learning Record page.
☑ I can create a Subject.
☑ I can create a Unit.
☑ I can create a Lesson.
☑ I can toggle Taught / Not Taught.

-----------------------------------
WHERE TO FIND THE FEATURE

Open any classroom. You will immediately see a large blue button:

    📚 Manage Lessons

  - Classroom with students: at the very top of the "Continue
    Working" card — above its own heading, not tucked into a header
    row.
  - Classroom with zero students yet: same button, same label,
    directly below the "Add Students" welcome card.

Click it. It replaces the screen with "Learning Record" — Science,
Maths, English, and Social Science are already there, each with a
"+ Add Unit" button. No routing involved: this is a direct function
call, not a URL.

-----------------------------------
Files Added

(Unchanged from previous deliveries — Phase 1 architecture)
- js/config/learningRecordConfig.js
- js/models/LearningConcept.js
- js/models/LearningUnit.js
- js/models/LearningSubject.js
- js/models/StudentConceptRecord.js
- docs/LEARNING_RECORD.md

-----------------------------------
Files Modified

Unchanged from previous deliveries:
- js/models/Student.js
- js/models/Classroom.js
- js/services/learningRecordService.js
- js/services/learningRecordTeacherService.js
- js/services/learningRecordStudentService.js

Changed in THIS delivery (the full rebuild):
- js/ui/views/LearningRecordView.js
    Fully rewritten. No router, no URL, no route params anywhere in
    this file. Manages its own Subject/Unit navigation as local
    variables and re-renders itself directly. Seeds Science / Maths /
    English / Social Science automatically the first time a
    classroom's Learning Record is opened with nothing in it yet.
    Stripped down to exactly Subject/Unit/Lesson CRUD + the Taught
    toggle — no counts, no percentages, nothing else.
- js/ui/views/DashboardView.js
    Calls LearningRecordView directly via a local closure — no prop
    threaded through main.js. Old "Learning Record" Teaching-section
    chip removed entirely. New button wired on both the normal
    Dashboard and the zero-student welcome screen.
- js/ui/components/ContinueWorkingWidget.js
    New "📚 Manage Lessons" button — large, blue, first element in the
    card, above the heading.
- js/main.js
    All Learning Record routing removed: deleted from
    CLASSROOM_ROUTE_NAMES, deleted its dispatch block, deleted the now
    -unused import.
- js/ui/router.js
    Deleted the learning-record URL parsing branch. A stale bookmark
    to the old URL now falls through to the Dashboard instead of
    erroring.
- css/styles.css
    New button styling; new, fully self-contained styles for the
    rewritten view (does not reuse Settings'/Setup Wizard's shared
    classes, so this screen can't be silently affected by unrelated
    future changes there).
- CHANGELOG.md
    New entry for this rebuild.

-----------------------------------
Files Deleted

- (none — old code paths were removed in-place, not left as separate
  files)

-----------------------------------
What changed

Previous integration attempts relied on the app's router — twice, a
small wiring gap in that router/dispatch layer made the feature
unreachable even though everything else about it worked. Per explicit
direction, this is now a completely different, simpler architecture:
one button, calling one function, that renders directly into the
Dashboard's own container and hands back a single `onClose` callback
to return. There is no URL for this feature anymore, and nothing that
depends on a route name being registered in more than one place.

-----------------------------------
What to test

□ Open a classroom with students — "📚 Manage Lessons" appears at the
  top of the Continue Working card immediately, no scrolling
□ Open a classroom with zero students — same button appears below the
  Add Students card
□ Click it — Learning Record opens, showing Science / Maths / English
  / Social Science already listed
□ Create a new Subject
□ Click "+ Add Unit" on a subject — create a Unit
□ Click "+ Add Lesson" on a unit — create a Lesson
□ Toggle a Lesson between "○ Not Taught" and "✓ Taught"
□ Rename a Subject / Unit / Lesson
□ Delete a Subject / Unit / Lesson (confirm cascade delete)
□ Click "Back to Dashboard" — returns to the Dashboard, Manage Lessons
  button still there
□ Confirm the OLD #/classroom/{id}/learning-record bookmark (if you
  had one saved) now just opens the Dashboard instead of erroring

-----------------------------------
How this was verified

No browser or network access exists in this environment at all — so,
as with the last two deliveries, verification means actually executing
the real, unmodified application code under Node (not re-reading it),
using a test-only transformation of main.js that exposes its internal
routing function without changing the file you're receiving. This
round, ran the exact 6-item checklist you specified, end to end,
against a classroom with students and zero recent notebooks (the exact
condition that broke this twice before) — plus two additional checks:
that returning via "Back to Dashboard" leaves the Manage Lessons button
still present, and that the same button-and-click sequence also works
from the zero-student welcome screen. All 8 checks passed against the
real code before this ZIP was created.

What this environment still cannot do is click through it in an actual
browser — that's the one remaining gap, same as every previous
delivery.

-----------------------------------
Known limitations

- No Timeline logging for taught-status changes (unchanged from
  Phase 1).
- No notebook-status UI (unchanged — service-layer support exists, no
  screen for it yet).
- No student-facing UI, no Learning Hub integration, no analytics —
  all deliberately excluded per instruction.
-----------------------------------
