/**
 * ui/components/SparkBrowser.js
 *
 * The Spark discovery/browse UI — "✨ Browse Sparks", the primary
 * cross-Fellow collaboration surface for Chapter Planning. Modeled on
 * ui/components/TeachingIdeasBrowser.js's own shape (filter bar + card
 * list, one real Firestore query then client-side filtering), but the
 * underlying entity is the independent models/Spark.js, NEVER
 * TeachingIdeas — this file imports nothing from
 * services/teachingIdeasService.js or repositories/teachingIdeasRepository.js,
 * and Sparks are never gated on any LessonPlan being approved.
 *
 * Core product principle this UI exists to serve: "Don't make teachers
 * browse what other teachers wrote. Make them browse what other
 * teachers discovered." A Spark card shows enough to decide whether
 * it's useful (title, type, description, provenance) — never a whole
 * Chapter Plan or LessonPlan to read through first.
 *
 * Discovery priority (see repositories/sparkRepository.js's own header
 * comment for why two queries exist):
 *   1. `linkedCurriculumUnitId` — the stable cross-classroom chapter
 *      identity (see models/ChapterPlan.js's own header comment). Used
 *      whenever the calling Chapter Plan has one.
 *   2. `subjectId` — the fallback when there's no linked chapter
 *      identity to query by (an honest Phase 1 limitation, not fixed
 *      here).
 * Once one real query has narrowed the result set, `conceptIds`/grade/
 * type/free-text are all client-side filters via
 * services/sparkService.js's own filterSparks() — never a second
 * Firestore query, matching TeachingIdeasBrowser.js's identical
 * two-step convention.
 */

import * as sparkRepository from '../../repositories/sparkRepository.js';
import * as sparkService from '../../services/sparkService.js';
import { getSparkCardDisplay, SPARK_TYPE_LABELS, isSparkConceptRelevant } from './SparkCardDisplay.js';
import { createIcon } from './Icon.js';

