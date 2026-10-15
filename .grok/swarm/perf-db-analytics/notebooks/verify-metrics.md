# Metrics and health review

Reviewed actual application files and installed Knex 3.1.0 source. No application edits or tests performed. Findings below describe the initial implementation reviewed; parent has been informed of both functional issues and is revising event instrumentation.

## Confirmed actionable findings

1. **MySQL 8 health query uses a reserved alias** — `packages/nocodb/src/utils/source-health.ts:50`. `TABLE_ROWS AS rows` uses unquoted `ROWS`, reserved since MySQL 8.0.2. For a source with at least one model, this fixed SQL fails and the catch returns `unavailable`, making MySQL health effectively unusable. Rename to `estimated_rows` and update the mapping, or quote the alias. This is confirmed against the SQL and official keyword reference, not a live-server execution: https://dev.mysql.com/doc/mysqld-version-reference/en/keywords-8-0.html.

2. **Root query events cannot provide all query terminal events** — `packages/nocodb/src/utils/source-query-metrics.ts:192`–`194`, `205`–`207`. In installed Knex `lib/execution/runner.js:132`, ordinary query start emits on builder, and `:139` then assigns the query context before `client.query()`. Root client start therefore sees context correctly in the original implementation. Driver failures emit client/root `query-error` via `lib/execution/internal/query-executioner.js:46`; success emits client/root response at runner `:165`. But runner timeouts and exceptions during response processing emit only builder `query-error` at `:220`, so these samples never finish and never increment errors. Streams also call `client.stream()` (`lib/client.js:157`–`159`), which emits root query through `enrichQueryObject`, but Pg/MySQL `_stream` only resolve/reject stream promises and never emit root terminal events. Those samples likewise never finish. Pending samples remain for ten minutes until a subsequent query start, and can fill the 500-slot budget. No eligible application `.timeout()` or Knex `.stream()` call was found in current source, so existing product-path impact is unproven; the lifecycle behavior is confirmed.

3. **Snapshot can report abandoned in-flight queries indefinitely** — `packages/nocodb/src/utils/source-query-metrics.ts:128`–`166`. Ten-minute stale pending cleanup is only in `start()` at `:80`–`85`; snapshot never performs it. After an unmatched terminal event, an otherwise idle source continues reporting nonzero inFlight forever, even after every retained minute has expired. This is separate from unbounded memory (the map is capped). Clean stale pending entries on snapshots too, or guarantee complete builder lifecycle cleanup.

## Parent's proposed event fix checked

- Root `start` is forwarded from transaction clients to parent clients in Knex `lib/execution/transaction.js:347`–`350`. Nested transactions repeat that chain. Attaching per-builder listeners from root start should cover ordinary transaction queries.
- `lib/execution/internal/ensure-connection-callback.js:2` emits client start before builder compilation/execution. The stream callback at `:16`–`35` does not emit start. Using root start therefore intentionally excludes streams without creating orphan samples.
- `lib/execution/runner.js:34` emits builder `end`; `:41`–`42` emits builder `error` when an error listener exists. An attached error cleanup listener activates this path and enables cleanup even for compilation/response-processing failure.
- Reading `builder.queryContext()` for exclusion avoids the ordering difference between builder query start (`runner.js:132`) and assigning context (`:139`).

## Checks with no actionable defect found

- Empty summary percentiles explicitly return null and no overflow (`source-query-metrics.ts:157`–`158`), so the empty histogram target of zero does not escape as a fake percentile.
- Histograms, sources, per-source fingerprints, per-minute query totals and in-flight samples are bounded. Sixty buckets retain at most 51 query groups per source.
- Connection eviction, explicit delete, and destroyAll flow through LRU callbacks and detach observation listeners before destroying pools. Weak health cache keys do not retain evicted pools.
- The connection manager returns metadata/local sources before attachment. The service also rejects these sources before obtaining a pool, and returns without health queries when analytics is disabled or source is disabled.
- Source id is read using tenant context and checked against context base; collector keys include base and source id. Health table names come from models filtered by the same source. PostgreSQL health binds schema and names, MySQL binds names and uses DATABASE(), and SQLite uses only fixed pragmas.
- ACL permission belongs to base scope. Creator and owner have exclude-based permissions and gain it; editor/viewer include-based permissions do not. No permission escalation identified.

## Tool errors

One batched rg included nonexistent `packages/nocodb/src/services/export.service.ts`; rg reported that missing file. A subsequent complete `packages/nocodb/src` scan found no Knex stream calls. This error was not interpreted as evidence of absence.

## Final re-review resolution

Read final `source-query-metrics.ts`, `source-health.ts`, `source-analytics.service.ts`, and the connection manager attachment sites. No remaining release blocker found. No tests run during this review; parent reports actual Knex and health/service tests pass.

- Finding 1 **resolved**: MySQL health uses `estimated_rows` and its mapping reads the same alias (`source-health.ts:68`, `81`). PostgreSQL mapping was updated consistently too.
- Finding 2 **resolved**: Only root `start` is subscribed (`source-query-metrics.ts:334`); per-builder start/response/error handlers are attached at `:316`–`320`. Builder query-context exclusion happens before instrumentation (`:266`), so health queries are skipped despite builder query event context ordering. Builder errors include the runner timeout/processing-error path. Transaction starts forward to root as verified above. Streams are intentionally excluded and create no pending sample.
- Finding 3 **resolved**: `snapshot()` now calls `prunePending()` (`source-query-metrics.ts:173`). Builder correlations also expire on subsequent starts (`:267`–`269`) and are detached on end/error and observation disposal (`:300`–`320`, `329`).
- **Bounds confirmed**: At most 50 observed pools (`:255`–`256`); 50 retained fingerprint hashes (`:102`) plus one overflow aggregate named `other` (`:103`), meaning at most **51 query groups** per bucket; 60 integer minute buckets after pruning (`:163`–`166`); 500 collector pending samples (`:93`) and 500 correlated builders (`:275`) per observed pool. Describe this as “50 fingerprints plus overflow,” not literally “50 query IDs.”
- **No internal pool instrumentation**: `NcConnectionMgrv2.get()` returns `Noco.ncMeta.knex` immediately for `source.isMeta()` before both attachment sites. `Source.isMeta()` covers both local and metadata sources. Service also returns without pool acquisition or catalog reads when disabled/internal/disabled-source (`source-analytics.service.ts:27`–`37`).
- Service health preparation errors now become a safe `unavailable` response (`source-analytics.service.ts:59`–`63`); no newly exposed driver detail found.
