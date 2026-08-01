/**
 * ui/components/SubjectSelectionList.js
 *
 * The "SubjectPicker" role in this feature's component hierarchy (see
 * ui/components/AddSubjectModal.js's own header comment) — a
 * selectable list of canonical subject names, "Custom Subject" as the
 * list's own final row. Deliberately a distinct file from the
 * existing ui/components/SubjectPicker.js: that component's chip-grid,
 * click-and-immediately-act interaction is a different shape than
 * this one (a list a teacher picks through, then confirms with a
 * separate Next action) — reskinning that file risked carrying its
 * assumptions along; this one is built for its own actual interaction
 * instead, and that older component stays untouched for whatever
 * still uses it.
 *
 * This is the *only* file in the whole Add Subject workflow that
 * imports services/subjectIdentityService.js's canonical list — the
 * deliberate other half of the safeguard described in
 * ui/components/AddSubjectModal.js's own header comment. Only ever
 * rendered from inside that modal's own Choose Subject step; never
 * imported by ui/views/LearningManagementView.js or
 * ui/components/ExistingSubjectsList.js.
 *
 * `onSelect` now receives `{subjectId, title}`, not a bare string —
 * this is the actual architectural fix for a real, confirmed bug
 * (see services/curriculumLinkingService.js's own header comment):
 * choosing a canonical suggestion here assigns the exact same
 * `subjectId` that choosing the identical suggestion in Curriculum
 * Management would assign, so the two screens link by id, never by
 * comparing what was typed. A custom, free-typed name gets its own id
 * generated deterministically from what was actually typed (see
 * services/subjectIdentityService.js's generateCustomSubjectId()) —
 * it is never matched against the canonical list by string comparison.
 *
 * `existingSubjectTitles` excludes anything already added to the
 * classroom from the suggestion list — a subject a teacher has
 * already added has no reason to be offered again.
 */

import { getCanonicalSubjects, generateCustomSubjectId } from '../../services/subjectIdentityService.js';

export function renderSubjectSelectionList({ existingSubjectTitles, onSelect }) {
  const list = document.createElement('div');
  list.className = 'choose-subject-modal__list';

  const existingLower = existingSubjectTitles.map((title) => title.trim().toLowerCase());
  const availableSubjects = getCanonicalSubjects().filter((subject) => !existingLower.includes(subject.title.toLowerCase()));

  availableSubjects.forEach((subject) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'choose-subject-modal__row';
    row.textContent = subject.title;
    // A click is itself a complete, unambiguous selection — proceeds
    // immediately, per explicit instruction, with no separate confirm
    // step for this path. The id is exactly this canonical entry's
    // own fixed id — never derived from the displayed title.
    row.addEventListener('click', () => onSelect({ subjectId: subject.id, title: subject.title }));
    list.appendChild(row);
  });

  const customRow = document.createElement('button');
  customRow.type = 'button';
  customRow.className = 'choose-subject-modal__row choose-subject-modal__row--custom';
  customRow.textContent = 'Custom Subject';

  const customFieldWrapper = document.createElement('div');
  customFieldWrapper.className = 'choose-subject-modal__custom-field';
  customFieldWrapper.hidden = true;

  const customInput = document.createElement('input');
  customInput.type = 'text';
  customInput.className = 'modal__input';
  customInput.placeholder = 'Type a subject name';
  // "Immediately proceed" applies to a *finished* selection — a
  // single click for a suggested subject, or pressing Enter once a
  // custom name is typed. Firing on every keystroke would proceed
  // after the very first letter, which isn't a real selection at all.
  customInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const typedName = customInput.value.trim();
    if (!typedName) return;
    // Deterministic id from exactly what was typed — not matched
    // against the canonical list above by string comparison. See this
    // file's own header comment and
    // services/subjectIdentityService.js for why that's deliberate.
    onSelect({ subjectId: generateCustomSubjectId(typedName), title: typedName });
  });
  customFieldWrapper.appendChild(customInput);

  customRow.addEventListener('click', () => {
    customFieldWrapper.hidden = false;
    customInput.focus();
  });

  list.appendChild(customRow);
  list.appendChild(customFieldWrapper);

  return list;
}
