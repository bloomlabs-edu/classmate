/**
 * tests/config/badgeDefinitions.test.js
 *
 * config/badgeDefinitions.js's own visual-stage/milestone derivation —
 * the "do not hard-code if (level === 1)/if (level === 2)..." rule the
 * badge style guide requires. Confirms stages are derived from a
 * lookup table and that levels well above the last defined threshold
 * (LV 51+) still resolve correctly, per the style guide's own explicit
 * "LV 51 is valid and remains in the Master visual stage" example.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getBadgeStage, getNextMilestone, getBadgeDefinition, BADGE_FAMILIES } from '../../js/config/badgeDefinitions.js';

test('getBadgeStage: LV 1-2 is Starting Out', () => {
  assert.equal(getBadgeStage(1).id, 'starting-out');
  assert.equal(getBadgeStage(2).id, 'starting-out');
});

test('getBadgeStage: LV 3-4 is Building, LV 5-9 is Established', () => {
  assert.equal(getBadgeStage(3).id, 'building');
  assert.equal(getBadgeStage(4).id, 'building');
  assert.equal(getBadgeStage(5).id, 'established');
  assert.equal(getBadgeStage(9).id, 'established');
});

test('getBadgeStage: LV 10-19 is Elite, LV 20+ is Master — including well past 20', () => {
  assert.equal(getBadgeStage(10).id, 'elite');
  assert.equal(getBadgeStage(19).id, 'elite');
  assert.equal(getBadgeStage(20).id, 'master');
  assert.equal(getBadgeStage(51).id, 'master');
  assert.equal(getBadgeStage(1000).id, 'master');
});

test('getBadgeStage: level 0 or unset has no stage (not yet earned)', () => {
  assert.equal(getBadgeStage(0), null);
  assert.equal(getBadgeStage(undefined), null);
});

test('getNextMilestone: reports the next milestone, and null once past the last one — the level itself keeps climbing regardless', () => {
  assert.equal(getNextMilestone(1), 5);
  assert.equal(getNextMilestone(4), 5);
  assert.equal(getNextMilestone(5), 10);
  assert.equal(getNextMilestone(19), 20);
  assert.equal(getNextMilestone(50), null);
  assert.equal(getNextMilestone(87), null); // LV 87 is valid (style guide example) and still resolves without error
});

test('getBadgeDefinition: finds Winning Team Member by family + recognitionType, never by title text', () => {
  const badge = getBadgeDefinition(BADGE_FAMILIES.WEEKLY_STANDING, 'winning-team-member');
  assert.ok(badge);
  assert.equal(badge.title, 'Winning Team Member');
  assert.equal(badge.theme, 'amber');
});

test('getBadgeDefinition: unknown family/type returns null, never throws', () => {
  assert.equal(getBadgeDefinition('not-a-real-family', 'not-a-real-type'), null);
});
