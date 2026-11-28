import { describe, it, expect } from 'vitest';
import {
  ELEMENT_CAPABILITIES,
  FULLSCREEN_READONLY_INTERACTIVE_ELEMENT_TYPES,
  NON_TILEABLE_ELEMENT_TYPES,
  findElementCapability,
  getDefaultElementSize,
  getElementCapability,
  isVisibleElementType,
  resolveElementText,
  resolveElementTitle,
} from '../element-capabilities';
import { FULLSCREEN_READONLY_INTERACTIVE_TYPES, resolveFullscreenReadOnlyPolicy } from '../view-model';
import { NON_TILEABLE_TYPES, isTileableType } from '../../utils/auto-tiling';
import { belongsToPage } from '../../utils/pagination-utils';

/**
 * `InteractiveWhiteboard.renderElement` 里真实存在的 `el.type === '...'` 分支。
 * 能力表必须覆盖它们，否则新增/改名的类型会绕过默认尺寸与全屏口径。
 */
const RENDER_BRANCH_TYPES = [
  'plugin',
  'hello-world',
  'rollcall',
  'quiz',
  'assignment',
  'pen',
  'highlighter',
  'rectangle',
  'shape',
  'circle',
  'text',
  'code-sandbox',
  'math-graph',
  'presentation',
  'html-applet',
  'learning_surface',
  'whiteboard.renderer',
  'page_meta',
];

/** 迁移前 `useAutoTilingState.DEFAULT_ELEMENT_SIZE` 的登记值。 */
const LEGACY_DEFAULT_SIZES: Array<[string, { width: number; height: number }]> = [
  ['quiz', { width: 340, height: 380 }],
  ['timer', { width: 280, height: 200 }],
  ['assignment', { width: 340, height: 400 }],
  ['rollcall', { width: 340, height: 420 }],
  ['html-applet', { width: 400, height: 300 }],
  ['learning_surface', { width: 640, height: 400 }],
  ['code-sandbox', { width: 400, height: 320 }],
  ['math-graph', { width: 400, height: 350 }],
  ['presentation', { width: 600, height: 400 }],
  ['plugin', { width: 500, height: 400 }],
];

