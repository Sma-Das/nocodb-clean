import { LRUCache } from 'lru-cache'
import type { Block } from '../utils/markdownUtils'

// Lives apart from ./markdownLoader so `clearTextCache` (utils/canvas) can reset it without
// importing the TipTap-based parser into the startup bundle.
export const markdownTextCache: LRUCache<string, { blocks: Block[]; width: number }> = new LRUCache({
  max: 1000,
})
