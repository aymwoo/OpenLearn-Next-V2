/**
 * H-4 回归测试：插件依赖安装（H-4 / 原始编号 L-3）。
 *
 * ## 覆盖的三个缺陷
 *
 * **① 硬编码 `registry.npmmirror.com`**
 * 强制所有部署（含境外服务器）走同一家镜像；供应链信任面被静默固定到第三方域名；
 * 私有 registry 的部署者无法覆盖，只能改代码。
 *
 * **② 安装失败被吞掉，插件仍进入 ACTIVE**
 * 原实现两条路径都是 `catch { console.error(...) }` 然后继续往下跑 ——
 * 部署脚本、贡献注册、DB 落库、状态机全都执行完，插件是 ACTIVE 的，
 * 只是 `node_modules` 残缺。故障延迟到「插件运行时 MODULE_NOT_FOUND」才暴露。
 *
 * **③ 更新路径漏 `--ignore-scripts`**
 * 安装路径有（SEC-RCE-01，防 postinstall 钩子），更新路径没有。
 * 于是「装一次安全、从市场更新一次就能跑 postinstall」，而更新是第三方插件
 * 最常见的安装途径。**这个不一致本身就是漏洞。**
 *
 * ## 测试策略
 *
 * **行为层**：把 npm 执行器注入进 `installPluginDependencies()`，断言最终
 * **真正传给 npm 的参数数组**。
 *
 * 初版这里用 `vi.mock('node:child_process')`，结果 mock **未生效**：
 * 参数数组读到空数组，而断言「不含 --registry」恰好也能通过 —— 又一次空转。
 * 根因是本仓库 `pool: 'forks'` 下对 `node:` 内置模块的拦截不可靠。
 * 改为依赖注入后完全确定：记录器一定会被调用，调用次数与参数都可断言。
 *
 * **结构层**：从真实源码切出两处 `installPluginDependencies()` 调用点并断言其形态。
 * 刻意不用「各写一份期望副本」—— 副本会随源码演进而失真，正是本轮反复踩到的坑
 * （漂移分析器假阳性、断言测错对象、辅助函数静默返回空值）。
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DependencyInstallError,
  parsePluginDependencies,
  toNpmDependencyMap,
  assertDependenciesResolved,
  installPluginDependencies,
} from '../dependency-install.js';

// L-2 阶段 2：PluginHost 已拆成抽象类继承链，安装/更新的依赖安装调用点在 install.ts。
const SRC = fs.readFileSync(path.resolve(process.cwd(), 'packages/core/plugin-host/install.ts'), 'utf-8');
const REGISTRY_ENV = 'OPENLEARN_PLUGINS_NPM_REGISTRY';

afterEach(() => {
  delete process.env[REGISTRY_ENV];
});

/**
 * 触发一次真实的 `installPluginDependencies`，mock 掉 npm 执行。
 *
 * 预先造好 lockfile：mock 掉的 execFileSync 不会真的跑 npm，
 * 若不预置，lockfile 校验会抛错并把「看参数」的测试意图掩盖掉。
 */
