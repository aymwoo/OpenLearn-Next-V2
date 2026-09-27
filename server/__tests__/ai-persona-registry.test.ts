import { describe, it, expect, afterEach } from 'vitest';
import {
  registerAIPersona,
  getAIPersona,
  listAIPersonas,
  unregisterAIPersona,
} from '../ai-persona-registry.js';

/**
 * P2: ai.agent.persona —— 角色注册表行为锁定。
 *
 * 覆盖：内置种子、插件注册/查询、同 id 覆盖、builtin 不可注销、
 * 以及按 registeredBy 的归属校验（防止插件注销他人角色）。
 */
describe('ai-persona-registry', () => {
  const PLUGIN_ID = '@test/persona-plugin';
  const CUSTOM_ID = 'unit_test_persona';

  afterEach(() => {
    // 清理本测试注册的角色，避免污染其他用例。
    unregisterAIPersona(CUSTOM_ID);
    unregisterAIPersona(CUSTOM_ID, PLUGIN_ID);
  });

  it('seeds the four builtin personas', () => {
    const ids = listAIPersonas().map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining(['socratic_questioner', 'debate_opponent', 'historical_figure', 'plain_assistant']),
    );
  });

  it('getAIPersona returns undefined for unknown / empty ids', () => {
    expect(getAIPersona(null)).toBeUndefined();
    expect(getAIPersona(undefined)).toBeUndefined();
    expect(getAIPersona('not_a_persona')).toBeUndefined();
  });

  it('registers a plugin persona and exposes it via list/get', () => {
    registerAIPersona(
      {
        id: CUSTOM_ID,
        nameZh: '单元测试角色',
        nameEn: 'Unit Test Persona',
        instructionZh: '仅用于测试。',
        instructionEn: 'For tests only.',
      },
      PLUGIN_ID,
    );

    const persona = getAIPersona(CUSTOM_ID);
    expect(persona).toBeDefined();
    expect(persona?.source).toBe('plugin');
    expect(persona?.registeredBy).toBe(PLUGIN_ID);
    expect(listAIPersonas().some((p) => p.id === CUSTOM_ID)).toBe(true);
  });

  it('rejects registration without id or instructionZh', () => {
    expect(() =>
      registerAIPersona({ id: '', nameZh: 'x', nameEn: 'x', instructionZh: 'x', instructionEn: 'x' }),
    ).toThrow();
    expect(() =>
      registerAIPersona({ id: CUSTOM_ID, nameZh: 'x', nameEn: 'x', instructionZh: '', instructionEn: 'x' }),
    ).toThrow();
  });

  it('refuses to unregister builtin personas', () => {
    unregisterAIPersona('socratic_questioner');
    expect(getAIPersona('socratic_questioner')).toBeDefined();
  });

  it('only allows the owning plugin to unregister its persona', () => {
    registerAIPersona(
      { id: CUSTOM_ID, nameZh: 'x', nameEn: 'x', instructionZh: 'x', instructionEn: 'x' },
      PLUGIN_ID,
    );
    // A different owner must not be able to remove it.
    unregisterAIPersona(CUSTOM_ID, '@test/other-plugin');
    expect(getAIPersona(CUSTOM_ID)).toBeDefined();
    // The owner can.
    unregisterAIPersona(CUSTOM_ID, PLUGIN_ID);
    expect(getAIPersona(CUSTOM_ID)).toBeUndefined();
  });
});
