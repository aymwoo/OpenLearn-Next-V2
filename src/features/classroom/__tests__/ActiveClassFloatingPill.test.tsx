import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ActiveClassFloatingPill } from '../ActiveClassFloatingPill';
import { AppDataProvider, type AppDataValue } from '../../../context/AppDataContext';
import { appStore } from '../../../store/appStore';
import { liveClassStore } from '../../../store/liveClassStore';

/** 悬浮胶囊只消费 `students` 与可选的 `fetchStudents`，其余字段按上下文契约补齐。 */
const appData = { students: [] } as unknown as AppDataValue;

function renderPill() {
  return render(
    <AppDataProvider value={appData}>
      <ActiveClassFloatingPill />
    </AppDataProvider>,
  );
}

function stubFetch(handlers?: {
  session?: { hasActiveSession: boolean; session: { id: string } | null };
  archiveOk?: boolean;
  deleteOk?: boolean;
}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'DELETE') {
      return {
        ok: handlers?.deleteOk ?? true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response;
    }
    if (url.endsWith('/archive')) {
      return {
        ok: handlers?.archiveOk ?? true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => handlers?.session ?? { hasActiveSession: true, session: { id: 'sess-live-1' } },
    } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('ActiveClassFloatingPill (全局授课悬浮监控胶囊)', () => {
  beforeEach(() => {
    appStore.setState({
      lang: 'zh',
      teacherTab: 'plugins',
      selectedLesson: 'lesson-101',
      lessons: [{ id: 'lesson-101', title: 'Python 科学计算与图形白板' } as any],
      classes: [{ id: 'class-1', name: '高一(1)班' } as any],
    });
    liveClassStore.setState({
      liveClassIsActive: true,
      liveClassTimeRemaining: 450, // 07:30
      liveClassSelectedClassId: 'class-1',
      onlineStudentIds: ['s1', 's2', 's3'],
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders pill when not in live_class and active teaching is running', () => {
    renderPill();

    expect(screen.getByTestId('active-class-floating-pill')).toBeTruthy();
    expect(screen.getByText('正在授课')).toBeTruthy();
    expect(screen.getByText('Python 科学计算与图形白板')).toBeTruthy();
    expect(screen.getByText('高一(1)班')).toBeTruthy();
    expect(screen.getByText('07:30')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy(); // online count
  });

  it('does NOT render pill when already inside live_class tab', () => {
    appStore.setState({ teacherTab: 'live_class' });
    renderPill();

    expect(screen.queryByTestId('active-class-floating-pill')).toBeNull();
  });

  it('does NOT render pill when there is no active lesson session', () => {
    appStore.setState({ teacherTab: 'plugins', selectedLesson: null });
    liveClassStore.setState({ liveClassIsActive: false, liveClassTimeRemaining: 0 });
    renderPill();

    expect(screen.queryByTestId('active-class-floating-pill')).toBeNull();
  });

  it('navigates back to live_class instantly on "返回白板" button click', () => {
    const setTeacherTabSpy = vi.fn();
    appStore.setState({ setTeacherTab: setTeacherTabSpy });

    renderPill();

    fireEvent.click(screen.getByText('返回白板'));

    expect(setTeacherTabSpy).toHaveBeenCalledWith('live_class');
  });

  describe('结束课程（归档并结束 / 直接结束）', () => {
    it('offers both archive-and-end and direct-end choices', async () => {
      stubFetch();
      renderPill();

      fireEvent.click(screen.getByTestId('active-pill-end-class-btn'));

      expect(await screen.findByText('结束本次课程？')).toBeTruthy();
      expect(await screen.findByText('归档并结束')).toBeTruthy();
      expect(screen.getByText('直接结束')).toBeTruthy();
    });

    it('archives the session, ends the class and dismisses the pill', async () => {
      const fetchMock = stubFetch();
      renderPill();

      fireEvent.click(screen.getByTestId('active-pill-end-class-btn'));
      fireEvent.click(await screen.findByText('归档并结束'));

      await waitFor(() => expect(screen.queryByTestId('active-class-floating-pill')).toBeNull());
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith('/api/classroom/sessions/sess-live-1/archive') && init?.method === 'POST',
        ),
      ).toBe(true);
      expect(liveClassStore.getState().liveClassIsActive).toBe(false);
      expect(liveClassStore.getState().liveClassTimeRemaining).toBe(0);
    });

    it('requires a second confirmation before deleting the session', async () => {
      const fetchMock = stubFetch();
      renderPill();

      fireEvent.click(screen.getByTestId('active-pill-end-class-btn'));
      fireEvent.click(await screen.findByText('直接结束'));

      // 第一次点击只是展开二次确认，不能直接删除
      expect(await screen.findByText('确认直接结束课程？')).toBeTruthy();
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);

      fireEvent.click(screen.getByText('确认删除并结束'));

      await waitFor(() => expect(screen.queryByTestId('active-class-floating-pill')).toBeNull());
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) => String(url).endsWith('/api/classroom/sessions/sess-live-1') && init?.method === 'DELETE',
        ),
      ).toBe(true);
      expect(liveClassStore.getState().liveClassIsActive).toBe(false);
      expect(liveClassStore.getState().liveClassTimeRemaining).toBe(0);
    });

    it('dismisses a stale pill when the server reports no active session', async () => {
      stubFetch({ session: { hasActiveSession: false, session: null } });
      renderPill();

      fireEvent.click(screen.getByTestId('active-pill-end-class-btn'));

      await waitFor(() => expect(screen.queryByTestId('active-class-floating-pill')).toBeNull());
      expect(liveClassStore.getState().liveClassTimeRemaining).toBe(0);
    });
  });
});
