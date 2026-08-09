/**
 * ui/student-portal/views/StudentGoalTrackerView.js
 *
 * Goals — Phase 1, student-facing. One screen, per category, showing
 * whichever state that category is actually in: no goal yet (a text
 * entry form), pending approval (locked-looking, with an explicit
 * Edit action), or approved (locked text, a one-tap daily "Completed
 * Today" toggle, and live streak/completion stats).
 *
 * All data — reads and writes — goes through
 * services/studentPortalDataService.js's new Goals functions, never
 * goalService.js/goalCompletionService.js directly, matching this
 * app's own established "views own their content, the data service
 * owns all data access" split for every other Student Portal screen.
 * Every number shown here is read fresh, every time this screen opens
 * — there is no cached streak or percentage anywhere in this file.
 *
 * Four categories are four fully independent submissions — each has
 * its own Goal record (see models/Goal.js), its own status, its own
 * text. Submitting one never touches the other three's own data.
 *
 * DRAFTS (below) exists specifically because submitting one category
 * re-renders the whole screen (the simplest, already-established
 * pattern every other Student Portal view uses) — without it, any
 * unsaved text a student had typed into a SIBLING category's own
 * textarea would be lost the instant any one category re-renders,
 * since a freshly-rebuilt textarea only knows about its own
 * category's own PERSISTED text, never what's still sitting,
 * unsubmitted, in a browser field. Deliberately local, in-memory,
 * per-category state — never written to Firestore, exactly matching
 * the explicit product decision that unsaved draft text doesn't need
 * to survive anything beyond this one browser session.
 */

import { getGoalCycleForCurrentStudent, submitGoalForCurrentStudent } from '../../../services/studentGoalsService.js';
// KNOWN GAP, deliberately out of scope for this milestone: the daily
// completion toggle below still reads/writes through the OLD,
// cycle-based path — an already-approved goal's own streak/completion
// tracking is unaffected by this milestone's own acceptance test, so
// it hasn't been moved yet. It will break once a real goal reaches
// 'approved' status without a matching entry in the old
// cycle.goals[] shape, since it no longer exists there at all.
import { setGoalCompletionForCurrentStudent } from '../../../services/studentPortalDataService.js';
import { createBackButton } from '../../components/BackButton.js';
import { createEmptyStateElement } from '../../components/EmptyState.js';
import { getTodayDateKey } from '../../../utils/dateHelpers.js';
import { getActiveProfile } from '../../../services/studentDeviceService.js';

// Module-level, not closure-scoped inside renderStudentGoalTrackerView()
// below — confirmed, this screen is re-invoked from scratch (a fresh
// call to the exported function itself, not this file's own internal
// rerender()) by the Student Portal's live classroom subscription
// (see main.js's own startClassroomSubscription() callback), which
// fires on every workspaceService.save() — including the one this
// screen's own goal submission triggers. State scoped inside the
// exported function is wiped out by that external re-invocation;
// state scoped here, at module level, survives it. This was the
// actual root cause of drafts being lost on submission — the
// original, closure-scoped version only ever protected against this
// file's own internal re-renders, never the live-subscription-driven
// external ones that a save itself sets in motion.
const drafts = {};
const editingCategoryIds = new Set();

