/**
 * Helpers for the infinite-scroll row cache shared by the grid (canvas + legacy table),
 * gallery, kanban and shared views.
 *
 * Kept dependency-light (types only) so the pure logic can be unit-tested without the
 * Nuxt auto-import runtime.
 */

/**
 * Write freshly-fetched server rows into an infinite-scroll cache, dropping any stale
 * duplicate of the same record that may already sit at a different index.
 *
 * A record can end up cached at two indices when an optimistic structural change
 * (e.g. `clearInvalidRows` shifting rows up after a record leaves the view, or a
 * re-sort) moves it while a chunk fetch issued against the pre-shift state is still
 * in flight. When that stale fetch resolves it re-adds the record at its old index,
 * leaving the same record rendered twice at the buffer boundary (issue #9464).
 *
 * The freshly-written rows are authoritative, so any other cache entry sharing the same
 * primary key is removed first — guaranteeing the cache never holds a record twice.
 * Rows without a primary key (unsaved new rows) are left untouched.
 *
 * Removing a duplicate leaves a hole in its chunk, so the removed indices are returned —
 * callers must mark those chunks unloaded or the hole renders as a permanent placeholder.
 *
 * @param cachedRows  the index -> Row cache to mutate in place
 * @param newItems    rows just fetched/formatted from the server
 * @param getPk       extracts a stable primary key from a row's data (null when absent)
 * @returns           indices whose stale duplicate was removed
 */
export const upsertCachedRows = (
  cachedRows: Map<number, Row>,
  newItems: Row[],
  getPk: (row: Record<string, any>) => string | null,
): number[] => {
  const removedIndices: number[] = []

  if (!newItems?.length) return removedIndices

  const incomingPks = new Set<string>()
  const incomingIndices = new Set<number>()

  for (const item of newItems) {
    incomingIndices.add(item.rowMeta.rowIndex!)
    const pk = getPk(item.row)
    if (pk !== null && pk !== '') incomingPks.add(pk)
  }

  if (incomingPks.size) {
    for (const [index, row] of cachedRows) {
      // Indices the new rows will overwrite anyway don't need a stale-duplicate check.
      if (incomingIndices.has(index)) continue
      const pk = getPk(row.row)
      if (pk !== null && pk !== '' && incomingPks.has(pk)) {
        cachedRows.delete(index)
        removedIndices.push(index)
      }
    }
  }

  for (const item of newItems) {
    cachedRows.set(item.rowMeta.rowIndex!, item)
  }

  return removedIndices
}

/**
 * Mark the chunks that lost a row to `upsertCachedRows` as unloaded so they refetch. The chunks
 * just written are skipped — they're fresh, and re-marking them would refetch them for nothing.
 */
export const invalidateChunksAt = <T>(
  chunkStates: Array<T | undefined>,
  removedIndices: number[],
  chunkSize: number,
  writtenChunks: number[] = [],
) => {
  for (const index of removedIndices) {
    const chunk = Math.floor(index / chunkSize)
    if (!writtenChunks.includes(chunk)) chunkStates[chunk] = undefined
  }
}

/**
 * Select the cached rows that survive an eviction pass: every row whose chunk is inside the
 * visible chunk window, plus every row of an "important" chunk — one holding a selected, new or
 * dragging row (the whole chunk is kept, neighbours included). Rows at negative indices are
 * always dropped, matching the original chunk walk that started at chunk 0.
 *
 * Visits only the entries actually cached (O(cached rows)) — the original walked every chunk from
 * 0 up to the highest cached chunk, so a sparse cache deep into a large table cost work
 * proportional to the absolute row position.
 *
 * The returned Map is in ascending index order, like the chunk walk produced.
 */
export const selectRowsToKeep = (
  cachedRows: Map<number, Row>,
  safeStartChunk: number,
  safeEndChunk: number,
  chunkSize: number,
): { rows: Map<number, Row>; importantChunks: Set<number> } => {
  const importantChunks = new Set<number>()
  for (const [index, row] of cachedRows) {
    if (row && (row.rowMeta?.selected || row.rowMeta?.new || row.rowMeta?.isDragging)) {
      importantChunks.add(Math.floor(index / chunkSize))
    }
  }

  const kept: Array<[number, Row]> = []
  let ascending = true
  let lastIndex = Number.NEGATIVE_INFINITY
  for (const [index, row] of cachedRows) {
    if (!row || index < 0) continue
    const chunk = Math.floor(index / chunkSize)
    if ((chunk >= safeStartChunk && chunk <= safeEndChunk) || importantChunks.has(chunk)) {
      if (index < lastIndex) ascending = false
      lastIndex = index
      kept.push([index, row])
    }
  }

  if (!ascending) kept.sort((a, b) => a[0] - b[0])

  return { rows: new Map(kept), importantChunks }
}

/**
 * Run `worker` over `items` with at most `limit` calls in flight, settling each item on its own
 * (a failure never rejects siblings). Results keep input order. Items for which `shouldStart`
 * returns false, and every item not yet started once `shouldStop` returns true, settle as
 * `{ status: 'skipped' }` without calling `worker`.
 */
export const settleWithConcurrency = async <T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  shouldStart: (item: T, index: number) => boolean = () => true,
  shouldStop: () => boolean = () => false,
): Promise<Array<{ status: 'fulfilled'; value: R } | { status: 'rejected'; reason: unknown } | { status: 'skipped' }>> => {
  const results: Array<{ status: 'fulfilled'; value: R } | { status: 'rejected'; reason: unknown } | { status: 'skipped' }> =
    new Array(items.length)
  let next = 0

  const runner = async () => {
    while (next < items.length) {
      const i = next++
      const item = items[i] as T
      if (shouldStop() || !shouldStart(item, i)) {
        results[i] = { status: 'skipped' }
        continue
      }
      try {
        results[i] = { status: 'fulfilled', value: await worker(item, i) }
      } catch (reason) {
        results[i] = { status: 'rejected', reason }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, runner))
  return results
}
