/**
 * ui/views/NotebookStudentRowDisplay.js
 *
 * The pure half of the Notebook Checkpoints grid's student row redesign
 * — deliberately its own standalone module (same convention as
 * ui/views/NotebookCheckpointsScoreCell.js's own header comment), so
 * tests can import these calculations directly without pulling in
 * ui/views/NotebookCheckpointsView.js's own heavy dependency chain
 * (workspaceService.js, Firestore, etc.), which fails to import at all
 * outside a browser. services/checkpointService.js itself has no such
 * dependency (plain models + notebookConfigService only), so importing
 * it here directly — rather than taking it as an injected parameter —
 * keeps this file just as test-friendly while avoiding a second,
 * parallel copy of getRecordForStudent()'s own lookup logic.
 */

import { getRecordForStudent } from '../../services/checkpointService.js';

/**
 * `icon`/`number` mirror NotebookCheckpointsScoreCell.js's own
 * getScoreCellDisplay() exactly (same `student.score` field, same
 * icon-then-number order) — `suffix` is additive, for this row's own
 * "⭐ 24 pts" treatment; the Score column itself is unaffected since it
 * calls that other function, not this one.
 */
export function getScoreDisplay(student) {
  return {
    icon: '⭐',
    number: String(student.score),
    suffix: 'pts',
    ariaLabel: `${student.name} has ${student.score} recognition points`,
  };
}

/**
 * One student's progress across the checkpoints of THIS Notebook only
 * (the set already loaded for the current grid) — not a cross-notebook
 * aggregate; see checkpointService.getCheckpointsForStudentAcrossNotebooks()
 * for that different, existing use case (the Student Portal's own view).
 *
 * `completedCount` counts reviewStatus === 'complete' only — the one
 * state that means "fully done," matching getCellMeta()'s own green
 * chip in ui/views/NotebookCheckpointsView.js. Every other real state
 * (not submitted, submitted-but-not-reviewed, submitted-incomplete)
 * counts toward `pendingCount` — matching the "X pending" wording's own
 * plain, non-technical meaning, not narrowly "awaiting review" alone.
 */
export function getProgressSummary(checkpoints, studentId) {
  const totalCount = checkpoints.length;
  let completedCount = 0;
  checkpoints.forEach((checkpoint) => {
    const record = getRecordForStudent(checkpoint, studentId);
    if (record && record.reviewStatus === 'complete') completedCount += 1;
  });
  const pendingCount = totalCount - completedCount;
  const percentComplete = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  return { completedCount, totalCount, pendingCount, percentComplete };
}
