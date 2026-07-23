/**
 * OpenLearn Capability Governance - Health Monitor
 * Tracks invocation count, success rate, latency, error rate, and provider usage stats.
 */

import { CapabilityHealthMetrics } from '../types/index.js';

export class HealthMonitor {
  private metrics = new Map<string, {
    invocationCount: number;
    successCount: number;
    failureCount: number;
    totalLatencyMs: number;
    providerUsage: Map<string, number>;
  }>();

  public recordInvocation(
    capabilityId: string,
    success: boolean,
    latencyMs: number,
    providerId = 'default'
  ): void {
    if (!this.metrics.has(capabilityId)) {
      this.metrics.set(capabilityId, {
        invocationCount: 0,
        successCount: 0,
        failureCount: 0,
        totalLatencyMs: 0,
        providerUsage: new Map(),
      });
    }

    const m = this.metrics.get(capabilityId)!;
    m.invocationCount++;
    if (success) m.successCount++;
    else m.failureCount++;
    m.totalLatencyMs += latencyMs;

    const currentUsage = m.providerUsage.get(providerId) || 0;
    m.providerUsage.set(providerId, currentUsage + 1);
  }

  public getMetrics(capabilityId: string): CapabilityHealthMetrics | undefined {
    const m = this.metrics.get(capabilityId);
    if (!m) return undefined;

    const successRate = m.invocationCount > 0 ? (m.successCount / m.invocationCount) * 100 : 100;
    const errorRate = m.invocationCount > 0 ? (m.failureCount / m.invocationCount) * 100 : 0;
    const averageLatencyMs = m.invocationCount > 0 ? Math.round(m.totalLatencyMs / m.invocationCount) : 0;

    const providerUsageRecord: Record<string, number> = {};
    for (const [k, v] of m.providerUsage.entries()) {
      providerUsageRecord[k] = v;
    }

    return Object.freeze({
      capabilityId,
      invocationCount: m.invocationCount,
      successCount: m.successCount,
      failureCount: m.failureCount,
      totalLatencyMs: m.totalLatencyMs,
      averageLatencyMs,
      successRate: Math.round(successRate * 100) / 100,
      errorRate: Math.round(errorRate * 100) / 100,
      providerUsage: Object.freeze(providerUsageRecord),
    });
  }

  public clear(): void {
    this.metrics.clear();
  }
}
