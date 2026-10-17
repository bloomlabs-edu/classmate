/**
 * functions/src/slack/onWeeklyPlanSubmissionWrite.js
 *
 * The one place this feature reacts to WeeklyPlanSubmission state —
 * a Firestore trigger, not a call from
 * services/weeklyPlanSubmissionService.js or
 * repositories/weeklyPlanSubmissionRepository.js, both of which stay
 * completely untouched (see this feature's own architecture proposal,
 * "Notification/event architecture" — WeeklyPlanService -> Slack API
 * directly was explicitly ruled out).
 *
 * `handleWeeklyPlanSubmissionWrite()` below is the framework-agnostic
 * core (testable with fakes, no live Firestore/Slack needed — see
 * tests/functions/slack/onWeeklyPlanSubmissionWrite.test.js); the
 * exported `onWeeklyPlanSubmissionWrite` Cloud Function at the bottom
 * is just the `onDocumentWritten` glue around it, matching this
 * feature's other endpoint's own core/glue split
 * (functions/src/verifyLearnerConnectionEndpoint.js vs.
 * functions/index.js).
 *
 * Phase-1 scope, deliberately: the Slack DM always goes to the
 * SUBMISSION'S OWN teacherUid — the Fellow whose week it is — for all
 * three notifiable transitions, including changes_requested/approved
 * (which a PM or co-teacher actually triggers). Notifying a separate
 * reviewer/PM identity would require THEIR OWN Slack link too, which
 * is out of scope for "smallest possible end-to-end slice" (see this
 * feature's own implementation plan).
 *
 * Every failure path here is caught and logged, never thrown — for two
 * independent reasons, not just one: (1) this is a side effect
 * downstream of an already-successful Firestore write, which must
 * never be treated as failed just because Slack was unavailable (see
 * the Notification System's own existing fire-and-forget precedent,
 * services/notificationService.js); (2) throwing out of an
 * `onDocumentWritten` handler makes Cloud Functions retry the event,
 * which would very likely mean the SAME Slack DM gets sent twice for
 * one real status change — swallowing the error here is what prevents
 * that duplicate-send failure mode, not just a defensive habit.
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore } from 'firebase-admin/firestore';
import { detectNotifiableTransition } from './weeklyPlanTransition.js';
import { buildWeeklyPlanSubmissionMessage } from './formatters.js';
import { openDirectMessageChannel, postMessage } from './slackClient.js';
import { getActiveSlackIntegration } from './slackIntegrationRepository.js';
import { getAppBaseUrl } from './config.js';

export const slackBotTokenSecret = defineSecret('SLACK_BOT_TOKEN');

/** An existing, verified ClassMate route (see js/ui/router.js: "#/program-manager/weekly-plans/review?classroomId=&teacherUid=&week=", which that file's own comment confirms also renders for a Fellow reviewing their own week) — never a new route invented for Slack. */
function buildReviewUrl({ classroomId, teacherUid, weekStartDate }) {
  const params = new URLSearchParams({ classroomId, teacherUid, week: weekStartDate });
  return `${getAppBaseUrl()}/#/program-manager/weekly-plans/review?${params.toString()}`;
}

/**
 * @param {object} params
 * @param {object|null} params.before - WeeklyPlanSubmission data before this write
 * @param {object|null} params.after - WeeklyPlanSubmission data after this write
 * @param {object} params.deps
 * @param {(uid: string) => Promise<object|null>} params.deps.getActiveSlackIntegration
 * @param {(classroomId: string) => Promise<string>} params.deps.getClassroomLabel
 * @param {(slackUserId: string) => Promise<{ok: boolean, channelId?: string, error?: string}>} params.deps.openDirectMessageChannel
 * @param {(channelId: string, message: {text: string, blocks: object[]}) => Promise<{ok: boolean, error?: string}>} params.deps.postMessage
 * @param {(context: string, error?: unknown) => void} [params.deps.onError]
 */
export async function handleWeeklyPlanSubmissionWrite({ before, after, deps }) {
  const transition = detectNotifiableTransition(before, after);
  if (!transition) return { sent: false, reason: 'not_notifiable' };

  let integration;
  try {
    integration = await deps.getActiveSlackIntegration(after.teacherUid);
  } catch (error) {
    deps.onError?.('lookup_integration_failed', error);
    return { sent: false, reason: 'lookup_failed' };
  }
  if (!integration) return { sent: false, reason: 'not_connected' };

  let classroomLabel;
  try {
    classroomLabel = await deps.getClassroomLabel(after.classroomId);
  } catch (error) {
    deps.onError?.('classroom_lookup_failed', error);
    classroomLabel = 'your classroom';
  }

  const message = buildWeeklyPlanSubmissionMessage({
    status: transition,
    classroomLabel,
    weekStartDate: after.weekStartDate,
    reviewUrl: buildReviewUrl({ classroomId: after.classroomId, teacherUid: after.teacherUid, weekStartDate: after.weekStartDate }),
  });

  let dmChannel;
  try {
    dmChannel = await deps.openDirectMessageChannel(integration.slackUserId);
  } catch (error) {
    deps.onError?.('open_dm_failed', error);
    return { sent: false, reason: 'open_dm_failed' };
  }
  if (!dmChannel?.ok) {
    deps.onError?.('open_dm_rejected', dmChannel?.error);
    return { sent: false, reason: 'open_dm_rejected' };
  }

  try {
    const sendResult = await deps.postMessage(dmChannel.channelId, message);
    if (!sendResult?.ok) {
      deps.onError?.('post_message_rejected', sendResult?.error);
      return { sent: false, reason: 'post_message_rejected' };
    }
  } catch (error) {
    deps.onError?.('post_message_failed', error);
    return { sent: false, reason: 'post_message_failed' };
  }

  return { sent: true, transition };
}

export const onWeeklyPlanSubmissionWrite = onDocumentWritten(
  { document: 'weeklyPlanSubmissions/{submissionId}', secrets: [slackBotTokenSecret] },
  async (event) => {
    try {
      const before = event.data?.before?.exists ? event.data.before.data() : null;
      const after = event.data?.after?.exists ? event.data.after.data() : null;
      if (!after) return;

      const db = getFirestore();
      const botToken = slackBotTokenSecret.value();

      await handleWeeklyPlanSubmissionWrite({
        before,
        after,
        deps: {
          getActiveSlackIntegration: (uid) => getActiveSlackIntegration(db, uid),
          getClassroomLabel: async (classroomId) => {
            const snapshot = await db.collection('classrooms').doc(classroomId).get();
            const data = snapshot.exists ? snapshot.data() : null;
            return data?.classroomName || data?.gradeSection || 'your classroom';
          },
          openDirectMessageChannel: (slackUserId) => openDirectMessageChannel({ botToken, slackUserId }),
          postMessage: (channelId, message) => postMessage({ botToken, channel: channelId, text: message.text, blocks: message.blocks }),
          onError: (context, error) => console.error(`[slack/onWeeklyPlanSubmissionWrite] ${context}:`, error),
        },
      });
    } catch (error) {
      // Belt-and-braces — handleWeeklyPlanSubmissionWrite() already
      // catches every step internally, but this outer catch guarantees
      // this trigger NEVER throws, no matter what (e.g. a bug in event
      // parsing itself) — see this file's own header comment on why a
      // thrown error here risks a duplicate-send retry.
      console.error('[slack/onWeeklyPlanSubmissionWrite] unexpected failure — WeeklyPlanSubmission write itself already succeeded, unaffected:', error);
    }
  }
);
