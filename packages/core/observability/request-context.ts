import { AsyncLocalStorage } from 'node:async_hooks';

/** 当前 HTTP 请求的关联 ID。命令处理器可从这里取，而不必改命令载荷。 */
export interface RequestLogContext {
  requestId: string;
}

export const requestLogContext = new AsyncLocalStorage<RequestLogContext>();
