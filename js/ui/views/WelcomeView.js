/**
 * ui/views/WelcomeView.js
 *
 * The first-launch screen, shown whenever the Workspace has zero
 * classrooms — no dummy teams, students, Undo, Reset Session, or
 * scoreboards, per the brief. A title, subtitle, and two calls to
 * action: "+ New Classroom" for a brand-new teacher, and "Join a
 * Classroom" for a co-teacher who's signing in for the first time
 * specifically to join someone else's — this is exactly the screen
 * they'd land on before joining anything, so it needs both options,
 * not just PersonalHubView.js's (which only shows once at least one
 * classroom already exists).
 */

export function renderWelcomeView(container, { onNewClassroom, onJoinClassroom }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'welcome-view';

  const title = document.createElement('h1');
  title.className = 'welcome-view__title';
  title.textContent = 'Welcome to ClassMate';

  const subtitle = document.createElement('p');
  subtitle.className = 'welcome-view__subtitle';
  subtitle.textContent =
    'Create your first classroom to begin tracking participation and teamwork \u2014 or join one a co-teacher has already set up.';

  const actions = document.createElement('div');
  actions.className = 'welcome-view__actions';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--primary btn--large';
  button.textContent = '+ New Classroom';
  button.addEventListener('click', onNewClassroom);

  const joinButton = document.createElement('button');
  joinButton.type = 'button';
  joinButton.className = 'btn btn--ghost btn--large';
  joinButton.textContent = 'Join a Classroom';
  joinButton.addEventListener('click', onJoinClassroom);

  actions.append(button, joinButton);
  wrapper.append(title, subtitle, actions);
  container.appendChild(wrapper);
}
