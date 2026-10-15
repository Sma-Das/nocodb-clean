# UI verification

Scope: read-only review of the new `SourceAnalytics.vue`, settings navigation/shell/route changes, SDK response types, nearby role rules, and the producer of displayed query/health metrics. No application edits, tests, builds, or browser checks. Findings are source-level mechanisms, not measured failures. The parent's subsequent fixes and complete English `sourceAnalytics` dictionary were reread before this final handoff.

## Final verification

**No remaining blocker found in this UI review.** UI1, UI3, and UI4 below are resolved in the reread version. UI2 is accepted as a consciously bounded feature with explicit top-20 filter copy. Original finding citations below refer to the initial reviewed version; final citations in this section refer to the reread version.

- `SourceAnalytics.vue:131` now sets `h-full min-h-0` on the scroll root, fixing the missing height constraint. Source-level fix verified; actual browser scrolling was not exercised.
- `SourceAnalytics.vue:35`–`:39` now evaluates pool waiting independently of completed-query count. `:198` also distinguishes the absence of completed-query threshold data.
- `SourceAnalytics.vue:32` checks finite positive latency and an error rate from 0.1 to 100. Comparisons use that validity, `saveView` guards it at `:79`, and invalid input has visible feedback at `:197` plus storage status feedback. Read-time validation still accepts error thresholds above zero but below 0.1 (`:118`), which are subsequently flagged invalid; aligning that lower bound is a small consistency improvement, not a blocker.
- `lang/en.json:7288` explicitly says the operation filter applies to the overall top 20, describes 50 tracked exact-statement IDs and the `other` group, and says SQL text/parameters are not retained. It does not imply normalized SQL templates or a complete query inventory.
- `lang/en.json:7275` says this is one server process, excludes connection wait and streams/pre-execution failures, explains partial minute buckets, starts empty, and resets on pool replacement/eviction. The stream exclusion is a capture boundary rather than a dedicated stream guard in the collector; this shard did not run driver integration checks. Explicitly adding the 60-minute retention bound and process-restart reset would further clarify durability.
- `lang/en.json:7301` distinguishes database-wide storage/session counts from mapped-table estimates and declares the 15-second cache, 50/500 table bounds, schema, and grant limitations. The backend fields reread agree with that scope; unsupported metrics show dashes.
- `lang/en.json:7309` explicitly says warnings run while the pane is open, require refreshed data, send no notifications, and do not run in the background. `:7318` describes browser-local account/base preferences, enumerates the actually saved fields, and excludes shared dashboards. `SourceAnalytics.vue:24` now keys storage by account ID plus base ID, matching that copy.

Remaining small copy issues: `SourceAnalytics.vue:190` reuses `sourceAnalytics.storage` ("Database storage", `en.json:7299`) as each table's byte column heading; use a separate "Table storage" key. `en.json:7314` calls pending pool acquisitions "queries"; "connection requests" is more exact because the pool counter records acquisitions. Neither affects the displayed values or blocks this bounded slice.

## Findings

### UI1 — P1, resolved: constrain the analytics root so its content can scroll

`packages/nc-gui/components/dashboard/settings/SourceAnalytics.vue:129` sets `overflow-auto` on an auto-height block, without `h-full`, `max-h-full`, or another height constraint. Its direct settings host is a bounded `flex-1 min-h-0` block (`packages/nc-gui/components/project/SettingsShell.vue:229`), but is not itself a scroll container. `packages/nc-gui/components/nc/Modal.vue:232` clips overflow at the outer modal. The analytics root therefore grows to its content height; overflow does not produce an inner vertical scroll area. The lower Health, Warnings, and Saved Views controls can extend beyond the visible modal and become unreachable. Existing DataSources explicitly uses `h-full` (`packages/nc-gui/components/dashboard/settings/DataSources.vue:331`).

Proposed fix: give this root `h-full min-h-0` (and ensure flex children do not shrink in ways that compress the content), retain its `overflow-auto`, then verify the last saved-view controls are reachable with many query/table rows and expanded chart data.

### UI2 — P2, accepted with explicit scope copy: operation filtering runs after global top-20 truncation

`packages/nc-gui/components/dashboard/settings/SourceAnalytics.vue:29` filters only the returned query array; the control is labeled as an operation filter at `:172`. The producer sorts all query groups and slices to 20 before returning them (`packages/nocodb/src/utils/source-query-metrics.ts:161`). With 20 higher-total-time selects and a captured insert below them, selecting `insert` produces an empty table even though inserts exist in the selected window. It does not return the most expensive inserts.

Proposed fix: either apply an allowlisted operation on the server before the top-20 limit, return the bounded tracked group set and filter/sort/limit in the UI, or clearly label this as filtering the overall top 20 and give the filtered empty state an explanation. Summary/activity cards remaining unfiltered is reasonable because the control is inside the query table section.

### UI3 — P2, resolved: pool waiting warnings disappear when no queries have completed

`packages/nc-gui/components/dashboard/settings/SourceAnalytics.vue:33` returns an empty warning list whenever the completed-query count is zero. This also skips the `pool.pending` condition at `:37`. When the pool is saturated before the first completion (or all completed activity has aged out), the Health section can show pending acquisitions while Warnings says no warnings.

