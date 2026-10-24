/**
 * L-1 P2：Node Permission Model（能力面收敛）。
 *
 * ## 这个测试要证明什么
 *
 * 权限模型最容易做成**自欺**：旗标加上了、子进程照样起来了、激活照样成功，
 * 测试全绿 —— 但可能权限根本没生效，或者生效了却拦不住任何东西。
 * 「没打断插件路径」和「真的约束住了」是两件事，必须分别断言。
 *
 * 所以这里用探针插件**从沙箱内部**尝试 9 项能力，把结果写回 pluginDir，
 * 由宿主读回并逐项断言。
 *
 * ## 为什么每个用例都要跑两遍（`rw` 与 `off`）
 *
 * 这是本文件的核心设计，也是它区别于普通冒烟测试的地方。
 *
 * 只测 `rw` 是不够的：探针抛错可能是因为**权限模型拦住了**，也可能是因为
 * **探针本身写错了** —— 比如在 ESM 里用 `require()`（这个坑我一开始就踩了：
 * 10 个探针全部报 `require is not defined`，看起来像「权限全禁」，实际是
 * 探针全错）。
 *
 * 两种情况在只看 `rw` 的断言里长得一模一样。所以同一组探针在 `off` 下必须
 * **全部成功**：这既证明探针是真的，也构成反向对照 —— 拦与不拦的差别只能由
 * 权限模型解释。
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ServiceRegistry } from '../../di/service-registry.js';
import { CapabilityGuard } from '../../capability/index.js';
import { WorkerManager } from '../worker-manager.js';
import {
  buildPermissionArgs,
  describePermissionPolicy,
  normalizePermissionPolicy,
  DEFAULT_PERMISSION_POLICY,
  PERMISSION_POLICIES,
} from '../plugin-permission.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE plugins (
      id TEXT PRIMARY KEY, name TEXT, manifest TEXT, source_code TEXT,
      status TEXT, loader_version TEXT, execution_mode TEXT
    );
  `);
  return db;
}

/**
 * 探针插件：在**沙箱内部**逐项尝试能力，把结果写回 pluginDir。
 *
 * 每项记 `ok`（是否成功）与 `err`（错误码）—— 权限拒绝抛 `ERR_ACCESS_DENIED`，
 * 而「探针自身写错」抛的是 `ReferenceError` 之类，两者在结构上必须能区分，
 * 否则一个写错的探针会伪装成「权限拦住了」。
 *
 * ## 三处容易把自己坑了的写法（都实际踩过）
 *
 * 1. **不能用 `require()`** —— 插件是 data URL 的 ESM 模块，`require` 未定义，
 *    10 个探针会一起报 `ReferenceError`，看起来像「权限全禁」实则全错。
 *    一律用顶部静态 `import`。
 * 2. **不能用 `new Worker('', { eval: true })`** —— 那会先撞上
 *    `--disallow-code-generation-from-strings`（EvalError），测出来的是「代码生成
 *    被禁」而不是「创建 worker 被禁」。改为从真实文件建 worker。
 * 3. **不能靠环境变量传 pluginDir** —— 子进程 env 走 `buildMinimalEnv` 白名单，
 *    额外变量进不去（这正是它的设计目的）。路径直接编进源码。
 */
