/**
 * services/workTypes/NotebookWorkType.js
 *
 * The Notebook domain's own Work Type — see workTypeContract.js for
 * the frozen interface this implements.
 *
 * Composes services/workRequestService.js and
 * services/notebookConfigService.js directly — it decides nothing
 * those services don't already decide. getActiveWork() answers "what
 * work is active" by reading each open WorkRequest's own entry
 * statuses (workRequestService.getEntriesByStatus()); getStartActions()
 * answers "what can be started" by finding every configured
 * Subject x Notebook Type combination that currently has no open
 * request (workRequestService.getActiveWorkRequest() returning null).
 *
 * Every item's `navigateTo` is a plain route path string, reusing the
 * exact routes main.js's own dispatch already handles
 * (#/classroom/{id}/work-requests/{requestId} and
 * #/classroom/{id}/notebooks/{subjectId}/{typeId}) — this file never
 * calls router.navigate itself, never imports router.js, and has no
 * idea a Dashboard exists.
 */

import * as workRequestService from '../workRequestService.js';
import * as notebookConfigService from '../notebookConfigService.js';

const ACTIVE_STATUS_GROUPS = [
  { statuses: ['assigned'], subtitle: 'Awaiting Submission' },
  { statuses: ['submitted', 'resubmitted'], subtitle: 'Awaiting Review' },
  { statuses: ['needs_correction'], subtitle: 'Needs Correction' },
];

function getActiveWork(classroom) {
  const items = [];

  workRequestService
    .listWorkRequests(classroom)
    .filter((request) => workRequestService.isOpen(request))
    .forEach((request) => {
      ACTIVE_STATUS_GROUPS.forEach(({ statuses, subtitle }) => {
        const count = statuses.reduce((sum, status) => sum + workRequestService.getEntriesByStatus(request, status).length, 0);
        if (count > 0) {
          items.push({
            title: request.title,
            subtitle,
            count,
            navigateTo: `/classroom/${classroom.id}/work-requests/${request.id}`,
          });
        }
      });
    });

  return items;
}

function getStartActions(classroom) {
  const items = [];

  notebookConfigService.listSubjects(classroom).forEach((subject) => {
    notebookConfigService.listNotebookTypes(classroom, subject.id).forEach((notebookType) => {
      const activeRequest = workRequestService.getActiveWorkRequest(classroom, {
        type: 'notebook',
        subjectId: subject.id,
        notebookTypeId: notebookType.id,
      });
      if (!activeRequest) {
        items.push({
          title: `New ${notebookType.name}`,
          subtitle: subject.name,
          count: undefined,
          navigateTo: `/classroom/${classroom.id}/notebooks/${subject.id}/${notebookType.id}`,
        });
      }
    });
  });

  return items;
}

export const NotebookWorkType = { getActiveWork, getStartActions };
