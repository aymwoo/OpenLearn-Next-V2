import {
  IFileStorageExtensionRegistryToken,
  type IFileStorageExtensionRegistry,
} from '../../../packages/core/di/interfaces.js';
import { kernelContainer } from '../../../packages/core/kernel/index.js';
import { FileStorageService } from './file-storage-service.js';

let cachedService: FileStorageService | null = null;
let cachedDb: unknown = null;

/**
 * Returns the host singleton FileStorageService bound to the current kernel DB,
 * EventBus, and DI IFileStorageExtensionRegistry instance.
 */
export function getFileStorageService(): FileStorageService {
  const db = kernelContainer.db;
  if (cachedService && cachedDb === db) {
    return cachedService;
  }
  const registryEntry = kernelContainer.serviceRegistry
    ?.list?.()
    .find((entry) => entry.name === IFileStorageExtensionRegistryToken.name);
  const registry = registryEntry?.instance as IFileStorageExtensionRegistry | undefined;

  cachedService = new FileStorageService(db, {
    eventBus: kernelContainer.eventBus,
    registry,
  });
  cachedDb = db;
  return cachedService;
}

export function resetFileStorageServiceForTesting(): void {
  cachedService = null;
  cachedDb = null;
}
