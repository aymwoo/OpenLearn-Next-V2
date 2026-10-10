import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommandRegistry, CommandPalette } from '../index.js';
import { usePluginHostStore } from '../../../plugin-host/plugin-host-store.js';
import { frontendApi } from '../../../services/frontend-api.js';

describe('Command Palette - Plugin Extension Slot (command_palette.item)', () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    registry = new CommandRegistry();
    usePluginHostStore.setState({ extensionPoints: new Map() });
  });

  it('renders and executes plugin commands registered via command_palette.item slot', async () => {
    const postSpy = vi.spyOn(frontendApi, 'post').mockResolvedValue({ success: true, result: {} });

    // Register a plugin command in usePluginHostStore
    usePluginHostStore.getState().registerExtensionPoint('command_palette.item', {
      id: 'ext_physics_formula',
      label: '物理公式计算器',
      pluginId: 'ext-physics-lab',
      slotProps: {
        category: 'Plugin',
        description: '快速求解匀变速直线运动公式',
        keywords: ['physics', 'formula', 'v0'],
        commandType: 'physics.calculate_speed',
        payload: { defaultFormula: 'kinematics' },
      },
      component: () => Promise.resolve({ default: (() => null) as any }),
    });

    const handleClose = vi.fn();
    render(<CommandPalette isOpen={true} onClose={handleClose} registry={registry} />);

    // Check that the plugin command appears in list
    expect(screen.getByText('物理公式计算器')).toBeDefined();
    expect(screen.getByText('快速求解匀变速直线运动公式')).toBeDefined();

    // Search by keyword
    const input = screen.getByTestId('command-search-input');
    fireEvent.change(input, { target: { value: 'physics' } });
    expect(screen.getByText('物理公式计算器')).toBeDefined();

    // Click to execute
    const item = screen.getByTestId('command-item-ext_physics_formula');
    fireEvent.click(item);

    expect(postSpy).toHaveBeenCalledWith('/api/plugins/execute-command', {
      type: 'physics.calculate_speed',
      payload: { defaultFormula: 'kinematics' },
    });
    expect(handleClose).toHaveBeenCalled();

    postSpy.mockRestore();
  });
});
