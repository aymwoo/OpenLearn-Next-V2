import React from 'react';
import { PluginCenter } from '../../components/PluginCenter';
import type { PluginType } from '../../store/appStore';

import type { Language } from '../../i18n';

interface PluginViewProps {
  plugins: PluginType[];
  lang: Language;
  storeTab: 'store' | 'widgets' | 'dev' | 'logs';
  setStoreTab: (tab: 'store' | 'widgets' | 'dev' | 'logs') => void;
  pluginCode: string;
  setPluginCode: (code: string) => void;
  installingPlugin: boolean;
  onInstall: (code?: string) => Promise<void> | void;
  onZipUpload: (
    file: File,
    executionMode: 'worker' | 'inline',
    opts?: { mode?: 'install' | 'update'; targetPluginId?: string; allowDowngrade?: boolean },
  ) => Promise<void>;
  onToggle: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function PluginView(props: PluginViewProps) {
  return (
    <PluginCenter
      plugins={props.plugins}
      lang={props.lang}
      storeTab={props.storeTab}
      setStoreTab={props.setStoreTab}
      pluginCode={props.pluginCode}
      setPluginCode={props.setPluginCode}
      installingPlugin={props.installingPlugin}
      onInstall={() => { void props.onInstall(props.pluginCode); }}
      onZipUpload={props.onZipUpload}
      onToggle={props.onToggle}
      onDelete={props.onDelete}
    />
  );
}
