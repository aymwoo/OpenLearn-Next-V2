/**
 * OpenLearn Capability Governance - Manifest Exporter
 * Exports JSON Manifests for capability catalogs and plugin registration.
 */

import { GovernanceSpecification } from '../types/index.js';

export class ManifestExporter {
  public static exportManifest(spec: GovernanceSpecification): string {
    const exportObject = {
      schemaVersion: '2.5.0',
      capability: spec,
      exportedAt: new Date().toISOString(),
    };
    return JSON.stringify(exportObject, null, 2);
  }

  public static exportCatalogManifest(specs: ReadonlyArray<GovernanceSpecification>): string {
    const exportObject = {
      schemaVersion: '2.5.0',
      totalCount: specs.length,
      capabilities: specs,
      exportedAt: new Date().toISOString(),
    };
    return JSON.stringify(exportObject, null, 2);
  }
}
