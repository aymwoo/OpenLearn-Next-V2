import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { LearningSurfaceHost } from '../LearningSurfaceHost';

/**
 * LearningSurface 宿主与内置渲染器（阶段 4）。
 *
 * - html_courseware 复用 CoursewareHost（iframe 沙箱）；
 * - presentation 内联 Markdown 走注册表渲染；
 * - 插件渲染器按目录项落到 sandbox；
 * - 未知渲染器 / 读取失败 / 引用损坏显示可读占位。
 */

function jsonResponse(data: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => data,
  } as unknown as Response;
}

function surfaceRow(contentRef: unknown) {
  return {
    id: 'surface-1',
    lesson_id: 'lesson-1',
    kind: 'lesson_activity',
    owner_id: 'activity-1',
    content_ref_json: JSON.stringify(contentRef),
    deleted_at: null,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LearningSurfaceHost', () => {
  it('html_courseware + courseware 走沙箱 iframe', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/learning-surfaces/surface-1')) {
          return jsonResponse(
            surfaceRow({
              rendererId: 'html_courseware',
              source: { kind: 'courseware', id: 'cw-1' },
              config: { title: '课件一' },
            }),
          );
        }
        if (url.includes('/api/courseware/host')) return jsonResponse({ data: { kind: 'builtin' } });
        if (url.includes('/access-token')) return jsonResponse({ token: 'token-1' });
        return jsonResponse({});
      }),
    );

    const { container } = render(
      <LearningSurfaceHost surfaceId="surface-1" lessonId="lesson-1" hostId="element-1" lazy={false} />,
    );

    const iframe = await screen.findByTitle('课件一');
    expect(iframe.tagName).toBe('IFRAME');
    expect(container.querySelector('iframe')?.getAttribute('src')).toContain('/runtime/cw-1/');
    expect(container.querySelector('[data-surface-scope="element-1"]')).toBeTruthy();
  });

  it('presentation 内联 Markdown 进入演示文稿渲染器', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/learning-surfaces/surface-1')) {
          return jsonResponse(
            surfaceRow({
              rendererId: 'presentation',
              source: { kind: 'inline' },
              config: { markdown: '# 第一页\n---\n## 第二页' },
            }),
          );
        }
        return jsonResponse({});
      }),
    );

    render(<LearningSurfaceHost surfaceId="surface-1" lessonId="lesson-1" />);

    expect(await screen.findByTestId('learning-surface-presentation')).toBeTruthy();
    const presentation = screen.getByTestId('learning-surface-presentation');
    expect(presentation.getAttribute('data-surface-scope')).toBe('surface-1');
    expect(presentation.getAttribute('tabindex')).toBe('0');
    expect(presentation.getAttribute('role')).toBe('group');
    expect(screen.getByRole('button', { name: '全屏查看' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('插件渲染器按目录项落到 sandbox', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/learning-surfaces/surface-1')) {
          return jsonResponse(surfaceRow({ rendererId: 'plugin-quiz', source: { kind: 'resource', id: 'r-1' } }));
        }
        if (url.includes('/api/learning-surface-renderers')) {
          return jsonResponse({
            data: [
              {
                id: 'plugin-quiz',
                label: '插件测验',
                execution: 'sandbox',
                capabilities: ['progress', 'submittable'],
                sourceKinds: ['resource'],
                defaultSize: { width: 640, height: 400 },
                pluginId: 'ext-quiz',
                view: 'surface.html',
              },
            ],
          });
        }
        return jsonResponse({});
      }),
    );

    render(<LearningSurfaceHost surfaceId="surface-1" lessonId="lesson-1" />);

    const sandbox = await screen.findByTestId('learning-surface-sandbox');
    expect(sandbox.querySelector('iframe')?.getAttribute('src')).toBe('/plugins/ext-quiz/surface.html');
  });

  it('未知渲染器显示占位而不是报错', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/learning-surfaces/surface-1')) {
          return jsonResponse(surfaceRow({ rendererId: 'missing-renderer', source: { kind: 'resource', id: 'r-1' } }));
        }
        return jsonResponse({ data: [] });
      }),
    );

    render(<LearningSurfaceHost surfaceId="surface-1" lessonId="lesson-1" />);

    const placeholder = await screen.findByTestId('learning-surface-placeholder');
    expect(placeholder.getAttribute('data-renderer')).toBe('missing-renderer');
    expect(placeholder.getAttribute('role')).toBe('status');
  });

  it('Surface 读取失败时显示错误态', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'not found' }, { ok: false, status: 404 })),
    );

    render(<LearningSurfaceHost surfaceId="missing" lessonId="lesson-1" />);

    const placeholder = await screen.findByTestId('learning-surface-placeholder');
    expect(placeholder.textContent).toContain('HTTP 404');
    expect(placeholder.getAttribute('role')).toBe('alert');
  });

  it('内容引用损坏时显示错误态', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          id: 'surface-1',
          lesson_id: 'lesson-1',
          kind: 'lesson_activity',
          owner_id: 'activity-1',
          content_ref_json: '{broken',
          deleted_at: null,
        }),
      ),
    );

    render(<LearningSurfaceHost surfaceId="surface-1" lessonId="lesson-1" />);

    const placeholder = await screen.findByTestId('learning-surface-placeholder');
    expect(placeholder.textContent).toContain('内容引用损坏');
  });

  it('加载中暴露 status 与 aria-busy', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );

    render(<LearningSurfaceHost surfaceId="surface-1" lessonId="lesson-1" />);

    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(status.textContent).toContain('内容加载中');
  });
});
