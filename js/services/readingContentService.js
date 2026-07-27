/**
 * services/readingContentService.js
 *
 * Content CRUD for a Reading resource (see models/ReadingContent.js,
 * models/ReadingContentBlock.js). Its own file, not folded into
 * services/resourceService.js — that file owns resource *metadata*
 * (title, type, status, position among siblings); this file owns one
 * type's actual *content*. As Quiz/Worksheet/Simulation get their own
 * editors, each gets its own content service the same way — this file
 * is the template, not a shared "content service" every type reaches
 * into.
 *
 * Every real content edit (add/edit/delete a block) bumps the parent
 * resource's `updatedAt` — this is what the Dashboard's "Continue
 * Working" shortcut (see services/resourceService.js's
 * getMostRecentlyEditedResource()) actually keys off, so a teacher who
 * was just writing a lesson sees it surfaced next time they open the
 * app. Reordering does not bump it, matching
 * services/resourceService.js's own moveResourceUp/Down reasoning —
 * shuffling isn't writing.
 *
 * Same mutate-then-caller-saves convention as every other service in
 * this app: nothing here calls workspaceService.save() itself.
 */

import { createReadingContent } from '../models/ReadingContent.js';
import { createReadingContentBlock } from '../models/ReadingContentBlock.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

/** This resource's Reading content, defaulting to empty blocks if it's never been opened in the editor before (or was saved before this milestone existed). Never assumes `resource.content` is already shaped correctly. */
export function getReadingContent(resource) {
  if (resource.content && Array.isArray(resource.content.blocks)) {
    return resource.content;
  }
  return createReadingContent();
}

function ensureContent(resource) {
  if (!resource.content || !Array.isArray(resource.content.blocks)) {
    resource.content = createReadingContent();
  }
  return resource.content;
}

export function addBlock(resource, type) {
  const content = ensureContent(resource);
  const block = createReadingContentBlock({ type });
  content.blocks.push(block);
  resource.updatedAt = getCurrentIsoDate();
  return block;
}

export function updateBlockText(resource, blockId, text) {
  const content = ensureContent(resource);
  const block = content.blocks.find((b) => b.id === blockId);
  if (block) {
    block.text = text;
    resource.updatedAt = getCurrentIsoDate();
  }
  return block;
}

export function deleteBlock(resource, blockId) {
  const content = ensureContent(resource);
  const before = content.blocks.length;
  content.blocks = content.blocks.filter((b) => b.id !== blockId);
  if (content.blocks.length < before) {
    resource.updatedAt = getCurrentIsoDate();
  }
  return content.blocks.length < before;
}

/** Swaps a block with the one before it. No-op at the top of the list. Not a content edit — see this file's header comment — so it doesn't bump updatedAt. */
export function moveBlockUp(resource, blockId) {
  const content = ensureContent(resource);
  const index = content.blocks.findIndex((b) => b.id === blockId);
  if (index <= 0) return;
  [content.blocks[index - 1], content.blocks[index]] = [content.blocks[index], content.blocks[index - 1]];
}

/** Swaps a block with the one after it. No-op at the bottom of the list. Same "not a content edit" reasoning as moveBlockUp(). */
export function moveBlockDown(resource, blockId) {
  const content = ensureContent(resource);
  const index = content.blocks.findIndex((b) => b.id === blockId);
  if (index === -1 || index >= content.blocks.length - 1) return;
  [content.blocks[index], content.blocks[index + 1]] = [content.blocks[index + 1], content.blocks[index]];
}
