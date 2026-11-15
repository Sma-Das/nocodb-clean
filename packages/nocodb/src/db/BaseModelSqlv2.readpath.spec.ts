// Unit tests for avoidable work on the row read path (execAndParse,
// conversions, selectObject view-column resolution, getProto).
//
// The full Nest app graph is not needed here: stub the app bootstrap and the
// ESM-only dependencies so BaseModelSqlv2 can be loaded in isolation.
jest.mock(
  '@noco-local-integrations/core',
  () =>
    new Proxy(
      {},
      {
        get: (_t, k) => (k === '__esModule' ? true : function Stub() {}),
      },
    ),
  { virtual: true },
);
jest.mock('~/Noco', () => ({
  __esModule: true,
  default: { ncMeta: {}, getConfig: () => ({}) },
}));
jest.mock('request-filtering-agent', () => ({}));
jest.mock('nanoid', () => ({
  nanoid: () => 'id',
  customAlphabet: () => () => 'id',
}));

import knex from 'knex';
import { UITypes } from 'nocodb-sdk';
import type { Knex } from 'knex';
import { BaseModelSqlv2 } from '~/db/BaseModelSqlv2';
import {
  buildSuppliedColumnMap,
  selectObject,
} from '~/db/BaseModelSqlv2/select-object';
import { BaseUser, Column, PresignedUrl, View } from '~/models';
import { setModelContext } from '~/helpers/modelContext';

const context: any = { workspace_id: 'w1', base_id: 'b1' };

function col(data: Record<string, any>): Column {
  const c = new Column({ base_id: 'b1', fk_model_id: 'm1', ...data } as any);
  return setModelContext(c, context);
}

