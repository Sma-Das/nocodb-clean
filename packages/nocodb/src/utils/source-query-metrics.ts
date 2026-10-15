import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const MINUTE = 60_000;
const RETENTION = 60;
const MAX_SOURCES = 50;
const MAX_QUERIES = 50;
const MAX_IN_FLIGHT = 500;
// Fixed buckets allow merging percentiles without retaining individual timings.
const LATENCY_BOUNDS = [
  1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000,
];

type QueryEvent = {
  __knexQueryUid?: string;
  sql?: string;
  method?: string;
  queryContext?: { ncAnalytics?: boolean };
};

type Totals = {
  count: number;
  errors: number;
  slow: number;
  durationMs: number;
  maxMs: number;
};

type QueryTotals = Totals & { queryId: string; operation: string };
type Bucket = Totals & {
  minute: number;
  histogram: number[];
  queries: Map<string, QueryTotals>;
};

const emptyTotals = (): Totals => ({
  count: 0,
  errors: 0,
  slow: 0,
  durationMs: 0,
  maxMs: 0,
});

function add(target: Totals, duration: number, failed: boolean) {
  target.count++;
  target.errors += Number(failed);
  target.slow += Number(duration >= 1000);
  target.durationMs += duration;
  target.maxMs = Math.max(target.maxMs, duration);
}

function merge(target: Totals, source: Totals) {
  target.count += source.count;
  target.errors += source.errors;
  target.slow += source.slow;
  target.durationMs += source.durationMs;
  target.maxMs = Math.max(target.maxMs, source.maxMs);
}

function summarize(total: Totals) {
  return {
    count: total.count,
    errors: total.errors,
    slow: total.slow,
    avgMs: total.count ? total.durationMs / total.count : 0,
    maxMs: total.maxMs,
    errorRate: total.count ? (total.errors / total.count) * 100 : 0,
  };
}

export class QueryMetricsCollector {
  readonly startedAt: number;
  private buckets = new Map<number, Bucket>();
  private inFlight = new Map<
    string,
    { start: number; queryId: string; operation: string }
  >();
  private fingerprints = new Set<string>();
  private dropped = 0;

  constructor(
    private wallClock = Date.now,
    private monotonicClock = () => performance.now(),
  ) {
    this.startedAt = wallClock();
  }

  start(query: QueryEvent) {
    if (!query.__knexQueryUid || query.queryContext?.ncAnalytics) return;
    // Housekeeping is bounded by MAX_IN_FLIGHT, including queries that never finish.
    const now = this.monotonicClock();
    this.prunePending(now);
    if (this.inFlight.size >= MAX_IN_FLIGHT) {
      this.dropped++;
      return;
    }
    // Do not retain SQL, bindings, database errors, or connection identifiers.
    const hash = createHash('sha256')
      .update(query.sql || query.method || 'unknown')
      .digest('hex')
      .slice(0, 16);
    if (this.fingerprints.size < MAX_QUERIES) this.fingerprints.add(hash);
    const queryId = this.fingerprints.has(hash) ? hash : 'other';
    const method = (query.method || '').toLowerCase();
    const operation = [
      'select',
      'first',
      'insert',
      'update',
      'del',
      'delete',
      'raw',
    ].includes(method)
      ? method
      : 'other';
    this.inFlight.set(query.__knexQueryUid, { start: now, queryId, operation });
  }

  recordDropped() {
    this.dropped++;
  }

  private prunePending(now: number) {
    for (const [id, pending] of this.inFlight) {
      if (now - pending.start < 10 * MINUTE) break;
      this.inFlight.delete(id);
      this.dropped++;
    }
  }

  finish(query: QueryEvent, failed = false) {
    const pending = this.inFlight.get(query?.__knexQueryUid);
    if (!pending) return;
    this.inFlight.delete(query.__knexQueryUid);
    const duration = Math.max(0, this.monotonicClock() - pending.start);
    const minute = Math.floor(this.wallClock() / MINUTE);
    this.prune(minute);
    let bucket = this.buckets.get(minute);
    if (!bucket) {
      bucket = {
        ...emptyTotals(),
        minute,
        histogram: Array(LATENCY_BOUNDS.length + 1).fill(0),
        queries: new Map(),
      };
      this.buckets.set(minute, bucket);
    }
    add(bucket, duration, failed);
    const index = LATENCY_BOUNDS.findIndex((bound) => duration <= bound);
    bucket.histogram[index < 0 ? LATENCY_BOUNDS.length : index]++;
    let queryTotals = bucket.queries.get(pending.queryId);
    if (!queryTotals) {
      queryTotals = {
        ...emptyTotals(),
        queryId: pending.queryId,
        operation: pending.queryId === 'other' ? 'other' : pending.operation,
      };
      bucket.queries.set(pending.queryId, queryTotals);
    }
    add(queryTotals, duration, failed);
  }

  private prune(minute: number) {
    for (const key of this.buckets.keys()) {
      if (key <= minute - RETENTION || key > minute) this.buckets.delete(key);
    }
  }

