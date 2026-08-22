/**
 * ui/views/LearningProgrammeSettingsView.js
 *
 * Deliberately minimal, per this project's own Phase 2A scope: edit
 * name/description, manage members, archive. NOT exposed here —
 * component architecture, internal configuration objects, custom
 * tracker creation, advanced permissions — all explicitly out of
 * scope for this phase.
 *
 * Every mutation here follows the same pattern: mutate the programme
 * object via services/learningProgrammeService.js, then
 * services/workspaceService.js's save() — the one, already-approved
 * persistence path for programme CONFIGURATION (embedded on the
 * classroom document, see models/LearningProgramme.js). This is
 * distinct from ProgrammeSession data, which this view never touches
 * at all.
 *
 * PHASE 3.7 EXCEPTION — the membership add/remove flow below also
 * writes a small, independent Firestore mirror document per changed
 * student (repositories/firestoreEnrollmentRepository.js's own
 * setProgrammeMembershipMirror()), directly, alongside the
 * workspaceService.save() call. This is NOT a second persistence path
 * for programme configuration itself (the embedded
 * memberships[] array remains the sole source of truth for that, via
 * workspaceService.save(), exactly as before) — it is a narrow,
 * additive security artifact firestore.rules' own membershipLinks
 * create rule reads via get(), which cannot be derived from the
 * classroom document alone without an expensive nested array scan
 * (see that rule's own comment). See the project's own Phase 3.7
 * authorization for why this one exception exists here.
 */

import * as workspaceService from '../../services/workspaceService.js';
import * as learningProgrammeService from '../../services/learningProgrammeService.js';
import * as enrollmentRepository from '../../repositories/firestoreEnrollmentRepository.js';
import { createBackButton } from '../components/BackButton.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { openManageLearningProgrammeMembersModal } from '../components/ManageLearningProgrammeMembersModal.js';

