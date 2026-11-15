jest.mock('~/cache/NocoCache', () => ({
  __esModule: true,
  default: {
    getList: jest.fn(async () => ({ list: [], isNoneList: false })),
    setList: jest.fn(async () => true),
    get: jest.fn(async () => null),
    set: jest.fn(async () => true),
  },
}));

// keep the module graph light: no app bootstrap, no ESM-only deps
jest.mock('~/Noco', () => ({
  __esModule: true,
  default: {
    _ncMeta: null,
    get ncMeta() {
      return this._ncMeta;
    },
  },
}));
jest.mock('~/utils/ssrf', () => ({}));
// lazy barrel: avoids the models/index import cycle (and its unrelated
// integration deps) while still resolving real classes on access
jest.mock('~/models', () => {
  const lazy = (path: string) => () => require(path).default;
  const map = {
    ButtonColumn: lazy('~/models/ButtonColumn'),
    FileReference: lazy('~/models/FileReference'),
    LinksColumn: lazy('~/models/LinksColumn'),
    Source: lazy('~/models/Source'),
    Model: lazy('~/models/Model'),
    View: lazy('~/models/View'),
    Column: lazy('~/models/Column'),
  };
  return new Proxy(
    {},
    {
      get: (_t, key: string) => (map[key] ? map[key]() : undefined),
    },
  );
});
jest.mock('nanoid', () => ({
  customAlphabet: () => () => 'id',
  nanoid: () => 'id',
}));

import Column from '~/models/Column';
import Noco from '~/Noco';
import {
  bumpMetaWriteEpoch,
  runWithMetaReadScope,
} from '~/cache/metaReadScope';

const context = { workspace_id: 'ws1', base_id: 'base1' } as any;

const rows = () => [
  {
    id: 'c2',
    fk_model_id: 'm1',
    title: 'B',
    uidt: 'SingleLineText',
    order: 2,
    meta: '{}',
  },
  {
    id: 'c1',
    fk_model_id: 'm1',
    title: 'A',
    uidt: 'SingleLineText',
    order: 1,
    meta: '{}',
  },
  {
    id: 'c3',
    fk_model_id: 'm1',
    title: 'Gone',
    uidt: 'SingleLineText',
    order: 3,
    meta: '{}',
    deleted: true,
  },
];

describe('Column.list request-scoped memoization', () => {
  let metaList2: jest.Mock;
  let prevMeta: any;

  beforeEach(() => {
    prevMeta = Noco._ncMeta;
    metaList2 = jest.fn(async () => rows());
    Noco._ncMeta = { metaList2 } as any;
  });

  afterEach(() => {
    Noco._ncMeta = prevMeta;
  });

  it('loads once per scope for identical options (N calls -> 1 meta query)', async () => {
    await runWithMetaReadScope(async () => {
      const [a, b] = await Promise.all([
        Column.list(context, { fk_model_id: 'm1' }),
        Column.list(context, { fk_model_id: 'm1' }),
      ]);
      const c = await Column.list(context, { fk_model_id: 'm1' });
      expect(a.map((x) => x.id)).toEqual(['c1', 'c2']);
      // shared hydrated instances, but each caller gets its own array
      expect(a[0]).toBe(b[0]);
      expect(a).not.toBe(c);
      a.reverse();
      expect(c.map((x) => x.id)).toEqual(['c1', 'c2']);
    });
    expect(metaList2).toHaveBeenCalledTimes(1);
  });

  it('keeps includeDeleted / model variants isolated', async () => {
    await runWithMetaReadScope(async () => {
      const live = await Column.list(context, { fk_model_id: 'm1' });
      const all = await Column.list(context, {
        fk_model_id: 'm1',
        includeDeleted: true,
      });
      await Column.list(context, { fk_model_id: 'm2' });
      await Column.list(
        { ...context, base_id: 'base2' },
        { fk_model_id: 'm1' },
      );
      expect(live.map((x) => x.id)).toEqual(['c1', 'c2']);
      expect(all.map((x) => x.id)).toEqual(['c1', 'c2', 'c3']);
    });
    expect(metaList2).toHaveBeenCalledTimes(4);
  });

  it('is unchanged outside a scope and after a meta write', async () => {
    await Column.list(context, { fk_model_id: 'm1' });
    await Column.list(context, { fk_model_id: 'm1' });
    expect(metaList2).toHaveBeenCalledTimes(2);

    await runWithMetaReadScope(async () => {
      await Column.list(context, { fk_model_id: 'm1' });
      bumpMetaWriteEpoch();
      await Column.list(context, { fk_model_id: 'm1' });
    });
    expect(metaList2).toHaveBeenCalledTimes(4);
  });

  it('never memoizes a transaction-bound ncMeta', async () => {
    const trxMeta = { metaList2: jest.fn(async () => rows()) } as any;
    await runWithMetaReadScope(async () => {
      await Column.list(context, { fk_model_id: 'm1' }, trxMeta);
      await Column.list(context, { fk_model_id: 'm1' }, trxMeta);
    });
    expect(trxMeta.metaList2).toHaveBeenCalledTimes(2);
  });
});
