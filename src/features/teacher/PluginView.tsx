import React from 'react';
import { PluginCenter } from '../../components/PluginCenter';
import type { PluginType } from '../../store/appStore';

import type { Language } from '../../i18n';
import { useOptionalAppData } from '../../context/AppDataContext';

export interface PluginViewProps {
  plugins?: PluginType[];
  lang?: Language;
  storeTab?: 'store' | 'widgets' | 'dev' | 'logs' | 'community';
  setStoreTab?: (tab: 'store' | 'widgets' | 'dev' | 'logs' | 'community') => void;
  pluginCode?: string;
  setPluginCode?: (code: string) => void;
  installingPlugin?: boolean;
  onInstall?: (code?: string) => Promise<void> | void;
  onZipUpload?: (
    file: File,
    executionMode: 'worker' | 'inline' | 'process',
    opts?: { mode?: 'install' | 'update'; targetPluginId?: string; allowDowngrade?: boolean },
  ) => Promise<void>;
  onToggle?: (id: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}

export function PluginView(props: PluginViewProps = {}) {
  const appData = useOptionalAppData();
  const plugins = props.plugins ?? appData?.plugins ?? [];
  const lang = props.lang ?? (appData?.lang as Language) ?? 'zh';
  const storeTab = props.storeTab ?? (appData?.storeTab as any) ?? 'store';
  const setStoreTab = props.setStoreTab ?? appData?.setStoreTab ?? (() => {});
  const pluginCode = props.pluginCode ?? appData?.pluginCode ?? '';
  const setPluginCode = props.setPluginCode ?? appData?.setPluginCode ?? (() => {});
  const installingPlugin = props.installingPlugin ?? appData?.installingPlugin ?? false;
  const onInstall = props.onInstall ?? appData?.handleInstallPlugin ?? (() => {});
  const onZipUpload = props.onZipUpload ?? appData?.handleZipPluginUpload ?? (async () => {});
  const onToggle = props.onToggle ?? appData?.handleTogglePlugin ?? (async () => {});
  const onDelete = props.onDelete ?? appData?.handleDeletePlugin ?? (async () => {});

  return (
    <PluginCenter
      plugins={plugins}
      lang={lang}
      storeTab={storeTab}
      setStoreTab={(tab) => setStoreTab(tab as any)}
      pluginCode={pluginCode}
      setPluginCode={setPluginCode}
      installingPlugin={installingPlugin}
      onInstall={() => {
        void onInstall(pluginCode);
      }}
      onZipUpload={onZipUpload}
      onToggle={onToggle}
      onDelete={onDelete}
    />
  );
}
