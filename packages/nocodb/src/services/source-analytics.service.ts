import { Injectable } from '@nestjs/common';
import type { NcContext, SourceAnalyticsResponse } from 'nocodb-sdk';
import { Model, Source } from '~/models';
import { NcError } from '~/helpers/catchError';
import NcConnectionMgrv2 from '~/utils/common/NcConnectionMgrv2';
import { SourceQueryMetrics } from '~/utils/source-query-metrics';
import { readSourceHealth } from '~/utils/source-health';

@Injectable()
export class SourceAnalyticsService {
  private healthCache = new WeakMap<
    object,
    { at: number; value: ReturnType<typeof readSourceHealth> }
  >();

  async get(
    context: NcContext,
    sourceId: string,
    minutes: number,
  ): Promise<SourceAnalyticsResponse> {
    if (![5, 15, 60].includes(minutes))
      NcError.badRequest('Choose a 5, 15, or 60 minute time range');
    const source = await Source.get(context, sourceId);
    if (!source || source.base_id !== context.base_id)
      NcError.sourceNotFound(sourceId);
    // Internal/default sources can share a physical pool across unrelated bases.
    const supported = !(source.isMeta() || source.is_local || source.is_meta);
    const enabled = SourceQueryMetrics.enabled;
    if (!enabled || !supported || !source.enabled) {
      return {
        enabled,
        supported,
        sourceEnabled: !!source.enabled,
        metrics: null,
        pool: null,
        health: null,
      };
    }
    const knex = await NcConnectionMgrv2.get(source);
    const pool = knex.client.pool;
    const cached = this.healthCache.get(knex);
    if (!cached || Date.now() - cached.at >= 15_000) {
      const unavailable = () => ({
        status: 'unavailable' as const,
        checkedAt: Date.now(),
        tables: [],
      });
      const work = (async () => {
        // Analytics must not queue extra catalog work behind saturated user traffic.
        if (
          pool &&
          pool.numFree() === 0 &&
          (pool.numPendingAcquires() > 0 || pool.numUsed() > 0)
        )
          return unavailable();
        const config = await source.getConnectionConfig();
        const schema = Array.isArray(config.searchPath)
          ? config.searchPath[0]
          : config.searchPath;
        const models = await Model.list(context, {
          base_id: context.base_id,
          source_id: source.id,
        });
        return readSourceHealth(
          knex,
          config.client,
          schema || 'public',
          models
            .filter((model) => model.type === 'table')
            .map((model) => model.table_name),
        );
      })().catch(unavailable);
      let deadline: ReturnType<typeof setTimeout>;
      const entry = {
        // Keep the same probe while it is pending, even after its response deadline.
        at: Infinity,
        value: Promise.race([
          work,
          new Promise<Awaited<typeof work>>((resolve) => {
            deadline = setTimeout(() => resolve(unavailable()), 3000);
          }),
        ]),
      };
      this.healthCache.set(knex, entry);
      void work.then((result) => {
        clearTimeout(deadline);
        entry.at = Date.now();
        entry.value = Promise.resolve(result);
      });
    }
    return {
      enabled,
      supported,
      sourceEnabled: true,
      metrics: SourceQueryMetrics.snapshot(
        `${source.base_id}:${source.id}`,
        minutes,
      ),
      pool: pool
        ? {
            used: pool.numUsed(),
            free: pool.numFree(),
            pending: pool.numPendingAcquires(),
          }
        : null,
      health: await this.healthCache.get(knex).value,
    };
  }
}
