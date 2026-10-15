# Analytics architecture review

## Scope

- [d1] [shard] HIGH reasoning review of the existing dashboard/widget stack, aggregation paths, source connection management, health hooks, and Grafana-inspired architecture for all requested capabilities: slow queries/latency/errors/trends; charts/filters/time ranges/saved panels; connections/storage/table statistics/alerts.
- Repository: `/tmp/nocodb-clean-perf-db-analytics`, starting from `origin/develop`. This notebook is the only file written by this reviewer. No application edits or tests were performed.
- Parent's implementation direction: external-source analytics in base settings; bounded process-local event metrics; hashed query identifiers without SQL/bindings; chart/time filters; browser-local saved settings; pool counters; read-only PostgreSQL/MySQL/SQLite health; browser-evaluated warning thresholds with explicit limits. Internal/meta/local-source telemetry is intentionally unsupported to prevent cross-base disclosure.

## Method

- Read concrete models, stores, migration definitions, aggregation orchestration, SQL clients, internal API authorization, and the connection cache. Treated declared types, dependencies, comments, and assets separately from executable behavior.
- Searched source for query event hooks, native statement-statistics queries, metrics packages, dashboards, widgets, and health statistics. Negative search findings are limited to inspected paths; they do not prove absence in unavailable enterprise overrides.
- Consulted only official Grafana, PostgreSQL, MySQL, and Knex documentation/source. Knex dependency is pinned to `3.1.0` at `packages/nocodb/package.json:140`, so its tagged runner source was also inspected.
- Errors: predecessor notebook did not exist. Some initial searches named nonexistent candidate paths; corrected locations before relying on findings. A broad initial search hit bundled/fixture data and was truncated; narrowed searches and reread cited lines. No conclusions use truncated fixture content. Follow-up fetch of official Knex `client.js` returned HTTP 429; that failed response is an error, not evidence of source behavior. `runner.js` and documented event signatures were successfully read.

## Findings

### A1. Saved dashboard functionality is a real implementation gap, not an existing feature ready to enable

**Confirmed, high confidence.** `packages/nocodb/src/models/Dashboard.ts:6` returns null from get; list/insert/update/delete/getWidgets are also no-ops. `packages/nocodb/src/models/Widget.ts:6` has the same placeholder behavior. `packages/nocodb/src/db/widgets/base-widget.handler.ts:15` returns empty validation/data/formatting/dependency results, and `packages/nocodb/src/db/widgets/index.ts:3` always chooses that base handler.

The GUI mirrors these stubs: `packages/nc-gui/store/dashboard.ts:6` has empty computed collections and null getters; load/create/update/delete/open/duplicate methods are no-ops. `packages/nc-gui/store/widget.ts:4` has empty widget collections and no-op CRUD/data methods. `packages/nc-gui/components/project/Action/CreateEmptyDashboard.vue:1` renders only a hidden span. `packages/nc-gui/composables/useEeConfig.ts:400` sets enterprise features blocked and community mode true. The directory named `components/dashboard` primarily contains the main application navigation/settings shell; the name alone is not evidence of working analytic dashboards.

**Existing assets worth reusing, not proof of runtime support:**

- `packages/nocodb/src/meta/migrations/v2/nc_086_dashboards_widgets.ts:5` defines dashboard metadata, ownership, workspace/base scope, and a composite scope index; widget definitions at line 24 include dashboard/model/view IDs, config, layout position, and scope indices. Filter linkage is added at line 48.
- `packages/nocodb/src/meta/migrations/v2/nc_089_dashboard_sharing.ts:5` adds sharing metadata. A migration does not establish functional or secure share endpoints.
- `packages/nocodb-sdk/src/lib/dashboard/index.ts:31` declares chart/metric/gauge/text/table/iframe/pivot widget kinds; `packages/nocodb-sdk/src/lib/dashboard/charts.ts:4` declares chart shapes. `WidgetDataSourceTypes` at index.ts:72 supports view/model/filter, **not** operational telemetry. Add an explicit telemetry data source or keep the initial pane separate from business-data widgets.
- `packages/nc-gui/package.json:99` already depends on ECharts and line 108 on grid-layout-plus. Reuse the renderer dependency where appropriate; it does not supply data capture, auth, retention, or saved-panel CRUD.

