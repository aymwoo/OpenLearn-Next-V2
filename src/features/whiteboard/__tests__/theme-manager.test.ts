import { describe, it, expect, beforeEach } from 'vitest';
import { ThemeManager } from '../rendering-engine/theme/theme-manager.js';
import type { ThemeTokens } from '../rendering-engine/types.js';

describe('ThemeManager', () => {
  let themeMgr: ThemeManager;

  beforeEach(() => {
    themeMgr = new ThemeManager();
  });

  it('should initialize with default light theme', () => {
    expect(themeMgr.getTheme()).toBe('light');
    const tokens = themeMgr.getTokens();
    expect(tokens.background).toBe('#f8fafc');
    expect(tokens.primary).toBe('#4f46e5');
  });

  it('should switch to dark theme and return dark tokens', () => {
    themeMgr.setTheme('dark');
    expect(themeMgr.getTheme()).toBe('dark');
    const tokens = themeMgr.getTokens();
    expect(tokens.background).toBe('#0b0f19');
    expect(tokens.primary).toBe('#6366f1');
    expect(tokens.textPrimary).toBe('#f8fafc');
  });

  it('should switch to eyecare theme and return eyecare tokens', () => {
    themeMgr.setTheme('eyecare');
    expect(themeMgr.getTheme()).toBe('eyecare');
    const tokens = themeMgr.getTokens();
    expect(tokens.background).toBe('#f2f7f4');
    expect(tokens.primary).toBe('#2d6a4f');
    expect(tokens.textPrimary).toBe('#143526');
  });

  it('should switch to chalkboard theme and return chalkboard tokens', () => {
    themeMgr.setTheme('chalkboard');
    expect(themeMgr.getTheme()).toBe('chalkboard');
    const tokens = themeMgr.getTokens();
    expect(tokens.background).toBe('#0e1713');
    expect(tokens.primary).toBe('#4caf50');
    expect(tokens.textPrimary).toBe('#e8f5e9');
    expect(tokens.gridDot).toBe('#2d5242');
  });

  it('should support registering and unregistering custom theme tokens', () => {
    const customTokens: ThemeTokens = {
      primary: '#ff00ff',
      background: '#220022',
      gridDot: '#550055',
      selectionBorder: '#ff55ff',
      selectionHandle: '#ff00ff',
      textPrimary: '#ffffff',
      borderDefault: '#440044',
      guideLine: '#ff0088',
    };

    themeMgr.registerCustomTokens('neon-synth', customTokens);
    themeMgr.setTheme('neon-synth');
    expect(themeMgr.getTokens()).toEqual(customTokens);

    themeMgr.unregisterCustomTokens('neon-synth');
    expect(themeMgr.getTheme()).toBe('light');
    expect(themeMgr.getTokens().primary).toBe('#4f46e5');
  });

  it('should notify subscribers on theme changes', () => {
    const notifications: Array<{ theme: string; bg: string }> = [];
    const unsubscribe = themeMgr.subscribe((tokens, theme) => {
      notifications.push({ theme, bg: tokens.background });
    });

    themeMgr.setTheme('chalkboard');
    themeMgr.setTheme('eyecare');
    unsubscribe();
    themeMgr.setTheme('dark');

    expect(notifications).toHaveLength(2);
    expect(notifications[0]).toEqual({ theme: 'chalkboard', bg: '#0e1713' });
    expect(notifications[1]).toEqual({ theme: 'eyecare', bg: '#f2f7f4' });
  });
});
