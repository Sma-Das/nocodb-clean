import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { GlobalGuard } from '~/guards/global/global.guard';
import { MetaApiLimiterGuard } from '~/guards/meta-api-limiter.guard';
import { Acl } from '~/middlewares/extract-ids/extract-ids.middleware';
import { TenantContext } from '~/decorators/tenant-context.decorator';
import { NcContext } from '~/interface/config';
import { SourceAnalyticsService } from '~/services/source-analytics.service';

@Controller()
@UseGuards(MetaApiLimiterGuard, GlobalGuard)
export class SourceAnalyticsController {
  constructor(private readonly analytics: SourceAnalyticsService) {}

  @Get('/api/v2/meta/bases/:baseId/sources/:sourceId/analytics')
  @Acl('sourceAnalytics')
  get(
    @TenantContext() context: NcContext,
    @Param('sourceId') sourceId: string,
    @Query('minutes') minutes = '15',
  ) {
    return this.analytics.get(context, sourceId, Number(minutes));
  }
}
