/**
 * ui/components/GuidanceOverlay.js
 *
 * The Guidance/Coachmark system's own singleton renderer — the one
 * genuinely new DOM pattern this system introduces: a callout card
 * positioned relative to an arbitrary, already-rendered element
 * anywhere on the page, appended directly to document.body (survives
 * the per-route appContainer.innerHTML rebuild — see
 * ui/router.js/main.js's own renderRoute()), the same body-level-
 * singleton shape as ui/components/Toast.js's own getContainer().
 *
 * Deliberately NOT a blocking modal: no full-page backdrop, no
 * outside-click-to-dismiss (unlike every popover in this app — see
 * utils/popupCoordinator.js's own header comment for that pattern).
 * The rest of the page stays fully interactive while a coachmark is
 * showing, per this feature's own "contextual guidance, not a forced
 * tutorial" product principle — the only ways to close it are its own
 * Skip/Done buttons or Escape.
 *
 * services/guidanceEngine.js (pure) decides WHICH step to show; this
 * file only ever renders whatever step it's told to, positions it,
 * manages focus/keyboard, and reports back when the whole flow ends.
 */

import { resolveNextStep, isLastResolvableStep } from '../../services/guidanceEngine.js';

const MAX_TARGET_WAIT_MS = 2000;
const TARGET_POLL_INTERVAL_MS = 100;

let activeSession = null;

function isTargetPresent(selector) {
  return Boolean(document.querySelector(selector));
}

/**
 * Starts `flow` from its first resolvable step. Ends any
 * currently-active flow first — only one coachmark is ever showing at
 * a time.
 *
 * `onEnd(reason)` fires exactly once, with reason one of 'completed' |
 * 'dismissed' | 'no-target' | 'superseded'. Only 'completed' should
 * ever be treated by the caller as "mark this flow's version as done"
 * (see services/guidancePreferenceService.js). 'dismissed' means the
 * teacher explicitly closed it early via Skip/Escape, AFTER having
 * seen at least one step. 'superseded' means a new playFlow() call (or
 * dismissActiveFlow()) ended it before it naturally finished — e.g. a
 * route change (see main.js, which calls dismissActiveFlow() on every
 * navigation, since a flow is always scoped to exactly one route — see
 * config/guidanceFlows.js's own header comment) — but ONLY if at least
 * one step had already been shown; a session superseded WHILE STILL
 * WAITING for its very first target to appear is reported as
 * 'no-target' instead (see endSession()'s own `hasShownAnyStep` check
 * below), since the teacher never actually saw anything in that case.
 * 'no-target' (whether from the wait timing out or from that
 * supersede-before-showing-anything case) means this render pass
 * genuinely never had anything to point at, so it should be retried
 * next time, never recorded as seen.
 */
export function playFlow(flow, { onEnd } = {}) {
  dismissActiveFlow('superseded');
  const session = {
    flow,
    previouslyFocusedEl: document.activeElement,
    onEnd,
    ended: false,
    waitTimeoutId: null,
    currentStep: null,
    // Set the moment a step is actually rendered (see showStep()) — lets
    // endSession() below tell "the teacher genuinely saw this and then
    // navigated away/dismissed it" apart from "this was superseded by a
    // route change before its target ever even appeared" (e.g. Personal
    // Hub -> the classroom setup wizard -> back to Personal Hub, all
    // within the target-wait window). Only the first case should count
    // as "seen this session."
    hasShownAnyStep: false,
  };
  activeSession = session;
  waitForStepAndShow(session, 0, Date.now());
}

/** Ends whatever flow is currently showing, if any — safe to call when nothing is active. */
export function dismissActiveFlow(reason = 'dismissed') {
  if (!activeSession) return;
  endSession(activeSession, reason);
}

function waitForStepAndShow(session, fromIndex, startedAtMs) {
  if (session.ended) return;
  const next = resolveNextStep(session.flow, fromIndex, isTargetPresent);
  if (next) {
    showStep(session, next.index);
    return;
  }
  if (Date.now() - startedAtMs >= MAX_TARGET_WAIT_MS) {
    endSession(session, 'no-target');
    return;
  }
  // Bounded poll, not a MutationObserver — this app's routes fully
  // rebuild their container's innerHTML on nearly every render pass
  // (Firestore snapshots included), which would make a general-purpose
  // observer noisy to keep correct; a short poll is simpler and matches
  // this codebase's existing "simple and explicit" bias, and 2 seconds
  // is comfortably longer than any of this app's own one-time-fetch
  // mounts (e.g. ui/views/MyWorkView.js's own Task load).
  session.waitTimeoutId = setTimeout(() => waitForStepAndShow(session, fromIndex, startedAtMs), TARGET_POLL_INTERVAL_MS);
}

