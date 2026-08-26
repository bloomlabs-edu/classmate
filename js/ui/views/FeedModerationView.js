/**
 * ui/views/FeedModerationView.js
 *
 * Teacher-side Class Feed — the SAME Feed post card, reactions, and
 * comment thread students see (see ui/components/FeedPostCard.js,
 * the shared component this file and StudentFeedView.js both call),
 * plus a compact pending-media banner and additive teacher
 * privileges: creating a post, moderating (deleting) any post, and
 * moderating (deleting) any comment. The teacher is a normal Feed
 * participant first — able to react and comment exactly like a
 * student — with moderation layered on top, not a separate
 * admin/management screen that happens to display posts.
 *
 * Media approval/rejection here is real (see
 * services/feedService.js's own approveMedia()/rejectMedia()) even
 * though no actual media upload exists yet in this build — the
 * lifecycle is fully wired and ready the moment upload itself is
 * built, per this project's own explicit Class Feed design decision
 * to model the states now without inventing storage infrastructure
 * yet. This stays as its own banner, separate from the shared post
 * card, since it's a distinct teacher-only workflow (approving
 * pending media), not part of the common Feed presentation.
 */

import { createBackButton } from '../components/BackButton.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import * as feedService from '../../services/feedService.js';
import { renderFeedPostCard } from '../components/FeedPostCard.js';

export async function renderFeedModerationView(container, { classroom, currentUser, onBack, onSelectStudent }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'learning-management feed-moderation';

  const header = document.createElement('header');
  header.className = 'learning-management__header';
  header.appendChild(createBackButton(onBack));
  const title = document.createElement('h1');
  title.className = 'learning-management__title';
  title.textContent = 'Class Feed';
  header.appendChild(title);

  const shareButton = document.createElement('button');
  shareButton.type = 'button';
  shareButton.className = 'btn btn--primary feed-moderation__share-button';
  shareButton.textContent = '+ Share with Class';
  header.appendChild(shareButton);

  wrapper.appendChild(header);

  const composerContainer = document.createElement('div');
  wrapper.appendChild(composerContainer);

  const banner = document.createElement('div');
  banner.className = 'feed-moderation__banner';
  banner.hidden = true;
  wrapper.appendChild(banner);

  // Reuses the exact same list container class the student Feed
  // already uses, since the cards inside are now the exact same
  // shared component too — this is genuinely the same Feed list,
  // not a differently-styled teacher equivalent.
  const feedList = document.createElement('div');
  feedList.className = 'student-feed__list';
  wrapper.appendChild(feedList);

  container.appendChild(wrapper);

  let composerOpen = false;

  function renderComposer() {
    composerContainer.innerHTML = '';
    if (!composerOpen) return;
    composerContainer.appendChild(
      renderShareComposer({
        onCancel: () => {
          composerOpen = false;
          renderComposer();
        },
        onPublish: async ({ postTitle, message }) => {
          const text = postTitle ? `${postTitle}\n\n${message}` : message;
          const postId = await feedService.createPostAsTeacher({
            classroomId: classroom.id,
            uid: currentUser.uid,
            authorName: currentUser.displayName || 'Teacher',
            text,
            teams: classroom.teams,
          });
          if (!postId) {
            window.alert('Could not publish this post right now. Please try again.');
            return;
          }
          composerOpen = false;
          renderComposer();
          await refresh();
        },
      })
    );
  }

  shareButton.addEventListener('click', () => {
    composerOpen = true;
    renderComposer();
  });

  async function refresh() {
    const posts = await feedService.getFeedForClassroom(classroom.id);
    const pending = feedService.getPendingMediaPosts(posts);

    banner.innerHTML = '';
    if (pending.length > 0) {
      banner.hidden = false;
      banner.textContent = `\ud83d\udd34 ${pending.length} post${pending.length === 1 ? '' : 's'} awaiting review`;
    } else {
      banner.hidden = true;
    }

    feedList.innerHTML = '';
    if (posts.length === 0) {
      feedList.appendChild(createEmptyStateElement({ message: 'No posts in this classroom\u2019s feed yet.' }));
      return;
    }

    for (const post of posts) {
      const card = await renderFeedPostCard(post, {
        currentUid: currentUser.uid,
        // Media pending/rejected status lines are a student-only
        // concept (a student's own uploaded photo awaiting their
        // own teacher's review) — the teacher is never "the
        // student who uploaded this," so this always reports
        // false, matching the original teacher view's own silence
        // on media status lines entirely.
        isOwnPost: () => false,
        onNavigateToStudentProfile: onSelectStudent,
        onReact: (postId, isReacting) => feedService.toggleReactionAsTeacher(classroom.id, postId, currentUser.uid, isReacting),
        onListComments: (postId) => feedService.listCommentsForTeacher(classroom.id, postId),
        onAddComment: (postId, text) => feedService.addCommentAsTeacher(classroom.id, postId, { uid: currentUser.uid, authorName: currentUser.displayName || 'Teacher', text }),
        // A teacher may moderate/remove ANY comment, matching the
        // existing Firestore rule exactly (allow delete: author OR
        // any classroom member) — not just their own.
        canDeleteComment: () => true,
        onDeleteComment: (postId, commentId) => feedService.removeCommentAsTeacher(classroom.id, postId, commentId),
        // A teacher may moderate/remove ANY post, matching
        // removePostAsTeacher()'s own existing permission model.
        canDeletePost: () => true,
        onDeletePost: (postId) => feedService.removePostAsTeacher(classroom.id, postId),
        onRefresh: refresh,
        deletePostLabel: 'Delete post',
      });
      card.dataset.postId = post.id;
      feedList.appendChild(card);
    }

    if (pending.length > 0) {
      renderMediaModerationExtras(feedList, posts, classroom.id, refresh);
    }
  }

  await refresh();
}

