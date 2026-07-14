import { Kernel } from '../packages/core/kernel/index.js';

async function main() {
  console.log('Initializing Kernel...');
  const kernel = new Kernel();
  await kernel.ready;
  console.log('Kernel ready.');

  const pluginId = '019f5ac3-fc32-74a5-addf-01689c9dde18'; // ext-homework-hub UUID
  
  console.log('Executing create_assignment command...');
  try {
    const cmd = kernel.commandBus.createCommand(
      '019f5ac3-fc32-74a5-addf-01689c9dde18.create_assignment',
      {
        title: '测试作业',
        description: '测试描述',
        deadline: '2026-07-20T12:00:00Z'
      },
      'user:usr_teacher:teacher'
    );
    const result = await kernel.commandBus.execute(cmd);
    console.log('Command executed successfully:', result);
  } catch (err: any) {
    console.error('Command execution failed with error:');
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
