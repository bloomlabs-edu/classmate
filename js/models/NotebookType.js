/**
 * models/NotebookType.js
 *
 * A notebook type within a subject (e.g. "Classwork", "Handwriting") —
 * see services/notebookConfigService.js. Stored as an array on
 * classroom.notebookConfig.notebookTypes, referencing its subject by id
 * rather than nesting inside it, so renaming a subject never requires
 * walking into every notebook type.
 *
 * `trackingMode` — 'checkpoint' | 'daily'. Reusable across any notebook
 * type (never a Handwriting-specific special case):
 *   - 'checkpoint' (the original, only behavior before this field
 *     existed): named checkpoints/units, tracked via
 *     services/checkpointService.js. This is the default — any
 *     notebook type created, or already persisted, before this field
 *     existed has no `trackingMode` at all, and must keep behaving
 *     exactly as before. Every reader of this field must treat a
 *     missing value as 'checkpoint', not just this factory's own
 *     default (see notebookConfigService.js's own getTrackingMode()).
 *   - 'daily': the notebook is checked once per expected working day,
 *     not against named checkpoints — see services/dailyCheckService.js.
 *
 * `dailySettings` — only meaningful (and only ever set) when
 * `trackingMode` is 'daily'; `null` for 'checkpoint' notebooks. Its own
 * `excludedDates` is deliberately a generic concept (specific calendar
 * dates this one notebook doesn't expect a check on), not hardcoded as
 * "holidays" only — the UI may label it "Holidays" or "No-check days,"
 * but the same list can eventually cover school closures, exam days,
 * etc. without a model change.
 */

import { generateId } from '../utils/idGenerator.js';

export function createNotebookType({ id, subjectId, name, trackingMode = 'checkpoint', dailySettings = null } = {}) {
  return {
    id: id || generateId(),
    subjectId,
    name,
    trackingMode,
    dailySettings,
  };
}

/** The shape `dailySettings` takes once a notebook type becomes 'daily' — a plain factory, not exported state, so every caller starts from the same defaults (no scoring, no excluded dates yet). */
export function createDailySettings({ scoringEnabled = false, scoreMax = 5, excludedDates = [] } = {}) {
  return { scoringEnabled, scoreMax, excludedDates };
}
