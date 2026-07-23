export class CacheManager {
  private objectCache = new Map<string, any>();
  private textCache = new Map<string, any>();
  private imageCache = new Map<string, any>();
  private pathCache = new Map<string, any>();

  public get<T>(category: 'object' | 'text' | 'image' | 'path', key: string): T | undefined {
    switch (category) {
      case 'object':
        return this.objectCache.get(key) as T;
      case 'text':
        return this.textCache.get(key) as T;
      case 'image':
        return this.imageCache.get(key) as T;
      case 'path':
        return this.pathCache.get(key) as T;
    }
  }

  public set(category: 'object' | 'text' | 'image' | 'path', key: string, value: any): void {
    switch (category) {
      case 'object':
        this.objectCache.set(key, value);
        break;
      case 'text':
        this.textCache.set(key, value);
        break;
      case 'image':
        this.imageCache.set(key, value);
        break;
      case 'path':
        this.pathCache.set(key, value);
        break;
    }
  }

  public invalidate(category: 'object' | 'text' | 'image' | 'path', key?: string): void {
    if (!key) {
      switch (category) {
        case 'object':
          this.objectCache.clear();
          break;
        case 'text':
          this.textCache.clear();
          break;
        case 'image':
          this.imageCache.clear();
          break;
        case 'path':
          this.pathCache.clear();
          break;
      }
      return;
    }

    switch (category) {
      case 'object':
        this.objectCache.delete(key);
        break;
      case 'text':
        this.textCache.delete(key);
        break;
      case 'image':
        this.imageCache.delete(key);
        break;
      case 'path':
        this.pathCache.delete(key);
        break;
    }
  }

  public clearAll(): void {
    this.objectCache.clear();
    this.textCache.clear();
    this.imageCache.clear();
    this.pathCache.clear();
  }
}

export const cacheManager = new CacheManager();
