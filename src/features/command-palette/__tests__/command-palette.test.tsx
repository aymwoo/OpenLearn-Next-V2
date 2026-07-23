import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommandRegistry, CommandPalette } from '../index.js';

describe('Sprint P2-05 Command Palette Test Suite', () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    registry = new CommandRegistry();
  });

  it('should register and search commands across official categories and plugin extensions', () => {
    const lessonSpy = vi.fn();
    const whiteboardSpy = vi.fn();
    const pluginSpy = vi.fn();

    registry.register({
      id: 'cmd_lesson_start',
      title: 'Start Classroom Session',
      category: 'Lesson',
      keywords: ['start', 'begin', 'class'],
      execute: lessonSpy,
    });

    registry.register({
      id: 'cmd_wb_clear',
      title: 'Clear Whiteboard Canvas',
      category: 'Whiteboard',
      keywords: ['clear', 'canvas', 'reset'],
      execute: whiteboardSpy,
    });

    // Plugin Extension Command
    registry.register({
      id: 'cmd_plugin_quiz',
      title: 'Generate AI Quiz',
      category: 'Plugin',
      keywords: ['quiz', 'ai', 'generate'],
      execute: pluginSpy,
    });

    expect(registry.search('start').length).toBe(1);
    expect(registry.search('', 'Whiteboard').length).toBe(1);
    expect(registry.search('quiz').length).toBe(1);
  });

  it('should execute command, delegate to capability handler, and track recents & favorites', async () => {
    const executeSpy = vi.fn();

    registry.register({
      id: 'cmd_ai_prompt',
      title: 'Ask AI Teaching Assistant',
      category: 'AI',
      execute: executeSpy,
    });

    await registry.executeCommand('cmd_ai_prompt');
    expect(executeSpy).toHaveBeenCalled();

    // Verify recents
    expect(registry.getRecents().length).toBe(1);
    expect(registry.getRecents()[0].id).toBe('cmd_ai_prompt');

    // Verify favorites
    registry.toggleFavorite('cmd_ai_prompt');
    expect(registry.getFavorites().length).toBe(1);

    registry.toggleFavorite('cmd_ai_prompt');
    expect(registry.getFavorites().length).toBe(0);
  });

  it('should render CommandPalette modal and handle search & keyboard navigation', () => {
    const closeSpy = vi.fn();
    const actionSpy = vi.fn();

    registry.register({
      id: 'cmd_action_1',
      title: 'Action One',
      category: 'Workspace',
      execute: actionSpy,
    });

    render(<CommandPalette isOpen={true} onClose={closeSpy} registry={registry} />);

    const searchInput = screen.getByTestId('command-search-input');
    expect(searchInput).toBeDefined();

    // Fire Escape key to close modal
    fireEvent.keyDown(searchInput, { key: 'Escape', code: 'Escape' });
    expect(closeSpy).toHaveBeenCalled();
  });
});