function sqliteDriver(): Knex & { clientType: () => string } {
  const db: any = knex({
    client: 'sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  db.clientType = () => 'sqlite3';
  db.applyCte = () => undefined;
  return db;
}

function makeBaseModel(
  columns: Column[],
  dbDriver: any = sqliteDriver(),
  ctx: any = context,
) {
  const model: any = {
    id: 'm1',
    base_id: 'b1',
    table_name: 't',
    columns,
    getColumns: jest.fn(async () => columns),
  };
  return new BaseModelSqlv2({ dbDriver, model, context: ctx }) as any;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('execAndParse lookup alias discovery (B2)', () => {
  let db: any;
  beforeAll(async () => {
    db = sqliteDriver();
    await db.schema.createTable('t', (t) => {
      t.increments('id');
      t.string('title');
    });
    await db('t').insert([{ title: 'a' }, { title: 'b' }]);
  });
  afterAll(async () => {
    await db.destroy();
  });

  const lookups = () => [
    col({ id: 'lk1', title: 'L1', uidt: UITypes.Lookup }),
    col({ id: 'lk2', title: 'L2', uidt: UITypes.Lookup }),
  ];

  it('raw count never resolves lookup chains', async () => {
    const baseModel = makeBaseModel(
      [col({ id: 'id', title: 'Id', uidt: UITypes.ID }), ...lookups()],
      db,
    );
    const spy = jest
      .spyOn(baseModel, 'getNestedColumn')
      .mockRejectedValue(new Error('orphan lookup'));

    const res = await baseModel.execAndParse(
      'select count(*) as count from t',
      null,
      { raw: true, first: true },
    );

    expect(res.count).toBe(2);
    expect(spy).not.toHaveBeenCalled();
  });

  it('normal reads resolve each lookup once across all conversion steps', async () => {
    const baseModel = makeBaseModel(
      [
        col({ id: 'id', title: 'Id', uidt: UITypes.ID }),
        col({ id: 'title', title: 'Title', uidt: UITypes.SingleLineText }),
        ...lookups(),
      ],
      db,
    );
    const spy = jest
      .spyOn(baseModel, 'getNestedColumn')
      .mockResolvedValue({ uidt: UITypes.SingleLineText });

    const rows = await baseModel.execAndParse(
      'select id, title, title as lk1 from t order by id',
    );

    // substitution still happens (ids -> titles)
    expect(rows).toEqual([
      { Id: 1, Title: 'a', L1: 'a' },
      { Id: 2, Title: 'b', L1: 'b' },
    ]);
    // alias discovery, attachment, user (lk1 only has values), json and
    // substitution all share one resolution per lookup column
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls.map(([c]: any[]) => c.id).sort()).toEqual([
      'lk1',
      'lk2',
    ]);
  });

  it('bulk aggregate keeps alias discovery and nested-object substitution', async () => {
    const baseModel = makeBaseModel(
      [
        col({ id: 'title', title: 'Title', uidt: UITypes.SingleLineText }),
        ...lookups(),
      ],
      db,
    );
    const spy = jest
      .spyOn(baseModel, 'getNestedColumn')
      .mockResolvedValue({ uidt: UITypes.SingleLineText });

    const res = await baseModel.execAndParse(
      `select 3 as total, '{"title":"x"}' as nested`,
      null,
      { bulkAggregate: true, first: true },
    );

    expect(res).toEqual({ total: 3, nested: { Title: 'x' } });
    expect(spy).toHaveBeenCalled();
    // memoized: never more than once per lookup column
    expect(new Set(spy.mock.calls.map(([c]: any[]) => c)).size).toBe(
      spy.mock.calls.length,
    );
  });

  it('skipSubstitutingColumnIds reads skip alias discovery but still convert', async () => {
    const baseModel = makeBaseModel(
      [
        col({ id: 'title', title: 'Title', uidt: UITypes.SingleLineText }),
        ...lookups(),
      ],
      db,
    );
    const spy = jest
      .spyOn(baseModel, 'getNestedColumn')
      .mockResolvedValue({ uidt: UITypes.SingleLineText });

    const rows = await baseModel.execAndParse(
      'select title from t order by id',
      undefined,
      { skipSubstitutingColumnIds: true },
    );

    expect(rows).toEqual([{ title: 'a' }, { title: 'b' }]);
    // only the attachment/json lookup type checks remain (one each, memoized)
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('convertUserFormat narrowing (B4)', () => {
  const users = [
    {
      id: 'usr1',
      email: 'one@example.com',
      display_name: 'One',
      meta: { icon: 'i', iconType: 'x', other: 1 },
    },
    { id: 'usr2', email: 'two@example.com', display_name: '', meta: null },
  ];

  function setup(ctx: any = context) {
    const columns = [
      col({ id: 'title', title: 'Title', uidt: UITypes.SingleLineText }),
      col({ id: 'cb', title: 'CreatedBy', uidt: UITypes.CreatedBy }),
      col({ id: 'lk', title: 'LookupUser', uidt: UITypes.Lookup }),
    ];
    const baseModel = makeBaseModel(columns, sqliteDriver(), ctx);
    const nested = jest
      .spyOn(baseModel, 'getNestedColumn')
      .mockResolvedValue({ uidt: UITypes.User });
    const getUsers = jest
      .spyOn(BaseUser, 'getUsersList')
      .mockResolvedValue(users.map((u) => ({ ...u })) as any);
    const sign = jest
      .spyOn(PresignedUrl, 'signMetaIconImage')
      .mockResolvedValue(undefined as any);
    return { baseModel, nested, getUsers, sign };
  }

  it('returns an empty page without loading collaborators', async () => {
    const { baseModel, nested, getUsers, sign } = setup();
    expect(await baseModel.convertUserFormat([])).toEqual([]);
    expect(getUsers).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
    expect(nested).not.toHaveBeenCalled();
  });

  it('skips collaborator loading when no returned field carries user values', async () => {
    const { baseModel, nested, getUsers, sign } = setup();
    const rows = [{ title: 'a' }, { title: 'b', cb: null, lk: '' }];
    expect(await baseModel.convertUserFormat(rows)).toEqual(rows);
    expect(getUsers).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
    expect(nested).not.toHaveBeenCalled();
  });

  it('converts values that only appear in the last row, incl. lookups', async () => {
    const { baseModel, nested, getUsers } = setup();
    const rows = [
      { title: 'a' },
      { title: 'b', cb: null },
      { title: 'c', cb: 'usr1', lk: '["usr1","usr2"]' },
    ];
    const res = await baseModel.convertUserFormat(rows);
    expect(getUsers).toHaveBeenCalledTimes(1);
    expect(nested).toHaveBeenCalledTimes(1);
    expect(res[0]).toEqual({ title: 'a' });
    expect(res[2].cb).toEqual({
      id: 'usr1',
      email: 'one@example.com',
      display_name: 'One',
      meta: { icon: 'i', iconType: 'x' },
    });
    expect(res[2].lk.map((u: any) => u.id)).toEqual(['usr1', 'usr2']);
    expect(res[2].lk[1].display_name).toBeNull();
  });

  it('still redacts emails for public viewers', async () => {
    const { baseModel } = setup({ ...context, is_public: true });
    const res = await baseModel.convertUserFormat([
      { title: 'a' },
      { title: 'b', lk: 'usr1' },
    ]);
    expect(res[1].lk[0].email).toBe('');
    expect(res[1].lk[0].display_name).toBeTruthy();
  });

  it('handles a single (non-array) record', async () => {
    const { baseModel, getUsers } = setup();
    const res = await baseModel.convertUserFormat({ title: 'a', cb: 'usr2' });
    expect(getUsers).toHaveBeenCalledTimes(1);
    expect(res.cb.id).toBe('usr2');
    expect(await baseModel.convertUserFormat({ title: 'a' })).toEqual({
      title: 'a',
    });
    expect(getUsers).toHaveBeenCalledTimes(1);
  });
});

describe('convertDateFormat batch state (B5)', () => {
  const originalTz = process.env.TZ;
  afterAll(() => {
    process.env.TZ = originalTz;
  });

  const columns = () => [
    col({ id: 'dt', title: 'DT', uidt: UITypes.DateTime }),
    col({ id: 'd', title: 'D', uidt: UITypes.Date }),
    col({ id: 'f', title: 'F', uidt: UITypes.Formula }),
  ];

  const rows = () => [
    {
      dt: '2023-04-27 10:00:00+05:30',
      d: '2023-04-27',
      f: '2023-04-27 10:00:00',
    },
    { dt: '10:00:00', d: null, f: 'x 2023-01-01T05:30:00.000Z y' },
    { dt: null, d: '2023-12-31', f: '2023-03-26 02:30:00+01:00 and more' },
    { dt: '2023-10-29 01:30:00', f: 42 },
  ];

  it.each(['UTC', 'America/New_York', 'Asia/Kolkata'])(
    'matches per-row conversion and resolves the timezone once (%s)',
    (tz) => {
      process.env.TZ = tz;
      const baseModel = makeBaseModel(columns());
      const dateTimeColumns = baseModel.model.columns;

      const expected = rows().map((r) =>
        baseModel._convertDateFormat(dateTimeColumns, r),
      );

      const intlSpy = jest.spyOn(Intl, 'DateTimeFormat');
      const actual = baseModel.convertDateFormat(rows());
      expect(intlSpy).toHaveBeenCalledTimes(1);

      expect(actual).toEqual(expected);
      // run twice: reused global regexes must not leak lastIndex state
      expect(baseModel.convertDateFormat(rows())).toEqual(expected);
      // explicit offsets are timezone independent
      expect(actual[0].dt).toBe('2023-04-27 04:30:00+00:00');
      expect(actual[0].d).toBe('2023-04-27');
    },
  );

  it('does not resolve a timezone for non-SQLite clients', () => {
    const driver: any = sqliteDriver();
    driver.clientType = () => 'pg';
    const baseModel = makeBaseModel(columns(), driver);
    const intlSpy = jest.spyOn(Intl, 'DateTimeFormat');
    const res = baseModel.convertDateFormat([
      { dt: '2023-05-11 16:16:51+08:00' },
    ]);
    expect(intlSpy).not.toHaveBeenCalled();
    expect(res[0].dt).toBe('2023-05-11 08:16:51+00:00');
  });
});

describe('selectObject view column resolution (B3)', () => {
  function setup(viewColumns: any[], supplied: Column[]) {
    const db = sqliteDriver();
    const baseModel: any = {
      context,
      dbDriver: db,
      tnPath: 't',
      isPg: false,
      isMssql: false,
      isMySQL: false,
      isOracle: false,
      isSqlite: true,
      model: {
        table_name: 't',
        getColumns: jest.fn(async () => supplied),
      },
    };
    jest
      .spyOn(View, 'get')
      .mockResolvedValue({ id: 'v1', show_system_fields: false } as any);
    jest.spyOn(View, 'getColumns').mockResolvedValue(viewColumns as any);
    const missing = col({
      id: 'cMissing',
      title: 'Missing',
      column_name: 'missing_col',
      uidt: UITypes.SingleLineText,
    });
    const columnGet = jest
      .spyOn(Column, 'get')
      .mockImplementation(
        async (_ctx: any, { colId }: any): Promise<any> =>
          colId === 'cMissing' ? missing : null,
      );
    const qb = db('t');
    return { db, baseModel, qb, columnGet };
  }

  const supplied = () => [
    col({
      id: 'c1',
      title: 'Title',
      column_name: 'title',
      uidt: UITypes.SingleLineText,
    }),
    col({
      id: 'c2',
      title: 'Hidden',
      column_name: 'hidden',
      uidt: UITypes.SingleLineText,
    }),
    col({
      id: 'c3',
      title: 'Name',
      column_name: 'name',
      uidt: UITypes.SingleLineText,
    }),
    col({
      id: 'cDel',
      title: 'Gone',
      column_name: 'gone',
      uidt: UITypes.SingleLineText,
      deleted: true,
    }),
  ];

  it('uses supplied hydrated columns, keeps view order and visibility, falls back for missing ids', async () => {
    const viewColumns = [
      { fk_column_id: 'c3', show: true },
      { fk_column_id: 'c1', show: true },
      { fk_column_id: 'c2', show: false },
      { fk_column_id: 'cMissing', show: true },
      { fk_column_id: 'cDel', show: true },
      { fk_column_id: 'cUnknown', show: true },
    ];
    const { db, baseModel, qb, columnGet } = setup(viewColumns, supplied());

    await selectObject(baseModel, { warn: jest.fn(), log: jest.fn() } as any)({
      qb,
      viewId: 'v1',
      columns: supplied(),
    });

    expect(qb.toQuery()).toBe(
      'select `t`.`name` as `c3`, `t`.`title` as `c1`, `t`.`missing_col` as `cMissing` from `t`',
    );
    expect(columnGet.mock.calls.map(([, a]: any[]) => a.colId)).toEqual([
      'cMissing',
      'cDel',
      'cUnknown',
    ]);
    await db.destroy();
  });

  it('falls back to Column.get for every view column when none are supplied', async () => {
    const viewColumns = [{ fk_column_id: 'cMissing', show: true }];
    const { db, baseModel, qb, columnGet } = setup(viewColumns, supplied());
    await selectObject(baseModel, { warn: jest.fn(), log: jest.fn() } as any)({
      qb,
      viewId: 'v1',
    });
    expect(qb.toQuery()).toBe(
      'select `t`.`missing_col` as `cMissing` from `t`',
    );
    expect(columnGet).toHaveBeenCalledTimes(1);
    await db.destroy();
  });

  it('buildSuppliedColumnMap ignores deleted and non-Column entries', () => {
    const map = buildSuppliedColumnMap([...supplied(), { id: 'plain' } as any]);
    expect([...map.keys()]).toEqual(['c1', 'c2', 'c3']);
    expect(buildSuppliedColumnMap(undefined).size).toBe(0);
  });
});

describe('getProto column reuse (B6)', () => {
  it('uses supplied columns and resolves the lookup relation column from them', async () => {
    const relOptions: any = {
      type: 'bt',
      getRelContext: () => ({ refContext: context, mmContext: context }),
    };
    const relCol = col({
      id: 'rel',
      title: 'Parent',
      uidt: UITypes.LinkToAnotherRecord,
    });
    (relCol as any).colOptions = relOptions;
    relCol.getColOptions = jest.fn(async () => relOptions) as any;
    const lookup = col({ id: 'lk', title: 'ParentName', uidt: UITypes.Lookup });
    lookup.getColOptions = jest.fn(async () => ({
      fk_relation_column_id: 'rel',
      fk_lookup_column_id: 'remote',
    })) as any;
    const columns = [relCol, lookup];
    const baseModel = makeBaseModel(columns);
    const columnGet = jest
      .spyOn(Column, 'get')
      .mockImplementation(
        async (_ctx: any, { colId }: any): Promise<any> =>
          colId === 'remote' ? col({ id: 'remote', title: 'Name' }) : null,
      );

    const proto = await baseModel.getProto({ columns });

    expect(baseModel.model.getColumns).not.toHaveBeenCalled();
    const requested = columnGet.mock.calls.map(([, a]: any[]) => a.colId);
    // the relation column comes from the supplied list, only the remote
    // lookup target (another model) is fetched
    expect(requested).toContain('remote');
    expect(requested).not.toContain('rel');
    expect(proto.__columnAliases).toEqual({
      ParentName: { path: ['Parent', 'Name'] },
    });
  });
});