  snapshot(minutes = 15) {
    if (![5, 15, 60].includes(minutes))
      throw new Error('Unsupported analytics time range');
    const minute = Math.floor(this.wallClock() / MINUTE);
    this.prunePending(this.monotonicClock());
    this.prune(minute);
    const total = emptyTotals();
    const histogram = Array(LATENCY_BOUNDS.length + 1).fill(0);
    const queries = new Map<string, QueryTotals>();
    const series = [];
    for (let key = minute - minutes + 1; key <= minute; key++) {
      const bucket = this.buckets.get(key);
      series.push({
        timestamp: key * MINUTE,
        observed: key >= Math.floor(this.startedAt / MINUTE),
        ...summarize(bucket || emptyTotals()),
      });
      if (!bucket) continue;
      merge(total, bucket);
      bucket.histogram.forEach((count, index) => (histogram[index] += count));
      for (const [id, stats] of bucket.queries) {
        if (!queries.has(id))
          queries.set(id, {
            ...emptyTotals(),
            queryId: id,
            operation: stats.operation,
          });
        merge(queries.get(id), stats);
      }
    }
    const target = Math.ceil(total.count * 0.95);
    let seen = 0;
    const percentileIndex = histogram.findIndex(
      (count) => (seen += count) >= target,
    );
    return {
      startedAt: this.startedAt,
      // Minute-aligned windows include the current, partial minute.
      from: (minute - minutes + 1) * MINUTE,
      to: this.wallClock(),
      summary: {
        ...summarize(total),
        p95UpperMs: total.count
          ? (LATENCY_BOUNDS[percentileIndex] ?? null)
          : null,
        p95Overflow:
          total.count > 0 && percentileIndex === LATENCY_BOUNDS.length,
      },
      series,
      queries: [...queries.values()]
        .sort((a, b) => b.durationMs - a.durationMs)
        .slice(0, 20)
        .map((stats) => ({
          queryId: stats.queryId,
          operation: stats.operation,
          totalMs: stats.durationMs,
          ...summarize(stats),
        })),
      inFlight: this.inFlight.size,
      dropped: this.dropped,
    };
  }
}

type ObservableConnection = {
  on: (event: string, listener: (...args: any[]) => void) => any;
  removeListener: (event: string, listener: (...args: any[]) => void) => any;
};
type ObservableBuilder = ObservableConnection & {
  queryContext: () => QueryEvent['queryContext'];
};

type Observation = { collector: QueryMetricsCollector; dispose: () => void };

/** Process-local, opt-in instrumentation of external source pools only. */
export class SourceQueryMetrics {
  private static sources = new Map<string, Observation>();
  private static connections = new WeakMap<ObservableConnection, Observation>();

  static get enabled() {
    return process.env.NC_DB_ANALYTICS_ENABLED === 'true';
  }

  static attach(key: string, connection: ObservableConnection) {
    if (!this.enabled || this.connections.has(connection)) return;
    this.sources.get(key)?.dispose();
    if (this.sources.size >= MAX_SOURCES)
      this.sources.values().next().value.dispose();
    const collector = new QueryMetricsCollector();
    const builders = new Map<
      ObservableBuilder,
      { runs: number; startedAt: number; dispose: () => void }
    >();
    // Root query-error omits Knex timeouts. Builder events include them.
    // Streams do not emit root start and are intentionally outside this collector.
    const start = (builder: ObservableBuilder) => {
      try {
        if (builder.queryContext()?.ncAnalytics) return;
        for (const active of builders.values()) {
          if (performance.now() - active.startedAt >= 10 * MINUTE)
            active.dispose();
        }
        if (builders.has(builder)) {
          builders.get(builder).runs++;
          return;
        }
        if (builders.size >= MAX_IN_FLIGHT) {
          collector.recordDropped();
          return;
        }
        const query = (event: QueryEvent) => {
          try {
            collector.start(event);
          } catch {
            /* Metrics must not interrupt a query. */
          }
        };
        const success = (_response: unknown, event: QueryEvent) => {
          try {
            collector.finish(event);
          } catch {
            /* See above. */
          }
        };
        const failure = (_error: unknown, event: QueryEvent) => {
          try {
            collector.finish(event, true);
          } catch {
            /* See above. */
          }
        };
        const end = () => {
          if (--entry.runs === 0) entry.dispose();
        };
        const entry = {
          runs: 1,
          startedAt: performance.now(),
          dispose: () => {
            builder.removeListener('query', query);
            builder.removeListener('query-response', success);
            builder.removeListener('query-error', failure);
            builder.removeListener('end', end);
            builder.removeListener('error', end);
            builders.delete(builder);
          },
        };
        builders.set(builder, entry);
        builder.on('query', query);
        builder.on('query-response', success);
        builder.on('query-error', failure);
        builder.on('end', end);
        builder.on('error', end);
      } catch {
        /* Instrumentation is best effort and never changes query results. */
      }
    };
    const observation = {
      collector,
      dispose: () => {
        connection.removeListener('start', start);
        for (const builder of builders.values()) builder.dispose();
        this.connections.delete(connection);
        if (this.sources.get(key) === observation) this.sources.delete(key);
      },
    };
    connection.on('start', start);
    this.sources.set(key, observation);
    this.connections.set(connection, observation);
  }

  static detach(connection: ObservableConnection) {
    this.connections.get(connection)?.dispose();
  }

  static snapshot(key: string, minutes: number) {
    return this.sources.get(key)?.collector.snapshot(minutes) ?? null;
  }
}
