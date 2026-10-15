import { EventEmitter } from 'node:events';
import knex from 'knex';
import {
  QueryMetricsCollector,
  SourceQueryMetrics,
} from './source-query-metrics';

describe('bounded query metrics', () => {
  let wall: number;
  let monotonic: number;
  let collector: QueryMetricsCollector;
  beforeEach(() => {
    wall = 120 * 60_000;
    monotonic = 0;
    collector = new QueryMetricsCollector(
      () => wall,
      () => monotonic,
    );
  });
  function query(
    id: string,
    duration: number,
    failed = false,
    sql = 'select ?',
  ) {
    const event = {
      __knexQueryUid: id,
      sql,
      method: 'select',
      bindings: ['private-value'],
    };
    collector.start(event);
    monotonic += duration;
    collector.finish(event, failed);
  }
  it('merges weighted means, errors, slow counts and histograms without retaining values', () => {
    query('a', 5);
    query('b', 1500, true);
    wall += 60_000;
    query('c', 25);
    const result = collector.snapshot(5);
    expect(result.summary).toMatchObject({
      count: 3,
      errors: 1,
      slow: 1,
      avgMs: 510,
      maxMs: 1500,
      p95UpperMs: 2500,
    });
    expect(result.queries).toHaveLength(1);
    expect(result.queries[0]).toMatchObject({ count: 3, totalMs: 1530 });
    expect(JSON.stringify(result)).not.toMatch(/private-value|select \?/);
    expect(result.series).toHaveLength(5);
    expect(result.series.map((point) => point.observed)).toEqual([
      false,
      false,
      false,
      true,
      true,
    ]);
  });
  it('correlates overlapping identical statements by query uid and ignores duplicate terminals', () => {
    const a = { __knexQueryUid: 'a', method: 'select', sql: 'select ?' };
    const b = { ...a, __knexQueryUid: 'b' };
    collector.start(a);
    monotonic = 10;
    collector.start(b);
    monotonic = 30;
    collector.finish(a);
    collector.finish(a, true);
    monotonic = 50;
    collector.finish(b, true);
    expect(collector.snapshot().summary).toMatchObject({
      count: 2,
      errors: 1,
      avgMs: 35,
    });
  });
  it('excludes health probes and expires completed history after sixty buckets', () => {
    const probe = {
      __knexQueryUid: 'probe',
      queryContext: { ncAnalytics: true },
    };
    collector.start(probe);
    collector.finish(probe, true);
    query('user', 20);
    wall += 60 * 60_000;
    expect(collector.snapshot(60).summary.count).toBe(0);
    expect(collector.snapshot().summary.p95UpperMs).toBeNull();
    expect(() => collector.snapshot(1440)).toThrow();
  });
  it('bounds statement cardinality while preserving overall counts', () => {
    for (let i = 0; i < 1000; i++)
      query(String(i), i + 1, false, `select ${i}`);
    const result = collector.snapshot();
    expect(result.summary.count).toBe(1000);
    expect(result.queries).toHaveLength(20);
    expect(result.queries.find((q) => q.queryId === 'other')?.count).toBe(950);
  });
  it('bounds abandoned correlations and reports dropped observations', () => {
    for (let i = 0; i < 600; i++)
      collector.start({ __knexQueryUid: String(i) });
    expect(collector.snapshot()).toMatchObject({ inFlight: 500, dropped: 100 });
    monotonic += 11 * 60_000;
    collector.start({ __knexQueryUid: 'new' });
    expect(collector.snapshot()).toMatchObject({ inFlight: 1, dropped: 600 });
  });
});

