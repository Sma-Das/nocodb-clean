import { readSourceHealth } from './source-health';

function connection(responses: any[]) {
  const contexts = [];
  const timeouts = [];
  const raw = jest.fn((_sql: string, _bindings: any[]) => ({
    queryContext(context) {
      contexts.push(context);
      return this;
    },
    timeout(ms) {
      timeouts.push(ms);
      const result = responses.shift();
      return result instanceof Error
        ? Promise.reject(result)
        : Promise.resolve(result);
    },
  }));
  return { knex: { raw } as any, raw, contexts, timeouts };
}

it('binds PostgreSQL schema/mapped tables and maps estimates, sizes and connections', async () => {
  const db = connection([
    { rows: [{ bytes: '1000', connections: 3, active: 1 }] },
    { rows: [{ name: 'orders', estimated_rows: '10', dead: 2, bytes: '100' }] },
  ]);
  const result = await readSourceHealth(db.knex, 'pg', 'private-schema', [
    'orders',
    'orders',
  ]);
  expect(result).toMatchObject({
    status: 'available',
    storageBytes: 1000,
    connections: 3,
    tables: [{ name: 'orders', estimatedRows: 10, deadRows: 2, bytes: 100 }],
  });
  expect(db.raw.mock.calls[1][1]).toEqual(['private-schema', ['orders']]);
  expect(db.contexts).toEqual([{ ncAnalytics: true }, { ncAnalytics: true }]);
  expect(db.timeouts).toEqual([3000, 3000]);
});

it('binds MySQL table names and never uses the reserved ROWS alias', async () => {
  const db = connection([
    [[{ name: 'orders', estimated_rows: '20', bytes: '500' }], []],
  ]);
  const result = await readSourceHealth(db.knex, 'mysql2', '', [
    "x'); DROP TABLE orders; --",
  ]);
  expect(result.tables[0]).toEqual({
    name: 'orders',
    estimatedRows: 20,
    bytes: 500,
  });
  expect(db.raw.mock.calls[0][0]).not.toContain('DROP TABLE');
  expect(db.raw.mock.calls[0][0]).not.toMatch(/AS rows\b/i);
  expect(db.raw.mock.calls[0][1]).toEqual(["x'); DROP TABLE orders; --"]);
});

it('reads SQLite page statistics without scanning application rows', async () => {
  const db = connection([[{ page_count: 10 }], [{ page_size: 4096 }]]);
  expect(await readSourceHealth(db.knex, 'sqlite3', '', [])).toMatchObject({
    status: 'available',
    storageBytes: 40960,
    tables: [],
  });
  expect(db.raw.mock.calls.map(([sql]) => sql)).toEqual([
    'PRAGMA page_count',
    'PRAGMA page_size',
  ]);
});

it('does not enumerate unregistered tables when a source has no mapped tables', async () => {
  const db = connection([{ rows: [] }]);
  expect((await readSourceHealth(db.knex, 'pg', 'public', [])).tables).toEqual(
    [],
  );
  expect(db.raw).toHaveBeenCalledTimes(1);
});

it('sanitizes catalog errors and explicitly reports unsupported engines', async () => {
  const db = connection([new Error('secret DSN and SQL')]);
  const failed = await readSourceHealth(db.knex, 'mysql2', '', ['orders']);
  expect(failed.status).toBe('unavailable');
  expect(JSON.stringify(failed)).not.toContain('secret');
  expect((await readSourceHealth(db.knex, 'mssql', '', [])).status).toBe(
    'unsupported',
  );
  expect(db.raw).toHaveBeenCalledTimes(1);
});
