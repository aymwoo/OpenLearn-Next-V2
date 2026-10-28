/**
 * Unit tests for manifestSchema — zod runtime validation.
 *
 * Covers:
 * - Valid manifest.json passes parse()
 * - Rejects missing id/name/version/main
 * - Optional fields accept valid arrays
 * - Empty arrays for requires/optional/capabilitiesProposed accepted
 * - Type inference via z.infer
 */
import { describe, it, expect } from 'vitest';
import { manifestSchema, manifestSchemaV3 } from '../manifest-schema.js';

describe('manifestSchema', () => {
  // --- 合法 manifest 通过 ------------------------------------------------

  it('should accept valid manifest with all required fields', () => {
    const manifest = {
      id: 'ext-countdown-timer',
      name: 'Countdown Timer',
      version: '1.0.0',
      main: 'index.js',
    };
    expect(() => manifestSchema.parse(manifest)).not.toThrow();
  });

  // --- 非法 manifest 被拒绝 ------------------------------------------------

  it.each([
    { missing: 'id', data: { name: 'X', version: '1.0.0', main: 'index.js' } },
    { missing: 'name', data: { id: 'x', version: '1.0.0', main: 'index.js' } },
    { missing: 'version', data: { id: 'x', name: 'X', main: 'index.js' } },
    { missing: 'main', data: { id: 'x', name: 'X', version: '1.0.0' } },
  ])('should reject manifest missing $missing', ({ data }) => {
    expect(() => manifestSchema.parse(data)).toThrow();
  });

  // --- 空字符串被拒绝 -----------------------------------------------------

  it.each([
    { field: 'id', data: { id: '', name: 'X', version: '1.0.0', main: 'index.js' } },
    { field: 'name', data: { id: 'x', name: '', version: '1.0.0', main: 'index.js' } },
    { field: 'version', data: { id: 'x', name: 'X', version: '', main: 'index.js' } },
    { field: 'main', data: { id: 'x', name: 'X', version: '1.0.0', main: '' } },
  ])('should reject manifest with empty $field string', ({ data }) => {
    expect(() => manifestSchema.parse(data)).toThrow();
  });

  // --- 可选字段 ----------------------------------------------------------

  it('should accept manifest with optional fields filled', () => {
    const manifest = {
      id: 'ext-quiz',
      name: 'Quiz Generator',
      version: '1.0.0',
      main: 'index.js',
      requires: ['@openlearn/core:ICommandBusService'],
      optional: ['@openlearn/core:IAIService'],
      capabilitiesProposed: ['lesson:write'],
    };
    expect(() => manifestSchema.parse(manifest)).not.toThrow();
  });

  it('should accept manifest with icon, description and author fields', () => {
    const manifest = {
      id: 'ext-custom-icon',
      name: 'Custom Icon Plugin',
      version: '1.0.0',
      main: 'index.js',
      icon: 'BookOpen',
      description: 'A plugin with custom icon',
      author: 'Tester',
    };
    const parsed = manifestSchema.parse(manifest);
    expect(parsed.icon).toBe('BookOpen');
    expect(parsed.description).toBe('A plugin with custom icon');
    expect(parsed.author).toBe('Tester');
  });

  it('should preserve anchor:* contribution keys via passthrough (v0.2.6)', () => {
    const manifest = {
      id: 'ext-anchor-demo',
      name: 'Anchor Demo',
      version: '1.0.0',
      main: 'index.js',
      contributes: {
        'classroom.tool': [{ id: 't1', name: 'T1', commandType: 't1.cmd' }],
        'anchor:whiteboard-toolbar:rollcall': [{ id: 'my-btn', label: 'My Button', placement: 'before' }],
      },
    };
    const parsed = manifestSchema.parse(manifest);
    expect(parsed.contributes).toBeDefined();
    expect((parsed.contributes as any)['anchor:whiteboard-toolbar:rollcall']).toEqual([
      { id: 'my-btn', label: 'My Button', placement: 'before' },
    ]);
  });

  it('should accept assessment extension slots in contributes (Issue #183)', () => {
    const manifest = {
      id: 'ext-assessment-tools',
      name: 'Assessment Tools',
      version: '1.0.0',
      main: 'index.js',
      contributes: {
        'assessment.list.card': [{ id: 'list-badge', label: '题库统计' }],
        'assessment.attempt.toolbar': [{ id: 'calc', label: '计算器' }],
        'assessment.stats.card': [{ id: 'chart', label: '自定义图表' }],
      },
    };
    const parsed = manifestSchema.parse(manifest);
    expect((parsed.contributes as any)['assessment.list.card']).toEqual([{ id: 'list-badge', label: '题库统计' }]);
    expect((parsed.contributes as any)['assessment.attempt.toolbar']).toEqual([{ id: 'calc', label: '计算器' }]);
    expect((parsed.contributes as any)['assessment.stats.card']).toEqual([{ id: 'chart', label: '自定义图表' }]);
  });

  it('should accept manifest with empty optional arrays', () => {
    const manifest = {
      id: 'ext-quiz',
      name: 'Quiz Generator',
      version: '1.0.0',
      main: 'index.js',
      requires: [],
      optional: [],
      capabilitiesProposed: [],
    };
    expect(() => manifestSchema.parse(manifest)).not.toThrow();
  });

  // --- 类型推导 (compile-time check) ------------------------------------

  it('should support type inference via z.infer', () => {
    const manifest = manifestSchema.parse({
      id: 'test',
      name: 'Test',
      version: '1.0.0',
      main: 'index.js',
    });
    // TypeScript 编译时类型应为 Manifest (z.infer)
    expect(manifest.id).toBe('test');
    expect(manifest.name).toBe('Test');
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.main).toBe('index.js');
  });

  // --- manifest-invalid.json fixture 被拒绝 -----------------------------

  it('should reject manifest-invalid.json fixture (missing name/version/main)', () => {
    const invalidData = { id: 'test' };
    expect(() => manifestSchema.parse(invalidData)).toThrow();
  });
});

