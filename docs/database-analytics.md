# Database analytics and performance review

This change delivers an initial operational analytics pane for external databases and two verified performance/correctness fixes. Six subagents using high reasoning completed three separate discovery reviews and three independent verification reviews. The primary agent wrote all application code and ran all checks.

The review covers the three requested areas: query performance, dashboard exploration, and database health/alerts. Shared dashboards, durable history, and background alert delivery are planned below; they are not implemented by the initial pane.

## Use the initial pane

1. Set `NC_DB_ANALYTICS_ENABLED=true` on the backend and restart it. Collection is off by default and stays inside this application process; it does not enable external product telemetry.
2. As a base owner or creator, open **Base settings → Database analytics** and select an external database. The route is `?settings=database-analytics`.
3. Use that database in the app, then refresh the pane. Choose a 5, 15, or 60 minute range; optional refresh intervals are 15, 30, or 60 seconds. Automatic refresh pauses while the browser document is hidden and stops when the pane unmounts.
4. Explore minute counts, mean query duration, histogram p95 upper bounds, query errors, queries taking at least one second, and the top 20 exact-statement IDs by total duration. The operation filter applies to that top 20, not the complete workload. Expand the chart's data table for accessible numeric values; intervals preceding collection say **No data**.
5. Inspect pool connections and available database health statistics. Configure duration/error-rate thresholds for warnings in the currently displayed snapshot. Pool queue warnings also work when no query has completed.
6. Save named views to restore the database, range, chart, operation filter, and thresholds. Up to 20 views are stored for the current account/base in this browser. They do not store metric history and are not shared dashboard panels.

### Coverage and limits

| Surface | Implemented behavior | Limits |
| --- | --- | --- |
| Query timings and errors | Correlated Knex builder events, including ordinary transaction queries and query timeouts | Starts after pool acquisition; excludes streams, pre-execution failures, other processes, other client pools, and direct database traffic |
| Retention | Up to 60 minute buckets per observed pool | Process memory only; restarts, pool replacement, and collector eviction reset history; windows include the current partial minute |
| Query identity | SHA-256-derived exact-statement IDs; operation categories | No SQL, bindings, response rows, or error messages stored in metrics; IDs are not normalized query digests; different inline literals can produce different IDs |
| Cardinality | 50 observed pools, 50 statement IDs plus one `other` group per pool | At most 500 pending query samples and 500 active builder correlations per pool; abandoned samples expire after ten minutes; dropped observations reported |
| p95 | Mergeable fixed histogram with an explicit upper bound | Values above the final bucket display `> 10,000 ms`; no samples display a dash; not an exact percentile |
| PostgreSQL health | Current database size/connections, active-connection gauge in the API, mapped-table size/live/dead row estimates and analyze timestamp | Requires catalog grants; table data filtered to the first configured schema and mapped table names; database size/connections cover the external database |
| MySQL/MySQL2 health | Mapped-table data/index sizes and estimated rows | No native connection/storage summary yet; InnoDB row counts are estimates |
| SQLite health | File page count × page size | File-level storage; no table row scans or native connection statistics |
| Other external dialects | Query and pool metrics | Native health explicitly unsupported |
| Warnings | Browser evaluations of maximum duration, error rate, and waiting pool requests | Pane must be open and refreshed; no background evaluation or notification delivery |

Internal/meta/local sources are excluded because their physical pools can serve multiple bases. External connections can also point at databases used by other applications: native database-wide gauges are labeled accordingly, while table statistics are limited to mapped tables in the configured schema. Up to 50 table records are returned from at most 500 mapped table names.

The API is `GET /api/v2/meta/bases/:baseId/sources/:sourceId/analytics?minutes=15`. It uses the existing global/auth and metadata rate-limit guards, a new base-scoped `sourceAnalytics` permission, and a tenant-context source lookup. Base viewers, commenters, editors, and app-only users do not receive this permission; workspace membership alone does not grant it. No SQL execution endpoint is added.

Native health uses only fixed, bound catalog queries. Health work is single-flighted per physical pool and cached for 15 seconds after completion. A three-second response deadline keeps the metrics endpoint responsive; pending underlying work is reused until it settles, rather than accumulating probes. Probes skip pools with no free connections when connections are already in use or requests are waiting. Individual native queries also have Knex timeouts. Client-side deadlines do not promise server-side query cancellation. Health queries are marked and excluded from query telemetry. Driver errors are reduced to an unavailable state.

## Performance findings

These findings identify avoided work from code inspection and controlled regression checks. No production latency/throughput benchmark was available; no percentage speedup is claimed.

