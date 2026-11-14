import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { AiProvidersPanel } from '../AiProvidersPanel';

describe('AiProvidersPanel URL 校验与 IP 地址支持 (Issue #508)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(window, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
  });

  it('允许提交内网/本地 IP + 自定义端口与路径的 AI Provider 且无误报', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ success: true, id: 'prov_ip_1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const onChanged = vi.fn();

    render(
      <AiProvidersPanel
        lang="zh"
        aiProviders={[]}
        onAIProvidersChanged={onChanged}
        currentUserId="admin_1"
        currentUserRole="administrator"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /添加 AI 提供商/ }));

    fireEvent.change(screen.getByLabelText(/服务商名称/), { target: { value: 'LAN Ollama' } });
    fireEvent.change(screen.getByLabelText(/API 端点 URL/), { target: { value: 'http://192.168.1.100:11434/v1' } });
    fireEvent.change(screen.getByLabelText(/模型代号/), { target: { value: 'qwen2.5:7b' } });

    fireEvent.click(screen.getByRole('button', { name: /保存至数据库/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/ai-providers',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('http://192.168.1.100:11434/v1'),
        }),
      );
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('对缺少协议或命中安全策略的 URL 显示可访问行内错误且不发起保存请求', async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith('/api/agent/personas')) {
        return Promise.resolve(new Response(JSON.stringify({ success: true, personas: [] }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AiProvidersPanel
        lang="zh"
        aiProviders={[]}
        onAIProvidersChanged={vi.fn()}
        currentUserId="admin_1"
        currentUserRole="administrator"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /添加 AI 提供商/ }));

    fireEvent.change(screen.getByLabelText(/服务商名称/), { target: { value: 'Invalid IP' } });
    const urlInput = screen.getByLabelText(/API 端点 URL/) as HTMLInputElement;
    fireEvent.change(urlInput, { target: { value: '192.168.1.100:11434/v1' } });
    fireEvent.change(screen.getByLabelText(/模型代号/), { target: { value: 'qwen2.5' } });

    fireEvent.click(screen.getByRole('button', { name: /保存至数据库/ }));

    expect(urlInput.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(urlInput);
    expect(screen.getByText(/必须以 http:\/\/ 或 https:\/\/ 开头/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/ai-providers', expect.anything());

    // 输入时清除错误，失焦对链路本地地址提示安全策略拦截原因
    fireEvent.change(urlInput, { target: { value: 'http://169.254.169.254/v1' } });
    expect(urlInput.getAttribute('aria-invalid')).toBe('false');
    fireEvent.blur(urlInput);
    expect(urlInput.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(/链路本地地址/)).toBeTruthy();
  });

  it('点击测试按钮对 IP 地址提供商发送测试请求并正确处理成功与失败提示', async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith('/api/agent/personas')) {
        return Promise.resolve(new Response(JSON.stringify({ success: true, personas: [] }), { status: 200 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ success: true, message: 'ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AiProvidersPanel
        lang="zh"
        aiProviders={[
          {
            id: 'prov_lan',
            name: 'LAN vLLM',
            api_url: 'http://10.0.0.8:8000/v1',
            api_key: 'sk-****1234',
            model_name: 'qwen2.5',
            owner_id: 'admin_1',
            is_shared: 1,
          },
        ]}
        onAIProvidersChanged={vi.fn()}
        currentUserId="admin_1"
        currentUserRole="administrator"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /测试/ }));

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith('[LAN vLLM] 连接测试成功！');
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ai-providers/test',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('http://10.0.0.8:8000/v1'),
      }),
    );
  });
});
