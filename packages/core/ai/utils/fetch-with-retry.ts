/**
 * AI Provider 出站请求可靠性封装（Phase B5）。
 *
 * - 超时：AbortController 30 秒，提供商挂起时快速失败而非永久阻塞；
 * - 重试：429 / 5xx / 网络错误按指数退避（500ms × 2ⁿ + 抖动）最多 3 次尝试；
 *   4xx 其他状态（401/403/400 等确定失败）不重试。
 *
 * 注意：仅适用于一次性 JSON 响应请求，不适用于流式响应。
 * 本文件位于 packages/core 内 —— 不得反向依赖 server/。
 */

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 500;

export interface FetchWithRetryOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** 超时毫秒数（默认 30000） */
  timeoutMs?: number;
  /** 总尝试次数（默认 3；1 表示不重试） */
  maxAttempts?: number;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 单次尝试的三种结局 */
type AttemptOutcome =
  | { kind: 'success'; response: Response }
  | { kind: 'fatal'; error: Error } // 不重试（确定失败：4xx 非 429 / 响应不可解析等）
  | { kind: 'retryable'; error: Error }; // 网络错误 / 429 / 5xx / 超时

async function attemptOnce(
  url: string,
  options: FetchWithRetryOptions,
  timeoutMs: number,
): Promise<AttemptOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: options.method ?? 'POST',
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
    });

    if (response.ok) return { kind: 'success', response };

    const errorText = await response.text();
    const error = new Error(
      `AI Provider Request Failed (${response.status}): ${errorText || response.statusText}`,
    );
    return isRetryableStatus(response.status) ? { kind: 'retryable', error } : { kind: 'fatal', error };
  } catch (err: any) {
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
