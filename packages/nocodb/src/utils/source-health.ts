import type { Knex } from 'knex';

export type SourceHealth = {
  status: 'available' | 'unavailable' | 'unsupported';
  checkedAt: number;
  storageBytes?: number;
  connections?: number;
  activeConnections?: number;
  tables: {
    name: string;
    estimatedRows: number;
    deadRows?: number;
    bytes: number;
    lastAnalyze?: string;
  }[];
};

/** Fixed, read-only catalog queries. User input is always bound, never SQL. */
export async function readSourceHealth(
  knex: Knex,
  client: string,
  schema: string,
  tableNames: string[],
): Promise<SourceHealth> {
  const checkedAt = Date.now();
  const names = [...new Set(tableNames)].slice(0, 500);
  const raw = (sql: string, bindings: any[] = []) =>
    knex.raw(sql, bindings).queryContext({ ncAnalytics: true }).timeout(3000);
  try {
    if (client === 'pg') {
      const [database, tables] = await Promise.all([
        raw(`SELECT pg_database_size(current_database()) AS bytes,
          numbackends AS connections,
          (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'active') AS active
          FROM pg_stat_database WHERE datname = current_database()`),
        names.length
          ? raw(
              `SELECT relname AS name, n_live_tup AS estimated_rows, n_dead_tup AS dead,
              pg_total_relation_size(relid) AS bytes,
              GREATEST(last_analyze, last_autoanalyze) AS last_analyze
              FROM pg_stat_user_tables
              WHERE schemaname = ? AND relname = ANY(?::text[])
              ORDER BY pg_total_relation_size(relid) DESC LIMIT 50`,
              [schema || 'public', names],
            )
          : Promise.resolve({ rows: [] }),
      ]);
      const db = database.rows[0];
      return {
        status: 'available',
        checkedAt,
        storageBytes: db ? Number(db.bytes) : undefined,
        connections: db ? Number(db.connections) : undefined,
        activeConnections: db ? Number(db.active) : undefined,
        tables: tables.rows.map((row) => ({
          name: row.name,
          estimatedRows: Number(row.estimated_rows),
          deadRows: Number(row.dead),
          bytes: Number(row.bytes),
          lastAnalyze: row.last_analyze,
        })),
      };
    }
    if (['mysql', 'mysql2'].includes(client)) {
      // TABLE_ROWS is an estimate for InnoDB. Do not COUNT(*) application tables.
      const [tables] = names.length
        ? await raw(
            `SELECT TABLE_NAME AS name, TABLE_ROWS AS estimated_rows,
            COALESCE(DATA_LENGTH, 0) + COALESCE(INDEX_LENGTH, 0) AS bytes
            FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME IN (${names.map(() => '?').join(',')})
            ORDER BY bytes DESC LIMIT 50`,
            names,
          )
        : [[]];
      return {
        status: 'available',
        checkedAt,
        tables: tables.map((row) => ({
          name: row.name,
          estimatedRows: Number(row.estimated_rows || 0),
          bytes: Number(row.bytes),
        })),
      };
    }
    if (client === 'sqlite3') {
      const [pages, size] = await Promise.all([
        raw('PRAGMA page_count'),
        raw('PRAGMA page_size'),
      ]);
      return {
        status: 'available',
        checkedAt,
        storageBytes: Number(pages[0].page_count) * Number(size[0].page_size),
        tables: [],
      };
    }
    return { status: 'unsupported', checkedAt, tables: [] };
  } catch {
    // Driver errors may contain SQL, paths, or connection details.
    return { status: 'unavailable', checkedAt, tables: [] };
  }
}
