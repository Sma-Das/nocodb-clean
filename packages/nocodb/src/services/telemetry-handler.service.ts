import type { NcContext } from '~/interface/config';

export class TelemetryHandlerService {
  static sendPriorityError(
    _context: NcContext,
    _param: {
      trigger: string;
      error_type?: string;
      message?: string;
      error_details?: string;
      affected_resources?: (string | undefined | null)[];
    },
  ) {}
}
