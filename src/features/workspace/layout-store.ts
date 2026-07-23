/**
 * OpenLearn Workspace Layout Manager - Layout Store & Persistence (Sprint P1-05)
 */

import { WorkspaceRegionType, RegionState, DEFAULT_REGION_STATES } from './workspace-region.js';

export const LAYOUT_STORAGE_KEY = 'openlearn_workspace_layout_v1';

export class LayoutStore {
  private states: Map<WorkspaceRegionType, RegionState> = new Map();

  constructor() {
    this.resetToDefaults();
  }

  public resetToDefaults(): void {
    this.states.clear();
    for (const [region, state] of Object.entries(DEFAULT_REGION_STATES)) {
      this.states.set(region as WorkspaceRegionType, { ...state });
    }
  }

  public getRegionState(region: WorkspaceRegionType): RegionState {
    const existing = this.states.get(region);
    if (!existing) {
      const defaultState = DEFAULT_REGION_STATES[region] ?? {
        visible: true,
        collapsed: false,
        size: 200,
        pinned: true,
        fullscreen: false,
      };
      this.states.set(region, { ...defaultState });
      return { ...defaultState };
    }
    return { ...existing };
  }

  public setRegionState(region: WorkspaceRegionType, patch: Partial<RegionState>): void {
    const current = this.getRegionState(region);
    const updated = { ...current, ...patch };
    this.states.set(region, updated);
    this.save();
  }

  public save(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        const payload: Record<string, RegionState> = {};
        for (const [k, v] of this.states.entries()) {
          payload[k] = v;
        }
        localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(payload));
      }
    } catch {
      // Ignore storage errors in restricted environments
    }
  }

  public restore(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Record<string, RegionState>;
          for (const [k, v] of Object.entries(parsed)) {
            this.states.set(k as WorkspaceRegionType, { ...v });
          }
        }
      }
    } catch {
      // Fallback to defaults on corrupt data
    }
  }
}
