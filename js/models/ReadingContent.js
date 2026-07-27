/**
 * models/ReadingContent.js
 *
 * A Reading resource's actual content — an ordered list of blocks (see
 * models/ReadingContentBlock.js). Stored as `resource.content` on any
 * Resource whose `type` is `'reading'` (see models/Resource.js). Other
 * resource types will store their own differently-shaped content in
 * that same `content` field once their own editors exist — this file
 * only defines Reading's shape, not a generic "content" schema every
 * type has to fit into.
 *
 * An older Reading resource saved before this milestone simply has no
 * `content` field yet — every reader goes through
 * services/readingContentService.js's getReadingContent(), which
 * defaults a missing value to an empty ReadingContent rather than
 * assuming every reading resource already has one.
 */

export function createReadingContent({ blocks = [] } = {}) {
  return { blocks };
}
