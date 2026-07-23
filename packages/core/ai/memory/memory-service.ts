/**
 * OpenLearn AI Infrastructure - Memory Service
 * Provides key-value memory storage for session memory, lesson memory, and workspace memory.
 */

export class MemoryService {
  private memoryStore = new Map<string, unknown>();

  public setMemory(key: string, value: unknown): void {
    this.memoryStore.set(key, value);
  }

  public getMemory<T = unknown>(key: string): T | undefined {
    return this.memoryStore.get(key) as T | undefined;
  }

  public hasMemory(key: string): boolean {
    return this.memoryStore.has(key);
  }

  public deleteMemory(key: string): boolean {
    return this.memoryStore.delete(key);
  }

  public clear(): void {
    this.memoryStore.clear();
  }
}
