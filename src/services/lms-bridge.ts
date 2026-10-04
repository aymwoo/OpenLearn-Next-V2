import { useEffect } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { frontendEventBus } from './event-bus';
import type { SessionType } from '../types/app';

export interface LmsMessagePayload {
  attempt_id?: string;
  uuid?: string;
  type?: string;
  payload?: any;
  score?: number;
  grade?: number;
  result?: any;
  points?: number;
  comment?: string;
  feedback?: string;
  note?: string;
  completion?: number;
  [key: string]: any;
}

/**
 * attempt 认领缓存：原始 attemptId → 认领后的 attemptId。
 * 同一页面会话内只需认领一次，避免每条消息都多打一次请求。
 */
const adoptedAttemptIds = new Map<string, string>();
const pendingAdoptions = new Map<string, Promise<string>>();

/**
 * 归属认领。
 *
 * 背景：课件 iframe 以 `credentialless` + `sandbox`（无 allow-same-origin）加载，
 * 访问 `/runtime/:uuid/` 时**不携带会话 cookie**，服务端 `injectLmsSdk` 只能识别为匿名，
 * 从而建出一条 `student_id='guest'` 的共享 attempt（同一课件的所有匿名访问者复用同一条）。
 * 后果：所有学生共用一个 attempt，真实学生提交时因归属不符被 403 丢弃。
 *
 * 修复：由持有会话 cookie 的父窗口（本模块）在转发上报前先请求服务端把该 attempt
 * 认领到当前登录学生名下；若该 attempt 已归属其他学生，服务端会为当前学生新建/复用
 * 他自己的 attempt 并返回其 id。
 *
 * 优化：增加并发 Promise 锁闭，防止多条消息并发时重复发送认领请求。
 */
