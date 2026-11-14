import { describe, it, expect, afterEach, vi } from 'vitest';
import { safeRandomUUID } from '../security/safe-uuid.js';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('safeRandomUUID', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses crypto.randomUUID when available', () => {
    const id = safeRandomUUID();
    expect(id).toMatch(UUID_V4_RE);
  });

  it('falls back cleanly to crypto.getRandomValues when crypto.randomUUID is undefined (plain HTTP LAN)', () => {
    const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    vi.stubGlobal('crypto', { getRandomValues });

    const id = safeRandomUUID();
    expect(id).toMatch(UUID_V4_RE);
  });

  it('falls back cleanly when globalThis.crypto is missing', () => {
    vi.stubGlobal('crypto', undefined);

    const id = safeRandomUUID();
    expect(id).toMatch(UUID_V4_RE);
  });
});
