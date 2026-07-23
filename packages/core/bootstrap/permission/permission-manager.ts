/**
 * OpenLearn Platform Kernel - Permission Manager (PI-012)
 * Central facade for infrastructure permission management.
 */

import {
  PermissionDescriptor,
  PermissionPolicy,
  PermissionContext,
  IPermissionProvider,
} from './permission-types.js';
import { PermissionRegistry } from './permission-registry.js';
import { PermissionEvaluator } from './permission-evaluator.js';

export class PermissionManager {
  private registry = new PermissionRegistry();
  private grants = new Map<string, PermissionPolicy>();
  private providers: IPermissionProvider[] = [];

  public register(descriptor: PermissionDescriptor): void {
    this.registry.register(descriptor);
  }

  public unregister(permissionId: string): boolean {
    return this.registry.unregister(permissionId);
  }

  public grant(subject: string, permissionId: string, policy: PermissionPolicy = 'Allow'): void {
    const key = `${subject}::${permissionId}`;
    this.grants.set(key, policy);
  }

  public revoke(subject: string, permissionId: string): void {
    const key = `${subject}::${permissionId}`;
    this.grants.delete(key);
  }

  public addProvider(provider: IPermissionProvider): void {
    if (!this.providers.some((p) => p.id === provider.id)) {
      this.providers.push(provider);
    }
  }

  public removeProvider(providerId: string): void {
    this.providers = this.providers.filter((p) => p.id !== providerId);
  }

  public exists(permissionId: string): boolean {
    return this.registry.exists(permissionId);
  }

  public list(): ReadonlyArray<PermissionDescriptor> {
    return this.registry.list();
  }

  public async check(
    subject: string,
    target: string,
    permissionId: string,
    metadata?: Readonly<Record<string, unknown>>
  ): Promise<PermissionContext> {
    const timestamp = Date.now();
    const descriptor = this.registry.get(permissionId);

    const result = await PermissionEvaluator.evaluate(
      subject,
      permissionId,
      this.grants,
      descriptor,
      this.providers
    );

    const context: PermissionContext = {
      subject,
      target,
      permission: permissionId,
      metadata,
      timestamp,
      result,
    };

    return context;
  }

  public async require(
    subject: string,
    target: string,
    permissionId: string,
    metadata?: Readonly<Record<string, unknown>>
  ): Promise<PermissionContext> {
    const context = await this.check(subject, target, permissionId, metadata);
    if (!context.result || !context.result.allowed) {
      const reason = context.result?.reason || 'Permission Denied';
      throw new Error(
        `Infrastructure Permission Exception: Subject '${subject}' is denied '${permissionId}' on target '${target}'. Reason: ${reason}`
      );
    }
    return context;
  }

  public clear(): void {
    this.registry.clear();
    this.grants.clear();
    this.providers = [];
  }
}
