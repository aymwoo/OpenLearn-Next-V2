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

import type { IFrontendAPI } from '../plugin-host/types';

export class FrontendAPIService implements IFrontendAPI {
  private baseUrl: string;

  constructor(baseUrl: string = '') {
    this.baseUrl = baseUrl;
  }

  async get<T = any>(path: string): Promise<{ success: boolean; result?: T; error?: string }> {
    return this.request<T>('GET', path);
  }

  async post<T = any>(path: string, body?: any): Promise<{ success: boolean; result?: T; error?: string }> {
    return this.request<T>('POST', path, body);
  }

  async del<T = any>(path: string): Promise<{ success: boolean; result?: T; error?: string }> {
    return this.request<T>('DELETE', path);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: any,
  ): Promise<{ success: boolean; result?: T; error?: string }> {
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
      const data = await response.json();
      return data as { success: boolean; result?: T; error?: string };
    } catch (err: any) {
      return {
        success: false,
        error: err.message ?? 'Network error',
      };
    }
  }
}
