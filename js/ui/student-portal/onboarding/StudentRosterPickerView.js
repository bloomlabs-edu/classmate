/**
 * ui/student-portal/onboarding/StudentRosterPickerView.js
 *
 * "Choose your name" — a generic name-tap picker, reused for three
 * moments in the join/identity flow: picking a name off a classroom's
 * real roster right after a join code resolves, picking which
 * already-approved profile to use today when a device has more than
 * one (see services/studentDeviceService.js's trusted-device model),
 * and picking a new name to add to an already-claimed device from
 * StudentManageProfilesView.js. Deliberately mirrors
 * StudentPickerView.js's visual pattern (same CSS classes, same
 * avatar treatment) for consistency, but takes a plain onSelect
 * callback and a plain list of student refs rather than calling into
 * studentIdentityService.js — this flow has no identity layer to call
 * into at all, by design (see StudentJoinClassroomView.js's doc
 * comment for the full reasoning).
 */

import { createAvatarElement } from '../../components/AvatarDisplay.js';

/**
 * @param {Array<{classroomId, studentId, studentName}>} students
 */
export function renderStudentRosterPickerView(container, { title = 'Choose your name', students, onSelect }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'student-picker';

  const titleEl = document.createElement('h1');
  titleEl.className = 'student-picker__title';
  titleEl.textContent = title;

  wrapper.appendChild(titleEl);

  const list = document.createElement('div');
  list.className = 'student-picker__list';

  students.forEach((studentRef) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'student-picker__card';
    card.addEventListener('click', () => onSelect(studentRef));

    card.appendChild(
      createAvatarElement({
        studentId: studentRef.studentId,
        name: studentRef.studentName,
        size: 48,
        className: 'student-picker__avatar',
      })
    );

    const nameEl = document.createElement('span');
    nameEl.className = 'student-picker__name';
    nameEl.textContent = studentRef.studentName;

    card.appendChild(nameEl);
    list.appendChild(card);
  });

  wrapper.appendChild(list);
  container.appendChild(wrapper);
}
