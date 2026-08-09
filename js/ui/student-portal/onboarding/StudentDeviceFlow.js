/**
 * ui/student-portal/onboarding/StudentDeviceFlow.js
 *
 * The default entry to the Student Portal. Walks: does this device
 * already have an approved profile? -> if so, verify the classroom it
 * points to still actually exists and this student is still a real
 * member of it -> if exactly one profile (and it's still valid),
 * resume as that student automatically -> if more than one, show a
 * small avatar picker among just those approved profiles -> if none
 * yet (or the ones that existed just failed validation), this is
 * treated as a fresh device: enter a classroom code -> pick a name
 * off the real roster -> approve it on this device (free — a fresh
 * device's first profile needs no PIN, see
 * studentDeviceService.js's header comment) and mark it joined
 * (teacher-visible) -> done.
 *
 * Stale-session recovery, not an application error: a teacher
 * deleting a classroom after a student already joined it on this
 * device used to leave that student stranded on an unrecoverable
 * "couldn't load your data" screen with no way back to Join
 * Classroom, because nothing here ever re-checked whether the
 * classroom a device's approved profile pointed to was still real
 * before resuming it automatically. Every approved profile on one
 * device is always from the same classroom (see
 * studentDeviceService.js's own structural rule), so one validation
 * check — against any single approved profile — is enough to know
 * whether *all* of them are now stale; if the classroom's gone, every
 * profile this device holds is cleared together, and the flow falls
 * through to the exact same "fresh device" join path as if nothing
 * had ever been approved here, with a plain explanation of what
 * happened rather than silence.
 *
 * Adding a *second* or third profile to an already-claimed device, or
 * removing one, happens elsewhere — see
 * StudentManageProfilesView.js — and does require the classroom's
 * Device Reset PIN. This file only ever adds a profile PIN-free in
 * the one case that's always safe: a device with nothing approved
 * yet (or nothing *validly* approved anymore).
 *
 * No enrollment-code step of any kind lives here — a classroom code
 * plus picking a real name off the roster is, by explicit product
 * decision, the complete and only requirement to enter the Student
 * Portal. This is intentionally the pre-identity-layer behavior,
 * restored deliberately after that layer's own onboarding gate
 * disrupted existing, working student logins.
 */

import * as studentDeviceService from '../../../services/studentDeviceService.js';
import * as workspaceService from '../../../services/workspaceService.js';
import { loadCurrentStudentAndClassroom } from '../../../services/studentPortalDataService.js';
import { renderStudentJoinClassroomView } from './StudentJoinClassroomView.js';
import { renderStudentRosterPickerView } from './StudentRosterPickerView.js';

/** The fresh-device join path — also reused for stale-session recovery, so a recovered device rejoins exactly the same way a brand-new one would, just with an explanatory message attached. */
function renderFreshJoinFlow(container, { onResolved, message }) {
  renderStudentJoinClassroomView(container, {
    message,
    onClassroomResolved: (classroom) => {
      const allStudents = classroom.teams.flatMap((team) => team.students);
      renderStudentRosterPickerView(container, {
        students: allStudents.map((student) => ({
          classroomId: classroom.id,
          studentId: student.id,
          studentName: student.name,
        })),
        onSelect: async (studentRef) => {
          // Always succeeds here — this branch only runs for a fresh
          // (or freshly-recovered) device with zero valid approved
          // profiles, the one case that needs no PIN. See this file's
          // header comment.
          studentDeviceService.addApprovedProfile(studentRef);
          studentDeviceService.setActiveProfile(studentRef);
          await workspaceService.markStudentJoinedPortal(studentRef.classroomId, studentRef.studentId);
          onResolved(studentRef);
        },
      });
    },
  });
}

export async function renderStudentDeviceFlow(container, { onResolved }) {
  let approved = studentDeviceService.getApprovedProfiles();

  if (approved.length > 0) {
    // Every approved profile on this device is always from the same
    // classroom (see studentDeviceService.js's own structural rule) —
    // checking any single one tells us whether all of them are still
    // valid, without needing to check each individually.
    const stillValid = await loadCurrentStudentAndClassroom(approved[0]);
    if (!stillValid) {
      studentDeviceService.clearAllApprovedProfiles();
      approved = [];
      renderFreshJoinFlow(container, {
        onResolved,
        message: 'Your previous classroom is no longer available. Please join a classroom again.',
      });
      return;
    }
  }

  if (approved.length === 1) {
    studentDeviceService.setActiveProfile(approved[0]);
    onResolved(approved[0]);
    return;
  }

  if (approved.length > 1) {
    renderStudentRosterPickerView(container, {
      title: "Who's using ClassMate today?",
      students: approved,
      onSelect: (studentRef) => {
        studentDeviceService.setActiveProfile(studentRef);
        onResolved(studentRef);
      },
    });
    return;
  }

  renderFreshJoinFlow(container, { onResolved, message: null });
}
