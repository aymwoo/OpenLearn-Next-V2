import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuickInsertRegistry, QuickInsertMenu, QuickInsertProvider } from '../index.js';

describe('Sprint P2-07 Quick Insert Test Suite', () => {
  let registry: QuickInsertRegistry;

  beforeEach(() => {
    registry = new QuickInsertRegistry();
  });

  it('should register and search items via slash command query across official items and plugin providers', () => {
    const imageSpy = vi.fn();
    const shapeSpy = vi.fn();
    const pluginSpy = vi.fn();

    // Official items
    registry.registerItem({
      id: 'insert_media_image',
      title: 'Insert Image Asset',
      category: 'Media',
      keywords: ['image', 'photo', 'picture'],
      execute: imageSpy,
    });

    registry.registerItem({
      id: 'insert_shape_rect',
      title: 'Insert Rectangle Shape',
      category: 'Shape',
      keywords: ['rectangle', 'box', 'square'],
      execute: shapeSpy,
    });

    // Plugin Provider
    const pluginProvider: QuickInsertProvider = {
      id: 'provider_plugin_geogebra',
      getItems: () => [
        {
          id: 'insert_plugin_geogebra_widget',
          title: 'Insert GeoGebra Math Widget',
          category: 'Plugin',
          keywords: ['math', 'geogebra', 'geometry'],
          execute: pluginSpy,
        },
      ],
    };

    registry.registerProvider(pluginProvider);

    expect(registry.search('/image').length).toBe(1);
    expect(registry.search('/rect', 'Shape').length).toBe(1);
    expect(registry.search('/geogebra').length).toBe(1);
  });

  it('should execute item, delegate to capability handler, and track recents & favorites', async () => {
    const executeSpy = vi.fn();

    registry.registerItem({
      id: 'insert_ai_quiz',
      title: 'Insert AI Quiz Task',
      category: 'AI',
      execute: executeSpy,
    });

    await registry.executeItem('insert_ai_quiz');
    expect(executeSpy).toHaveBeenCalled();

    // Verify recents
    expect(registry.getRecents().length).toBe(1);
    expect(registry.getRecents()[0].id).toBe('insert_ai_quiz');

    // Verify favorites
    registry.toggleFavorite('insert_ai_quiz');
    expect(registry.getFavorites().length).toBe(1);
  });

  it('should render QuickInsertMenu popup and handle slash prompt search & keyboard navigation', () => {
    const closeSpy = vi.fn();
    const insertSpy = vi.fn();

    registry.registerItem({
      id: 'insert_tool_ruler',
      title: 'Insert Measurement Ruler',
      category: 'Tool',
      execute: insertSpy,
    });

    render(<QuickInsertMenu isOpen={true} onClose={closeSpy} registry={registry} initialQuery="/" />);

    const searchInput = screen.getByTestId('quick-insert-search-input');
    expect(searchInput).toBeDefined();

    // Fire Escape key to close popup
    fireEvent.keyDown(searchInput, { key: 'Escape', code: 'Escape' });
    expect(closeSpy).toHaveBeenCalled();
  });
});
