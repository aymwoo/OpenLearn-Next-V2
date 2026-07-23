import type { ThemeTokens } from '../types.js';

export class ThemeManager {
  private currentTheme: 'light' | 'dark' | 'teaching' = 'light';

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
    background: '#0f172a',
    gridDot: '#334155',
    selectionBorder: '#818cf8',
    selectionHandle: '#6366f1',
    textPrimary: '#f8fafc',
    borderDefault: '#1e293b',
    guideLine: '#f472b6',
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

  public getTokens(): ThemeTokens {
    switch (this.currentTheme) {
      case 'dark':
        return this.darkTokens;
      case 'teaching':
        return this.teachingTokens;
      default:
        return this.lightTokens;
    }
  }

  public setTheme(theme: 'light' | 'dark' | 'teaching'): void {
    this.currentTheme = theme;
  }

  public getTheme(): string {
    return this.currentTheme;
  }
}

export const themeManager = new ThemeManager();
