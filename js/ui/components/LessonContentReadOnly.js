/**
 * ui/components/LessonContentReadOnly.js
 *
 * The one shared "show lesson content as plain text, never a form"
 * renderer — factored out so there is exactly one read-only
 * representation of a LessonPlan field/Activity in this app, not one
 * per caller. Used by both ui/views/LessonPlanReviewView.js (a
 * reviewer reading a colleague's submission, with comment affordances
 * layered on top by that file itself) and
 * ui/components/TeachingIdeaPreviewModal.js (a teacher previewing a
 * Teaching Idea before copying it, with no comments at all) — per
 * explicit Phase 4 product direction, "do not create multiple
 * independent representations of an Activity."
 *
 * Deliberately has no opinion on comments, differentiation buttons, or
 * any interactive affordance — those are each caller's own concern,
 * added around these plain building blocks.
 */

export function renderReadOnlyField(label, value) {
  const field = document.createElement('div');
  field.className = 'lesson-content-readonly__field';

  const labelEl = document.createElement('p');
  labelEl.className = 'lesson-content-readonly__field-label';
  labelEl.textContent = label;
  field.appendChild(labelEl);

  const valueEl = document.createElement('p');
  valueEl.className = 'lesson-content-readonly__field-value';
  valueEl.textContent = value && value.trim() ? value : '—';
  if (!value || !value.trim()) valueEl.classList.add('lesson-content-readonly__field-value--empty');
  field.appendChild(valueEl);

  return field;
}

/** One Activity, plain text — title, Teacher Action, Student Action, and its differentiation buckets if present. No index/position label here (that's each caller's own numbering concern — a Teaching Idea preview has no "Activity 2," just this one activity). */
export function renderReadOnlyActivityCard({ title, teacherAction, studentAction, differentiation }) {
  const card = document.createElement('div');
  card.className = 'lesson-content-readonly__activity-card';

  const titleEl = document.createElement('p');
  titleEl.className = 'lesson-content-readonly__activity-title';
  titleEl.textContent = title || 'Untitled activity';
  card.appendChild(titleEl);

  card.appendChild(renderReadOnlyField('Teacher Action', teacherAction));
  card.appendChild(renderReadOnlyField('Student Action', studentAction));

  if (differentiation) {
    const diffWrap = document.createElement('div');
    diffWrap.className = 'lesson-content-readonly__differentiation';
    [
      { field: 'redBucket', label: 'Red Bucket' },
      { field: 'greenBucket', label: 'Green Bucket' },
      { field: 'others', label: 'Others' },
    ].forEach(({ field, label }) => {
      if (differentiation[field] && differentiation[field].trim()) {
        diffWrap.appendChild(renderReadOnlyField(label, differentiation[field]));
      }
    });
    if (diffWrap.children.length > 0) card.appendChild(diffWrap);
  }

  return card;
}

/** The small "Source: Anu · Grade 6 Fractions" attribution line — the ONE place this exact format is built, per explicit Phase 4 privacy direction (teacher + topic/grade only, never a classroom name). */
export function renderSourceAttribution({ teacherDisplayName, topic, gradeLabel }) {
  const el = document.createElement('p');
  el.className = 'lesson-content-readonly__source';
  const gradeText = gradeLabel ? ` · ${gradeLabel}` : '';
  el.textContent = `Source: ${teacherDisplayName || 'A teacher'} · ${topic || 'Untitled Lesson Plan'}${gradeText}`;
  return el;
}