| Priority | Finding and mechanism | Status / next validation | Source |
| --- | --- | --- | --- |
| P1 | Count applied explicit filters both inside a group and again at the outer level. This duplicated compilation and allowed an outer OR to change view/custom/tenant restriction semantics. | **Fixed.** Actual count method and condition parser tested against SQLite with view/custom/tenant/where restrictions, AND, OR, nested NOT, disabled filters, soft deletion, and one compilation per explicit predicate. | [BaseModelSqlv2.count](../packages/nocodb/src/db/BaseModelSqlv2.ts) |
| P1 | Successful bulk grid chunks were upserted, invalidated and settled twice; the repeated upsert rescanned the cache. | **Fixed.** Actual bulk processor and cache helpers tested with displaced duplicates, early settlement, and deferred comment enrichment/repaint. | [useInfiniteData](../packages/nc-gui/composables/useInfiniteData.ts), [cache helpers](../packages/nc-gui/utils/infiniteCacheUtils.ts) |
| P2 | Raw count results traverse lookup alias metadata that cannot be used by raw substitution. | Gate lookup setup on alias consumers, preserving object-valued bulk aggregate behavior. Spy on nested-column calls and test normal/aggregate output. | [execAndParse](../packages/nocodb/src/db/BaseModelSqlv2.ts) |
| P2 | Grid projection serially reloads columns already supplied in hydrated form. | Resolve from an ID map with existing lookup fallback; test view order, hidden/system fields, orphans, formulas and lookups. | [select-object](../packages/nocodb/src/db/BaseModelSqlv2/select-object.ts) |
| P2 | Independent related-table metadata loads run serially, missing the existing 50 ms batch window. | Deduplicate IDs and start independent tasks together, preserving full-meta → partial-meta fallback and permission behavior. | [useViewColumns](../packages/nc-gui/composables/useViewColumns.ts), [useInfiniteData](../packages/nc-gui/composables/useInfiniteData.ts), [useInternalBatch](../packages/nc-gui/composables/useInternalBatch.ts) |
| P2 | Nested group aggregation refreshes repeat overlapping subtrees. | Union the current refresh set before dispatch; test edited descendants and ancestors while groups reload. | [useGridViewData](../packages/nc-gui/composables/useGridViewData.ts), [useInfiniteGroups](../packages/nc-gui/composables/useInfiniteGroups.ts) |
| P2 | User conversion can load collaborator/icon metadata for empty or unrelated field projections. | Check returned field IDs/values before hydration, including sparse/nested lookup data and public redaction. | [convertUserFormat](../packages/nocodb/src/db/BaseModelSqlv2.ts) |
| P2 | SQLite date conversion repeatedly resolves the server timezone for rows/values. | Resolve once per conversion batch; validate offsets, formulas and DST without process-global caching. | [convertDateFormat](../packages/nocodb/src/db/BaseModelSqlv2.ts) |
| P2 | Count/list/prototype paths repeatedly hydrate the same model columns in one request. | Share a request-scoped snapshot, with option/transaction identity and metadata invalidation preserved. | [DatasService](../packages/nocodb/src/services/datas.service.ts), [Model](../packages/nocodb/src/models/Model.ts), [Column](../packages/nocodb/src/models/Column.ts) |
| P2 | Sparse cache eviction iterates from zero to the highest chunk index. | Iterate existing entries; test sparse distant chunks, retained buffers, and invalidated groups. | [useInfiniteData](../packages/nc-gui/composables/useInfiniteData.ts) |
| P2 | Interface batches can launch many calls concurrently and whole-batch fallback can repeat successful siblings. | Bound concurrency and retain per-operation results; test mixed successes, permission errors, cancellations and out-of-range chunks. | [useInfiniteData](../packages/nc-gui/composables/useInfiniteData.ts) |
| P3 | Leaflet loads from a global plugin even for users who never open maps. | Measure initial bundles/network, then lazy-load with map lifecycle/SSR safeguards. | [frontend review evidence](../.grok/swarm/perf-db-analytics/notebooks/frontend.md) |

Detailed reviewed line citations, false leads and risks are preserved in the [backend](../.grok/swarm/perf-db-analytics/notebooks/backend.md), [frontend](../.grok/swarm/perf-db-analytics/notebooks/frontend.md), and [analytics](../.grok/swarm/perf-db-analytics/notebooks/analytics.md) notebooks. The independent [performance](../.grok/swarm/perf-db-analytics/notebooks/verify-perf.md), [metrics](../.grok/swarm/perf-db-analytics/notebooks/verify-metrics.md), and [UI](../.grok/swarm/perf-db-analytics/notebooks/verify-ui.md) reviews record verification and resolved findings. Notebook line numbers describe the inspected revision and can shift after formatting.

## Extend toward Grafana-style functionality

Inspection found that Dashboard/Widget models, their widget handler, and the GUI stores are placeholders. Existing migrations and chart types do not constitute working dashboard CRUD. The dedicated pane avoids depending on these stubs. Business-data aggregation already has working source/view/RLS/soft-delete logic and should be reused for business charts.

### 1. Durable metrics and complete latency coverage

