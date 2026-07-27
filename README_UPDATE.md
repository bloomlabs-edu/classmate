-----------------------------------
Feature:
Learning Record – Phase 2 REVISED: "+ Add Lesson" as a First-Class Action

This supersedes all previous Learning Record deliveries. Apply the
same way: extract, copy everything, paste into your project root,
allow replace.

-----------------------------------
WHERE TO FIND THE FEATURE NOW

Open any classroom. You will see a **"+ Add Lesson"** button, always,
in one of two places depending on classroom state:

  - Classroom with students: on the right side of the "Continue
    Working" card's header (top area of the Dashboard).
  - Classroom with zero students yet: same "+ Add Lesson" button,
    directly below the "Add Students" welcome card.

Click it. It opens the Learning Record screen immediately — Subjects
list, with Add/Rename/Delete, drilling into Units, then Concepts, with
the Taught/Not Taught toggle.

-----------------------------------
Files Added

(Unchanged from previous deliveries)
- js/config/learningRecordConfig.js
- js/models/LearningConcept.js
- js/models/LearningUnit.js
- js/models/LearningSubject.js
- js/models/StudentConceptRecord.js
- js/ui/views/LearningRecordView.js
- docs/LEARNING_RECORD.md

-----------------------------------
Files Modified

Unchanged from previous deliveries:
- js/models/Student.js
- js/models/Classroom.js
- js/ui/router.js
- js/main.js

Changed in THIS delivery:
- js/ui/components/ContinueWorkingWidget.js
    Added a header row (heading left, "+ Add Lesson" primary button
    right) — the same header-row pattern already used by Recognition
    Wall's "View All" button.
- js/ui/views/DashboardView.js
    Wired the new button through to Learning Record on both the
    normal Dashboard and the zero-student welcome screen (relabeled
    from "Build Your Learning Record →" to "+ Add Lesson" for
    consistency). Also fixes a real bug — see "A Second Bug Found"
    below.
- css/styles.css
    Header-row wrap safety on narrow widths, button spacing.
- CHANGELOG.md
    New entry for this round.

-----------------------------------
Files Deleted

- (none)

-----------------------------------
What changed

Learning Record is no longer nested inside a conditional Dashboard
section. "+ Add Lesson" is now a primary, always-visible button, in
the Continue Working card for a classroom with students, and on the
welcome screen for a classroom with none.

A SECOND BUG FOUND AND FIXED while re-verifying this: the function
that fills in the Continue Working card had its own early return —
`if (resolvedEntries.length === 0) return;` — meaning the entire card,
and therefore the button now living inside it, would never render at
all for any teacher who has never opened a notebook yet. That's
probably the single most common state for a real or newly-created
classroom, and exactly the condition most likely to be hit on first
test. Fixed by removing that early return; the card always renders
now, falling back to its existing "Notebooks you open will show up
here" empty message when there's nothing else to show.

The old "Learning Record" chip in the Dashboard's Teaching section
(from the previous delivery) was left in place, not removed — it
isn't asked to be removed, and having a second working entry point is
extra discoverability, not a conflict. Worth deciding later whether to
remove it now that "+ Add Lesson" is the primary path.

-----------------------------------
What to test

□ Open a classroom with ZERO students, ZERO recent notebooks —
  confirm "+ Add Lesson" is visible (this exact combination is what
  the second bug hid)
□ Open a classroom WITH students, ZERO recent notebooks — confirm
  "+ Add Lesson" is visible in the Continue Working card
□ Open a classroom WITH students AND at least one recently-opened
  notebook — confirm "+ Add Lesson" still appears alongside the
  notebook chips, not replaced by them
□ Click "+ Add Lesson" from each of the above — confirm it opens
  Learning Record every time, never a blank/placeholder/dead screen
□ Create Subject / Unit / Concept
□ Mark Concept Taught / Not Taught
□ Rename and Delete at each level (confirm cascade delete for
  Unit/Subject)
□ Refresh the browser on a deep link
  (#/classroom/{id}/learning-record/{subjectId}/{unitId}) — loads
  directly, no redirect

-----------------------------------
Known limitations

- Still verified by executing the real, unmodified application code
  under Node (no browser available in this environment at all,
  including no way to install one) rather than a live browser
  click-through. This round specifically: rendered the real Dashboard
  for a zero-student classroom and a has-students-zero-notebooks
  classroom, found the real "+ Add Lesson" button in both, clicked it,
  and confirmed Learning Record actually opened in both cases — this
  is exactly the scenario the second bug broke, and it's now confirmed
  fixed against the actual code, not just re-read. Also re-ran the
  full Learning Record CRUD script as a regression check. A real
  browser click-through is still the one thing that hasn't happened
  and should before relying on this in front of a class.
- No Timeline logging yet for taught-status changes (unchanged).
- No notebook-status UI yet (unchanged — service-layer support
  exists, no screen for it yet).
- The older Teaching-section "Learning Record" chip still exists
  alongside the new button (see "What changed" above) — not a bug,
  just an open product question about whether to remove it.
-----------------------------------