const probePlugin = (dir: string, outsideFile: string) => `
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import cp from 'node:child_process';
import wt from 'node:worker_threads';

const DIR = ${JSON.stringify(dir)};
const OUTSIDE = ${JSON.stringify(outsideFile)};
const results = {};
const probe = (name, fn) => {
  try {
    const v = fn();
    results[name] = { ok: true, value: typeof v === 'string' ? v : undefined };
  } catch (e) {
    results[name] = { ok: false, err: e.code || e.name };
  }
};

export default {
  manifest: { id: 'ext-perm-probe', name: 'Perm Probe', version: '1.0.0', main: 'index.js' },
  async activate(ctx) {
    // ── 应当被**拒绝**的 ──
    // 读插件目录之外的真实文件。不用 /etc/hostname：Windows 上该路径不存在，
    // off 策略会得到 ENOENT，反向对照就分不清「探针路径写错」和「权限没拦住」。
    probe('readOutside', () => fs.readFileSync(OUTSIDE, 'utf8'));
    probe('readHostPackageJson', () => fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    probe('eval', () => eval('1+1'));
    probe('newFunction', () => new Function('return 2')());
    probe('spawnChild', () => cp.spawnSync(process.execPath, ['-e', '0']));
    // 从真实文件建 worker：避开代码生成禁令，确保测的是「创建 worker」本身
    probe('createWorker', () => { new wt.Worker(path.join(DIR, 'w.js')); return 'created'; });

    // ── 应当被**放行**的 ──
    probe('readOwnDir', () => fs.readFileSync(path.join(DIR, 'seed.txt'), 'utf8'));
    probe('writeOwnDir', () => {
      fs.writeFileSync(path.join(DIR, 'probe-out.txt'), 'ok');
      return 'wrote';
    });
    probe('requireSharedModule', () => {
      const u = ctx.require('uuid');
      return typeof u === 'function' || typeof u === 'object' ? 'resolved' : 'unexpected';
    });

    // ── 出网管控（Issue #237 收口）──
    // 只判断「建连动作是否被同步拒绝」。真实连接成败是异步的，与权限无关。
    // 原先这里经 process.getBuiltinModule 取 net —— 那是绕过 ctx.require
    // 名单的官方后门，现已列入 process-masking 屏蔽名单；探针改走与普通
    // 插件代码相同的静态 import 通道。
    probe('netConnect', () => {
      const sock = net.connect(9, '127.0.0.1');
      sock.on('error', () => {});
      sock.destroy();
      return 'attempted';
    });

    fs.writeFileSync(path.join(DIR, 'probes.json'), JSON.stringify(results, null, 2));
    return 'probed';
  },
  async deactivate() {},
};
`;

interface ProbeResult {
  ok: boolean;
  value?: string;
  err?: string;
}

/**
 * 在真实子进程里跑一段插件源码。
 *
 * 不回传结果 —— 结果由插件自己写文件（或抛错）。这样 `runProbes` 才能在
 * `ro` 策略下复用同一个通道：`ro` 禁止一切写，**用写文件回传结果本身就是错的**。
 */
async function runPlugin(
  pluginSrc: string,
  policy: string,
  dir: string,
  isolateKind: 'process' | 'thread' = 'process',
): Promise<void> {
  const prev = process.env.OPENLEARN_PLUGIN_PERMISSION;
  process.env.OPENLEARN_PLUGIN_PERMISSION = policy;

  const db = makeDb();
  const wm = new WorkerManager(new ServiceRegistry(), new CapabilityGuard(), db);
  try {
    await wm.createWorker(
      'ext-perm-probe',
      { id: 'ext-perm-probe', name: 'Perm Probe', version: '1.0.0', main: 'index.js' } as never,
      pluginSrc,
      [],
      undefined,
      dir,
      undefined,
      { isolateKind },
    );
  } finally {
    wm.livenessMonitor.stop();
    await wm.shutdownAll().catch(() => {});
    db.close();
    if (prev === undefined) delete process.env.OPENLEARN_PLUGIN_PERMISSION;
    else process.env.OPENLEARN_PLUGIN_PERMISSION = prev;
  }
}

/** 建一个含 seed.txt 与 w.js 的临时插件目录 */
function makePluginDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlearn-perm-'));
  fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
  // worker 探针要用**真实文件**建 worker（不能用 eval，否则撞代码生成禁令）
  fs.writeFileSync(path.join(dir, 'w.js'), 'export {};\n');
  return dir;
}

/**
 * 插件目录的同级文件：off 下必须能读到，rw 下必须被权限模型拒绝。
 * 放在 tmp 根下而不是 pluginDir 里面，才落在 --allow-fs-read=<pluginDir>/* 之外。
 */
function makeOutsideFile(): string {
  const file = path.join(
    os.tmpdir(),
    `openlearn-perm-outside-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`,
  );
  fs.writeFileSync(file, 'outside-sandbox');
  return file;
}

/** 跑一遍探针插件，返回沙箱内部记录的能力尝试结果 */
async function runProbes(policy: string | undefined): Promise<Record<string, ProbeResult>> {
  const dir = makePluginDir();
  const outsideFile = makeOutsideFile();
  try {
    await runPlugin(probePlugin(dir, outsideFile), policy ?? DEFAULT_PERMISSION_POLICY, dir);
    return JSON.parse(fs.readFileSync(path.join(dir, 'probes.json'), 'utf8')) as Record<string, ProbeResult>;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outsideFile, { force: true });
  }
}

