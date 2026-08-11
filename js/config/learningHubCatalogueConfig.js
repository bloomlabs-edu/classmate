/**
 * config/learningHubCatalogueConfig.js
 *
 * The one thing ClassMate needs to know about Learning Hub's own
 * catalogue: where to fetch it from. Kept isolated in its own file,
 * per explicit product decision, so this can change later (a real
 * deployment URL, once Learning Hub has one) without touching the
 * Resource model, resourceService, or any UI that reads the
 * catalogue.
 *
 * PLACEHOLDER — Learning Hub is not deployed anywhere yet (see
 * ui/views/ConceptWorkspaceView.js's own LEARNING_HUB_HOST_PLACEHOLDER,
 * the same, already-accepted placeholder pattern used for the launch
 * URL itself). This is not a real, working URL yet.
 */
export const LEARNING_HUB_CATALOGUE_URL = 'https://learning-hub.example/catalogue.json';

/** Same placeholder-host reasoning as above, for the Packs list specifically. */
export const LEARNING_HUB_PACKS_URL = 'https://learning-hub.example/packs.json';
