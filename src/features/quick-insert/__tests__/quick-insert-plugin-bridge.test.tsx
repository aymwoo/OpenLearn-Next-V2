import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuickInsertRegistry, QuickInsertMenu } from '../index.js';
import { usePluginHostStore } from '../../../plugin-host/plugin-host-store.js';
import { frontendApi } from '../../../services/frontend-api.js';

describe('Quick Insert Menu - Plugin Extension Slot (quick_insert.item)', () => {
  let registry: QuickInsertRegistry;

  beforeEach(() => {
    registry = new QuickInsertRegistry();
    usePluginHostStore.setState({ extensionPoints: new Map() });
  });

  it('renders and executes plugin items registered via quick_insert.item slot', async () => {
    const postSpy = vi.spyOn(frontendApi, 'post').mockResolvedValue({ success: true, result: {} });

    // Register a plugin quick insert item in usePluginHostStore
    usePluginHostStore.getState().registerExtensionPoint('quick_insert.item', {
      id: 'ext_chemistry_molecule',
      label: '3D 分子模型',
      pluginId: 'ext-chem-lab',
      slotProps: {
        category: 'Plugin',
        description: '插入三维空间有机分子球棍模型',
        keywords: ['chem', 'molecule', '3d'],
        commandType: 'chem.insert_molecule_widget',
        payload: { moleculeType: 'H2O' },
      },
      component: () => Promise.resolve({ default: (() => null) as any }),
    });

    const handleClose = vi.fn();
    render(<QuickInsertMenu isOpen={true} onClose={handleClose} registry={registry} initialQuery="/" />);

    // Check that the plugin item appears in list
    expect(screen.getByText('3D 分子模型')).toBeDefined();
    expect(screen.getByText('插入三维空间有机分子球棍模型')).toBeDefined();

    // Search by keyword
    const input = screen.getByTestId('quick-insert-search-input');
    fireEvent.change(input, { target: { value: 'chem' } });
    expect(screen.getByText('3D 分子模型')).toBeDefined();

    // Click to execute
    const item = screen.getByTestId('quick-insert-item-ext_chemistry_molecule');
    fireEvent.click(item);

    expect(postSpy).toHaveBeenCalledWith('/api/plugins/execute-command', {
      type: 'chem.insert_molecule_widget',
      payload: { moleculeType: 'H2O' },
    });
    expect(handleClose).toHaveBeenCalled();

    postSpy.mockRestore();
  });
});