async function adoptAttempt(attemptId: string): Promise<string> {
  const cached = adoptedAttemptIds.get(attemptId);
  if (cached) return cached;
  const inFlight = pendingAdoptions.get(attemptId);
  if (inFlight) return inFlight;

  const promise = (async () => {
    try {
      const res = await fetch(`/api/courseware/attempts/${encodeURIComponent(attemptId)}/adopt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) {
        if (res.status !== 401) {
          console.warn(`[LMS Bridge] Attempt adopt failed: HTTP ${res.status}`);
        }
        return attemptId;
      }
      const json = (await res.json()) as { attemptId?: string };
      if (typeof json?.attemptId === 'string' && json.attemptId) {
        adoptedAttemptIds.set(attemptId, json.attemptId);
        return json.attemptId;
      }
      return attemptId;
    } catch (e) {
      console.warn('[LMS Bridge] Attempt adopt request failed:', e);
      return attemptId;
    } finally {
      pendingAdoptions.delete(attemptId);
    }
  })();

  pendingAdoptions.set(attemptId, promise);
  return promise;
}

const managedIframes = new Set<HTMLIFrameElement>();

/**
 * 注册受管辖课件/小部件 iframe，提供 O(1) 跨窗口来源快速比对
 */
export function registerManagedIframe(iframe: HTMLIFrameElement): () => void {
  managedIframes.add(iframe);
  return () => {
    managedIframes.delete(iframe);
  };
}

export function clearManagedIframes(): void {
  managedIframes.clear();
}

export function getManagedIframesCount(): number {
  return managedIframes.size;
}

function findManagedIframeByWindow(source: MessageEventSource | null): HTMLIFrameElement | null {
  if (!source) return null;
  // 1. O(1) 优先检查已注册活跃 iframe
  for (const iframe of managedIframes) {
    if (iframe.contentWindow === source) return iframe;
  }
  // 2. DOM 兜底查找（兼容动态插入或未显式注记的 iframe）
  if (typeof document !== 'undefined') {
    try {
      const managed = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe[data-lms-bridge]'));
      return managed.find((f) => f.contentWindow === source) || null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * 受管辖课件 iframe 判定：仅 `data-lms-bridge` 标记的 iframe（平台渲染课件/资源的宿主：
 * InteractiveCoursewareViewer / HtmlAppletFrame / SystemResourceLibraryModal）可与 LMS Bridge 通信。
 *
 * Why: 沙箱课件运行在不透明 origin（event.origin === 'null'）中，origin 白名单不可行；
 * 以「source → 受管辖 iframe」绑定为准，防止页面中其他 iframe（LTI 外链、插件 blob、
 * 未经平台注入 SDK 的第三方内容）伪造 LMS_SUBMIT 提交分数或窃取进度响应。
 */
function isFromManagedIframe(source: MessageEventSource | null): boolean {
  if (typeof document === 'undefined' || !source) return false;
  return findManagedIframeByWindow(source) !== null;
}

/**
 * JSON 序列化尺寸估算。
 *
 * Why: `v.length` 严重低估字符串在 `JSON.stringify` 中的真实成本 —— 换行、Tab、引号、
 * 反斜杠与其余控制字符都会额外膨胀 1-5 倍（换行输出 2 字符，NUL 输出 6 字符）。据此，
 * 约 400KB 的转义密集载荷序列化后超过 1MB，却仍能通过 512KB 闸门。
 *
 * 这里不做全量 `JSON.stringify`：改为一次无分配的字符扫描计算真实序列化长度
 * （孤立代理计 5 字符，合法代理对按 2 个码元计），复杂度 O(n) 且不产生大字符串。
 * 超出估算能力（过深嵌套 / 非普通对象 / 访问器抛错）时回退全量序列化，保证不漏判；
 * 循环引用无法序列化，沿用历史行为（不拦截）。
 */

/** 单个字符串序列化后的长度（含包裹引号） */
function estimateStringSize(s: string): number {
  const len = s.length;
  let size = len + 2;
  for (let i = 0; i < len; i++) {
    const code = s.charCodeAt(i);
    if (code === 0x22 || code === 0x5c) {
      // 双引号 / 反斜杠：序列化后变为 2 字符
      size += 1;
    } else if (code < 0x20) {
      // 退格 / Tab / 换行 / 换页 / 回车 输出 2 字符（+1），其余控制字符输出 6 字符（+5）
      size += code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d ? 1 : 5;
    } else if (code >= 0xd800 && code <= 0xdfff) {
      // 代理码元：合法代理对（Emoji）原样输出，其两个码元已计入 len
      const next = i + 1 < len ? s.charCodeAt(i + 1) : 0;
      if (code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
        i++;
      } else {
        size += 5; // 孤立代理会被转义为 6 字符
      }
    }
  }
  return size;
}

/** 估算终止标记：无法廉价估算，调用方需回退全量序列化 */
const SIZE_UNKNOWN = -1;
/** 估算终止标记：累计长度已确定超过 limit */
const SIZE_OVER = -2;

/** 估算深度上限：超过则回退全量序列化，避免在极端深层结构上做无意义遍历 */
const MAX_ESTIMATE_DEPTH = 4;

interface EstimateState {
  /** 遍历过程中累计的序列化长度，用于超限及早短路 */
  total: number;
  limit: number;
}

function isPlainObjectOrArray(value: object): boolean {
  if (Array.isArray(value)) return true;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false; // Date / Map / 类实例可能带 toJSON
  return typeof (value as { toJSON?: unknown }).toJSON !== 'function';
}

/**
 * 估算 `JSON.stringify(value)` 的长度并把「本层自有」的长度累加到 state.total。
 * 注意：子树的累加由子树自己完成，父层只累加逗号、键名等本层增量，否则会重复计数。
 * 返回 SIZE_UNKNOWN / SIZE_OVER 表示提前终止；否则返回本次子树的长度。
 */
function walkJsonSize(value: unknown, depth: number, state: EstimateState): number {
  if (value === null) return 4; // "null"
  const type = typeof value;
  if (type === 'boolean') return value === true ? 4 : 5;
  if (type === 'number') {
    const n = value as number;
    return Number.isFinite(n) ? String(n).length : 4; // 非有限数序列化为 "null"
  }
  if (type === 'string') return estimateStringSize(value as string);
  // function / undefined / symbol 被 JSON.stringify 丢弃
  if (typeof value !== 'object') return 0;
  if (depth >= MAX_ESTIMATE_DEPTH || !isPlainObjectOrArray(value)) return SIZE_UNKNOWN;

  let size = 2; // [ ] 或 { }
  let first = true;
  /** 累加本层自有增量；返回 true 表示累计已确定超过 limit */
  const addOwn = (delta: number): boolean => {
    size += delta;
    state.total += delta;
    return state.total > state.limit;
  };
  /** 子树结果并入本层（子树已自行累加过 state.total） */
  const takeSub = (sub: number): number | null => {
    size += sub;
    return state.total > state.limit ? SIZE_OVER : null;
  };

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (!first && addOwn(1)) return SIZE_OVER; // 元素间逗号
      first = false;

      const item = value[i];
      if (item === undefined || typeof item === 'function' || typeof item === 'symbol') {
        if (addOwn(4)) return SIZE_OVER; // 数组中的 undefined / 函数 / 符号序列化为 null
        continue;
      }
      const sub = walkJsonSize(item, depth + 1, state);
      if (sub < 0) return sub; // 传播 SIZE_UNKNOWN / SIZE_OVER 终止标记
      const over = takeSub(sub);
      if (over !== null) return over;
    }
    return size;
  }

  for (const key of Object.keys(value as Record<string, unknown>)) {
    let v: unknown;
    try {
      v = (value as Record<string, unknown>)[key];
    } catch {
      return SIZE_UNKNOWN; // 抛错的 getter
    }
    if (v === undefined || typeof v === 'function' || typeof v === 'symbol') continue; // 该键被丢弃

    if (!first && addOwn(1)) return SIZE_OVER; // 属性间逗号
    first = false;
    if (addOwn(estimateStringSize(key) + 1)) return SIZE_OVER; // "key":

    const sub = walkJsonSize(v, depth + 1, state);
    if (sub < 0) return sub; // 传播 SIZE_UNKNOWN / SIZE_OVER 终止标记
    const over = takeSub(sub);
    if (over !== null) return over;
  }
  return size;
}

/**
 * 跨窗口消息体的尺寸闸门：按真实序列化长度估算（而非 `v.length`），
 * 超过 limit（默认 512KB）返回 true。
 */
export function isPayloadOversized(data: unknown, limit = 512 * 1024): boolean {
  if (!data) return false;
  if (typeof data === 'number' || typeof data === 'boolean') return false;
  if (typeof data === 'string') return estimateStringSize(data) > limit;

  const state: EstimateState = { total: 0, limit };
  const estimated = walkJsonSize(data, 0, state);

  if (estimated === SIZE_OVER) return true;
  if (estimated === SIZE_UNKNOWN) {
    // 罕见路径：深层嵌套 / 非普通对象 —— 退回全量序列化以保证不漏判
    try {
      return JSON.stringify(data).length > limit;
    } catch {
      return false;
    }
  }
  return estimated > limit;
}

/**
 * Validates and processes incoming LMS messages from sandboxed courseware iframes.
 */
export async function processLmsMessage(event: MessageEvent): Promise<void> {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  // 协议特征快速预检：仅对 LMS 消息格式（包含 type 且以 LMS_ 开头，或是内置关键字段）继续解析
  // 避免 Vite HMR / 第三方插件高频跨窗口通信时无差别触发 JSON.stringify 带来 CPU 与 GC 抖动
  const type = typeof data.type === 'string' ? data.type : '';
  const isLmsCandidate =
    type.startsWith('LMS_') ||
    type === 'submit' ||
    type === 'finish' ||
    type === 'completed' ||
    type === 'saveProgress' ||
    typeof data.attempt_id === 'string';

  if (!isLmsCandidate) return;

  // 防御性安全：限制跨窗口消息体最大尺寸（512KB），防御超大 payload 阻塞主线程或造成 OOM
  // 优化：采用快速短路估算，避免每次全量序列化整颗对象树
  if (isPayloadOversized(data, 512 * 1024)) {
    console.warn('[LMS Bridge] Dropped oversized postMessage (>512KB)');
    return;
  }

  // Security: 仅接受受管辖课件 iframe（data-lms-bridge）或同窗口自身的消息，
  // 丢弃未知外部窗口 / 弹窗 / 未标记 iframe 的消息
  if (typeof window !== 'undefined' && event.source) {
    if (event.source !== window && !isFromManagedIframe(event.source)) {
      return;
    }
  }

  let attemptId = data.attempt_id;
  const payload = data.payload || data;

  // Try to extract attemptId from sending iframe if same-origin is accessible
  if (!attemptId && event.source) {
    try {
      const iframe = findManagedIframeByWindow(event.source);
      if (iframe && iframe.contentWindow) {
        const iframeWindow = iframe.contentWindow as any;
        if (iframeWindow.__LMS_STUDENT__?.attempt_id) {
          attemptId = iframeWindow.__LMS_STUDENT__.attempt_id;
        }
      }
    } catch {
      // Cross-origin or sandbox security error, ignore
    }
  }

  if (!attemptId || typeof attemptId !== 'string') return;

  // 归属认领：把 iframe 上报的（可能是 guest 共享的）attempt 认领到当前登录用户名下。
  // 见 adoptAttempt() 注释。失败时退回原始 attemptId，不阻断上报。
  attemptId = await adoptAttempt(attemptId);

  // ── 双向通信：课件上报配置/元数据 ──
  if (type === 'LMS_CONFIG') {
    emitCoursewareEvent('courseware.config_reported', attemptId, data.config ?? payload);
    return;
  }

  // ── 双向通信：课件请求恢复上次保存的进度 ──
  if (type === 'LMS_GET_PROGRESS') {
    const requestId = data.requestId as string | undefined;
    const source = event.source as Window | null;
    if (requestId && source && typeof source.postMessage === 'function') {
      // SEC-AUTH: 确保接收方必须为受管辖的合法课件 iframe（data-lms-bridge）
      if (source !== window && !isFromManagedIframe(source)) {
        console.warn('[LMS Bridge Security] Dropping response to untrusted window');
        return;
      }

      let progress: Record<string, unknown> | null;
      try {
        const res = await fetch(`/api/courseware/attempts/${encodeURIComponent(attemptId)}/progress`);
        const json = (await res.json()) as { progress?: Record<string, unknown> | null };
        progress = json.progress ?? null;
      } catch {
        progress = null;
      }
      // 对于具有具体 Origin 的课件定向回复，沙箱 opaque origin (null) 时定向到该受控 window
      const targetOrigin = event.origin && event.origin !== 'null' ? event.origin : '*';
      source.postMessage({ type: 'LMS_PROGRESS_RESPONSE', requestId, progress }, targetOrigin);
    }
    return;
  }

  // Identify if this is a submission, progress save, or general telemetry log
  const isSubmit =
    type === 'LMS_SUBMIT' ||
    type === 'LMS_FINISH' ||
    type === 'submit' ||
    type === 'finish' ||
    type === 'completed' ||
    (payload &&
      typeof payload === 'object' &&
      (payload.score !== undefined ||
        payload.grade !== undefined ||
        payload.result !== undefined ||
        payload.points !== undefined));

  const isSaveProgress = type === 'LMS_SAVE_PROGRESS' || type === 'saveProgress';

  if (isSubmit) {
    emitCoursewareEvent('courseware.submitted', attemptId, payload);
    try {
      const res = await fetch(`/api/courseware/attempts/${encodeURIComponent(attemptId)}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score: payload?.score ?? payload?.grade ?? payload?.result ?? payload?.points ?? undefined,
          comment: payload?.comment ?? payload?.feedback ?? payload?.note ?? undefined,
          completion: payload?.completion ?? 1.0,
          // 终态必须用 'completed'：后端 courseware.submit_attempt 处理器只在该取值下
          // 更新 courseware_attempt.finished_at / status；传 'submitted' 会永远停在“进行中”，
          // 导致「已提交/完成」筛选、HtmlAppletFrame 的 submittedAttempts 全部失效。
          status: 'completed',
          extra: payload,
        }),
      });
      if (!res.ok) {
        // 旧实现不看响应，403（归属不符）会被静默吞掉，学生端看起来“提交成功”实际已丢失。
        const detail = await res.text().catch(() => '');
        console.error(`[LMS Bridge] Backend rejected attempt submission: HTTP ${res.status}`, detail);
      }
    } catch (e) {
      console.error('[LMS Bridge] Failed to submit attempt data to backend:', e);
    }
  } else if (isSaveProgress) {
    emitCoursewareEvent('courseware.progress_saved', attemptId, payload);
    try {
      const res = await fetch(`/api/courseware/attempts/${encodeURIComponent(attemptId)}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score: payload?.score ?? payload?.grade ?? payload?.result ?? payload?.points ?? undefined,
          comment: payload?.comment ?? payload?.feedback ?? undefined,
          completion: payload?.completion ?? undefined,
          status: 'inprogress',
          extra: payload,
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        console.error(`[LMS Bridge] Backend rejected progress save: HTTP ${res.status}`, detail);
      }
    } catch (e) {
      console.error('[LMS Bridge] Failed to save progress to backend:', e);
    }
  } else {
    emitCoursewareEvent('courseware.event_logged', attemptId, payload);
    try {
      const res = await fetch(`/api/courseware/attempts/${encodeURIComponent(attemptId)}/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: type || 'log',
          payload: payload,
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        console.error(`[LMS Bridge] Backend rejected event log: HTTP ${res.status}`, detail);
      }
    } catch (e) {
      console.error('[LMS Bridge] Failed to log event to backend:', e);
    }
  }
}

