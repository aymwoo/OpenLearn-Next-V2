import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ClassroomToolbarControlPage } from '../ClassroomToolbarControlPage';
import {
  CLASSROOM_TOOLBAR_FEATURES,
  isClassroomToolbarFeatureEnabled,
  resetClassroomToolbarVisibility,
} from '../classroomToolbarVisibility';

const STORAGE_KEY = 'openlearn:classroom-toolbar-visibility:v1';

describe('classroom toolbar visibility', () => {
  beforeEach(() => {
    localStorage.clear();
    resetClassroomToolbarVisibility();
  });

  afterEach(() => {
    cleanup();
    resetClassroomToolbarVisibility();
    localStorage.clear();
  });

  it('默认全部开启，并渲染所有开关', () => {
    render(<ClassroomToolbarControlPage lang="zh" />);

    expect(screen.getAllByRole('switch')).toHaveLength(CLASSROOM_TOOLBAR_FEATURES.length);
    for (const feature of CLASSROOM_TOOLBAR_FEATURES) {
      expect(screen.getByRole('switch', { name: feature.zh }).getAttribute('aria-checked')).toBe('true');
    }
  });

  it('关闭后写入 localStorage，重置后恢复全部显示', () => {
    render(<ClassroomToolbarControlPage lang="zh" />);

    fireEvent.click(screen.getByRole('switch', { name: '极速投票' }));
    expect(isClassroomToolbarFeatureEnabled('quick_poll')).toBe(false);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').quick_poll).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '全部恢复显示' }));
    expect(isClassroomToolbarFeatureEnabled('quick_poll')).toBe(true);
    expect(screen.getByRole('switch', { name: '极速投票' }).getAttribute('aria-checked')).toBe('true');
  });
});
