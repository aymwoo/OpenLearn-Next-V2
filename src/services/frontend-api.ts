/**
 * FrontendAPIService — fetch wrapper with same-origin session cookie support.
 *
 * Wraps the native fetch() API to provide a typed HTTP client that:
 * - Sends credentials via `credentials: 'same-origin'` (browser automatically
 *   includes session cookies for same-origin requests)
 * - Parses JSON responses into { success, result, error } shape
 * - Returns structured error response on network failures
 *
 * Session cookie handling: The browser automatically sends cookies for
 * same-origin requests — no manual cookie management needed.
 */

import type { FrontendApiResponse, IFrontendAPI } from '../plugin-host/types';

export class FrontendAPIService implements IFrontendAPI {
  private baseUrl: string;

  constructor(baseUrl: string = '') {
    this.baseUrl = baseUrl;
  }

  async get<T = any>(path: string): Promise<FrontendApiResponse<T>> {
    return this.request<T>('GET', path);
  }

  async post<T = any>(path: string, body?: any): Promise<FrontendApiResponse<T>> {
    return this.request<T>('POST', path, body);
  }

  async del<T = any>(path: string): Promise<FrontendApiResponse<T>> {
    return this.request<T>('DELETE', path);
  }

  private async request<T>(method: string, path: string, body?: any): Promise<FrontendApiResponse<T>> {
    try {
      const url = `${this.baseUrl}${path}`;
      const options: RequestInit = {
        method,
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
        },
      };

      if (body !== undefined && method !== 'GET' && method !== 'DELETE') {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(url, options);
      const data = (await response.json()) as FrontendApiResponse<T>;
      // HTTP 状态码不随 JSON body 返回；不透传的话插件只能看到 body 里的
      // success/error，无法区分「参数错（400）」「权限不足（403）」「服务端故障（500）」。
      if (typeof response.status === 'number') {
        return { ...data, status: response.status };
      }
      return data;
    } catch (err: any) {
      return {
        success: false,
        error: err.message ?? 'Network error',
      };
    }
  }
}

export const frontendApi = new FrontendAPIService();
