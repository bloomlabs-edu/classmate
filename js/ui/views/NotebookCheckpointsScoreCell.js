/**
 * ui/views/NotebookCheckpointsScoreCell.js
 *
 * The pure, DOM-free half of the Notebook Checkpoints grid's Score
 * column — deliberately its own standalone module with zero imports
 * (same convention as ui/components/TimePickerState.js), so
 * tests/ui/notebookCheckpointsScoreCell.test.js can import it directly
 * without pulling in ui/views/NotebookCheckpointsView.js's own heavy
 * dependency chain (workspaceService.js, Firestore, etc.), which would
 * fail to import at all outside a browser.
 *
 * Always reads the LIVE `student.score` field directly (the same
 * field every other scoring surface in this app reads — see
 * services/timelineService.js's own header comment: "score is a
 * derived cache kept in sync with this log"), never counted/derived
 * from the checkpoint grid's own green cells. This is deliberate: a
 * student's score reflects every ClassMate system that awards points
 * (stars, badges, other checkpoints, etc.), not just one Notebook —
 * counting green cells here would silently show a different, wrong
 * number the moment any other system touched this same student's
 * score.
 *
 * `icon`/`number` mirror ui/components/StudentStandingsBoard.js's own
 * existing `${entry.score} ⭐` convention (same glyph, same being the
 * one place in this app a score already renders next to a star) —
 * reordered icon-then-number per this feature's own explicit design
 * direction, not a new visual language. `ariaLabel` is always a full,
 * student-named sentence per explicit accessibility direction — never
 * relying on the icon/number alone.
 */
export function getScoreCellDisplay(student) {
  return {
    icon: '⭐',
    number: String(student.score),
    ariaLabel: `${student.name} score: ${student.score}`,
  };
}
