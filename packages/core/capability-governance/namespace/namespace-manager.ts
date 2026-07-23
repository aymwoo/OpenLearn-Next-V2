/**
 * OpenLearn Capability Governance - Namespace Manager
 * Enforces dot-separated namespace standards (lesson.*, whiteboard.*, ai.*, plugin.*).
 */

export class NamespaceManager {
  private namespaces = new Set<string>();

  public registerNamespace(namespace: string): void {
    const sanitized = namespace.trim().toLowerCase();
    if (!/^[a-z0-9]+(\.[a-z0-9_-]+)+$/.test(sanitized)) {
      throw new Error(`Invalid Namespace Format: '${namespace}'. Must be dot-separated lowercase (e.g. 'lesson.generate.quiz').`);
    }
    if (this.namespaces.has(sanitized)) {
      throw new Error(`Namespace Collision: Namespace '${sanitized}' is already registered.`);
    }
    this.namespaces.add(sanitized);
  }

  public hasNamespace(namespace: string): boolean {
    return this.namespaces.has(namespace.trim().toLowerCase());
  }

  public listNamespaces(): ReadonlyArray<string> {
    return Object.freeze(Array.from(this.namespaces));
  }

  public clear(): void {
    this.namespaces.clear();
  }
}
