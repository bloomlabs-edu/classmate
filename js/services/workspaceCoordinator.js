/**
 * services/workspaceCoordinator.js
 *
 * A small, pure registry: which active workspace (if any) currently
 * wants to hear about a given classroom's own updates, and how to
 * tell it. Deliberately knows nothing about Firestore, persistence,
 * or save state — services/workspaceService.js is this file's one
 * caller, keeping the dependency pointing from persistence toward
 * coordination, never the reverse. workspaceService.js continues to
 * own subscriptions/persistence/save state; this file owns only
 * workspace lifecycle (who's currently showing what, and telling
 * them when it changes).
 *
 * "Active workspace" means: the one screen currently showing a
 * specific classroom in enough depth that a background data refresh
 * should update it in place, rather than the coarser, older
 * onChange-triggers-renderRoute() fallback tearing the whole screen
 * down. See ui/views/LearningManagementView.js for the first, and so
 * far only, adopter — other screens (Dashboard, Curriculum
 * Management, Concept Workspace) can adopt the same pattern later,
 * incrementally, each on its own terms; nothing here assumes there's
 * only ever one kind of workspace.
 *
 * One registration per classroom id at a time, matching this app's
 * own established "one screen showing at a time" convention (see
 * workspaceService.js's onSaveStateChange/onChangeCallback for the
 * same single-subscriber shape applied elsewhere). Registering a new
 * workspace for a classroom id already registered simply replaces
 * whichever was there before.
 */

const activeWorkspaces = new Map(); // classroomId -> onUpdate callback

/**
 * Registers the given callback as the active workspace for this
 * classroom. Call once, as soon as a workspace starts showing a
 * specific classroom (see LearningManagementView.js's onChooseClass
 * and its own singleClassroomMode entry point) — and
 * unregisterActiveWorkspace() once it stops showing that classroom
 * (see its own onBack, and the moment a different classroom is
 * chosen instead).
 */
export function registerActiveWorkspace(classroomId, onUpdate) {
  activeWorkspaces.set(classroomId, onUpdate);
}

/** Unregisters the active workspace for this classroom, if any is currently registered. A no-op if none is — never an error to unregister something that was never (or is no longer) registered. */
export function unregisterActiveWorkspace(classroomId) {
  activeWorkspaces.delete(classroomId);
}

/**
 * Tells the active workspace for this classroom, if one is
 * registered, about a fresh classroom object. Returns whether anyone
 * was actually listening, so the caller (workspaceService.js) knows
 * whether it still needs its own, coarser fallback (today's
 * onChangeCallback-triggers-renderRoute() path) for a classroom
 * nobody's actively viewing right now.
 */
export function notifyActiveWorkspace(classroomId, classroom) {
  const onUpdate = activeWorkspaces.get(classroomId);
  if (!onUpdate) return false;
  onUpdate(classroom);
  return true;
}