function showStep(session, index) {
  teardownCurrentStep(session);
  const step = session.flow.steps[index];
  const target = document.querySelector(step.targetSelector);
  if (!target) {
    // Vanished between resolveNextStep()'s own check and now (rare
    // render race) — treat exactly like "not yet present."
    waitForStepAndShow(session, index, Date.now());
    return;
  }

  session.hasShownAnyStep = true;
  target.scrollIntoView({ block: 'center' });
  target.classList.add('guidance-highlight');

  const card = document.createElement('div');
  card.className = 'guidance-card';
  card.setAttribute('role', 'dialog');
  // Deliberately 'false', not 'true' — see this module's own header
  // comment on why the rest of the page must stay interactive.
  card.setAttribute('aria-modal', 'false');
  card.tabIndex = -1;

  const titleId = `guidance-title-${session.flow.id}-${index}`;
  const bodyId = `guidance-body-${session.flow.id}-${index}`;
  card.setAttribute('aria-labelledby', titleId);
  card.setAttribute('aria-describedby', bodyId);

  const title = document.createElement('h2');
  title.id = titleId;
  title.className = 'guidance-card__title';
  title.textContent = step.title;
  card.appendChild(title);

  const body = document.createElement('p');
  body.id = bodyId;
  body.className = 'guidance-card__body';
  body.textContent = step.body;
  card.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'guidance-card__actions';

  const isLast = isLastResolvableStep(session.flow, index, isTargetPresent);

  const skipButton = document.createElement('button');
  skipButton.type = 'button';
  skipButton.className = 'btn btn--text guidance-card__skip';
  skipButton.textContent = isLast ? 'Close' : 'Skip';
  skipButton.addEventListener('click', () => endSession(session, 'dismissed'));
  actions.appendChild(skipButton);

  const primaryButton = document.createElement('button');
  primaryButton.type = 'button';
  primaryButton.className = 'btn btn--primary guidance-card__primary';
  primaryButton.textContent = isLast ? 'Got it' : 'Next';
  primaryButton.addEventListener('click', () => {
    if (isLast) {
      endSession(session, 'completed');
    } else {
      waitForStepAndShow(session, index + 1, Date.now());
    }
  });
  actions.appendChild(primaryButton);
  // "Got it" reads as the natural finishing action, so it's the one
  // Enter/Space-reachable primary button — placed after Skip in the DOM
  // (matching every modal's own action-row order in this app, e.g.
  // AddNoteModal.js's Save button) but focused first via card.focus()
  // below landing on the card, not a button, so Tab order still starts
  // at Skip either way.

  card.appendChild(actions);
  document.body.appendChild(card);
  positionCard(card, target);

  const reposition = () => positionCard(card, target);
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, true);

  function handleKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      endSession(session, 'dismissed');
      return;
    }
    if (event.key === 'Tab') {
      trapTab(event, [skipButton, primaryButton]);
    }
  }
  document.addEventListener('keydown', handleKeydown, true);

  session.currentStep = {
    target,
    cleanup: () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      document.removeEventListener('keydown', handleKeydown, true);
      target.classList.remove('guidance-highlight');
      card.remove();
    },
  };

  // Focuses the dialog container itself (tabindex="-1"), not a button
  // directly — this is what makes a screen reader announce the
  // dialog's own aria-labelledby/aria-describedby (the title + body)
  // on open, before the teacher tabs into its buttons, rather than
  // jumping straight to "Skip" with no context announced first.
  card.focus();
}

function teardownCurrentStep(session) {
  if (session.currentStep) {
    session.currentStep.cleanup();
    session.currentStep = null;
  }
}

/** A small, local Tab trap over exactly this card's two buttons — this app has no shared focus-trap utility (every dialog/popover hand-rolls its own, e.g. ui/components/UserBar.js's classroom switcher), and two buttons is too small a surface to justify introducing one now. */
function trapTab(event, focusableEls) {
  const first = focusableEls[0];
  const last = focusableEls[focusableEls.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/** Viewport-relative (the card is `position: fixed` — see css/styles.css), so no scroll-offset math is needed; the window `scroll` listener above simply recomputes this from fresh getBoundingClientRect() calls on every scroll tick. */
function positionCard(card, target) {
  const rect = target.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const margin = 12;

  let top = rect.bottom + margin;
  if (top + cardRect.height + margin > window.innerHeight) {
    top = rect.top - cardRect.height - margin;
  }
  top = Math.max(margin, top);

  let left = rect.left;
  const maxLeft = window.innerWidth - cardRect.width - margin;
  left = Math.max(margin, Math.min(left, maxLeft));

  card.style.top = `${top}px`;
  card.style.left = `${left}px`;
}

function endSession(session, reason) {
  if (session.ended) return;
  session.ended = true;
  clearTimeout(session.waitTimeoutId);
  teardownCurrentStep(session);
  if (activeSession === session) activeSession = null;

  const restoreTarget = session.previouslyFocusedEl;
  if (restoreTarget && document.body.contains(restoreTarget) && typeof restoreTarget.focus === 'function') {
    restoreTarget.focus();
  }

  // A session that ended WITHOUT ever actually rendering a step (e.g.
  // superseded by a route change while still waiting for its target to
  // appear) reports as 'no-target' regardless of the literal reason it
  // was ended for — the teacher never saw anything, so the caller
  // should retry later exactly like a genuine missing-target case, not
  // treat it as "seen and dismissed."
  const effectiveReason = session.hasShownAnyStep || reason === 'completed' ? reason : 'no-target';
  session.onEnd?.(effectiveReason);
}
