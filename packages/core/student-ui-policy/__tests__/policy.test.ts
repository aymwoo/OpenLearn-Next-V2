import { describe, it, expect } from 'vitest';
import {
  isPluginHiddenByPolicy,
  parseStoredStudentUiPolicy,
  resolveEffectiveStudentUiPolicy,
  validateStudentUiPolicyDocument,
  normalizeEffectiveStudentUiPolicy,
  widgetFeatureId,
  STUDENT_UI_FEATURE_IDS,
  type StudentUiPolicyLayer,
} from '../index.js';

const layer = (patch: Partial<StudentUiPolicyLayer>): StudentUiPolicyLayer => ({
  features: {},
  hiddenPlugins: [],
  hiddenExtensions: [],
  ...patch,
});

describe('student-ui-policy contract', () => {
  it('拒绝未知功能 ID 与错误类型', () => {
    expect(validateStudentUiPolicyDocument({ version: 1, features: { 'widget.nope': false } })).toMatchObject({
      ok: false,
    });
    expect(validateStudentUiPolicyDocument({ version: 1, features: { 'widget.quick-stats': 'no' } })).toMatchObject({
      ok: false,
    });
    expect(validateStudentUiPolicyDocument({ version: 1, hideGuidance: 'yes' })).toMatchObject({ ok: false });
    expect(validateStudentUiPolicyDocument({ version: 1, extra: true })).toMatchObject({ ok: false });
  });

  it('接受合法策略并去重插件 ID', () => {
    const result = validateStudentUiPolicyDocument({
      version: 1,
      features: { 'widget.quick-stats': false },
      hideGuidance: true,
      hiddenPlugins: ['p1', 'p1'],
      hiddenExtensions: ['p1/ext'],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.features['widget.quick-stats']).toBe(false);
      expect(result.value.hiddenPlugins).toEqual(['p1']);
      expect(result.value.hideGuidance).toBe(true);
    }
  });

  it('按 教师 → 班级 → 课节 逐项覆盖', () => {
    const effective = resolveEffectiveStudentUiPolicy([
      { source: 'teacher', policy: layer({ features: { 'widget.quick-stats': false, 'widget.schedules': false } }) },
      { source: 'class', policy: layer({ features: { 'widget.quick-stats': true } }) },
      { source: 'lesson', policy: layer({ features: { 'widget.schedules': true } }) },
    ]);
    expect(effective.features['widget.quick-stats']).toBe(true);
    expect(effective.features['widget.schedules']).toBe(true);
    expect(effective.sources['widget.quick-stats']).toBe('class');
    expect(effective.sources['widget.schedules']).toBe('lesson');
  });

  it('多个班级冲突时隐藏优先', () => {
    const effective = resolveEffectiveStudentUiPolicy([
      { source: 'class', policy: layer({ features: { 'widget.quick-stats': true } }) },
      { source: 'class', policy: layer({ features: { 'widget.quick-stats': false } }) },
    ]);
    expect(effective.features['widget.quick-stats']).toBe(false);
  });

  it('插件隐藏取并集，引导开关按课节优先', () => {
    const effective = resolveEffectiveStudentUiPolicy([
      {
        source: 'teacher',
        policy: layer({ hideGuidance: true, hiddenPlugins: ['p1'], hiddenExtensions: ['p1/a'] }),
      },
      { source: 'class', policy: layer({ hideGuidance: false, hiddenPlugins: ['p2'] }) },
      { source: 'lesson', policy: layer({ hideGuidance: true }) },
    ]);
    expect(effective.hideGuidance).toBe(true);
    expect(effective.hiddenPlugins.sort()).toEqual(['p1', 'p2']);
    expect(effective.hiddenExtensions).toEqual(['p1/a']);
  });

  it('前端归一化忽略未知项并回退默认值', () => {
    const effective = normalizeEffectiveStudentUiPolicy({
      features: { 'widget.quick-stats': false, 'widget.unknown': false },
      hiddenPlugins: ['p1'],
      revision: 'r1',
    });
    expect(effective.features['widget.quick-stats']).toBe(false);
    expect(effective.features['widget.upcoming-assignments']).toBe(true);
    expect(effective.hiddenPlugins).toEqual(['p1']);
    expect(effective.revision).toBe('r1');
  });

  it('拒绝缺失版本、错误版本与非对象 features', () => {
    expect(validateStudentUiPolicyDocument({ features: {} })).toMatchObject({ ok: false });
    expect(validateStudentUiPolicyDocument({ version: 2, features: {} })).toMatchObject({ ok: false });
    expect(validateStudentUiPolicyDocument({ version: 1, features: [] })).toMatchObject({ ok: false });
    expect(validateStudentUiPolicyDocument(null)).toMatchObject({ ok: false });
  });

  it('数组上限 200、id 长度 160、空串与非字符串一律拒绝', () => {
    const tooMany = Array.from({ length: 201 }, (_, index) => `p${index}`);
    expect(validateStudentUiPolicyDocument({ version: 1, hiddenPlugins: tooMany })).toMatchObject({ ok: false });
    expect(validateStudentUiPolicyDocument({ version: 1, hiddenPlugins: ['x'.repeat(161)] })).toMatchObject({
      ok: false,
    });
    expect(validateStudentUiPolicyDocument({ version: 1, hiddenPlugins: ['  '] })).toMatchObject({ ok: false });
    expect(validateStudentUiPolicyDocument({ version: 1, hiddenExtensions: [1] })).toMatchObject({ ok: false });
  });

  it('合法数组会 trim 并按原顺序去重', () => {
    const result = validateStudentUiPolicyDocument({
      version: 1,
      hiddenExtensions: [' p1/a ', 'p1/a', 'p2/b'],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.hiddenExtensions).toEqual(['p1/a', 'p2/b']);
  });

  it('损坏的 policy_json 解析为空层而不是抛错', () => {
    const broken = parseStoredStudentUiPolicy('{broken');
    expect(broken.features).toEqual({});
    expect(broken.hiddenPlugins).toEqual([]);
    expect(broken.hiddenExtensions).toEqual([]);

    const valid = parseStoredStudentUiPolicy(JSON.stringify({ version: 1, features: { 'widget.quick-stats': false } }));
    expect(valid.features['widget.quick-stats']).toBe(false);
  });

  it('无策略层时全部功能默认可见且 source 为 default', () => {
    const effective = resolveEffectiveStudentUiPolicy([]);
    expect(STUDENT_UI_FEATURE_IDS.every((id) => effective.features[id] === true)).toBe(true);
    expect(STUDENT_UI_FEATURE_IDS.every((id) => effective.sources[id] === 'default')).toBe(true);
    expect(effective.hideGuidance).toBe(false);
    expect(effective.hiddenPlugins).toEqual([]);
    expect(effective.hiddenExtensions).toEqual([]);
  });

  it('isPluginHiddenByPolicy 支持整插件与 pluginId/extensionId 复合键', () => {
    const policy = { hiddenPlugins: ['p1'], hiddenExtensions: ['p2/ext-a'] };
    expect(isPluginHiddenByPolicy(policy, 'p1')).toBe(true);
    expect(isPluginHiddenByPolicy(policy, 'p2', 'ext-a')).toBe(true);
    expect(isPluginHiddenByPolicy(policy, 'p2', 'ext-b')).toBe(false);
    expect(isPluginHiddenByPolicy(policy, 'p3')).toBe(false);
    expect(isPluginHiddenByPolicy(null, 'p1')).toBe(false);
  });

  it('widgetFeatureId 与功能白名单保持一致', () => {
    expect(widgetFeatureId('quick-stats')).toBe('widget.quick-stats');
    expect(STUDENT_UI_FEATURE_IDS).toContain(widgetFeatureId('extension-views'));
  });
});
