/**
 * config/workRequestTypes.js
 *
 * The kinds of submission-based work a WorkRequest can represent (see
 * models/WorkRequest.js). 'notebook' is the only real implementation
 * today — the others are the domain's own known future scope, not
 * built yet, listed here only so the shape of what's coming is
 * explicit rather than left to be reverse-engineered later.
 */

export const WORK_REQUEST_TYPES = Object.freeze(['notebook']);

// Real future scope, per explicit product decision — not implemented
// yet: 'worksheet', 'project', 'reading_log', 'lab_record', 'portfolio'.
