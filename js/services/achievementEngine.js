/**
 * services/achievementEngine.js
 *
 * The Badge & Achievement Engine's pure core — every rule evaluation,
 * Achievement Event construction, and level/history derivation, with
 * NO Firestore import anywhere in this file. services/achievementService.js
 * is the thin Firestore-touching wrapper around this file's own
 * buildEventsForCycle(); this split exists specifically so the engine's
 * actually load-bearing logic (ties, negative-standing exclusion,
 * deterministic ids, level-by-count, per-cycle team membership) is
 * directly unit-testable under plain `node --test`, matching this
 * project's own established convention of extracting pure decision
 * logic out of anything that would otherwise require mocking Firestore
 * or the DOM to exercise at all (see
 * tests/ui/programmeSessionHelpers.test.js's own header comment for
 * the same reasoning applied to view code). Concretely:
 * services/firestoreClassroomRepository.js imports the Firestore SDK
 * via an `https://` specifier, which Node's own ESM loader cannot
 * resolve at all outside a real browser — importing that file (even
 * transitively) makes a module impossible to load under `node --test`.
 *
 * AWARD_RULES is the engine's one extension point for future badge
 * families: a family+recognitionType pair maps to a pure rule function
 * shaped like services/badgeAwardRules/winningTeamMemberRule.js's own
 * evaluateWinningTeamMember() — `(cycle) => { winningTeams, awards }`.
 * Adding the next badge (Team Topper, Climber, Helper, or a genuinely
 * new family) means adding one rule file and one registry entry here —
 * never touching the Firestore plumbing, the Badge component, or
 * Student/Team Profile rendering.
 */

import { createAchievementEvent } from '../models/AchievementEvent.js';
import { getBadgeDefinition, getBadgeStage, getNextMilestone } from '../config/badgeDefinitions.js';
import { evaluateWinningTeamMember } from './badgeAwardRules/winningTeamMemberRule.js';

const AWARD_RULES = {
  'weekly-standing': {
    'winning-team-member': evaluateWinningTeamMember,
  },
};

/**
 * Adapts a services/scoreboardArchiveService.js Archive into the
 * generic StandingCycle shape every award rule actually consumes —
 * the one place "cycle === archive" is an assumption at all. A
 * student's own frozen `score` at archive time becomes `standing`
 * here — same value, renamed to the vocabulary the award-rule layer
 * and the product brief both use, so a rule file never has to know
 * "score" was ever an archive-specific field name.
 *
 * `isUngrouped` is read defensively: services/scoreboardArchiveService.js's
 * buildSnapshot() was extended to carry it forward (see that file's
 * own comment), but any archive created before that change won't have
 * it — the rule's own name-based fallback (`team.name === 'Ungrouped'`)
 * covers those.
 */
export function toStandingCycle(archive) {
  return {
    id: archive.id,
    label: archive.createdAtDateLabel || archive.createdAt,
    teams: (archive.teams || []).map((team) => ({
      id: team.id,
      name: team.name,
      total: team.total,
      isUngrouped: team.isUngrouped === true,
      students: (team.students || []).map((student) => ({
        id: student.id,
        name: student.name,
        standing: student.score,
      })),
    })),
  };
}

/** Every registered rule's own {badgeFamily, recognitionType, winningTeams, awards} for one cycle — the engine's single evaluation pass, reused identically by the live and backfill paths. */
function evaluateCycle(cycle) {
  const results = [];
  for (const [badgeFamily, recognitionTypes] of Object.entries(AWARD_RULES)) {
    for (const [recognitionType, rule] of Object.entries(recognitionTypes)) {
      const { winningTeams, awards } = rule(cycle);
      results.push({ badgeFamily, recognitionType, winningTeams, awards });
    }
  }
  return results;
}

/**
 * Every Achievement Event one closed Standing Cycle should produce —
 * the pure half of services/achievementService.js's awardForCycle().
 * Idempotent by construction: every event's id is deterministic
 * (student + badge + this exact cycle — see models/AchievementEvent.js),
 * so calling this twice for the same archive produces byte-identical
 * events, never new ones — this is what makes
 * services/badgeBackfillService.js safe to re-run, and it needs no
 * "have I already awarded this" check of its own, since the id itself
 * already encodes that question.
 */
export function buildEventsForCycle(archive, { source } = {}) {
  const cycle = toStandingCycle(archive);
  const evaluations = evaluateCycle(cycle);

  return evaluations.flatMap(({ badgeFamily, recognitionType, awards }) =>
    awards.map((award) =>
      createAchievementEvent({
        studentId: award.studentId,
        badgeFamily,
        recognitionType,
        cycleId: cycle.id,
        cycleLabel: cycle.label,
        teamId: award.teamId,
        teamName: award.teamName,
        standing: award.standing,
        awardedAt: new Date().toISOString(),
        source,
      })
    )
  );
}

/**
 * One student's complete badge summary — every badge they've earned
 * at least once, with its current level (a plain count of their own
 * Achievement Events for that badge — never a separately-stored
 * counter; see models/AchievementEvent.js's own header comment for
 * why), visual stage, next milestone, and full chronological history.
 * A badge the student has never earned simply doesn't appear — this
 * mirrors ui/components/RecognitionWidget.js's own "no winner this
 * period, omit the category" convention rather than showing every
 * badge at LV 0.
 */
