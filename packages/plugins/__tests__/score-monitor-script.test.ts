// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SCORE_MONITOR_SCRIPT, SCORE_MONITOR_SCRIPT_ID, SCORE_MONITOR_SCRIPT_OWNER } from '../score-monitor-script.js';

/**
 * 平台原生分数变量监视器（阶段 B）行为测试。
 *
 * 该脚本最终会被原样嵌进课件 HTML 的 `<script>` 标签，因此除了行为正确，
 * 还必须保证「字面量安全」：不含反斜杠转义序列（历史上曾因模板字符串双重转义出事故），
 * 也不含会提前闭合标签的 `</script` 文本。
 */
function bootstrap(options: { withLms?: boolean; student?: boolean; disabled?: boolean; watch?: any } = {}): any[] {
  const withLms = options.withLms !== false;
  const calls: any[] = [];
  (window as any).__LMS_SCORE_WATCHER_READY__ = false;
  delete (window as any).__LMS_WATCH__;
  if (Object.prototype.hasOwnProperty.call(options, 'watch')) (window as any).__LMS_WATCH__ = options.watch;
  delete (window as any).__LMS_WATCH_DISABLED__;
  if (options.disabled) (window as any).__LMS_WATCH_DISABLED__ = true;
  delete (window as any).LMS;
  if (withLms) (window as any).LMS = { saveProgress: (payload: any) => calls.push(payload) };
  delete (window as any).__LMS_STUDENT__;
  if (options.student !== false) (window as any).__LMS_STUDENT__ = { attempt_id: 'att_test' };
  (window as any).__LMS_COURSEWARE__ = { uuid: 'cw_test' };
  // eslint-disable-next-line no-new-func
  new Function(SCORE_MONITOR_SCRIPT)();
  return calls;
}

describe('platform native score monitor script', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    delete (window as any).userScore;
    delete (window as any).__LMS_WATCH__;
    // jsdom 下 getBoundingClientRect 恒为 0，会造成可见性判定失败 → 稳定桩为非零尺寸
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ width: 120, height: 24, top: 0, left: 0, right: 120, bottom: 24, x: 0, y: 0, toJSON: () => ({}) }) as any,
    );
  });

  afterEach(async () => {
    // 显式停掉此前各用例遗留的监视器（脚本暴露 __LMS_SCORE_WATCHERS__ 停靠口），保证用例互不干扰
    const watchers = (window as any).__LMS_SCORE_WATCHERS__ || [];
    for (const watcher of watchers) {
      try {
        watcher.stop();
      } catch (err) {
        /* noop */
      }
    }
    delete (window as any).__LMS_SCORE_WATCHERS__;
    (window as any).__LMS_WATCH_DISABLED__ = true;
    await vi.advanceTimersByTimeAsync(1000);
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    delete (window as any).LMS;
    delete (window as any).__LMS_STUDENT__;
    delete (window as any).__LMS_COURSEWARE__;
    delete (window as any).__LMS_SCORE_WATCHER_READY__;
    delete (window as any).__LMS_WATCH_DISABLED__;
    delete (window as any).userScore;
  });

  it('元数据与字面量安全（无反斜杠转义、无 </script）', () => {
    expect(SCORE_MONITOR_SCRIPT_ID).toBe('score-variable-monitor');
    expect(SCORE_MONITOR_SCRIPT_OWNER).toBe('@openlearn/plugin-builtin');
    expect(SCORE_MONITOR_SCRIPT.includes('\\')).toBe(false);
    expect(SCORE_MONITOR_SCRIPT.toLowerCase().includes('</script')).toBe(false);
    // 语法必须可解析
    expect(() => new Function(SCORE_MONITOR_SCRIPT)).not.toThrow();
  });

  it('变量无变化时不产生任何上报（空闲零噪声）', async () => {
    (window as any).userScore = 10;
    const calls = bootstrap();
    await vi.advanceTimersByTimeAsync(800 * 5);
    expect(calls).toHaveLength(0);
  });

  it('声明变量变化并静默后上报一次样本', async () => {
    (window as any).userScore = 10;
    const calls = bootstrap();
    (window as any).userScore = 55;
    await vi.advanceTimersByTimeAsync(900); // 一次 tick 发现变化
    expect(calls).toHaveLength(0); // 仍在静默窗口内
    await vi.advanceTimersByTimeAsync(1300); // 静默到期 → flush
    expect(calls).toHaveLength(1);
    expect(calls[0].score).toBe(55);
    expect(calls[0].watch.userScore).toBe(55);
    expect(calls[0].watch._changed).toContain('userScore');
  });

  it('显式声明 window.__LMS_WATCH__ 时只监视声明的路径', async () => {
    (window as any).userScore = 10;
    (window as any).myPoints = 3;
    const calls = bootstrap({ watch: 'myPoints' });
    (window as any).userScore = 90; // 未声明 → 忽略
    (window as any).myPoints = 42;
    await vi.advanceTimersByTimeAsync(900);
    await vi.advanceTimersByTimeAsync(1300);
    expect(calls).toHaveLength(1);
    expect(calls[0].score).toBe(42);
    expect(calls[0].watch.userScore).toBeUndefined();
  });

  it('DOM 可见元素吞底：一次性捕获 82 分', async () => {
    const calls = bootstrap();
    const el = document.createElement('div');
    el.id = 'score';
    el.textContent = '82';
    document.body.appendChild(el);
    await vi.advanceTimersByTimeAsync(900);
    await vi.advanceTimersByTimeAsync(1300);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const sample = calls.find((c) => c.score === 82);
    expect(sample).toBeTruthy();
    expect(sample.watch.dom__score).toBe(82);
  });

  it('比例文本 82/100 归一化为百分制', async () => {
    const calls = bootstrap();
    const el = document.createElement('div');
    el.className = 'score';
    el.textContent = '82/100';
    document.body.appendChild(el);
    await vi.advanceTimersByTimeAsync(900);
    await vi.advanceTimersByTimeAsync(1300);
    expect(calls.some((c) => c.score === 82)).toBe(true);
  });

  it('window.__LMS_WATCH__ === false 时不启动监视', async () => {
    (window as any).userScore = 10;
    const calls = bootstrap({ watch: false });
    (window as any).userScore = 99;
    await vi.advanceTimersByTimeAsync(800 * 5);
    expect(calls).toHaveLength(0);
  });

  it('window.__LMS_WATCH_DISABLED__ 时不启动监视', async () => {
    (window as any).userScore = 10;
    const calls = bootstrap({ disabled: true });
    (window as any).userScore = 99;
    await vi.advanceTimersByTimeAsync(800 * 5);
    expect(calls).toHaveLength(0);
  });

  it('缺少 student.attempt_id 时不上报（访客/预览不污染成绩）', async () => {
    (window as any).userScore = 10;
    const calls = bootstrap({ student: false });
    (window as any).userScore = 66;
    await vi.advanceTimersByTimeAsync(800 * 3);
    expect(calls).toHaveLength(0);
  });

  it('无 window.LMS 时回退到 postMessage 通道', async () => {
    (window as any).userScore = 10;
    const posted: any[] = [];
    const spy = vi.spyOn(window.parent, 'postMessage').mockImplementation(((msg: any) => {
      posted.push(msg);
    }) as any);
    bootstrap({ withLms: false });
    (window as any).userScore = 77;
    await vi.advanceTimersByTimeAsync(900);
    await vi.advanceTimersByTimeAsync(1300);
    expect(posted.some((m) => m.type === 'LMS_SAVE_PROGRESS' && m.payload?.score === 77)).toBe(true);
    spy.mockRestore();
  });
});
