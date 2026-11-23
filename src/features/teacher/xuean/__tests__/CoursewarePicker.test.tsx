/**
 * CoursewarePicker：课件列表、搜索、上传与 ZIP 入口确认。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { CoursewarePicker } from '../CoursewarePicker';

type Route = { ok: boolean; body: unknown };

function response(route: Route = { ok: true, body: [] }) {
  return Promise.resolve({ ok: route.ok, json: async () => route.body } as Response);
}

const BASE_ROWS = [
  { id: 'cw_1', uuid: 'u1', name: '分数演示', type: 'html', entry: 'index.html' },
  { id: 'cw_2', uuid: 'u2', name: '几何实验室', type: 'folder', entry: 'main.html' },
];

describe('CoursewarePicker', () => {
  const handlers = {
    list: vi.fn<(...args: unknown[]) => Promise<Response>>(),
    upload: vi.fn<(...args: unknown[]) => Promise<Response>>(),
    confirm: vi.fn<(...args: unknown[]) => Promise<Response>>(),
  };

  beforeEach(() => {
    handlers.list.mockReset().mockImplementation(() => response({ ok: true, body: BASE_ROWS }));
    handlers.upload.mockReset();
    handlers.confirm.mockReset();
    globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/courseware' && (!init || !init.method)) return handlers.list();
      if (url === '/api/courseware/upload') return handlers.upload(init?.body);
      if (url === '/api/courseware/confirm') return handlers.confirm(init?.body);
      return response({ ok: false, body: { error: 'unexpected' } });
    }) as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('加载课件列表并在选择时回调 uuid 与行数据', async () => {
    const onChange = vi.fn();
    render(<CoursewarePicker value="" onChange={onChange} />);

    expect(await screen.findByRole('option', { name: /分数演示/ })).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'u2' } });

    expect(onChange).toHaveBeenCalledWith('u2', expect.objectContaining({ name: '几何实验室' }));
  });

  it('按关键字搜索课件', async () => {
    render(<CoursewarePicker value="" onChange={vi.fn()} />);
    await screen.findByRole('option', { name: /分数演示/ });

    fireEvent.change(screen.getByPlaceholderText('搜索课件名称'), { target: { value: '几何' } });

    expect(screen.queryByRole('option', { name: /分数演示/ })).toBeNull();
    expect(screen.getByRole('option', { name: /几何实验室/ })).toBeTruthy();
  });

  it('上传 HTML 课件后自动选中并回调', async () => {
    handlers.upload.mockImplementationOnce(() =>
      response({ ok: true, body: { success: true, id: 'cw_new', uuid: 'u_new', name: '新课件', entry: 'index.html' } }),
    );
    const onChange = vi.fn();
    const { container } = render(<CoursewarePicker value="" onChange={onChange} />);
    await screen.findByRole('option', { name: /分数演示/ });

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(['<html></html>'], 'demo.html', { type: 'text/html' })] },
    });

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith('u_new', expect.objectContaining({ name: '新课件', type: 'html' })),
    );
    expect(handlers.upload).toHaveBeenCalledTimes(1);
  });

  it('ZIP 多入口时先选择入口再 confirm', async () => {
    handlers.upload.mockImplementationOnce(() =>
      response({
        ok: true,
        body: {
          success: true,
          need_select_entry: true,
          uuid: 'u_zip',
          name: '压缩课件',
          candidates: ['a.html', 'b.html'],
        },
      }),
    );
    handlers.confirm.mockImplementationOnce(() =>
      response({ ok: true, body: { success: true, id: 'cw_zip', uuid: 'u_zip', name: '压缩课件', entry: 'b.html' } }),
    );
    const onChange = vi.fn();
    const { container } = render(<CoursewarePicker value="" onChange={onChange} />);
    await screen.findByRole('option', { name: /分数演示/ });

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(['zip'], 'pack.zip', { type: 'application/zip' })] },
    });

    expect(await screen.findByText('ZIP 中有多个入口页，请选择要展示的页面：')).toBeTruthy();
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'b.html' } });
    fireEvent.click(screen.getByRole('button', { name: '确认入口' }));

    await waitFor(() => expect(handlers.confirm).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(handlers.confirm.mock.calls[0][0]))).toEqual({
      uuid: 'u_zip',
      name: '压缩课件',
      entry: 'b.html',
    });
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith('u_zip', expect.objectContaining({ entry: 'b.html', type: 'folder' })),
    );
  });

  it('拒绝不支持的扩展名且不上传', async () => {
    const { container } = render(<CoursewarePicker value="" onChange={vi.fn()} />);
    await screen.findByRole('option', { name: /分数演示/ });

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(['text'], 'notes.txt', { type: 'text/plain' })] },
    });

    expect(await screen.findByText('仅支持 .html / .htm / .zip 课件')).toBeTruthy();
    expect(handlers.upload).not.toHaveBeenCalled();
  });
});
