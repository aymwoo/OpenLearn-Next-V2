/**
 * 金丝雀探针插件 —— 第 1 步最小实现（安装闭环验证，对应 canary README §7 步骤 1）。
 *
 * R2 证明点：运行时从 '@openlearn/plugin-sdk' 导入 Token 常量（esbuild external 保留
 * 裸 specifier），激活时依赖宿主 ensureHostSdkResolution() 建立的符号链接解析成功。
 * 若符号链接缺失，activatePlugin 会抛 ERR_MODULE_NOT_FOUND —— 本测试即失败。
 */
import { IDatabaseToken } from '@openlearn/plugin-sdk';
import type { PluginContext } from '@openlearn/plugin-sdk';

export default {
  manifest: {
    id: 'ext-canary',
    name: '金丝雀探针插件',
    version: '1.0.0',
    main: 'index.js',
  },

  activate: async (ctx: PluginContext) => {
    // R2 核心证明：external 导入的 IDatabaseToken 真实解析且与宿主共享同一实例
    const db = await ctx.resolve(IDatabaseToken);

    // 模式探测：worker 的 IDatabaseToken 是异步 RPC 代理（prepare().get() 返回
    // Promise），inline 同步返回行对象。注意不能用 ctx.db 探测——那是命名空间
    // PluginDatabaseAPI（无 exec），不是原始数据库句柄。
    let mode: 'inline' | 'worker' = 'inline';
    let probe = db.prepare('SELECT 1 AS one').get() as { one: number } | undefined;
    if (probe instanceof Promise) {
      mode = 'worker';
      probe = (await probe) as { one: number } | undefined;
    }

    ctx.http.get('/status', async () => ({
      ok: true,
      mode,
      pluginId: ctx.pluginId,
      dbProbe: probe?.one === 1 ? 'ok' : 'unexpected',
    }));
  },
};
