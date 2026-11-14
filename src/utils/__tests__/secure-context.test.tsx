import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { inspectSecureContext } from '../secure-context';
import { PreflightHealthModal } from '../../features/classroom/PreflightHealthModal';

describe('secure-context capability detection (Issue #518)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects plain LAN HTTP insecure context and lists HTTPS-only features cleanly', () => {
    vi.stubGlobal('isSecureContext', false);
    vi.stubGlobal('location', {
      hostname: '192.168.3.211',
      origin: 'http://192.168.3.211:9000',
    });

    const report = inspectSecureContext('zh');
    expect(report.isSecureContext).toBe(false);
    expect(report.isLoopbackHost).toBe(false);
    expect(report.origin).toBe('http://192.168.3.211:9000');
    expect(report.capabilities.clipboardWrite).toBe('fallback');
    expect(report.capabilities.mediaDevices).toBe('https-required');
    expect(report.capabilities.speechRecognition).toBe('https-required');
    expect(report.httpsOnlyFeatures.length).toBeGreaterThan(0);
  });

  it('recognizes localhost and HTTPS origins as secure context', () => {
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('location', {
      hostname: 'classroom.school.edu.cn',
      origin: 'https://classroom.school.edu.cn',
    });

    const report = inspectSecureContext('en');
    expect(report.isSecureContext).toBe(true);
    expect(report.httpsOnlyFeatures).toEqual([]);
  });

  it('surfaces browser secure-context guidance row inside PreflightHealthModal', () => {
    vi.stubGlobal('isSecureContext', false);
    vi.stubGlobal('location', {
      hostname: '192.168.3.211',
      origin: 'http://192.168.3.211:9000',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          healthScore: 99,
          checks: {
            localApiLatencyMs: 3,
            staticResources: { status: 'passed', message: 'ok' },
            pluginSandbox: { status: 'passed', message: 'ok' },
            socketMesh: { status: 'passed', message: 'ok' },
          },
        }),
      }),
    );

    render(<PreflightHealthModal isOpen={true} onClose={vi.fn()} classId="cls-1" lang="zh" />);

    const row = screen.getByTestId('preflight-secure-context-row');
    expect(row.textContent).toContain('192.168.3.211:9000');
    expect(row.textContent).toContain('HTTPS');
  });
});
