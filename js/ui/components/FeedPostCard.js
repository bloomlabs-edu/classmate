/**
 * ui/components/FeedPostCard.js
 *
 * The ONE Class Feed post card — extracted from
 * ui/student-portal/views/StudentFeedView.js's own original
 * renderPostCard()/renderComments(), so both the student Feed and
 * the teacher Feed render the exact same card, reactions, and
 * comment thread, rather than two independently-designed
 * implementations. This is the direct fix for "teacher = admin page
 * that happens to display posts" — the teacher now gets this same
 * component, with moderation controls layered on additively.
 *
 * Deliberately reuses the existing `.student-feed__*` CSS classes
 * as-is (not renamed to something neutral) — renaming would touch
 * every existing rule for no visual benefit, and the whole point is
 * that the teacher Feed should look like this Feed, not a new one.
 *
 * Every underlying data operation (react, comment, delete) is
 * injected by the caller as a callback, so this file has zero
 * knowledge of student-vs-teacher auth paths — StudentFeedView.js
 * passes the student-write feedService functions, FeedModerationView.js
 * passes the teacher-write ones. Neither role's logic lives here.
 */

import { getEventDetailRoute } from '../../config/studentEventNavigation.js';

export function formatRelativeTime(isoString) {
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

/**
 * `options`:
 * - currentUid: for the "has reacted" highlight
 * - onNavigateToPath(path): optional — only used for ClassMate-generated share source links, a student-only concept today; teacher-authored posts never set `post.source`, so this is simply never called on that path
 * - isOwnPost(post): for the media-approval status line's own visibility, matching the exact original student-only condition
 * - onReact(postId, isReacting): required
 * - onListComments(postId): required
 * - onAddComment(postId, text): required
 * - canDeleteComment(comment): required — decides per-comment whether the delete control renders at all
 * - onDeleteComment(postId, commentId): required
 * - canDeletePost(post): required — decides whether the moderation/delete control renders at all for this card
 * - onDeletePost(postId): required
 * - onRefresh(): required — re-renders the caller's own list after any mutation
 * - deletePostLabel: defaults to 'Delete' (the student's own existing label); the teacher Feed can pass 'Delete post' if that reads more clearly as a moderation action, without changing the underlying control's own placement or visual weight
 */
export async function renderFeedPostCard(post, options) {
  const {
    currentUid,
    onNavigateToPath,
    isOwnPost,
    onReact,
    onListComments,
    onAddComment,
    canDeleteComment,
    onDeleteComment,
    canDeletePost,
    onDeletePost,
    onRefresh,
    deletePostLabel = 'Delete',
  } = options;

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
    const own = isOwnPost ? isOwnPost(post) : false;
    if (post.media.status === 'pending') {
      mediaState.textContent = own ? 'Photo waiting for teacher approval.' : '';
    } else if (post.media.status === 'rejected') {
      mediaState.textContent = own ? 'This photo was not approved by your teacher.' : '';
    } else if (post.media.status === 'approved') {
      mediaState.textContent = '[Media \u2014 not yet supported in this build]';
    }
    if (mediaState.textContent) card.appendChild(mediaState);
  }

  if (post.source && onNavigateToPath) {
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

  const hasReacted = currentUid !== null && currentUid !== undefined && (post.reactorUids || []).includes(currentUid);
  const reactButton = document.createElement('button');
  reactButton.type = 'button';
  reactButton.className = 'student-feed__reaction' + (hasReacted ? ' student-feed__reaction--active' : '');
  reactButton.textContent = `\u2764\ufe0f ${(post.reactorUids || []).length}`;
  reactButton.addEventListener('click', async () => {
    reactButton.disabled = true;
    await onReact(post.id, !hasReacted);
    reactButton.disabled = false;
    await onRefresh();
  });
  actions.appendChild(reactButton);

  const commentToggle = document.createElement('button');
  commentToggle.type = 'button';
  commentToggle.className = 'student-feed__comment-toggle';
  commentToggle.textContent = `\ud83d\udcac ${post.commentCount || 0}`;
  actions.appendChild(commentToggle);

  // The moderation/delete control — visually identical in weight and
  // placement to the student's own existing "Delete" control (same
  // class, same position in the actions row), per the explicit
  // "additive, not a giant standalone admin button" requirement.
  // Whether it appears at all is entirely the caller's own decision
  // (canDeletePost), never a hardcoded role check inside this shared
  // component.
  if (canDeletePost(post)) {
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'btn btn--text student-feed__delete';
    deleteButton.textContent = deletePostLabel;
    deleteButton.addEventListener('click', async () => {
      const confirmed = window.confirm('Delete this post? This cannot be undone.');
      if (!confirmed) return;
      await onDeletePost(post.id);
      await onRefresh();
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
      await renderComments(commentsSection, post, { onListComments, onAddComment, canDeleteComment, onDeleteComment, onRefresh });
    }
  });

  return card;
}

async function renderComments(commentsSection, post, { onListComments, onAddComment, canDeleteComment, onDeleteComment, onRefresh }) {
  commentsSection.innerHTML = '';
  const comments = await onListComments(post.id);

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

    if (canDeleteComment(comment)) {
      const deleteCommentButton = document.createElement('button');
      deleteCommentButton.type = 'button';
      deleteCommentButton.className = 'btn btn--text student-feed__comment-delete';
      deleteCommentButton.textContent = 'Delete';
      deleteCommentButton.addEventListener('click', async () => {
        await onDeleteComment(post.id, comment.id);
        await onRefresh();
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
    await onAddComment(post.id, text);
    await onRefresh();
  });
  commentComposer.appendChild(commentSubmit);
  commentsSection.appendChild(commentComposer);
}
