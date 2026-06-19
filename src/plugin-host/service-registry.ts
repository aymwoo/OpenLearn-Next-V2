/**
 * FrontendServiceRegistry — simplified browser-side DI container.
 *
 * Unlike the backend ServiceRegistry (which supports topological sort,
 * cycle detection, and dependency graph traversal), this frontend
 * implementation is intentionally flat. Frontend services have no
 * cross-dependencies (D-17), so we skip the full graph machinery.
 *
 * API surface matches the backend: register / resolve / unregister / has / list.
 *
 * T-09-01: Throws on duplicate registration to prevent service replacement
 * without explicit unregister.
 */

export class FrontendServiceRegistry {
  /** Internal registry: token name -> service instance */
  private services = new Map<string, unknown>();

  /**
   * Register a service instance by string token.
   * Throws if the token is already registered (T-09-01 mitigation).
   */
  async register<T>(token: string, instance: T): Promise<void> {
    if (this.services.has(token)) {
      throw new Error(`Service already registered: ${token}`);
    }
    this.services.set(token, instance);
  }

  /**
   * Resolve a service instance by string token.
   * Throws `Error('No provider registered for token: ' + token)` if missing.
   */
  async resolve<T>(token: string): Promise<T> {
    const instance = this.services.get(token);
    if (!instance) {
      throw new Error(`No provider registered for token: ${token}`);
    }
    return instance as T;
  }

  /**
   * Unregister a service by string token.
   */
  async unregister(token: string): Promise<void> {
    this.services.delete(token);
  }

  /**
   * Check whether a token is registered.
   */
  has(token: string): boolean {
    return this.services.has(token);
  }

  /**
   * List all registered services with their token names and instances.
   */
  list(): Array<{ name: string; instance: unknown }> {
    return Array.from(this.services.entries()).map(([name, instance]) => ({
      name,
      instance,
    }));
  }
}
