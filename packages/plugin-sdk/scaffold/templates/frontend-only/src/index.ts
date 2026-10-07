/**
 * {{pluginName}} — Frontend-only plugin manifest.
 * No server-side handlers; pure UI extension.
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
    classroomTools: [
      {
        id: '{{pluginId}}-tool',
        name: '{{pluginName}}',
        icon: 'Palette',
        commandType: '{{pluginId}}.open',
        payload: {},
      },
    ],
    engines: { openlearn: '>=0.2.5' },
  },

  async activate(ctx: any) {
    ctx.log?.info?.('{{pluginName}} activated (frontend-only)');
  },

  async deactivate() {
    console.log('{{pluginName}} deactivated');
  },
};
