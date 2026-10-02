import { debug } from 'debug';

export class NcDebug {
  private static logger: ReturnType<typeof debug>;

  static initLogger() {
    return (NcDebug.logger ??= debug('nc'));
  }

  static log(formatter: any, ...args: any[]) {
    if (debug.enabled('nc')) NcDebug.initLogger()(formatter, ...args);
  }
}
