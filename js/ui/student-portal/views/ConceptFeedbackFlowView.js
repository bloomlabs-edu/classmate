/**
 * ui/student-portal/views/ConceptFeedbackFlowView.js
 *
 * The focused, one-lesson, concept-by-concept feedback flow from the
 * approved reference ("Concept Feedback 3 of 3") — distinct from the
 * general browse-everything ui/student-portal/views/StudentLearningView.js:
 * this is scoped to exactly the EXECUTED concepts of one specific
 * Timetable Lesson (see models/Lesson.js's own
 * getFeedbackEligibleConceptIds()), presented one at a time, in order
 * — never the whole syllabus tree, and never a planned-but-not-taught
 * concept (nothing was actually presented to students for those).
 *
 * Reuses, never duplicates:
 *   - services/studentPortalDataService.js's own
 *     loadCurrentStudentAndClassroom() / setUnderstandingForCurrentStudent()
 *     — the exact same resolution + persistence
 *     StudentLearningView.js itself already uses for the same
 *     underlying write.
 *   - The same 4 selectable understanding keys StudentLearningView.js
 *     already offers (need_help/understand/confident/can_teach — see
 *     config/learningRecordConfig.js's own UNDERSTANDING_KEYS) and the
 *     same StudentConceptRecord.understanding field — no new value,
 *     no second feedback system.
 *
 * Display copy here uses the approved reference's own shorter wording
 * ("Not yet" / "Partly" / "Got it" / "Can teach") rather than
 * config/learningRecordConfig.js's existing STUDENT_UNDERSTANDING_LABELS
 * sentences — a presentation-only difference for this one screen, the
 * same "different vocabulary, same underlying key" layering that
 * config file's own header comment already establishes as this app's
 * convention, not a new understanding value.
 */

import { getStudentConceptRecord, findConcept } from '../../../services/learningRecordService.js';
import * as studentPortalDataService from '../../../services/studentPortalDataService.js';
import { createIcon } from '../../components/Icon.js';
import { renderConceptPreviewCard, renderConceptReferenceCard } from '../components/ConceptPreviewCard.js';

/**
 * Mirrors StudentLearningView.js's own SELECTABLE_UNDERSTANDING_KEYS
 * exactly (that constant isn't exported — duplicated here as a small,
 * stable, already-frozen-elsewhere set of 4 keys, not independent
 * logic that could drift). `icon`/`tone` are presentation-only
 * additions for this screen's own visual selection-card treatment
 * (Phase P) — never a new understanding value or a second vocabulary
 * layer beyond the existing label/description pair.
 */
const FEEDBACK_OPTIONS = [
  { key: 'need_help', label: 'Not yet', description: "I didn't understand this.", icon: 'x-circle', tone: 'danger' },
  { key: 'understand', label: 'Partly', description: 'I understood some of it.', icon: 'circle-dot', tone: 'warning' },
  { key: 'confident', label: 'Got it', description: 'I understood this completely.', icon: 'check-circle-2', tone: 'success' },
  { key: 'can_teach', label: 'Can teach', description: 'I could explain this to someone else.', icon: 'graduation-cap', tone: 'accent' },
];

/**
 * `lessonId` — resolved fresh, every time this opens, via
 * services/studentPortalDataService.js's getConceptFeedbackForLesson()
 * into the CURRENT executed concept ids (never a snapshot carried by
 * whatever StudentEvent linked here — see that function's own header
 * comment for why). `onDone` fires once the student reaches the end of
 * the list.
 */
