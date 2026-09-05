/**
 * ui/components/TeachingIdeasBrowser.js
 *
 * The one Teaching Ideas discovery/browse UI — shared by
 * ui/views/ConceptWorkspaceView.js's own "Teaching Ideas" tab
 * (discovery/preview only) and ui/views/LessonPlanBuilderView.js's own
 * "+ From Teaching Ideas" pickers (preview + Copy to Lesson), per
 * explicit Phase 4 product direction not to build two independent
 * discovery UIs. The only difference between the two callers is
 * whether `onCopyElement` is supplied — see
 * ui/components/TeachingIdeaPreviewModal.js's own header comment for
 * why that toggle lives at the preview-modal layer, not here.
 *
 * Always Concept-scoped (never an unbounded "browse everything" list),
 * matching repositories/teachingIdeasRepository.js's own
 * getTeachingIdeasForConcept() — the single Firestore query this
 * component ever makes, once per mount. Grade/Subject/Element-type/
 * text filtering happens client-side afterward via
 * services/teachingIdeasService.js's own pure filter functions — same
 * hand-rolled-filter convention already used elsewhere in this app
 * (see that file's own header comment), no new search/filter
 * component.
 *
 * `elementTypeFilter` fixes the browser to ONE element type when
 * given (e.g. the Builder's own "+ From Teaching Ideas" next to
 * "Learning Activities" only ever wants Activities) — omit it (as
 * Concept Workspace's tab does) to show every category.
 */

import * as teachingIdeasRepository from '../../repositories/teachingIdeasRepository.js';
import * as teachingIdeasService from '../../services/teachingIdeasService.js';
import { openTeachingIdeaElementPreview, openTeachingIdeaLessonPreview } from './TeachingIdeaPreviewModal.js';
import { createIcon } from './Icon.js';

const ELEMENT_TYPE_LABELS = Object.freeze({
  spark: 'Sparks',
  activity: 'Activities',
  question: 'Questions',
  assessment: 'Assessment Ideas',
  differentiation: 'Differentiation',
});

export function renderTeachingIdeasBrowser(container, { conceptId, conceptTitle, initialGradeLabel = null, initialSubjectId = null, elementTypeFilter = null, onCopyElement = null }) {
  let loading = true;
  let loadError = null;
  let teachingIdeas = [];
  const filters = { gradeLabel: initialGradeLabel || '', subjectId: initialSubjectId || '', elementType: elementTypeFilter || '', searchText: '' };

  function rerender() {
    renderBrowser(container, { loading, loadError, conceptTitle, elementTypeFilter, filters, results: loading || loadError ? null : computeResults() }, {
      onFilterChange: (field, value) => {
        filters[field] = value;
        rerender();
      },
      onPreviewElement: (element) => {
        openTeachingIdeaElementPreview({ element, onCopy: onCopyElement });
      },
      onPreviewLesson: (teachingIdea) => {
        openTeachingIdeaLessonPreview({ teachingIdea });
      },
    });
  }

  function computeResults() {
    const elements = teachingIdeasService.extractElementsForDiscovery(teachingIdeas, {
      elementType: filters.elementType || undefined,
      gradeLabel: filters.gradeLabel || undefined,
      subjectId: filters.subjectId || undefined,
      searchText: filters.searchText || undefined,
    });
    const lessonExamples = teachingIdeasService.filterLessonExamples(teachingIdeas, {
      gradeLabel: filters.gradeLabel || undefined,
      subjectId: filters.subjectId || undefined,
      searchText: filters.searchText || undefined,
    });
    const grouped = {};
    Object.keys(ELEMENT_TYPE_LABELS).forEach((type) => {
      grouped[type] = elements.filter((element) => element.elementType === type);
    });
    return { lessonExamples, grouped };
  }

  rerender();

  teachingIdeasRepository
    .getTeachingIdeasForConcept(conceptId)
    .then((fetched) => {
      teachingIdeas = fetched;
      loading = false;
      rerender();
    })
    .catch((error) => {
      console.error('[TeachingIdeasBrowser] Failed to load Teaching Ideas:', error);
      loading = false;
      loadError = "Couldn't load Teaching Ideas. Check your connection and try again.";
      rerender();
    });
}

