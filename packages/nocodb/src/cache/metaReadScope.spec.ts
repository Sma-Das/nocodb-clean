import {
  bumpMetaWriteEpoch,
  isInMetaReadScope,
  memoizeInMetaReadScope,
  runWithMetaReadScope,
} from './metaReadScope';
import { runWithoutCache } from './cacheBypassScope';

describe('metaReadScope', () => {
  it('does not memoize outside a scope', async () => {
    const load = jest.fn(async () => ({ v: 1 }));
    await memoizeInMetaReadScope('k', load);
    await memoizeInMetaReadScope('k', load);
    expect(load).toHaveBeenCalledTimes(2);
    expect(isInMetaReadScope()).toBe(false);
  });

  it('shares one load for identical keys (incl. concurrent misses)', async () => {
    const load = jest.fn(async () => ({ v: 1 }));
    await runWithMetaReadScope(async () => {
      const [a, b] = await Promise.all([
        memoizeInMetaReadScope('k', load),
        memoizeInMetaReadScope('k', load),
      ]);
      const c = await memoizeInMetaReadScope('k', load);
      expect(a).toBe(b);
      expect(a).toBe(c);
    });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps distinct keys apart', async () => {
    const load = jest.fn(async () => ({}));
    await runWithMetaReadScope(async () => {
      await memoizeInMetaReadScope('a', load);
      await memoizeInMetaReadScope('b', load);
    });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('isolates concurrent scopes (no cross-request leakage)', async () => {
    let n = 0;
    const load = jest.fn(async () => ({ n: ++n }));
    const [r1, r2] = await Promise.all([
      runWithMetaReadScope(() => memoizeInMetaReadScope('k', load)),
      runWithMetaReadScope(() => memoizeInMetaReadScope('k', load)),
    ]);
    expect(load).toHaveBeenCalledTimes(2);
    expect(r1).not.toBe(r2);
    // and nothing survives the scope
    await memoizeInMetaReadScope('k', load);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('reloads after a metadata write bumps the epoch', async () => {
    const load = jest.fn(async () => ({}));
    await runWithMetaReadScope(async () => {
      await memoizeInMetaReadScope('k', load);
      bumpMetaWriteEpoch();
      await memoizeInMetaReadScope('k', load);
      await memoizeInMetaReadScope('k', load);
    });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('expires entries after the max age', async () => {
    const load = jest.fn(async () => ({}));
    const now = jest.spyOn(Date, 'now');
    try {
      now.mockReturnValue(1_000);
      await runWithMetaReadScope(async () => {
        await memoizeInMetaReadScope('k', load);
        now.mockReturnValue(1_000 + 6_000);
        await memoizeInMetaReadScope('k', load);
      });
    } finally {
      now.mockRestore();
    }
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('is disabled while the cache is bypassed (transactions)', async () => {
    const load = jest.fn(async () => ({}));
    await runWithMetaReadScope(() =>
      runWithoutCache(async () => {
        await memoizeInMetaReadScope('k', load);
        await memoizeInMetaReadScope('k', load);
      }),
    );
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not memoize failures', async () => {
    const load = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ ok: true });
    await runWithMetaReadScope(async () => {
      await expect(memoizeInMetaReadScope('k', load)).rejects.toThrow('boom');
      await expect(memoizeInMetaReadScope('k', load)).resolves.toEqual({
        ok: true,
      });
    });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('nested scopes reuse the outer memo', async () => {
    const load = jest.fn(async () => ({}));
    await runWithMetaReadScope(async () => {
      await memoizeInMetaReadScope('k', load);
      await runWithMetaReadScope(() => memoizeInMetaReadScope('k', load));
    });
    expect(load).toHaveBeenCalledTimes(1);
  });
});
