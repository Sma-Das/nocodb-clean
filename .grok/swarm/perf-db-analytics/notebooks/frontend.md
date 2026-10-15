# Scope

Frontend performance review of `packages/nc-gui`: row loading, rendering-adjacent cache work, metadata concurrency, watchers, and bundle configuration. Read-only application review; no application changes or tests/builds run. High reasoning; no child agents. Reviewed the supplied `/tmp/nocodb-clean-perf-db-analytics` worktree. No predecessor notebook existed at the requested path.

# Method

Inspected numbered source around candidate hot paths and followed helpers/callers. Findings describe source-level mechanisms, not measured timing or benchmark results. Ranked the duplicate cache pass first because it is concrete and narrowly removable. Rechecked existing batching, lazy loading, cancellation, and cache limits before recommending changes. Missing-path tool errors (predecessor notebook and three guessed component paths) were treated as errors, then relevant files were found with `rg`; they are not evidence about application behavior.

# Findings

## F1 — Remove the second cache write pass after every successful bulk chunk response

**Priority: first small fix. Confidence: high.** `packages/nc-gui/composables/useInfiniteData.ts:627` upserts each formatted chunk, marks it loaded, invalidates displaced chunks, and resolves its request (`:627–639`). The same `rows` and `dataCache` are retained in `processedChunks` at `:634` and processed again at `:652–660`, repeating upsert, loaded-state assignment, invalidation, and resolution. The intervening comment-count call is fire-and-forget (`:648–650`), so a second insertion does not await or incorporate a completed enrichment.

**Mechanism/change:** retain the first successful cache-write/resolve block and the detached comment-count enrichment; remove `processedChunks` and its second loop. `packages/nc-gui/utils/infiniteCacheUtils.ts:43–63` shows that upsert constructs primary-key/index sets, scans the existing cache, and writes every incoming row, so this removes a full redundant scan and write pass per successful chunk. Promise resolution itself is idempotent; do not claim it currently causes two promise continuations.

**Risk:** low, but preserve first-pass stale-request checks and duplicate-row invalidation. **Meaningful validation:** exercise a bulk response with several chunks and a record moved from another cached index; verify unique records, invalidation of the displaced chunk, each request settling once, and eventual comment badges. Instrument or spy on upsert to establish one invocation per successful chunk, including partial malformed-response handling. Existing pure cache helper behavior should remain unchanged.

## F2 — Start independent related-table metadata loads together so they can actually batch

**Priority: small follow-up. Confidence: high.** List-view column initialization awaits `_getMeta` inside a loop over independent level tables (`packages/nc-gui/composables/useViewColumns.ts:155–167`). Filter metadata preloading similarly awaits `getMeta`, and then its per-table partial fallback, inside the LTAR loop (`packages/nc-gui/composables/useInfiniteData.ts:240–263`). Related `tableGet` calls explicitly opt into batching (`packages/nc-gui/composables/useMetas.ts:161–171`), but the batcher flushes after 50 ms (`packages/nc-gui/composables/useInternalBatch.ts:28–34`, `:72–77`). Serial callers cannot coalesce their own independent table requests into that same envelope and wait for one round trip before queuing the next.

**Mechanism/change:** deduplicate related model IDs and await independent per-table tasks together, preserving each table's full-meta-then-partial-meta dependency and error isolation. Snapshot the base/table IDs before awaits. This should reduce serial metadata round trips and better use the existing batch endpoint; no latency reduction has been measured.

**Risk:** medium: public views, inaccessible tables, and partial-meta permission semantics must remain intact; do not parallelize a dependent full/partial pair. **Meaningful validation:** a cold list view with three distinct level tables should place the related reads in one envelope (within server cap); two columns referencing one table should not duplicate the read. Verify fallback after a denied full read, cached loads, and rapid base/view changes.

## F3 — Deduplicate overlapping group aggregation refreshes before sending them

**Priority: small/moderate. Confidence: high.** `packages/nc-gui/composables/useGridViewData.ts:127–141` collects the target group's entire subtree and refreshes it. For every non-root ancestor, `:143–149` collects that ancestor's entire subtree and invokes `updateGroupAggregations` again. Consequently the target subtree is included repeatedly for a nested edit. Each invocation creates its own alias mapper and sends its groups in batches (`packages/nc-gui/composables/useInfiniteGroups.ts:700–701`, `:748–785`); the loading-state assignment at `:739–745` does not skip groups already present in another explicit invocation.

**Mechanism/change:** form a union of all currently requested group objects/identities and call `updateGroupAggregations` once. This preserves the existing refresh scope while removing duplicate aggregate work; a later scope reduction to only affected ancestors would need separate correctness analysis. Expected benefit is fewer repeated server aggregates and response formatting operations after a nested edit.

**Risk:** medium: groups can reload while asynchronous results arrive, and field-subset refreshes deliberately have different loading-state semantics (`useInfiniteGroups.ts:724–727`). **Meaningful validation:** edit in a three-level grouping tree; capture bulk aliases/filters and assert each group is requested once, ancestor/descendant values remain correct, unrelated current refresh scope is preserved, and explicit field-subset refresh does not suppress subsequent full lazy loading.

## F4 — Evict sparse row caches by visiting cached entries rather than every chunk below the highest index

**Priority: moderate. Confidence: high.** Cache eviction begins after 200 cached rows (`packages/nc-gui/composables/useInfiniteData.ts:390`, `:780`). It first computes the greatest cached chunk (`:787–795`), then loops from zero through that chunk (`:798–809`). For sparse cached rows far into a large table, loop work therefore scales with the absolute row position, even though few rows are resident. The separate chunk-state rebuild is at `:812–814`.

