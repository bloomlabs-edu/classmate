/**
 * ui/student-portal/onboarding/StudentDeviceFlow.js
 *
 * The default entry to the Student Portal. Walks: does this device
 * already have an approved profile? -> if exactly one, resume as that
 * student automatically -> if more than one (siblings sharing a
 * device — see services/studentDeviceService.js's trusted-device
 * model), show a small avatar picker among just those approved
 * profiles -> if none yet, this is a fresh device: enter a classroom
 * code -> pick a name off the real roster -> approve it on this
 * device (free — a fresh device's first profile needs no PIN, see
 * studentDeviceService.js's header comment) and mark it joined
 * (teacher-visible) -> done.
 *
 * Adding a *second* or third profile to an already-claimed device, or
 * removing one, happens elsewhere — see
 * StudentManageProfilesView.js — and does require the classroom's
 * Device Reset PIN. This file only ever adds a profile PIN-free in
 * the one case that's always safe: a device with nothing approved
 * yet.
 */

import * as studentDeviceService from '../../../services/studentDeviceService.js';
import * as workspaceService from '../../../services/workspaceService.js';
import { renderStudentJoinClassroomView } from './StudentJoinClassroomView.js';
import { renderStudentRosterPickerView } from './StudentRosterPickerView.js';

export async function renderStudentDeviceFlow(container, { onResolved }) {
  const approved = studentDeviceService.getApprovedProfiles();

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

  renderStudentJoinClassroomView(container, {
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
          // device (0 approved profiles), the one case that needs no
          // PIN. See this file's header comment.
          studentDeviceService.addApprovedProfile(studentRef);
          studentDeviceService.setActiveProfile(studentRef);
          await workspaceService.markStudentJoinedPortal(studentRef.classroomId, studentRef.studentId);
          onResolved(studentRef);
        },
      });
    },
  });
}
