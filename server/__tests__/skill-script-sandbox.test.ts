import { describe, expect, it } from 'vitest';
import { executeSkillScript, SkillScriptError } from '../skill-script-sandbox.js';
import type { SkillDescriptor } from '../skill-registry.js';

/**
 * 脚本技能沙箱回归：输出归一化、白名单、超时与失败语义。
 */

const base: SkillDescriptor = {
  id: '@scope/demo:script-skill',
  source: 'plugin',
  pluginId: '@scope/demo',
  name: '脚本技能',
  description: 'demo',
  surfaces: ['lesson_prep'],
  roles: ['teacher'],
  tools: [],
  latencyClass: 'interactive',
  enabled: true,
};

const withScript = (source: string, outputKind: SkillDescriptor['outputKind'], timeoutMs = 200): SkillDescriptor => ({
  ...base,
  outputKind,
  script: { source, timeoutMs },
});

describe('executeSkillScript', () => {
  it('生成 lesson_segments 产物并归一化字段', () => {
    const skill = withScript(
      'return { segments: [{ title: "导入", duration: "5", type: "intro" }] };',
      'lesson_segments',
    );
    const result = executeSkillScript(skill, { surface: 'lesson_prep', lessonId: 'l1' });
    expect(result.artifact).toEqual({
      kind: 'lesson_segments',
      segments: [{ title: '导入', duration: '5m', type: 'intro' }],
    });
  });

  it('config_patch 只保留白名单字段', () => {
    const skill = withScript('return { changes: { modePacksEnabled: true, notAllowed: 1 } };', 'config_patch');
    const result = executeSkillScript(skill, { surface: 'admin_settings' });
    expect(result.artifact).toEqual({ kind: 'config_patch', changes: { modePacksEnabled: true } });
  });

  it('classroom_card 生成卡片', () => {
    const skill = withScript('return { title: "小结", body: "要点" };', 'classroom_card');
    const result = executeSkillScript(skill, { surface: 'classroom_live', classId: 'c1' });
    expect(result.artifact).toEqual({ kind: 'classroom_card', card: { title: '小结', body: '要点' } });
  });

  it('超时中止并返回 SCRIPT_TIMEOUT', () => {
    const skill = withScript('while (true) {}', 'classroom_card', 50);
    try {
      executeSkillScript(skill, { surface: 'classroom_live' });
      throw new Error('expected timeout');
    } catch (err) {
      expect(err).toBeInstanceOf(SkillScriptError);
      expect((err as SkillScriptError).code).toBe('SCRIPT_TIMEOUT');
    }
  });

  it('非法输出 fail-closed', () => {
    const skill = withScript('return { segments: [] };', 'lesson_segments');
    expect(() => executeSkillScript(skill, { surface: 'lesson_prep' })).toThrowError(/at least one valid segment/);
  });

  it('缺少脚本时拒绝执行', () => {
    expect(() => executeSkillScript(base, { surface: 'lesson_prep' })).toThrowError(/no executable script/i);
  });

  it('沙箱内不可访问 require/process', () => {
    const skill = withScript('return { title: typeof require + "/" + typeof process, body: "" };', 'classroom_card');
    const result = executeSkillScript(skill, { surface: 'classroom_live' });
    expect(result.artifact.kind === 'classroom_card' ? result.artifact.card.title : '').toBe('undefined/undefined');
  });
});
