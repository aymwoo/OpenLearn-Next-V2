/**
 * Frontend PluginHost barrel file.
 *
 * Re-exports all public types and classes from the plugin-host subsystem.
 * Import from this file rather than individual modules:
 *
 *   import { FrontendServiceRegistry, PluginState } from '@/plugin-host';
 */

export * from './types';
export * from './service-registry';
export * from './plugin-host-store';
export * from './plugin-host';              // Created in Task 3
export * from './plugin-host-context';      // Created in Task 3
