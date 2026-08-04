/**
 * services/goalCompletionService.js
 *
 * Daily goal completion — "did the student tick this goal done
 * today." Mirrors notebookService.js's own setEntry()/
 * getStudentHistory() shape directly: a plain nested register, one
 * function to write a day's entry, one to read a chronological
 * history back out.
 *
 * Storage: `cycle.completions[goalId][dateKey] = true`. Presence
 * means completed; a day never entered, or explicitly unticked
 * (deleted), means not completed — no `false` value is ever stored,
 * since "not completed" and "never asked" are the same thing for a
 * goal (unlike NotebookSubmission's own `not_submitted` vs.
 * `submitted`-with-incomplete-work distinction, which genuinely needs
 * two independent axes). This keeps every history read a simple
 * "which dateKeys exist" question — exactly what
 * goalStatisticsService.js's streak/completion math needs and nothing
 * more.
 *
 * `cycle.completions` and `cycle.completions[goalId]` are both
 * defaulted here, not assumed present — the same defensive pattern
 * used throughout this app for any nested register (see
 * notebookService.js's own setEntry()).
 */

export function isCompletedOn(cycle, goalId, dateKey) {
  return Boolean(cycle.completions[goalId]?.[dateKey]);
}

/**
 * Sets or clears one day's completion for one goal. `completed:
 * false` deletes the entry entirely (see this file's own header
 * comment for why "not completed" has no stored value at all) —
 * matching the explicit "students should also be able to untick
 * before the day ends" requirement.
 */
export function setCompletion(cycle, goalId, dateKey, completed) {
  if (!cycle.completions) cycle.completions = {};
  if (!cycle.completions[goalId]) cycle.completions[goalId] = {};

  if (completed) {
    cycle.completions[goalId][dateKey] = true;
  } else {
    delete cycle.completions[goalId][dateKey];
  }
}

/** Every date this goal has been marked complete, sorted chronologically (oldest first) — the same "sorted history, oldest first" shape studentProgressService.js's own streak math already expects. */
export function getCompletionHistory(cycle, goalId) {
  const entries = cycle.completions?.[goalId] || {};
  return Object.keys(entries).sort();
}
