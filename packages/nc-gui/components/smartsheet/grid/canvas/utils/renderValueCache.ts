import { LRUCache } from 'lru-cache'
import dayjs from 'dayjs'

/**
 * Per-frame memo for pure "cell value → display value" work in the canvas renderers
 * (date parsing/formatting, timezone conversion, JSON parsing). The grid repaints every
 * visible cell on each frame (scroll, hover, selection), so without this the same values
 * are re-parsed tens of times per second.
 *
 * Only cache results that are a pure function of the key. Date output also depends on the
 * active dayjs locale, so `dateCacheKey` folds it in.
 */
const renderValueCache = new LRUCache<string, any>({
  max: 5000,
  // Keys embed the raw value (JSON / attachment text can be large), so bound memory too:
  // ~4M chars total; anything over 256K chars is simply not cached.
  maxSize: 4_000_000,
  maxEntrySize: 256_000,
  sizeCalculation: (v, k) => Math.max(1, k.length + (typeof v === 'string' ? v.length : k.length)),
})

export function memoRenderValue<T>(key: string, compute: () => T): T {
  const cached = renderValueCache.get(key)
  if (cached !== undefined) return cached as T
  const result = compute()
  // `undefined` is not cacheable in LRUCache; callers return '' / null instead
  if (result !== undefined) renderValueCache.set(key, result)
  return result
}

export function dateCacheKey(kind: string, ...parts: Array<string | number | boolean | null | undefined>) {
  return `${kind}\u0000${dayjs.locale()}\u0000${parts.join('\u0000')}`
}
