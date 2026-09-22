import { describe, it, expect, afterEach } from 'vitest';
import { FlaskConical } from 'lucide-react';
import {
  SEGMENT_TYPES,
  registerCustomSegmentType,
  unregisterCustomSegmentType,
  getAllSegmentTypes,
  getSegmentType,
} from '../../teacher/lesson-editor/timelineConfig';

describe('Plugin Extensibility for Interactive Classroom', () => {
  afterEach(() => {
    // 模块级注册表是全局的：避免污染同文件内的其他用例。
    unregisterCustomSegmentType('scientific_experiment');
  });

  it('allows third-party plugins to dynamically register new lesson timeline segments', () => {
    const initialCount = getAllSegmentTypes().length;

    // Third-party plugin registers a custom "scientific_experiment" (科学探究实验) segment type
    registerCustomSegmentType({
      id: 'scientific_experiment',
      labelZh: '科学探究实验',
      labelEn: 'Scientific Experiment',
      icon: FlaskConical,
    });

    const updatedTypes = getAllSegmentTypes();
    expect(updatedTypes.length).toBe(initialCount + 1);

    const registered = updatedTypes.find((t) => t.id === 'scientific_experiment');
    expect(registered).toBeDefined();
    expect(registered?.labelZh).toBe('科学探究实验');
    expect(registered?.labelEn).toBe('Scientific Experiment');

    // getSegmentType() 必须能解析动态注册的步骤类型（而不是只查内置 SEGMENT_TYPES）
    expect(getSegmentType('scientific_experiment')).toEqual(registered);

    // 注册同名 id 视为覆盖而非新增
    registerCustomSegmentType({
      id: 'scientific_experiment',
      labelZh: '科学探究实验（改）',
      labelEn: 'Scientific Experiment (v2)',
      icon: FlaskConical,
    });
    expect(getAllSegmentTypes().length).toBe(initialCount + 1);
    expect(getSegmentType('scientific_experiment').labelZh).toBe('科学探究实验（改）');
  });

  it('reverts to built-in segment types after a plugin unregisters', () => {
    registerCustomSegmentType({
      id: 'scientific_experiment',
      labelZh: '科学探究实验',
      labelEn: 'Scientific Experiment',
      icon: FlaskConical,
    });
    unregisterCustomSegmentType('scientific_experiment');

    expect(getAllSegmentTypes().map((t) => t.id)).toEqual(SEGMENT_TYPES.map((t) => t.id));
    expect(getSegmentType('scientific_experiment').id).toBe(SEGMENT_TYPES[1].id);
  });
});
