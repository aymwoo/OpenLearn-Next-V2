/**
 * Worker 沙箱收敛测试（2026-10-04，SEC-DB-03 / 白名单收敛）
 *
 * 覆盖三处修复：
 * 1. `IPluginHost` 移出基础白名单 —— 沙箱插件不应能安装/激活其他插件
 * 2. **DML 命名空间隔离** —— 此前命名空间校验只管 DDL，跨插件读写完全畅通
 * 3. 核心表黑名单扩充 —— 实测 97 张表中原名单只覆盖 28 张
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Worker } from 'node:worker_threads';
import { parentPort } from 'node:worker_threads';
import { ServiceHost } from '../service-host.js';
import { BASE_WORKER_SERVICE_TOKENS } from '../worker-manager.js';
// L-2 阶段 1：遮蔽段的测试入口跟着代码搬到了 bootstrap 模块 ——
// 它原本住在 worker-manager.ts 里，对着一整段 881 行的模板做字符串手术。
import { extractProcessMaskingBlock } from '../bootstrap/index.js';
import type { IWorkerTransport, InvokeMessage } from '../types.js';

/** 自己的两个命名空间：DB UUID 与 manifestId。 */
const OWN_UUID = '019fa0d4-2e31-76d9-8322-ca08f60012a8';
const OWN_NS_UUID = `plugin_${OWN_UUID.replace(/-/g, '_')}_`;
const OWN_NS_MID = 'plugin__aymwoo_plugin_lab_seat_';
const OTHER_TABLE = 'plugin_01a0ba5b_9ece_7610_bbdd_7edb9c5839d1_attendance_logs';

class CaptureTransport implements IWorkerTransport {
  messages: any[] = [];
  readonly id = 'browser-worker:test';
  postMessage(m: unknown): void {
    this.messages.push(m);
  }
  onMessage(): void {
    /* 本用例只验证出向消息 */
  }
  async terminate(): Promise<void> {
    /* 无需真实终止 */
  }
}

const NO_SOCKET = undefined as never;

function makeHost(caps: string[] = ['storage:write'], tokens?: string[]) {
  const db = {
    exec: () => undefined,
    prepare: () => ({ run: () => ({ changes: 0 }), get: () => undefined, all: () => [] }),
  };
  const registry = { resolve: async () => db, resolveByName: async () => db };
  const host = new ServiceHost(
    registry as never,
    { check: () => true, require: () => undefined } as never, // capabilityGuard
    '@aymwoo/plugin-lab-seat', // pluginActorId
    caps, // manifestCapabilities
    undefined, // eventBus
    undefined, // eventForwarder
    '@aymwoo/plugin-lab-seat', // pluginId (manifestId)
    OWN_UUID, // dbPluginId (DB UUID)
    tokens, // allowedTokens
  );
  return { host, transport: new CaptureTransport() };
}

async function invokeSql(sql: string, tokens?: string[], caps?: string[]) {
  const { host, transport } = makeHost(caps, tokens);
  await host.handleInvoke(
    { invokeId: '1', token: '@openlearn/core:IDatabase', method: 'exec', args: [sql] } as unknown as InvokeMessage,
    transport as never,
  );
  return transport.messages[0] as { type: string; message?: string };
}

beforeEach(() => {
  /* 每个用例独立构造 host，无需共享状态 */
});

describe('白名单收敛', () => {
  it('IPluginHost 已不在基础白名单中', () => {
    expect(BASE_WORKER_SERVICE_TOKENS).not.toContain('@openlearn/core:IPluginHost');
  });

  it('基础白名单仍保留 IDatabase（靠语句守卫管控范围，而非移除句柄）', () => {
    expect(BASE_WORKER_SERVICE_TOKENS).toContain('@openlearn/core:IDatabase');
  });

  it('使用真实基础白名单时，插件无法 resolve 到 IPluginHost', async () => {
    const { host, transport } = makeHost(['storage:write'], [...BASE_WORKER_SERVICE_TOKENS]);
    await host.handleInvoke(
      {
        invokeId: '1',
        token: '@openlearn/core:IPluginHost',
        method: 'installPlugin',
        args: ['malicious source'],
      } as unknown as InvokeMessage,
      transport as never,
    );
    expect(transport.messages[0].type).toBe('error');
    expect(transport.messages[0].message).toContain('not in worker allowedTokens');
  });

  it('IPluginHost 在全量白名单常量中仍保留（供需要它的插件走条件授予）', () => {
    // ALL_SERVICE_TOKENS 是兼容性超集，不改它以免破坏外部引用
    expect(BASE_WORKER_SERVICE_TOKENS.length).toBe(8);
  });
});

