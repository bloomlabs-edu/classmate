/**
 * config/notificationCategories.js
 *
 * The category tags shown on every teacher-facing notification (see
 * models/Notification.js, ui/components/UserBar.js's own notification
 * popover) — the teacher-side counterpart to
 * config/studentEventCategories.js, kept as its own small enum for the
 * same reason: a future publisher can reuse an existing category
 * without this file needing a redesign, and the popover itself never
 * needs to know the full set in advance.
 *
 * This MVP wires three categories — Classroom (a co-teacher joined),
 * Checkpoints (a submission was marked Incomplete), and Feed (a new
 * Class Feed post) — matching the publishers actually implemented (see
 * services/workspaceService.js's joinClassroomByCode(),
 * ui/views/NotebookCheckpointsView.js's onQuickReview()/onSaveCell(),
 * and services/feedService.js's createPostAsCurrentStudent()/
 * createPostAsTeacher()). Additional categories are intentionally not
 * pre-declared the way studentEventCategories.js pre-declares unused
 * ones — this file can grow alongside its own next real publisher
 * instead.
 */

export const NOTIFICATION_CATEGORIES = {
  CLASSROOM: 'Classroom',
  CHECKPOINTS: 'Checkpoints',
  FEED: 'Feed',
};
