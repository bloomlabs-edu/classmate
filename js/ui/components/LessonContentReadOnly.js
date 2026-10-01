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

import { getActivityInteractions } from '../../models/LessonPlan.js';
import { createIcon } from './Icon.js';

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

/**
 * One Activity, plain text — title, its sequence of Teacher<->Students
 * interaction pairs (see models/LessonPlan.js's own getActivityInteractions()
 * — renders identically whether this Activity/Spark predates the
 * 2026-10 paired-interactions redesign or not), and its differentiation
 * buckets if present. No index/position label here (that's each
 * caller's own numbering concern — a Teaching Idea preview has no
 * "Activity 2," just this one activity). Accepts the FULL
 * Activity/Spark object (never pre-destructured individual fields) so
 * getActivityInteractions() can read whichever shape it actually has.
 */
export function renderReadOnlyActivityCard(activityOrSpark) {
  const { title, differentiation } = activityOrSpark;
  const card = document.createElement('div');
  card.className = 'lesson-content-readonly__activity-card';

  const titleEl = document.createElement('p');
  titleEl.className = 'lesson-content-readonly__activity-title';
  titleEl.textContent = title || 'Untitled activity';
  card.appendChild(titleEl);

  getActivityInteractions(activityOrSpark).forEach((interaction, index) => {
    card.appendChild(renderReadOnlyInteraction(interaction, index));
  });

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

/** One Teacher<->Students interaction pair, plain text — the shared read-only mirror of ui/views/LessonPlanBuilderView.js's own renderInteractionRow()/ui/views/LessonPlanReviewView.js's own renderInteractionSegment(), same icon+label/tinted-side visual language, so every surface (authoring, reviewer, Teaching Ideas preview) shows the identical paired structure. */
function renderReadOnlyInteraction(interaction, index) {
  const wrap = document.createElement('div');
  wrap.className = 'lesson-content-readonly__interaction';

  const label = document.createElement('p');
  label.className = 'lesson-content-readonly__interaction-label';
  label.textContent = `Interaction ${index + 1}`;
  wrap.appendChild(label);

  const pair = document.createElement('div');
  pair.className = 'lesson-content-readonly__interaction-pair';
  pair.appendChild(renderReadOnlyInteractionSide('Teacher', 'chalkboard-easel', interaction.teacherAction, 'teacher'));
  pair.appendChild(renderReadOnlyInteractionSide('Students', 'users', interaction.studentAction, 'students'));
  wrap.appendChild(pair);

  return wrap;
}

function renderReadOnlyInteractionSide(label, iconName, value, side) {
  const sideEl = document.createElement('div');
  sideEl.className = `lesson-content-readonly__interaction-side lesson-content-readonly__interaction-side--${side}`;

  const labelRow = document.createElement('div');
  labelRow.className = 'lesson-content-readonly__interaction-side-label';
  labelRow.appendChild(createIcon(iconName, { size: 14 }));
  const labelText = document.createElement('span');
  labelText.textContent = label.toUpperCase();
  labelRow.appendChild(labelText);
  sideEl.appendChild(labelRow);

  const valueEl = document.createElement('p');
  valueEl.className = 'lesson-content-readonly__field-value';
  valueEl.textContent = value && value.trim() ? value : '—';
  if (!value || !value.trim()) valueEl.classList.add('lesson-content-readonly__field-value--empty');
  sideEl.appendChild(valueEl);

  return sideEl;
}

/** The small "Source: Anu · Grade 6 Fractions" attribution line — the ONE place this exact format is built, per explicit Phase 4 privacy direction (teacher + topic/grade only, never a classroom name). */
export function renderSourceAttribution({ teacherDisplayName, topic, gradeLabel }) {
  const el = document.createElement('p');
  el.className = 'lesson-content-readonly__source';
  const gradeText = gradeLabel ? ` · ${gradeLabel}` : '';
  el.textContent = `Source: ${teacherDisplayName || 'A teacher'} · ${topic || 'Untitled Lesson Plan'}${gradeText}`;
  return el;
}
