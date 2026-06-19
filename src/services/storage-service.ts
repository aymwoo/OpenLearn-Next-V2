/**
 * StorageService — localStorage wrapper with per-plugin key isolation.
 *
 * T-09-03: All localStorage keys are prefixed with `edu_os_plugin:{pluginId}:`
 * to prevent cross-plugin data leakage and key collisions.
 *
 * Example: A plugin with id "ext-quiz-generator" storing key "config"
 * will actually write to localStorage key "edu_os_plugin:ext-quiz-generator:config".
 */

import type { IStorageService } from '../plugin-host/types';

export class StorageService implements IStorageService {
  private prefix: string;

  constructor(pluginId: string) {
    this.prefix = `edu_os_plugin:${pluginId}:`;
  }

  get(key: string): string | null {
    return localStorage.getItem(this.prefix + key);
  }

  set(key: string, value: string): void {
    localStorage.setItem(this.prefix + key, value);
  }

  delete(key: string): void {
    localStorage.removeItem(this.prefix + key);
  }

  clear(): void {
    const prefixLen = this.prefix.length;
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(this.prefix)) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  }
}
