/**
 * {{pluginName}} — 前端型插件 manifest。
 *
 * 纯前端模板不注册任何服务端命令处理器，因此 manifest 里**不声明**
 * classroomTools / contributes 中的命令型贡献 —— 声明了没有 handler 接，
 * 用户点按钮只会得到 "No handler registered" 错误。
 *
 * 需要可见入口时请改用 `--template full-stack`：课堂工具、命令面板条目等
 * 声明式贡献都必须配一个服务端命令处理器。
 */

export default {
  manifest: {
    id: '{{pluginId}}',
    name: '{{pluginName}}',
    version: '0.1.0',
    // 入口文件：esbuild 把插件打成单文件 bundle，安装后即位于插件目录下的 index.js。
    // manifestSchema 的 main 为必填（z.string().min(1)）—— 缺失会让插件**装不上**。
    main: 'index.js',
    description: '{{description}}',
    author: '{{author}}',
    requires: [],
    capabilitiesProposed: [],
    engines: { openlearn: '>=0.2.5' },
  },

  async activate(ctx: any) {
    ctx.log?.info?.('{{pluginName}} activated (frontend-only)');
  },

  async deactivate() {
    console.log('{{pluginName}} deactivated');
  },
};
