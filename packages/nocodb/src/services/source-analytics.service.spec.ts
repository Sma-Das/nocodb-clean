jest.mock('~/models', () => ({
  Source: { get: jest.fn() },
  Model: { list: jest.fn() },
}));
jest.mock('~/helpers/catchError', () => ({
  NcError: {
    badRequest: () => {
      throw new Error('bad request');
    },
    sourceNotFound: () => {
      throw new Error('source not found');
    },
  },
}));
jest.mock('~/utils/common/NcConnectionMgrv2', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));
jest.mock('~/utils/source-query-metrics', () => ({
  SourceQueryMetrics: { enabled: true, snapshot: jest.fn(() => null) },
}));
jest.mock('~/utils/source-health', () => ({ readSourceHealth: jest.fn() }));
import { SourceAnalyticsService } from './source-analytics.service';
import { Model, Source } from '~/models';
import NcConnectionMgrv2 from '~/utils/common/NcConnectionMgrv2';
import { SourceQueryMetrics } from '~/utils/source-query-metrics';
import { readSourceHealth } from '~/utils/source-health';

const context = { base_id: 'base-a', workspace_id: 'workspace-a' } as any;
let source: any;
let service: SourceAnalyticsService;
beforeEach(() => {
  jest.clearAllMocks();
  (SourceQueryMetrics as any).enabled = true;
  source = {
    id: 'source',
    base_id: 'base-a',
    enabled: true,
    isMeta: () => false,
    getConnectionConfig: jest.fn(async () => ({
      client: 'pg',
      searchPath: 'analytics',
    })),
  };
  (Source.get as jest.Mock).mockImplementation(async () => source);
  (Model.list as jest.Mock).mockResolvedValue([
    { type: 'table', table_name: 'orders' },
    { type: 'view', table_name: 'private_view' },
  ]);
  (NcConnectionMgrv2.get as jest.Mock).mockResolvedValue({
    client: {
      pool: { numUsed: () => 1, numFree: () => 2, numPendingAcquires: () => 3 },
    },
  });
  (readSourceHealth as jest.Mock).mockResolvedValue({
    status: 'available',
    checkedAt: 1,
    tables: [],
  });
  service = new SourceAnalyticsService();
});

it('rejects invalid time ranges and foreign-base sources before using connections', async () => {
  await expect(service.get(context, 'source', 600)).rejects.toThrow(
    'bad request',
  );
  source.base_id = 'base-b';
  await expect(service.get(context, 'source', 15)).rejects.toThrow(
    'source not found',
  );
  expect(NcConnectionMgrv2.get).not.toHaveBeenCalled();
});

it.each(['internal', 'disabled', 'collection-off'])(
  'does not probe %s sources',
  async (mode) => {
    if (mode === 'internal') source.isMeta = () => true;
    if (mode === 'disabled') source.enabled = false;
    if (mode === 'collection-off') (SourceQueryMetrics as any).enabled = false;
    expect((await service.get(context, 'source', 15)).metrics).toBeNull();
    expect(NcConnectionMgrv2.get).not.toHaveBeenCalled();
  },
);

it('single-flights health per physical pool, binds schema and only includes mapped tables', async () => {
  const [a, b] = await Promise.all([
    service.get(context, 'source', 15),
    service.get(context, 'source', 5),
  ]);
  expect(readSourceHealth).toHaveBeenCalledTimes(1);
  expect((readSourceHealth as jest.Mock).mock.calls[0].slice(1)).toEqual([
    'pg',
    'analytics',
    ['orders'],
  ]);
  expect(Model.list).toHaveBeenCalledWith(context, {
    base_id: 'base-a',
    source_id: 'source',
  });
  expect(SourceQueryMetrics.snapshot).toHaveBeenCalledWith('base-a:source', 15);
  expect(a.pool).toEqual({ used: 1, free: 2, pending: 3 });
  expect(a.health).toBe(b.health);
});

it('returns query/pool metrics at the deadline without starting overlapping stuck health probes', async () => {
  jest.useFakeTimers();
  try {
    let finish;
    (readSourceHealth as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const request = service.get(context, 'source', 15);
    await jest.advanceTimersByTimeAsync(3000);
    expect((await request).health.status).toBe('unavailable');
    await jest.advanceTimersByTimeAsync(20_000);
    expect((await service.get(context, 'source', 15)).pool.pending).toBe(3);
    expect(readSourceHealth).toHaveBeenCalledTimes(1);
    finish({ status: 'available', checkedAt: Date.now(), tables: [] });
    await jest.advanceTimersByTimeAsync(0);
    expect((await service.get(context, 'source', 15)).health.status).toBe(
      'available',
    );
  } finally {
    jest.useRealTimers();
  }
});

it('does not add health probes to a saturated pool', async () => {
  (NcConnectionMgrv2.get as jest.Mock).mockResolvedValue({
    client: {
      pool: {
        numUsed: () => 10,
        numFree: () => 0,
        numPendingAcquires: () => 2,
        max: 10,
      },
    },
  });
  const result = await service.get(context, 'source', 15);
  expect(result.pool.pending).toBe(2);
  expect(result.health.status).toBe('unavailable');
  expect(readSourceHealth).not.toHaveBeenCalled();
});