function renderBrowser(container, state, handlers) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'teaching-ideas-browser';

  const intro = document.createElement('p');
  intro.className = 'teaching-ideas-browser__intro';
  intro.textContent = `How have other teachers taught ${state.conceptTitle || 'this concept'}?`;
  wrapper.appendChild(intro);

  wrapper.appendChild(renderFilterBar(state, handlers));

  if (state.loadError) {
    const error = document.createElement('p');
    error.className = 'teaching-ideas-browser__error';
    error.textContent = state.loadError;
    wrapper.appendChild(error);
    container.appendChild(wrapper);
    return;
  }

  if (state.loading) {
    const loading = document.createElement('p');
    loading.className = 'teaching-ideas-browser__loading';
    loading.textContent = 'Loading Teaching Ideas…';
    wrapper.appendChild(loading);
    container.appendChild(wrapper);
    return;
  }

  const { lessonExamples, grouped } = state.results;
  const totalElements = Object.values(grouped).reduce((sum, list) => sum + list.length, 0);

  if (lessonExamples.length === 0 && totalElements === 0) {
    const empty = document.createElement('div');
    empty.className = 'teaching-ideas-browser__empty';
    empty.appendChild(createIcon('search', { size: 20 }));
    const text = document.createElement('span');
    text.textContent = 'No Teaching Ideas found yet for this concept — approved lessons tagged with it will show up here.';
    empty.appendChild(text);
    wrapper.appendChild(empty);
    container.appendChild(wrapper);
    return;
  }

  if (!state.elementTypeFilter) {
    wrapper.appendChild(renderLessonExamplesSection(lessonExamples, handlers));
  }

  Object.entries(ELEMENT_TYPE_LABELS).forEach(([type, label]) => {
    if (state.elementTypeFilter && state.elementTypeFilter !== type) return;
    wrapper.appendChild(renderElementSection(label, grouped[type], handlers));
  });

  container.appendChild(wrapper);
}

function renderFilterBar(state, handlers) {
  const bar = document.createElement('div');
  bar.className = 'teaching-ideas-browser__filter-bar';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'teaching-ideas-browser__search-input';
  searchInput.placeholder = 'Search title or content…';
  searchInput.value = state.filters.searchText;
  searchInput.addEventListener('input', () => handlers.onFilterChange('searchText', searchInput.value));
  bar.appendChild(searchInput);

  const gradeInput = document.createElement('input');
  gradeInput.type = 'text';
  gradeInput.className = 'teaching-ideas-browser__grade-input';
  gradeInput.placeholder = 'Grade';
  gradeInput.value = state.filters.gradeLabel;
  gradeInput.addEventListener('change', () => handlers.onFilterChange('gradeLabel', gradeInput.value));
  bar.appendChild(gradeInput);

  return bar;
}

function renderLessonExamplesSection(lessonExamples, handlers) {
  const section = document.createElement('div');
  section.className = 'teaching-ideas-browser__section';

  const heading = document.createElement('h3');
  heading.className = 'teaching-ideas-browser__section-heading';
  heading.textContent = `Lesson Examples (${lessonExamples.length})`;
  section.appendChild(heading);

  if (lessonExamples.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'teaching-ideas-browser__section-empty';
    empty.textContent = 'No complete lesson examples match yet.';
    section.appendChild(empty);
    return section;
  }

  const list = document.createElement('div');
  list.className = 'teaching-ideas-browser__card-list';
  lessonExamples.forEach((teachingIdea) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'teaching-ideas-browser__card';
    const title = document.createElement('span');
    title.className = 'teaching-ideas-browser__card-title';
    title.textContent = teachingIdea.topic || 'Untitled Lesson Plan';
    card.appendChild(title);
    const meta = document.createElement('span');
    meta.className = 'teaching-ideas-browser__card-meta';
    meta.textContent = `${teachingIdea.teacherDisplayName || 'A teacher'}${teachingIdea.gradeLabel ? ' · ' + teachingIdea.gradeLabel : ''}`;
    card.appendChild(meta);
    card.addEventListener('click', () => handlers.onPreviewLesson(teachingIdea));
    list.appendChild(card);
  });
  section.appendChild(list);

  return section;
}

function renderElementSection(label, elements, handlers) {
  const section = document.createElement('div');
  section.className = 'teaching-ideas-browser__section';

  const heading = document.createElement('h3');
  heading.className = 'teaching-ideas-browser__section-heading';
  heading.textContent = `${label} (${elements.length})`;
  section.appendChild(heading);

  if (elements.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'teaching-ideas-browser__section-empty';
    empty.textContent = 'Nothing here yet.';
    section.appendChild(empty);
    return section;
  }

  const list = document.createElement('div');
  list.className = 'teaching-ideas-browser__card-list';
  elements.forEach((element) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'teaching-ideas-browser__card';
    const title = document.createElement('span');
    title.className = 'teaching-ideas-browser__card-title';
    title.textContent = element.title;
    card.appendChild(title);
    const meta = document.createElement('span');
    meta.className = 'teaching-ideas-browser__card-meta';
    meta.textContent = `${element.sourceContext.teacherDisplayName || 'A teacher'} · ${element.sourceContext.topic || 'Untitled Lesson Plan'}`;
    card.appendChild(meta);
    card.addEventListener('click', () => handlers.onPreviewElement(element));
    list.appendChild(card);
  });
  section.appendChild(list);

  return section;
}
