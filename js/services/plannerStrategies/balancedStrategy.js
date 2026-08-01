/**
 * services/plannerStrategies/balancedStrategy.js
 *
 * Spreads schedulable curriculum content evenly across the available
 * Teaching Slots within a Planning Cycle: one item per lesson, in
 * unit/concept order, one lesson per slot — until either slots or
 * content runs out. Pure — no Firebase, no DOM, plain objects in,
 * plain objects out, matching the required isolation for
 * services/plannerEngine.js's own contract.
 *
 * Concept-level scheduling with an automatic unit-level fallback, per
 * explicit product decision: Concept Builder isn't built yet, so most
 * real curriculum units have `concepts: []` today. Rather than block
 * on that or produce zero lessons, a unit with no concepts becomes one
 * schedulable item for the *whole unit* (`conceptIds: []`); a unit
 * that *does* have concepts becomes one schedulable item per concept
 * (`conceptIds: [conceptId]`). Nothing about this file, the engine, or
 * the strategy registry needs to change once Concept Builder ships —
 * units simply start having concepts, and scheduling automatically
 * becomes concept-level for them, unit by unit, with no flag or
 * migration required anywhere in the Planner domain.
 *
 * Only ever receives Teaching Slots already filtered to the relevant
 * subject — that filtering is services/plannerService.js's job, not
 * this strategy's (see that file's own header comment) — but still
 * filters by the Planning Cycle's own date range itself, since "what
 * falls within this cycle" is intrinsic to what a planning cycle even
 * means, not a caller-supplied filter criterion.
 */

import { createLesson } from '../../models/Lesson.js';

function buildSchedulableItems(curriculumUnits) {
  return curriculumUnits.flatMap((unit) => {
    if (Array.isArray(unit.concepts) && unit.concepts.length > 0) {
      return unit.concepts.map((concept) => ({ unitId: unit.id, conceptIds: [concept.id] }));
    }
    // Concept Builder hasn't populated this unit yet — schedule the
    // whole unit as a single placeholder lesson instead of scheduling
    // nothing at all.
    return [{ unitId: unit.id, conceptIds: [] }];
  });
}

export function balancedStrategy({ teachingSlots, planningCycle, curriculumUnits }) {
  const slotsInCycle = teachingSlots
    .filter((slot) => slot.date >= planningCycle.startDate && slot.date <= planningCycle.endDate)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || (a.periodNumber ?? 0) - (b.periodNumber ?? 0));

  const schedulableItems = buildSchedulableItems(curriculumUnits);

  const lessonCount = Math.min(slotsInCycle.length, schedulableItems.length);
  const lessons = [];

  for (let i = 0; i < lessonCount; i++) {
    const slot = slotsInCycle[i];
    const item = schedulableItems[i];

    lessons.push(
      createLesson({
        planningCycleId: planningCycle.id,
        classroomId: planningCycle.classroomId,
        date: slot.date,
        teachingSlotId: slot.id,
        curriculumUnitId: item.unitId,
        conceptIds: item.conceptIds,
        sequenceIndex: i,
        estimatedMinutes: slot.duration ?? null,
      })
    );
  }

  // If schedulableItems.length > slotsInCycle.length, some content is
  // left unscheduled this cycle (deferred, not dropped — a future
  // caller can hand the remainder to the next cycle). If
  // slotsInCycle.length > schedulableItems.length, some slots simply
  // go unused this cycle. This milestone returns only the scheduled
  // Lessons; surfacing "leftover" counts to a UI is a natural
  // extension point for later, not something this strategy needs to
  // decide.

  return lessons;
}
