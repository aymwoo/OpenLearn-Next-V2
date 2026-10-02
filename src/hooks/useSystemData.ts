/**
 * useSystemData — 系统级数据（注册命令 / VFS / 进程与日志）的自定义 hook（C1-R2b）。
 *
 * 原 App.tsx 内联 state 与 fetch 函数原样迁入；轮询节奏仍由 useAppPolling 驱动
 * （本 hook 只提供动作函数）。
 */
import { useState } from 'react';
import type { VFSNode, ProcessType } from '../types/app';
import {
  fetchRegisteredCommands as fetchRegisteredCommandsApi,
  fetchVfsNodes as fetchVfsNodesApi,
  fetchProcesses as fetchProcessesApi,
  fetchProcessLogs as fetchProcessLogsApi,
} from '../services/systemService.js';

export function useSystemData(session: unknown) {
  const [registeredCommands, setRegisteredCommands] = useState<any[]>([]);
  const [vfsNodes, setVfsNodes] = useState<VFSNode[]>([]);
  const [processes, setProcesses] = useState<ProcessType[]>([]);
  const [showProcessLogs, setShowProcessLogs] = useState<string | null>(null);
  const [processLogsContent, setProcessLogsContent] = useState('');
  const [showLogs, setShowLogs] = useState(false);
  const [currentVfsParent, setCurrentVfsParent] = useState<string | null>(null);

  const fetchRegisteredCommands = async () => {
    try {
      const { ok, data, contentType } = await fetchRegisteredCommandsApi();
      if (ok && contentType && contentType.includes('application/json')) {
        if (Array.isArray(data)) {
          setRegisteredCommands(data);
        }
      }
    } catch (e) {
      console.warn('Failed to fetch registered commands', e);
    }
  };

  const fetchVfs = async (parentId: string | null) => {
    if (!session) return;
    try {
      const { ok, data } = await fetchVfsNodesApi(parentId);
      if (ok) {
        setVfsNodes(data);
      }
    } catch (e) {
      console.warn('Failed to fetch VFS nodes', e);
    }
  };

  const fetchProcesses = async () => {
    try {
      const { ok, data } = await fetchProcessesApi();
      if (ok) {
        setProcesses(data);
      }
    } catch (e) {}
  };

  const fetchProcessLogs = async (id: string) => {
    try {
      const { ok, data } = await fetchProcessLogsApi(id);
      if (ok) {
        setProcessLogsContent(data.logs || '');
        setShowProcessLogs(id);
      }
    } catch (e) {}
  };

  return {
    registeredCommands,
    setRegisteredCommands,
    vfsNodes,
    setVfsNodes,
    processes,
    setProcesses,
    showProcessLogs,
    setShowProcessLogs,
    processLogsContent,
    setProcessLogsContent,
    showLogs,
    setShowLogs,
    currentVfsParent,
    setCurrentVfsParent,
    fetchRegisteredCommands,
    fetchVfs,
    fetchProcesses,
    fetchProcessLogs,
  };
}
