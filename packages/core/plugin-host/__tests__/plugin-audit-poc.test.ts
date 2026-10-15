/**
 * 插件系统专项审计回归（2026-10-14）。
 *
 * PL-01 到 PL-08 断言漏洞已被阻断。PL-09、PL-10、PL-12、PL-15 仍是未修复项，
 * 对应用例继续锁定当前行为，避免修别的洞时把它们悄悄改掉。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { manifestSchema } from '../../esm-loader/manifest-schema.js';
import { builtinPluginsDir, resolvePluginExecutionMode } from '../execution-policy.js';
import { buildMinimalEnv } from '../../worker-runtime/child-spawn.js';
import { computeAllowedWorkerTokens } from '../../worker-runtime/worker-manager.js';
import { ServiceHost } from '../../worker-runtime/service-host.js';
import { CapabilityGuard } from '../../capability/guard/capability-guard.js';
import { CommandBus } from '../../command-bus/index.js';
import { EventBus } from '../../event-bus/index.js';
import { BASE_WORKER_SERVICE_TOKENS } from '../../worker-runtime/worker-manager.js';
import { approveDeclaredPublicRoutes, isPublicRouteApproved } from '../public-routes.js';
import { normalizeCommunityEntry } from '../../../../server/services/community-registry.js';
import { createDb, makeHost, makeTmpDir, removeTmpDir } from './helpers/audit-host.js';
import { tmpZipPath } from '../../esm-loader/__tests__/helpers/tmp-zip.js';
import type { InvokeMessage, IWorkerTransport } from '../../worker-runtime/types.js';
import Database from 'better-sqlite3';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

const ENV_KEYS = [
  'VITEST',
  'OPENLEARN_ENFORCE_PLUGIN_ISOLATION',
  'OPENLEARN_TRUSTED_INLINE_PLUGINS',
  'OPENAI_API_KEY',
] as const;
const savedEnv: Record<string, string | undefined> = {};

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function rememberEnv() {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
}

function productionEnv(): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH };
}

class CaptureTransport implements IWorkerTransport {
  messages: Array<{ type: string; message?: string; value?: unknown }> = [];
  readonly id = 'audit-poc';
  postMessage(message: unknown): void {
    this.messages.push(message as { type: string; message?: string });
  }
  onMessage(): void {}
  async terminate(): Promise<void> {}
}

async function invokeSql(sql: string, pluginId: string) {
  const db = {
    exec: () => undefined,
    prepare: () => ({ run: () => ({ changes: 0 }), get: () => undefined, all: () => [] }),
  };
  const registry = { resolve: async () => db, resolveByName: async () => db };
  const host = new ServiceHost(
    registry as never,
    { check: () => true, require: () => undefined } as never,
    `plugin:${pluginId}`,
    ['storage:read'],
    undefined,
    undefined,
    pluginId,
    '019fa0d4-2e31-76d9-8322-ca08f60012a8',
    ['@openlearn/core:IDatabase'],
  );
  const transport = new CaptureTransport();
  await host.handleInvoke(
    { invokeId: '1', token: '@openlearn/core:IDatabase', method: 'exec', args: [sql] } as unknown as InvokeMessage,
    transport,
  );
  return transport.messages[0];
}

describe('PL-01: 内联身份不看 id 前缀', () => {
  it('生产环境拒绝伪造的 @openlearn id，白名单和内置目录仍然放行', () => {
    const env = productionEnv();
    expect(resolvePluginExecutionMode('@openlearn/not-a-builtin', 'inline', env)).toEqual(
      expect.objectContaining({ mode: 'process', coerced: true }),
    );
    expect(resolvePluginExecutionMode('ext-community', 'inline', env)).toEqual(
      expect.objectContaining({ mode: 'process', coerced: true }),
    );
    expect(
      resolvePluginExecutionMode('ext-local', 'inline', { ...env, OPENLEARN_TRUSTED_INLINE_PLUGINS: 'ext-local' }),
    ).toEqual(expect.objectContaining({ mode: 'inline', coerced: false }));
    expect(
      resolvePluginExecutionMode('@openlearn/not-a-builtin', 'inline', env, `${builtinPluginsDir()}/vfs/index.js`),
    ).toEqual(expect.objectContaining({ mode: 'inline', coerced: false }));
  });

  it('manifest schema 接受伪造的 @openlearn id，只拒绝冒号', () => {
    const parsed = manifestSchema.parse({
      id: '@openlearn/not-a-builtin',
      name: 'Spoof',
      version: '1.0.0',
      main: 'index.js',
    });
    expect(parsed.id).toBe('@openlearn/not-a-builtin');
    expect(() =>
      manifestSchema.parse({ id: 'ext-evil:admin', name: 'X', version: '1.0.0', main: 'index.js' }),
    ).toThrow();
  });

  it('ZIP 安装会把伪造的 @openlearn id 落成 inline，普通 id 在强制隔离下是 process', async () => {
    rememberEnv();
    process.env.VITEST = 'true';
    process.env.OPENLEARN_ENFORCE_PLUGIN_ISOLATION = '1';
    delete process.env.OPENLEARN_TRUSTED_INLINE_PLUGINS;

    const db = createDb();
    const pluginsDir = makeTmpDir('audit-prefix-');
    const host = await makeHost(db, pluginsDir);

    const zip = new JSZip();
    zip.file(
      'manifest.json',
      JSON.stringify({
        id: '@openlearn/not-a-builtin',
        name: 'Spoof',
        version: '1.0.0',
        main: 'index.js',
        executionMode: 'inline',
      }),
    );
    zip.file('index.js', 'export default { async activate() {} };\n');
    const installed = (await host.installPluginFromZip(
      tmpZipPath(await zip.generateAsync({ type: 'nodebuffer' })),
    )) as {
      executionMode?: string;
      id: string;
    };
    expect(installed.id).toBe('@openlearn/not-a-builtin');
    expect(installed.executionMode).toBe('process');

    const plain = new JSZip();
    plain.file(
      'manifest.json',
      JSON.stringify({
        id: 'ext-audit-community',
        name: 'Community',
        version: '1.0.0',
        main: 'index.js',
        executionMode: 'inline',
      }),
    );
    plain.file('index.js', 'export default { async activate() {} };\n');
    const plainInstalled = (await host.installPluginFromZip(
      tmpZipPath(await plain.generateAsync({ type: 'nodebuffer' })),
    )) as { executionMode?: string };
    expect(plainInstalled.executionMode).toBe('process');

    removeTmpDir(pluginsDir);
    db.close();
  });
});

describe('PoC: 子进程权限模型', () => {
  it('buildMinimalEnv 不继承密钥环境变量', () => {
    rememberEnv();
    process.env.OPENAI_API_KEY = 'sk-audit-poc';
    process.env.NODE_OPTIONS = '--require /tmp/injected.js';
    const env = buildMinimalEnv({ pluginId: 'p', manifestId: 'ext-p', serviceTokens: [] });
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(JSON.stringify(env)).not.toContain('sk-audit-poc');
  });

  it('PL-10 仍在：权限模型跟随 pluginDir 内已有符号链接；PL-08 入口脚本拒绝原始出站 socket', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-perm-'));
    const pluginDir = path.join(root, 'plugin');
    fs.mkdirSync(pluginDir);
    const secret = path.join(root, 'secret.txt');
    fs.writeFileSync(secret, 'TOPSECRET');
    fs.symlinkSync(secret, path.join(pluginDir, 'via-symlink'));
    // 不要继承 Vitest 的 NODE_OPTIONS，否则子进程会在权限模型下加载测试预载并直接崩溃。
    const env = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' };

    const read = spawnSync(
      process.execPath,
      [
        '--permission',
        `--allow-fs-read=${pluginDir}/*`,
        '--input-type=module',
        '--eval',
        `import fs from 'node:fs';
         const target = process.argv[1];
         try { console.log('READ ' + fs.readFileSync(target, 'utf8').trim()); }
         catch (e) { console.log('DENY ' + (e.code || e.message)); }`,
        path.join(pluginDir, 'via-symlink'),
      ],
      { encoding: 'utf8', env },
    );
    expect(`${read.stdout}\n${read.stderr}`).toContain('READ TOPSECRET');

    const write = spawnSync(
      process.execPath,
      [
        '--permission',
        `--allow-fs-read=${pluginDir}/*`,
        `--allow-fs-write=${pluginDir}/*`,
        '--input-type=module',
        '--eval',
        `import fs from 'node:fs';
         try { fs.writeFileSync(process.argv[1], 'PWNED'); console.log('WROTE'); }
         catch (e) { console.log('DENY ' + (e.code || e.message)); }`,
        path.join(pluginDir, 'via-symlink'),
      ],
      { encoding: 'utf8', env },
    );
    expect(`${write.stdout}\n${write.stderr}`).toContain('WROTE');
    expect(fs.readFileSync(secret, 'utf8')).toBe('PWNED');

    const plant = spawnSync(
      process.execPath,
      [
        '--permission',
        `--allow-fs-read=${pluginDir}/*`,
        `--allow-fs-write=${pluginDir}/*`,
        '--input-type=module',
        '--eval',
        `import fs from 'node:fs';
         try { fs.symlinkSync(process.argv[2], process.argv[1]); console.log('PLANTED'); }
         catch (e) { console.log('DENY ' + e.code); }`,
        path.join(pluginDir, 'new-link'),
        secret,
      ],
      { encoding: 'utf8', env },
    );
    expect(`${plant.stdout}\n${plant.stderr}`).toContain('DENY ERR_ACCESS_DENIED');

    const serverCode = `
      import net from 'node:net';
      const srv = net.createServer((s) => { s.end('ok'); });
      srv.listen(0, '127.0.0.1', () => {
        const port = srv.address().port;
        const c = net.connect(port, '127.0.0.1', () => { console.log('NET_OK'); c.end(); srv.close(); });
        c.on('error', (e) => { console.log('NET_ERR ' + e.code); srv.close(); });
      });
    `;
    const preload = path.join(REPO_ROOT, 'packages/core/worker-runtime/plugin-net-preload.cjs');
    const netResult = spawnSync(
      process.execPath,
      [
        '--permission',
        `--allow-fs-read=${pluginDir}/*`,
        `--allow-fs-read=${preload}`,
        `--require=${preload}`,
        '--input-type=module',
        '--eval',
        serverCode,
      ],
      { encoding: 'utf8', env: { ...env, OPENLEARN_PLUGIN_NET_ALLOW: '' } },
    );
    expect(`${netResult.stdout}\n${netResult.stderr}`).not.toContain('NET_OK');
    expect(`${netResult.stdout}\n${netResult.stderr}`).toMatch(/ERR_ACCESS_DENIED|NET_ERR/);

    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('PoC: worker 插件的数据库与能力面', () => {
  it('SQL 白名单拒绝插件命名空间之外的表', async () => {
    for (const sql of [
      'SELECT password_hash FROM users',
      'SELECT * FROM submission_raw',
      'SELECT * FROM submission_result',
      'SELECT * FROM vfs_nodes',
      'SELECT * FROM classroom_poll_votes',
      'SELECT * FROM classroom_danmaku',
      'SELECT name, sql FROM sqlite_master',
      'SELECT * FROM class_groups',
    ]) {
      const msg = await invokeSql(sql, 'ext-community');
      expect(msg?.type, sql).toBe('error');
    }
    const own = await invokeSql(
      'SELECT * FROM plugin_019fa0d4_2e31_76d9_8322_ca08f60012a8_scores',
      'ext-community',
    );
    expect(own?.type).toBe('result');
  });

  it('research 子串不再放行，只有显式 id 可以访问研究表', async () => {
    const spoofed = await invokeSql('SELECT * FROM plugin_research_grades', 'ext-research-helper');
    expect(spoofed?.type).toBe('error');
    const denied = await invokeSql('SELECT * FROM plugin_research_grades', 'ext-homework-hub');
    expect(denied?.type).toBe('error');
    const allowed = await invokeSql('SELECT * FROM plugin_research_grades', 'lianyun-course');
    expect(allowed?.type).toBe('result');
  });

  it('只要声明任意 capability，就能通过 ICapabilityService.grant 给自己授予 *', async () => {
    const guard = new CapabilityGuard();
    const registry = { resolve: async () => guard, resolveByName: async () => guard };
    const host = new ServiceHost(
      registry as never,
      guard,
      'plugin:ext-community',
      ['storage:read'],
      undefined,
      undefined,
      'ext-community',
      '019fa0d4-2e31-76d9-8322-ca08f60012a8',
      ['@openlearn/core:ICapabilityService'],
    );
    const transport = new CaptureTransport();
    await host.handleInvoke(
      {
        invokeId: 'g',
        token: '@openlearn/core:ICapabilityService',
        method: 'grant',
        args: ['plugin:ext-community', '*'],
      } as unknown as InvokeMessage,
      transport,
    );
    expect(transport.messages[0]?.type).toBe('error');
    expect(guard.check('plugin:ext-community', 'site:destroy')).toBe(false);

    const empty = new ServiceHost(
      registry as never,
      guard,
      'plugin:ext-empty',
      [],
      undefined,
      undefined,
      'ext-empty',
      '019fa0d4-2e31-76d9-8322-ca08f60012a8',
      ['@openlearn/core:ICapabilityService'],
    );
    const transport2 = new CaptureTransport();
    await empty.handleInvoke(
      {
        invokeId: 'g2',
        token: '@openlearn/core:ICapabilityService',
        method: 'grant',
        args: ['plugin:ext-empty', '*'],
      } as unknown as InvokeMessage,
      transport2,
    );
    expect(transport2.messages[0]?.type).toBe('error');
  });

  it('基础白名单含命令总线、能力服务和数据库，不含会话桥', () => {
    expect(BASE_WORKER_SERVICE_TOKENS).toEqual(
      expect.arrayContaining([
        '@openlearn/core:ICommandBusService',
        '@openlearn/core:ICapabilityService',
        '@openlearn/core:IDatabase',
      ]),
    );
    const tokens = computeAllowedWorkerTokens({
      id: 'ext-community',
      name: 'C',
      version: '1.0.0',
      main: 'index.js',
      requires: ['@openlearn/core:IAuthSessionBridgeService@^1.0.0'],
    });
    expect(tokens.some((token) => token.includes('IAuthSessionBridge'))).toBe(false);
  });

  it('命令 execute 丢掉插件传入的 actorId 与 metadata.approved', async () => {
    const bus = new CommandBus(new EventBus());
    let seen: { actorId?: string; metadata?: { approved?: boolean } } | undefined;
    bus.registerHandler('audit.poc.forward', {
      execute: async (command) => {
        seen = {
          actorId: command.actorId,
          metadata: command.metadata as { approved?: boolean } | undefined,
        };
        return 'ran';
      },
    });
    const registry = { resolve: async () => bus, resolveByName: async () => bus };
    const host = new ServiceHost(
      registry as never,
      new CapabilityGuard(),
      'plugin:ext-community',
      ['storage:read'],
      undefined,
      undefined,
      'ext-community',
      undefined,
      ['@openlearn/core:ICommandBusService'],
    );
    const transport = new CaptureTransport();
    await host.handleInvoke(
      {
        invokeId: 'c',
        token: '@openlearn/core:ICommandBusService',
        method: 'execute',
        args: [
          {
            id: 'cmd-1',
            type: 'audit.poc.forward',
            actorId: 'admin',
            payload: {},
            metadata: { approved: true },
          },
        ],
      } as unknown as InvokeMessage,
      transport,
    );
    expect(transport.messages[0]?.type).toBe('result');
    expect(seen?.actorId).toBe('plugin:ext-community');
    expect(seen?.metadata?.approved).toBeUndefined();
  });
});

describe('PoC: 内核命令拦截器信任调用方自报的 actor', () => {
  it('actorId=admin 跳过能力检查和高危审批；缺省 actor 落到 agent-system-0；metadata.approved 跳过审批', async () => {
    const { Kernel } = await import('../../kernel/index.js');
    const pluginsDir = makeTmpDir('audit-kernel-');
    const kernel = new Kernel({ pluginsDir });
    await kernel.ready;

    const type = `audit.poc.highrisk.${Date.now()}`;
    kernel.actionRegistry.register({
      id: type,
      commandType: type,
      description: 'audit poc',
      inputSchema: { type: 'OBJECT', properties: {}, required: [] },
      capabilityRequired: 'site:destroy',
      isHighRisk: true,
    });
    kernel.commandBus.registerHandler(type, { execute: async () => 'pwned' });

    const pluginActor = kernel.commandBus.createCommand(type, {}, 'plugin:ext-community');
    await expect(kernel.commandBus.execute(pluginActor)).rejects.toThrow(/CapabilityGuard/);

    const spoofed = kernel.commandBus.createCommand(type, {}, 'admin');
    await expect(kernel.commandBus.execute(spoofed)).resolves.toBe('pwned');

    kernel.capabilityGuard.grant('plugin:ext-community', 'site:destroy');
    const selfApproved = kernel.commandBus.createCommand(type, {}, 'plugin:ext-community', { approved: true });
    await expect(kernel.commandBus.execute(selfApproved)).rejects.toThrow(/requires human approval/);

    const benign = `audit.poc.benign.${Date.now()}`;
    kernel.actionRegistry.register({
      id: benign,
      commandType: benign,
      description: 'audit poc benign',
      inputSchema: { type: 'OBJECT', properties: {}, required: [] },
      capabilityRequired: 'lesson:delete',
    });
    kernel.commandBus.registerHandler(benign, { execute: async (command) => command.actorId });
    const omitted = kernel.commandBus.createCommand(benign, {}, '');
    await expect(kernel.commandBus.execute(omitted)).rejects.toThrow(/actorId is required/);

    removeTmpDir(pluginsDir);
  });
});

describe('PoC: 信任展示、公开路由与卸载前缀', () => {
  it('社区注册表的 verified 可由条目自己写成 true，并显示为已认证', () => {
    const entry = normalizeCommunityEntry({
      id: '@openlearn/not-a-builtin',
      name: 'Spoof',
      version: '1.0.0',
      downloadUrl: 'https://plugins.example.com/spoof.zip',
      verified: 'true',
    });
    expect(entry?.verified).toBe(false);
    expect(entry?.id).toBe('@openlearn/not-a-builtin');
    const panel = fs.readFileSync(
      path.join(REPO_ROOT, 'src/components/plugin-center/sub-views/PluginCommunityPanel.tsx'),
      'utf8',
    );
    expect(panel).not.toContain('官方校验来源');
    expect(panel).toContain('平台公钥验签通过');
  });

  it('公开路由批准不绑定代码哈希，更新函数不清批准表', () => {
    const db = new Database(':memory:');
    approveDeclaredPublicRoutes(db, ['ext-community'], {
      api: { routes: [{ method: 'GET', path: '/hook', auth: false }] },
    });
    expect(isPublicRouteApproved(db, ['ext-community'], 'GET', '/hook')).toBe(true);
    const installSrc = fs.readFileSync(path.join(REPO_ROOT, 'packages/core/plugin-host/install.ts'), 'utf8');
    const updateStart = installSrc.indexOf('private async updatePluginFromZipExclusive');
    expect(updateStart).toBeGreaterThan(0);
    expect(installSrc.slice(updateStart)).not.toContain('clearPublicRouteApprovals');
    db.close();
  });

  it('worker 用 manifest id 建表，卸载按 UUID 前缀删表，两者对不上', () => {
    const uuid = '019fa0d4-2e31-76d9-8322-ca08f60012a8';
    const manifestId = 'ext-homework-hub';
    const created = `plugin_${manifestId.replace(/[^a-zA-Z0-9_]/g, '_')}_scores`;
    const droppedPrefix = `plugin_${uuid.replace(/[^a-zA-Z0-9_]/g, '_')}_`;
    expect(created.startsWith(droppedPrefix)).toBe(false);

    const boot = fs.readFileSync(
      path.join(REPO_ROOT, 'packages/core/worker-runtime/bootstrap/sections/message-handler.ts'),
      'utf8',
    );
    const installSrc = fs.readFileSync(path.join(REPO_ROOT, 'packages/core/plugin-host/install.ts'), 'utf8');
    expect(boot).toContain('workerData.tablePrefix ||');
    expect(boot).not.toContain(
      "var tablePrefix = 'plugin_' + (workerData.manifestId || workerData.pluginId)",
    );
    expect(installSrc).toContain('pluginTablePrefix(pluginId)');
    expect(installSrc).toContain('pluginTablePrefix(manifestId)');
  });

  it('一键更新要求风险确认与产物哈希；会话桥已改为精确匹配（PL-12 已在 main 关闭）', () => {
    const routes = fs.readFileSync(path.join(REPO_ROOT, 'server/routes/plugins.ts'), 'utf8');
    const start = routes.indexOf("app.post('/api/plugins/:id(*)/one-click-update'");
    const end = routes.indexOf('app.get', start + 10);
    const body = routes.slice(start, end);
    expect(body).toContain('acknowledgeRisk');
    expect(body).toContain('integrity');

    const gateway = fs.readFileSync(path.join(REPO_ROOT, 'server/routes/plugin-api-gateway.ts'), 'utf8');
    // PL-12 已由 #48 关闭：子串匹配换成 parseRequiresEntry().tokenName 全等，仿冒声明不再放行。
    expect(gateway).not.toContain("r.includes('IAuthSessionBridgeService')");
    expect(gateway).toContain('parseRequiresEntry');
    expect(gateway).toContain('tokenName');
  });

  it('远程前端进沙箱 iframe，/plugins 需要会话；开发面板已改为静态解析（PL-15 已在 main 关闭）', () => {
    const host = fs.readFileSync(path.join(REPO_ROOT, 'src/plugin-host/plugin-host.ts'), 'utf8');
    const remoteStart = host.indexOf('async activateRemotePlugin');
    const remoteEnd = host.indexOf('async activatePlugin', remoteStart);
    const remote = host.slice(remoteStart, remoteEnd);
    expect(remote).toContain('mountSandboxFrame');
    expect(remote).not.toContain('import(/* @vite-ignore */ blobUrl)');
    expect(host).toContain("sandbox', PLUGIN_SANDBOX_ATTR");
    const slice = fs.readFileSync(path.join(REPO_ROOT, 'src/hooks/useClassroomSlice.ts'), 'utf8');
    expect(slice).not.toContain("executionMode: 'inline'");
    const dev = fs.readFileSync(
      path.join(REPO_ROOT, 'src/components/plugin-center/utils/pluginCenterUtils.ts'),
      'utf8',
    );
    // PL-15 已由 #42 关闭：开发面板改为静态解析 Manifest，不再用 new Function 执行源码。
    expect(dev).not.toContain('new Function');
    const server = fs.readFileSync(path.join(REPO_ROOT, 'server.ts'), 'utf8');
    expect(server).toContain("app.use(\n    '/plugins'");
    expect(server).toContain('getValidSession(token)');
    expect(server).toContain('/plugin-sandbox/frame');
  });
});
