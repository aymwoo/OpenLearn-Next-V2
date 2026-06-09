import { kernelContainer } from '../core/kernel/index.js';

export function bootstrapProcessPlugins() {
  const { commandBus, actionRegistry, db, processManager } = kernelContainer;

  // REGISTER TASK HANDLERS
  processManager.registerHandler('simulated_task', async (processId, payload, state, log, updateState) => {
    log(`Process resumed/started: ${payload.name}`);
    const totalSteps = payload.duration;
    let startStep = state?.step || 0;
    
    for (let i = startStep; i < totalSteps; i++) {
       // Check if killed
       const p = db.prepare('SELECT status FROM processes WHERE id = ?').get(processId) as any;
       if (p && p.status === 'killed') {
           log(`Process was killed.`);
           return;
       }
       await new Promise(r => setTimeout(r, 1000));
       updateState({ step: i + 1 });
       log(`Progress: step ${i+1}/${totalSteps} completed.`);
    }
    log(`Process ${payload.name} completed successfully.`);
  });

  // RESTORE EXISTING TASKS
  processManager.restore();


  // 1. PROCESS SPAWN
  const spawnCmdType = 'process.spawn';
  actionRegistry.register({
    id: 'core-process-spawn',
    commandType: spawnCmdType,
    description: 'Spawn a long-running background process (simulated) by providing a name and duration in seconds.',
    capabilityRequired: 'process:write',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING', description: 'Name/Title of the process' },
        duration: { type: 'NUMBER', description: 'Simulated duration in seconds' }
      },
      required: ['name', 'duration']
    }
  });

  commandBus.registerHandler(spawnCmdType, {
    async execute(command) {
      const payload = command.payload as any;
      const processId = processManager.spawn(payload.name, 'simulated_task', { name: payload.name, duration: payload.duration });
      return { processId };
    }
  });

  // 2. PROCESS KILL
  const killCmdType = 'process.kill';
  actionRegistry.register({
    id: 'core-process-kill',
    commandType: killCmdType,
    description: 'Kill/terminate a running process by ID.',
    capabilityRequired: 'process:write',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        processId: { type: 'STRING', description: 'ID of the process to kill' }
      },
      required: ['processId']
    }
  });

  commandBus.registerHandler(killCmdType, {
    async execute(command) {
      const payload = command.payload as any;
      processManager.kill(payload.processId);
      return { success: true };
    }
  });

  // 3. PROCESS LIST
  const listCmdType = 'process.list';
  actionRegistry.register({
    id: 'core-process-list',
    commandType: listCmdType,
    description: 'List all running or completed processes.',
    capabilityRequired: 'process:read',
    inputSchema: {
      type: 'OBJECT',
      properties: {}
    }
  });

  commandBus.registerHandler(listCmdType, {
    async execute() {
      const nodes = db.prepare('SELECT id, name, status, created_at, updated_at FROM processes ORDER BY created_at DESC').all();
      return { processes: nodes };
    }
  });

  // 4. PROCESS LOGS
  const logCmdType = 'process.logs';
  actionRegistry.register({
    id: 'core-process-logs',
    commandType: logCmdType,
    description: 'View the logs of a specific process.',
    capabilityRequired: 'process:read',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        processId: { type: 'STRING', description: 'ID of the process' }
      },
      required: ['processId']
    }
  });

  commandBus.registerHandler(logCmdType, {
    async execute(command) {
      const payload = command.payload as any;
      const process = db.prepare('SELECT logs FROM processes WHERE id = ?').get(payload.processId) as any;
      if (!process) throw new Error('Process not found');
      return { logs: process.logs };
    }
  });
}
