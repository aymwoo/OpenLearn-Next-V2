import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { LazyCourseware } from '../LazyCourseware';

/**
 * `LazyCourseware` 内部用 `React.lazy` + `Suspense` 加载 `InteractiveCoursewareViewer`。
 *
 * 两处加固：
 * 1. `waitFor` 默认预算只有 1000ms，而实测第一个用例已消耗 ~320ms（仅 ~3× 余量），
 *    在慢速 runner（CI 2–4 vCPU、共享 I/O）上容易被击穿 —— 显式给出预算；
 * 2. 预热动态 import，使 `React.lazy` 直接命中模块缓存，不把 vitest 的 transform
 *    开销算进断言窗口内（与 AppShell 测试同一手法）。
 */
const LAZY_TIMEOUT = 10_000;

beforeAll(async () => {
  await import('../../features/courseware/InteractiveCoursewareViewer');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// SEC-AUTH: InteractiveCoursewareViewer 先经 /access-token 铸造短时 token，
// 拿到 token 前渲染「课件加载中」占位而非 iframe。测试环境 mock 铸造端点。
function stubAccessTokenMint() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: '1759000000000.testsig' }), { status: 200 })),
  );
}

describe('LazyCourseware', () => {
  it('renders without error and shows placeholder when coursewareId is null', async () => {
    render(<LazyCourseware coursewareId={null} />);

    await waitFor(
      () => {
        expect(screen.getByText('No Courseware Selected')).toBeTruthy();
      },
      { timeout: LAZY_TIMEOUT },
    );
  });

  it('renders interactive courseware iframe when coursewareId is provided', async () => {
    stubAccessTokenMint();
    render(<LazyCourseware coursewareId="courseware-123" />);

    await waitFor(
      () => {
        const iframe = screen.getByTitle('Interactive Courseware') as HTMLIFrameElement;
        expect(iframe).toBeTruthy();
        expect(iframe.src).toContain('/api/courseware/courseware-123');
        expect(iframe.src).toContain('?ct=');
      },
      { timeout: LAZY_TIMEOUT },
    );
  });

  it('handles onClose callback correctly', async () => {
    stubAccessTokenMint();
    const handleClose = vi.fn();
    render(<LazyCourseware coursewareId="courseware-123" onClose={handleClose} />);

    await waitFor(
      () => {
        expect(screen.getByTitle('Interactive Courseware')).toBeTruthy();
      },
      { timeout: LAZY_TIMEOUT },
    );

    const closeBtn = screen.getByRole('button', { name: '' });
    // Find the button with close icon (last button in header)
    const buttons = screen.getAllByRole('button');
    const closeButton = buttons[buttons.length - 1];
    closeButton.click();
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
