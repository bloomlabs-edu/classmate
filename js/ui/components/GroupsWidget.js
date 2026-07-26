/**
 * ui/components/GroupsWidget.js
 *
 * Classroom Dashboard widget: a compact list of Groups (Teams) and
 * their student counts. Reuses the existing Settings > Groups tab for
 * actual management — this widget is read-only navigation, not a
 * second place to add/rename/remove groups.
 *
 * Phase 7B: each team renders as an overlapping avatar cluster (a
 * "huddle") rather than a plain text chip — Collaboration-intent's
 * distinct shape language (see CHANGELOG's Phase 7B entry). Distinct
 * from Recognition's single large ring-bordered avatar (one person,
 * celebrated) and Subjects' connected waypoint chips (a path, not
 * people) elsewhere on the same Dashboard.
 */

import { createEmptyStateElement } from './EmptyState.js';
import { createIconBadge } from './Icon.js';

const MAX_VISIBLE_AVATARS = 3;

function getInitials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts[0][0].toUpperCase();
}

export function createGroupsWidgetElement({ classroom, onOpenGroups }) {
  const widget = document.createElement('div');
  widget.className = 'dashboard-widget dashboard-widget--community';

  const heading = document.createElement('h2');
  heading.className = 'dashboard-widget__heading';
  heading.appendChild(createIconBadge('users', 'groups', { size: 28 }));
  heading.append('Groups');
  widget.appendChild(heading);

  // Same reasoning as Settings' Groups tab: the automatic Ungrouped
  // team (see classroomService.js's getOrCreateUngroupedTeam) isn't a
  // group the teacher created, so it's excluded from this "how is my
  // classroom organized" widget entirely. Teams with no students yet
  // are also excluded — an empty group row here isn't useful data,
  // just an empty box (see this project's CHANGELOG).
  const realTeams = classroom.teams.filter((team) => !team.isUngrouped && team.students.length > 0);

  if (realTeams.length === 0) {
    widget.appendChild(createEmptyStateElement({ message: 'Add a group in Settings to bring your class together.' }));
    return widget;
  }

  const list = document.createElement('div');
  list.className = 'huddle-list';

  realTeams.forEach((team) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'huddle-list__row';
    row.addEventListener('click', onOpenGroups);

    const cluster = document.createElement('div');
    cluster.className = 'huddle-list__cluster';

    const visibleStudents = team.students.slice(0, MAX_VISIBLE_AVATARS);
    visibleStudents.forEach((student) => {
      const avatar = document.createElement('span');
      avatar.className = 'huddle-list__avatar';
      avatar.textContent = getInitials(student.name);
      cluster.appendChild(avatar);
    });

    const overflow = team.students.length - visibleStudents.length;
    if (overflow > 0) {
      const more = document.createElement('span');
      more.className = 'huddle-list__avatar huddle-list__avatar--overflow';
      more.textContent = `+${overflow}`;
      cluster.appendChild(more);
    }

    row.appendChild(cluster);

    const name = document.createElement('span');
    name.className = 'huddle-list__name';
    name.textContent = team.name;
    row.appendChild(name);

    list.appendChild(row);
  });

  widget.appendChild(list);
  return widget;
}
