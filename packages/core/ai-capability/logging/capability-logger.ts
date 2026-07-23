/**
 * OpenLearn AI Capability Layer - Telemetry Logger
 * Logs Capability execution requests, responses, latency, provider IDs, tokens, and errors.
 */

import { CapabilityLogEntry } from '../types/index.js';

export class CapabilityLogger {
  private logs: CapabilityLogEntry[] = [];

  public log(entry: CapabilityLogEntry): void {
    this.logs.push(Object.freeze(entry));
  }

  public getLogs(capabilityId?: string): ReadonlyArray<CapabilityLogEntry> {
    if (capabilityId) {
      return Object.freeze(this.logs.filter((l) => l.capabilityId === capabilityId));
    }
    return Object.freeze([...this.logs]);
  }

  public clear(): void {
    this.logs = [];
  }
}
