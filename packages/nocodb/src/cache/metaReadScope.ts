import { AsyncLocalStorage } from 'node:async_hooks';
import { isCacheBypassed } from './cacheBypassScope';

/**
 * Request-scoped memoization of hydrated metadata reads.
 *
 * A single read request (e.g. a grid page: list + count + proto building)
 * resolves the same model's columns several times. Each `Column.list` pays a
 * cache list read plus one `getColOptions` cache read per column and builds a
 * fresh set of `Column` instances. Inside a scope opened with
 * {@link runWithMetaReadScope} the first load is shared by every later
 * identical call in the same async tree.
 *
 * Correctness rules:
 *  - Opt-in only: nothing is memoized outside an explicit scope, and the scope
 *    lives for one async tree (one request), never across requests.
 *  - Keys must encode every option that changes the result (callers include
 *    workspace/base, ids and flags like default view / includeDeleted).
 *  - Disabled inside `runWithoutCache` (transactions) — callers must also skip
 *    memoization for non-default `ncMeta` (transaction) instances.
 *  - Any metadata write in this process (MetaService insert/update/delete,
 *    NocoCache invalidation) bumps a global epoch; entries created under an
 *    older epoch are discarded. Entries also expire after a short max age so a
 *    long-lived request cannot hold metadata indefinitely.
 */

const MAX_ENTRY_AGE_MS = 5000;

interface MemoEntry {
  promise: Promise<unknown>;
  epoch: number;
  createdAt: number;
}

interface MetaReadScope {
  memo: Map<string, MemoEntry>;
}

const scope = new AsyncLocalStorage<MetaReadScope>();

let metaWriteEpoch = 0;

/**
 * Run `fn` with request-scoped metadata memoization. Nested calls reuse the
 * outer scope.
 */
export const runWithMetaReadScope = <T>(fn: () => T): T => {
  if (scope.getStore()) return fn();
  return scope.run({ memo: new Map() }, fn);
};

export const isInMetaReadScope = (): boolean => !!scope.getStore();

/**
 * Invalidate memoized metadata for every scope in this process. Called from
 * metadata write paths; cheap (a counter increment).
 */
export const bumpMetaWriteEpoch = (): void => {
  metaWriteEpoch++;
};

/**
 * Return the scoped memoized promise for `key`, or start `load` and memoize it.
 * Outside a scope (or with the cache bypassed) this is just `load()`.
 */
export const memoizeInMetaReadScope = <T>(
  key: string,
  load: () => Promise<T>,
): Promise<T> => {
  const store = scope.getStore();
  if (!store || isCacheBypassed()) return load();

  const now = Date.now();
  const existing = store.memo.get(key);
  if (
    existing &&
    existing.epoch === metaWriteEpoch &&
    now - existing.createdAt < MAX_ENTRY_AGE_MS
  ) {
    return existing.promise as Promise<T>;
  }

  const promise = load();
  const entry: MemoEntry = { promise, epoch: metaWriteEpoch, createdAt: now };
  store.memo.set(key, entry);
  // never memoize failures
  promise.catch(() => {
    if (store.memo.get(key) === entry) store.memo.delete(key);
  });
  return promise;
};
