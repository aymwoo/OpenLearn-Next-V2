/**
 * 插件前端的不透明源 iframe。
 *
 * sandbox 只有 allow-scripts，没有 allow-same-origin，因此文档源是 opaque origin。
 * 它不能带上宿主 cookie，也不能读父页面 DOM。插件源码由父页面经 postMessage 送入，
 * 再在 iframe 里用 blob URL import。本页 CSP 禁止 connect，iframe 自己不能发请求。
 */

export const PLUGIN_FRAME_CHANNEL = 'ol-plugin-frame';

export const PLUGIN_SANDBOX_FRAME_HTML = `<!doctype html>
<html><head><meta charset="utf-8"></head><body>
<script>
const CHANNEL = ${JSON.stringify('ol-plugin-frame')};
let targetOrigin = '*';
const pending = new Map();
let activePlugin = null;
function post(msg) { parent.postMessage(Object.assign({ channel: CHANNEL }, msg), targetOrigin); }
function call(op, args) {
  const callId = Math.random().toString(16).slice(2);
  return new Promise(function (resolve, reject) {
    pending.set(callId, { resolve: resolve, reject: reject });
    post({ type: 'call', callId: callId, op: op, args: args });
  });
}
function makeCtx(pluginId, manifest) {
  return {
    pluginId: pluginId,
    manifest: manifest,
    services: {
      frontendApi: {
        get: function (path) { return call('api.get', [path]); },
        post: function (path, body) { return call('api.post', [path, body]); },
        del: function (path) { return call('api.del', [path]); }
      },
      storageService: {
        get: function (key) { return call('storage.get', [key]); },
        set: function (key, value) { return call('storage.set', [key, value]); },
        delete: function (key) { return call('storage.delete', [key]); }
      }
    },
    ui: {
      registerExtensionPoint: function (slot, config) { return call('ui.register', [slot, config]); },
      showToast: function (message) { return call('ui.toast', [message]); }
    },
    invokeCommand: function (type, payload) { return call('command.invoke', [type, payload]); },
    context: { get: function () { return call('context.get', []); } }
  };
}
window.addEventListener('message', async function (event) {
  const data = event.data;
  if (!data || data.channel !== CHANNEL || event.source !== parent) return;
  if (data.type === 'reply') {
    const waiter = pending.get(data.callId);
    if (!waiter) return;
    pending.delete(data.callId);
    if (data.ok) waiter.resolve(data.value);
    else waiter.reject(new Error(data.error || 'bridge call failed'));
    return;
  }
  if (data.type === 'deactivate') {
    try {
      if (activePlugin && typeof activePlugin.deactivate === 'function') {
        await activePlugin.deactivate();
      }
    } catch (_) {}
    activePlugin = null;
    pending.clear();
    post({ type: 'deactivated', id: data.id });
    return;
  }
  if (data.type !== 'load') return;
  targetOrigin = event.origin && event.origin !== 'null' ? event.origin : '*';
  try {
    const blob = new Blob([data.source], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    let mod;
    try { mod = await import(url); } finally { URL.revokeObjectURL(url); }
    const plugin = mod.default || mod;
    if (typeof plugin.activate !== 'function') throw new Error('missing activate function');
    activePlugin = plugin;
    await Promise.race([
      plugin.activate(makeCtx(data.pluginId, data.manifest)),
      new Promise(function (_, reject) { setTimeout(function () { reject(new Error('Activation timeout (5000ms)')); }, 5000); })
    ]);
    post({ type: 'activated', id: data.id });
  } catch (error) {
    post({ type: 'activate-error', id: data.id, error: error && error.message ? error.message : String(error) });
  }
});
post({ type: 'ready' });
</script>
</body></html>`;
