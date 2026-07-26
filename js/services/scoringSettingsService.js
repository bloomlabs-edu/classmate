/**
 * services/scoringSettingsService.js
 *
 * Reads and updates a classroom's point-scoring settings (default point
 * value, whether negative points are allowed). Not wired to the actual
 * scoring system yet (that's a future milestone), but the settings a
 * teacher configures here are ready for it to read once it exists.
 */

export function getScoringSettings(classroom) {
  return classroom.settings.scoring;
}

export function updateScoringSettings(classroom, updates) {
  Object.assign(classroom.settings.scoring, updates);
  return classroom.settings.scoring;
}
