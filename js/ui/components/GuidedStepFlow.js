/**
 * ui/components/GuidedStepFlow.js
 *
 * A generic, reusable progressive-disclosure flow: one step expanded at
 * a time, a lightweight "A → B → C" progress indicator above it, and
 * every other step collapsed to a single compact row (a ✓ checkpoint
 * summary once it has real content, a plain muted label otherwise).
 * Carries ZERO domain knowledge of any particular feature — a caller
 * supplies `steps` (label/question/helper/filled/summary/renderContent)
 * and owns which index is active; this file only ever renders what it's
 * given and reports navigation intent back via `onNavigate`.
 *
 * Deliberately NOT gated on completion: `onNavigate(index)` is called
 * for ANY `index` in range — Back, Next, clicking a progress-indicator
 * step, or clicking a collapsed checkpoint all funnel through the same
 * callback, and this file never refuses to move because a step is
 * "empty." Whether moving past an empty step is allowed is a decision
 * this component doesn't even model — there is no validation hook here
 * at all, so a caller can't accidentally wire one in by extending this
 * file. (Keep it this way — see e.g.
 * ui/views/ChapterPlanGuidedStepsDisplay.js's own header comment on why
 * navigation and submission validation must stay two separate concerns.)
 *
 * Each `steps[i]` is:
 *   { key, label, question, helper (optional), filled (bool),
 *     summary (string, shown only when filled), renderContent(container) }
 */

const SUMMARY_MAX_LENGTH = 90;

/** Exported purely so it's independently unit-testable — see this file's own header comment on why the DOM-building code around it isn't. */
export function truncateStepSummary(text, maxLength = SUMMARY_MAX_LENGTH) {
  const trimmed = (text || '').trim();
  if (trimmed.length <= maxLength) return trimmed;
  return trimmed.slice(0, maxLength - 1).trimEnd() + '…';
}

export function renderGuidedStepFlow({ steps, activeIndex, onNavigate }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'guided-step-flow';

  wrapper.appendChild(renderProgressIndicator(steps, activeIndex, onNavigate));

  steps.forEach((step, index) => {
    wrapper.appendChild(renderStep(step, index, steps.length, activeIndex, onNavigate));
  });

  return wrapper;
}

function renderProgressIndicator(steps, activeIndex, onNavigate) {
  const bar = document.createElement('div');
  bar.className = 'guided-step-flow__progress';

  steps.forEach((step, index) => {
    if (index > 0) {
      const arrow = document.createElement('span');
      arrow.className = 'guided-step-flow__progress-arrow';
      arrow.textContent = '→';
      arrow.setAttribute('aria-hidden', 'true');
      bar.appendChild(arrow);
    }

    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'guided-step-flow__progress-item';
    if (index === activeIndex) item.classList.add('guided-step-flow__progress-item--active');
    if (step.filled) item.classList.add('guided-step-flow__progress-item--filled');
    item.textContent = step.label;
    item.addEventListener('click', () => onNavigate(index));
    bar.appendChild(item);
  });

  return bar;
}

function renderStep(step, index, stepCount, activeIndex, onNavigate) {
  const isActive = index === activeIndex;

  const section = document.createElement('div');
  section.className = 'guided-step-flow__step';

  if (!isActive) {
    section.classList.add('guided-step-flow__step--collapsed');
    section.appendChild(renderCollapsedStep(step, index, onNavigate));
    return section;
  }

  section.classList.add('guided-step-flow__step--active');

  const heading = document.createElement('div');
  heading.className = 'guided-step-flow__step-heading';

  const counter = document.createElement('span');
  counter.className = 'guided-step-flow__step-counter';
  counter.textContent = `${index + 1} of ${stepCount}`;
  heading.appendChild(counter);

  const question = document.createElement('h2');
  question.className = 'guided-step-flow__step-question';
  question.textContent = step.question || step.label;
  heading.appendChild(question);

  section.appendChild(heading);

  if (step.helper) {
    const helper = document.createElement('p');
    helper.className = 'guided-step-flow__step-helper';
    helper.textContent = step.helper;
    section.appendChild(helper);
  }

  const content = document.createElement('div');
  content.className = 'guided-step-flow__step-content';
  step.renderContent(content);
  section.appendChild(content);

  section.appendChild(renderStepNav(index, stepCount, onNavigate));

  return section;
}

function renderCollapsedStep(step, index, onNavigate) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'guided-step-flow__step-summary';
  if (step.filled) button.classList.add('guided-step-flow__step-summary--filled');
  button.addEventListener('click', () => onNavigate(index));

  if (step.filled) {
    const check = document.createElement('span');
    check.className = 'guided-step-flow__step-summary-check';
    check.textContent = '✓';
    check.setAttribute('aria-hidden', 'true');
    button.appendChild(check);
  }

  const textWrap = document.createElement('span');
  textWrap.className = 'guided-step-flow__step-summary-text';

  const title = document.createElement('span');
  title.className = 'guided-step-flow__step-summary-title';
  title.textContent = step.label;
  textWrap.appendChild(title);

  const preview = document.createElement('span');
  preview.className = 'guided-step-flow__step-summary-preview';
  preview.textContent = step.filled ? truncateStepSummary(step.summary) : 'Not started yet';
  if (!step.filled) preview.classList.add('guided-step-flow__step-summary-preview--empty');
  textWrap.appendChild(preview);

  button.appendChild(textWrap);
  return button;
}

/** Back/Next — unconditional (see this file's own header comment); Back hides at the first step, Next hides at the last. */
function renderStepNav(index, stepCount, onNavigate) {
  const nav = document.createElement('div');
  nav.className = 'guided-step-flow__step-nav';

  if (index > 0) {
    const backButton = document.createElement('button');
    backButton.type = 'button';
    backButton.className = 'btn btn--secondary guided-step-flow__step-back';
    backButton.textContent = '← Back';
    backButton.addEventListener('click', () => onNavigate(index - 1));
    nav.appendChild(backButton);
  }

  if (index < stepCount - 1) {
    const nextButton = document.createElement('button');
    nextButton.type = 'button';
    nextButton.className = 'btn btn--primary guided-step-flow__step-next';
    nextButton.textContent = 'Next →';
    nextButton.addEventListener('click', () => onNavigate(index + 1));
    nav.appendChild(nextButton);
  }

  return nav;
}
