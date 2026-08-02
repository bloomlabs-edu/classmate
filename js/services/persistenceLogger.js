/**
 * services/persistenceLogger.js
 *
 * A small, dedicated logger for the temporary explicit-Save workflow
 * (see ui/views/LearningManagementView.js's own Save Changes button,
 * services/workspaceService.js's saveExplicitly()/markDirty()) —
 * exists to make classroom persistence failures immediately visible
 * while that's being stabilized, per explicit product decision. Not
 * meant to become permanent application logging; if/when autosave is
 * restored (see this file's own callers for that discussion), this
 * can likely be removed along with the rest of the explicit-Save
 * scaffolding.
 *
 * Deliberately just console.log, not a real logging service — the
 * whole point is a developer watching the console while reproducing
 * a persistence bug, not a durable audit trail.
 */

export function logPersistenceEvent(event, details = {}) {
  const timestamp = new Date().toISOString();
  if (Object.keys(details).length > 0) {
    console.log(`[Persistence] ${timestamp} \u2014 ${event}`, details);
  } else {
    console.log(`[Persistence] ${timestamp} \u2014 ${event}`);
  }
}

// TEMPORARY DIAGNOSTIC — instrumenting whether a top-level view gets
// torn down involuntarily (see this project's own investigation into
// why the Learning workspace's Save UI disappears on the deployed app
// but not on Live Server). Tracks which top-level view last announced
// itself as mounted; if a different one mounts next without the first
// ever announcing its own, intentional exit, that's a real, involuntary
// teardown — logged here as "<previous view> destroyed" the moment it's
// discovered, not assumed. Remove once that investigation concludes.
let currentlyMountedView = null;

export function logViewMounted(viewName) {
  if (currentlyMountedView && currentlyMountedView !== viewName) {
    logPersistenceEvent(`${currentlyMountedView} destroyed`, { replacedBy: viewName });
  }
  currentlyMountedView = viewName;
  logPersistenceEvent(`${viewName} created`);
}
