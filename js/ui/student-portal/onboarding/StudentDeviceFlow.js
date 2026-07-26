/**
 * ui/student-portal/onboarding/StudentDeviceFlow.js
 *
 * The new default entry to the Student Portal — replacing
 * StudentOnboardingFlow.js's PIN-first sequence as the front door,
 * per this project's CHANGELOG (the multi-round architecture
 * discussion this implements). Walks: does this device already
 * remember one or more profiles? -> if more than one, pick which one
 * to use today -> if none yet, enter a classroom code -> pick a name
 * off the real roster -> remember it on this device and mark it
 * joined (teacher-visible) -> done.
 *
 * StudentOnboardingFlow.js itself is untouched and still reachable —
 * it now backs a secondary, explicitly-authenticated parent-connection
 * path, not the default one. This file has no dependency on it, on
 * studentIdentityService.js, or on any identity/consent/PIN machinery
 * — see studentDeviceService.js's own doc comment for why that
 * separation is deliberate, not incidental.
 */

import * as studentDeviceService from '../../../services/studentDeviceService.js';
import * as workspaceService from '../../../services/workspaceService.js';
import { renderStudentJoinClassroomView } from './StudentJoinClassroomView.js';
import { renderStudentRosterPickerView } from './StudentRosterPickerView.js';

export async function renderStudentDeviceFlow(container, { onResolved }) {
  const remembered = studentDeviceService.getRememberedProfiles();

  if (remembered.length === 1) {
    studentDeviceService.setLastActiveProfile(remembered[0]);
    onResolved(remembered[0]);
    return;
  }

  if (remembered.length > 1) {
    renderStudentRosterPickerView(container, {
      title: "Who's using ClassMate today?",
      students: remembered,
      onSelect: (studentRef) => {
        studentDeviceService.setLastActiveProfile(studentRef);
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
          studentDeviceService.rememberProfile(studentRef);
          studentDeviceService.setLastActiveProfile(studentRef);
          await workspaceService.markStudentJoinedPortal(studentRef.classroomId, studentRef.studentId);
          onResolved(studentRef);
        },
      });
    },
  });
}
