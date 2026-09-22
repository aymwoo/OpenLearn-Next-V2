/**
 * OpenLearn Workspace Layout Manager - Facade & Plugin Extension API (Sprint P1-05)
 */

import { WorkspaceRegionType, RegionState } from './workspace-region.js';
import { LayoutStore } from './layout-store.js';

export interface WorkspaceWidgetDescriptor {
  readonly id: string;
  readonly name: string;
  readonly region: WorkspaceRegionType;
  readonly componentName?: string;
  readonly hidden?: boolean;
}

export class WorkspaceLayoutManager {
  private store: LayoutStore;
  private widgets = new Map<string, WorkspaceWidgetDescriptor>();

  constructor(store?: LayoutStore) {
    this.store = store ?? new LayoutStore();
    this.store.restore();
  }

  // Region Operations
  public show(region: WorkspaceRegionType): void {
    this.store.setRegionState(region, { visible: true });
  }

  public hide(region: WorkspaceRegionType): void {
    this.store.setRegionState(region, { visible: false });
  }

  public collapse(region: WorkspaceRegionType): void {
    this.store.setRegionState(region, { collapsed: true });
  }

  public expand(region: WorkspaceRegionType): void {
    this.store.setRegionState(region, { collapsed: false });
  }

  public resize(region: WorkspaceRegionType, size: number): void {
    if (size <= 0) {
      throw new Error(`WorkspaceLayoutManager Error: Invalid size '${size}' for region '${region}'.`);
    }
    this.store.setRegionState(region, { size });
  }

  public pin(region: WorkspaceRegionType): void {
    this.store.setRegionState(region, { pinned: true });
  }

  public unpin(region: WorkspaceRegionType): void {
    this.store.setRegionState(region, { pinned: false });
  }

  public fullscreen(region: WorkspaceRegionType, enable: boolean = true): void {
    this.store.setRegionState(region, { fullscreen: enable });
  }

  public setActiveTab(region: WorkspaceRegionType, activeTab: string): void {
    this.store.setRegionState(region, { activeTab });
  }

  public getRegionState(region: WorkspaceRegionType): RegionState {
    return this.store.getRegionState(region);
  }

  // Plugin Widget Extension API
  public registerWidget(widget: WorkspaceWidgetDescriptor): void {
    if (!widget || !widget.id) {
      throw new Error('WorkspaceLayoutManager Error: Widget must have a valid ID.');
    }
    this.widgets.set(widget.id, { ...widget, hidden: false });
  }

  public replaceWidget(targetId: string, widget: WorkspaceWidgetDescriptor): boolean {
    if (!this.widgets.has(targetId)) {
      return false;
    }
    this.widgets.delete(targetId);
    this.widgets.set(widget.id, { ...widget, hidden: false });
    return true;
  }

  public hideWidget(widgetId: string): boolean {
    const existing = this.widgets.get(widgetId);
    if (!existing) return false;
    this.widgets.set(widgetId, { ...existing, hidden: true });
    return true;
  }

  public moveWidget(widgetId: string, targetRegion: WorkspaceRegionType): boolean {
    const existing = this.widgets.get(widgetId);
    if (!existing) return false;
    this.widgets.set(widgetId, { ...existing, region: targetRegion });
    return true;
  }

  public listWidgets(region?: WorkspaceRegionType): ReadonlyArray<WorkspaceWidgetDescriptor> {
    const all = Array.from(this.widgets.values());
    if (region) {
      return Object.freeze(all.filter((w) => w.region === region && !w.hidden));
    }
    return Object.freeze(all.filter((w) => !w.hidden));
  }

  public resetLayout(): void {
    this.store.resetToDefaults();
    this.widgets.clear();
  }
}
