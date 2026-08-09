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

export async function renderFeedModerationView(container, { classroom, onBack }) {
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
  wrapper.appendChild(header);

  const banner = document.createElement('div');
  banner.className = 'feed-moderation__banner';
  banner.hidden = true;
  wrapper.appendChild(banner);

  const feedList = document.createElement('div');
  feedList.className = 'feed-moderation__list';
  wrapper.appendChild(feedList);

  container.appendChild(wrapper);

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
