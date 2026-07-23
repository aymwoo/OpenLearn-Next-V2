/**
 * OpenLearn Presence Engine - Privacy Subsystem
 * Enforces privacy rules, anonymous mode masking, telemetry collection toggles, and data retention.
 */

import { PresencePrivacyConfig, PresenceEntity } from './types.js';

export class PresencePrivacyManager {
  private config: PresencePrivacyConfig;

  constructor(initialConfig?: Partial<PresencePrivacyConfig>) {
    this.config = {
      permissionRequired: initialConfig?.permissionRequired ?? true,
      anonymousMode: initialConfig?.anonymousMode ?? false,
      disableCollection: initialConfig?.disableCollection ?? false,
      retentionDays: initialConfig?.retentionDays ?? 30,
    };
  }

  public getConfig(): PresencePrivacyConfig {
    return { ...this.config };
  }

  public updateConfig(partial: Partial<PresencePrivacyConfig>): void {
    this.config = {
      ...this.config,
      ...partial,
    };
  }

  /**
   * Check if telemetry collection is permitted under current settings.
   */
  public isCollectionAllowed(): boolean {
    return !this.config.disableCollection;
  }

  /**
   * Filter and sanitize a presence entity according to privacy settings.
   */
  public sanitizeEntity(entity: PresenceEntity): PresenceEntity {
    if (this.config.anonymousMode) {
      return {
        ...entity,
        id: `anon_${entity.id.slice(-6)}`,
        metadata: {},
      };
    }
    return entity;
  }
}
