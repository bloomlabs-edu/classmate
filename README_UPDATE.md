-----------------------------------
Feature:
Learning Record – Phase 2 (Teacher Workflow)

This package also includes Phase 1 (models/services/persistence) since
it was approved but never actually delivered as files — only described
in chat. Phase 2 depends on it directly, so both are included here as
one complete, working update. Nothing in this package requires any
file outside what's listed below.

-----------------------------------
Files Added

Phase 1 — architecture:
- js/config/learningRecordConfig.js
- js/models/LearningConcept.js
- js/models/LearningUnit.js
- js/models/LearningSubject.js
- js/models/StudentConceptRecord.js

Phase 2 — teacher UI:
- js/ui/views/LearningRecordView.js

Docs:
- docs/LEARNING_RECORD.md

-----------------------------------
Files Modified

- js/models/Student.js
    Added `learningRecord` field (per-student understanding/notebook/
    helpRequested, keyed by concept id).
- js/models/Classroom.js
    Added `learningRecord` field ({ subjects: [] } — the syllabus tree).
- js/ui/router.js
    Added the route:
    #/classroom/{id}/learning-record/{subjectId?}/{unitId?}
- js/main.js
    Imported LearningRecordView, added its route dispatch, and added
    onOpenLearningRecord wiring for the Dashboard.
- js/ui/views/DashboardView.js
    Added a "Learning Record" shortcut to the Teaching section.
    Restructured that section so it always renders once a classroom
    has students, instead of only when Notebook Tracker subjects are
    configured (Learning Record is independent of Notebook Tracker —
    see docs/LEARNING_RECORD.md for why gating it the old way would
    have been wrong).
- css/styles.css
    Added styling for the taught/not-taught toggle button.
- CHANGELOG.md
    Added the full entry for this work, in the project's own existing
    changelog format/voice.

-----------------------------------
Files Deleted

- (none)

-----------------------------------
What changed

Teachers can now build a syllabus and track what's been taught:

- New "Learning Record" entry point on the classroom Dashboard.
- Create Subjects (e.g. Science, Maths, English, Social Science).
- Within a Subject, create Units (e.g. Force and Pressure).
- Within a Unit, create Concepts (e.g. Force, Pressure, Friction,
  Viscosity).
- Rename or delete a Subject, Unit, or Concept at any time. Deleting a
  Subject deletes its Units and Concepts too; deleting a Unit deletes
  its Concepts too (both ask for confirmation first).
- Mark any Concept "Taught" or "Not Taught" with one tap — the Unit
  screen shows a running "X of Y taught" count.

Explicitly NOT included in this phase (by design, per the brief):
- No student-facing screens of any kind.
- No Learning Hub integration or references.
- No analytics/reporting beyond the plain taught-count already shown.
- No per-student notebook-status control yet (the model/service
  support it — see learningRecordTeacherService.js's setNotebookStatus
  — there's just no UI for it yet).

-----------------------------------
What to test

□ Create Subject
□ Create Unit (inside a Subject)
□ Create Concept (inside a Unit)
□ Mark Concept as Taught
□ Mark Concept back to Not Taught
□ Rename a Subject / Unit / Concept
□ Delete a Concept
□ Delete a Unit (confirm its Concepts are removed too)
□ Delete a Subject (confirm its Units and Concepts are removed too)
□ "Learning Record" shortcut appears on the Dashboard for a classroom
  with students, both before and after Notebook Tracker subjects are
  configured
□ Back navigation at each level (Concepts → Unit's parent Subject →
  Subject list → Dashboard) lands in the right place
□ Refreshing the browser on a deep link
  (#/classroom/{id}/learning-record/{subjectId}/{unitId}) loads the
  right screen directly

-----------------------------------
Known limitations

- Not live-tested in a real browser. This environment has no network/
  browser access, so verification here was code-level only: every file
  passed a syntax check, every new import path was individually
  resolved against the real project tree (not just trusted on sight),
  and every service function the new view calls was cross-checked
  against that service's actual exports. A real click-through in the
  browser has not been done yet and should happen before relying on
  this in front of a class.
- No Timeline logging yet for taught-status changes — deferred
  intentionally until the UI shape for bulk vs. one-at-a-time marking
  is decided (see learningRecordTeacherService.js's doc comment).
- No notebook-status UI yet (see "What changed" above) — the
  service-layer support already exists, waiting on a future phase.
- The Dashboard's Teaching section now always appears once a classroom
  has students (previously it was hidden until Notebook Tracker
  subjects existed). This is a deliberate, documented change, not a
  bug — see "Files Modified" above — but it is a visible behavior
  change worth knowing about.
-----------------------------------