// Same reasoning as drafts/editingCategoryIds above, applied to one
// more thing that needs to survive any re-invocation: a category's
// own "just submitted" goal. Mutating lastCycle locally (what the
// previous fix did) is correct the instant it happens, but lastCycle
// itself is closure-scoped to ONE invocation — a later, externally
// triggered re-invocation's own fresh getGoalCycleForCurrentStudent()
// read can still land before that write has round-tripped in a real,
// networked Firestore (this app's own test harness resolves
// everything synchronously, which is exactly why that race was never
// visible there), silently repainting the category back to its
// pre-submission state. Tracking the confirmed-correct value here, at
// module level, and applying it as an override in render() below,
// means a stale read can never regress an already-known-correct
// submission — it only ever gets replaced once a fresh read agrees
// with (or supersedes) it.
//
// Keyed by `${studentId}::${cycleId}::${categoryId}`, not categoryId
// alone — this is module-level state, so a bare categoryId key could
// otherwise leak across a different student's own session, or across
// a different Goal Cycle that happens to reuse the same category id.
// studentId comes from studentDeviceService.getActiveProfile() (the
// same function studentPortalDataService.js itself already uses to
// resolve "who is active"); cycleId comes from the cycle this file
// already fetches. No new model field — both ids already existed.
console.log('[LSRW-DIAG] StudentGoalTrackerView.js MODULE LOADED — build marker: optimisticGoals-with-scoping-diagnostic-v1', { timestamp: Date.now() });

const optimisticGoals = {};

export async function renderStudentGoalTrackerView(container, { onBack }) {
  window.__lsrwInvocationCount = (window.__lsrwInvocationCount || 0) + 1;
  const instanceId = Math.random().toString(36).slice(2, 8);
  console.log(`[LSRW-DIAG][${instanceId}] renderStudentGoalTrackerView() CALLED — invocation #${window.__lsrwInvocationCount}`, { timestamp: Date.now() });
  let lastCycle = null;

  // Scopes a module-level optimisticGoals entry to this exact
  // student + cycle + category, never categoryId alone — categoryId
  // is only guaranteed unique within one cycle (see
  // models/GoalCycle.js), never across a different student's own
  // session or a different cycle that happens to reuse the same
  // category id. Uses only IDs the existing data already exposes —
  // getActiveProfile().studentId (the same function
  // studentPortalDataService.js itself uses to resolve "who is
  // active") and lastCycle.cycleId — no new model field introduced.
  function buildOptimisticKey(categoryId) {
    const studentId = getActiveProfile()?.studentId ?? 'unknown';
    const cycleId = lastCycle?.cycleId ?? 'unknown';
    return `${studentId}::${cycleId}::${categoryId}`;
  }

  function buildHandlers() {
    return {
      onBack,
      drafts,
      editingCategoryIds,
      onDraftChange: (categoryId, text) => {
        drafts[categoryId] = text;
      },
      onSubmitGoal: async (categoryId, text) => {
        console.log(`[LSRW-DIAG][${instanceId}] onSubmitGoal() CALLED for categoryId=${categoryId}`, { timestamp: Date.now(), text });
        const succeeded = await submitGoalForCurrentStudent(categoryId, text);
        console.log(`[LSRW-DIAG][${instanceId}] submitGoalForCurrentStudent() RETURNED succeeded=${succeeded}`, { timestamp: Date.now() });
        if (succeeded) {
          delete drafts[categoryId];
          editingCategoryIds.delete(categoryId);
          const key = buildOptimisticKey(categoryId);
          console.log(`[LSRW-DIAG][${instanceId}] WRITING optimisticGoals[${key}] = pending_approval, text="${text}"`, { timestamp: Date.now(), lastCycleId: lastCycle?.cycleId, allOptimisticKeysBeforeWrite: Object.keys(optimisticGoals) });
          optimisticGoals[key] = {
            id: optimisticGoals[key]?.id ?? categoryId,
            text,
            status: 'pending_approval',
            completedToday: false,
            currentStreak: 0,
            longestStreak: 0,
            weeklyCompletionPercent: 0,
            overallCompletionPercent: 0,
          };
          console.log(`[LSRW-DIAG][${instanceId}] AFTER WRITE, calling renderNow(). Full optimisticGoals now:`, { timestamp: Date.now(), optimisticGoals: JSON.parse(JSON.stringify(optimisticGoals)) });
          renderNow();
        } else {
          console.log(`[LSRW-DIAG][${instanceId}] submission FAILED, falling back to rerender()`, { timestamp: Date.now() });
          await rerender();
        }
      },
      onStartEdit: (categoryId) => {
        editingCategoryIds.add(categoryId);
        renderNow();
      },
      onCancelEdit: (categoryId) => {
        editingCategoryIds.delete(categoryId);
        delete drafts[categoryId];
        renderNow();
      },
      onToggleCompletion: async (goalId, completed) => {
        await setGoalCompletionForCurrentStudent(goalId, getTodayDateKey(), completed);
        await rerender();
      },
    };
  }

  // Starting/cancelling an edit is a pure local-state change — no
  // data actually changed, so this re-renders from the last-fetched
  // cycle directly rather than re-fetching it, avoiding an
  // unnecessary data round-trip for a UI-only toggle.
  function renderNow() {
    console.log(`[LSRW-DIAG][${instanceId}] renderNow() CALLED (uses existing lastCycle, no fresh fetch)`, { timestamp: Date.now(), lastCycleId: lastCycle?.cycleId });
    applyOptimisticOverrides(lastCycle);
    render(container, lastCycle, buildHandlers());
  }

  async function rerender() {
    console.log(`[LSRW-DIAG][${instanceId}] rerender() CALLED — about to fetch FRESH cycle data`, { timestamp: Date.now() });
    lastCycle = await getGoalCycleForCurrentStudent();
    const listeningCategory = lastCycle?.categories.find((c) => c.categoryName === 'Listening');
    console.log(`[LSRW-DIAG][${instanceId}] rerender() FRESH FETCH RETURNED`, {
      timestamp: Date.now(),
      cycleId: lastCycle?.cycleId,
      studentId: getActiveProfile()?.studentId,
      listeningCategoryId: listeningCategory?.categoryId,
      listeningGoalExists: !!listeningCategory?.goal,
      listeningGoalText: listeningCategory?.goal?.text,
      listeningGoalStatus: listeningCategory?.goal?.status,
      optimisticGoalsHasListeningKey: listeningCategory ? Object.keys(optimisticGoals).some((k) => k.endsWith(`::${listeningCategory.categoryId}`)) : null,
    });
    applyOptimisticOverrides(lastCycle);
    const listeningAfterOverride = lastCycle?.categories.find((c) => c.categoryName === 'Listening');
    console.log(`[LSRW-DIAG][${instanceId}] rerender() AFTER applyOptimisticOverrides — final state about to be rendered`, {
      timestamp: Date.now(),
      listeningGoalExists: !!listeningAfterOverride?.goal,
      listeningGoalText: listeningAfterOverride?.goal?.text,
      listeningGoalStatus: listeningAfterOverride?.goal?.status,
    });
    render(container, lastCycle, buildHandlers());
  }

  await rerender();
}

