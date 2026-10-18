import { describe, it, expect, beforeEach } from 'vitest';
import {
  t,
  resolveLabel,
  registerPluginLocales,
  unregisterPluginLocales,
  clearPluginLocales,
  normalizeLang,
  friendlyFormatKey,
  interpolate,
  translations,
  setGlobalLanguage,
} from '../i18n';

describe('i18n core & plugin locales', () => {
  beforeEach(() => {
    clearPluginLocales();
    setGlobalLanguage('zh');
  });

  describe('normalizeLang', () => {
    it('normalizes language codes accurately', () => {
      expect(normalizeLang('zh')).toBe('zh');
      expect(normalizeLang('zh-CN')).toBe('zh');
      expect(normalizeLang('en')).toBe('en');
      expect(normalizeLang('en-US')).toBe('en');
      expect(normalizeLang('EN')).toBe('en');
      expect(normalizeLang('')).toBe('zh');
      expect(normalizeLang(null)).toBe('zh');
      expect(normalizeLang(undefined)).toBe('zh');
    });
  });

  describe('friendlyFormatKey (Anti-bare-key leak, Issue #64 & #148)', () => {
    it('formats dot-separated keys to friendly capitalized text without bare symbols', () => {
      expect(friendlyFormatKey('pptx.notes.title')).toBe('Notes Title');
      expect(friendlyFormatKey('%tab.title%')).toBe('Tab Title');
      expect(friendlyFormatKey('my-plugin:start_quiz')).toBe('Start Quiz');
      expect(friendlyFormatKey('dashboard')).toBe('Dashboard');
    });
  });

  describe('interpolate', () => {
    it('interpolates template variables correctly', () => {
      expect(interpolate('Hello, {name}!', { name: 'Alice' })).toBe('Hello, Alice!');
      expect(interpolate('Score: {score}/{total}', { score: 95, total: 100 })).toBe('Score: 95/100');
      expect(interpolate('Static string')).toBe('Static string');
    });
  });

  describe('plugin locale registration & t() lookup', () => {
    it('registers and retrieves plugin localized strings with namespace', () => {
      registerPluginLocales('ext-homework', {
        zh: {
          'tab.title': '作业中心',
          'welcome': '欢迎, {user}!',
        },
        en: {
          'tab.title': 'Homework Hub',
          'welcome': 'Welcome, {user}!',
        },
      });

      // 默认 zh
      expect(t('ext-homework:tab.title')).toBe('作业中心');
      expect(t('ext-homework:welcome', { user: '张老师' })).toBe('欢迎, 张老师!');

      // 切换到 en
      setGlobalLanguage('en');
      expect(t('ext-homework:tab.title')).toBe('Homework Hub');
      expect(t('ext-homework:welcome', { user: 'Teacher' })).toBe('Welcome, Teacher!');
    });

    it('cascades fallback: current lang -> default lang (zh) -> defaultValue -> friendlyFormatKey', () => {
      registerPluginLocales('ext-lab', {
        zh: {
          'lab.only_zh': '仿真实验台',
        },
        en: {},
      });

      // 当前 en，但 en 缺失，回退到 zh
      setGlobalLanguage('en');
      expect(t('ext-lab:lab.only_zh')).toBe('仿真实验台');

      // 完全缺失，使用 defaultValue
      expect(t('ext-lab:lab.missing', '默认实验室')).toBe('默认实验室');

      // 完全缺失且无 defaultValue，使用友好格式化（绝不原样暴露内部裸键）
      expect(t('ext-lab:lab.physics_experiment')).toBe('Lab Physics Experiment');
    });

    it('unregisters plugin locales upon deactivation', () => {
      registerPluginLocales('ext-temp', {
        zh: { 'status': '已就绪' },
      });
      expect(t('ext-temp:status')).toBe('已就绪');

      unregisterPluginLocales('ext-temp');
      // 注销后不再命中，回退到友好格式
      expect(t('ext-temp:status')).toBe('Status');
    });
  });

  describe('resolveLabel', () => {
    beforeEach(() => {
      registerPluginLocales('ext-quiz', {
        zh: {
          'nav.title': '随堂测验',
        },
        en: {
          'nav.title': 'In-class Quiz',
        },
      });
    });

    it('returns raw text unchanged for plain literal strings', () => {
      expect(resolveLabel('物理实验仿真')).toBe('物理实验仿真');
      expect(resolveLabel('Custom Button Title')).toBe('Custom Button Title');
    });

    it('resolves %key% format from plugin locale dictionary', () => {
      expect(resolveLabel('%nav.title%', 'ext-quiz', 'zh')).toBe('随堂测验');
      expect(resolveLabel('%nav.title%', 'ext-quiz', 'en')).toBe('In-class Quiz');
    });

    it('resolves %key% format falling back to default language or friendly text without % symbols', () => {
      // 插件未提供该 key
      const resolved = resolveLabel('%courseware.notes.summary%', 'ext-quiz', 'en');
      expect(resolved).not.toContain('%');
      expect(resolved).toBe('Notes Summary');
    });

    it('handles empty or null labels gracefully', () => {
      expect(resolveLabel('')).toBe('');
      expect(resolveLabel(null)).toBe('');
      expect(resolveLabel(undefined)).toBe('');
    });
  });

  describe('backward compatibility', () => {
    it('preserves translations.zh and translations.en direct property access', () => {
      expect(translations.zh.dashboard).toBe('系统总览');
      expect(translations.en.dashboard).toBe('OS Dashboard');
      expect(translations.zh.lessons).toBe('课程');
      expect(translations.en.lessons).toBe('Lessons');
    });
  });
});
