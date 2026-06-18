/**
 * EsmLoader subsystem barrel export.
 *
 * Provides:
 * - EsmLoader — abstract base class for dynamic ESM module loading
 * - PluginModule — interface for import() return namespace object
 * - NodeEsmLoader — data: URL + import() implementation (Node.js)
 * - BrowserEsmLoader — Blob URL + import() implementation (Browser)
 * - manifestSchema — zod runtime validation schema for manifest.json
 * - Manifest — TypeScript type derived from manifestSchema
 * - Error classes — EsmLoaderError and 4 named subclasses
 */
export { EsmLoader } from './esm-loader.js';
export type { PluginModule } from './esm-loader.js';
export { NodeEsmLoader } from './node-loader.js';
export { BrowserEsmLoader } from './browser-loader.js';
export { manifestSchema, manifestSchemaV3 } from './manifest-schema.js';
export type { Manifest, ManifestV3 } from './manifest-schema.js';
export { parseRequiresEntry } from './manifest-utils.js';
export {
  EsmLoaderError,
  EsmSyntaxError,
  EsmModuleNotFoundError,
  EsmLoadTimeoutError,
  EsmActivationError,
} from './errors.js';
