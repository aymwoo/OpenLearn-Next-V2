/**
 * OpenLearn Platform Kernel - Module Registry Types & Interfaces (Sprint A1)
 */

import { Version } from '../types/index.js';

export type ModuleStatus =
  | 'Unknown'
  | 'Registered'
  | 'Active'
  | 'Inactive'
  | 'Error';

export type ModuleCategory =
  | 'Core'
  | 'Runtime'
  | 'Infrastructure'
  | 'Feature'
  | 'Extension'
  | 'AI';

export interface ModuleHealth {
  readonly isHealthy: boolean;
  readonly status: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface PlatformModuleDescriptor {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly version: Version;
  readonly description: string;
  readonly category: ModuleCategory;
  readonly dependencies?: ReadonlyArray<string>;
  readonly status: ModuleStatus;
  readonly health: ModuleHealth;
  readonly capabilities?: ReadonlyArray<string>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}
