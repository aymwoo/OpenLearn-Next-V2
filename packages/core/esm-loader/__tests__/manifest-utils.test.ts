/**
 * Unit tests for parseRequiresEntry utility function.
 *
 * Phase 6: Parses manifest requires/optional entries into structured
 * { tokenName, versionRange } objects for SemVer compatibility checking.
 */
import { describe, it, expect } from 'vitest';
import { parseRequiresEntry } from '../manifest-utils.js';

describe('parseRequiresEntry', () => {
  it('should return tokenName and null versionRange for entry without @version', () => {
    const result = parseRequiresEntry('@openlearn/core:ICommandBusService');
    expect(result.tokenName).toBe('@openlearn/core:ICommandBusService');
    expect(result.versionRange).toBeNull();
  });

  it('should return tokenName and ^versionRange for caret version', () => {
    const result = parseRequiresEntry('@openlearn/core:ICommandBusService@^1.0.0');
    expect(result.tokenName).toBe('@openlearn/core:ICommandBusService');
    expect(result.versionRange).toBe('^1.0.0');
  });

  it('should return tokenName and ~versionRange for tilde version', () => {
    const result = parseRequiresEntry('@openlearn/core:IEventBusService@~1.2.0');
    expect(result.tokenName).toBe('@openlearn/core:IEventBusService');
    expect(result.versionRange).toBe('~1.2.0');
  });

  it('should return tokenName and exact version for no-prefix version', () => {
    const result = parseRequiresEntry('@openlearn/core:IStorageService@1.0.0');
    expect(result.tokenName).toBe('@openlearn/core:IStorageService');
    expect(result.versionRange).toBe('1.0.0');
  });

  it('should handle pre-release version tags', () => {
    const result = parseRequiresEntry('@openlearn/core:IAIService@^1.0.0-beta.1');
    expect(result.tokenName).toBe('@openlearn/core:IAIService');
    expect(result.versionRange).toBe('^1.0.0-beta.1');
  });

  it('should handle complex range (>= ... <)', () => {
    const result = parseRequiresEntry('@openlearn/core:IProcessService@>=1.0.0 <2.0.0');
    expect(result.tokenName).toBe('@openlearn/core:IProcessService');
    expect(result.versionRange).toBe('>=1.0.0 <2.0.0');
  });

  it('should handle optional deps with version range', () => {
    const result = parseRequiresEntry('@openlearn/core:ICapabilityService@^0.5.0');
    expect(result.tokenName).toBe('@openlearn/core:ICapabilityService');
    expect(result.versionRange).toBe('^0.5.0');
  });

  it('should handle hyphenated scope names', () => {
    const result = parseRequiresEntry('@my-scope/sub-domain:IService@^1.0.0');
    expect(result.tokenName).toBe('@my-scope/sub-domain:IService');
    expect(result.versionRange).toBe('^1.0.0');
  });
});
