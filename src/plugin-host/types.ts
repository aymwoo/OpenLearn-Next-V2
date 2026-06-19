/**
 * Frontend PluginHost type definitions.
 *
 * Mirrors backend PluginHost types (PluginState, Disposable) and adds
 * frontend-specific types (ExtensionSlot, FrontendPluginContext, etc.).
 *
 * D-03: PluginState enum — 7 values matching backend lifecycle state machine
 * D-04: ExtensionSlot — 5 slot types for UI extension point registration
 * D-05: ExtensionPointConfig — React.lazy component registration config
 */

import type React from 'react';

// ── Token name constants (frontend namespace) ────────────────────────────

export const FRONTEND_API_TOKEN = '@openlearn/frontend:IFrontendAPI';
export const SOCKET_SERVICE_TOKEN = '@openlearn/frontend:ISocketService';
export const UI_SERVICE_TOKEN = '@openlearn/frontend:IUIService';
export const STORAGE_SERVICE_TOKEN = '@openlearn/frontend:IStorageService';

// ── Core types ───────────────────────────────────────────────────────────

export enum PluginState {
  INSTALLED = 'installed',
  ACTIVATING = 'activating',
  ACTIVE = 'active',
  DEACTIVATING = 'deactivating',
  INACTIVE = 'inactive',
  ERROR = 'error',
  UNINSTALLED = 'uninstalled',
}

export interface Disposable {
  dispose(): void;
}

// ── Manifest & Plugin Info ───────────────────────────────────────────────

export interface FrontendPluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  capabilitiesProposed?: string[];
  classroomTools?: Array<{
    id: string;
    name: string;
    icon: string;
    commandType: string;
    payload?: any;
  }>;
}

export interface FrontendPluginInfo {
  id: string;
  name: string;
  version: string;
  state: PluginState;
  executionMode: 'inline' | 'worker' | 'legacy';
}

// ── Extension Points ─────────────────────────────────────────────────────

export type ExtensionSlot =
  | 'teacher.tab'
  | 'student.view'
  | 'classroom.tool'
  | 'teacher.dashboard.widget'
  | 'student.lesson.tool';

export interface ExtensionPointConfig {
  id: string;
  label: string;
  icon?: string;
  component: () => Promise<{ default: React.ComponentType<any> }>;
  position?: number;
  pluginId: string;
}

// ── Frontend Service Interfaces ──────────────────────────────────────────

export interface IFrontendAPI {
  get<T = any>(path: string): Promise<{ success: boolean; result?: T; error?: string }>;
  post<T = any>(path: string, body?: any): Promise<{ success: boolean; result?: T; error?: string }>;
  del<T = any>(path: string): Promise<{ success: boolean; result?: T; error?: string }>;
}

export interface ISocketService {
  emit(event: string, ...args: any[]): void;
  on(event: string, handler: (...args: any[]) => void): void;
  off(event: string, handler: (...args: any[]) => void): void;
  disconnect(): void;
}

export interface IUIService {
  showToast(title: string, message: string, type: 'info' | 'success' | 'warning'): void;
  showModal(title: string, content: React.ReactNode): void;
  closeModal(): void;
}

export interface IStorageService {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
  clear(): void;
}

// ── Frontend Plugin Context ──────────────────────────────────────────────

export interface FrontendPluginContext {
  services: {
    frontendApi: IFrontendAPI;
    socketService: ISocketService;
    uiService: IUIService;
    storageService: IStorageService;
  };
  pluginId: string;
  manifest: FrontendPluginManifest;
  ui: {
    registerExtensionPoint(slot: ExtensionSlot, config: ExtensionPointConfig): void;
    unregisterExtensionPoint(slot: ExtensionSlot, id: string): void;
  };
}
