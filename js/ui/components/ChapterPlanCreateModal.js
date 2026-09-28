/**
 * ui/components/ChapterPlanCreateModal.js
 *
 * "+ Create Chapter Plan" — progressive disclosure across three small
 * steps (Subject -> Term -> Chapter/Unit), never one giant form, per
 * explicit product direction. Modeled on
 * ui/components/AddSubjectModal.js's own "re-render the same modal's
 * innerHTML per step" shape.
 *
 * "Classroom" is deliberately NOT a step here — unlike the original
 * four-step brief (Classroom -> Subject -> Term -> Chapter/Unit), this
 * modal is only ever opened from INSIDE a specific classroom's own
 * Chapter Plans list (ui/views/ChapterPlansListView.js, reached via
 * `#/classroom/{id}/chapter-plans`, the same classroom-scoping every
 * other classroom-level creation flow in this app already uses — see
 * ui/views/LessonPlansListView.js's own "+ New Lesson Plan", which
 * likewise never asks "which classroom" because the answer is already
 * the page you're on). Grade is resolved the identical way
 * LessonPlansListView.js already does — from the classroom itself
 * (services/classroomService.js's own getGradeLabelForClassroom()),
 * never hand-typed.
 *
 * ---------------------------------------------------------------------
 * Subject / Chapter-Unit — the classroom's OWN Learning Record tree
 * ---------------------------------------------------------------------
 *
 * Step 1 lists this classroom's own `learningRecord.subjects` (see
 * services/learningRecordService.js's getSubjects()) — real
 * LearningSubject records already configured for this classroom, never
 * the generic config/canonicalSubjectsConfig.js suggestion list (that
 * list is for CREATING a new Subject, a completely different, existing
 * flow — ui/components/AddSubjectModal.js — out of scope here). Step 3
 * lists the CHOSEN subject's own `units` (LearningUnit records) —
 * exactly the source Phase 1/2 already designed `curriculumUnitId`/
 * `linkedCurriculumUnitId` to come from (see models/ChapterPlan.js's
 * own header comment): `curriculumUnitId = unit.id` (classroom-local),
 * `linkedCurriculumUnitId = unit.linkedCurriculumUnitId` (the stable
 * cross-classroom identity, copied straight through — never
 * regenerated or guessed). A classroom with no Subjects yet, or a
 * Subject with no Units yet, gets a clear empty state pointing at
 * Learning Management rather than a broken/empty picker.
 *
 * ---------------------------------------------------------------------
 * Term — the honest, minimum-structure answer to a real gap
 * ---------------------------------------------------------------------
 *
 * Phase 1/2 both confirmed, by inspection, that NO term registry exists
 * anywhere else in this codebase (no config/*TermConfig.js, no
 * classroom.terms, nothing) — `termId` is a genuinely new concept this
 * feature alone introduces. Per explicit Phase 3 direction ("do NOT
 * invent a second term registry... if no suitable source exists, use
 * the simplest implementation consistent with the current data model
 * and report the limitation"), Step 2 here is the simplest possible
 * thing: one plain, optional free-text input, stored verbatim as
 * `termId`. No dropdown of suggested terms, no persisted "Term" entity,
 * no classroom-level term configuration — a real, reportable
 * limitation (a Fellow could type "Term 1" one time and "term one"
 * another, with nothing here normalizing either), not a gap silently
 * papered over with an invented registry this app has no other use
 * for. Optional: leaving it blank keeps `termId: null`, exactly Phase
 * 1's own default.
 */

import { getSubjects } from '../../services/learningRecordService.js';
import { getGradeLabelForClassroom } from '../../services/classroomService.js';
import * as chapterPlanService from '../../services/chapterPlanService.js';
import * as chapterPlanRepository from '../../repositories/chapterPlanRepository.js';

