/**
 * XueanBlocksEditor：逐条编辑、互动课件可视化选择、拖拽排序与错误态。
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
  created_at: number;
  updated_at: number;
};

function row(id: string, order: number, blockType = 'learning_goals', content = '["目标"]'): Row {
  return {
    id,
    lesson_id: 'lesson-1',
    block_type: blockType,
    order_index: order,
    content_json: content,
    created_at: 1,
    updated_at: 1,
  };
}

function response(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: async () => body } as Response);
}

describe('XueanBlocksEditor', () => {
  const state = {
    blocks: [] as Row[],
    blocksOk: true,
    created: [] as Array<Record<string, unknown>>,
    reordered: [] as string[][],
  };

  beforeEach(() => {
    state.blocks = [];
    state.blocksOk = true;
    state.created = [];
    state.reordered = [];
    globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/lessons/lesson-1/blocks' && method === 'GET') {
        return state.blocksOk ? response(state.blocks) : response({ error: 'boom' }, false);
      }
      if (url === '/api/lessons/lesson-1/blocks' && method === 'POST') {
        state.created.push(JSON.parse(String(init?.body ?? '{}')));
        return response(row('new-block', state.blocks.length), true);
      }
      if (url === '/api/lessons/lesson-1/blocks/reorder') {
        state.reordered.push((JSON.parse(String(init?.body ?? '{}')).ids ?? []) as string[]);
        return response([]);
      }
      if (url === '/api/courseware') {
        return response([{ id: 'cw_1', uuid: 'u1', name: '分数演示', type: 'html', entry: 'index.html' }]);
      }
      return response({ error: 'unexpected' }, false);
    }) as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('数组型首页块逐条编辑并保存为 JSON 数组', async () => {
    render(<XueanBlocksEditor />);
    expect(await screen.findByText('学案首页还没有内容')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '+ 新增首页块' }));
    await screen.findByRole('dialog');

    const first = screen.getAllByPlaceholderText('填写一条内容')[0];
    fireEvent.change(first, { target: { value: '目标一' } });
    fireEvent.click(screen.getByRole('button', { name: '+ 添加一条' }));
    const inputs = screen.getAllByPlaceholderText('填写一条内容');
    fireEvent.change(inputs[1], { target: { value: '目标二' } });

    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(state.created).toHaveLength(1));
    expect(state.created[0].blockType).toBe('learning_goals');
    expect(JSON.parse(String(state.created[0].content))).toEqual(['目标一', '目标二']);
  });

  it('互动课件块通过选择器写入 coursewareUuid', async () => {
    render(<XueanBlocksEditor />);
    await screen.findByText('学案首页还没有内容');

    fireEvent.click(screen.getByRole('button', { name: '+ 新增首页块' }));
    await screen.findByRole('dialog');

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'interactive_courseware' } });
    expect(await screen.findByRole('option', { name: /分数演示/ })).toBeTruthy();
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'u1' } });

    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(state.created).toHaveLength(1));
    expect(state.created[0].blockType).toBe('interactive_courseware');
    expect(JSON.parse(String(state.created[0].content))).toEqual({ coursewareUuid: 'u1' });
  });

  it('下移首页块时提交新的 id 顺序', async () => {
    state.blocks = [row('b1', 0, 'learning_goals', '["第一块"]'), row('b2', 1, 'free_html', '"<p>第二块</p>"')];

    render(<XueanBlocksEditor />);
    await screen.findByText('#1');

    fireEvent.click(screen.getAllByRole('button', { name: '下移' })[0]);

    await waitFor(() => expect(state.reordered).toHaveLength(1));
    expect(state.reordered[0]).toEqual(['b2', 'b1']);
  });

  it('加载失败显示错误态并可重试', async () => {
    state.blocksOk = false;
    render(<XueanBlocksEditor />);

    expect(await screen.findByText('首页块加载失败，请稍后重试')).toBeTruthy();

    state.blocksOk = true;
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('学案首页还没有内容')).toBeTruthy();
  });
});