describe('DML 命名空间隔离（SEC-DB-03）', () => {
  it('允许读写自己 UUID 命名空间下的表', async () => {
    for (const sql of [
      `SELECT * FROM ${OWN_NS_UUID}seat_assignments`,
      `INSERT INTO ${OWN_NS_UUID}seat_assignments (id) VALUES ('x')`,
      `UPDATE ${OWN_NS_UUID}seat_assignments SET id = 'y'`,
      `DELETE FROM ${OWN_NS_UUID}seat_assignments WHERE id = 'x'`,
    ]) {
      const r = await invokeSql(sql, ['@openlearn/core:IDatabase']);
      expect(r.type, `应放行: ${sql}`).toBe('result');
    }
  });

  it('允许读写自己 manifestId 命名空间下的表', async () => {
    const r = await invokeSql(`SELECT * FROM ${OWN_NS_MID}attendance_records`, ['@openlearn/core:IDatabase']);
    expect(r.type).toBe('result');
  });

  it('拒绝 SELECT 其他插件的表', async () => {
    const r = await invokeSql(`SELECT * FROM ${OTHER_TABLE}`, ['@openlearn/core:IDatabase']);
    expect(r.type).toBe('error');
    expect(r.message).toContain("another plugin's table");
  });

  it('拒绝 UPDATE / DELETE / INSERT 其他插件的表', async () => {
    for (const sql of [
      `UPDATE ${OTHER_TABLE} SET x = 1`,
      `DELETE FROM ${OTHER_TABLE}`,
      `INSERT INTO ${OTHER_TABLE} (id) VALUES ('x')`,
    ]) {
      const r = await invokeSql(sql, ['@openlearn/core:IDatabase']);
      expect(r.type, `应拒绝: ${sql}`).toBe('error');
    }
  });

  it('拒绝跨插件 JOIN（FROM 与 JOIN 两侧都要检查）', async () => {
    const r = await invokeSql(`SELECT * FROM ${OWN_NS_UUID}seat_assignments a JOIN ${OTHER_TABLE} b ON a.id = b.id`, [
      '@openlearn/core:IDatabase',
    ]);
    expect(r.type).toBe('error');
    expect(r.message).toContain('another plugin');
  });

  it('不把 plugin_id 这类列名误判为表名', async () => {
    // plugin_migrations 是插件共享表，其 plugin_id 列不应触发拦截
    const r = await invokeSql(`INSERT INTO plugin_migrations (plugin_id, name, applied_at) VALUES ('p1','m1',1)`, [
      '@openlearn/core:IDatabase',
    ]);
    expect(r.type).toBe('result');
  });

  it('DDL 仍受原有命名空间规则约束（自有命名空间可建表）', async () => {
    const r = await invokeSql(`CREATE TABLE IF NOT EXISTS ${OWN_NS_UUID}new_table (id TEXT)`, [
      '@openlearn/core:IDatabase',
    ]);
    expect(r.type).toBe('result');
  });

  it('DDL 他人命名空间仍被拒绝（保持既有契约）', async () => {
    const r = await invokeSql(`CREATE TABLE ${OTHER_TABLE} (id TEXT)`, ['@openlearn/core:IDatabase']);
    expect(r.type).toBe('error');
    expect(r.message).toContain('not permitted to perform DDL');
  });
});

describe('核心表黑名单扩充', () => {
  it.each([
    'site_settings',
    'agent_conversations',
    'classroom_sessions',
    'lesson_quiz_submissions',
    'courseware_score_config',
    'demo_data_registry',
    'whiteboard_elements',
    'student_point_logs',
  ])('拒绝访问 %s（此前黑名单漏网）', async (table) => {
    const r = await invokeSql(`SELECT * FROM ${table}`, ['@openlearn/core:IDatabase']);
    expect(r.type, `应拒绝 ${table}`).toBe('error');
    expect(r.message).toContain('forbidden from accessing core security table');
  });

  it('既有的高危操作封禁未被破坏', async () => {
    for (const sql of ["ATTACH DATABASE 'x' AS y", 'PRAGMA table_info(users)', 'VACUUM']) {
      const r = await invokeSql(sql, ['@openlearn/core:IDatabase']);
      expect(r.type, `应拒绝 ${sql}`).toBe('error');
    }
  });
});

