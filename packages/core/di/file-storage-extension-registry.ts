import type {
  FileLayoutTokenResolver,
  FileProcessor,
  FileProcessorStage,
  FileStorageBackend,
  IFileStorageExtensionRegistry,
  IRegisteredFileBackend,
  IRegisteredFileProcessor,
} from './interfaces.js';

/**
 * 文件存储三插槽内存注册表。
 * 供内核、本地默认后端、内置处理器及宿主可信扩展注册存储后端、文件处理器和布局占位符。
 */
export class FileStorageExtensionRegistry implements IFileStorageExtensionRegistry {
  private readonly backends = new Map<string, IRegisteredFileBackend>();
  private readonly processors = new Map<string, IRegisteredFileProcessor>();
  private readonly layoutTokens = new Map<string, { owner: string; resolver: FileLayoutTokenResolver }>();

  registerBackend(owner: string, backend: FileStorageBackend): void {
    const existing = this.backends.get(backend.id);
    if (existing && existing.owner !== owner) {
      throw new Error(`Storage backend "${backend.id}" is already registered by owner "${existing.owner}"`);
    }
    this.backends.set(backend.id, { owner, backend });
  }

  unregisterBackend(owner: string, id: string): boolean {
    const existing = this.backends.get(id);
    if (!existing || existing.owner !== owner) return false;
    return this.backends.delete(id);
  }

  getBackend(id: string): FileStorageBackend | undefined {
    return this.backends.get(id)?.backend;
  }

  listBackends(): IRegisteredFileBackend[] {
    return Array.from(this.backends.values());
  }

  registerProcessor(owner: string, processor: FileProcessor): void {
    const existing = this.processors.get(processor.id);
    if (existing && existing.owner !== owner) {
      throw new Error(`File processor "${processor.id}" is already registered by owner "${existing.owner}"`);
    }
    this.processors.set(processor.id, { owner, processor });
  }

  unregisterProcessor(owner: string, id: string): boolean {
    const existing = this.processors.get(id);
    if (!existing || existing.owner !== owner) return false;
    return this.processors.delete(id);
  }

  listProcessors(stage?: FileProcessorStage): IRegisteredFileProcessor[] {
    const items = Array.from(this.processors.values());
    const filtered = stage ? items.filter((entry) => entry.processor.stage === stage) : items;
    return filtered.sort((a, b) => (a.processor.priority ?? 100) - (b.processor.priority ?? 100));
  }

  registerLayoutToken(owner: string, tokenName: string, resolver: FileLayoutTokenResolver): void {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(tokenName)) {
      throw new Error(`Invalid layout token name "${tokenName}"`);
    }
    const existing = this.layoutTokens.get(tokenName);
    if (existing && existing.owner !== owner) {
      throw new Error(`Layout token "{${tokenName}}" is already registered by owner "${existing.owner}"`);
    }
    this.layoutTokens.set(tokenName, { owner, resolver });
  }

  unregisterLayoutToken(owner: string, tokenName: string): boolean {
    const existing = this.layoutTokens.get(tokenName);
    if (!existing || existing.owner !== owner) return false;
    return this.layoutTokens.delete(tokenName);
  }

  getLayoutTokenResolvers(): ReadonlyMap<string, { owner: string; resolver: FileLayoutTokenResolver }> {
    return this.layoutTokens;
  }

  clear(owner?: string): void {
    if (!owner) {
      this.backends.clear();
      this.processors.clear();
      this.layoutTokens.clear();
      return;
    }
    for (const [id, item] of this.backends.entries()) {
      if (item.owner === owner) this.backends.delete(id);
    }
    for (const [id, item] of this.processors.entries()) {
      if (item.owner === owner) this.processors.delete(id);
    }
    for (const [name, item] of this.layoutTokens.entries()) {
      if (item.owner === owner) this.layoutTokens.delete(name);
    }
  }

  listOwners(): string[] {
    const owners = new Set<string>();
    for (const item of this.backends.values()) owners.add(item.owner);
    for (const item of this.processors.values()) owners.add(item.owner);
    for (const item of this.layoutTokens.values()) owners.add(item.owner);
    return Array.from(owners);
  }
}
