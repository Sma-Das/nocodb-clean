import { Injectable } from '@nestjs/common';

// Preserve injected callers without collecting payloads or sending events.
@Injectable()
export class TelemetryService {
  public sendEvent(_payload: { evt_type: string; [key: string]: any }) {}

  public async sendSystemEvent(_payload: {
    event_type: string;
    [key: string]: any;
  }) {}
}