/**
 * Overwrites each category's own `goal` with its module-level
 * optimisticGoals entry, when one exists AND the fresh read hasn't
 * caught up to it yet — applied on every render, from every path
 * (internal or externally triggered), so a fresh-but-stale read of
 * the cycle can never silently undo an already-confirmed submission.
 *
 * The override is cleared the moment a fresh read's own text matches
 * it — deliberately, not kept forever: once the real data has caught
 * up, it may already be MORE current than the override (e.g. a
 * teacher has since approved it, or real streak/completion stats now
 * exist) — an override that never expired would permanently hide
 * that. See this file's own header comment for why this exists at
 * all.
 */
function applyOptimisticOverrides(cycle) {
  if (!cycle) {
    console.log('[LSRW-DIAG] applyOptimisticOverrides() called with cycle=null, returning early', { timestamp: Date.now() });
    return;
  }
  const studentId = getActiveProfile()?.studentId ?? 'unknown';
  cycle.categories.forEach((category) => {
    const key = `${studentId}::${cycle.cycleId}::${category.categoryId}`;
    const override = optimisticGoals[key];
    if (category.categoryName === 'Listening') {
      console.log('[LSRW-DIAG] applyOptimisticOverrides() checking Listening', {
        timestamp: Date.now(),
        key,
        overrideExists: !!override,
        overrideText: override?.text,
        currentCategoryGoalExists: !!category.goal,
        currentCategoryGoalText: category.goal?.text,
        allOptimisticKeys: Object.keys(optimisticGoals),
      });
    }
    if (!override) return;

    if (category.goal && category.goal.text === override.text) {
      // The real data has caught up — defer to it from now on, since
      // it may already know things the override never could (e.g. a
      // teacher's own approval).
      if (category.categoryName === 'Listening') {
        console.log('[LSRW-DIAG] applyOptimisticOverrides() Listening — CLEARING override, real data matches', { timestamp: Date.now() });
      }
      delete optimisticGoals[key];
      return;
    }

    if (category.categoryName === 'Listening') {
      console.log('[LSRW-DIAG] applyOptimisticOverrides() Listening — APPLYING override on top of category.goal', { timestamp: Date.now() });
    }
    category.goal = override;
  });
}