function runInstall(dependencies: Record<string, string>, pluginId = 'ext-args'): { calls: number; args: string[] } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlearn-h4-args-'));
  fs.writeFileSync(
    path.join(dir, 'package-lock.json'),
    JSON.stringify({
      lockfileVersion: 3,
      packages: { '': {}, 'node_modules/cookie': { name: 'cookie', version: '0.5.0' } },
    }),
    'utf-8',
  );
  let calls = 0;
  let args: string[] = [];
  try {
    installPluginDependencies(dir, { pluginId, dependencies }, (_cmd, a) => {
      calls++;
      args = a;
      return Buffer.from('');
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return { calls, args };
}

/** 建临时插件目录，内含指定 lockfile 内容 */
function makeDirWithLock(lock: string | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlearn-h4-'));
  if (lock !== null) fs.writeFileSync(path.join(dir, 'package-lock.json'), lock, 'utf-8');
  return dir;
}

describe('H-4 · npm 参数：不硬编码 registry，且两条路径都带 --ignore-scripts', () => {
  it('源码中不再出现硬编码的 npmmirror registry', () => {
    const offenders = SRC.split('\n')
      .map((l, i) => [i + 1, l] as const)
      .filter(([, l]) => /registry\.npmmirror\.com/.test(l));
    expect(
      offenders.map(([ln, l]) => `index.ts:${ln}: ${l.trim()}`),
      '发现硬编码 registry —— 应改为环境变量 OPENLEARN_PLUGINS_NPM_REGISTRY，默认走 npm 自身配置',
    ).toEqual([]);
  });

  it('默认不传 --registry（用 npm 自身配置与环境）', () => {
    delete process.env[REGISTRY_ENV];
    const { calls, args } = runInstall({ cookie: '^0.5.0' });
    expect(calls, 'npm 未被执行 —— 本条断言将空转').toBe(1);
    expect(
      args.filter((a) => a.startsWith('--registry')),
      '默认不应带 --registry',
    ).toEqual([]);
  });

  it('设置 OPENLEARN_PLUGINS_NPM_REGISTRY 时才传 --registry（支持私有源/内网源）', () => {
    process.env[REGISTRY_ENV] = 'https://registry.internal.corp';
    const { calls, args } = runInstall({ cookie: '^0.5.0' });
    expect(calls, 'npm 未被执行').toBe(1);
    expect(args).toContain('--registry=https://registry.internal.corp');
  });

  it('环境变量为空白串时视为未设置（不传 --registry）', () => {
    process.env[REGISTRY_ENV] = '   ';
    const { calls, args } = runInstall({ cookie: '^0.5.0' });
    expect(calls, 'npm 未被执行').toBe(1);
    expect(args.filter((a) => a.startsWith('--registry'))).toEqual([]);
  });

  it('SEC-RCE-01：npm 参数必带 --ignore-scripts', () => {
    const { calls, args } = runInstall({ cookie: '^0.5.0' });
    expect(calls, 'npm 未被执行 —— 本条断言将空转').toBe(1);
    expect(args, '--ignore-scripts 缺失 —— 恶意包的 postinstall 钩子可执行任意命令').toContain('--ignore-scripts');
  });

  it('不再有内联的 npm 字符串命令（npm 走 execFileSync 的参数数组，避免命令注入面）', () => {
    // 刻意只筛 npm 相关行：plugin-host 里还有一处 execSync 是 **deploy 脚本**
    // （index.ts:2266，`node "${deployScriptPath}"`），属 SEC-RCE-02 的门控范围，
    // 与 H-4 无关。初版这条断言写得过宽（只筛 execSync），把它也抓了进来。
    const offenders = SRC.split('\n')
      .map((l, i) => [i + 1, l] as const)
      .filter(([, l]) => /execSync\(|execFileSync\(/.test(l) && /npm|install/.test(l));
    expect(
      offenders.map(([ln, l]) => `index.ts:${ln}: ${l.trim()}`),
      'npm 安装应统一走 dependency-install.ts',
    ).toEqual([]);
  });

  it('无依赖声明时不调 npm（省一次子进程启动，也不让无依赖插件依赖 npm 可用）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlearn-h4-nodeps-'));
    try {
      installPluginDependencies(dir, { pluginId: 'ext-none', dependencies: undefined }, () => {
        throw new Error('无依赖时不应执行 npm');
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('H-4 · 安装与更新两条路径共用同一实现', () => {
  /** 从真实源码切出全部 `installPluginDependencies(pluginDir, {` 调用点 */
  function callSites(): string[] {
    const needle = 'installPluginDependencies(pluginDir, {';
    const out: string[] = [];
    let from = 0;
    for (;;) {
      const at = SRC.indexOf(needle, from);
      if (at === -1) break;
      const end = SRC.indexOf('});', at);
      out.push(SRC.slice(at, end + 2));
      from = end + 2;
    }
    return out;
  }

  it('恰有 2 处调用点（安装 + 更新）', () => {
    // 若将来新增第三条路径，这条会提醒同步扩充断言
    expect(callSites().length, '调用点数量变了 —— 请同步扩充本文件的断言').toBe(2);
  });

  it('两处都标注了 operation（install / update），便于日志区分', () => {
    const ops = callSites().map((c) => /operation: '(\w+)'/.exec(c)?.[1]);
    expect(ops.sort(), '两条路径应分别标注 install 与 update').toEqual(['install', 'update']);
  });

  it('两处都经 parsePluginDependencies 运行时窄化（dependencies 类型是 unknown）', () => {
    for (const c of callSites()) {
      expect(c, '不能对 unknown 直接断言 —— 插件作者可能写出 "cookie" 这种字符串').toContain(
        'parsePluginDependencies(manifest.dependencies',
      );
    }
  });

  it('更新路径的 catch 重新抛出（不吞异常）—— 装不上就不能把新版 manifest 写进 DB', () => {
    // 定位更新路径那段 catch。
    //
    // 初版用 `SRC.indexOf('}', at)` 找结尾，而 `at` 指向的是**模板字符串内部**，
    // 于是第一个 `}` 是 `${manifest.id}` 的收尾 —— 切片在 throw 之前就结束了，
    // 断言因此误报。改为取「从 marker 到下一个 catch 块结束」的一整段。
    const marker = 'Failed to install dependencies during update';
    const at = SRC.indexOf(marker);
    expect(at, '未找到更新路径的 catch 文案（源码结构变了？）').toBeGreaterThan(-1);
    // 该 catch 块以 `throw installErr;` + 换行 + `}` 结束，取其后 200 字符足够覆盖
    const window = SRC.slice(at, at + 200);
    expect(
      window,
      '更新路径的 catch 未重新抛出 —— 依赖装不上却继续把新 manifest 写进 DB，会留下「新版已装」的假象',
    ).toMatch(/throw\s+installErr/);
  });
});

describe('H-4 · 依赖声明的运行时窄化', () => {
  it('非法形态抛错，而不是静默产出空依赖集', () => {
    // 字符串：形状本身不被支持。若放过它，Object.keys 会拿到字符索引、
    // 依赖装不上也不报错，故障再次延迟到运行时才暴露。
    expect(() => parsePluginDependencies('cookie', 'ext-x')).toThrow(DependencyInstallError);
    expect(() => parsePluginDependencies(42, 'ext-x')).toThrow(DependencyInstallError);
    expect(() => parsePluginDependencies({ cookie: { major: 0 } }, 'ext-x')).toThrow(/semver/);
    expect(() => parsePluginDependencies(['ok', 123], 'ext-x')).toThrow(DependencyInstallError);
  });

  it('合法形态被接受且归一化正确', () => {
    expect(parsePluginDependencies(undefined, 'x')).toBeUndefined();
    expect(parsePluginDependencies(null, 'x')).toBeUndefined();
    // 对象形态（线上真实形态）：原样透传
    expect(toNpmDependencyMap({ cookie: '^0.5.0' })).toEqual({ cookie: '^0.5.0' });
    // 数组形态
    expect(toNpmDependencyMap(['exceljs@^4.0.0'])).toEqual({ exceljs: '^4.0.0' });
    // scoped 包：'@scope/name@^1' → { '@scope/name': '^1' }（不能把开头的 @ 当范围分隔符）
    expect(toNpmDependencyMap(['@scope/name@^1.0.0'])).toEqual({ '@scope/name': '^1.0.0' });
    // 裸包名 → '*'
    expect(toNpmDependencyMap(['uuid'])).toEqual({ uuid: '*' });
  });
});

describe('H-4 · lockfile 完整性校验', () => {
  it('lockfile v3（packages 形态）全部落盘则通过', () => {
    const dir = makeDirWithLock(
      JSON.stringify({
        lockfileVersion: 3,
        packages: { '': { name: 'p' }, 'node_modules/cookie': { name: 'cookie', version: '0.5.0' } },
      }),
    );
    expect(() => assertDependenciesResolved(dir, { cookie: '^0.5.0' }, 'ext-x')).not.toThrow();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('lockfile v1（dependencies 形态）同样识别', () => {
    const dir = makeDirWithLock(JSON.stringify({ lockfileVersion: 1, dependencies: { cookie: { version: '0.5.0' } } }));
    expect(() => assertDependenciesResolved(dir, { cookie: '^0.5.0' }, 'ext-x')).not.toThrow();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('依赖未落 lockfile → 抛错（npm 退出码 0 不代表装全了）', () => {
    const dir = makeDirWithLock(
      JSON.stringify({
        lockfileVersion: 3,
        packages: { '': { name: 'p' }, 'node_modules/other': { name: 'other', version: '1.0.0' } },
      }),
    );
    expect(() => assertDependenciesResolved(dir, { cookie: '^0.5.0' }, 'ext-x')).toThrow(/未出现在 package-lock\.json/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('lockfile 缺失 → 抛错（不能当成「无依赖」放行）', () => {
    const dir = makeDirWithLock(null);
    expect(() => assertDependenciesResolved(dir, { cookie: '^0.5.0' }, 'ext-x')).toThrow(/未产出 package-lock\.json/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('lockfile 非法 JSON → 抛错（安装结果不可信）', () => {
    const dir = makeDirWithLock('{not json');
    expect(() => assertDependenciesResolved(dir, { cookie: '^0.5.0' }, 'ext-x')).toThrow(/不是合法 JSON/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('无依赖声明时不做校验（不要求 lockfile 存在）', () => {
    const dir = makeDirWithLock(null);
    expect(() => assertDependenciesResolved(dir, undefined, 'ext-x')).not.toThrow();
    expect(() => assertDependenciesResolved(dir, {}, 'ext-x')).not.toThrow();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('报错信息含 pluginId，便于定位是哪个插件', () => {
    const dir = makeDirWithLock(JSON.stringify({ lockfileVersion: 3, packages: {} }));
    try {
      assertDependenciesResolved(dir, { cookie: '^0.5.0' }, 'ext-my-plugin');
      throw new Error('本应抛错但没有');
    } catch (e) {
      expect((e as Error).message).toContain('ext-my-plugin');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