/**
 * The pending-media Approve/Reject controls — a distinct teacher-only
 * workflow layered onto the already-rendered shared post cards
 * (found by post id), not a duplicate card. Kept separate from
 * FeedPostCard.js since media approval has no equivalent at all in
 * the student Feed experience.
 */
function renderMediaModerationExtras(feedList, posts, classroomId, refresh) {
  posts.forEach((post) => {
    if (!post.media || post.media.status !== 'pending') return;
    const matchingCard = [...feedList.children].find((el) => el.dataset && el.dataset.postId === post.id);
    if (!matchingCard) return;

    matchingCard.classList.add('feed-moderation__card--pending');

    const mediaLine = document.createElement('p');
    mediaLine.className = 'feed-moderation__media-line';
    mediaLine.textContent = `Media (${post.media.type}) \u2014 ${post.media.status}`;
    matchingCard.appendChild(mediaLine);

    const actions = document.createElement('div');
    actions.className = 'feed-moderation__actions';

    const approveButton = document.createElement('button');
    approveButton.type = 'button';
    approveButton.className = 'btn btn--primary';
    approveButton.textContent = 'Approve';
    approveButton.addEventListener('click', async () => {
      await feedService.approveMedia(classroomId, post.id);
      await refresh();
    });

    const rejectButton = document.createElement('button');
    rejectButton.type = 'button';
    rejectButton.className = 'btn btn--danger';
    rejectButton.textContent = 'Remove/Reject';
    rejectButton.addEventListener('click', async () => {
      await feedService.rejectMedia(classroomId, post.id);
      await refresh();
    });

    actions.append(approveButton, rejectButton);
    matchingCard.appendChild(actions);
  });
}

/**
 * The teacher-only post composer — title + message, combined into
 * the existing single `text` field on publish (title, then a blank
 * line, then the message) rather than adding a new field to the
 * post data model at all. Both StudentFeedView.js's own post text
 * and this same screen's own post text (via the shared FeedPostCard)
 * already render with white-space: pre-wrap, so the title/message
 * combination displays as two visually distinct lines on both sides
 * without any further change.
 */
function renderShareComposer({ onCancel, onPublish }) {
  const composer = document.createElement('div');
  composer.className = 'feed-moderation__composer';

  const titleLabel = document.createElement('label');
  titleLabel.className = 'feed-moderation__composer-label';
  titleLabel.textContent = 'Title (optional)';
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'feed-moderation__composer-input';
  titleInput.placeholder = 'e.g. Reminder for tomorrow';
  titleLabel.appendChild(titleInput);

  const messageLabel = document.createElement('label');
  messageLabel.className = 'feed-moderation__composer-label';
  messageLabel.textContent = 'Message';
  const messageInput = document.createElement('textarea');
  messageInput.className = 'feed-moderation__composer-textarea';
  messageInput.placeholder = 'Share something with the whole class\u2026';
  messageInput.rows = 4;
  messageLabel.appendChild(messageInput);

  const errorLine = document.createElement('p');
  errorLine.className = 'feed-moderation__composer-error';
  errorLine.hidden = true;

  const actions = document.createElement('div');
  actions.className = 'feed-moderation__composer-actions';

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn btn--text';
  cancelButton.textContent = 'Cancel';
  cancelButton.addEventListener('click', onCancel);

  const publishButton = document.createElement('button');
  publishButton.type = 'button';
  publishButton.className = 'btn btn--primary';
  publishButton.textContent = 'Publish';
  publishButton.addEventListener('click', async () => {
    const message = messageInput.value.trim();
    if (!message) {
      errorLine.hidden = false;
      errorLine.textContent = 'Enter a message before publishing.';
      return;
    }
    errorLine.hidden = true;
    publishButton.disabled = true;
    await onPublish({ postTitle: titleInput.value.trim(), message });
    publishButton.disabled = false;
  });

  actions.append(cancelButton, publishButton);
  composer.append(titleLabel, messageLabel, errorLine, actions);
  return composer;
}
