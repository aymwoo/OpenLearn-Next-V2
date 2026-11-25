import { describe, it, expect, vi, afterEach } from 'vitest';
import { assessmentQuestionTypeUiRegistry } from '../question-type-ui-registry';
import { registerBuiltinQuestionTypeUis } from '../register-builtin-question-uis';

describe('Issue #121 · 测评题型 UI 注册表', () => {
  afterEach(() => {
    // 清掉插件注册的题型，避免用例之间互相污染（内置题型保留）
    for (const owner of ['ext-a', 'ext-b', 'ext-snap']) {
      assessmentQuestionTypeUiRegistry.clearOwned(owner);
    }
    for (const type of assessmentQuestionTypeUiRegistry.list().map((t) => t.type)) {
      if (type.includes(':')) assessmentQuestionTypeUiRegistry.unregister(type);
    }
  });

  it('内置 5 种题型已注册，且与后端类型标识一致', () => {
    registerBuiltinQuestionTypeUis();
    const types = assessmentQuestionTypeUiRegistry
      .list()
      .map((t) => t.type)
      .sort();
    expect(types).toEqual(['fill_blank', 'multiple_choice', 'short_answer', 'single_choice', 'true_false']);
  });

  it('内置题型都提供默认配置与编辑器', () => {
    registerBuiltinQuestionTypeUis();
    for (const type of assessmentQuestionTypeUiRegistry.list()) {
      expect(typeof type.Editor).toBe('function');
      expect(type.createDefaultConfig?.()).toBeTypeOf('object');
    }
  });

  it('重复注册抛错（静默覆盖会让"插件题型被顶掉"变成幽灵 bug）', () => {
    registerBuiltinQuestionTypeUis();
    expect(() =>
      assessmentQuestionTypeUiRegistry.register({
        ...assessmentQuestionTypeUiRegistry.get('single_choice')!,
      }),
    ).toThrow(/duplicate/);
  });

  it('clearOwned 只清理该插件的题型，且不误伤内置题型', () => {
    registerBuiltinQuestionTypeUis();
    const base = assessmentQuestionTypeUiRegistry.get('single_choice')!;
    assessmentQuestionTypeUiRegistry.register({ ...base, type: 'ext-a:one' }, 'ext-a');
    assessmentQuestionTypeUiRegistry.register({ ...base, type: 'ext-b:two' }, 'ext-b');

    expect(assessmentQuestionTypeUiRegistry.clearOwned('ext-a')).toBe(1);
    expect(assessmentQuestionTypeUiRegistry.get('ext-a:one')).toBeUndefined();
    expect(assessmentQuestionTypeUiRegistry.get('ext-b:two')).toBeDefined();
    expect(assessmentQuestionTypeUiRegistry.get('single_choice')).toBeDefined();

    // 别的插件不能按 type 卸掉
    expect(assessmentQuestionTypeUiRegistry.unregister('ext-b:two', 'ext-a')).toBe(false);
    expect(assessmentQuestionTypeUiRegistry.get('ext-b:two')).toBeDefined();
  });

  it('缺少 type 或 Editor 时注册失败', () => {
    expect(() => assessmentQuestionTypeUiRegistry.register({} as any)).toThrow(/type is required/);
    expect(() => assessmentQuestionTypeUiRegistry.register({ type: 'x:y', label: { zh: '', en: '' } } as any)).toThrow(
      /Editor must be a component/,
    );
  });

  it('manifest 声明可被同 owner 的 inline 注册覆盖，停用后回退', () => {
    registerBuiltinQuestionTypeUis();
    const base = assessmentQuestionTypeUiRegistry.get('single_choice')!;
    assessmentQuestionTypeUiRegistry.register({ ...base, type: 'ext-a:match' }, 'ext-a', { origin: 'manifest' });
    expect(assessmentQuestionTypeUiRegistry.get('ext-a:match')?.label.zh).toBe(base.label.zh);

    assessmentQuestionTypeUiRegistry.register(
      { ...base, type: 'ext-a:match', label: { zh: '内联连线', en: 'Inline matching' } },
      'ext-a',
      { origin: 'inline' },
    );
    expect(assessmentQuestionTypeUiRegistry.get('ext-a:match')?.label.zh).toBe('内联连线');

    // 激活失败/停用但保留声明式贡献时，应恢复 manifest 版本而不是删除
    assessmentQuestionTypeUiRegistry.clearOwned('ext-a', { preserveManifest: true });
    expect(assessmentQuestionTypeUiRegistry.get('ext-a:match')?.label.zh).toBe(base.label.zh);
  });

  it('跨插件的 manifest 冲突先到先得且不阻断激活', () => {
    registerBuiltinQuestionTypeUis();
    const base = assessmentQuestionTypeUiRegistry.get('single_choice')!;
    assessmentQuestionTypeUiRegistry.register({ ...base, type: 'ext-a:shared' }, 'ext-a', { origin: 'manifest' });
    expect(() =>
      assessmentQuestionTypeUiRegistry.register(
        { ...base, type: 'ext-a:shared', label: { zh: 'B 的题型', en: 'B' } },
        'ext-b',
        { origin: 'manifest' },
      ),
    ).not.toThrow();
    expect(assessmentQuestionTypeUiRegistry.get('ext-a:shared')?.label.zh).toBe(base.label.zh);
  });

  it('getSnapshot 在状态未变时保持同一引用（useSyncExternalStore 前提）', () => {
    registerBuiltinQuestionTypeUis();
    const first = assessmentQuestionTypeUiRegistry.getSnapshot();
    expect(assessmentQuestionTypeUiRegistry.getSnapshot()).toBe(first);

    const base = assessmentQuestionTypeUiRegistry.get('single_choice')!;
    assessmentQuestionTypeUiRegistry.register({ ...base, type: 'ext-snap:one' }, 'ext-snap');
    expect(assessmentQuestionTypeUiRegistry.getSnapshot()).not.toBe(first);
  });
});
