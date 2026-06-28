import React from 'react';
import { PluginCenter } from '../../components/PluginCenter';
import type { PluginType } from '../../store/appStore';

interface PluginViewProps {
  plugins: PluginType[];
  lang: string;
  storeTab: string;
  setStoreTab: (tab: string) => void;
  pluginCode: string;
  setPluginCode: (code: string) => void;
  installingPlugin: boolean;
  onInstall: (code: string) => Promise<void>;
  onZipUpload: (base64: string) => Promise<void>;
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
      onInstall={props.onInstall}
      onZipUpload={props.onZipUpload}
      onToggle={props.onToggle}
      onDelete={props.onDelete}
    />
  );
}
