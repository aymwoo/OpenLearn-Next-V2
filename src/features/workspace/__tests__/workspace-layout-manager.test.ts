import { describe, it, expect, beforeEach } from 'vitest';
import {
  WorkspaceLayoutManager,
  LayoutStore,
  LAYOUT_STORAGE_KEY,
} from '../index.js';

describe('Sprint P1-05 Workspace Layout Manager Test Suite', () => {
  let manager: WorkspaceLayoutManager;
  let store: LayoutStore;

  beforeEach(() => {
    store = new LayoutStore();
    store.resetToDefaults();
    manager = new WorkspaceLayoutManager(store);
  });

  it('should initialize with standard 8 region default states', () => {
    const leftState = manager.getRegionState('LeftSidebar');
    expect(leftState.visible).toBe(true);
    expect(leftState.collapsed).toBe(false);
    expect(leftState.pinned).toBe(true);
    expect(leftState.fullscreen).toBe(false);
  });

  it('should execute show, hide, collapse, expand, pin, unpin, fullscreen, and resize operations correctly', () => {
    manager.hide('RightSidebar');
    expect(manager.getRegionState('RightSidebar').visible).toBe(false);

    manager.show('RightSidebar');
    expect(manager.getRegionState('RightSidebar').visible).toBe(true);

    manager.collapse('LeftSidebar');
    expect(manager.getRegionState('LeftSidebar').collapsed).toBe(true);

    manager.expand('LeftSidebar');
    expect(manager.getRegionState('LeftSidebar').collapsed).toBe(false);

    manager.resize('BottomPanel', 350);
    expect(manager.getRegionState('BottomPanel').size).toBe(350);

    manager.unpin('LeftSidebar');
    expect(manager.getRegionState('LeftSidebar').pinned).toBe(false);

    manager.fullscreen('CenterWorkspace', true);
    expect(manager.getRegionState('CenterWorkspace').fullscreen).toBe(true);

    manager.setActiveTab('RightSidebar', 'tab_ai_assistant');
    expect(manager.getRegionState('RightSidebar').activeTab).toBe('tab_ai_assistant');
  });

  it('should throw error when resizing region with invalid zero or negative dimensions', () => {
    expect(() => manager.resize('LeftSidebar', 0)).toThrow('Invalid size');
    expect(() => manager.resize('LeftSidebar', -100)).toThrow('Invalid size');
  });

  it('should persist and restore region states via LayoutStore', () => {
    manager.resize('RightSidebar', 450);
    manager.hide('BottomPanel');

    // Simulate store restoration
    const restoredStore = new LayoutStore();
    restoredStore.restore();
    const restoredManager = new WorkspaceLayoutManager(restoredStore);

    expect(restoredManager.getRegionState('RightSidebar').size).toBe(450);
    expect(restoredManager.getRegionState('BottomPanel').visible).toBe(false);
  });

  it('should support plugin widget extensions (register, replace, hide, move, list)', () => {
    manager.registerWidget({
      id: 'widget_ai_insights',
      name: 'AI Teaching Insights',
      region: 'RightSidebar',
    });

    let widgets = manager.listWidgets('RightSidebar');
    expect(widgets.length).toBe(1);
    expect(widgets[0].id).toBe('widget_ai_insights');

    // Move widget to BottomPanel
    manager.moveWidget('widget_ai_insights', 'BottomPanel');
    expect(manager.listWidgets('RightSidebar').length).toBe(0);
    expect(manager.listWidgets('BottomPanel').length).toBe(1);

    // Replace widget
    manager.replaceWidget('widget_ai_insights', {
      id: 'widget_ai_insights_v2',
      name: 'AI Teaching Insights v2',
      region: 'BottomPanel',
    });
    expect(manager.listWidgets('BottomPanel')[0].id).toBe('widget_ai_insights_v2');

    // Hide widget
    manager.hideWidget('widget_ai_insights_v2');
    expect(manager.listWidgets('BottomPanel').length).toBe(0);
  });
});