**Recommendation:** the parent's dedicated external-source analytics pane is the lowest-risk first vertical slice. Do not claim that local saved filter/view settings deliver shared persisted dashboards or saved reusable panels; those remain a later phase.

### A2. Working aggregation exists for business data, with important isolation behavior to preserve

**Confirmed.** `packages/nocodb/src/services/data-table.service.ts:112` resolves model/view/source and dispatches `DBQueryClient.aggregate`; it rejects non-grid views at line 126. `packages/nocodb/src/controllers/internal/modules/UiGet.operations.ts:219` exposes the operation through the existing internal API, with base scope at `packages/nocodb/src/controllers/internal/operationScopes.ts:134`.

`packages/nocodb/src/dbQueryClient/cross-db-utils/aggregate.ts:75` builds a source-scoped base model; line 107 obtains row-level conditions; line 112 combines these with saved-view and request filters; line 141 applies soft deletion. This is useful for future user-data charts and is not a generic telemetry query engine. Any chart path bypassing these mechanisms would need equivalent authorization/filter guarantees.

Dialect support must be explicit. `packages/nocodb/src/dbQueryClient/aggregations/index.ts:18` registers working PostgreSQL/MySQL/SQLite strategies, while `packages/nocodb/src/dbQueryClient/aggregations/handlers/mssql.handler.ts:10` and `oracle.handler.ts:10` throw enterprise-only errors. Their presence in a registry is not working CE capability. Native database health and business-data aggregates should have separate capability flags.

### A3. Current performance surfaces are insufficient for trends and failure analysis

**Confirmed.** `packages/nocodb/src/helpers/apiMetrics.ts:17` comments out both metric calls. `packages/nocodb/src/services/telemetry.service.ts:3` deliberately preserves callers without collecting/sending events. Do not reactivate product-usage telemetry as an operational metrics shortcut.

`packages/nocodb/src/helpers/stageTimer.ts:21` enables timing only with `NC_PERF_LOG=true` or `ENABLE_PROFILER`; line 70 emits local log text. `packages/nocodb/src/db/BaseModelSqlv2.ts:7537` starts this timer, line 7550 awaits database rows, line 7551 marks database work, and line 7669 ends the timer. A thrown query can bypass the final log. `StageTimer.toJSON()` exists but this inspected call site does not persist a time series. `packages/nocodb/src/controllers/data-alias.controller.ts:306` measures grouped-data service work and returns `xc-db-response` at line 315; the name does not make this pure database execution time.

`packages/nocodb/src/controllers/internal/modules/InstanceAdminGet.operations.ts:46` computes workspace/user/editor/base totals; `packages/nc-gui/components/admin/InstanceDashboard.vue:55` displays those totals. This is a working administrative overview, not connections/storage/query monitoring.

**Implication:** instrumentation plus a bounded store and query contract is necessary before the initial charts can be truthful. Keep driver duration, pool wait, API duration, and postprocessing separate.

### A4. Source identity and connection lifecycle define the telemetry security boundary

**Confirmed.** `packages/nocodb/src/utils/common/NcConnectionMgrv2.ts:41` documents that source IDs are only unique within a base. `connectionKey()` at line 46 uses `${base_id}:${id}`; all analytics keys and browser storage keys must preserve at least this composite identity, preferably workspace/base/source plus authenticated user for local preferences.

The manager returns the **shared metadata Knex** for `source.isMeta()` at line 127. External connections are constructed at line 177 and cached at line 180; LRU eviction destroys them at line 29. Version invalidation/reset at lines 68 and 77 can replace clients on multiple application servers.

**Required first-slice behavior:**

