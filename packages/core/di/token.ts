/**
 * Token<T> — a type-safe service identifier for the DI container.
 *
 * Inspired by the JupyterLab/Lumino Token design pattern.  The generic
 * parameter `T` is a **phantom type**: it carries the service interface
 * type at compile time but is never used at runtime.
 *
 * ## Naming convention
 *
 * `@scope/domain:ServiceName` — e.g. `@openlearn/core:ICommandBusService`.
 * The constructor validates the format and rejects names that contain
 * spaces, Chinese characters, or other special characters (see Pitfall 4
 * in RESEARCH.md — Phase 3 may use token names in URL / file-path contexts).
 *
 * ## Usage
 *
 * ```ts
 * interface ICommandBusService { execute(cmd: unknown): Promise<unknown> }
 * export const ICommandBusServiceToken = new Token<ICommandBusService>(
 *   '@openlearn/core:ICommandBusService'
 * );
 * ```
 */
import { TokenError } from './errors.js';

// Token naming regex: @scope/domain:Name
// scope  : letters, digits, underscore, hyphen
// domain : letters, digits, underscore, hyphen
// name   : letters, digits, underscore
const TOKEN_NAME_RE = /^@[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+:[a-zA-Z0-9_]+$/;

export class Token<T> {
  // Phantom type parameter — carries the service interface type at
  // compile time only.  Never accessed at runtime.
  // Phantom type — carries the service interface at compile time only.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private readonly _phantomService!: T;

  /** The string identifier, e.g. `@openlearn/core:ICommandBusService`. */
  public readonly name: string;

  constructor(name: string) {
    if (!name || typeof name !== 'string') {
      throw new TokenError(
        `Token name must be a non-empty string, got: ${String(name)}`
      );
    }

    if (!TOKEN_NAME_RE.test(name)) {
      throw new TokenError(
        `Invalid Token name format: "${name}". ` +
          `Expected: @scope/domain:ServiceName`
      );
    }

    this.name = name;
  }
}
