/**
 * XueanBlocksEditor：学案首页只保留「简介 + 背景图」。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { XueanBlocksEditor } from '../XueanBlocksEditor';

vi.mock('../../../../context/AppDataContext', () => ({
  useOptionalAppData: () => ({ selectedLesson: 'lesson-1' }),
}));

type Row = {
  id: string;
  lesson_id: string;
  block_type: string;
  order_index: number;
  content_json: string;
};

function homeRow(intro: string, backgroundImage = ''): Row {
  return {
    id: 'home-1',
    lesson_id: 'lesson-1',
    block_type: 'xuean_home',
    order_index: 0,
    content_json: JSON.stringify({ intro, backgroundImage }),
  };
}

function response(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: async () => body } as Response);
}

describe('XueanBlocksEditor（学案首页）', () => {
  const state = {
    blocks: [] as Row[],
    blocksOk: true,
    created: [] as Array<Record<string, unknown>>,
    updated: [] as Array<Record<string, unknown>>,
    uploads: 0,
  };

  beforeEach(() => {
    state.blocks = [];
    state.blocksOk = true;
    state.created = [];
    state.updated = [];
    state.uploads = 0;
    globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/lessons/lesson-1/blocks' && method === 'GET') {
        return state.blocksOk ? response(state.blocks) : response({ error: 'boom' }, false);
      }
      if (url === '/api/lessons/lesson-1/blocks' && method === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}'));
        state.created.push(body);
        return response({ ...homeRow(''), id: 'home-new', content_json: body.content }, true);
      }
      if (url.startsWith('/api/blocks/') && method === 'PUT') {
        const body = JSON.parse(String(init?.body ?? '{}'));
        state.updated.push(body);
        return response({ ...homeRow(''), id: 'home-1', content_json: body.content }, true);
      }
      if (url === '/api/uploads/image') {
        state.uploads += 1;
        return response({ success: true, fileUrl: '/api/files/img-1' });
      }
      return response({ error: 'unexpected' }, false);
    }) as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('加载已有简介与背景图', async () => {
    state.blocks = [homeRow('已有简介', '/api/files/cover-1')];

    render(<XueanBlocksEditor />);

    expect(await screen.findByDisplayValue('已有简介')).toBeTruthy();
    const preview = screen.getByLabelText('学案首页预览') as HTMLElement;
    expect(preview.style.backgroundImage).toContain('/api/files/cover-1');
  });

  it('保存时写入 xuean_home 单块内容', async () => {
    render(<XueanBlocksEditor />);
    expect(await screen.findByPlaceholderText('介绍本节课的学习目标、情境或任务说明…')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('介绍本节课的学习目标、情境或任务说明…'), {
      target: { value: '新的学案简介' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(state.created).toHaveLength(1));
    expect(state.created[0].blockType).toBe('xuean_home');
    expect(JSON.parse(String(state.created[0].content))).toEqual({
      intro: '新的学案简介',
      backgroundImage: '',
    });
  });

  it('上传背景图后保存文件 URL', async () => {
    const { container } = render(<XueanBlocksEditor />);
    await screen.findByPlaceholderText('介绍本节课的学习目标、情境或任务说明…');

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(['png'], 'cover.png', { type: 'image/png' })] },
    });

    await waitFor(() => expect(state.uploads).toBe(1));
    const preview = screen.getByLabelText('学案首页预览') as HTMLElement;
    await waitFor(() => expect(preview.style.backgroundImage).toContain('/api/files/img-1'));

    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(state.created).toHaveLength(1));
    expect(JSON.parse(String(state.created[0].content))).toEqual({
      intro: '',
      backgroundImage: '/api/files/img-1',
    });
  });

  it('加载失败显示错误态并可重试', async () => {
    state.blocksOk = false;
    render(<XueanBlocksEditor />);

    expect(await screen.findByText('学案首页加载失败，请稍后重试')).toBeTruthy();

    state.blocksOk = true;
    state.blocks = [homeRow('恢复后的简介')];
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByDisplayValue('恢复后的简介')).toBeTruthy();
  });
});
