/**
 * OpenLearn Activity Ecosystem — Public API (Sprint P7-01)
 *
 * Single entry point for the Activity Ecosystem. Official code and third-party
 * plugins import from here (via @openlearn/plugin-sdk) and use the same APIs.
 */

import type { ActivityRegistry } from './registry.js';
import { Token } from '../core/di/token.js';

export * from './types.js';
export * from './context.js';
export * from './provider.js';
export * from './registry.js';
export * from './default-providers.js';
export * from './ai.js';

/**
 * DI token under which the host registers the singleton ActivityRegistry.
 * Plugins resolve it exactly like any other kernel service:
 *
 *   const registry = await ctx.resolve(IActivityRegistryToken);
 *   registry.registerProvider(myProvider);
 *
 * This is the SAME mechanism core plugins use for ctx.services.* — no special
 * path for activities.
 */
export const IActivityRegistryToken = new Token<ActivityRegistry>(
  '@openlearn/activity-ecosystem:IActivityRegistry',
);
