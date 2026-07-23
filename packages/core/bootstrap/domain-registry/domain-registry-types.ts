/**
 * OpenLearn Platform Kernel - Domain Registry Types & Interfaces (Sprint A2)
 */

import { Version } from '../types/index.js';

export type DomainStatus =
  | 'Unknown'
  | 'Registered'
  | 'Active'
  | 'Inactive'
  | 'Error';

export type DomainCategory =
  | 'Core'
  | 'Business'
  | 'Infrastructure'
  | 'AI'
  | 'Extension';

export interface DomainHealth {
  readonly isHealthy: boolean;
  readonly status: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface PlatformDomainDescriptor {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly version: Version;
  readonly category: DomainCategory;
  readonly owner?: string;
  readonly dependencies?: ReadonlyArray<string>;
  readonly modules: ReadonlyArray<string>;
  readonly status: DomainStatus;
  readonly health: DomainHealth;
  readonly capabilities?: ReadonlyArray<string>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}
