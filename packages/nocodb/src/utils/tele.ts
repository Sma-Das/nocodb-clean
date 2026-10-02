import { machineIdSync } from 'node-machine-id';

// Instrumentation remains callable, with no collection, timers, or network traffic.
class Tele {
  static emit(_event: string, _data?: any) {}

  static init(_config: Record<string, any>) {}

  static page(_args: Record<string, any>) {}

  static event(_args: Record<string, any>) {}

  // The server ID is persisted by Noco independently of telemetry.
  static get id() {
    return machineIdSync();
  }

  static async payload() {
    return null;
  }
}

export { Tele };