describe('manifestSchema — Phase 6 @version regex', () => {
  it('should accept requires with @^version suffix', () => {
    const manifest = {
      id: 'ext-quiz',
      name: 'Quiz Generator',
      version: '1.0.0',
      main: 'index.js',
      requires: ['@openlearn/core:ICommandBusService@^1.0.0'],
    };
    expect(() => manifestSchema.parse(manifest)).not.toThrow();
  });

  it('should accept requires with @~version suffix', () => {
    const manifest = {
      id: 'ext-quiz',
      name: 'Quiz Generator',
      version: '1.0.0',
      main: 'index.js',
      requires: ['@openlearn/core:IEventBusService@~1.2.0'],
    };
    expect(() => manifestSchema.parse(manifest)).not.toThrow();
  });

  it('should accept requires with exact version (no prefix)', () => {
    const manifest = {
      id: 'ext-quiz',
      name: 'Quiz Generator',
      version: '1.0.0',
      main: 'index.js',
      requires: ['@openlearn/core:IStorageService@1.0.0'],
    };
    expect(() => manifestSchema.parse(manifest)).not.toThrow();
  });

  it('should accept requires with pre-release version', () => {
    const manifest = {
      id: 'ext-quiz',
      name: 'Quiz Generator',
      version: '1.0.0',
      main: 'index.js',
      requires: ['@openlearn/core:IAIService@^1.0.0-beta.1'],
    };
    expect(() => manifestSchema.parse(manifest)).not.toThrow();
  });

  it('should accept requires without @version (backward compatible)', () => {
    const manifest = {
      id: 'ext-quiz',
      name: 'Quiz Generator',
      version: '1.0.0',
      main: 'index.js',
      requires: ['@openlearn/core:ICommandBusService'],
    };
    expect(() => manifestSchema.parse(manifest)).not.toThrow();
  });

  it('should reject requires with invalid format', () => {
    const manifest = {
      id: 'ext-quiz',
      name: 'Quiz Generator',
      version: '1.0.0',
      main: 'index.js',
      requires: ['invalid-format'],
    };
    expect(() => manifestSchema.parse(manifest)).toThrow();
  });

  it('should reject requires with incomplete version (missing patch)', () => {
    const manifest = {
      id: 'ext-quiz',
      name: 'Quiz Generator',
      version: '1.0.0',
      main: 'index.js',
      requires: ['@openlearn/core:ICommandBusService@^1.0'],
    };
    // ^1.0 is not a valid semver — should be ^1.0.0
    expect(() => manifestSchema.parse(manifest)).toThrow();
  });

  // optional field also supports @version
  it('should accept optional with @^version suffix', () => {
    const manifest = {
      id: 'ext-quiz',
      name: 'Quiz Generator',
      version: '1.0.0',
      main: 'index.js',
      optional: ['@openlearn/core:IAIService@^2.0.0'],
    };
    expect(() => manifestSchema.parse(manifest)).not.toThrow();
  });
});