/**
 * 「先读后写」插件：读 pluginDir 必须成功，随后写 pluginDir。
 *
 * 单独拿它做 **ro 与 rw 的差分** —— 因为两个策略下唯一不同的就是写权限，
 * 所以「rw 成功 / ro 抛 ERR_ACCESS_DENIED」这一对不可能由别的原因造成。
 */
const readWritePlugin = (dir: string) => `
import fs from 'node:fs';
import path from 'node:path';
const DIR = ${JSON.stringify(dir)};
export default {
  manifest: { id: 'ext-perm-rw', name: 'RW Probe', version: '1.0.0', main: 'index.js' },
  async activate() {
    // 先读：成功说明 ro 并没有把读也一起禁掉
    fs.readFileSync(path.join(DIR, 'seed.txt'), 'utf8');
    // 后写：ro 下到这一步抛 ERR_ACCESS_DENIED
    fs.writeFileSync(path.join(DIR, 'written.txt'), 'ok');
    return 'wrote';
  },
  async deactivate() {},
};
`;

/** 探针插件加载后必须留下的文件 —— 否则说明插件压根没跑起来，断言全无意义 */
const ALL_PROBE_KEYS = [
  'readOutside',
  'readHostPackageJson',
  'eval',
  'newFunction',
  'spawnChild',
  'createWorker',
  'readOwnDir',
  'writeOwnDir',
  'requireSharedModule',
  'netConnect',
] as const;

describe('L-1 P2 · 权限旗标构造', () => {
  it('rw：启用权限模型、禁代码生成、放行 pluginDir 与共享依赖的读 + pluginDir 的写', () => {
    const args = buildPermissionArgs({ policy: 'rw', pluginDir: '/plug', rootPath: '/repo' });
    expect(args).toContain('--permission');
    expect(args).toContain('--disallow-code-generation-from-strings');
    expect(args).toContain('--allow-fs-read=/plug/*');
    expect(args).toContain('--allow-fs-write=/plug/*');
    expect(args).toContain('--allow-fs-read=/repo/node_modules/*');
  });

  it('ro 不给写权限（rw 唯一的区别）', () => {
    const ro = buildPermissionArgs({ policy: 'ro', pluginDir: '/plug', rootPath: '/repo' });
    const rw = buildPermissionArgs({ policy: 'rw', pluginDir: '/plug', rootPath: '/repo' });
    expect(ro.filter((a) => a.startsWith('--allow-fs-write'))).toEqual([]);
    expect(rw.filter((a) => a.startsWith('--allow-fs-write')).length).toBe(1);
  });

  it('⚠️ 任何策略下都不加 --allow-child-process / --allow-worker', () => {
    // 这两个旗标会让插件拉起**不受权限模型约束**的新执行单元 ——
    // 加上就等于沙箱失效。故只要 permission 开着就一律不给。
    for (const policy of PERMISSION_POLICIES.filter((p) => p !== 'off')) {
      const args = buildPermissionArgs({ policy, pluginDir: '/plug', rootPath: '/repo' });
      expect(args, `策略 ${policy} 不该放行子进程`).not.toContain('--allow-child-process');
      expect(args, `策略 ${policy} 不该放行 worker`).not.toContain('--allow-worker');
    }
  });

  it('off：一个旗标都不给（逃生舱）', () => {
    expect(buildPermissionArgs({ policy: 'off', pluginDir: '/plug', rootPath: '/repo' })).toEqual([]);
  });

  it('额外只读路径（宿主提供的 plugin-sdk 链接目录）按目录与子树放行，且只读', () => {
    const args = buildPermissionArgs({
      policy: 'rw',
      pluginDir: '/data/plugins/uuid-1',
      rootPath: '/repo',
      sharedReadPaths: ['/data/plugins/node_modules', '/repo/packages/plugin-sdk'],
    });
    expect(args).toContain('--allow-fs-read=/data/plugins/node_modules');
    expect(args).toContain('--allow-fs-read=/data/plugins/node_modules/*');
    expect(args).toContain('--allow-fs-read=/repo/packages/plugin-sdk/*');
    // 只读：不能因为这些路径是「宿主的」就顺带给出写权限
    expect(args.filter((a) => a.startsWith('--allow-fs-write='))).toEqual(['--allow-fs-write=/data/plugins/uuid-1/*']);
  });

  it('反斜杠路径归一为正斜杠（Node 通配符不认反斜杠）', () => {
    const args = buildPermissionArgs({ policy: 'rw', pluginDir: 'C:\\plug\\', rootPath: 'C:\\repo' });
    expect(args).toContain('--allow-fs-read=C:/plug/*');
    expect(args).toContain('--allow-fs-read=C:/repo/node_modules/*');
  });

  it('未知取值落到默认策略而非 off —— off 是权限最宽的那个，不能是拼错的落点', () => {
    for (const bad of ['false', '0', 'no', 'RW-ONLY', '', undefined, null, 42]) {
      expect(normalizePermissionPolicy(bad), `${String(bad)} 不该解析成 off`).toBe(DEFAULT_PERMISSION_POLICY);
    }
    expect(normalizePermissionPolicy('rw')).toBe('rw');
    expect(normalizePermissionPolicy(' RO ')).toBe('ro');
    expect(normalizePermissionPolicy('off')).toBe('off');
  });

  it('诊断文本写明出站网络默认拒绝', () => {
    expect(describePermissionPolicy({ policy: 'rw' })).toContain('出站 socket/DNS 默认拒绝');
  });
});