export function renderLearningProgrammeSettingsView(container, { classroom, programmeId, onBack }) {
  container.innerHTML = '';

  const programme = learningProgrammeService.getLearningProgrammeById(classroom, programmeId);
  if (!programme) {
    container.appendChild(createEmptyStateElement({ message: 'This Learning Programme could not be found.' }));
    return;
  }

  function rerender() {
    renderLearningProgrammeSettingsView(container, { classroom, programmeId, onBack });
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'learning-programme-settings';

  const header = document.createElement('header');
  header.className = 'tracker-header';
  header.appendChild(createBackButton(onBack));
  const title = document.createElement('h1');
  title.className = 'tracker-header__title';
  title.textContent = `${programme.name} \u00b7 Settings`;
  header.appendChild(title);
  wrapper.appendChild(header);

  const content = document.createElement('div');
  content.className = 'wizard-step-content';

  // --- Name / description ---
  const detailsSection = document.createElement('div');
  detailsSection.className = 'profile-section';

  const detailsHeading = document.createElement('h2');
  detailsHeading.className = 'profile-section__heading';
  detailsHeading.textContent = 'Details';
  detailsSection.appendChild(detailsHeading);

  const nameLabel = document.createElement('label');
  nameLabel.className = 'modal__label';
  nameLabel.textContent = 'Name';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'modal__input';
  nameInput.value = programme.name;
  nameLabel.appendChild(nameInput);
  detailsSection.appendChild(nameLabel);

  const descriptionLabel = document.createElement('label');
  descriptionLabel.className = 'modal__label';
  descriptionLabel.textContent = 'Description';
  const descriptionInput = document.createElement('textarea');
  descriptionInput.className = 'modal__input';
  descriptionInput.rows = 2;
  descriptionInput.value = programme.description || '';
  descriptionLabel.appendChild(descriptionInput);
  detailsSection.appendChild(descriptionLabel);

  const saveDetailsButton = document.createElement('button');
  saveDetailsButton.type = 'button';
  saveDetailsButton.className = 'btn btn--primary';
  saveDetailsButton.textContent = 'Save Details';
  saveDetailsButton.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) {
      window.alert('Enter a name for this programme.');
      nameInput.focus();
      return;
    }
    learningProgrammeService.updateProgrammeConfiguration(programme, {
      name,
      description: descriptionInput.value.trim(),
    });
    workspaceService.save(classroom);
    rerender();
  });
  detailsSection.appendChild(saveDetailsButton);
  content.appendChild(detailsSection);

  // --- Members ---
  const membersSection = document.createElement('div');
  membersSection.className = 'profile-section';

  const membersHeading = document.createElement('h2');
  membersHeading.className = 'profile-section__heading';
  membersHeading.textContent = 'Members';
  membersSection.appendChild(membersHeading);

  const activeMembers = learningProgrammeService.getActiveMembers(programme);
  const memberCountLine = document.createElement('p');
  memberCountLine.className = 'profile-section__meta';
  memberCountLine.textContent = `${activeMembers.length} active member${activeMembers.length === 1 ? '' : 's'}`;
  membersSection.appendChild(memberCountLine);

  const manageMembersButton = document.createElement('button');
  manageMembersButton.type = 'button';
  manageMembersButton.className = 'btn btn--secondary';
  manageMembersButton.textContent = 'Manage Members';
  manageMembersButton.addEventListener('click', () => {
    openManageLearningProgrammeMembersModal({
      classroom,
      currentActiveStudentIds: activeMembers.map((membership) => membership.studentId),
      onSave: (desiredActiveStudentIds) => {
        const desiredSet = new Set(desiredActiveStudentIds);
        const currentSet = new Set(activeMembers.map((membership) => membership.studentId));
        const mirrorWrites = [];

        // Add anyone newly selected who wasn't already active —
        // addMembership() itself is a safe no-op for anyone already
        // active (see services/learningProgrammeService.js), so this
        // never risks a duplicate active membership.
        desiredSet.forEach((studentId) => {
          if (!currentSet.has(studentId)) {
            const membership = learningProgrammeService.addMembership(programme, studentId);
            mirrorWrites.push(
              enrollmentRepository.setProgrammeMembershipMirror(classroom.id, programme.id, studentId, {
                status: membership.status,
                joinedAt: membership.joinedAt,
              })
            );
          }
        });

        // Mark anyone deselected as left — never deletes their own
        // membership record or touches any historical session (see
        // markMembershipLeft()'s own header comment).
        currentSet.forEach((studentId) => {
          if (!desiredSet.has(studentId)) {
            const membership = learningProgrammeService.markMembershipLeft(programme, studentId);
            if (membership) {
              mirrorWrites.push(
                enrollmentRepository.setProgrammeMembershipMirror(classroom.id, programme.id, studentId, {
                  status: membership.status,
                  joinedAt: membership.joinedAt,
                })
              );
            }
          }
        });

        workspaceService.save(classroom);
        // Fire-and-forget, matching workspaceService.save()'s own
        // pattern immediately above — the embedded memberships[]
        // array (already saved) remains the source of truth
        // regardless of whether this mirror write succeeds.
        Promise.all(mirrorWrites).catch((error) => {
          console.error('[LearningProgrammeSettingsView] Failed to write membership mirror document:', error);
        });
        rerender();
      },
    });
  });
  membersSection.appendChild(manageMembersButton);
  content.appendChild(membersSection);

  // --- Archive ---
  const archiveSection = document.createElement('div');
  archiveSection.className = 'profile-section';

  const archiveHeading = document.createElement('h2');
  archiveHeading.className = 'profile-section__heading';
  archiveHeading.textContent = 'Archive';
  archiveSection.appendChild(archiveHeading);

  if (programme.status === 'archived') {
    const archivedNote = document.createElement('p');
    archivedNote.className = 'profile-section__meta';
    archivedNote.textContent = 'This programme is archived. Its members and past sessions remain accessible, but no new session can be started.';
    archiveSection.appendChild(archivedNote);
  } else {
    const archiveNote = document.createElement('p');
    archiveNote.className = 'profile-section__meta';
    archiveNote.textContent = 'Archiving keeps every member and past session exactly as they are \u2014 it only stops new sessions from being started.';
    archiveSection.appendChild(archiveNote);

    const archiveButton = document.createElement('button');
    archiveButton.type = 'button';
    archiveButton.className = 'btn btn--danger-text';
    archiveButton.textContent = 'Archive Programme';
    archiveButton.addEventListener('click', () => {
      const confirmed = window.confirm(
        `Archive "${programme.name}"? Members and past sessions stay exactly as they are; no new session can be started afterward.`
      );
      if (!confirmed) return;
      learningProgrammeService.archiveProgramme(programme);
      workspaceService.save(classroom);
      rerender();
    });
    archiveSection.appendChild(archiveButton);
  }
  content.appendChild(archiveSection);

  wrapper.appendChild(content);
  container.appendChild(wrapper);
}