Add source/base/workspace-scoped minute rollups, histogram sums/counts, capture coverage, and collector heartbeats to an explicitly chosen metrics store. Flush in batches, not per query. Merge histogram counts across replicas; never average p95s or unweighted averages. Instrument API stages, pool acquisition, streaming completion, compile/acquire failures and postprocessing separately. Include process/source identity, units, bucket interval, observed coverage, and reset/truncation metadata in the query contract.

Choose retention from measured workload and storage budgets. A starting design to evaluate is 24-hour slow/error exemplars, seven-day minute rollups and 30-day hourly rollups; this is a proposal, not an existing guarantee. Test restart recovery, multiple replicas, pool/source deletion, and tenant isolation before expanding the time selector beyond one hour.

### 2. Shared dashboards, panels and exploration

Implement tenant/base-scoped Dashboard/Widget CRUD against the existing migration schema, with explicit operational-telemetry data sources alongside business-data view/model sources. Reuse ECharts/grid-layout-plus where appropriate. Add reusable panels, arrange/resize, panel-specific queries, shared time ranges, source variables, chart/table switching and drilldowns. Authorize every resolved variable/panel data source, including restored/imported dashboards. Preserve existing business-data RLS/view/soft-delete behavior.

Persist dashboard versions and ownership separately from browser preferences; support share links only after defining and testing explicit operational-metadata permissions. Use query builders rather than a general arbitrary-SQL endpoint. Validate filters, time bounds, resolution and result size on the server.

### 3. Native database workload and health analysis

Add capability-gated PostgreSQL `pg_stat_statements` and MySQL Performance Schema digest adapters. Read extension/instrument availability and grants; do not install extensions or reset statistics automatically. Track counter-reset timestamps and compute deltas for selected windows. PostgreSQL rolled-back transactions are not query errors; live/dead row counts are estimates.

Add health trends, pool capacity/wait time, locks/waits, storage growth, index/table access and native normalized statement details under stronger permissions. Keep SQL samples opt-in and access-controlled. Diagnostic links can lead from a panel to statement/health details; do not automatically replay queries or run `EXPLAIN ANALYZE`. Capability responses should keep other metrics usable when one probe lacks privilege.

### 4. Background alerts and operator integrations

Persist rules, evaluator state, pending/recovery periods, last successful evaluation and notification history. Run evaluation on a scheduler with an execution lease so multiple servers do not duplicate deliveries. Add no-data/error states, deduplication, silences and notification routing. Thresholds should cover latency/errors, saturation, storage growth and collector staleness; test firing, recovery, duplicate evaluation, failure and source deletion.

Add Prometheus/OpenTelemetry export for operators with an existing Grafana stack. This complements in-product exploration and keeps durable operations data independent of one browser tab.

Useful primary references: [Grafana dashboards](https://grafana.com/docs/grafana/latest/dashboards/), [dashboard variables](https://grafana.com/docs/grafana/latest/dashboards/variables/), [Grafana Alerting](https://grafana.com/docs/grafana/latest/alerting/), [Knex events](https://knexjs.org/guide/interfaces.html#events), [PostgreSQL statistics](https://www.postgresql.org/docs/current/monitoring-stats.html), [pg_stat_statements](https://www.postgresql.org/docs/16/pgstatstatements.html), and [MySQL statement summaries](https://dev.mysql.com/doc/refman/8.4/en/performance-schema-statement-summary-tables.html).

## Validation

- **22 passing Jest tests:** real Knex event propagation over a fake PostgreSQL transport, timeouts, transactions, health-query exclusion, cleanup/bounds, histogram/count behavior, fixed catalog queries, sanitized failures, source isolation, cache single-flight, busy-pool avoidance and health-response deadlines.
- **4 passing focused Node tests:** actual ACL compilation, actual count/condition compiler against an in-memory SQLite fixture, actual bulk chunk processing/reactive cache with deferred comments, and the compiled Vue component with DOM interactions for saved views, invalid thresholds, cancellation and stale responses.
- **20 existing performance regression tests pass**, including real SQLite notification pagination/filtering.
- Targeted TypeScript checks pass for new metrics/health modules, their utility tests, and the SDK response contract. The actual SFC and scoped styles compile with the repository's UnoCSS configuration.
- Collaborative browser verification of the isolated actual component with fixture responses at 1280×800 and 375×812: chart rendered, no horizontal page overflow, lower sections reachable. This harness replaces the application shell/button component and is not a full Nuxt/auth integration run.
- Full application build/typecheck and live PostgreSQL/MySQL catalog probes have not been run; the worktree did not contain the monorepo's installed dependencies. Focused tooling was installed outside the repository. No production data or server was used, and no tailnet server was published.

With normal workspace dependencies installed and Node 24+:

```sh
pnpm --filter=nocodb test:analytics
node --test scripts/tests/db-analytics.test.cjs
node --test scripts/tests/clean-performance.test.cjs
```
