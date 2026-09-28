/**
 * ui/components/SparkCardDisplay.js
 *
 * A Spark browser card's own display logic — pure, no DOM, no
 * Firestore import, split into its own file for the identical reason
 * ui/views/ChapterPlanRowDisplay.js's own header comment documents:
 * ui/components/SparkBrowser.js itself imports
 * repositories/sparkRepository.js, which transitively pulls in the
 * Firebase SDK from a `https://` URL Node's own ESM loader can't
 * resolve outside a browser — this logic lives here instead so
 * tests/ui/sparkCardDisplay.test.js can exercise it directly.
 */

import { SPARK_TYPES } from '../../models/Spark.js';

export const SPARK_TYPE_LABELS = Object.freeze({
  [SPARK_TYPES.ACTIVITY]: 'Activity',
  [SPARK_TYPES.HOOK]: 'Hook',
  [SPARK_TYPES.QUESTION]: 'Question',
  [SPARK_TYPES.METHOD]: 'Method',
  [SPARK_TYPES.ASSESSMENT]: 'Assessment',
  [SPARK_TYPES.REVISION]: 'Revision',
  [SPARK_TYPES.DIFFERENTIATION]: 'Differentiation',
  [SPARK_TYPES.EXPERIMENT]: 'Experiment',
  [SPARK_TYPES.DISCUSSION]: 'Discussion',
  [SPARK_TYPES.OTHER]: 'Other',
});

/**
 * The exact card text one Spark shows — title, type label, description,
 * and a provenance line ("Created by [Fellow]…") — never the Spark's
 * own full instructions/content, per explicit product direction ("a
 * compact Spark card containing enough information to decide whether
 * it is useful," never the whole idea read in full before deciding).
 */
export function getSparkCardDisplay(spark) {
  return {
    title: spark.title || 'Untitled Spark',
    typeLabel: SPARK_TYPE_LABELS[spark.sparkType] || null,
    description: spark.description || '',
    meta: `Created by ${spark.createdByUid || 'a Fellow'}${spark.estimatedTime ? ' · ' + spark.estimatedTime : ''}`,
  };
}

/** Whether a Spark's own `conceptIds` overlaps with the Chapter Plan's own — the "Matches your concepts" badge, prioritizing relevance without ever excluding anything (see ui/components/SparkBrowser.js's own header comment on why this is a sort key, never a filter). */
export function isSparkConceptRelevant(spark, conceptIds) {
  if (!conceptIds || conceptIds.length === 0) return false;
  return (spark.conceptIds || []).some((id) => conceptIds.includes(id));
}
