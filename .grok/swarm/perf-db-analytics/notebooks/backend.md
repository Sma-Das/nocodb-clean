# Backend performance review

## Scope

Backend query execution, metadata hydration, list/count, grouping and aggregation in `packages/nocodb/src`. Read-only application review; no application edits and no tests executed. This notebook is the only file written by this shard.

## Method

Traced the concrete list/count execution path through `DatasService`, `BaseModelSqlv2`, `conditionV2`, `select-object`, `Model`/`Column`, and aggregate orchestration. Findings describe code-level avoided work, not measured speedups. Read existing implementation before recommending batching or caching. The requested prior notebook was absent (`cat` exited 1); this is an absent artifact, not source evidence. No other tool errors.

## Findings

### B1 — Remove duplicated count filter trees; also repair OR semantics (highest priority, small)

- Evidence: `packages/nocodb/src/db/BaseModelSqlv2.ts:1151` wraps `args.filterArr` in an AND group, then `:1161` spreads the identical filters into the outer sibling array. The no-view branch repeats this at `:1180` and `:1190`. `list` only uses the grouped version (`:951`, `:987`). `packages/nocodb/src/db/conditionV2.ts:120` maps an `or` filter to `orWhere`; its array branch applies every sibling's operator at `:207`. This is not automatically an idempotent duplicate.
- Mechanism: compiles all explicit filters twice, including lookup/formula/relation SQL and metadata resolution. For an explicit tree `A OR B` with a restrictive view/custom filter `V`, the outer form can become `(V AND (A OR B) AND A OR B)`, which admits B outside V; list and count diverge. RLS ordinary clauses are also siblings in this tree, so authorization-sensitive count coverage is warranted; this review did not run a live exploit.
- Change: remove just the two trailing spreads, preserving grouped explicit filters and all mandatory conditions.
- Risk: callers might have accidentally depended on the incorrect count. Return to the same boolean semantics as list.
- Validation: count equals list length for AND, OR, NOT/nested trees, with and without a view; add rows matching only the OR RHS outside a restrictive view/custom/RLS condition. Include disabled filters and relation-valued predicates. Check generated count SQL contains the expensive explicit predicate once.

### B2 — Skip lookup alias discovery when raw results cannot use it (high priority, small)

- Evidence: raw results set `skipSubstitutingColumnIds = true` at `BaseModelSqlv2.ts:7529`; `count` invokes `execAndParse(..., {raw:true, first:true})` at `:1202`. Nevertheless `:7562` walks every lookup and awaits `getNestedColumn` sequentially. The alias map is consumed only by aggregate nested-object key rewriting at `:7637` or ordinary substitution at `:7663`. Recursive lookup resolution at `:8349` loads relation and lookup column metadata.
- Mechanism: counts and other raw reads traverse unrelated lookup chains after their SQL result already exists. Every lookup can perform several metadata/cache operations, with the outer traversal serialized.
- Change: require `!dependencyColumns && (options.bulkAggregate || !options.skipSubstitutingColumnIds)` for alias discovery. Preserve the bulk aggregate exception: nested object results still use aliases even though outer substitution is skipped.
- Risk: do not return early for every raw result: formula non-finite and V3 transforms have independent behavior later in this method.
- Validation: a raw count on a lookup-heavy model never calls `getNestedColumn`; normal list and object-valued bulk aggregate retain their output. Count with an orphan lookup remains readable.

### B3 — Resolve view columns from already supplied hydrated columns (high priority, small)

- Evidence: `BaseModelSqlv2.ts:872` hydrates all model columns and passes them to `selectObject` at `:881`. In `packages/nocodb/src/db/BaseModelSqlv2/select-object.ts:79`, a normal view read selects `GridViewColumn` rows, and `:88` then serially calls `Column.get` for each row at `:92`, ignoring the supplied `_columns` for that lookup. Visibility checks happen afterward at `:109`.
- Mechanism: a grid with C view columns pays C serialized metadata/cache/get-options paths, including fields later skipped, even though the fully hydrated Column objects already exist for this request.
- Change: build a supplied-column ID map once; resolve `fk_column_id ?? id` from it, falling back to the existing `Column.get` for missing IDs. Iterate the original view array so ordering/visibility stay intact.
- Risk: retain fallback/orphan handling and context from supplied Column objects. Do not replace view metadata with table metadata in visibility checks.
- Validation: ordered visible subset, hidden and system fields, missing column, formula/lookup projection, both fieldsSet and normal view branches. Spy on Column.get to show hydrated columns avoid redundant calls.

### B4 — Avoid collaborator loading/signing when no returned field needs it (medium priority, small-to-moderate)