export function summarizeStudentBadges(events) {
  const byBadge = new Map();
  for (const event of events) {
    const key = `${event.badgeFamily}__${event.recognitionType}`;
    if (!byBadge.has(key)) byBadge.set(key, []);
    byBadge.get(key).push(event);
  }

  const summaries = [];
  for (const [, badgeEvents] of byBadge) {
    const sorted = [...badgeEvents].sort((a, b) => (a.awardedAt < b.awardedAt ? -1 : a.awardedAt > b.awardedAt ? 1 : 0));
    const level = sorted.length;
    const definition = getBadgeDefinition(sorted[0].badgeFamily, sorted[0].recognitionType);
    if (!definition) continue; // a badge type that no longer exists in the catalog — skip rather than render unknown data
    summaries.push({
      definition,
      level,
      stage: getBadgeStage(level),
      nextMilestone: getNextMilestone(level),
      history: sorted,
      firstEarnedAt: sorted[0].awardedAt,
      lastEarnedAt: sorted[sorted.length - 1].awardedAt,
    });
  }

  return summaries;
}

/**
 * One team's own collective Winning Team Member history across every
 * cycle this classroom has ever closed — re-derives "did this team
 * win" per cycle via the exact same evaluateWinningTeamMember() rule
 * used for awarding, rather than counting Achievement Events (a team
 * can win a cycle even if every one of its members happened to be
 * ineligible that cycle — e.g. all had a negative standing — so
 * per-student events would undercount real team wins).
 *
 * `archives` is every Scoreboard Archive for this classroom, already
 * fetched by the caller (this file never touches Firestore itself —
 * see this file's own header comment).
 */
export function getTeamAchievementHistory(archives, teamId) {
  const chronological = [...archives].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : -1));

  const cycleResults = chronological.map((archive) => {
    const cycle = toStandingCycle(archive);
    const team = cycle.teams.find((t) => t.id === teamId);
    const { winningTeams } = evaluateWinningTeamMember(cycle);
    const won = winningTeams.some((winner) => winner.id === teamId);
    return { cycleId: cycle.id, cycleLabel: cycle.label, total: team ? team.total : null, won };
  });

  const wins = cycleResults.filter((result) => result.won);
  const scores = cycleResults.map((result) => result.total).filter((total) => total !== null);
  const bestCycleScore = scores.length > 0 ? Math.max(...scores) : null;

  // Current streak — consecutive wins ending at the MOST RECENT cycle this team appeared in at all (a gap where the team didn't win, or wasn't ranked, breaks the streak).
  let currentStreak = 0;
  for (let i = cycleResults.length - 1; i >= 0; i--) {
    if (cycleResults[i].total === null) continue;
    if (!cycleResults[i].won) break;
    currentStreak += 1;
  }

  return {
    totalWins: wins.length,
    currentStreak,
    bestCycleScore,
    cycles: cycleResults,
  };
}

/**
 * Groups a set of Achievement Events (already filtered to ONE cycle —
 * see ui/views/ScoreboardArchiveView.js's own Recognition Wall) into
 * one entry per badge TYPE, with recipients further grouped by team
 * whenever team context actually exists on the events themselves.
 *
 * Deliberately generic — this never checks `recognitionType ===
 * 'winning-team-member'` to decide whether to show team grouping; it
 * looks at whether `event.teamId` is actually present on the events in
 * that badge's own group. Winning Team Member events always carry a
 * team (see models/AchievementEvent.js); a hypothetical future badge
 * with no team concept (e.g. Helper) would simply produce
 * `teamGroups: null` and render as a flat recipient list — no code
 * change needed here when that badge's own events start existing.
 *
 * Returns `[]` for no events at all (a cycle with no recognitions —
 * e.g. every team scored negative) — callers render their own empty
 * state rather than this function inventing one.
 *
 * Recipients carry `studentId` only, never a name — this file has no
 * way to resolve a display name (and shouldn't guess one from
 * anything other than the archive's own frozen roster, which only the
 * caller has). Name resolution is deliberately the view's job.
 */
export function groupEventsForRecognitionWall(events) {
  const byBadge = new Map();
  events.forEach((event) => {
    const key = `${event.badgeFamily}__${event.recognitionType}`;
    if (!byBadge.has(key)) byBadge.set(key, []);
    byBadge.get(key).push(event);
  });

  const groups = [];
  for (const badgeEvents of byBadge.values()) {
    const definition = getBadgeDefinition(badgeEvents[0].badgeFamily, badgeEvents[0].recognitionType);
    if (!definition) continue; // a badge type no longer in the catalog — skip rather than render unknown data

    const recipients = badgeEvents.map((event) => ({ studentId: event.studentId, teamId: event.teamId, teamName: event.teamName, standing: event.standing }));

    const hasTeamContext = recipients.some((recipient) => recipient.teamId);
    let teamGroups = null;
    if (hasTeamContext) {
      const byTeam = new Map();
      recipients.forEach((recipient) => {
        const teamKey = recipient.teamId || 'none';
        if (!byTeam.has(teamKey)) byTeam.set(teamKey, { teamId: recipient.teamId, teamName: recipient.teamName, recipients: [] });
        byTeam.get(teamKey).recipients.push(recipient);
      });
      teamGroups = [...byTeam.values()];
    }

    groups.push({ definition, recipients, teamGroups });
  }

  return groups;
}