describe('L-1 P2 · 真实子进程中的能力收敛', () => {
  beforeEach(() => {
    // 子进程由 isolateKind 显式指定，此处不依赖全局 env
  });
  afterEach(() => {
    delete process.env.OPENLEARN_PLUGIN_PERMISSION;
  });

  it('rw 策略下：敏感能力被拒，自身目录与共享依赖被放行', async () => {
    const r = await runProbes('rw');

    // 探针必须全部执行到，否则下面的拒绝断言没有意义
    expect(Object.keys(r).sort()).toEqual([...ALL_PROBE_KEYS].sort());

    // 被拒：越界读文件
    expect(r.readOutside, '读插件目录之外的文件应被拒').toMatchObject({ ok: false, err: 'ERR_ACCESS_DENIED' });
    expect(r.readHostPackageJson, '读宿主 package.json 应被拒').toMatchObject({
      ok: false,
      err: 'ERR_ACCESS_DENIED',
    });

    // 被拒：代码生成（EvalError，不是 ERR_ACCESS_DENIED —— 来自另一个旗标）
    expect(r.eval, 'eval 应被禁').toMatchObject({ ok: false, err: 'EvalError' });
    expect(r.newFunction, 'new Function 应被禁').toMatchObject({ ok: false, err: 'EvalError' });

    // 被拒：拉子进程 / 建 worker
    expect(r.spawnChild, 'spawn 子进程应被拒').toMatchObject({ ok: false, err: 'ERR_ACCESS_DENIED' });
    expect(r.createWorker, '创建 worker 应被拒').toMatchObject({ ok: false, err: 'ERR_ACCESS_DENIED' });

    // 放行：自己的目录
    expect(r.readOwnDir).toMatchObject({ ok: true });
    expect(r.writeOwnDir).toMatchObject({ ok: true });

    // 放行：ctx.require 共享模块（这条验证 node_modules 读权限的必要性）
    expect(r.requireSharedModule, "ctx.require('uuid') 应放行 —— 否则插件作者的共享依赖在权限模式下全废").toMatchObject(
      { ok: true },
    );
  }, 60_000);

  it('ro 与 rw 的差分：同一个「先读后写」插件，rw 成功、ro 在写处被拒', async () => {
    // 不能用「ro 下探针全跑完再读结果文件」来验证 —— ro 禁一切写，
    // 连结果文件都写不出来，通道本身就断了。故改为差分：唯一变量是策略。
    const rwDir = makePluginDir();
    await runPlugin(readWritePlugin(rwDir), 'rw', rwDir);
    expect(fs.existsSync(path.join(rwDir, 'written.txt')), 'rw 策略应写成功').toBe(true);
    fs.rmSync(rwDir, { recursive: true, force: true });

    const roDir = makePluginDir();
    try {
      // Node 的权限拒绝文案是 "Access to this API has been restricted. Use --allow-fs-write …"，
      // 错误码（ERR_ACCESS_DENIED）只出现在 e.code 里，不会被带进异常 message，
      // 所以这里匹配文案而非码。
      await expect(runPlugin(readWritePlugin(roDir), 'ro', roDir)).rejects.toThrow(
        /Access to this API has been restricted/,
      );
      expect(fs.existsSync(path.join(roDir, 'written.txt')), 'ro 策略不应写出文件').toBe(false);
    } finally {
      fs.rmSync(roDir, { recursive: true, force: true });
    }
  }, 90_000);

  it('反向对照：off 策略下同一组探针全部成功（证明探针为真）', async () => {
    const r = await runProbes('off');

    // 若这条红了，说明上面 rw 的「拒绝」断言可能只是探针写错了。
    const failures = Object.entries(r)
      .filter(([k, v]) => !v.ok && k !== 'createWorker')
      .map(([k, v]) => `${k}: ${v.err}`);
    expect(
      failures,
      `off 策略下这些探针本该全部成功。若失败，说明探针本身有问题，` +
        `那么 rw 下的「被拒」就可能是假阳性：${failures.join(', ')}`,
    ).toEqual([]);

    // 越界读与代码生成在 off 下确实可用 —— 这正是 rw 拦掉的东西
    expect(r.readOutside).toMatchObject({ ok: true });
    expect(r.eval).toMatchObject({ ok: true });
    expect(r.spawnChild).toMatchObject({ ok: true });
  }, 60_000);

  it('rw 策略下原始 socket 被入口脚本拒绝', async () => {
    const r = await runProbes('rw');
    expect(r.netConnect).toMatchObject({ ok: false, err: 'ERR_ACCESS_DENIED' });
  }, 60_000);
});