describe('manifestSchemaV3 — Phase 3 backward compatibility', () => {
  it('should accept requires without @version', () => {
    const manifest = {
      id: 'ext-quiz',
      name: 'Quiz Generator',
      version: '1.0.0',
      main: 'index.js',
      requires: ['@openlearn/core:ICommandBusService'],
    };
    expect(() => manifestSchemaV3.parse(manifest)).not.toThrow();
  });

  it('should reject requires with @version suffix', () => {
    const manifest = {
      id: 'ext-quiz',
      name: 'Quiz Generator',
      version: '1.0.0',
      main: 'index.js',
      requires: ['@openlearn/core:ICommandBusService@^1.0.0'],
    };
    expect(() => manifestSchemaV3.parse(manifest)).toThrow();
  });

  it('should accept optional without @version', () => {
    const manifest = {
      id: 'ext-quiz',
      name: 'Quiz Generator',
      version: '1.0.0',
      main: 'index.js',
      optional: ['@openlearn/core:IAIService'],
    };
    expect(() => manifestSchemaV3.parse(manifest)).not.toThrow();
  });

  it('should accept empty requires/optional', () => {
    const manifest = {
      id: 'ext-quiz',
      name: 'Quiz Generator',
      version: '1.0.0',
      main: 'index.js',
      requires: [],
      optional: [],
    };
    expect(() => manifestSchemaV3.parse(manifest)).not.toThrow();
  });
});

/**
 * v0.7.6 双轨制 UI 的 view 字段必须**穿过** zod 校验。
 *
 * 背景：第三方 ZIP 插件被强制 process 模式，无法把 React 组件函数交给宿主
 * （DataCloneError），可见 UI 只能靠 contributes[*].view 指向沙箱 HTML。
 * 而 zod 的 z.object 默认 strip 未声明键 —— 一旦漏声明 view，parse() 会把它
 * 静默删掉，装进 DB 的 manifest 就丢了 view，宿主退回「占位空态」，表现为
 * 插件页签白屏且日志无任何报错。本组用例防止该字段再次被漏掉。
 */
describe('manifestSchema — 声明式可视沙箱视图 view 不被 strip', () => {
  const base = {
    id: 'ext-view-probe',
    name: 'View Probe',
    version: '1.0.0',
    main: 'index.js',
  };

  it.each([
    ['teacher.tab', { id: 'tab_1', label: '看板', view: 'storage/dashboard.html' }],
    ['teacher.panel', { id: 'panel_1', title: '面板', view: 'storage/panel.html' }],
    ['student.view', { id: 'sv_1', label: '学生视图', view: 'storage/student.html' }],
    ['student.lesson.tool', { id: 'tool_1', label: '求助', view: 'storage/overlay.html' }],
    ['teacher.dashboard.widget', { id: 'w_1', label: '小组件', view: 'storage/widget.html' }],
    // 该槽位由 frontendSlotEntrySchema(.passthrough) 校验，view 本就应保留
    ['student.classroom.overlay', { id: 'ov_1', label: '求助', view: 'storage/overlay.html' }],
  ])('keeps view for contributes["%s"]', (slot, entry) => {
    const parsed = manifestSchema.parse({
      ...base,
      contributes: { [slot]: [entry] },
    }) as Record<string, Record<string, Array<Record<string, unknown>>>>;

    expect(parsed.contributes[slot][0].view).toBe(entry.view);
  });

  it('rejects empty view so a typo cannot silently disable the iframe', () => {
    expect(() =>
      manifestSchema.parse({
        ...base,
        contributes: { 'teacher.tab': [{ id: 'tab_1', label: '看板', view: '' }] },
      }),
    ).toThrow();
  });
});