function render(container, cycle, handlers) {
  const listeningCategory = cycle?.categories.find((c) => c.categoryName === 'Listening');
  console.log('[LSRW-DIAG] render() — FINAL state immediately before container.innerHTML is written', {
    timestamp: Date.now(),
    hasCycle: !!cycle,
    listeningGoalExists: !!listeningCategory?.goal,
    listeningGoalText: listeningCategory?.goal?.text,
    listeningGoalStatus: listeningCategory?.goal?.status,
    willRenderBranch: !listeningCategory ? 'no-category' : !listeningCategory.goal ? 'EMPTY ENTRY FORM (no goal)' : listeningCategory.goal.status === 'pending_approval' ? 'SUBMITTED' : 'approved',
  });
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'student-goal-tracker';

  const header = document.createElement('div');
  header.className = 'student-goal-tracker__header';
  header.appendChild(createBackButton(handlers.onBack));
  wrapper.appendChild(header);

  if (!cycle) {
    wrapper.appendChild(createEmptyStateElement({ message: 'There\u2019s no active Goal Cycle right now. Check back once your teacher starts one.' }));
    container.appendChild(wrapper);
    return;
  }

  const title = document.createElement('h1');
  title.className = 'student-goal-tracker__title';
  title.textContent = cycle.cycleTitle;
  wrapper.appendChild(title);

  const dates = document.createElement('p');
  dates.className = 'student-goal-tracker__dates';
  dates.textContent = `${cycle.startDate} \u2192 ${cycle.endDate}`;
  wrapper.appendChild(dates);

  if (cycle.categories.length === 0) {
    // A cycle can genuinely exist with zero categories yet — the
    // teacher creates the cycle and adds categories as two separate
    // steps in ui/views/GoalManagementView.js. Without this, the
    // student sees nothing at all below the dates, with no way to
    // know anything is missing.
    wrapper.appendChild(
      createEmptyStateElement({ message: 'Your teacher hasn\u2019t added any categories to this cycle yet. Check back soon.' })
    );
    container.appendChild(wrapper);
    return;
  }

  cycle.categories.forEach((category) => {
    wrapper.appendChild(renderCategoryCard(category, handlers));
  });

  container.appendChild(wrapper);
}

