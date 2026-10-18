/**
 * student-data-privacy.ts — 插件系统学生个人数据隐私与 GDPR 调度（Issue #145）。
 *
 * 负责遍历当前活跃的插件实例（包含 Inline 模式和 Worker 模式），
 * 分发学生个人数据导出 (onStudentExport) 与级联删除 (onStudentDelete) 请求。
 *
 * @module
 */

import crypto from 'node:crypto';
import type { PluginInstance } from './base.js';

export interface PluginStudentExportResult {
  status: 'ok' | 'not_implemented' | 'error';
  data?: unknown;
  error?: string;
}

export interface PluginStudentDeleteResult {
  success: boolean;
  error?: string;
}

/**
 * 遍历活跃插件并调度个人数据导出钩子。
 *
 * @param pluginInstances 当前宿主所有活跃插件实例映射
 * @param studentId 学生 ID
 * @param timeoutMs 单个插件超时毫秒数（默认 10 秒）
 */
export async function dispatchStudentExport(
  pluginInstances: Map<string, PluginInstance>,
  studentId: string,
  timeoutMs = 10_000,
): Promise<Record<string, PluginStudentExportResult>> {
  const results: Record<string, PluginStudentExportResult> = {};

  for (const [pluginId, instance] of pluginInstances.entries()) {
    const manifestId = instance.manifest?.id || pluginId;

    // 1. Worker 隔离插件
    if (instance.workerRef?.transport) {
      try {
        const transport = instance.workerRef.transport;
        const invokeId = crypto.randomUUID();
        const responsePromise = new Promise<PluginStudentExportResult>((resolve) => {
          const timer = setTimeout(() => {
            cleanup();
            resolve({ status: 'error', error: `Worker plugin student export timeout (${timeoutMs / 1000}s)` });
          }, timeoutMs);

          const onMessage = (msg: unknown) => {
            const typed = msg as {
              type?: string;
              invokeId?: string;
              status?: 'ok' | 'not_implemented' | 'error';
              data?: unknown;
              error?: string;
            };
            if (typed && typed.type === 'student-export-response' && typed.invokeId === invokeId) {
              cleanup();
              resolve({
                status: typed.status || 'ok',
                data: typed.data,
                error: typed.error,
              });
            }
          };

          const cleanup = () => {
            clearTimeout(timer);
            if (typeof (transport as any).removeListener === 'function') {
              (transport as any).removeListener('message', onMessage);
            } else if (typeof (transport as any).off === 'function') {
              (transport as any).off('message', onMessage);
            }
          };

          if (typeof (transport as any).on === 'function') {
            (transport as any).on('message', onMessage);
          } else if (typeof (transport as any).addEventListener === 'function') {
            (transport as any).addEventListener('message', (ev: any) => onMessage(ev.data));
          }

          transport.postMessage({
            type: 'student-export-request',
            invokeId,
            studentId,
          });
        });

        results[manifestId] = await responsePromise;
      } catch (err: any) {
        results[manifestId] = { status: 'error', error: err?.message || String(err) };
      }
      continue;
    }

    // 2. Inline 插件
    if (typeof instance.onStudentExport === 'function') {
      try {
        const exportPromise = Promise.resolve(instance.onStudentExport(studentId));
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Plugin student export timeout (${timeoutMs / 1000}s)`)), timeoutMs),
        );
        const data = await Promise.race([exportPromise, timeoutPromise]);
        results[manifestId] = { status: 'ok', data };
      } catch (err: any) {
        results[manifestId] = { status: 'error', error: err?.message || String(err) };
      }
    } else {
      results[manifestId] = { status: 'not_implemented' };
    }
  }

  return results;
}

/**
 * 遍历活跃插件并调度个人数据级联删除钩子。
 *
 * @param pluginInstances 当前宿主所有活跃插件实例映射
 * @param studentId 学生 ID
 * @param timeoutMs 单个插件超时毫秒数（默认 10 秒）
 */
export async function dispatchStudentDelete(
  pluginInstances: Map<string, PluginInstance>,
  studentId: string,
  timeoutMs = 10_000,
): Promise<Record<string, PluginStudentDeleteResult>> {
  const results: Record<string, PluginStudentDeleteResult> = {};

  for (const [pluginId, instance] of pluginInstances.entries()) {
    const manifestId = instance.manifest?.id || pluginId;

    // 1. Worker 隔离插件
    if (instance.workerRef?.transport) {
      try {
        const transport = instance.workerRef.transport;
        const invokeId = crypto.randomUUID();
        const responsePromise = new Promise<PluginStudentDeleteResult>((resolve) => {
          const timer = setTimeout(() => {
            cleanup();
            resolve({ success: false, error: `Worker plugin student delete timeout (${timeoutMs / 1000}s)` });
          }, timeoutMs);

          const onMessage = (msg: unknown) => {
            const typed = msg as { type?: string; invokeId?: string; success?: boolean; error?: string };
            if (typed && typed.type === 'student-delete-response' && typed.invokeId === invokeId) {
              cleanup();
              resolve({
                success: typed.success !== false,
                error: typed.error,
              });
            }
          };

          const cleanup = () => {
            clearTimeout(timer);
            if (typeof (transport as any).removeListener === 'function') {
              (transport as any).removeListener('message', onMessage);
            } else if (typeof (transport as any).off === 'function') {
              (transport as any).off('message', onMessage);
            }
          };

          if (typeof (transport as any).on === 'function') {
            (transport as any).on('message', onMessage);
          } else if (typeof (transport as any).addEventListener === 'function') {
            (transport as any).addEventListener('message', (ev: any) => onMessage(ev.data));
          }

          transport.postMessage({
            type: 'student-delete-request',
            invokeId,
            studentId,
          });
        });

        results[manifestId] = await responsePromise;
      } catch (err: any) {
        results[manifestId] = { success: false, error: err?.message || String(err) };
      }
      continue;
    }

    // 2. Inline 插件
    if (typeof instance.onStudentDelete === 'function') {
      try {
        const deletePromise = Promise.resolve(instance.onStudentDelete(studentId));
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Plugin student delete timeout (${timeoutMs / 1000}s)`)), timeoutMs),
        );
        await Promise.race([deletePromise, timeoutPromise]);
        results[manifestId] = { success: true };
      } catch (err: any) {
        results[manifestId] = { success: false, error: err?.message || String(err) };
      }
    } else {
      // 未实现专有删除钩子的插件视为无额外专属状态需要抹除
      results[manifestId] = { success: true };
    }
  }

  return results;
}
