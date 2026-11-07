/**
 * utils/objectRollback.js
 *
 * `restoreObject(target, snapshot)` — replaces every enumerable own
 * property of `target` with `snapshot`'s own, in place, without
 * replacing `target`'s own object reference (other code may already
 * hold it — e.g. a WorkRequestEntry sitting inside
 * `classroom.workRequests[].entries[]`, or a Student inside
 * `classroom.teams[].students[]`).
 *
 * The one, generic rollback primitive behind "if persistence fails,
 * restore the in-memory state exactly to its pre-operation state" —
 * used by ui/views/WorkRequestRosterView.js's own review-modal save
 * handler (see that file's own header comment) to undo a notebook
 * review's mutation of a WorkRequestEntry and a Student object when the
 * actual Firestore write that was supposed to persist it fails.
 *
 * Deliberately a plain, dependency-free utility (no imports of its
 * own) rather than a private helper duplicated inside the view file it
 * was first written for: a view module transitively imports
 * services/workspaceService.js, which imports Firebase from a CDN
 * specifier real Node can't resolve at all, and (separately)
 * js/config/appConfig.js, which reads `window` at module-load time —
 * neither of which this file touches, so it can be imported directly
 * by a plain `node:test` file with no stub loader, no DOM, and no
 * import-time crash risk, unlike the view module itself.
 */
export function restoreObject(target, snapshot) {
  Object.keys(target).forEach((key) => delete target[key]);
  Object.assign(target, snapshot);
}