function renderCategoryCard(category, handlers) {
  const card = document.createElement('div');
  card.className = 'student-goal-card';

  const heading = document.createElement('h2');
  heading.className = 'student-goal-card__category';
  heading.textContent = category.categoryName;
  card.appendChild(heading);

  if (!category.goal) {
    card.appendChild(renderGoalEntryForm(category, handlers, handlers.drafts[category.categoryId] ?? ''));
    return card;
  }

  if (category.goal.status === 'pending_approval') {
    if (handlers.editingCategoryIds.has(category.categoryId)) {
      card.appendChild(renderGoalEntryForm(category, handlers, handlers.drafts[category.categoryId] ?? category.goal.text));
      const cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.className = 'btn btn--text';
      cancelButton.textContent = 'Cancel';
      cancelButton.addEventListener('click', () => handlers.onCancelEdit(category.categoryId));
      card.appendChild(cancelButton);
      return card;
    }

    // Locked-looking, per explicit product decision: a submitted
    // goal reads as "done," not as an always-open textarea a student
    // has to notice is still editable. Still genuinely
    // 'pending_approval' underneath — this is a presentation choice
    // only; the teacher-approval gate itself (see
    // services/goalService.js's own approveGoal()) is completely
    // untouched.
    const goalText = document.createElement('p');
    goalText.className = 'student-goal-card__text';
    goalText.textContent = `\u201C${category.goal.text}\u201D`;
    card.appendChild(goalText);

    const statusRow = document.createElement('div');
    statusRow.className = 'student-goal-card__status-row';
    const statusBadge = document.createElement('span');
    statusBadge.className = 'student-goal-card__submitted-badge';
    statusBadge.textContent = 'Submitted';
    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'btn btn--text';
    editButton.textContent = 'Edit';
    editButton.addEventListener('click', () => handlers.onStartEdit(category.categoryId));
    statusRow.append(statusBadge, editButton);
    card.appendChild(statusRow);

    return card;
  }

  // Approved — locked text, daily toggle, live stats. Per explicit
  // product decision (models/Goal.js's own header comment), editing
  // an approved goal is a deliberately deferred future feature, not
  // built here — unaffected by this change.
  const goalText = document.createElement('p');
  goalText.className = 'student-goal-card__text';
  goalText.textContent = `\u201C${category.goal.text}\u201D`;
  card.appendChild(goalText);

  const toggleLabel = document.createElement('label');
  toggleLabel.className = 'student-goal-card__toggle';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = category.goal.completedToday;
  checkbox.addEventListener('change', () => handlers.onToggleCompletion(category.goal.id, checkbox.checked));
  toggleLabel.append(checkbox, ' Completed Today');
  card.appendChild(toggleLabel);

  const stats = document.createElement('div');
  stats.className = 'student-goal-card__stats';
  stats.append(
    createStatChip('Current streak', category.goal.currentStreak > 0 ? `\ud83d\udd25${category.goal.currentStreak}` : '0'),
    createStatChip('Longest streak', String(category.goal.longestStreak)),
    createStatChip('Completion', `${category.goal.overallCompletionPercent}%`)
  );
  card.appendChild(stats);

  return card;
}

function renderGoalEntryForm(category, handlers, currentText) {
  const form = document.createElement('div');
  form.className = 'student-goal-card__entry';

  const input = document.createElement('textarea');
  input.className = 'student-goal-card__input';
  input.placeholder = 'e.g. I will watch a 3-minute English video every day.';
  input.value = currentText;
  // Tracks every keystroke into the shared drafts object so a
  // sibling category's own re-render (from submitting a DIFFERENT
  // category) never loses this unsaved text — see this file's own
  // header comment for why this exists at all.
  input.addEventListener('input', () => handlers.onDraftChange(category.categoryId, input.value));

  const submitButton = document.createElement('button');
  submitButton.type = 'button';
  submitButton.className = 'btn btn--primary';
  submitButton.textContent = category.goal ? 'Save Changes' : 'Submit Goal';
  submitButton.addEventListener('click', () => {
    if (!input.value.trim()) return;
    handlers.onSubmitGoal(category.categoryId, input.value.trim());
  });

  form.append(input, submitButton);
  return form;
}

function createStatChip(label, value) {
  const chip = document.createElement('div');
  chip.className = 'student-goal-card__stat-chip';
  const labelEl = document.createElement('span');
  labelEl.className = 'student-goal-card__stat-label';
  labelEl.textContent = label;
  const valueEl = document.createElement('span');
  valueEl.className = 'student-goal-card__stat-value';
  valueEl.textContent = value;
  chip.append(labelEl, valueEl);
  return chip;
}
