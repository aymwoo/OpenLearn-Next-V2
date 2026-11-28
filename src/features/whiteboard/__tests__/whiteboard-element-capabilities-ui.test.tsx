import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import {
  WhiteboardPropertiesSidebar,
  type WhiteboardPropertiesSidebarProps,
} from '../components/WhiteboardPropertiesSidebar';
import { ELEMENT_CAPABILITIES } from '../core/element-capabilities';

/**
 * 能力表 → 属性侧栏的契约测试。
 *
 * 目的：能力表里的 `sidebarCard` / `sizeInput` 若与侧栏实际渲染脱节，
 * 这里会红 —— 不必再靠人工点开每种组件去确认「尺寸输入还在不在」。
 */

vi.mock('../components/AssignmentBindingField', () => ({
  AssignmentBindingField: () => <div data-testid="mock-assignment-binding" />,
}));
vi.mock('../components/AssignmentPeerProgressPanel', () => ({
  AssignmentPeerProgressPanel: () => <div data-testid="mock-peer-progress" />,
}));
vi.mock('../components/LearningSurfaceBindingPanel', () => ({
  LearningSurfaceBindingPanel: () => <div data-testid="mock-learning-surface" />,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const buildProps = (
  type: string,
  overrides: Partial<WhiteboardPropertiesSidebarProps> = {},
): WhiteboardPropertiesSidebarProps => {
  const id = `el-${type}`;
  return {
    isEditMode: true,
    selectedShapeId: id,
    setSelectedShapeId: vi.fn(),
    activePropertiesElementId: id,
    setActivePropertiesElementId: vi.fn(),
    safeElements: [{ id, type, data: '{}' }],
    editingProperties: {
      width: 200,
      height: 120,
      radius: 50,
      question: 'Q',
      options: ['A', 'B'],
      title: 'T',
      description: 'D',
      code: 'console.log(1)',
      equation: 'Math.sin(x)',
      markdown: '# Slide',
      text: 'Hello',
      fontSize: 16,
      color: '#000000',
      stroke: '#000000',
    },
    handleLocalPropChange: vi.fn(),
    handlePropBlur: vi.fn(),
    handleNumericPropBlur: vi.fn(),
    handlePropsUpdate: vi.fn(),
    handleUpdateElementData: vi.fn(),
    handleElementDelete: vi.fn(),
    handleUndoProp: vi.fn(),
    handleRedoProp: vi.fn(),
    propertyUndoStack: {},
    propertyRedoStack: {},
    isSyncing: false,
    lessonId: 'lesson-capabilities',
    handleAddOption: vi.fn(),
    handleRemoveOption: vi.fn(),
    handleOptionChangeLocal: vi.fn(),
    handleOptionBlur: vi.fn(),
    ...overrides,
  };
};

const widthHeightTypes = ELEMENT_CAPABILITIES.filter((capability) => capability.sizeInput === 'width-height').map(
  (capability) => capability.type,
);

const radiusTypes = ELEMENT_CAPABILITIES.filter((capability) => capability.sizeInput === 'radius').map(
  (capability) => capability.type,
);

const noSizeInputTypes = ELEMENT_CAPABILITIES.filter(
  (capability) => !capability.sidebarCard && capability.sizeInput === 'none',
).map((capability) => capability.type);

const sidebarCardTypes = ELEMENT_CAPABILITIES.filter((capability) => capability.sidebarCard).map(
  (capability) => capability.type,
);

describe('能力表 → 属性侧栏：尺寸输入形态', () => {
  it.each(widthHeightTypes)('%s 提供宽高输入', (type) => {
    render(<WhiteboardPropertiesSidebar {...buildProps(type)} />);

    expect(screen.getByText('属性编辑器')).toBeDefined();
    expect(screen.getByText('宽度 (Width)')).toBeDefined();
    expect(screen.getByText('高度 (Height)')).toBeDefined();
  });

  it.each(radiusTypes)('%s 只提供半径输入', (type) => {
    render(<WhiteboardPropertiesSidebar {...buildProps(type)} />);

    expect(screen.getByText('半径 (Radius)')).toBeDefined();
    expect(screen.queryByText('宽度 (Width)')).toBeNull();
  });

  it.each(noSizeInputTypes)('%s 不提供尺寸区块', (type) => {
    render(<WhiteboardPropertiesSidebar {...buildProps(type)} />);

    expect(screen.queryByText('尺寸')).toBeNull();
    expect(screen.queryByText('宽度 (Width)')).toBeNull();
  });
});

describe('能力表 → 属性侧栏：组件卡片', () => {
  it.each(sidebarCardTypes)('%s 在未显式打开属性面板时不自动展开', (type) => {
    const props = buildProps(type, { activePropertiesElementId: null });
    const { container } = render(<WhiteboardPropertiesSidebar {...props} />);

    expect(container.firstChild).toBeNull();
  });

  it.each(sidebarCardTypes)('%s 显式打开后不提供宽高输入', (type) => {
    render(<WhiteboardPropertiesSidebar {...buildProps(type)} />);

    expect(screen.getByText('属性编辑器')).toBeDefined();
    expect(screen.queryByText('尺寸')).toBeNull();
    expect(screen.queryByText('宽度 (Width)')).toBeNull();
  });
});
