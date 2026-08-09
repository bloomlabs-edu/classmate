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
import { getEventDetailRoute } from '../../../config/studentEventNavigation.js';
import { getActiveProfile, getSlotForStudent } from '../../../services/studentDeviceService.js';
import { ensureAnonymousSignIn } from '../../../services/studentAuthService.js';
import * as feedService from '../../../services/feedService.js';

function formatRelativeTime(isoString) {
  const then = new Date(isoString).getTime();
  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export async function renderStudentFeedView(container, { onBack, onNavigateToPath }) {
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
    const postId = await feedService.createPostAsCurrentStudent({ text });
    postButton.disabled = false;
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
      feedList.appendChild(await renderPostCard(post, activeProfile, currentUid, onNavigateToPath, refresh));
    }
  }

  await refresh();
}

async function renderPostCard(post, activeProfile, currentUid, onNavigateToPath, refresh) {
  const card = document.createElement('div');
  card.className = 'student-feed__card';

  const cardHeader = document.createElement('div');
  cardHeader.className = 'student-feed__card-header';
  const author = document.createElement('span');
  author.className = 'student-feed__author';
  author.textContent = post.authorName;
  const time = document.createElement('span');
  time.className = 'student-feed__time';
  time.textContent = formatRelativeTime(post.createdAt);
  cardHeader.append(author, time);
  card.appendChild(cardHeader);

  const text = document.createElement('p');
  text.className = 'student-feed__text';
  text.textContent = post.text;
  card.appendChild(text);

  if (post.media) {
    const mediaState = document.createElement('p');
    mediaState.className = 'student-feed__media-state';
    const isOwnPost = post.studentId === activeProfile?.studentId;
    if (post.media.status === 'pending') {
      mediaState.textContent = isOwnPost ? 'Photo waiting for teacher approval.' : '';
    } else if (post.media.status === 'rejected') {
      mediaState.textContent = isOwnPost ? 'This photo was not approved by your teacher.' : '';
    } else if (post.media.status === 'approved') {
      mediaState.textContent = '[Media — not yet supported in this build]';
    }
    if (mediaState.textContent) card.appendChild(mediaState);
  }

  if (post.source) {
    const detail = getEventDetailRoute(post.source);
    if (detail) {
      const sourceLink = document.createElement('button');
      sourceLink.type = 'button';
      sourceLink.className = 'btn btn--text student-feed__source-link';
      sourceLink.textContent = `${detail.ctaLabel} \u2192`;
      sourceLink.addEventListener('click', () => onNavigateToPath(detail.path));
      card.appendChild(sourceLink);
    }
  }

  const actions = document.createElement('div');
  actions.className = 'student-feed__actions';

  const hasReacted = currentUid !== null && (post.reactorUids || []).includes(currentUid);
  const reactButton = document.createElement('button');
  reactButton.type = 'button';
  reactButton.className = 'student-feed__reaction' + (hasReacted ? ' student-feed__reaction--active' : '');
  reactButton.textContent = `\u2764\ufe0f ${(post.reactorUids || []).length}`;
  reactButton.addEventListener('click', async () => {
    reactButton.disabled = true;
    await feedService.toggleReactionAsCurrentStudent(post.id, !hasReacted);
    reactButton.disabled = false;
    await refresh();
  });
  actions.appendChild(reactButton);

  const commentToggle = document.createElement('button');
  commentToggle.type = 'button';
  commentToggle.className = 'student-feed__comment-toggle';
  commentToggle.textContent = `\ud83d\udcac ${post.commentCount || 0}`;
  actions.appendChild(commentToggle);

  if (activeProfile && post.studentId === activeProfile.studentId) {
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'btn btn--text student-feed__delete';
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', async () => {
      const confirmed = window.confirm('Delete this post? This cannot be undone.');
      if (!confirmed) return;
      await feedService.deleteOwnPost(post.id);
      await refresh();
    });
    actions.appendChild(deleteButton);
  }

  card.appendChild(actions);

  const commentsSection = document.createElement('div');
  commentsSection.className = 'student-feed__comments';
  commentsSection.hidden = true;
  card.appendChild(commentsSection);

  commentToggle.addEventListener('click', async () => {
    commentsSection.hidden = !commentsSection.hidden;
    if (!commentsSection.hidden) {
      await renderComments(commentsSection, post, activeProfile, refresh);
    }
  });

  return card;
}

async function renderComments(commentsSection, post, activeProfile, refresh) {
  commentsSection.innerHTML = '';
  const comments = await feedService.listCommentsForCurrentStudent(post.id);

  comments.forEach((comment) => {
    const row = document.createElement('div');
    row.className = 'student-feed__comment';
    const commentAuthor = document.createElement('span');
    commentAuthor.className = 'student-feed__comment-author';
    commentAuthor.textContent = comment.authorName;
    const commentText = document.createElement('span');
    commentText.className = 'student-feed__comment-text';
    commentText.textContent = comment.text;
    row.append(commentAuthor, commentText);

    if (activeProfile && comment.studentId === activeProfile.studentId) {
      const deleteCommentButton = document.createElement('button');
      deleteCommentButton.type = 'button';
      deleteCommentButton.className = 'btn btn--text student-feed__comment-delete';
      deleteCommentButton.textContent = 'Delete';
      deleteCommentButton.addEventListener('click', async () => {
        await feedService.deleteOwnComment(post.id, comment.id);
        await refresh();
      });
      row.appendChild(deleteCommentButton);
    }
    commentsSection.appendChild(row);
  });

  const commentComposer = document.createElement('div');
  commentComposer.className = 'student-feed__comment-composer';
  const commentInput = document.createElement('input');
  commentInput.type = 'text';
  commentInput.placeholder = 'Write a comment...';
  commentComposer.appendChild(commentInput);
  const commentSubmit = document.createElement('button');
  commentSubmit.type = 'button';
  commentSubmit.className = 'btn btn--text';
  commentSubmit.textContent = 'Send';
  commentSubmit.addEventListener('click', async () => {
    const text = commentInput.value.trim();
    if (!text) return;
    await feedService.addCommentAsCurrentStudent(post.id, text);
    await refresh();
  });
  commentComposer.appendChild(commentSubmit);
  commentsSection.appendChild(commentComposer);
}
