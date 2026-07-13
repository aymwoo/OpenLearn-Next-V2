/**
 * {{pluginName}} — Frontend-only plugin manifest.
 * No server-side handlers; pure UI extension.
 */

export default {
  manifest: {
    id: '{{pluginId}}',
    name: '{{pluginName}}',
    version: '0.1.0',
    description: '{{description}}',
    author: '{{author}}',
    requires: [],
    capabilitiesProposed: [],
    classroomTools: [{
      id: '{{pluginId}}-tool',
      name: '{{pluginName}}',
      icon: 'Palette',
      commandType: '{{pluginId}}.open',
      payload: {},
    }],
    engines: { openlearn: '>=5.0.0' },
  },

  async activate(ctx: any) {
    ctx.log?.info?.('{{pluginName}} activated (frontend-only)');
  },

  async deactivate() {
    console.log('{{pluginName}} deactivated');
  },
};
