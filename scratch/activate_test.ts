import { Kernel } from '../packages/core/kernel/index.js';

async function main() {
  console.log('Initializing Kernel...');
  const kernel = new Kernel();
  await kernel.ready;
  console.log('Kernel ready.');

  const pluginId = '019f5ac3-fc32-74a5-addf-01689c9dde18'; // ext-homework-hub UUID
  
  console.log(`Activating plugin ${pluginId}...`);
  try {
    // Let's print the state before activation
    const beforeState = kernel.pluginHost.getPluginState(pluginId);
    console.log('State before activation:', beforeState);

    await kernel.pluginHost.activatePlugin(pluginId);
    
    const afterState = kernel.pluginHost.getPluginState(pluginId);
    console.log('Activation successful! State after activation:', afterState);
  } catch (err: any) {
    console.error('Activation failed with error:');
    console.error(err);
    if (err.stack) {
      console.error(err.stack);
    }
  } finally {
    // Close SQLite db connection
    try {
      kernel.db.close();
    } catch {}
  }
}

main().catch(console.error);
