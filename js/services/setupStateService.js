/**
 * services/setupStateService.js
 *
 * Derives setup-related facts about a classroom — deliberately
 * separate from activity facts (has this classroom actually been
 * taught in?), which belong in a future activityStateService.js.
 * Conflating the two was the exact mistake corrected earlier in this
 * feature's design: running a Class Session is evidence of teaching,
 * not a setup checkbox, so it has no place in this file.
 *
 * Every field here is a plain boolean answering "has this setup step
 * happened," read from data that already exists elsewhere in the app
 * — nothing here is a new source of truth, just a single place that
 * knows how to ask the existing sources.
 */

import * as studentIdentityService from './studentIdentityService.js';

/**
 * A student can only be added to an existing team in this app's
 * model (see studentService.js's addStudent(team, name)) — but since
 * the Ungrouped auto-team (see classroomService.js's
 * getOrCreateUngroupedTeam) now exists specifically to hold students
 * the teacher hasn't sorted into a real group yet, "has any team at
 * all" still isn't the right signal for "has this teacher
 * intentionally organized their class into groups." Any team other
 * than the automatic Ungrouped one is the real signal.
 */
function hasGroups(classroom) {
  return classroom.teams.some((team) => !team.isUngrouped);
}

function hasStudents(classroom) {
  return classroom.teams.some((team) => team.students.length > 0);
}

function hasNotebookConfigured(classroom) {
  return (classroom.notebookConfig?.subjects || []).length > 0;
}

export async function getSetupState(classroom) {
  return {
    hasStudents: hasStudents(classroom),
    hasSentInvitation: await studentIdentityService.hasSentAnyInvitation(classroom),
    hasLinkedStudent: await studentIdentityService.hasAnyLinkedStudent(classroom),
    hasGroups: hasGroups(classroom),
    hasNotebookConfigured: hasNotebookConfigured(classroom),
  };
}