/**
 * Issue #237：worker 模式出网守卫回归。
 *
 * 此前 worker（worker_threads）隔离档位既没有子进程模式的 net preload，
 * 也没有屏蔽 process.getBuiltinModule —— 受信任插件在 worker 模式下可
 * 任意出网。收口后三道断言：
 *   1. getBuiltinModule 被屏蔽（低层原生绕过入口，与 dlopen/binding 同列）
 *   2. 原始 socket 建连被拒（bootstrap 内 net-guard section）
 *   3. fetch 到未批准域名被拒（approvedNetHosts 名单来自宿主授权）
 */
describe('Issue #237 · worker 模式出网守卫', () => {
  const workerGuardPlugin = (dir: string) => `
import fs from 'node:fs';
import net from 'node:net';
const DIR = ${JSON.stringify(dir)};
export default {
  manifest: { id: 'ext-perm-worker-guard', name: 'Worker Guard Probe', version: '1.0.0', main: 'index.js' },
  async activate() {
    const results = {};
    const probe = (name, fn) => {
      try {
        results[name] = { ok: true, value: fn() };
      } catch (e) {
        results[name] = { ok: false, err: e.code || e.name };
      }
    };

    probe('builtinModule', () => process.getBuiltinModule('node:fs'));
    probe('netConnect', () => {
      const sock = net.connect(9, '127.0.0.1');
      sock.on('error', () => {});
      sock.destroy();
      return 'attempted';
    });
    // 异步探针：未批准域名的 fetch 必须被守卫同步口径拒绝（不触网）
    results.fetchUnapproved = await fetch('https://unapproved.example.invalid/path').then(
      () => ({ ok: true, value: 'allowed' }),
      (e) => ({ ok: false, err: e.code || e.name }),
    );

    fs.writeFileSync(DIR + '/guard-probes.json', JSON.stringify(results, null, 2));
    return 'probed';
  },
  async deactivate() {},
};
`;

  it('getBuiltinModule 屏蔽 + 原始 socket 拒绝 + 未批准 fetch 拒绝', async () => {
    const dir = makePluginDir();
    try {
      await runPlugin(workerGuardPlugin(dir), DEFAULT_PERMISSION_POLICY, dir, 'thread');
      const results = JSON.parse(fs.readFileSync(path.join(dir, 'guard-probes.json'), 'utf8')) as Record<
        string,
        ProbeResult
      >;
      expect(results.builtinModule).toMatchObject({ ok: false, err: 'Error' });
      expect(results.netConnect).toMatchObject({ ok: false, err: 'ERR_ACCESS_DENIED' });
      expect(results.fetchUnapproved).toMatchObject({ ok: false, err: 'ERR_ACCESS_DENIED' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
