/**
 * models/GoalCycle.js
 *
 * Goals — Phase 1 of what will eventually become one contributor to
 * Journey (see this project's own architecture discussion). Built and
 * verified as a fully independent, working subsystem first; the
 * Journey Contributor abstraction will be extracted from this real
 * implementation later, not designed in advance and fitted to it.
 *
 * A GoalCycle is the bounded time window a set of goals belongs to
 * ("August English Goals", 03 Aug - 26 Aug 2026). Owns its own
 * `categories` and `goals` directly — the same "owns its children as
 * a plain array" pattern already used throughout this app (see
 * models/Team.js, models/Assessment.js's own assessmentSubjects).
 *
 * `categories` is deliberately generic — `{ id, name }`, nothing LSRW-
 * specific in the shape itself. LSRW's four categories (Listening,
 * Speaking, Reading, Writing) are just the first cycle's own data, not
 * a hardcoded structure; a future Reading Challenge or Homework
 * tracker is simply a different cycle with different categories.
 *
 * `status` — 'active' | 'closed'. Only one cycle should be 'active'
 * per classroom at a time (enforced at the service level, see
 * services/goalService.js — the same "enforced by the service, not
 * the model" split already used for Assessment's own `status` field).
 *
 * `completions` lives here too — `{ [goalId]: { [dateKey]: true } }`
 * (see services/goalCompletionService.js). Embedded directly on the
 * cycle, following config/Classroom.js's own `notebooks` field as the
 * closest precedent for a bounded, day-by-day, per-student register —
 * NOT the Planner/Lesson subcollection pattern, which exists
 * specifically for genuinely unbounded, multi-year growth a cycle's
 * own fixed start/end window never reaches. Presence in the object
 * means completed; absence means not completed — no richer shape
 * (no audit trail, no separate "submission" axis) since a goal only
 * ever has one actor (the student, ticking their own goal) and one
 * axis (done or not), unlike NotebookSubmission's own two independent
 * axes for a teacher-checked register.
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export function createGoalCycle({
  id,
  title,
  startDate = '',
  endDate = '',
  cycleType = 'custom',
  status = 'active',
  createdAt,
  categories = [],
  goals = [],
  completions = {},
} = {}) {
  return {
    id: id || generateId(),
    title,
    startDate,
    endDate,
    cycleType,
    status,
    createdAt: createdAt || getCurrentIsoDate(),
    categories,
    goals,
    completions,
  };
}

export function createGoalCategory({ id, name } = {}) {
  return {
    id: id || generateId(),
    name,
  };
}
