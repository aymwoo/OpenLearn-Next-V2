import { useState, useRef, useEffect, useCallback } from 'react';
import type { AIProvider, PluginType, SessionType } from '../types/app';
import type { OrphanDataItem, PluginDataPolicy, PluginStoreTab } from '../components/plugin-center/types';

export const DEFAULT_PLUGIN_CODE = `exports.default = {
  manifest: {
    id: "@my-scope/hello-world",
    name: "Hello World Plugin",
    version: "1.0.0",
    capabilitiesProposed: ["lesson:read"]
  },
  activate: async (ctx) => {
    ctx.log.info('Hello World plugin activated');
  }
};`;

export interface UsePluginManagementOptions {
  session?: SessionType | null;
  host: any;
  lang: 'zh' | 'en';
  addToast: (title: string, msg: string, type: 'info' | 'success' | 'warning' | 'error') => void;
  setChatLog: (updater: (prev: any[]) => any[]) => void;
  setTeacherTab: (tab: string) => void;
  fetchLessons: () => Promise<void>;
}

export function usePluginManagement(options: UsePluginManagementOptions) {
  const { session, host, lang, addToast, setChatLog, setTeacherTab, fetchLessons } = options;

  const [plugins, setPlugins] = useState<PluginType[]>([]);
  const [aiProviders, setAiProviders] = useState<AIProvider[]>([]);
  const [isAIProviderModalOpen, setIsAIProviderModalOpen] = useState(false);
  const [editingAIProvider, setEditingAIProvider] = useState<AIProvider | null>(null);
  const [providerName, setProviderName] = useState('');
  const [providerApiUrl, setProviderApiUrl] = useState('');
  const [providerApiKey, setProviderApiKey] = useState('');
  const [providerModelName, setProviderModelName] = useState('');
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null);

  const [showPluginModal, setShowPluginModal] = useState(false);
  const [storeTab, setStoreTab] = useState<PluginStoreTab>('store');
  const [pluginCode, setPluginCode] = useState(DEFAULT_PLUGIN_CODE);
  const [installingPlugin, setInstallingPlugin] = useState(false);

  const [events, setEvents] = useState<any[]>([]);
  const [approvals, setApprovals] = useState<any[]>([]);
  const [scoreOverrides, setScoreOverrides] = useState<Record<string, number>>({});

  // ── 插件数据（孤立数据，Issue #141）────────────────────────────────────
  const [orphanData, setOrphanData] = useState<OrphanDataItem[]>([]);
  const [orphanDataLoading, setOrphanDataLoading] = useState(false);

  const fetchOrphanData = useCallback(async () => {
    setOrphanDataLoading(true);
    try {
      const res = await fetch('/api/plugins/orphan-data');
      if (res.ok) {
        const data = await res.json();
        setOrphanData(Array.isArray(data.items) ? data.items : []);
      }
    } catch (e) {
      console.warn('Failed to fetch plugin orphan data', e);
    } finally {
      setOrphanDataLoading(false);
    }
  }, []);

  const handleExportOrphanData = useCallback(
    async (item: OrphanDataItem) => {
      try {
        const res = await fetch(`/api/plugins/orphan-data/${encodeURIComponent(item.pluginId)}/export`, {
          method: 'POST',
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.success) {
          addToast(
            lang === 'zh' ? '导出完成' : 'Export finished',
            lang === 'zh'
              ? `已导出 ${data.tables?.length ?? 0} 张表 / ${data.rowCount ?? 0} 行到 ${data.file}`
              : `Exported ${data.tables?.length ?? 0} tables / ${data.rowCount ?? 0} rows to ${data.file}`,
            'success',
          );
          await fetchOrphanData();
        } else {
          addToast(lang === 'zh' ? '导出失败' : 'Export failed', data?.error || 'Unknown error', 'error');
        }
      } catch (e: any) {
        addToast(lang === 'zh' ? '导出失败' : 'Export failed', String(e?.message ?? e), 'error');
      }
    },
    [addToast, fetchOrphanData, lang],
  );

  const handlePurgeOrphanData = useCallback(
    async (item: OrphanDataItem) => {
      try {
        const res = await fetch(`/api/plugins/orphan-data/${encodeURIComponent(item.pluginId)}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirm: item.pluginId }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.success) {
          addToast(
            lang === 'zh' ? '已清除插件数据' : 'Plugin data purged',
            lang === 'zh'
              ? `删除 ${data.droppedTables?.length ?? 0} 张表；归档：${data.exportFile ?? '（无）'}`
              : `Dropped ${data.droppedTables?.length ?? 0} tables; archive: ${data.exportFile ?? '(none)'}`,
            'success',
          );
          await fetchOrphanData();
        } else {
          addToast(lang === 'zh' ? '清除失败' : 'Purge failed', data?.error || 'Unknown error', 'error');
        }
      } catch (e: any) {
        addToast(lang === 'zh' ? '清除失败' : 'Purge failed', String(e?.message ?? e), 'error');
      }
    },
    [addToast, fetchOrphanData, lang],
  );

  const handleDownloadOrphanArchive = useCallback(
    (item: OrphanDataItem) => {
      window.open(`/api/plugins/orphan-data/${encodeURIComponent(item.pluginId)}/archive`, '_blank');
    },
    [],
  );

  const togglingPluginsRef = useRef<Set<string>>(new Set());

  const fetchPlugins = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins');
      if (res.ok) {
        const data = await res.json();
        setPlugins(data);
      }
    } catch (e) {
      console.warn('Failed to fetch plugins', e);
    }
  }, []);

  const fetchAIProviders = useCallback(async () => {
    try {
      const res = await fetch('/api/ai-providers');
      if (res.ok) {
        const data = await res.json();
        setAiProviders(data);
      }
    } catch (e) {
      console.warn('Failed to fetch AI Providers', e);
    }
  }, []);

  useEffect(() => {
    fetchPlugins();
    if (session && session.role !== 'student') {
      fetchAIProviders();
    }
  }, [fetchPlugins, fetchAIProviders, session?.role]);

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch('/api/events');
      if (res.ok) {
        setEvents(await res.json());
      }
    } catch (e) {}
  }, []);

  const fetchApprovals = useCallback(async () => {
    try {
      const res = await fetch('/api/approvals');
      if (res.ok) {
        setApprovals(await res.json());
      }
    } catch (e) {}
  }, []);

  const handleSaveAIProvider = async () => {
    if (!providerName.trim() || !providerApiUrl.trim() || !providerModelName.trim()) {
      addToast(
        lang === 'zh' ? '表单不完整' : 'Incomplete Form',
        lang === 'zh' ? '请填写提供商名称、API 基础地址与模型标识。' : 'Please fill in Name, API URL, and Model Name.',
        'warning',
      );
      return;
    }

    try {
      let res;
      if (editingAIProvider) {
        res = await fetch(`/api/ai-providers/${editingAIProvider.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: providerName,
            api_url: providerApiUrl,
            api_key: providerApiKey,
            model_name: providerModelName,
          }),
        });
      } else {
        res = await fetch('/api/ai-providers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: providerName,
            api_url: providerApiUrl,
            api_key: providerApiKey,
            model_name: providerModelName,
          }),
        });
      }

      if (res.ok) {
        addToast(
          lang === 'zh' ? '保存成功' : 'Saved Successfully',
          lang === 'zh' ? `AI 提供商 [${providerName}] 已保存。` : `AI Provider [${providerName}] has been updated.`,
          'success',
        );
        setIsAIProviderModalOpen(false);
        setEditingAIProvider(null);
        setProviderName('');
        setProviderApiUrl('');
        setProviderApiKey('');
        setProviderModelName('');
        fetchAIProviders();
      } else {
        const data = await res.json().catch(() => ({}));
        addToast(
          lang === 'zh' ? '保存失败' : 'Failed to Save',
          data.error || (lang === 'zh' ? '无法写入数据库' : 'Failed to write to database'),
          'warning',
        );
      }
    } catch (err: any) {
      console.error(err);
      addToast(lang === 'zh' ? '保存异常' : 'Execution Error', err.message || 'Error occurred', 'warning');
    }
  };

  const handleDeleteAIProvider = async (id: string, name: string) => {
    if (
      !confirm(
        lang === 'zh'
          ? `确定要删除 AI 提供商 [${name}] 吗？此操作无法撤销。`
          : `Are you sure you want to delete AI Provider [${name}]?`,
      )
    ) {
      return;
    }

    try {
      const res = await fetch(`/api/ai-providers/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        addToast(
          lang === 'zh' ? '删除成功' : 'Deleted Successfully',
          lang === 'zh' ? `AI 提供商 [${name}] 已经被清除。` : `AI Provider [${name}] has been removed.`,
          'success',
        );
        fetchAIProviders();
      } else {
        addToast(lang === 'zh' ? '删除失败' : 'Failed to Delete', 'Database error', 'warning');
      }
    } catch (err: any) {
      console.error(err);
      addToast(lang === 'zh' ? '操作异常' : 'Execution Error', err.message || 'Error occurred', 'warning');
    }
  };

  const handleTestAIProvider = async (provider: any) => {
    setTestingProviderId(provider.id);
    try {
      const res = await fetch('/api/ai-providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_url: provider.api_url,
          api_key: provider.api_key,
          model_name: provider.model_name,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        addToast(
          lang === 'zh' ? '测试通过' : 'Test Succeeded',
          lang === 'zh'
            ? `成功连接至 [${provider.name}]。${data.message}`
            : `Successfully connected to [${provider.name}]. ${data.message}`,
          'success',
        );
      } else {
        addToast(lang === 'zh' ? '测试失败' : 'Test Failed', data.error || 'Connection error', 'warning');
      }
    } catch (err: any) {
      console.error(err);
      addToast(lang === 'zh' ? '连接异常' : 'Connection Exception', err.message || 'Error occurred', 'warning');
    } finally {
      setTestingProviderId(null);
    }
  };

  const handleInstallPlugin = async () => {
    if (!pluginCode.trim()) return;
    setInstallingPlugin(true);
    try {
      const res = await fetch('/api/plugins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceCode: pluginCode }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchPlugins();
        setShowPluginModal(false);
        setChatLog((prev) => [
          ...prev,
          {
            role: 'agent',
            content: `[System] Plugin "${data.manifest.name}" installed successfully. You can now prompt me to use it.`,
          },
        ]);
      } else {
        alert('Plugin installation failed: ' + data.error);
      }
    } catch (err: any) {
      alert('Error: ' + err.message);
    } finally {
      setInstallingPlugin(false);
    }
  };

  const handleZipPluginUpload = async (
    file: File,
    executionMode: 'worker' | 'inline' | 'process',
    opts?: {
      mode?: 'install' | 'update';
      targetPluginId?: string;
      allowDowngrade?: boolean;
      approvePublicRoutes?: boolean;
      approveCapabilities?: boolean;
    },
  ) => {
    setInstallingPlugin(true);
    const isUpdate = opts?.mode === 'update';
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/octet-stream',
        'X-Filename': encodeURIComponent(file.name),
        'X-Execution-Mode': executionMode,
        'X-Install-Mode': isUpdate ? 'update' : 'install',
        'X-Allow-Downgrade': opts?.allowDowngrade ? 'true' : 'false',
      };
      if (opts?.approvePublicRoutes) {
        headers['X-Approve-Public-Routes'] = 'true';
      }
      if (opts?.approveCapabilities) {
        headers['X-Approve-Capabilities'] = 'true';
      }
      if (isUpdate) {
        headers['X-Acknowledge-Risk'] = 'true';
      }
      if (opts?.targetPluginId) {
        headers['X-Target-Plugin-Id'] = encodeURIComponent(opts.targetPluginId);
      }

      const url =
        isUpdate && opts?.targetPluginId
          ? `/api/plugins/${encodeURIComponent(opts.targetPluginId)}/update-zip-raw`
          : '/api/plugins/upload-zip-raw';

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: file,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        const errMsg = data.error || 'Unknown error';
        addToast(
          lang === 'zh' ? (isUpdate ? '更新失败' : '安装失败') : isUpdate ? 'Update Failed' : 'Installation Failed',
          errMsg,
          'error',
        );
        throw new Error(errMsg);
      }

      const installedId = data.pluginId || data.manifest?.pluginId || data.manifest?.id;
      const updated = !!(data.updated || isUpdate);

      if (!updated && installedId) {
        await fetch(`/api/plugins/${encodeURIComponent(installedId)}/toggle`, { method: 'POST' }).catch(() => {});
      } else if (updated && data.wasActive && installedId) {
        try {
          await host.deactivatePlugin(installedId);
        } catch {
          /* ignore */
        }
      }

      setTeacherTab('plugins');
      setStoreTab('store');
      await fetchPlugins();
      setTimeout(() => {
        void fetchPlugins();
      }, 1000);

      const pluginName = data.manifest?.name || installedId || file.name;
      const effectiveMode = typeof data.executionMode === 'string' ? data.executionMode : executionMode;
      const modeLabel =
        effectiveMode === 'process'
          ? lang === 'zh'
            ? '子进程隔离'
            : 'process isolation'
          : effectiveMode === 'worker'
            ? lang === 'zh'
              ? 'Worker 线程'
              : 'worker thread'
            : effectiveMode === 'inline'
              ? lang === 'zh'
                ? '主进程'
                : 'in-process'
              : effectiveMode;
      const coercedNote =
        data.executionModeCoerced === true
          ? lang === 'zh'
            ? '（未受信任插件已强制改为子进程，清单里的 inline/worker 不会生效）'
            : ' (untrusted plugin was forced into a child process)'
          : '';
      if (updated) {
        const fromV = data.oldVersion || '?';
        const toV = data.newVersion || data.manifest?.version || '?';
        addToast(
          lang === 'zh' ? '插件更新成功' : 'Plugin Updated',
          lang === 'zh'
            ? `"${pluginName}" 已从 v${fromV} 更新到 v${toV}（配置与数据已保留）`
            : `"${pluginName}" updated v${fromV} → v${toV} (config & data preserved)`,
          'success',
        );
        setChatLog((prev) => [
          ...prev,
          { role: 'agent', content: `[System] Plugin "${pluginName}" updated ${fromV} → ${toV}.` },
        ]);
      } else {
        addToast(
          lang === 'zh' ? '插件安装成功' : 'Plugin Installed',
          lang === 'zh'
            ? `三方插件 "${pluginName}" 已上传，实际运行模式为 [${modeLabel}]${coercedNote}`
            : `Plugin "${pluginName}" installed in [${modeLabel}] mode${coercedNote}`,
          'success',
        );
        setChatLog((prev) => [
          ...prev,
          { role: 'agent', content: `[System] Plugin "${pluginName}" installed successfully from ZIP file.` },
        ]);
      }
    } catch (err: any) {
      const msg = err?.message ? String(err.message) : '';
      const alreadyToasted = msg && msg !== 'Failed to fetch' && msg !== 'Network error';
      if (!alreadyToasted) {
        addToast(lang === 'zh' ? '网络错误' : 'Network Error', msg || 'Network error', 'error');
      }
      throw err;
    } finally {
      setInstallingPlugin(false);
    }
  };

  const handleTogglePlugin = async (id: string) => {
    if (togglingPluginsRef.current.has(id)) return;
    togglingPluginsRef.current.add(id);
    try {
      const res = await fetch(`/api/plugins/${encodeURIComponent(id)}/toggle`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        await fetchPlugins();
      } else {
        const errMsg = data.error || 'Unknown error';
        if (errMsg.includes('requires human approval') || errMsg.includes('queued')) {
          alert(
            lang === 'zh'
              ? '该操作已加入"待审批高危操作"列表，请在右侧侧边栏中通过审批以生效。'
              : 'This action has been queued. Please approve it in the Pending Approvals list on the right side.',
          );
          await fetchApprovals();
        } else {
          alert((lang === 'zh' ? '切换插件状态失败: ' : 'Failed to toggle plugin: ') + errMsg);
        }
      }
    } catch (e) {
      console.error('Failed to toggle plugin:', e);
      alert(lang === 'zh' ? '网络错误，切换插件失败' : 'Network error, failed to toggle plugin');
    } finally {
      togglingPluginsRef.current.delete(id);
    }
  };

  /**
   * 卸载插件（Issue #141）。
   *
   * `dataPolicy` 默认 `keep`：服务端保留插件表 / 迁移版本 / 存储键，登记为孤立数据；
   * `purge` 为不可恢复操作（服务端仍会先导出 SQL 归档），调用方（卸载对话框）
   * 必须已完成二次确认，这里再带上 `confirm=purge` 让服务端复核。
   */
  const handleDeletePlugin = async (id: string, dataPolicy: PluginDataPolicy = 'keep') => {
    try {
      const url =
        dataPolicy === 'purge'
          ? `/api/plugins/${encodeURIComponent(id)}?dataPolicy=purge&confirm=purge`
          : `/api/plugins/${encodeURIComponent(id)}`;
      const res = await fetch(url, { method: 'DELETE' });
      if (res.ok) {
        const result = await res.json().catch(() => ({}));
        setTeacherTab('plugins');
        setStoreTab('store');
        await fetchPlugins();
        const summary =
          dataPolicy === 'purge'
            ? lang === 'zh'
              ? `插件已卸载，数据已清除（归档：${result.exportFile ?? '无数据需归档'}）。`
              : `Plugin uninstalled and data purged (archive: ${result.exportFile ?? 'nothing to archive'}).`
            : lang === 'zh'
              ? `插件已卸载，数据已保留（${result.keptTables?.length ?? 0} 张表），可在「插件数据」中管理。`
              : `Plugin uninstalled with data kept (${result.keptTables?.length ?? 0} tables). Manage it under Plugin Data.`;
        setChatLog((prev) => [...prev, { role: 'agent', content: `[System] ${summary}` }]);
        addToast(lang === 'zh' ? '卸载完成' : 'Uninstalled', summary, 'success');
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || (lang === 'zh' ? '删除插件失败' : 'Failed to delete plugin'));
      }
    } catch (e) {
      console.error('Failed to delete plugin:', e);
      alert(lang === 'zh' ? '删除插件失败' : 'Failed to delete plugin');
    }
  };

  const handleApprove = async (id: string, payloadOverride?: any) => {
    try {
      const res = await fetch(`/api/approvals/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payloadOverride }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchApprovals();
        await fetchLessons();
        await fetchPlugins();
      } else {
        alert('Action failed: ' + data.error);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleReject = async (id: string) => {
    try {
      await fetch(`/api/approvals/${id}/reject`, { method: 'POST' });
      await fetchApprovals();
      await fetchPlugins();
    } catch (e) {
      console.error(e);
    }
  };

  return {
    plugins,
    setPlugins,
    fetchPlugins,
    aiProviders,
    setAiProviders,
    fetchAIProviders,
    isAIProviderModalOpen,
    setIsAIProviderModalOpen,
    editingAIProvider,
    setEditingAIProvider,
    providerName,
    setProviderName,
    providerApiUrl,
    setProviderApiUrl,
    providerApiKey,
    setProviderApiKey,
    providerModelName,
    setProviderModelName,
    testingProviderId,
    setTestingProviderId,
    showPluginModal,
    setShowPluginModal,
    storeTab,
    setStoreTab,
    pluginCode,
    setPluginCode,
    installingPlugin,
    setInstallingPlugin,
    events,
    setEvents,
    fetchEvents,
    approvals,
    setApprovals,
    fetchApprovals,
    scoreOverrides,
    setScoreOverrides,
    handleSaveAIProvider,
    handleDeleteAIProvider,
    handleTestAIProvider,
    handleInstallPlugin,
    handleZipPluginUpload,
    handleTogglePlugin,
    handleDeletePlugin,
    orphanData,
    orphanDataLoading,
    fetchOrphanData,
    handleExportOrphanData,
    handlePurgeOrphanData,
    handleDownloadOrphanArchive,
    handleApprove,
    handleReject,
  };
}
