/**
 * services/workTypes/index.js
 *
 * The frozen Work Type registry (see workTypeContract.js). The
 * Dashboard aggregates with WORK_TYPES.flatMap(type =>
 * type.getActiveWork(classroom)) / getStartActions(classroom) — never
 * assuming exactly one item per type, and never branching on which
 * type an item came from.
 *
 * Milestone 3: AssessmentWorkType, GoalCycleWorkType, and
 * LearningActivityWorkType added alongside NotebookWorkType, each
 * following the exact same shape.
 */

import { NotebookWorkType } from './NotebookWorkType.js';
import { AssessmentWorkType } from './AssessmentWorkType.js';
import { GoalCycleWorkType } from './GoalCycleWorkType.js';
import { LearningActivityWorkType } from './LearningActivityWorkType.js';

export const WORK_TYPES = [NotebookWorkType, AssessmentWorkType, GoalCycleWorkType, LearningActivityWorkType];
