// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FrontendAPIService } from '../../services/frontend-api';
import { SocketService } from '../../services/socket-service';
import { UIService } from '../../services/ui-service';
import { StorageService } from '../../services/storage-service';
import type { Socket } from 'socket.io-client';

// ── FrontendAPIService Tests ─────────────────────────────────────────────

describe('FrontendAPIService', () => {
  let api: FrontendAPIService;

  beforeEach(() => {
    api = new FrontendAPIService();
    vi.restoreAllMocks();
  });

  it('get returns parsed JSON on success', async () => {
    const mockResponse = { success: true, result: { data: 'test' } };
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve(mockResponse),
    });

    const result = await api.get('/api/test');
    expect(result).toEqual(mockResponse);
    expect(fetch).toHaveBeenCalledWith(
      '/api/test',
      expect.objectContaining({ method: 'GET', credentials: 'same-origin' }),
    );
  });

  it('post sends JSON body and returns response', async () => {
    const mockResponse = { success: true, result: { id: 1 } };
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve(mockResponse),
    });

    const result = await api.post('/api/test', { name: 'test' });
    expect(result).toEqual(mockResponse);
    expect(fetch).toHaveBeenCalledWith(
      '/api/test',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'test' }),
      }),
    );
  });

  it('del sends DELETE request and returns response', async () => {
    const mockResponse = { success: true, result: { deleted: true } };
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve(mockResponse),
    });

    const result = await api.del('/api/test/1');
    expect(result).toEqual(mockResponse);
    expect(fetch).toHaveBeenCalledWith(
      '/api/test/1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('returns error object on network failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = await api.get('/api/test');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Network error');
  });
});

// ── SocketService Tests ──────────────────────────────────────────────────

describe('SocketService', () => {
  it('delegates emit to socket instance', () => {
    const mockEmit = vi.fn();
    const mockSocket = { emit: mockEmit } as unknown as Socket;
    const svc = new SocketService(mockSocket);

    svc.emit('test-event', { data: 1 });
    expect(mockEmit).toHaveBeenCalledWith('test-event', { data: 1 });
  });

  it('delegates on to socket instance', () => {
    const mockOn = vi.fn();
    const mockSocket = { on: mockOn } as unknown as Socket;
    const svc = new SocketService(mockSocket);

    const handler = () => {};
    svc.on('test-event', handler);
    expect(mockOn).toHaveBeenCalledWith('test-event', handler);
  });

  it('delegates off to socket instance', () => {
    const mockOff = vi.fn();
    const mockSocket = { off: mockOff } as unknown as Socket;
    const svc = new SocketService(mockSocket);

    const handler = () => {};
    svc.off('test-event', handler);
    expect(mockOff).toHaveBeenCalledWith('test-event', handler);
  });

  it('delegates disconnect to socket instance', () => {
    const mockDisconnect = vi.fn();
    const mockSocket = { disconnect: mockDisconnect } as unknown as Socket;
    const svc = new SocketService(mockSocket);

    svc.disconnect();
    expect(mockDisconnect).toHaveBeenCalled();
  });
});

// ── UIService Tests ──────────────────────────────────────────────────────

describe('UIService', () => {
  it('showToast delegates to addToast callback', () => {
    const addToast = vi.fn();
    const svc = new UIService(addToast);

    svc.showToast('Title', 'Message', 'warning');
    expect(addToast).toHaveBeenCalledWith('Title', 'Message', 'warning');
  });

  it('showToast defaults to info type', () => {
    const addToast = vi.fn();
    const svc = new UIService(addToast);

    svc.showToast('Title', 'Message');
    expect(addToast).toHaveBeenCalledWith('Title', 'Message', 'info');
  });

  it('showToast logs warning when no callback set', () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const svc = new UIService();

    svc.showToast('Title', 'Message');
    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining('[UIService]'),
      expect.any(String),
      expect.any(String),
    );
    consoleWarn.mockRestore();
  });

  it('showModal sets modal state, closeModal clears it', () => {
    const svc = new UIService();

    svc.showModal('Modal Title', 'content' as any);
    const state = svc.getModalState();
    expect(state?.visible).toBe(true);
    expect(state?.title).toBe('Modal Title');

    svc.closeModal();
    expect(svc.getModalState()).toBeNull();
  });
});

// ── StorageService Tests ─────────────────────────────────────────────────

describe('StorageService', () => {
  let storage: StorageService;

  beforeEach(() => {
    localStorage.clear();
    storage = new StorageService('test-plugin');
  });

  it('sets and gets values with pluginId prefix', () => {
    storage.set('config', 'value1');
    expect(localStorage.getItem('edu_os_plugin:test-plugin:config')).toBe('value1');
    expect(storage.get('config')).toBe('value1');
  });

  it('deletes a key by its logical name', () => {
    storage.set('key1', 'val1');
    storage.delete('key1');
    expect(storage.get('key1')).toBeNull();
  });

  it('clear removes only this plugin\'s keys', () => {
    localStorage.setItem('other-key', 'keep');

    storage.set('a', '1');
    storage.set('b', '2');
    storage.clear();

    expect(storage.get('a')).toBeNull();
    expect(storage.get('b')).toBeNull();
    expect(localStorage.getItem('other-key')).toBe('keep');
  });

  it('returns null for missing keys', () => {
    expect(storage.get('nonexistent')).toBeNull();
  });

  it('isolates keys between different plugin IDs', () => {
    const storageA = new StorageService('plugin-a');
    const storageB = new StorageService('plugin-b');

    storageA.set('shared-key', 'value-a');
    storageB.set('shared-key', 'value-b');

    expect(storageA.get('shared-key')).toBe('value-a');
    expect(storageB.get('shared-key')).toBe('value-b');
  });
});