describe('能力表：结构完整性', () => {
  it('类型唯一，不存在重复登记', () => {
    const types = ELEMENT_CAPABILITIES.map((capability) => capability.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it('覆盖所有内置渲染分支', () => {
    for (const type of RENDER_BRANCH_TYPES) {
      expect(findElementCapability(type), `${type} 缺少能力表项`).toBeDefined();
    }
  });

  it('每个表项的 label 非空且 kind 明确', () => {
    for (const capability of ELEMENT_CAPABILITIES) {
      expect(capability.label.trim().length, `${capability.type} label 为空`).toBeGreaterThan(0);
      expect(capability.kind).not.toBe('unknown');
    }
  });
});

describe('能力表：默认尺寸', () => {
  it.each(LEGACY_DEFAULT_SIZES)('%s 保持迁移前的默认尺寸', (type, expected) => {
    expect(getDefaultElementSize(type, null)).toEqual(expected);
    expect(getElementCapability(type).defaultSize).toEqual(expected);
  });

  it('未登记预设的图形/手绘类型仍回落 300×300', () => {
    for (const type of ['text', 'rectangle', 'shape', 'circle', 'pen', 'highlighter', 'hello-world']) {
      expect(getDefaultElementSize(type, null), type).toEqual({ width: 300, height: 300 });
    }
  });

  it('data 中显式宽高优先，0 视为未设置并回落默认值', () => {
    expect(getDefaultElementSize('quiz', { width: 120, height: 80 })).toEqual({ width: 120, height: 80 });
    expect(getDefaultElementSize('quiz', { width: 0, height: 0 })).toEqual({ width: 340, height: 380 });
    expect(getDefaultElementSize('mystery', { width: 50 })).toEqual({ width: 50, height: 300 });
  });
});

describe('能力表：未知类型安全兜底', () => {
  it('findElementCapability 对未知/空值返回 undefined', () => {
    expect(findElementCapability('mystery-widget')).toBeUndefined();
    expect(findElementCapability(undefined)).toBeUndefined();
    expect(findElementCapability(null)).toBeUndefined();
    expect(findElementCapability('')).toBeUndefined();
  });

  it('getElementCapability 的兜底与迁移前的隐式行为一致', () => {
    const capability = getElementCapability('mystery-widget');
    expect(capability).toMatchObject({
      kind: 'unknown',
      label: '未知组件',
      defaultSize: { width: 300, height: 300 },
      tileable: true,
      visible: true,
      fullscreenReadOnlyInteractive: false,
      sizeInput: 'width-height',
      sidebarCard: false,
    });
  });

  it('未知类型默认可见、可平铺、全屏只读时被锁定', () => {
    expect(isVisibleElementType('mystery-widget')).toBe(true);
    expect(isTileableType('mystery-widget')).toBe(true);

    const policy = resolveFullscreenReadOnlyPolicy({ readOnly: true, elementType: 'mystery-widget' });
    expect(policy.contentInteractive).toBe(false);
    expect(policy.showLockCover).toBe(true);
  });
});

describe('能力表：page_meta 不是普通图元', () => {
  it('不可见、不可平铺、无尺寸输入', () => {
    const meta = getElementCapability('page_meta');
    expect(meta.visible).toBe(false);
    expect(meta.tileable).toBe(false);
    expect(meta.sizeInput).toBe('none');
    expect(meta.fullscreenReadOnlyInteractive).toBe(false);
  });

  it('分页过滤把 page_meta 排除在可见元素之外', () => {
    expect(isVisibleElementType('page_meta')).toBe(false);
    expect(belongsToPage({ id: 'meta', type: 'page_meta', data: '{}' }, 0, [])).toBe(false);
  });
});

describe('resolveElementText：文本字段类型保护', () => {
  it('字符串原样返回（包括空字符串）', () => {
    expect(resolveElementText('题目')).toBe('题目');
    expect(resolveElementText('')).toBe('');
  });

  it.each<[string, unknown]>([
    ['undefined', undefined],
    ['null', null],
    ['数字', 123],
    ['布尔值', false],
    ['对象', { not: 'a string' }],
    ['数组', ['a']],
  ])('%s 回落到兜底文本', (_name, value) => {
    expect(resolveElementText(value, '兜底文本')).toBe('兜底文本');
  });

  it('未指定兜底时返回空字符串，而不是非字符串', () => {
    expect(resolveElementText({})).toBe('');
  });
});

describe('resolveElementTitle：标题类型保护', () => {
  it('非空字符串原样返回', () => {
    expect(resolveElementTitle('随堂测验', '默认标题')).toBe('随堂测验');
    // 保持历史口径：仅空白字符的字符串仍然是「有效标题」，不做 trim 改写
    expect(resolveElementTitle('  ', '默认标题')).toBe('  ');
  });

  it.each<[string, unknown]>([
    ['undefined', undefined],
    ['null', null],
    ['空字符串', ''],
    ['数字', 123],
    ['布尔值', true],
    ['对象', { not: 'a string' }],
    ['数组', ['a']],
  ])('%s 回落到默认标题', (_name, value) => {
    expect(resolveElementTitle(value, '默认标题')).toBe('默认标题');
  });

  it('默认标题为空字符串时也只会返回字符串', () => {
    expect(resolveElementTitle({}, '')).toBe('');
  });
});

describe('createDefaults：新建元素默认值', () => {
  it('未登记默认值的类型返回 undefined（走通用合并路径）', () => {
    for (const type of ['rectangle', 'text', 'pen', 'page_meta', 'mystery-widget']) {
      expect(getElementCapability(type).createDefaults, type).toBeUndefined();
    }
  });

  it.each<[string, Record<string, unknown>, Record<string, unknown>]>([
    ['code-sandbox', {}, { code: "console.log('Hello Sandbox!');" }],
    ['math-graph', {}, { equation: 'Math.sin(x)' }],
    ['presentation', {}, { markdown: '# Title Slide\n---\n## Slide 2', width: 600, height: 400, slideX: 0, slideY: 0 }],
    ['quiz', {}, { question: 'New Quiz', options: ['A', 'B', 'C', 'D'] }],
    ['assignment', {}, { title: 'New Assignment', description: '' }],
    ['hello-world', {}, {}],
    ['rollcall', {}, { allStudents: [] }],
  ])('%s 在无内容时补齐默认值', (type, content, expected) => {
    expect(getElementCapability(type).createDefaults?.(content)).toEqual(expected);
  });

  it('调用方内容覆盖默认值', () => {
    expect(getElementCapability('quiz').createDefaults?.({ question: 'Q', options: ['X'] })).toEqual({
      question: 'Q',
      options: ['X'],
    });
    expect(getElementCapability('code-sandbox').createDefaults?.({ code: 'x' })).toEqual({ code: 'x' });
    expect(getElementCapability('presentation').createDefaults?.({ markdown: '# X' })).toEqual({
      markdown: '# X',
      width: 600,
      height: 400,
      slideX: 0,
      slideY: 0,
    });
  });

  it('quiz options 非数组时回落到默认选项', () => {
    expect(getElementCapability('quiz').createDefaults?.({ options: 'A,B' })?.options).toEqual(['A', 'B', 'C', 'D']);
  });

  it('空字符串仍然算「调用方给了值」，保持历史 ?? 语义', () => {
    expect(getElementCapability('assignment').createDefaults?.({ title: '' })).toEqual({
      title: '',
      description: '',
    });
  });
});

describe('能力表与既有消费方的一致性', () => {
  it('全屏只读白名单只来自能力表（quiz / assignment）', () => {
    expect([...FULLSCREEN_READONLY_INTERACTIVE_TYPES].sort()).toEqual(
      [...FULLSCREEN_READONLY_INTERACTIVE_ELEMENT_TYPES].sort(),
    );
    expect([...FULLSCREEN_READONLY_INTERACTIVE_TYPES].sort()).toEqual(['assignment', 'quiz']);

    for (const type of ['quiz', 'assignment']) {
      expect(resolveFullscreenReadOnlyPolicy({ readOnly: true, elementType: type }).contentInteractive, type).toBe(
        true,
      );
    }
    for (const type of ['rollcall', 'html-applet', 'presentation', 'code-sandbox']) {
      expect(resolveFullscreenReadOnlyPolicy({ readOnly: true, elementType: type }).contentInteractive, type).toBe(
        false,
      );
    }
  });

  it('平铺黑名单与能力表的 tileable 完全一致', () => {
    expect([...NON_TILEABLE_TYPES].sort()).toEqual([...NON_TILEABLE_ELEMENT_TYPES].sort());
    expect([...NON_TILEABLE_TYPES].sort()).toEqual(['highlighter', 'page_meta', 'pen']);

    for (const capability of ELEMENT_CAPABILITIES) {
      expect(isTileableType(capability.type), capability.type).toBe(capability.tileable);
    }
  });

  it('属性侧栏的组件卡片集合保持迁移前口径（回归钉）', () => {
    const cardTypes = ELEMENT_CAPABILITIES.filter((capability) => capability.sidebarCard)
      .map((capability) => capability.type)
      .sort();

    expect(cardTypes).toEqual(
      [
        'assignment',
        'code-sandbox',
        'hello-world',
        'learning_surface',
        'math-graph',
        'plugin',
        'presentation',
        'quiz',
        'rollcall',
      ].sort(),
    );
  });

  it('尺寸输入形态：circle 编辑半径，手绘无尺寸，其余非卡片类型编辑宽高', () => {
    expect(getElementCapability('circle').sizeInput).toBe('radius');
    expect(getElementCapability('pen').sizeInput).toBe('none');
    expect(getElementCapability('highlighter').sizeInput).toBe('none');

    for (const type of ['text', 'rectangle', 'shape', 'html-applet', 'timer', 'whiteboard.renderer']) {
      expect(getElementCapability(type).sizeInput, type).toBe('width-height');
    }

    for (const type of ['quiz', 'assignment', 'rollcall', 'code-sandbox', 'math-graph', 'presentation']) {
      expect(getElementCapability(type).sizeInput, type).toBe('none');
    }
  });
});