export async function renderConceptFeedbackFlowView(container, { lessonId, onDone }) {
  container.innerHTML = '';

  const resolved = await studentPortalDataService.getConceptFeedbackForLesson(lessonId);
  if (!resolved || resolved.conceptIds.length === 0) {
    container.textContent = 'No concepts to give feedback on right now.';
    return;
  }
  const { conceptIds, classroom, student } = resolved;

  let index = 0;
  let done = false;

  function render() {
    container.innerHTML = '';

    if (done) {
      container.appendChild(renderCompletion());
      return;
    }

    const conceptId = conceptIds[index];
    const found = findConcept(classroom, conceptId);
    const conceptTitle = found?.concept?.title || conceptId;
    const subjectTitle = found?.subject?.title || '';
    const currentUnderstanding = getStudentConceptRecord(student, conceptId).understanding;

    const wrapper = document.createElement('div');
    wrapper.className = 'concept-feedback-flow';

    const header = document.createElement('div');
    header.className = 'concept-feedback-flow__header';
    const progress = document.createElement('p');
    progress.className = 'concept-feedback-flow__progress';
    progress.textContent = `${index + 1} of ${conceptIds.length}`;
    header.appendChild(progress);
    wrapper.appendChild(header);

    const conceptBlock = document.createElement('div');
    conceptBlock.className = 'concept-feedback-flow__concept';
    if (subjectTitle) {
      const subjectBadge = document.createElement('span');
      subjectBadge.className = 'concept-feedback-flow__subject';
      subjectBadge.textContent = subjectTitle.toUpperCase();
      conceptBlock.appendChild(subjectBadge);
    }
    const title = document.createElement('h2');
    title.className = 'concept-feedback-flow__title';
    title.textContent = conceptTitle;
    conceptBlock.appendChild(title);
    wrapper.appendChild(conceptBlock);

    // Recall before answering — the dual-access pattern's first half
    // (see ui/student-portal/components/ConceptPreviewCard.js's own
    // header comment). The title is already shown immediately above
    // in conceptBlock, so this card only adds description/resource,
    // nothing duplicated.
    if (found?.concept) {
      wrapper.appendChild(renderConceptPreviewCard(classroom.id, found.concept));
    }

    const question = document.createElement('p');
    question.className = 'concept-feedback-flow__question';
    question.textContent = 'How well do you understand this?';
    wrapper.appendChild(question);

    const optionsList = document.createElement('div');
    optionsList.className = 'concept-feedback-flow__options';
    FEEDBACK_OPTIONS.forEach(({ key, label, description, icon, tone }) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = `concept-feedback-flow__option concept-feedback-flow__option--${tone}`;
      const isSelected = currentUnderstanding === key;
      option.classList.toggle('concept-feedback-flow__option--selected', isSelected);
      option.setAttribute('aria-pressed', String(isSelected));

      const iconBadge = document.createElement('span');
      iconBadge.className = 'concept-feedback-flow__option-icon';
      iconBadge.appendChild(createIcon(icon, { size: 20 }));
      option.appendChild(iconBadge);

      const textWrap = document.createElement('span');
      textWrap.className = 'concept-feedback-flow__option-text';
      const strong = document.createElement('strong');
      strong.textContent = label;
      const span = document.createElement('span');
      span.textContent = description;
      textWrap.append(strong, span);
      option.appendChild(textWrap);

      const checkMark = document.createElement('span');
      checkMark.className = 'concept-feedback-flow__option-check';
      checkMark.appendChild(createIcon('check', { size: 14 }));
      option.appendChild(checkMark);

      option.addEventListener('click', async () => {
        await studentPortalDataService.setUnderstandingForCurrentStudent(conceptId, key);
        // setUnderstandingForCurrentStudent() persists against its OWN
        // freshly-fetched student object, not this closure's `student`
        // — without this, the "selected" highlight below would never
        // show, since this local reference would never reflect what
        // was just written. A direct, matching local update (not a
        // re-fetch) is enough: this screen's own concept-picking flow
        // never needs anything else about the student to be fresh.
        student.learningRecord = { ...student.learningRecord, [conceptId]: { ...getStudentConceptRecord(student, conceptId), understanding: key } };
        render();
      });
      optionsList.appendChild(option);
    });
    wrapper.appendChild(optionsList);

    // Revisit after answering — the dual-access pattern's second half.
    // Feedback stays quick either way: this card never blocks or
    // delays Next/Done, it's just there if the student wants it.
    if (found?.concept) {
      wrapper.appendChild(renderConceptReferenceCard(classroom.id, found.concept));
    }

    const dots = document.createElement('div');
    dots.className = 'concept-feedback-flow__dots';
    conceptIds.forEach((_, dotIndex) => {
      const dot = document.createElement('span');
      dot.className = 'concept-feedback-flow__dot';
      if (dotIndex === index) dot.classList.add('concept-feedback-flow__dot--active');
      else if (dotIndex < index) dot.classList.add('concept-feedback-flow__dot--done');
      dots.appendChild(dot);
    });
    wrapper.appendChild(dots);

    const nav = document.createElement('div');
    nav.className = 'concept-feedback-flow__nav';
    const prevButton = document.createElement('button');
    prevButton.type = 'button';
    prevButton.className = 'btn btn--ghost concept-feedback-flow__nav-prev';
    prevButton.textContent = 'Previous';
    prevButton.disabled = index === 0;
    prevButton.addEventListener('click', () => {
      index -= 1;
      render();
    });
    nav.appendChild(prevButton);

    const nextButton = document.createElement('button');
    nextButton.type = 'button';
    nextButton.className = 'btn btn--primary concept-feedback-flow__nav-next';
    nextButton.textContent = index === conceptIds.length - 1 ? 'Done' : 'Next';
    nextButton.addEventListener('click', () => {
      if (index === conceptIds.length - 1) {
        done = true;
        render();
      } else {
        index += 1;
        render();
      }
    });
    nav.appendChild(nextButton);
    wrapper.appendChild(nav);

    container.appendChild(wrapper);
  }

  /**
   * The completion state the reference implies but the flow previously
   * never showed at all — "Done" used to navigate straight back to
   * Home with no confirmation. Wording matches the approved reference
   * direction exactly ("Feedback complete" / "Your reflections have
   * been recorded."); no invented gamification (no confetti, streaks,
   * or points — this screen reports a real reflection was saved,
   * nothing else).
   */
  function renderCompletion() {
    const wrapper = document.createElement('div');
    wrapper.className = 'concept-feedback-flow concept-feedback-flow--complete';

    const iconBadge = document.createElement('div');
    iconBadge.className = 'concept-feedback-flow__complete-icon';
    iconBadge.appendChild(createIcon('check', { size: 32 }));
    wrapper.appendChild(iconBadge);

    const title = document.createElement('h2');
    title.className = 'concept-feedback-flow__complete-title';
    title.textContent = 'Feedback complete';
    wrapper.appendChild(title);

    const message = document.createElement('p');
    message.className = 'concept-feedback-flow__complete-message';
    message.textContent = 'Your reflections have been recorded.';
    wrapper.appendChild(message);

    const doneButton = document.createElement('button');
    doneButton.type = 'button';
    doneButton.className = 'btn btn--primary concept-feedback-flow__complete-done';
    doneButton.textContent = 'Done';
    doneButton.addEventListener('click', () => onDone?.());
    wrapper.appendChild(doneButton);

    return wrapper;
  }

  render();
}