Proposed fix: gate only the latency/error-rate warnings on completed data; evaluate pending-acquisition warnings independently. A no-data state should not imply the pool has been checked and is healthy.

### UI4 — P2, resolved: validate thresholds before comparison and save

The threshold inputs at `packages/nc-gui/components/dashboard/settings/SourceAnalytics.vue:193` rely on native `min`/`max` and `v-model.number`; there is no submitted form or `checkValidity` gate. Empty strings, zero/negative numbers, and error percentages above 100 can therefore reach the comparisons at `:35` and `:36` and be saved by `:80`–`:83`. An empty value coerces to zero; an error threshold above 100 suppresses every error-rate warning. A saved invalid view appears to save successfully but is silently removed by the stricter read validation at `:116` on reopening.

Proposed fix: derive valid finite numeric thresholds with the same bounds used by load validation, surface inline errors, and disable saving until valid (or normalize deliberately on blur). Apply the same validator to save and restore. The read-time type checks and enum allowlists already prevent arbitrary stored values from becoming API ranges or chart keys.

## Checked without a concrete defect

- Request supersession: `SourceAnalytics.vue:57` increments a generation before aborting; success, error, and finally are guarded (`:69`–`:73`). The source/range watcher clears the previous snapshot (`:111`). Old responses cannot replace a newer requested source/range once that watcher runs.
- Unmount: `SourceAnalytics.vue:125` marks disposal, increments generation, aborts analytics, and clears the timer. The separate source-list request has a disposal check before assignments (`:120`). It is not canceled, but its result cannot repopulate an unmounted component.
- Base changes: the shell passes `:key="baseId"` at `SettingsShell.vue:244`, so a different base gets a fresh source list, storage key, and lifecycle. The child does not independently watch base ID, but the current host supplies the required remount.
- Refresh timers: there is one timeout, the in-flight analytics request clears it, and only the current generation schedules its successor. Hidden tabs reschedule without issuing analytics requests. Changing refresh cadence during an in-flight request can deliberately supersede it; generation/abort still protect the snapshot.
- Route mapping: `source-analytics` maps to `database-analytics` and the inverse is derived from the same map (`settingsRouteUtils.ts:13`). Legacy settings path middleware uses that inverse (`pages/index/[typeOrId]/[baseId]/index/settings/[page].vue:17`). The new tab belongs to `ProjectPageType` and mounts the lazy component.
- Existing settings permission gate: the new row reuses `canSeeDataSources` (`useBaseSettingsNav.ts:236`), defined with `sourceCreate`, loaded base, and desktop gates at `:121`; the shell checks its reachable tab set before mounting (`SettingsShell.vue:70`). The endpoint has its own base-scoped `@Acl('sourceAnalytics')` (`source-analytics.controller.ts:15`). Backend creator/owner roles use exclusion rules (`utils/acl.ts:676`), so adding this action to the base permission scope does not accidentally omit it from creator access. No concrete newly introduced permission bypass was established in this shard.
- SDK shape: `nocodb-sdk/src/lib/sourceAnalytics.ts` matches the supplied service/collector fields, including nullable metrics/pool/health, bounded-percentile upper limit/overflow, cumulative dropped count, and optional health fields. The public barrel exports it.
- Retention and privacy: producer buckets are bounded to 60 minute buckets; no individual timing list is retained. The in-flight map stores start time, hash, and operation, not SQL; completed buckets store aggregates. Query IDs hash the raw emitted SQL (they are not normalized query templates). Health queries are excluded with `ncAnalytics`. Copy must state process-local NocoDB-observed activity, retention/reset limits, and SQL/bindings exclusion without implying database-wide workload coverage or normalized query text.
- Health provenance: `source-health.ts:26` uses PostgreSQL whole-database size/session counts, while table stats are restricted to known imported table names and a 50-row limit (`:35`–`:36`). MySQL returns table stats without whole-database size/session fields (`:57`); unsupported fields show a dash. Copy should distinguish database-wide size/session totals, process pool counters, and restricted table statistics, and explain best-effort cached catalog data. The UI currently does not show `health.checkedAt`.

## Lower-priority observations

- A source-list failure cannot be retried with Refresh Now because `sourceId` stays empty and that button is disabled (`SourceAnalytics.vue:119`, `:140`). Reopening the pane retries; an explicit source-list retry would be clearer.
- Restoring a saved view whose source was removed silently keeps the current source (`SourceAnalytics.vue:93`). Consider a status explaining the source is unavailable rather than making the saved view appear fully restored.
- Initial saved browser preferences were base-scoped without account scope; the reread version now keys by account and base (`SourceAnalytics.vue:24`). They contain names, IDs, thresholds, and display preferences, not metric snapshots or SQL; the final copy describes that accurately.
- A source list and Saved Views render before the source list request completes. Selecting a stored view during that interval cannot select its source (`:93`); initial list completion picks its own default (`:122`). Disabling restoration until the list finishes would remove that small race.

## Tool errors and limitations

Some exploratory commands referenced guessed paths that do not exist (`useRoles.ts`, EE ACL path, two settings component names, and a general Modal path); the actual CE role composable and modal were then located and read. A zsh glob with no match prevented one bundled label search; a subsequent explicit-path `rg` succeeded. These failures are not application findings. No tests or browser execution were authorized for this review shard.
