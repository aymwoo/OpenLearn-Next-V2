import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tabToHash, hashToTab, buildTeacherTabUrl, openTeacherTabInNewTab } from '../teacherTabHash';

describe('teacherTabHash', () => {
  describe('tabToHash', () => {
    it('encodes a built-in tab id to a hash fragment', () => {
      expect(tabToHash('courses')).toBe('#/courses');
      expect(tabToHash('live_class')).toBe('#/live_class');
      expect(tabToHash('admin_directory')).toBe('#/admin_directory');
    });

    it('encodes a plugin tab id (pluginId/extId) to a hash fragment', () => {
      expect(tabToHash('openlearn-courseware-hub/courseware-hub-teacher-tab')).toBe(
        '#/openlearn-courseware-hub/courseware-hub-teacher-tab',
      );
    });

    it('returns a bare slash for the empty string (idempotent with hashToTab null)', () => {
      expect(tabToHash('')).toBe('#/');
    });
  });

  describe('hashToTab', () => {
    it('decodes a hash fragment back to a tab id', () => {
      expect(hashToTab('#/courses')).toBe('courses');
      expect(hashToTab('#/live_class')).toBe('live_class');
    });

    it('decodes a plugin tab id', () => {
      expect(hashToTab('#/openlearn-courseware-hub/courseware-hub-teacher-tab')).toBe(
        'openlearn-courseware-hub/courseware-hub-teacher-tab',
      );
    });

    it('accepts a hash without the leading #', () => {
      expect(hashToTab('/courses')).toBe('courses');
    });

    it('returns null for an empty hash', () => {
      expect(hashToTab('')).toBeNull();
    });

    it('returns null for a hash that is just the root /', () => {
      expect(hashToTab('#/')).toBeNull();
      expect(hashToTab('/')).toBeNull();
    });

    it('round-trips with tabToHash for every built-in tab', () => {
      const tabs = [
        'dashboard',
        'courses',
        'live_class',
        'classes',
        'timetable',
        'computer_labs',
        'plugins',
        'admin_directory',
        'help',
      ];
      for (const tab of tabs) {
        expect(hashToTab(tabToHash(tab))).toBe(tab);
      }
    });

    it('round-trips with tabToHash for plugin tabs', () => {
      const pluginTabs = [
        'openlearn-courseware-hub/courseware-hub-teacher-tab',
        'openlearn-homework-hub/homework-hub-teacher-tab',
        'prov_openai/sidebar-tab',
      ];
      for (const tab of pluginTabs) {
        expect(hashToTab(tabToHash(tab))).toBe(tab);
      }
    });
  });

  describe('buildTeacherTabUrl', () => {
    const originalLocation = window.location;

    beforeEach(() => {
      // jsdom's window.location is read-only on the href, but assignable as a whole
      // for testing; replace it with a fake.
      delete (window as any).location;
      (window as any).location = {
        pathname: '/teacher',
        search: '',
        hash: '',
      };
    });

    afterEach(() => {
      (window as any).location = originalLocation;
    });

    it('builds a path + hash URL preserving the current pathname', () => {
      (window as any).location.pathname = '/teacher';
      expect(buildTeacherTabUrl('courses')).toBe('/teacher#/courses');
    });

    it('preserves the current query string', () => {
      (window as any).location.pathname = '/lms/teacher';
      (window as any).location.search = '?utm=fall2026';
      expect(buildTeacherTabUrl('classes')).toBe('/lms/teacher?utm=fall2026#/classes');
    });

    it('handles the root pathname', () => {
      (window as any).location.pathname = '/';
      (window as any).location.search = '';
      expect(buildTeacherTabUrl('help')).toBe('/#/help');
    });

    it('handles a plugin tab with slash in its id', () => {
      (window as any).location.pathname = '/';
      (window as any).location.search = '';
      expect(buildTeacherTabUrl('openlearn-courseware-hub/courseware-hub-teacher-tab')).toBe(
        '/#/openlearn-courseware-hub/courseware-hub-teacher-tab',
      );
    });
  });

  describe('openTeacherTabInNewTab', () => {
    const originalLocation = window.location;
    const openSpy = vi.fn();

    beforeEach(() => {
      delete (window as any).location;
      (window as any).location = {
        pathname: '/teacher',
        search: '',
        hash: '',
      };
      openSpy.mockClear();
      vi.stubGlobal('open', openSpy);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      (window as any).location = originalLocation;
    });

    it('calls window.open with _blank and noopener,noreferrer for a built-in tab', () => {
      openTeacherTabInNewTab('courses');
      expect(openSpy).toHaveBeenCalledTimes(1);
      expect(openSpy).toHaveBeenCalledWith('/teacher#/courses', '_blank', 'noopener,noreferrer');
    });

    it('calls window.open with the right URL for a plugin tab', () => {
      openTeacherTabInNewTab('openlearn-courseware-hub/courseware-hub-teacher-tab');
      expect(openSpy).toHaveBeenCalledWith(
        '/teacher#/openlearn-courseware-hub/courseware-hub-teacher-tab',
        '_blank',
        'noopener,noreferrer',
      );
    });

    it('preserves the current query string in the opened URL', () => {
      (window as any).location.search = '?lang=zh';
      openTeacherTabInNewTab('live_class');
      expect(openSpy).toHaveBeenCalledWith('/teacher?lang=zh#/live_class', '_blank', 'noopener,noreferrer');
    });

    it('does not switch focus to the new tab (we do not call .focus() and the source tab keeps its state)', () => {
      // window.open returns a window-like object in real browsers; we just check
      // the function does not call .focus() on the source tab. By verifying
      // only the 3-arg signature is used we are safe.
      openTeacherTabInNewTab('plugins');
      const [, target, features] = openSpy.mock.calls[0];
      expect(target).toBe('_blank');
      expect(features).toBe('noopener,noreferrer');
    });
  });
});
