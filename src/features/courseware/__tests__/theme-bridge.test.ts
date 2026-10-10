import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { broadcastThemeToIframes } from '../../../services/lms-bridge';
import { BRIDGE_SDK_CODE } from '../../../../server/utils/bridge-sdk';

describe('LMS Theme Bridge & Sandboxed Synchronization', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
    vi.restoreAllMocks();
  });

  it('broadcastThemeToIframes posts LMS_HOST_COMMAND and LMS_THEME_CHANGED to managed iframes only', () => {
    const iframe1 = document.createElement('iframe');
    iframe1.setAttribute('data-lms-bridge', '1');
    const iframe2 = document.createElement('iframe');
    container.appendChild(iframe1);
    container.appendChild(iframe2);

    const postMessageSpy1 = vi.fn();
    const postMessageSpy2 = vi.fn();

    Object.defineProperty(iframe1, 'contentWindow', {
      value: { postMessage: postMessageSpy1 },
      writable: true,
    });
    Object.defineProperty(iframe2, 'contentWindow', {
      value: { postMessage: postMessageSpy2 },
      writable: true,
    });

    const mockTokens = {
      '--bg-app': '#0d131f',
      '--color-primary': '#3b82f6',
    };

    broadcastThemeToIframes('sapphire-classic', mockTokens);

    expect(postMessageSpy1).toHaveBeenCalledTimes(2);
    expect(postMessageSpy1).toHaveBeenCalledWith(
      {
        type: 'LMS_HOST_COMMAND',
        event: 'theme:changed',
        payload: {
          theme: 'sapphire-classic',
          tokens: mockTokens,
        },
      },
      '*',
    );
    expect(postMessageSpy1).toHaveBeenCalledWith(
      {
        type: 'LMS_THEME_CHANGED',
        theme: 'sapphire-classic',
        tokens: mockTokens,
      },
      '*',
    );

    // 未标记 data-lms-bridge 的 iframe 不投递
    expect(postMessageSpy2).not.toHaveBeenCalled();
  });

  it('broadcastThemeToIframes skips unmarked iframes (LTI embeds / third-party content)', () => {
    const managed = document.createElement('iframe');
    managed.setAttribute('data-lms-bridge', '1');
    const foreign = document.createElement('iframe');
    container.appendChild(managed);
    container.appendChild(foreign);

    const managedSpy = vi.fn();
    const foreignSpy = vi.fn();
    Object.defineProperty(managed, 'contentWindow', { value: { postMessage: managedSpy }, writable: true });
    Object.defineProperty(foreign, 'contentWindow', { value: { postMessage: foreignSpy }, writable: true });

    broadcastThemeToIframes('sapphire-classic', {});
    // V5 修复：未标记的同页 iframe 不再收到主题广播（防嗅探）
    expect(foreignSpy).not.toHaveBeenCalled();
    expect(managedSpy).toHaveBeenCalledTimes(2);
  });

  it('tolerates postMessage errors silently without interrupting', () => {
    const errorIframe = document.createElement('iframe');
    errorIframe.setAttribute('data-lms-bridge', '1');
    const goodIframe = document.createElement('iframe');
    goodIframe.setAttribute('data-lms-bridge', '1');
    container.appendChild(errorIframe);
    container.appendChild(goodIframe);

    const goodSpy = vi.fn();

    Object.defineProperty(errorIframe, 'contentWindow', {
      value: {
        postMessage: () => {
          throw new Error('Sandbox cross-origin security block');
        },
      },
    });
    Object.defineProperty(goodIframe, 'contentWindow', {
      value: { postMessage: goodSpy },
    });

    expect(() => {
      broadcastThemeToIframes('dark', { '--color-primary': '#6366f1' });
    }).not.toThrow();

    expect(goodSpy).toHaveBeenCalledTimes(2);
  });

  it('bridgeSdkScript exposes window.LMS.getTheme and theme token listeners', () => {
    expect(BRIDGE_SDK_CODE).toContain('__applyThemeTokens');
    expect(BRIDGE_SDK_CODE).toContain('getTheme()');
    expect(BRIDGE_SDK_CODE).toContain('LMS_THEME_CHANGED');
    expect(BRIDGE_SDK_CODE).toContain('theme:changed');
  });
});