/**
 * I-4（D-1 决策：平台要做第三方开发者生态）：`process` 遮蔽
 *
 * ## 为什么必须实测
 *
 * worker_threads 与主进程**同进程同内存空间**，`process` 是裸全局 —— 插件不需要
 * 任何绕过手段就能读到宿主环境变量。开发期实测（`new Worker(url,{eval:false})`，
 * 与插件 worker 的创建方式一致）：
 *
 *   process.env → 可读到 10+ 个密钥（ANTHROPIC_AUTH_TOKEN / IMA_OPENAPI_APIKEY /
 *                  MINIMAX_API_KEY …）
 *   process.kill / process.chdir → 可用
 *   process.exit() → 可用（只终结本线程，主进程存活）
 *
 * 安装期两道真门（esbuild `platform:'neutral'` 拒绝裸 specifier、
 * `assertPluginCodeSafe()` 拦 eval / new Function / 计算式 import）能挡住
 * `await import('node:fs')`，但**挡不住 `process`** —— 它就在全局作用域里。
 *
 * ## 为什么用真实 worker 而不是直接调遮蔽函数
 *
 * 遮蔽逻辑写在动态生成的 bootstrap 字符串里，无法 import 共享模块。测试通过
 * `extractProcessMaskingBlock()` 拿到**生产实际执行的那段代码**（同源标记切取），
 * 放进真实 worker 跑一遍。这样测的是真货，不是复制品。
 */
/**
 * 在真实 worker 里执行「生产实际的遮蔽代码 + 探针」。
 *
 * 遮蔽逻辑写在动态生成的 bootstrap 字符串里，无法 import 共享模块 —— 测试通过
 * `extractProcessMaskingBlock()`（同源标记切取）拿到**生产实际执行的那段代码**。
 * 这样测的是真货，不是复制品。
 */
const execMasking = (body: string) =>
  new Promise<any>((resolve, reject) => {
    const inner = extractProcessMaskingBlock();
    // 必须自己 import parentPort：遮蔽块里用了它（进程退出时报错上报），
    // 而 data: URL 模块不会继承任何 import。
    const src = `
import { parentPort } from 'node:worker_threads';
${inner}
const out = {};
try {
${body}
} catch (e) {
  out.__threw = String((e && e.message) || e);
}
parentPort.postMessage(out);
`;
    const w = new Worker(new URL(`data:text/javascript;base64,${Buffer.from(src, 'utf-8').toString('base64')}`), {
      eval: false,
    });
    // 遮蔽后的 process.exit 会先 postMessage({type:'error'}) 再抛错 ——
    // 那条消息会**先于**最终结果到达。若用 once('message')，断言拿到的是
    // SecurityError 的上报对象而不是结果对象（表现为 exitThrew === undefined）。
    // 这里只认最终结果：无 type 字段的那条。
    const onMessage = (m: any) => {
      if (m && typeof m === 'object' && typeof m.type === 'string') return;
      w.off('message', onMessage);
      w.terminate();
      resolve(m);
    };
    w.on('message', onMessage);
    w.once('error', reject);
  });