- Evidence: `BaseModelSqlv2.ts:7890` scans all model columns plus dependencies; `:7914` resolves every lookup; `:7931` only checks whether the schema has user columns, then `:7936` fetches all base users and `:7941` signs their icons. Selection can omit those fields (`select-object.ts:109`), and empty data arrays are truthy, so they also reach this work. `_convertUserFormat` finally ignores absent values at `BaseModelSqlv2.ts:7989`.
- Mechanism: a title-only projection or empty page on any table with CreatedBy/LastModifiedBy/User performs collaborator loading and image-signing that cannot affect the returned rows.
- Change: immediate return for an empty array; before resolving lookup types/loading users, narrow candidate columns to IDs actually present with potentially convertible values in the returned data. A shared projected-column plan is a broader follow-up, not required for the narrow fix.
- Risk: preserve nested arrays, lookup user values and public email redaction; use response IDs, not public titles, at this conversion stage. Do not infer from the first row alone because sparse later rows can carry values.
- Validation: empty page and title-only projection make no user/icon calls; a value appearing only in the last row still converts/redacts, including nested lookup User data. Existing V2/V3 response behavior must agree.

### B5 — Resolve server timezone once per conversion batch (medium priority, small)

- Evidence: `BaseModelSqlv2.ts:8726` calls `_convertDateFormat` per row; `_convertDateFormat` creates `Intl.DateTimeFormat().resolvedOptions()` at `:8558` for each SQLite row. Its direct date/time branch repeats the same lookup per eligible value at `:8653`, despite having a local cached value. The regular expressions are also re-created per row at `:8564`.
- Mechanism: avoid repeated Intl formatter construction/options resolution during paginated reads and export batches. This is CPU work independent of DB query latency.
- Change: compute the timezone in `convertDateFormat` once per synchronous batch and pass it into the row helper; reuse it in the direct and formula branches. Reusing the local `cachedTimeZone` at `:8653` is the smallest first step. Regex reuse can remain separate to keep review scope small.
- Risk: retain timezone behavior and reset `lastIndex` if moving global regex instances. Prefer batch-scoped state over process-global timezone caching, which complicates tests/runtime TZ changes.
- Validation: SQLite dates/formulas under UTC and a DST timezone, explicit offsets, naive values, multiple rows. Assert one timezone resolution per batch without asserting elapsed time.

### B6 — Share metadata hydration within a single list/count request (medium priority, follow-up)

- Evidence: `packages/nocodb/src/services/datas.service.ts:302` launches count/list together on one baseModel. Both unconditionally call `model.getColumns` (`BaseModelSqlv2.ts:872`, `:1107`), and first-time `getProto` calls it again at `:1739`. `packages/nocodb/src/models/Model.ts:172` always invokes `Column.list`; `packages/nocodb/src/models/Column.ts:762` sorts and `:768` creates a fresh Column for every field and awaits `getColOptions` for all of them. Warm caching reduces SQL but does not remove hydration/cache traffic/allocation. Both concurrent calls also assign `model.columns` and `columnsById` (`Model.ts:184`).
- Mechanism: the same request repeats O(C) hydration and option retrieval several times, with additional duplicate cache misses possible for concurrent count/list.
- Change: pass the already loaded columns to `getProto` and share a request-scoped column load promise/immutable snapshot between list and count. Keep this narrowly request-scoped, with explicit option identity for default view/includeDeleted/transaction behavior; do not globally memoize `getColumns` indiscriminately.
- Risk: model instances may outlive a single call; broad memoization risks stale metadata and mixing default-view/includeDeleted variants. B3 is the simpler metadata improvement to implement first.
- Validation: count/list use one snapshot with unchanged result ordering and column options; metadata mutation between separate requests refreshes; includeDeleted/default-view/transaction variants stay isolated. Measure cache/meta-call counts before claiming throughput gains.

## Falsified

- Blanket N+1 relation-list claim: `getProto` already uses DataLoader and a shared query queue (`BaseModelSqlv2.ts:1801` onward); batching must be measured by workload, not assumed missing.
- Blanket per-bucket aggregate claim: `dbQueryClient/cross-db-utils/bulk-aggregate.ts` already implements guarded PostgreSQL consolidation with explicit decline reasons and per-filter-set correctness handling. Extending it across dialects is not a small generic fix.
- Missing count/list parallelism: DatasService already launches them with Promise.all at `:302`; making them parallel again is not a recommendation.
- Filter-toggle capability lookup as DB overhead: CE `Filter.supportToggle` is an async constant false (`models/Filter.ts:151`), not a metadata query.
- `getColumnsHash` immediately reusing default-view hydrated columns: getWithInfo loads a default-view-specific representation and hash deliberately loads a non-default-view representation. Replacing blindly could change hash semantics.

## Uncertainties

- No production traces, query plans or benchmark data were available to this shard. Impact ordering is based on frequency and directly avoided work, not measured latency.
- Cross-request cache invalidation and EE overrides need checking before implementing B6.
- B1 OR escape is derived from the builder source; run the suggested regression before describing it as a confirmed live authorization incident.
- Central telemetry and Grafana-like feature design are assigned to another shard and not reviewed here.

## Handoff

Implement B1 and B2 first, then B3 if time permits: each is a narrow, reviewable fix with a direct avoided-work assertion. B4/B5 are good independent follow-ups; B6 needs explicit request-lifetime design. Re-read cited application lines because parallel siblings/parent may change line numbers. All findings were sent to the parent as source leads; no tests or application code changes were performed by this shard.
