/**
 * ui/views/FeedModerationView.js
 *
 * Teacher-side Class Feed — the same feed students see, plus a
 * compact pending-media banner at the top and a Delete action on
 * every post. Deliberately one combined screen, not a separate
 * moderation subsystem, per explicit product decision — a teacher
 * checking pending media once a day is the expected rhythm, not a
 * constant push into a dedicated queue screen.
 *
 * Media approval/rejection here is real (see
 * services/feedService.js's own approveMedia()/rejectMedia()) even
 * though no actual media upload exists yet in this build — the
 * lifecycle is fully wired and ready the moment upload itself is
 * built, per this project's own explicit Class Feed design decision
 * to model the states now without inventing storage infrastructure
 * yet.
 */

import { createBackButton } from '../components/BackButton.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import * as feedService from '../../services/feedService.js';

export async function renderFeedModerationView(container, { classroom, currentUser, onBack }) {
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

  const feedList = document.createElement('div');
  feedList.className = 'feed-moderation__list';
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

    posts.forEach((post) => feedList.appendChild(renderTeacherPostCard(post, classroom.id, refresh)));
  }

  await refresh();
}

/**
 * The teacher-only post composer — title + message, combined into
 * the existing single `text` field on publish (title, then a blank
 * line, then the message) rather than adding a new field to the
 * post data model at all. Both StudentFeedView.js's own post text
 * and this same screen's own post text already render with
 * white-space: pre-wrap, so the title/message combination displays
 * as two visually distinct lines on both sides without any further
 * change.
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


function renderTeacherPostCard(post, classroomId, refresh) {
  const card = document.createElement('div');
  card.className = 'feed-moderation__card';
  if (post.media && post.media.status === 'pending') card.classList.add('feed-moderation__card--pending');

  const cardHeader = document.createElement('div');
  cardHeader.className = 'feed-moderation__card-header';
  const author = document.createElement('span');
  author.className = 'feed-moderation__author';
  author.textContent = post.authorName;
  cardHeader.appendChild(author);
  card.appendChild(cardHeader);

  const text = document.createElement('p');
  text.className = 'feed-moderation__text';
  text.textContent = post.text;
  card.appendChild(text);

  if (post.media) {
    const mediaLine = document.createElement('p');
    mediaLine.className = 'feed-moderation__media-line';
    mediaLine.textContent = `Media (${post.media.type}) \u2014 ${post.media.status}`;
    card.appendChild(mediaLine);

    if (post.media.status === 'pending') {
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
      card.appendChild(actions);
    }
  }

  const footerActions = document.createElement('div');
  footerActions.className = 'feed-moderation__footer-actions';
  const deletePostButton = document.createElement('button');
  deletePostButton.type = 'button';
  deletePostButton.className = 'btn btn--text';
  deletePostButton.textContent = 'Delete Post';
  deletePostButton.addEventListener('click', async () => {
    const confirmed = window.confirm(`Remove this post from ${post.authorName}? Students will no longer see it.`);
    if (!confirmed) return;
    await feedService.removePostAsTeacher(classroomId, post.id);
    await refresh();
  });
  footerActions.appendChild(deletePostButton);
  card.appendChild(footerActions);

  return card;
}