/**
 * 发布课件事件到前端 EventBus（`courseware.` 前缀会经 Socket 转发到后端 EventBus，
 * 供 AI Agent 与插件订阅分析）。
 *
 * 同时写入 WhiteboardEventSlot，使白板内的 TeacherPanel / 调试面板能实时订阅。
 */
function emitCoursewareEvent(type: string, attemptId: string, payload: unknown): void {
  void frontendEventBus.publish({
    id: uuidv7(),
    type,
    source: 'courseware-bridge',
    payload: { attemptId, data: payload },
    timestamp: Date.now(),
    correlationId: attemptId,
  });
}

/**
 * 宿主 → 课件单向指令：向指定 iframe 下发 `LMS_HOST_COMMAND` 事件。
 * 课件侧通过 `window.LMS.on(event, callback)` 订阅。
 */
export function sendCommandToCourseware(
  iframe: HTMLIFrameElement,
  event: string,
  payload?: unknown,
  targetOrigin?: string,
): void {
  try {
    let origin = targetOrigin;
    if (!origin && iframe.src && typeof window !== 'undefined') {
      try {
        const url = new URL(iframe.src, window.location.href);
        if (url.origin && url.origin !== 'null' && !iframe.src.startsWith('blob:') && !iframe.src.startsWith('data:')) {
          origin = url.origin;
        }
      } catch {
        // ignore invalid URL
      }
    }
    iframe.contentWindow?.postMessage({ type: 'LMS_HOST_COMMAND', event, payload }, origin || '*');
  } catch {
    // 跨域/沙箱安全限制时静默失败
  }
}