export function renderSparkBrowser(container, { linkedCurriculumUnitId, subjectId, gradeLabel = null, conceptIds = [], onUseSpark }) {
  let loading = true;
  let loadError = null;
  let sparks = [];
  const filters = { sparkType: '', gradeLevel: gradeLabel || '', searchText: '' };

  function rerender() {
    renderBrowser(container, { loading, loadError, filters, results: loading || loadError ? [] : sparkService.filterSparks(sparks, buildActiveFilters()) }, {
      onFilterChange: (field, value) => {
        filters[field] = value;
        rerender();
      },
      onUseSpark,
    });
  }

  function buildActiveFilters() {
    return {
      sparkType: filters.sparkType || undefined,
      gradeLevel: filters.gradeLevel || undefined,
      searchText: filters.searchText || undefined,
      // conceptId narrowing is intentionally NOT applied here as a hard
      // filter — a Chapter Plan may have several conceptIds at once, and
      // "must match every one of them" would hide Sparks relevant to
      // just one; see renderBrowser()'s own concept-relevance badge for
      // how this app instead SURFACES the match without excluding
      // anything.
    };
  }

  rerender();

  const fetchSparks = linkedCurriculumUnitId
    ? sparkRepository.getSparksForLinkedCurriculumUnitId(linkedCurriculumUnitId)
    : sparkRepository.getSparksBySubjectId(subjectId);

  fetchSparks
    .then((fetched) => {
      sparks = fetched;
      loading = false;
      rerender();
    })
    .catch((error) => {
      console.error('[SparkBrowser] Failed to load Sparks:', error);
      loading = false;
      loadError = "Couldn't load Sparks. Check your connection and try again.";
      rerender();
    });

  function renderBrowser(target, state, handlers) {
    target.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'spark-browser';

    const intro = document.createElement('p');
    intro.className = 'spark-browser__intro';
    intro.textContent = linkedCurriculumUnitId
      ? 'Ideas other Fellows discovered for this chapter.'
      : 'This chapter isn’t linked to a shared curriculum unit yet, so Sparks are shown for this subject instead.';
    wrapper.appendChild(intro);

    wrapper.appendChild(renderFilterBar(state, handlers));

    if (state.loadError) {
      const error = document.createElement('p');
      error.className = 'spark-browser__error';
      error.textContent = state.loadError;
      wrapper.appendChild(error);
      target.appendChild(wrapper);
      return;
    }

    if (state.loading) {
      const loadingEl = document.createElement('p');
      loadingEl.className = 'spark-browser__loading';
      loadingEl.textContent = 'Loading Sparks…';
      wrapper.appendChild(loadingEl);
      target.appendChild(wrapper);
      return;
    }

    if (state.results.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'spark-browser__empty';
      empty.appendChild(createIcon('search', { size: 20 }));
      const text = document.createElement('span');
      text.textContent = 'No Sparks found yet — be the first to add one from this Chapter Plan.';
      empty.appendChild(text);
      wrapper.appendChild(empty);
      target.appendChild(wrapper);
      return;
    }

    // Concept-relevant Sparks first, without ever hiding the rest —
    // "prioritize concept relevance," never "restrict to it only."
    const sorted = [...state.results].sort((a, b) => Number(isConceptRelevant(b)) - Number(isConceptRelevant(a)));

    const list = document.createElement('div');
    list.className = 'spark-browser__card-list';
    sorted.forEach((spark) => {
      const display = getSparkCardDisplay(spark);
      const card = document.createElement('div');
      card.className = 'spark-browser__card';

      const titleRow = document.createElement('div');
      titleRow.className = 'spark-browser__card-title-row';
      const titleEl = document.createElement('span');
      titleEl.className = 'spark-browser__card-title';
      titleEl.textContent = display.title;
      titleRow.appendChild(titleEl);
      if (display.typeLabel) {
        const typeBadge = document.createElement('span');
        typeBadge.className = 'spark-browser__card-type-badge';
        typeBadge.textContent = display.typeLabel;
        titleRow.appendChild(typeBadge);
      }
      if (isSparkConceptRelevant(spark, conceptIds)) {
        const conceptBadge = document.createElement('span');
        conceptBadge.className = 'spark-browser__card-concept-badge';
        conceptBadge.textContent = 'Matches your concepts';
        titleRow.appendChild(conceptBadge);
      }
      card.appendChild(titleRow);

      if (display.description) {
        const description = document.createElement('p');
        description.className = 'spark-browser__card-description';
        description.textContent = display.description;
        card.appendChild(description);
      }

      const meta = document.createElement('span');
      meta.className = 'spark-browser__card-meta';
      meta.textContent = display.meta;
      card.appendChild(meta);

      const useButton = document.createElement('button');
      useButton.type = 'button';
      useButton.className = 'btn btn--secondary spark-browser__card-use-button';
      useButton.textContent = 'Use Spark';
      useButton.addEventListener('click', () => handlers.onUseSpark(spark));
      card.appendChild(useButton);

      list.appendChild(card);
    });
    wrapper.appendChild(list);

    target.appendChild(wrapper);
  }

  function renderFilterBar(state, handlers) {
    const bar = document.createElement('div');
    bar.className = 'spark-browser__filter-bar';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'spark-browser__search-input';
    searchInput.placeholder = 'Search Sparks…';
    searchInput.value = state.filters.searchText;
    searchInput.addEventListener('input', () => handlers.onFilterChange('searchText', searchInput.value));
    bar.appendChild(searchInput);

    const typeSelect = document.createElement('select');
    typeSelect.className = 'spark-browser__type-select';
    const anyTypeOption = document.createElement('option');
    anyTypeOption.value = '';
    anyTypeOption.textContent = 'Any type';
    typeSelect.appendChild(anyTypeOption);
    Object.entries(SPARK_TYPE_LABELS).forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      typeSelect.appendChild(option);
    });
    typeSelect.value = state.filters.sparkType;
    typeSelect.addEventListener('change', () => handlers.onFilterChange('sparkType', typeSelect.value));
    bar.appendChild(typeSelect);

    const gradeInput = document.createElement('input');
    gradeInput.type = 'text';
    gradeInput.className = 'spark-browser__grade-input';
    gradeInput.placeholder = 'Grade';
    gradeInput.value = state.filters.gradeLevel;
    gradeInput.addEventListener('change', () => handlers.onFilterChange('gradeLevel', gradeInput.value));
    bar.appendChild(gradeInput);

    return bar;
  }
}