describe('I-4: process 遮蔽', () => {
  it('遮蔽后 process.env 读不到任何宿主环境变量', async () => {
    const out = await execMasking(`
      out.envIsEmpty = Object.keys(process.env).length === 0;
      out.envFrozen = Object.isFrozen(process.env);
      // 直接猜几个真实存在的密钥名 —— 必须是 undefined
      out.guessHost = process.env.ANTHROPIC_AUTH_TOKEN;
      out.guessKey = process.env.OPENAI_API_KEY;
      // 即使宿主真的设了同名变量，也读不到（遮蔽换成空对象）
      out.noProto = Object.getPrototypeOf(process.env) === null;
    `);
    expect(out.__threw).toBeUndefined();
    expect(out.envIsEmpty, 'process.env 必须为空对象').toBe(true);
    expect(out.guessHost, '不得泄漏宿主环境变量').toBeUndefined();
    expect(out.guessKey).toBeUndefined();
    expect(out.noProto, '空 env 不应挂在 Object.prototype 上（避免原型链取值）').toBe(true);
  });

  it('process.exit 被替换为抛错，而非静默退出线程', async () => {
    const out = await execMasking(`
      try { process.exit(0); out.exitThrew = false; }
      catch (e) { out.exitThrew = true; out.exitMsg = String(e.message || e); }
    `);
    expect(out.exitThrew, 'process.exit 应抛错').toBe(true);
    expect(out.exitMsg).toContain('forbidden');
  });

  // 不含 chdir —— 实测把它 redefine 成不可写会让 exceljs（官方白名单依赖）
  // 的require 链炸 'Cyclic __proto__ value'。详见 worker-manager.ts 遮蔽块注释。
  it.each(['kill', 'abort', 'setuid', 'setgid', 'seteuid', 'setegid', 'dlopen', 'binding'])(
    'process.%s 被替换为抛错桩',
    async (fn) => {
      // 断言的是「**调用会抛错**」，而不是 `typeof !== 'function'`。
      // 遮蔽后 process.kill 仍是一个 function —— 我们替换成的桩本身就是 function；
      // 若断言 typeof，遮蔽完全失效时原生实现也是 function，那样会假通过。
      const out = await execMasking(`
        try { process.${fn}(${fn === 'kill' ? '1' : ''}); out.threw = false; }
        catch (e) { out.threw = true; out.msg = String((e && e.message) || e); }
      `);
      expect(out.threw, `process.${fn} 调用未被拦截`).toBe(true);
      expect(out.msg).toContain('forbidden');
    },
  );

  it('遮蔽后仍保留无敏感信息的诊断项', async () => {
    // 过度遮蔽会让插件无法排障 —— 保留 version/platform/cwd/pid 这类。
    const out = await execMasking(`
      out.version = typeof process.version;
      out.platform = typeof process.platform;
      out.cwd = typeof process.cwd;
      out.pid = typeof process.pid;
    `);
    expect(out.version).toBe('string');
    expect(out.platform).toBe('string');
    expect(out.cwd).toBe('function');
    expect(out.pid).toBe('number');
  });

  it('argv 被收窄为仅 worker 标识（不含宿主命令行参数）', async () => {
    const out = await execMasking(`
      out.argv = Array.from(process.argv);
      out.frozen = Object.isFrozen(process.argv);
    `);
    expect(out.frozen, 'argv 应被冻结，插件无法 push 宿主参数进来').toBe(true);
    expect(out.argv).toEqual(['node', 'openlearn-plugin-worker']);
    expect(out.argv.join(' ')).not.toContain(process.cwd());
  });

  it('env 的属性无法被重新写回（防止插件自己解冻）', async () => {
    const out = await execMasking(`
      try {
        Object.defineProperty(process, 'env', { value: { LEAKED: 'yes' }, configurable: true });
        out.redefineOk = true;
      } catch (e) { out.redefineOk = false; }
      out.stillEmpty = Object.keys(process.env).length === 0;
    `);
    expect(out.redefineOk, 'process.env 必须不可重定义（configurable:false）').toBe(false);
    expect(out.stillEmpty).toBe(true);
  });

  it('realExit 引用被 bootstrap 自身保留，插件代码里拿不到', async () => {
    // realExit 在遮蔽之前取出，供 bootstrap 的错误处理器真正退出 worker。
    // 它是模块作用域的局部变量 —— 插件代码无法访问，但必须仍然生效。
    const out = await execMasking(`
      out.realExitIsFn = typeof realExit === 'function';
      // 模拟「插件试图读取 realExit」：它在闭包外，必须是 undefined
      out.leakViaGlobal = typeof globalThis.realExit;
    `);
    expect(out.realExitIsFn).toBe(true);
    expect(out.leakViaGlobal, 'realExit 不得挂到 globalThis').toBe('undefined');
  });
});

describe('I-4 遮蔽不得打断受支持的插件依赖', () => {
  // 回归防线：I-4 遮蔽 process 的一轮里，我们把 process.chdir 也加进了遮蔽名单，
  // 结果 exceljs（PLUGIN_SHARED_MODULES 里的官方支持依赖）在 require 时炸
  // 'Cyclic __proto__ value'，金丝雀 worker 模式测试直接变红。
  // 代价（挡一个 chdir）远大于收益（保住一条受支持的加载路径），故 chdir 已移出。
  // 这条用例锁住「白名单里的共享模块仍能加载」这个契约。
  it.each(['recharts', 'jspdf', 'exceljs', 'uuid'])('%s 在遮蔽后仍可 require', async (mod) => {
    const out = await execMasking(`
      const { createRequire } = await import('node:module');
      const requireFn = createRequire('${process.cwd().replace(/\\/g, '/')}/package.json');
      try { const m = requireFn('${mod}'); out.ok = m !== null && m !== undefined; }
      catch (e) { out.ok = false; out.err = String(e.message); }
    `);
    expect(out.__threw).toBeUndefined();
    expect(out.ok, `${mod} 应仍可加载：${out.err ?? ''}`).toBe(true);
  });
});
