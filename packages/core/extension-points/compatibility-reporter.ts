/**
 * OpenLearn Platform Kernel - Plugin Upgrade Compatibility Reporter
 *
 * Scans plugin manifests against target platform versions and extension point
 * deprecation/removal lifecycles, generating pre-upgrade compatibility reports.
 */

import semver from 'semver';
import { CORE_EXTENSION_POINTS, type ExtensionPointMetadata } from './metadata.js';

export interface PluginCompatibilityIssue {
  readonly level: 'warn' | 'error';
  readonly message: string;
  readonly extensionPoint?: string;
  readonly replacement?: string;
}

export interface SinglePluginCompatibilityResult {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly openlearnEngineReq?: string;
  readonly status: 'compatible' | 'has_warnings' | 'incompatible';
  readonly issues: ReadonlyArray<PluginCompatibilityIssue>;
}

export interface UpgradeCompatibilityReport {
  readonly targetVersion: string;
  readonly generatedAt: string;
  readonly overallStatus: 'compatible' | 'has_warnings' | 'incompatible';
  readonly summary: {
    readonly totalPlugins: number;
    readonly compatibleCount: number;
    readonly warningCount: number;
    readonly incompatibleCount: number;
  };
  readonly plugins: ReadonlyArray<SinglePluginCompatibilityResult>;
}

export interface PluginManifestInput {
  readonly id: string;
  readonly name?: string;
  readonly version?: string;
  readonly engines?: { readonly openlearn?: string; readonly [k: string]: any };
  readonly requires?: ReadonlyArray<string>;
  readonly optional?: ReadonlyArray<string>;
  readonly contributes?: Record<string, any>;
  readonly commands?: ReadonlyArray<string>;
  readonly events?: ReadonlyArray<string>;
  readonly [k: string]: any;
}

const EXT_POINT_MAP = new Map<string, ExtensionPointMetadata>(
  CORE_EXTENSION_POINTS.map((p) => [p.id, p]),
);

/**
 * Compare target version with lifecycle versions (using semver).
 */
function versionGte(targetVer: string, thresholdVer: string): boolean {
  const cleanTarget = semver.coerce(targetVer);
  const cleanThreshold = semver.coerce(thresholdVer);
  if (!cleanTarget || !cleanThreshold) {
    return targetVer >= thresholdVer;
  }
  return !semver.lt(cleanTarget, cleanThreshold);
}

/**
 * Generate a comprehensive upgrade compatibility report for a list of plugin manifests.
 */
