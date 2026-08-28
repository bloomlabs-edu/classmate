/**
 * ui/student-portal/views/StudentFeedView.js
 *
 * Class Feed — a warm, classroom-only wall, not a social network.
 * Reuses services/feedService.js (student-write path, mirroring
 * studentGoalsService.js's own pattern) and
 * config/studentEventNavigation.js's own getEventDetailRoute() for
 * "View activity" links on ClassMate-generated shares — no new
 * linking mechanism invented.
 *
 * Media upload is NOT implemented here — see this project's own
 * Class Feed design history for why (no existing Firebase Storage
 * usage anywhere in this app, and an explicit, pre-existing "no
 * photo uploads" policy already encoded elsewhere in this codebase).
 * `post.media` is rendered honestly when present (pending/approved/
 * rejected state), but nothing here ever lets a student attach a
 * file — only text and ClassMate-generated shares can be created.
 */

import { createBackButton } from '../../components/BackButton.js';
import { createEmptyStateElement } from '../../components/EmptyState.js';
import { getActiveProfile, getSlotForStudent } from '../../../services/studentDeviceService.js';
import { ensureAnonymousSignIn } from '../../../services/studentAuthService.js';
import * as feedService from '../../../services/feedService.js';
import { renderFeedPostCard } from '../../components/FeedPostCard.js';

export async function renderStudentFeedView(container, { onBack, onNavigateToPath, onNavigateToStudentProfile }) {
  container.innerHTML = '';

  const activeProfile = getActiveProfile();
  let currentUid = null;
  if (activeProfile) {
    const slotIndex = getSlotForStudent(activeProfile.studentId);
    if (slotIndex !== null) {
      currentUid = await ensureAnonymousSignIn(slotIndex);
    }
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'student-feed';

  const header = document.createElement('div');
  header.className = 'student-feed__header';
  header.appendChild(createBackButton(onBack));
  const title = document.createElement('h1');
  title.className = 'student-section__title';
  title.textContent = 'Class Feed';
  header.appendChild(title);
  wrapper.appendChild(header);

  const shareButton = document.createElement('button');
  shareButton.type = 'button';
  shareButton.className = 'btn btn--primary student-feed__share-button';
  shareButton.textContent = '+ Share';
  wrapper.appendChild(shareButton);

  const composer = document.createElement('div');
  composer.className = 'student-feed__composer';
  composer.hidden = true;
  const composerInput = document.createElement('textarea');
  composerInput.className = 'student-feed__composer-input';
  composerInput.placeholder = "What's on your mind? Share something you're proud of...";
  composer.appendChild(composerInput);
  const composerActions = document.createElement('div');
  composerActions.className = 'student-feed__composer-actions';
  const postButton = document.createElement('button');
  postButton.type = 'button';
  postButton.className = 'btn btn--primary';
  postButton.textContent = 'Post';
  const cancelComposeButton = document.createElement('button');
  cancelComposeButton.type = 'button';
  cancelComposeButton.className = 'btn btn--text';
  cancelComposeButton.textContent = 'Cancel';
  composerActions.append(postButton, cancelComposeButton);
  composer.appendChild(composerActions);
  wrapper.appendChild(composer);

  shareButton.addEventListener('click', () => {
    composer.hidden = false;
    shareButton.hidden = true;
    composerInput.focus();
  });
  cancelComposeButton.addEventListener('click', () => {
    composer.hidden = true;
    shareButton.hidden = false;
    composerInput.value = '';
  });
  postButton.addEventListener('click', async () => {
    const text = composerInput.value.trim();
    if (!text) return;
    postButton.disabled = true;
    postButton.textContent = 'Posting…';
    const postId = await feedService.createPostAsCurrentStudent({ text });
    postButton.disabled = false;
    postButton.textContent = 'Post';
    if (!postId) {
      window.alert('Something went wrong posting this. Please try again.');
      return;
    }
    composerInput.value = '';
    composer.hidden = true;
    shareButton.hidden = false;
    await refresh();
  });

  const feedList = document.createElement('div');
  feedList.className = 'student-feed__list';
  wrapper.appendChild(feedList);

  container.appendChild(wrapper);

  async function refresh() {
    feedList.innerHTML = '';
    const posts = await feedService.getFeedForCurrentStudent();

    if (posts.length === 0) {
      feedList.appendChild(
        createEmptyStateElement({
          message: 'No posts yet \u2014 be the first to share something with your class!',
        })
      );
      return;
    }

    for (const post of posts) {
      feedList.appendChild(
        await renderFeedPostCard(post, {
          currentUid,
          onNavigateToPath,
          onNavigateToStudentProfile,
          isOwnPost: (p) => p.studentId === activeProfile?.studentId,
          onReact: (postId, isReacting) => feedService.toggleReactionAsCurrentStudent(postId, isReacting),
          onListComments: (postId) => feedService.listCommentsForCurrentStudent(postId),
          onAddComment: (postId, text) => feedService.addCommentAsCurrentStudent(postId, text),
          canDeleteComment: (comment) => !!activeProfile && comment.studentId === activeProfile.studentId,
          onDeleteComment: (postId, commentId) => feedService.deleteOwnComment(postId, commentId),
          canDeletePost: (p) => !!activeProfile && p.studentId === activeProfile.studentId,
          onDeletePost: (postId) => feedService.deleteOwnPost(postId),
          onRefresh: refresh,
        })
      );
    }
  }

  await refresh();
}
