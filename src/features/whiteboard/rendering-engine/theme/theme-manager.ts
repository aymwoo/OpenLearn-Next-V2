import type { ThemeTokens } from '../types.js';

export type WhiteboardThemeId = 'light' | 'dark' | 'eyecare' | 'chalkboard' | 'teaching' | string;

export class ThemeManager {
  private currentTheme: WhiteboardThemeId = 'light';

  private lightTokens: ThemeTokens = {
    primary: '#4f46e5',
    background: '#f8fafc',
    gridDot: '#cbd5e1',
    selectionBorder: '#6366f1',
    selectionHandle: '#4f46e5',
    textPrimary: '#1e293b',
    borderDefault: '#e2e8f0',
    guideLine: '#ec4899',
  };

  private darkTokens: ThemeTokens = {
    primary: '#6366f1',
    background: '#0b0f19',
    gridDot: '#334155',
    selectionBorder: '#818cf8',
    selectionHandle: '#6366f1',
    textPrimary: '#f8fafc',
    borderDefault: '#1e293b',
    guideLine: '#f472b6',
  };

  private eyecareTokens: ThemeTokens = {
    primary: '#2d6a4f',
    background: '#f2f7f4',
    gridDot: '#b7d5c5',
    selectionBorder: '#40916c',
    selectionHandle: '#2d6a4f',
    textPrimary: '#143526',
    borderDefault: '#cce0d6',
    guideLine: '#10b981',
  };

  private chalkboardTokens: ThemeTokens = {
    primary: '#4caf50',
    background: '#0e1713',
    gridDot: '#2d5242',
    selectionBorder: '#81c784',
    selectionHandle: '#4caf50',
    textPrimary: '#e8f5e9',
    borderDefault: '#1f382d',
    guideLine: '#66bb6a',
  };

  private teachingTokens: ThemeTokens = {
    primary: '#d97706',
    background: '#fffbeb',
    gridDot: '#fde68a',
    selectionBorder: '#f59e0b',
    selectionHandle: '#d97706',
    textPrimary: '#78350f',
    borderDefault: '#fef3c7',
    guideLine: '#ef4444',
  };

  private customTokens: Map<string, ThemeTokens> = new Map();
  private listeners: Set<(tokens: ThemeTokens, theme: string) => void> = new Set();

  public getTokens(): ThemeTokens {
    if (this.customTokens.has(this.currentTheme)) {
      return this.customTokens.get(this.currentTheme)!;
    }
    switch (this.currentTheme) {
      case 'dark':
        return this.darkTokens;
      case 'eyecare':
        return this.eyecareTokens;
      case 'chalkboard':
        return this.chalkboardTokens;
      case 'teaching':
        return this.teachingTokens;
      default:
        return this.lightTokens;
    }
  }

  public setTheme(theme: WhiteboardThemeId): void {
    this.currentTheme = theme;
    const tokens = this.getTokens();
    this.listeners.forEach((fn) => {
      try {
        fn(tokens, theme);
      } catch (err) {
        console.error('[ThemeManager] Error in theme change listener:', err);
      }
    });
  }

  public getTheme(): string {
    return this.currentTheme;
  }

  public registerCustomTokens(themeId: string, tokens: ThemeTokens): void {
    this.customTokens.set(themeId, tokens);
    if (this.currentTheme === themeId) {
      this.setTheme(themeId);
    }
  }

  public unregisterCustomTokens(themeId: string): void {
    this.customTokens.delete(themeId);
    if (this.currentTheme === themeId) {
      this.setTheme('light');
    }
  }

  public subscribe(listener: (tokens: ThemeTokens, theme: string) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const themeManager = new ThemeManager();