export function openChapterPlanCreateModal({ classroom, currentUser, onCreated }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal modal--wide chapter-plan-create-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Create Chapter Plan');

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  function close() {
    overlay.remove();
  }
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  const wizardState = { subject: null, termId: '', unit: null };
  let saveError = null;

  function renderStepHeader(stepLabel, stepNumber) {
    modal.innerHTML = '';
    modal.setAttribute('aria-label', `Create Chapter Plan — ${stepLabel}`);
    const progress = document.createElement('p');
    progress.className = 'chapter-plan-create-modal__step-label';
    progress.textContent = `Step ${stepNumber} of 3 · ${stepLabel}`;
    modal.appendChild(progress);
    const heading = document.createElement('h2');
    heading.className = 'modal__heading';
    heading.textContent = stepLabel;
    modal.appendChild(heading);
  }

  function appendActions({ onBack, onCancel = close }) {
    const actions = document.createElement('div');
    actions.className = 'modal__actions';
    if (onBack) {
      const backButton = document.createElement('button');
      backButton.type = 'button';
      backButton.className = 'btn btn--text';
      backButton.textContent = 'Back';
      backButton.addEventListener('click', onBack);
      actions.appendChild(backButton);
    }
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn btn--text';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', onCancel);
    actions.appendChild(cancelButton);
    modal.appendChild(actions);
  }

  // ---- Step 1: Subject ------------------------------------------------

  function renderSubjectStep() {
    renderStepHeader('Choose Subject', 1);

    const subjects = getSubjects(classroom);
    if (subjects.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'chapter-plan-create-modal__empty';
      empty.textContent = 'This classroom has no subjects set up yet. Add one in Learning Management first, then come back here.';
      modal.appendChild(empty);
      appendActions({});
      return;
    }

    const list = document.createElement('div');
    list.className = 'chapter-plan-create-modal__option-list';
    subjects.forEach((subject) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'chapter-plan-create-modal__option';
      option.textContent = subject.title || subject.subjectId;
      option.addEventListener('click', () => {
        wizardState.subject = subject;
        renderTermStep();
      });
      list.appendChild(option);
    });
    modal.appendChild(list);

    appendActions({});
  }

  // ---- Step 2: Term ----------------------------------------------------

  function renderTermStep() {
    renderStepHeader('Term', 2);

    const hint = document.createElement('p');
    hint.className = 'chapter-plan-create-modal__hint';
    hint.textContent = 'Optional — type whatever your school calls this term (e.g. "Term 1").';
    modal.appendChild(hint);

    const label = document.createElement('label');
    label.className = 'modal__label';
    label.textContent = 'Term';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'modal__input';
    input.placeholder = 'Term 1';
    input.value = wizardState.termId;
    input.addEventListener('input', () => {
      wizardState.termId = input.value;
    });
    label.appendChild(input);
    modal.appendChild(label);

    const nextButton = document.createElement('button');
    nextButton.type = 'button';
    nextButton.className = 'btn btn--primary';
    nextButton.textContent = 'Next';
    nextButton.addEventListener('click', () => renderUnitStep());

    const actions = document.createElement('div');
    actions.className = 'modal__actions';
    const backButton = document.createElement('button');
    backButton.type = 'button';
    backButton.className = 'btn btn--text';
    backButton.textContent = 'Back';
    backButton.addEventListener('click', renderSubjectStep);
    actions.appendChild(backButton);
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn btn--text';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', close);
    actions.appendChild(cancelButton);
    actions.appendChild(nextButton);
    modal.appendChild(actions);
  }

  // ---- Step 3: Chapter / Unit -------------------------------------------

  function renderUnitStep() {
    renderStepHeader('Chapter / Unit', 3);

    const units = wizardState.subject.units || [];
    if (units.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'chapter-plan-create-modal__empty';
      empty.textContent = `${wizardState.subject.title} has no chapters/units yet. Add one in Learning Management first, then come back here.`;
      modal.appendChild(empty);
      appendActions({ onBack: renderTermStep });
      return;
    }

    const list = document.createElement('div');
    list.className = 'chapter-plan-create-modal__option-list';
    units.forEach((unit) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'chapter-plan-create-modal__option';
      option.textContent = unit.number ? `${unit.number}. ${unit.title}` : unit.title;
      option.addEventListener('click', () => {
        wizardState.unit = unit;
        createDraftAndFinish();
      });
      list.appendChild(option);
    });
    modal.appendChild(list);

    if (saveError) {
      const error = document.createElement('p');
      error.className = 'chapter-plan-create-modal__error';
      error.textContent = saveError;
      modal.appendChild(error);
    }

    appendActions({ onBack: renderTermStep });
  }

  async function createDraftAndFinish() {
    saveError = null;
    try {
      const plan = chapterPlanService.createChapterPlanDraft({
        actingUid: currentUser?.uid,
        classroomId: classroom.id,
        teacherUid: currentUser?.uid,
        gradeLabel: getGradeLabelForClassroom(classroom),
        subjectId: wizardState.subject.subjectId,
        termId: wizardState.termId.trim() || null,
        curriculumUnitId: wizardState.unit.id,
        linkedCurriculumUnitId: wizardState.unit.linkedCurriculumUnitId || null,
        chapterName: wizardState.unit.title,
      });
      await chapterPlanRepository.saveChapterPlan(classroom.id, plan);
      close();
      onCreated(plan);
    } catch (error) {
      console.error('[ChapterPlanCreateModal] Failed to create chapter plan:', error);
      saveError = "Couldn't create this Chapter Plan. Check your connection and try again.";
      renderUnitStep();
    }
  }

  renderSubjectStep();
}
