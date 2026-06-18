/**
 * Unit tests for Token<T> class (DI container service identifier).
 *
 * Phase 6 additions:
 * - Token.version default value
 * - Token.version custom value
 * - Pre-release version strings
 * - Version does not affect existing name validation
 *
 * Covers:
 * - Basic creation and name access
 * - Generic type inference (compile-time check)
 * - Empty name rejection
 * - Invalid-format name rejection
 * - Valid-format acceptance
 * - Token uniqueness (different name → different token)
 */
import { describe, it, expect } from 'vitest';
import { Token } from '../token.js';
import { TokenError } from '../errors.js';

describe('Token<T>', () => {
  // --- Creation & name --------------------------------------------------

  it('should create a Token and return the name via .name', () => {
    const t = new Token<{ execute(): void }>('@openlearn/core:ITest');
    expect(t.name).toBe('@openlearn/core:ITest');
  });

  // --- Generic type inference (compile-time proof) ---------------------

  it('should support generic type inference with phantom type parameter', () => {
    interface ICommandBusService {
      execute(cmd: unknown): Promise<unknown>;
    }

    // This line MUST compile without errors — it proves that the
    // phantom type parameter is wired correctly.
    const token = new Token<ICommandBusService>(
      '@openlearn/core:ICommandBusService'
    );

    // At runtime the phantom type is invisible, so we just verify
    // the Token was created successfully.
    expect(token).toBeInstanceOf(Token);
    expect(token.name).toBe('@openlearn/core:ICommandBusService');
  });

  // --- Empty / non-string name ------------------------------------------

  it('should throw TokenError for an empty string name', () => {
    expect(() => new Token('')).toThrow(TokenError);
    expect(() => new Token('')).toThrow(
      'Token name must be a non-empty string'
    );
  });

  it('should throw TokenError for a non-string name (undefined passed as any)', () => {
    expect(() => new Token(undefined as any)).toThrow(TokenError);
  });

  // --- Invalid format ---------------------------------------------------

  it.each([
    'no-scope',                                    // missing @
    'no-colon',                                    // missing colon
    '@scope/domain:Name With Space',               // space in Name
    '@scope/domain:中文名',                         // Chinese characters
    '@scope/domain:name!',                         // special character !
    '@scope/domain:name#',                         // special character #
    '@scope:Name',                                 // missing domain part
  ])('should throw TokenError for invalid format: %s', (badName) => {
    expect(() => new Token(badName)).toThrow(TokenError);
    expect(() => new Token(badName)).toThrow(/Invalid Token name format/);
  });

  // --- Valid formats ----------------------------------------------------

  it.each([
    '@openlearn/core:ICommandBusService',
    '@openlearn/plugin:IQuizGenerator',
    '@org-team/sub_system:MyService',
    '@a/b:C',
    '@scope-with-dash/domain:Service_Name',
  ])('should accept valid Token name: %s', (validName) => {
    const t = new Token(validName);
    expect(t.name).toBe(validName);
  });

  // --- Uniqueness -------------------------------------------------------

  it('should treat Tokens with different names as distinct', () => {
    const t1 = new Token('@openlearn/core:IServiceA');
    const t2 = new Token('@openlearn/core:IServiceB');

    // At runtime the Token objects are distinct references.
    expect(t1).not.toBe(t2);
    expect(t1.name).not.toBe(t2.name);
  });
});

// ---------------------------------------------------------------------------
// Phase 6: Token.version semantic versioning
// ---------------------------------------------------------------------------

describe('Token.version (Phase 6)', () => {
  it('should default to 1.0.0 when no version provided', () => {
    const t = new Token('@openlearn/core:IServiceA');
    expect(t.version).toBe('1.0.0');
  });

  it('should accept custom version string', () => {
    const t = new Token('@openlearn/core:IServiceA', '2.0.0');
    expect(t.version).toBe('2.0.0');
  });

  it('should accept pre-release version strings', () => {
    const t = new Token('@openlearn/core:IServiceA', '1.0.0-beta.1');
    expect(t.version).toBe('1.0.0-beta.1');
  });

  it('should not affect existing name validation', () => {
    expect(() => new Token('')).toThrow(TokenError);
    expect(() => new Token('@openlearn/core:IServiceA', '1.0.0')).not.toThrow();
  });
});
