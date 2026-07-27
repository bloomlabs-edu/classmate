-----------------------------------
Feature:
Learning Record – Phase 2 (Teacher Workflow) — Routing Fix

This supersedes both previous deliveries. This one fixes a real bug
that the previous round's testing didn't catch because it tested each
file in isolation rather than the actual click path through main.js.
Apply the same way: extract, copy everything, paste into your project
root, allow replace.

-----------------------------------
THE ACTUAL BUG THIS TIME

`main.js` keeps an explicit allow-list, `CLASSROOM_ROUTE_NAMES`, that
every classroom-scoped route must appear in before its dispatch logic
ever runs. `'learningRecord'` was missing from that list. The route
parsed correctly, the button existed and called the right callback,
and a matching dispatch branch for it genuinely existed further down
in the same function — but because the route name wasn't on the
allow-list, that whole block was skipped and execution fell through to
the Home/Welcome screen instead. This is why it looked like nothing
was wired at all, even though most of it actually was.

Fixed with one line: `'learningRecord'` added to `CLASSROOM_ROUTE_NAMES`
in `js/main.js`.

-----------------------------------
HOW THIS WAS VERIFIED THIS TIME (read this if you don't trust it yet)

Previous rounds tested `router.js`'s parsing, `DashboardView.js`'s
rendering, and `LearningRecordView.js`'s CRUD logic — each in
isolation, each genuinely passing. That's exactly why this bug slipped
through: none of those tests exercised `main.js`'s own dispatch logic,
which is where the actual break was.

This time: built a test-only transformation of the real `main.js`
source (never modifying the file you're receiving) that exposes its
internal `renderRoute()` function for direct testing, registered a
real classroom, and then, against the real, complete code:

1. Rendered the real Dashboard.
2. Found the real "Learning Record" button in the resulting output and
   called `.click()` on it (not a simulated click — the actual DOM
   event handler `main.js` wires up).
3. Confirmed the click set the URL to
   `/classroom/{id}/learning-record`.
4. Re-ran `renderRoute()` (simulating the re-render the real router
   fires on a hash change) and confirmed `LearningRecordView` actually
   mounted. Before the fix, this exact step failed and produced the
   Home/Welcome screen instead — reproducing the report exactly.
5. Repeated the same full path starting from the zero-student
   pre-roster screen.
6. Additionally tested a direct deep-link straight to a Concept level
   (as if refreshing a bookmarked URL) and the Back button from there
   — both correct.

All six now pass against the real application code.

-----------------------------------
WHERE TO FIND THE FEATURE (unchanged from last time)

  - Classroom with NO students yet: "Build Your Learning Record →"
    button below the Add Students card.
  - Classroom WITH students: "Learning Record" chip in the Dashboard's
    Teaching section.

Either one now actually opens the feature.

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
- js/ui/views/DashboardView.js
- css/styles.css

Changed again in THIS delivery (the actual fix):
- js/main.js
    Added 'learningRecord' to CLASSROOM_ROUTE_NAMES. This is the one
    change in this package that matters.
- CHANGELOG.md
    Added the entry documenting this root cause and how it was found.

-----------------------------------
Files Deleted

- (none)

-----------------------------------
What changed

One line in `js/main.js`. See "THE ACTUAL BUG THIS TIME" above.

-----------------------------------
What to test

□ Classroom with ZERO students → "Build Your Learning Record →" opens
  the feature (not the Home/Welcome screen)
□ Classroom WITH students → "Learning Record" chip opens the feature
□ Create Subject / Unit / Concept
□ Mark Concept Taught / Not Taught
□ Rename at each level
□ Delete at each level (confirm cascade delete for Unit/Subject)
□ Refresh the browser on a deep link
  (#/classroom/{id}/learning-record/{subjectId}/{unitId}) — should
  load directly to that Concepts screen, not redirect anywhere
□ Back navigation at each level

-----------------------------------
Known limitations

- Still not clicked through in an actual browser — this environment
  has no network access at all. What's different this round: rather
  than trusting isolated per-file tests (which is exactly how this bug
  got missed once already), the fix was verified by executing the real
  main.js's actual routing function end-to-end, reproducing the
  reported failure first, then confirming the fix resolves it. That's
  meaningfully stronger evidence than before, but it is still
  JS-execution-under-Node, not a browser.
- No Timeline logging yet for taught-status changes (unchanged).
- No notebook-status UI yet (unchanged — service-layer support
  exists, no screen for it yet).
-----------------------------------
