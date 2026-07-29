import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import {
  AITeacherWorkspaceWidget,
  AITeacherWorkspaceRegistry,
} from '../index.js';

describe('Sprint P5-05 AI Teacher Workspace Test Suite', () => {
  beforeEach(() => {
    cleanup();
  });

  it('should register default AI Teacher Workspace Widget into Workspace Widget Registry', () => {
    const registry = new AITeacherWorkspaceRegistry();
    registry.registerDefaultAIWidget();

    expect(registry.listWidgets().length).toBe(1);
    const widget = registry.getWidget('widget_ai_teacher_workspace');
    expect(widget).toBeDefined();
    expect(widget?.slot).toBe('RightSidebar');
    expect(widget?.provider).toBe('official');
  });

  it('should render AI Teacher Workspace Widget with controls and 8 section tabs', () => {
    const actionSpy = vi.fn();
    render(<AITeacherWorkspaceWidget onActionExecute={actionSpy} />);

    expect(screen.getByTestId('ai-teacher-workspace-widget')).toBeDefined();
    expect(screen.getByTestId('btn-pin')).toBeDefined();
    expect(screen.getByTestId('btn-dock')).toBeDefined();

    // Verify default active section tab
    expect(screen.getByTestId('tab-lesson-assistant')).toBeDefined();

    // Click section tab to switch active section
    const whiteboardTab = screen.getByTestId('tab-whiteboard-assistant');
    fireEvent.click(whiteboardTab);

    // Click AI Action button
    const summarizeBtn = screen.getByTestId('btn-summarize');
    fireEvent.click(summarizeBtn);

    expect(actionSpy).toHaveBeenCalledWith('ai_summarize_lesson', {
      section: 'Whiteboard Assistant',
    });
  });

  it('should support collapse and expand toggle controls', () => {
    render(<AITeacherWorkspaceWidget />);

    const collapseBtn = screen.getByTestId('btn-collapse');
    expect(screen.getByTestId('tab-lesson-assistant')).toBeDefined();

    fireEvent.click(collapseBtn);
    expect(screen.queryByTestId('tab-lesson-assistant')).toBeNull();

    fireEvent.click(collapseBtn);
    expect(screen.getByTestId('tab-lesson-assistant')).toBeDefined();
  });
});
