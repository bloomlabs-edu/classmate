import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createResource } from '../../js/models/Resource.js';

test('createResource: title/type/status/audience default correctly, content defaults to null', () => {
  const resource = createResource({ title: 'Photosynthesis reading', type: 'reading' });
  assert.equal(resource.title, 'Photosynthesis reading');
  assert.equal(resource.type, 'reading');
  assert.equal(resource.status, 'draft');
  assert.equal(resource.audience, 'teacher');
  assert.equal(resource.content, null);
  assert.ok(resource.id);
  assert.ok(resource.createdAt);
  assert.equal(resource.updatedAt, resource.createdAt);
});

// ---------------------------------------------------------------------
// The Timetable's own "+ Add resource" form (ui/views/TimetableView.js's
// openAddResourceFlow()) is the first caller to populate `content` for
// an 'external_link' resource at creation time, as `{ url, description }`
// — see services/resourceService.js's own updated createResourceOnConcept()
// header comment. This model itself deliberately knows nothing about
// that shape (per this file's own "type-specific, this model says
// nothing about it" doc comment) — these tests only confirm the
// generic `content` field round-trips whatever shape it's given,
// exactly like every other type's own content already does.
// ---------------------------------------------------------------------

test('createResource: an external_link resource\'s content shape ({url, description}) round-trips exactly', () => {
  const resource = createResource({
    title: 'NCERT Measurement chapter',
    type: 'external_link',
    content: { url: 'https://ncert.nic.in/measurement', description: 'Chapter PDF' },
  });
  assert.deepEqual(resource.content, { url: 'https://ncert.nic.in/measurement', description: 'Chapter PDF' });
  assert.equal(resource.type, 'external_link');
});

test('createResource: a null description is preserved as null, not coerced to an empty string or dropped', () => {
  const resource = createResource({ title: 'Link only', type: 'external_link', content: { url: 'https://example.com', description: null } });
  assert.equal(resource.content.url, 'https://example.com');
  assert.equal(resource.content.description, null);
});