describe('Knex event integration (no external database)', () => {
  let db: ReturnType<typeof knex>;
  const key = 'base:source';
  const previous = process.env.NC_DB_ANALYTICS_ENABLED;
  beforeEach(() => {
    process.env.NC_DB_ANALYTICS_ENABLED = 'true';
    db = knex({ client: 'pg' });
    db.client.acquireConnection = async () => ({
      __knexUid: 'test',
      query: (_sql, callback) => callback(null, { rows: [], rowCount: 0 }),
    });
    db.client.releaseConnection = async () => {};
    (db.client as any)._query = async (_connection, query) => ({
      ...query,
      response: { rows: [], rowCount: 0 },
    });
    SourceQueryMetrics.attach(key, db);
  });
  afterEach(async () => {
    SourceQueryMetrics.detach(db);
    await db.destroy();
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.NC_DB_ANALYTICS_ENABLED;
    else process.env.NC_DB_ANALYTICS_ENABLED = previous;
  });
  it('observes real builder success/error events and excludes marked probes', async () => {
    const builder = db.raw('select ?', ['secret']);
    await builder;
    expect(builder.listenerCount('query')).toBe(0);
    await db.raw('select 1').queryContext({ ncAnalytics: true });
    (db.client as any)._query = async () => {
      throw new Error('private error');
    };
    await expect(db.raw('select 2')).rejects.toThrow();
    expect(SourceQueryMetrics.snapshot(key, 15).summary).toMatchObject({
      count: 2,
      errors: 1,
    });
    expect(SourceQueryMetrics.snapshot(key, 15).inFlight).toBe(0);
    expect(JSON.stringify(SourceQueryMetrics.snapshot(key, 15))).not.toContain(
      'private error',
    );
  });
  it('counts builder-only timeouts and removes terminal listeners', async () => {
    (db.client as any)._query = async (_connection, query) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { ...query, response: { rows: [] } };
    };
    const builder = db.raw('select 1').timeout(1);
    await expect(builder).rejects.toThrow(/timeout/i);
    expect(SourceQueryMetrics.snapshot(key, 15)).toMatchObject({
      inFlight: 0,
      summary: { count: 1, errors: 1 },
    });
    expect(builder.listenerCount('query-error')).toBe(0);
  });
  it('observes transaction queries and stops collecting when disposed', async () => {
    await db.transaction(async (trx) => {
      await trx.raw('select 1');
    });
    expect(SourceQueryMetrics.snapshot(key, 15).summary.count).toBe(1);
    SourceQueryMetrics.detach(db);
    expect(SourceQueryMetrics.snapshot(key, 15)).toBeNull();
    expect(db.listenerCount('start')).toBe(0);
  });
  it('counts postprocessing failures and excludes streaming operations without leaking correlations', async () => {
    db.client.config.postProcessResponse = () => {
      throw new Error('response conversion failed');
    };
    await expect(db.raw('select 1')).rejects.toThrow(
      'response conversion failed',
    );
    delete db.client.config.postProcessResponse;
    (db.client as any)._stream = async (_connection, _query, stream) => {
      stream.push({ value: 1 });
      stream.push(null);
    };
    const rows = [];
    for await (const row of db.raw('select 2').stream()) rows.push(row);
    expect(rows).toEqual([{ value: 1 }]);
    expect(SourceQueryMetrics.snapshot(key, 15)).toMatchObject({
      inFlight: 0,
      summary: { count: 1, errors: 1 },
    });
  });
  it('does not attach when disabled and bounds global sources', () => {
    const connections: EventEmitter[] = [];
    try {
      for (let i = 0; i < 60; i++) {
        const connection = new EventEmitter();
        connections.push(connection);
        SourceQueryMetrics.attach(`base:${i}`, connection);
      }
      expect(SourceQueryMetrics.snapshot('base:0', 15)).toBeNull();
      expect(connections[0].listenerCount('start')).toBe(0);
      expect(SourceQueryMetrics.snapshot('base:59', 15)).not.toBeNull();
      process.env.NC_DB_ANALYTICS_ENABLED = 'false';
      const ignored = new EventEmitter();
      SourceQueryMetrics.attach('disabled', ignored);
      expect(ignored.listenerCount('start')).toBe(0);
    } finally {
      connections.forEach((connection) =>
        SourceQueryMetrics.detach(connection),
      );
    }
  });
});