- Attach one set of listeners when a supported external client is created; do not attach on every `get()`. Avoid instrumentation of the shared metadata client. Release pending timers/listeners with connection destruction and bound all retained source/event/fingerprint maps.
- Keep metrics keyed by composite source identity across client replacement if desired, but expose process start/capture start/reset timestamps. Document whether reset/eviction clears history.
- A source endpoint must re-resolve the source in the authorized request context, then use that identity; never trust client-provided base/source strings or telemetry-map existence as authorization. `packages/nocodb/src/controllers/internal.controller.ts:228` invokes ACL middleware, and line 247 checks each internal operation before dispatch. Add explicit read-analytics permission/admin source-setting permission and block public shared-base access.
- Metrics report work observed by **this application process and this external connection**. Other application replicas, direct database clients, jobs using other pools, and time before collection are outside coverage. Do not present process counters as all-instance or all-database activity.
- Native health statistics can still cover a physical database shared by multiple bases. Restrict access to source admins and filter exposed table data to the source's configured/allowed schema and mapped tables. Rejecting internal sources alone does not solve this second boundary.

### A5. Knex event contract and timing pitfalls are material to the implementation

**Verified against official docs and the pinned implementation.** The public signatures are `query(query)`, `query-response(response, query, builder)`, and `query-error(error, query)`. Connection `__knexUid`/transaction `__knexTxId` are not unique query identifiers; correlate concurrent executions with the query's unique identifier where present, not SQL or connection ID. [Knex event interfaces](https://knexjs.org/guide/interfaces.html#events)

