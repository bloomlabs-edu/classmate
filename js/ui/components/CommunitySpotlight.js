/**
 * ui/components/CommunitySpotlight.js
 *
 * Replaces the old "invite-students" recommendation (see
 * services/recommendationEngine.js, where that rule has been removed
 * entirely) as a permanent Dashboard fixture — not another
 * conditional recommendation, always present regardless of setup
 * state. Where that system reminds a teacher what to finish setting
 * up in *their own* classroom, this reminds them they're part of a
 * larger community of teachers building shared resources together.
 *
 * MVP: sample data only, hardcoded below (SAMPLE_SPOTLIGHT_DATA).
 * Nothing here reads from Firestore or any other service yet — no
 * community features (following, ratings, profiles) exist to read
 * from. "Explore Community" has no destination wired yet, by
 * explicit instruction not to build community features in this
 * milestone; it's a real, present button, not a stub styled to look
 * disabled.
 *
 * Structured for real data later without a rewrite: this component
 * accepts one `data` object shaped exactly like what a future
 * community service would return —
 *
 *   {
 *     featuredTeacher: { name, organisation, profilePhotoUrl,
 *                         publishedThisWeek: [{ type, count }],
 *                         communityRating },
 *     recentlyPublished: [{ title, subject, resourceType, author }],
 *   }
 *
 * — so swapping SAMPLE_SPOTLIGHT_DATA for a real fetch later is a
 * one-line change at the call site, not a component change. Each
 * section of the card is its own small render function
 * (renderFeaturedTeacherSection, renderRecentlyPublishedSection) so
 * a future section — Top Contributors, Teacher Profiles, Community
 * Ratings, Followers, Most Downloaded Resources, Resource of the
 * Week, New Contributors, Monthly Recognition, Community Milestones —
 * is a new function alongside these two and one new line in
 * renderCommunitySpotlight(), not a restructuring of what's already
 * here. None of those are built in this milestone.
 */

const SAMPLE_SPOTLIGHT_DATA = {
  featuredTeacher: {
    name: 'Anjali R.',
    organisation: 'Teach For India',
    profilePhotoUrl: null,
    publishedThisWeek: [
      { type: 'Worksheets', count: 4 },
      { type: 'Learn Journeys', count: 2 },
    ],
    communityRating: 4.9,
  },
  recentlyPublished: [
    { title: 'Force and Pressure Quiz', subject: 'Science', resourceType: 'Quiz', author: 'Anjali R.' },
    { title: 'Carnatic Wars Lesson Journey', subject: 'Social Science', resourceType: 'Learn Journey', author: 'Vikram S.' },
    { title: 'Weather & Climate Worksheet', subject: 'Science', resourceType: 'Worksheet', author: 'Priya M.' },
  ],
};

export function renderCommunitySpotlight(container, { onExploreCommunity, data = SAMPLE_SPOTLIGHT_DATA } = {}) {
  container.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'community-spotlight';

  const heading = document.createElement('h2');
  heading.className = 'community-spotlight__heading';
  heading.textContent = '\ud83c\udf1f Community Spotlight';
  card.appendChild(heading);

  card.appendChild(renderFeaturedTeacherSection(data.featuredTeacher));
  card.appendChild(createDivider());
  card.appendChild(renderRecentlyPublishedSection(data.recentlyPublished));
  card.appendChild(createDivider());
  card.appendChild(renderExploreCommunityAction(onExploreCommunity));

  container.appendChild(card);
}

function createDivider() {
  const divider = document.createElement('hr');
  divider.className = 'community-spotlight__divider';
  return divider;
}

function renderFeaturedTeacherSection(featuredTeacher) {
  const section = document.createElement('div');
  section.className = 'community-spotlight__featured-teacher';

  const label = document.createElement('p');
  label.className = 'community-spotlight__section-label';
  label.textContent = 'Featured Teacher';
  section.appendChild(label);

  const identityRow = document.createElement('div');
  identityRow.className = 'community-spotlight__teacher-identity';

  const avatar = document.createElement('div');
  avatar.className = 'community-spotlight__avatar';
  if (featuredTeacher.profilePhotoUrl) {
    const img = document.createElement('img');
    img.src = featuredTeacher.profilePhotoUrl;
    img.alt = featuredTeacher.name;
    avatar.appendChild(img);
  } else {
    avatar.textContent = featuredTeacher.name.charAt(0);
  }
  identityRow.appendChild(avatar);

  const nameBlock = document.createElement('div');
  const name = document.createElement('p');
  name.className = 'community-spotlight__teacher-name';
  name.textContent = featuredTeacher.name;
  const organisation = document.createElement('p');
  organisation.className = 'community-spotlight__teacher-org';
  organisation.textContent = featuredTeacher.organisation;
  nameBlock.append(name, organisation);
  identityRow.appendChild(nameBlock);

  section.appendChild(identityRow);

  const publishedLabel = document.createElement('p');
  publishedLabel.className = 'community-spotlight__published-label';
  publishedLabel.textContent = 'Published this week:';
  section.appendChild(publishedLabel);

  const publishedList = document.createElement('ul');
  publishedList.className = 'community-spotlight__published-list';
  featuredTeacher.publishedThisWeek.forEach(({ type, count }) => {
    const item = document.createElement('li');
    item.textContent = `${count} ${type}`;
    publishedList.appendChild(item);
  });
  section.appendChild(publishedList);

  const rating = document.createElement('p');
  rating.className = 'community-spotlight__rating';
  const filledStars = Math.round(featuredTeacher.communityRating);
  rating.textContent = `${'\u2b50'.repeat(filledStars)} ${featuredTeacher.communityRating} Community Rating`;
  section.appendChild(rating);

  return section;
}

function renderRecentlyPublishedSection(recentlyPublished) {
  const section = document.createElement('div');
  section.className = 'community-spotlight__recently-published';

  const label = document.createElement('p');
  label.className = 'community-spotlight__section-label';
  label.textContent = 'Recently Published';
  section.appendChild(label);

  const list = document.createElement('ul');
  list.className = 'community-spotlight__resource-list';
  recentlyPublished.forEach((resource) => {
    const item = document.createElement('li');
    item.textContent = resource.title;
    list.appendChild(item);
  });
  section.appendChild(list);

  return section;
}

function renderExploreCommunityAction(onExploreCommunity) {
  const wrapper = document.createElement('div');
  wrapper.className = 'community-spotlight__actions';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--primary';
  button.textContent = 'Explore Community';
  if (onExploreCommunity) {
    button.addEventListener('click', onExploreCommunity);
  }
  wrapper.appendChild(button);

  return wrapper;
}
