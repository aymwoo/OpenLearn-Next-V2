/**
 * AI Provider 出站请求可靠性封装（Phase B5）。
 *
 * - 超时：AbortController 30 秒，提供商挂起时快速失败而非永久阻塞；
 * - 重试：429 / 5xx / 网络错误按指数退避（500ms × 2ⁿ + 抖动）最多 3 次尝试；
 *   4xx 其他状态（401/403/400 等确定失败）不重试。
 * - 重定向：redirect:'manual'，每一跳用 assessAiProviderHop 复检。
 *   公网 http(s) 可以跟随；跨主机的回环、私网、链路本地不跟随，也不发送 Bearer。
 *   失败信息只保留状态码，不回传响应体。
 *
 * 注意：仅适用于一次性 JSON 响应请求，不适用于流式响应。
 * 本文件位于 packages/core 内 —— 不得反向依赖 server/。
 */

import { assessAiProviderHop, type AiHopCheck } from './redirect-guard.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 500;
/** 与出站安全封装一致：最多跟随 5 次重定向。 */
const MAX_REDIRECTS = 5;

export interface FetchWithRetryOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** 超时毫秒数（默认 30000） */
  timeoutMs?: number;
  /** 总尝试次数（默认 3；1 表示不重试） */
  maxAttempts?: number;
  /**
   * 每一跳（含首跳）的目标复检。缺省为 assessAiProviderHop。
   * 生产调用方不应放宽；测试用它证明「检查器拒绝时不跟随」。
   */
  hopCheck?: AiHopCheck;
}

export class AIFetchTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`AI provider request timed out after ${timeoutMs}ms`);
    this.name = 'AIFetchTimeoutError';
  }
}

/** 是否值得重试：网络错误 / 429 / 5xx */
function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readLocation(response: Response): string | null {
  const get = response.headers?.get;
  if (typeof get !== 'function') return null;
  const value = get.call(response.headers, 'location');
  if (!value || !value.trim()) return null;
  return value.trim();
}

/** 错误与被拒绝的跳转不读取正文，避免把上游内容带进 Error。 */
function releaseBody(response: Response): void {
  const cancel = response.body?.cancel;
  if (typeof cancel !== 'function') return;
  try {
    const pending = cancel.call(response.body) as Promise<void> | undefined;
    if (pending && typeof pending.catch === 'function') void pending.catch(() => undefined);
  } catch {
    // 丢弃失败不影响这次请求的结果。
  }
}

/** 单次尝试的三种结局 */
type AttemptOutcome =
  | { kind: 'success'; response: Response }
  | { kind: 'fatal'; error: Error } // 不重试（确定失败：4xx 非 429 / 不安全重定向）
  | { kind: 'retryable'; error: Error }; // 网络错误 / 429 / 5xx / 超时

async function attemptOnce(url: string, options: FetchWithRetryOptions, timeoutMs: number): Promise<AttemptOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const check = options.hopCheck ?? assessAiProviderHop;
  try {
    let current = url;
    let previous: string | undefined;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const decision = check(current, previous);
      if (!decision.allowed) {
        const prefix = previous ? 'AI provider redirect blocked' : 'AI provider request blocked';
        return {
          kind: 'fatal',
          error: new Error(`${prefix}: ${decision.reason ?? 'unsafe target'}`),
        };
      }

      const response = await fetch(current, {
        method: options.method ?? 'POST',
        headers: options.headers,
        body: options.body,
        signal: controller.signal,
        redirect: 'manual',
      });

      const location = readLocation(response);
      if (isRedirectStatus(response.status) && location) {
        releaseBody(response);
        if (hop === MAX_REDIRECTS) {
          return { kind: 'fatal', error: new Error('AI provider redirect blocked: too many redirects') };
        }
        let next: string;
        try {
          next = new URL(location, current).href;
        } catch {
          return { kind: 'fatal', error: new Error('AI provider redirect blocked: invalid redirect target') };
        }
        previous = current;
        current = next;
        continue;
      }

      if (response.ok) return { kind: 'success', response };

      releaseBody(response);
      const error = new Error(`AI Provider Request Failed (${response.status})`);
      return isRetryableStatus(response.status) ? { kind: 'retryable', error } : { kind: 'fatal', error };
    }

    return { kind: 'fatal', error: new Error('AI provider redirect blocked: too many redirects') };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { kind: 'retryable', error: new AIFetchTimeoutError(timeoutMs) };
    }
    return { kind: 'retryable', error: err instanceof Error ? err : new Error(String(err)) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 带超时与指数退避重试的 fetch。返回首次成功的 Response；
 * 全部尝试失败时抛出最后一次的错误。
 */
export async function fetchWithRetry(url: string, options: FetchWithRetryOptions = {}): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);

  let lastError: Error = new Error('AI provider request failed');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const outcome = await attemptOnce(url, options, timeoutMs);
    if (outcome.kind === 'success') return outcome.response;
    lastError = outcome.error;
    if (outcome.kind === 'fatal') throw outcome.error;
    if (attempt < maxAttempts) {
      const jitter = Math.floor(Math.random() * 250);
      await sleep(BASE_DELAY_MS * 2 ** (attempt - 1) + jitter);
    }
  }

  throw lastError;
}