In [Knex 3.1.0 runner source](https://github.com/knex/knex/blob/3.1.0/lib/execution/runner.js), lines 117–128 emit the **builder** `query` event before adding `obj.queryContext`. Lines 143–155 emit response events with the completed query object. Lines 199–205 emit builder query errors. Connection acquisition occurs first at lines 269–295. Therefore query-event duration excludes pool acquisition; compile/acquire failures can occur before a matched start event. The success event also follows Knex response processing, so label it observed driver/query round-trip, not server CPU/executor time. The failed `client.js` follow-up means exact root/client timeout and error propagation should be checked with meaningful tests before assuming every timeout has a terminal root event.

`queryContext` is an explicit per-builder context passed to hooks and is shallow-cloned on builder cloning. It is suitable for a telemetry-exclusion marker on health queries, provided the chosen listener sees it at its event stage. Do not assume the early builder event contains it; use the correct root/client boundary or an independently validated correlation mechanism. [Knex queryContext](https://knexjs.org/guide/query-builder.html#querycontext)

**Critical safeguards:**

1. Exclude health/catalog probes and analytics self-queries from user query counts, errors, and top-query results. Concurrent user traffic must remain observable while health probes run; a global boolean exclusion would drop unrelated user queries.
2. Event callbacks must never throw into the database operation. Use monotonic timing; remove correlation entries on success and error; expire abandoned/streaming entries and cap pending entries.
3. Do not retain response rows, SQL text, bindings, error messages/stacks, or serialized Knex objects. Errors can embed SQL/values. Store allowlisted error classes/codes and numeric counts only.
4. A raw SQL hash is an opaque exact-statement ID, not a normalized query fingerprint. This repo renders builders to `.toQuery()` at `BaseModelSqlv2.ts:7547`, which can inline values: identical logical queries with different literals may have different hashes. Bounded hashed IDs can be a safe first slice if named honestly; later use dialect-aware normalization before hashing. Do not regex-strip values and claim full SQL normalization.
5. A capped event ring makes percentiles and totals accurate for retained samples only. Return `capturedSince`, retained count, evictions/dropped count, requested/effective window, and sampling policy. Never silently describe a truncated window as complete history. Calculate p95 from retained observations or mergeable histogram/sketch data, not averaged per-bucket percentiles.

### A6. Health adapters exist only as primitives; some onboarding helpers are misleading as monitors

**Confirmed.** `packages/nocodb/src/db/sql-mgr/v2/SqlMgrv2.ts:41` creates a client for connection testing and destroys it afterward. `packages/nocodb/src/db/sql-client/lib/pg/PgClient.ts:252` first tests the target database, then catches failure and tries the `postgres` database at lines 260–269. Successful fallback leaves the default Result code unchanged. That behavior supports onboarding, not a reliable health check of the configured target. Use a bounded read-only probe on the actual existing source pool instead.

`PgClient.ts:3649` sums `pg_stat_user_tables.n_live_tup` over the entire current database. `packages/nocodb/src/db/sql-client/lib/mysql/MysqlClient.ts:2819` sums information_schema table rows for a database. `packages/nocodb/src/db/sql-client/lib/sqlite/SqliteClient.ts:2270` enumerates tables and runs exact `COUNT(*)` on each at line 2275. These are three different semantics and costs; do not reuse them unqualified for frequent health refreshes. An SQLite file-size/page-count read is safer than repeated full table counts; table row counts should be unavailable/explicitly on demand when no cheap estimate exists.

**Verified PostgreSQL semantics:** `pg_stat_database` is database-wide, with current `numbackends` and cumulative transaction/I/O/deadlock counters; rollbacks are **not** a query-error count. `pg_stat_user_tables` contains current-database user-table statistics; live/dead row values are estimates. Statistics can lag and counters can reset. Label estimates/cumulative totals, filter scope, and calculate rates only from compatible snapshots with reset handling. `blks_hit` measures PostgreSQL buffer hits, not OS-cache hits. [PostgreSQL statistics](https://www.postgresql.org/docs/current/monitoring-stats.html)

For the first slice expose independent capability/status for probe, local pool, database connections, storage, and allowed table stats. Use successful-null/unsupported/permission-denied/timeout/error distinctly; never turn failure into numeric zero. Local pool used/free/pending counters belong to this process, and are different from all database sessions. A connection limit is an upper bound, not necessarily capacity available to this source role.

### A7. Grafana patterns worth adopting, with implementation boundaries

These are product patterns, not a recommendation to embed or reproduce all of Grafana:

- **One exploration context:** global relative/absolute time range, source selector, structured filters, refresh control, and drilldown preserving context. URL-synced variables make investigation reproducible. Apply the same resolved UTC bounds to all panels, retain timezone for presentation, cancel superseded requests, and use consistent bucket boundaries. [Grafana dashboard controls](https://grafana.com/docs/grafana/latest/visualizations/dashboards/use-dashboards/) and [variables](https://grafana.com/docs/grafana/latest/visualizations/dashboards/variables/)
- **Inspectability:** show timing, sample count, returned points, coverage window, data state, and safe error class in each panel's inspector. Grafana exposes query stats, response/data, and errors; this product should expose only the redacted subset appropriate to the user's role. [Grafana query inspector](https://grafana.com/docs/grafana/latest/visualizations/explore/explore-inspector/)
- **Separate ad hoc exploration from saved layout:** let users explore source/query-ID trends and save a panel query/config when persistence exists. Version saved specifications and layouts. Browser-local filter preferences are useful but must not be called shared dashboards.
- **Alerts have a lifecycle:** warning thresholds need an evaluation interval, pending duration, recovery handling, missing-data behavior, and distinct collection errors. Browser warnings run only while the page is open and refreshed; they are not background alerting. Server-side durable alert evaluation and notification routing are a later deliverable. [Grafana alert evaluation](https://grafana.com/docs/grafana/latest/alerting/fundamentals/alert-rule-evaluation/)
- **Dashboard permission is not data permission:** query authorization must be enforced separately from who may view/edit a dashboard. Grafana's documentation itself explains that a viewer can normally query data sources more broadly than the displayed panels, and granular data-source permissions are edition-dependent. Do not copy that default into this multi-tenant application. [Grafana data-source management](https://grafana.com/docs/grafana/latest/administration/data-source-management/)

### A8. Functional vertical slice and phased roadmap covering all requested functionality

**Phase 0 — the parent's proposed implementation, with explicit acceptance criteria.** Deliver a source-admin analytics pane for supported external PostgreSQL/MySQL/SQLite sources. Capture bounded query successes/failures and durations after capture begins; provide request count, retained-sample p50/p95/max, error fraction, trend buckets, and top opaque statement IDs. Supply source/query-ID/result filters and finite time ranges; a line/bar chart plus a table is enough for useful exploration. Persist user/source-scoped display settings locally. Add actual-source probe, process-local pool used/free/pending, storage and allowed-table statistics, each with status/time/scope labels. Browser threshold warnings must say they evaluate only while this page is open.

The slice is complete only when a user can generate a successful external query and a failed query, see both in the correct source/window, explore a slow ID trend, save/reload their view settings, inspect health safely, and observe clear unsupported/no-data/error states. Meaningful checks: concurrent event correlation; health-query exclusion; successful/failed/acquire-timeout cleanup; cap/eviction/time-boundary behavior; 403 and cross-base source-ID collision; no SQL/bindings/error detail leakage; allowed-schema filtering; UI refresh cancellation and stale-response handling. These checks are recommendations for the implementation owner; none were run by this reviewer.

**Phase 1 — durable observation and complete trend coverage.** Introduce a telemetry writer interface with a bounded nonblocking queue and batched flush; keep hot request paths independent of telemetry persistence failure. Store count/error/latency histograms per minute with source/operation dimensions, and bounded slow/error exemplars containing only safe identifiers. Add capture completeness, drop counts, reset markers, and collector health. For shared/internal pools, add authenticated per-query tenant context before support; fail closed if context is missing. Include worker jobs and API timings separately, then merge replicas through a durable backend. Do not use per-fingerprint unbounded metric labels.

**Phase 2 — real dashboard exploration and saved panels.** Implement dashboard/widget CRUD and telemetry-backed handler/API rather than the existing no-op stores; reuse metadata schema where its authorization/ownership model fits. Add schema-versioned panel specs, titles, line/bar/stat/table renderers, configurable aggregations, source and operation variables, time-range overrides, panel inspector, drilldowns, optimistic revision conflict checks, dashboard/panel duplication, and user/team visibility/edit permissions. Add business-data chart sources through the existing RLS/view-filter-aware aggregate service. Offer durable server-saved preferences and reusable saved panels, clearly distinguishing them from browser settings.

**Phase 3 — database-native performance and richer health.** Add PostgreSQL native statement statistics and MySQL Performance Schema through version/capability-checked adapters. They describe a different observation population from app events; never sum them together. PostgreSQL `pg_stat_statements` requires setup and exposes cumulative execution totals/means, so compute interval deltas and do not invent p95 from a mean. [PostgreSQL pg_stat_statements](https://www.postgresql.org/docs/16/pgstatstatements.html) MySQL digest summaries provide counts, timing/errors and available histogram-derived quantiles; support depends on server/version/instrumentation. [MySQL statement summary tables](https://dev.mysql.com/doc/refman/8.4/en/performance-schema-statement-summary-tables.html) Add schema/table storage, estimated row/dead-row trends, connection saturation, waits/locks, slow query details under stronger permission, and diagnostic links. Keep query replay/EXPLAIN out of automatic collection; no automatic EXPLAIN ANALYZE.

**Phase 4 — background alerts and operational maturity.** Evaluate latency/error/connection/storage/collector-staleness rules on a durable scheduler with an owned execution lease, persisted alert states, pending/recovery periods, deduplicated notifications, silences, and history. Read-only health probes never create extensions, reset stats, terminate sessions, vacuum/analyze, or run DDL. Add retention policies, source/base deletion cleanup, explicit collection configuration, and optional Prometheus/OTel export for operators who already use Grafana.

### A9. Retention, overhead, and authorization requirements across phases

- First-slice retention is an enforced maximum **number of events and age per source plus a global memory bound**, not a promise of a full fixed-duration history. Cap in-flight correlations and hashed-ID cardinality too. Report truncation. For a future durable store a reasonable configurable starting proposal is slow/error exemplars for 24 hours, minute rollups for 7 days, and hourly rollups for 30 days; these are design defaults requiring capacity measurement, not repository facts.
- Render at most a bounded number of points/panels; select bucket interval from range and width. Compute percentiles from observations/histograms and average latency from sum/count; do not average averages unweighted. Empty observations are no-data, and missing collector intervals are gaps rather than zero latency.
- Health refreshes should have minimum interval, per-source cache/single-flight deduplication, low concurrency, strict deadline, and independent partial errors. Reuse pools; do not open every inactive source just to report metrics. Table storage probes can be expensive on huge catalogs; whitelist scope and cap returned table rows.
- Make instrumentation work constant/bounded per event: monotonic timestamp, counters, safe code/method/ID, bounded hashing/retention. Do not stringify whole SQL results or synchronously write a row per query. Measure added CPU/allocation/p95 latency before calling overhead negligible.
- Persist dashboard and metric identities with tenant/base/source; cache with authorization-sensitive context where results depend on user/table/RLS. Do not let saved variables or URLs override the authorized scope. Restrict operational metadata more strongly than ordinary record-view permission; it can reveal table names/workload and shared-database sizes.
- Native database credentials and grants remain server-side. Missing metric privilege disables only that capability and produces a clear permission state. Error response text is sanitized. No public operational dashboards by default, even though existing migrations include share columns.

## Falsified

- “Dashboard types/assets/migrations mean dashboards are already functional”: falsified by both backend and GUI no-op implementations (A1).
- “The instance dashboard is database health analytics”: falsified by its workspace/user/editor/base-count implementation (A3).
- “Existing metrics/telemetry can supply historical latency/error graphs”: falsified for inspected implementations; calls are disabled/no-op and StageTimer logs successful paths without durable time-series storage (A3).
- “Source ID alone is a safe cache/metric key”: falsified by the explicitly composite connection identity (A4).
- “Existing connectionTest is a health check of the configured PostgreSQL database”: falsified by fallback to a different database (A6).
- “All registered dialects support aggregation in this CE checkout”: falsified by explicit MSSQL/Oracle enterprise-only errors (A2).
- “Knex event latency includes pool wait”: falsified by pinned runner acquisition/event order (A5).
- “PostgreSQL live/dead row counts are exact, rollbacks equal query errors, and counters represent the chosen dashboard range”: contradicted by official statistics semantics (A6).

## Uncertainties

- No real workload, production database, privileged statistics, or deployed enterprise override was inspected. Query frequency, necessary retention, and acceptable memory/CPU budgets remain unmeasured.
- Official `client.js` follow-up fetch was rate-limited. Exact root Knex `query-error` behavior for timeouts/postprocessing failures and transaction/stream forwarding must be verified against the pinned dependency via tests/source before relying on terminal events for all failure modes.
- Existing table/schema visibility rules and source-admin ACL roles need to be enforced in the new route; this notebook identifies integration gates without claiming a complete security audit of them.
- Native database server versions, grants, enabled extensions/instruments, SQLite driver/file topology, and external databases shared across bases are unknown. Use capabilities instead of claiming universal metric availability.
- The proposed Phase 0 supplies local view settings and live browser warnings; shared saved panels, cross-process history, full-request latency, database-wide query capture, and background notifications remain later phases and must be disclosed in final delivery.

## Handoff

1. Implement the external-source slice without trying to resurrect stubbed dashboards. Preserve source composite keys and reject shared/meta/internal telemetry; separately scope native health metadata.
2. Treat Knex timings as post-acquisition observed query duration. Exclude probes with a per-query marker and verify success/error/timeout/transaction handling; never return SQL, values, rows, or raw error objects.
3. Label local process coverage, capture start, bounded sample retention, health estimate/cumulative scope, saved browser preferences, and open-page-only warnings directly in the interface.
4. Finish with meaningful isolation/instrumentation tests and include the phased backlog for durable data, real saved panels, native statement analysis, and server-side alerts so the full user request stays visible.