**Mechanism/change:** keep the important-chunk set, then filter existing cached entries by visible/important chunk membership instead of enumerating every chunk below `maxChunk`. Preserve entire important chunks, including neighboring rows, to match current semantics. Consider tracking populated chunk-state indices separately if profiling identifies the sparse array rebuilding as material; that is a larger change.

**Risk:** low/moderate: selection, new/dragging rows, window buffers, and negative indices need care. **Meaningful validation:** compare retained rows and states for dense and sparse caches, with selected/new/dragging records outside the viewport. Include a fixture with more than 200 cached rows at very high indices; count visited entries rather than asserting flaky wall-clock timing. Runtime relevance still depends on whether the UI can reach these indices in a given view.

## F5 — Bound interface chunk concurrency and retain successful chunks when one request fails

**Priority: moderate. Confidence: high.** The interface adapter emulates bulk loading with an unbounded `Promise.all(requests.map(fetchList))` (`packages/nc-gui/composables/useInfiniteData.ts:516–535`). The regular queue batch cap is 50 (`:440`), and reaching it dispatches a batch immediately (`:758–766`); there is no global in-flight batch limit. If one interface fetch rejects, `Promise.all` rejects while sibling requests can remain in flight, and the shared catch maps the whole batch into individual fallback requests (`:687–708`). Successful or still-running sibling interface requests can thus be requested again.

**Mechanism/change:** use a small shared concurrency pool for interface chunk loads and handle success/failure per chunk, so only failed eligible chunks retry. Preserve current abort, stale-group, and out-of-range behavior. This can reduce simultaneous database-backed requests and duplicate work during partial failures; an optimal concurrency value is not established by inspection.

**Risk:** medium: too small a limit can increase visible-row latency; error recovery and promise settlement must remain complete. **Meaningful validation:** controlled interface fetch promises should demonstrate a bounded maximum in flight, a single failing chunk should not refetch successful siblings, and aborted/stale batches should not populate replacement caches or retry an aborted search. Compare visible-row availability under realistic latency before selecting the bound.

## F6 — Move Leaflet initialization behind actual map use

**Priority: bundle follow-up, measure before implementation. Confidence: high about eager import, conditional about savings.** The global Nuxt client plugin statically imports Leaflet plus marker assets and patches icon defaults at startup (`packages/nc-gui/plugins/leaflet.client.ts:1–17`). The GeoData cell also imports Leaflet and CSS (`packages/nc-gui/components/cell/GeoData.vue:2–3`), while the normal canvas GeoData renderer only paints text/icons (`packages/nc-gui/components/smartsheet/grid/canvas/cells/GeoData.ts:1–15`). `packages/nc-gui/components/smartsheet/Cell.vue:395` mounts the cell through the ordinary auto-imported component.

**Mechanism/change:** put an idempotent Leaflet loader/icon setup behind map-picker opening and load the GeoData map UI asynchronously. Removing only the plugin is insufficient if a remaining statically imported cell keeps Leaflet reachable from the same startup graph. Expected savings concern initial network/parse/evaluation work for sessions that never open maps; exact chunk size/savings are unmeasured.

**Risk:** medium: icon initialization must precede marker creation, styles must be ready, and shared views must retain working picker behavior. **Meaningful validation:** inspect the production import graph and cold non-map startup network before/after; verify Leaflet is absent until map use, then test retina/default markers, picker sizing, repeated opening, and shared/read-only views. This is less suitable than F1 for the first patch.

# Falsified

- Locale dictionaries are already dynamically imported (`packages/nc-gui/plugins/a.i18n.ts:35–39`); no finding that all language JSON is eagerly bundled.
- Import worker creation is already lazy and memoized (`packages/nc-gui/plugins/import-worker.ts:10–21`, `:39–40`); no recommendation to defer an already deferred worker.
- Bulk comment enrichment already runs without blocking row rendering (`packages/nc-gui/composables/useInfiniteData.ts:648–650`); no claim that comment counts still gate successful bulk rows.
- Group viewport aggregate reads already coalesce and skip loading/loaded groups (`packages/nc-gui/composables/useInfiniteGroups.ts:844–862`); F3 concerns the separate explicit nested-refresh path.
- The cache is capped through an eviction trigger and existing metadata batching is intentional. Findings target residual work, not absence of pagination, caching, or batching.
- Nuxt devtools are already disabled (`packages/nc-gui/nuxt.config.ts:143–144`), production minification enabled (`:154`), and EE component-plugin duplication already avoided (`:166–171`). Large `optimizeDeps.include` is a development prebundle configuration, not evidence that every listed dependency ships in the production entry.
- Deep watchers around the edited row (`packages/nc-gui/components/smartsheet/grid/canvas/composables/useCanvasTable.ts:1859–1879`) warrant profiling but were not promoted: changing them requires establishing which nested edit mutations consumers depend on, and source inspection alone does not establish material cost.

# Uncertainties

No browser traces, production bundle analysis, request counts, timing benchmarks, or tests were run. Ranking beyond F1 is provisional. Exact default entry reachability of Leaflet through other component imports needs a build graph. Sparse-cache practical impact depends on navigable dataset sizes and view access patterns. F2 concurrency must not bypass related-table access checks. Findings do not imply measured user-visible speedups.

# Handoff

Recommend implementing F1 first: remove the redundant `processedChunks` collection/second upsert pass while keeping the first commit-to-cache block and detached comment-count loading. Then run focused cache/chunk behavior validation and the repository-required checks. F2 and F3 are next candidates for reducing database-backed requests; F4 is a bounded cache algorithm improvement. F5/F6 need controlled concurrency and bundle measurements respectively. This shard made no application edits and ran no tests; only this notebook was written.