export function generateUpgradeCompatibilityReport(
  plugins: ReadonlyArray<PluginManifestInput>,
  targetVersion: string,
): UpgradeCompatibilityReport {
  const pluginResults: SinglePluginCompatibilityResult[] = [];

  for (const plugin of plugins) {
    const issues: PluginCompatibilityIssue[] = [];
    const pluginId = plugin.id;
    const pluginName = plugin.name || pluginId;
    const pluginVersion = plugin.version || '0.0.0';
    const engineReq = plugin.engines?.openlearn;

    // 1. Check engines.openlearn semver compatibility
    if (engineReq && engineReq !== '*') {
      const cleanTarget = semver.coerce(targetVersion)?.version || targetVersion;
      if (!semver.satisfies(cleanTarget, engineReq)) {
        issues.push({
          level: 'error',
          message: `Plugin engines.openlearn constraint "${engineReq}" is not satisfied by target version v${targetVersion}`,
        });
      }
    }

    // 2. Check UI slot contributions
    if (plugin.contributes && typeof plugin.contributes === 'object') {
      for (const slotKey of Object.keys(plugin.contributes)) {
        const meta = EXT_POINT_MAP.get(slotKey);
        if (meta) {
          if (meta.removedIn && versionGte(targetVersion, meta.removedIn)) {
            issues.push({
              level: 'error',
              extensionPoint: slotKey,
              replacement: meta.replacement,
              message: `UI Slot "${slotKey}" is removed in v${meta.removedIn}. ${meta.replacement || ''}`,
            });
          } else if (meta.deprecated && versionGte(targetVersion, meta.deprecated)) {
            issues.push({
              level: 'warn',
              extensionPoint: slotKey,
              replacement: meta.replacement,
              message: `UI Slot "${slotKey}" is deprecated since v${meta.deprecated} and will be removed in v${meta.removedIn || 'a future minor release'}. ${meta.replacement || ''}`,
            });
          }
        }
      }
    }

    // 3. Check requested Services (requires & optional)
    const serviceList = [
      ...(Array.isArray(plugin.requires) ? plugin.requires : []),
      ...(Array.isArray(plugin.optional) ? plugin.optional : []),
    ];

    for (const rawToken of serviceList) {
      const lastAt = rawToken.lastIndexOf('@');
      const tokenName = lastAt > 0 ? rawToken.slice(0, lastAt) : rawToken;
      const meta = EXT_POINT_MAP.get(tokenName);
      if (meta) {
        if (meta.removedIn && versionGte(targetVersion, meta.removedIn)) {
          issues.push({
            level: 'error',
            extensionPoint: tokenName,
            replacement: meta.replacement,
            message: `Service Token "${tokenName}" is removed in v${meta.removedIn}. ${meta.replacement || ''}`,
          });
        } else if (meta.deprecated && versionGte(targetVersion, meta.deprecated)) {
          issues.push({
            level: 'warn',
            extensionPoint: tokenName,
            replacement: meta.replacement,
            message: `Service Token "${tokenName}" is deprecated since v${meta.deprecated} and will be removed in v${meta.removedIn || 'a future minor release'}. ${meta.replacement || ''}`,
          });
        }
      }
    }

    // 4. Check explicitly declared Commands / Events if available
    const cmdList = Array.isArray(plugin.commands) ? plugin.commands : [];
    for (const cmd of cmdList) {
      const meta = EXT_POINT_MAP.get(cmd);
      if (meta) {
        if (meta.removedIn && versionGte(targetVersion, meta.removedIn)) {
          issues.push({
            level: 'error',
            extensionPoint: cmd,
            replacement: meta.replacement,
            message: `Command "${cmd}" is removed in v${meta.removedIn}. ${meta.replacement || ''}`,
          });
        } else if (meta.deprecated && versionGte(targetVersion, meta.deprecated)) {
          issues.push({
            level: 'warn',
            extensionPoint: cmd,
            replacement: meta.replacement,
            message: `Command "${cmd}" is deprecated since v${meta.deprecated}. ${meta.replacement || ''}`,
          });
        }
      }
    }

    let status: 'compatible' | 'has_warnings' | 'incompatible' = 'compatible';
    if (issues.some((i) => i.level === 'error')) {
      status = 'incompatible';
    } else if (issues.some((i) => i.level === 'warn')) {
      status = 'has_warnings';
    }

    pluginResults.push({
      id: pluginId,
      name: pluginName,
      version: pluginVersion,
      openlearnEngineReq: engineReq,
      status,
      issues,
    });
  }

  const incompatibleCount = pluginResults.filter((p) => p.status === 'incompatible').length;
  const warningCount = pluginResults.filter((p) => p.status === 'has_warnings').length;
  const compatibleCount = pluginResults.filter((p) => p.status === 'compatible').length;

  let overallStatus: 'compatible' | 'has_warnings' | 'incompatible' = 'compatible';
  if (incompatibleCount > 0) {
    overallStatus = 'incompatible';
  } else if (warningCount > 0) {
    overallStatus = 'has_warnings';
  }

  return {
    targetVersion,
    generatedAt: new Date().toISOString(),
    overallStatus,
    summary: {
      totalPlugins: pluginResults.length,
      compatibleCount,
      warningCount,
      incompatibleCount,
    },
    plugins: pluginResults,
  };
}
