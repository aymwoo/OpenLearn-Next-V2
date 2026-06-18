export default {
  manifest: {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0'
  },
  activate: async function(ctx) {
    ctx.activated = true;
  }
};
