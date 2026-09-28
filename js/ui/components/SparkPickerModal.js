/**
 * ui/components/SparkPickerModal.js
 *
 * The Chapter Plan Editor's own "✨ Browse Sparks" entry point — a thin
 * modal shell around ui/components/SparkBrowser.js, wired to
 * services/chapterPlanService.js's own addSparkRef() as the ONE thing
 * "Use Spark" ever does: append a reference, never copy the Spark's
 * own content (see models/ChapterPlanSparkRef.js's own header
 * comment). Modeled on ui/components/TeachingIdeasPickerModal.js's own
 * shape, with the underlying entity swapped for the independent Spark.
 *
 * The UI language is deliberately "Used in this Chapter Plan," never
 * "Copied" — per explicit product direction, so nothing here implies a
 * duplicate now exists. A duplicate (same Spark, same section) is
 * rejected by services/chapterPlanService.js's own addSparkRef() itself
 * — this modal surfaces that as a plain, friendly message rather than
 * treating it as a crash.
 */

import { renderSparkBrowser } from './SparkBrowser.js';
import * as chapterPlanService from '../../services/chapterPlanService.js';
import * as chapterPlanRepository from '../../repositories/chapterPlanRepository.js';

const SECTION_LABELS = Object.freeze({
  keyMethods: 'Key Methods',
  revisionIdeas: 'Revision Ideas',
  subjectSpecific: 'Subject-Specific',
});

/**
 * @param {object} options
 * @param {object} options.classroom
 * @param {object} options.chapterPlan
 * @param {string} options.section - one of models/ChapterPlan.js's own CHAPTER_PLAN_SPARK_SECTIONS
 * @param {string} options.currentUserUid
 * @param {(chapterPlan: object) => void} options.onSparkUsed - called with the freshly-saved plan after a successful "Use Spark"
 */
export function openSparkPickerModal({ classroom, chapterPlan, section, currentUserUid, onSparkUsed }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal modal--wide';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Browse Sparks');

  const heading = document.createElement('h2');
  heading.className = 'modal__heading';
  heading.textContent = `✨ Browse Sparks — ${SECTION_LABELS[section] || section}`;
  modal.appendChild(heading);

  const feedback = document.createElement('p');
  feedback.className = 'spark-picker-modal__feedback';
  modal.appendChild(feedback);

  const browserContainer = document.createElement('div');
  modal.appendChild(browserContainer);

  function close() {
    overlay.remove();
  }
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  const actions = document.createElement('div');
  actions.className = 'modal__actions';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'btn btn--text';
  closeButton.textContent = 'Close';
  closeButton.addEventListener('click', close);
  actions.appendChild(closeButton);
  modal.appendChild(actions);

  renderSparkBrowser(browserContainer, {
    linkedCurriculumUnitId: chapterPlan.linkedCurriculumUnitId,
    subjectId: chapterPlan.subjectId,
    gradeLabel: chapterPlan.gradeLabel,
    conceptIds: chapterPlan.conceptIds,
    onUseSpark: async (spark) => {
      feedback.textContent = '';
      try {
        chapterPlanService.addSparkRef(chapterPlan, { sparkId: spark.id, section, addedBy: currentUserUid });
        await chapterPlanRepository.saveChapterPlan(classroom.id, chapterPlan);
        feedback.className = 'spark-picker-modal__feedback spark-picker-modal__feedback--success';
        feedback.textContent = `“${spark.title}” — Used in this Chapter Plan.`;
        onSparkUsed(chapterPlan);
      } catch (error) {
        feedback.className = 'spark-picker-modal__feedback spark-picker-modal__feedback--error';
        feedback.textContent = error.message || "Couldn't use this Spark. Try again.";
      }
    },
  });

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}
