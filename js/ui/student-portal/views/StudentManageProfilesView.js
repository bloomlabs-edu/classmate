/**
 * ui/student-portal/views/StudentManageProfilesView.js
 *
 * Replaces the old, permanent "Switch Student" button — reached from
 * Profile as "Manage Students" instead (see this project's CHANGELOG
 * for the security redesign this implements). This is where the
 * *rare, administrative* actions live: adding a 2nd/3rd student to
 * this device, or removing one — both gated by the classroom's Device
 * Reset PIN (see StudentDevicePinPromptView.js). Switching between
 * profiles already approved on this device is still free from right
 * here too — tapping a row just signs in as that student, no PIN.
 *
 * Deliberately does not let a student add a profile from a different
 * classroom — services/studentDeviceService.js's addApprovedProfile()
 * enforces that structurally; this view just surfaces the resulting
 * DIFFERENT_CLASSROOM reason as a plain message rather than trying to
 * work around it.
 */

import * as studentDeviceService from '../../../services/studentDeviceService.js';
import * as workspaceService from '../../../services/workspaceService.js';
import { renderStudentDevicePinPromptView } from '../onboarding/StudentDevicePinPromptView.js';
import { renderStudentRosterPickerView } from '../onboarding/StudentRosterPickerView.js';
import { renderStudentEnrollmentCodeView } from '../onboarding/StudentEnrollmentCodeView.js';
import { createAvatarElement } from '../../components/AvatarDisplay.js';
import { createBackButton } from '../../components/BackButton.js';

export function renderStudentManageProfilesView(container, { onBack, onProfilesChanged }) {
  container.innerHTML = '';

  const approved = studentDeviceService.getApprovedProfiles();
  const activeProfile = studentDeviceService.getActiveProfile();
  const classroomId = approved[0]?.classroomId;

  const wrapper = document.createElement('div');
  wrapper.className = 'student-manage-profiles';

  const backButton = createBackButton(onBack);
  wrapper.appendChild(backButton);

  const title = document.createElement('h1');
  title.className = 'student-section__title';
  title.textContent = 'Manage Students';
  wrapper.appendChild(title);

  const subtitle = document.createElement('p');
  subtitle.className = 'student-manage-profiles__subtitle';
  subtitle.textContent = 'This device remembers up to 3 students. Tap a name to switch — no PIN needed for that.';
  wrapper.appendChild(subtitle);

  const list = document.createElement('div');
  list.className = 'student-manage-profiles__list';

  approved.forEach((studentRef) => {
    const row = document.createElement('div');
    row.className = 'student-manage-profiles__row';

    const switchButton = document.createElement('button');
    switchButton.type = 'button';
    switchButton.className = 'student-manage-profiles__switch';
    switchButton.appendChild(createAvatarElement({ studentId: studentRef.studentId, name: studentRef.studentName, size: 44, useDefaultIfMissing: true }));

    const nameEl = document.createElement('span');
    nameEl.className = 'student-manage-profiles__name';
    nameEl.textContent = studentRef.studentId === activeProfile?.studentId ? `${studentRef.studentName} (Active)` : studentRef.studentName;
    switchButton.appendChild(nameEl);

    switchButton.addEventListener('click', () => {
      studentDeviceService.setActiveProfile(studentRef);
      onProfilesChanged();
    });
    row.appendChild(switchButton);

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'btn btn--text btn--danger-text student-manage-profiles__remove';
    removeButton.textContent = 'Remove';
    removeButton.addEventListener('click', () => {
      const confirmed = window.confirm(`Remove ${studentRef.studentName} from this device? You'll need the Device Reset PIN.`);
      if (!confirmed) return;
      promptForPin({
        classroomId: studentRef.classroomId,
        message: `Ask your teacher for the Device Reset PIN to remove ${studentRef.studentName}.`,
        onVerified: () => {
          studentDeviceService.removeApprovedProfile(studentRef.studentId);
          renderStudentManageProfilesView(container, { onBack, onProfilesChanged });
        },
      });
    });
    row.appendChild(removeButton);

    list.appendChild(row);
  });
  wrapper.appendChild(list);

  const addSection = document.createElement('div');
  addSection.className = 'student-manage-profiles__add-section';

  if (studentDeviceService.isAtCapacity()) {
    const capacityNote = document.createElement('p');
    capacityNote.className = 'student-manage-profiles__note';
    capacityNote.textContent = 'This device already has the maximum of 3 students. Remove one to add another.';
    addSection.appendChild(capacityNote);
  } else {
    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'btn btn--primary';
    addButton.textContent = 'Add Another Student';
    addButton.addEventListener('click', () => {
      promptForPin({
        classroomId,
        message: 'Ask your teacher for the Device Reset PIN to add another student to this device.',
        onVerified: async () => {
          const classroom = await workspaceService.getClassroomOnce(classroomId);
          if (!classroom) return;
          const alreadyApprovedIds = new Set(approved.map((p) => p.studentId));
          const availableStudents = classroom.teams
            .flatMap((team) => team.students)
            .filter((student) => !alreadyApprovedIds.has(student.id))
            .map((student) => ({ classroomId, studentId: student.id, studentName: student.name }));

          renderRosterPickerForAdding(availableStudents);
        },
      });
    });
    addSection.appendChild(addButton);
  }
  wrapper.appendChild(addSection);

  container.appendChild(wrapper);

  function promptForPin({ classroomId: pinClassroomId, message, onVerified }) {
    renderStudentDevicePinPromptView(container, {
      classroomId: pinClassroomId,
      message,
      onVerified,
      onCancel: () => renderStudentManageProfilesView(container, { onBack, onProfilesChanged }),
    });
  }

  function renderRosterPickerForAdding(availableStudents) {
    renderStudentRosterPickerView(container, {
      title: 'Add which student?',
      students: availableStudents,
      onSelect: (studentRef) => {
        const result = studentDeviceService.addApprovedProfile(studentRef);
        if (!result.success) {
          window.alert(
            result.reason === 'AT_CAPACITY'
              ? 'This device already has the maximum of 3 students.'
              : "This student isn't in the same classroom as the others on this device."
          );
          renderStudentManageProfilesView(container, { onBack, onProfilesChanged });
          return;
        }

        // An ADDITIONAL student on an already-claimed device — the
        // explicitly-accepted policy reserves the free,
        // classroom-code-only path for a device's own first student;
        // every student after that needs the real, teacher-issued
        // code (see StudentDeviceFlow.js's own resolveApprovedProfile()
        // for the matching, returning-profile side of this same rule).
        renderStudentEnrollmentCodeView(container, {
          classroomId: studentRef.classroomId,
          studentId: studentRef.studentId,
          studentName: studentRef.studentName,
          onEnrolled: () => {
            onProfilesChanged();
            renderStudentManageProfilesView(container, { onBack, onProfilesChanged });
          },
        });
      },
    });
  }
}
