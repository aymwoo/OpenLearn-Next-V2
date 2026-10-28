/**
 * 父页面与插件沙箱 iframe 的 postMessage 桥。
 * 只接受来自该 iframe contentWindow 的消息。函数和 React 渲染器过不了这道桥。
 */

export const PLUGIN_FRAME_CHANNEL = 'ol-plugin-frame';
export const PLUGIN_VIEW_CHANNEL = 'ol-plugin-view';
export const PLUGIN_SANDBOX_ATTR = 'allow-scripts';
export const PLUGIN_FRAME_PATH = '/plugin-sandbox/frame';

export interface PluginFrameMessage {
  channel?: string;
  type?: string;
  id?: string;
  callId?: string;
  op?: string;
  args?: unknown[];
  ok?: boolean;
  value?: unknown;
  error?: string;
  source?: string;
  pluginId?: string;
  manifest?: unknown;
}

export function isPluginFrameMessage(data: unknown): data is PluginFrameMessage {
  return !!data && typeof data === 'object' && (data as PluginFrameMessage).channel === PLUGIN_FRAME_CHANNEL;
}
