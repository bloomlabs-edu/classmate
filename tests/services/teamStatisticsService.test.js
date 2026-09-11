/**
 * tests/services/teamStatisticsService.test.js
 *
 * services/teamStatisticsService.js's canOpenTeamProfile() — the shared
 * "is this a real, addressable Team Profile destination" check
 * ui/components/TeamStandingsBoard.js's own team-card header and
 * ui/views/StudentProfileView.js's own team-name reverse link both use
 * to decide whether to render a clickable button vs. a plain heading/
 * text. Ungrouped is a real team record structurally (see
 * services/classroomService.js's getOrCreateUngroupedTeam()) but must
 * never behave like one here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canOpenTeamProfile } from '../../js/services/teamStatisticsService.js';

test('a normal, teacher-created team can open its Team Profile', () => {
  assert.equal(canOpenTeamProfile({ id: 't1', name: 'Phoenix', isUngrouped: false }), true);
});

test('a team with no isUngrouped flag at all (the common case) can open its Team Profile', () => {
  assert.equal(canOpenTeamProfile({ id: 't1', name: 'Phoenix' }), true);
});

test('the Ungrouped pseudo-team cannot open a Team Profile', () => {
  assert.equal(canOpenTeamProfile({ id: 't-ungrouped', name: 'Ungrouped', isUngrouped: true }), false);
});

test('a missing team (student not currently on any team) cannot open a Team Profile', () => {
  assert.equal(canOpenTeamProfile(null), false);
  assert.equal(canOpenTeamProfile(undefined), false);
});