/**
 * Hook to attach the LMS message listener when a user session is active.
 */
export function useLmsBridge(session: SessionType | null): void {
  useEffect(() => {
    if (!session) return;

    const handleLmsMessage = (event: MessageEvent) => {
      void processLmsMessage(event);
    };

    window.addEventListener('message', handleLmsMessage);
    return () => {
      window.removeEventListener('message', handleLmsMessage);
    };
  }, [session]);
}

/**
 * 获取当前所有受管辖或页面中挂载的课件 / 微前端 iframe
 */
function getAllTargetIframes(): Set<HTMLIFrameElement> {
  const targetIframes = new Set<HTMLIFrameElement>(managedIframes);
  if (typeof document !== 'undefined') {
    try {
      document.querySelectorAll('iframe').forEach((iframe) => targetIframes.add(iframe));
    } catch {
      // 忽略 DOM 查询异常
    }
  }
  return targetIframes;
}

/**
 * 向页面中所有已加载的课件 / 微前端 iframe 广播当前主题状态
 */
export function broadcastThemeToIframes(theme: string, tokens: Record<string, string> = {}): void {
  if (typeof document === 'undefined') return;
  try {
    const iframes = getAllTargetIframes();
    iframes.forEach((iframe) => {
      try {
        iframe.contentWindow?.postMessage(
          {
            type: 'LMS_HOST_COMMAND',
            event: 'theme:changed',
            payload: { theme, tokens },
          },
          '*',
        );
        iframe.contentWindow?.postMessage(
          {
            type: 'LMS_THEME_CHANGED',
            theme,
            tokens,
          },
          '*',
        );
      } catch {
        // 忽略可能存在的跨域限制报错
      }
    });
  } catch {
    // 忽略异常
  }
}

