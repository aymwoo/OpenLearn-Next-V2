/**
 * OpenLearn Platform Kernel - Platform Permission Framework Types (PI-012)
 * Infrastructure-level authorization for Platform capabilities, configuration, services, and lifecycle.
 * Strictly NOT for user RBAC or application permissions.
 */

export type PermissionCategory =
  | 'Platform'
  | 'Infrastructure'
  | 'Capability'
  | 'Configuration'
  | 'Lifecycle'
  | 'Reserved';

export type PermissionPolicy =
  | 'Allow'
  | 'Deny'
  | 'Default'
  | 'Inherited'
  | 'Reserved';

export interface PermissionDescriptor {
  readonly id: string;
  readonly name: string;
  readonly category: PermissionCategory;
  readonly description?: string;
  readonly defaultPolicy?: PermissionPolicy;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface PermissionResult {
  readonly allowed: boolean;
  readonly policy: PermissionPolicy;
  readonly reason?: string;
  readonly evaluatedAt: number;
}

export interface PermissionContext {
  readonly subject: string;
  readonly target: string;
  readonly permission: string;
  readonly source?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly timestamp: number;
  result?: PermissionResult;
}

export interface IPermissionProvider {
  readonly id: string;
  getPolicy(subject: string, permission: string): Promise<PermissionPolicy | undefined> | PermissionPolicy | undefined;
}
