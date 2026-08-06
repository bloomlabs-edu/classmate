/**
 * services/workTypes/index.js
 *
 * The frozen Work Type registry (see workTypeContract.js). The
 * Dashboard aggregates with WORK_TYPES.flatMap(type =>
 * type.getActiveWork(classroom)) / getStartActions(classroom) — never
 * assuming exactly one item per type, and never branching on which
 * type an item came from.
 *
 * Milestone 1 scope: NotebookWorkType only. AssessmentWorkType,
 * GoalCycleWorkType, and LearningActivityWorkType are added in
 * Milestone 3, each following this exact same shape.
 */

import { NotebookWorkType } from './NotebookWorkType.js';

export const WORK_TYPES = [NotebookWorkType];