/**
 * 向页面中所有已加载的课件 / 微前端 iframe 广播当前界面字号缩放比例
 */
export function broadcastFontScaleToIframes(scale: number): void {
  if (typeof document === 'undefined') return;
  try {
    const clampedScale = Math.min(140, Math.max(85, Math.round(scale)));
    const iframes = getAllTargetIframes();
    iframes.forEach((iframe) => {
      try {
        iframe.contentWindow?.postMessage(
          {
            type: 'LMS_HOST_COMMAND',
            event: 'font-scale:changed',
            payload: { scale: clampedScale, fontScale: (clampedScale / 100).toFixed(2) },
          },
          '*',
        );
        iframe.contentWindow?.postMessage(
          {
            type: 'LMS_FONT_SCALE_CHANGED',
            scale: clampedScale,
            fontScale: (clampedScale / 100).toFixed(2),
          },
          '*',
        );
      } catch {
        // 忽略跨域错误
      }
    });
  } catch {
    // 忽略异常
  }
}

// ── 自动监听 EventBus 事件（支持 50ms 聚合防抖，解除 Store 侧对 lms-bridge 的直接依赖） ──
let themeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let fontScaleDebounceTimer: ReturnType<typeof setTimeout> | null = null;

if (typeof window !== 'undefined') {
  frontendEventBus.subscribe('theme.changed', (event) => {
    if (themeDebounceTimer) clearTimeout(themeDebounceTimer);
    themeDebounceTimer = setTimeout(() => {
      const payload = event.payload as { theme: string; tokens?: Record<string, string> };
      if (payload && typeof payload.theme === 'string') {
        broadcastThemeToIframes(payload.theme, payload.tokens ?? {});
      }
    }, 50);
  });

  frontendEventBus.subscribe('font-scale.changed', (event) => {
    if (fontScaleDebounceTimer) clearTimeout(fontScaleDebounceTimer);
    fontScaleDebounceTimer = setTimeout(() => {
      const payload = event.payload as { scale: number };
      if (payload && typeof payload.scale === 'number') {
        broadcastFontScaleToIframes(payload.scale);
      }
    }, 50);
  });
}
