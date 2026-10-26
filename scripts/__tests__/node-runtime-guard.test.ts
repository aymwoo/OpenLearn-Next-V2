/**
 * Node 运行时守卫自检（安装期 `preinstall` + 启动期 `runtime-preflight`）。
 *
 * ## 这组测试真正在守什么
 *
 * 守卫本身只有几十行，但它撑着一个**跨文件的硬约定**：Node 的「受支持范围」
 * 同时写在 6 个地方 —— `package.json` 的 `engines`、`scripts/assert-node-runtime.mjs`
 * 的 `SUPPORTED_NODE_MAJORS`、`.nvmrc` / `.node-version`、Dockerfile、README 徽章、
 * 安装指南。只要其中一处漂移，就会出现「文档说支持 20，守卫拦掉 20」或者
 * 「engines 放行 Node 26，运行时炸 ERR_DLOPEN_FAILED」这类**静默失配** ——
 * 失配不会让任何单测变红，只会让客户机上的某个人在某个下午崩溃。
 *
 * 所以这里既有**行为断言**（版本判定、ABI 报错翻译），也有**口径断言**
 * （各处声明必须一致）。后者是这组测试的主要价值。
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import {
  SUPPORTED_NODE_MAJORS,
  SUPPORTED_NODE_TEXT,
  PINNED_NODE_MAJOR,
  parseNodeMajor,
  checkNodeVersion,
  buildFixGuidance,
  formatUnsupportedMessage,
} from '../assert-node-runtime.mjs';
import {
  detectNativeModuleFailure,
  checkNativeModule,
  checkRuntimeEnvironment,
  loadBetterSqlite3Binding,
} from '../../server/security/runtime-check';
import { checkCliNodeRuntime } from '../../cli.mjs';

const ROOT = process.cwd();
const PKG = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

describe('Node 版本判定（安装期守卫的纯函数）', () => {
  it('能解析主版本号，且容忍 v 前缀 / 缺前缀 / 非法输入', () => {
    expect(parseNodeMajor('v22.16.0')).toBe(22);
    expect(parseNodeMajor('22.16.0')).toBe(22);
    expect(parseNodeMajor('v20.0.0')).toBe(20);
    expect(parseNodeMajor('  v24.1.0  ')).toBe(24);
    expect(parseNodeMajor('not-a-version')).toBeNull();
    expect(parseNodeMajor('')).toBeNull();
    expect(parseNodeMajor(undefined as unknown as string)).toBeNull();
  });

  it('受支持范围恰好是 20 / 22 / 24', () => {
    expect([...SUPPORTED_NODE_MAJORS]).toEqual([20, 22, 24]);
    expect(SUPPORTED_NODE_TEXT).toContain('20.x');
    expect(SUPPORTED_NODE_TEXT).toContain('22.x');
    expect(SUPPORTED_NODE_TEXT).toContain('24.x');
  });

  it('受支持版本放行', () => {
    for (const major of SUPPORTED_NODE_MAJORS) {
      const result = checkNodeVersion(`v${major}.1.0`);
      expect(result.ok, `v${major}.1.0 应被放行`).toBe(true);
      expect(result.code).toBe('supported');
      expect(result.major).toBe(major);
    }
  });

  it('非 LTS 奇数版本与未验证的新版本一律拦下', () => {
    // 21 / 23：非 LTS，且 better-sqlite3 官方 engines 不含 21.x（无预编译产物）。
    // 25 / 26：未验证；实测 Node 26 复用 Node 22 装的 node_modules 直接 ERR_DLOPEN_FAILED。
    for (const major of [19, 21, 23, 25, 26, 27]) {
      const result = checkNodeVersion(`v${major}.0.0`);
      expect(result.ok, `v${major}.0.0 应被拦下`).toBe(false);
      expect(result.code).toBe('unsupported');
      expect(result.major).toBe(major);
      expect(result.message).toContain('不受支持');
    }
  });

  it('版本串解析不出来时也判为不通过（不因为「看不懂」就放行）', () => {
    const result = checkNodeVersion('banana');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('unparseable');
    expect(result.major).toBeNull();
  });

  it('修复指引给出可执行命令，而不是一句「版本不支持」', () => {
    const guidance = buildFixGuidance(26);
    expect(guidance).toContain(`nvm install ${PINNED_NODE_MAJOR}`);
    expect(guidance).toContain(`fnm install ${PINNED_NODE_MAJOR}`);
    expect(guidance).toContain('rm -rf node_modules');
    expect(guidance).toContain('docker compose up -d');
  });

  it('Node 21 额外提示「不是 LTS 且无官方预编译产物」', () => {
    expect(buildFixGuidance(21)).toContain('不是 LTS');
    expect(buildFixGuidance(22)).not.toContain('不是 LTS');
  });

  it('失败文案同时含结论与指引；受支持版本不产出文案', () => {
    const message = formatUnsupportedMessage('v26.0.0');
    expect(message).toContain('[NodeRuntime] FATAL');
    expect(message).toContain('不受支持');
    expect(message).toContain('怎么修');
    expect(formatUnsupportedMessage('v22.16.0')).toBe('');
  });
});

describe('启动期守卫：原生模块 ABI 失配翻译成可执行指引', () => {
  it('识别 better-sqlite3 的 NODE_MODULE_VERSION 失配', () => {
    const failure = detectNativeModuleFailure(
      new Error(
        "The module '/app/node_modules/better-sqlite3/build/Release/better_sqlite3.node' " +
          'was compiled against a different Node.js version using NODE_MODULE_VERSION 127. ' +
          'This version of Node.js requires NODE_MODULE_VERSION 137.',
      ),
    );
    expect(failure.kind).toBe('abi-mismatch');
    expect(failure.moduleAbi).toBe(127);
    expect(failure.runtimeAbi).toBe(Number(process.versions.modules));
  });

  it('识别「bindings 文件不存在」（依赖没装 / 没编译）', () => {
    const failure = detectNativeModuleFailure(
      new Error('Could not locate the bindings file. Tried: build/better_sqlite3.node'),
    );
    expect(failure.kind).toBe('missing-bindings');
    expect(failure.moduleAbi).toBeNull();
  });

  it('无法归类的加载失败落到 unknown，而不是硬套某个结论', () => {
    const failure = detectNativeModuleFailure(new Error('something else entirely'));
    expect(failure.kind).toBe('unknown');
  });

  it('ABI 失配时报错里带 ABI 数字与重建指引', () => {
    const issue = checkNativeModule(() => {
      throw new Error(
        'was compiled against a different Node.js version using NODE_MODULE_VERSION 127. ' +
          'This version of Node.js requires NODE_MODULE_VERSION 137.',
      );
    });
    expect(issue).not.toBeNull();
    expect(issue?.key).toBe('native-module-abi');
    expect(issue?.severity).toBe('error');
    expect(issue?.message).toContain('127');
    expect(issue?.message).toContain('rm -rf node_modules');
  });

  it('原生模块能加载时不产生 issue', () => {
    expect(checkNativeModule(() => undefined)).toBeNull();
  });

  it('探针必须**构造**内存库，而不只是 require —— 更好的-sqlite3 v12 是懒加载绑定', () => {
    // 回归防线：better-sqlite3 v12 在 `lib/database.js` 的构造函数里才
    // `require('bindings')('better_sqlite3.node')`，`require('better-sqlite3')`
    // 本身**永远成功**。只 require 的探针探不到 ABI 失配 —— 守卫形同虚设，
    // 客户仍会在第一次开库时撞上原始 ERR_DLOPEN_FAILED。
    let constructed = false;
    class FakeDatabase {
      constructor() {
        constructed = true;
      }
      close() {
        /* noop */
      }
    }
    loadBetterSqlite3Binding(() => FakeDatabase);
    expect(constructed, '探针没有构造数据库 —— 懒加载的原生绑定根本没被触发').toBe(true);
  });

  it('探针构造失败时把原始异常抛出来（交给 detectNativeModuleFailure 归类）', () => {
    class BrokenDatabase {
      constructor() {
        throw new Error(
          'was compiled against a different Node.js version using NODE_MODULE_VERSION 127. ' +
            'This version of Node.js requires NODE_MODULE_VERSION 137.',
        );
      }
    }
    expect(() => loadBetterSqlite3Binding(() => BrokenDatabase)).toThrow(/NODE_MODULE_VERSION/);
  });

  it('真实运行时上探针能成功构造内存库', () => {
    expect(() => loadBetterSqlite3Binding()).not.toThrow();
  });

  it('版本不受支持时直接报错，且不再重复报原生模块（避免两段指引互相打架）', () => {
    let nativeLoaderCalled = false;
    const result = checkRuntimeEnvironment({
      nodeVersion: 'v26.0.0',
      loadNativeModule: () => {
        nativeLoaderCalled = true;
      },
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].key).toBe('node-version');
    expect(result.errors[0].message).toContain('怎么修');
    expect(nativeLoaderCalled, '版本都不对时不该再去加载原生模块').toBe(false);
  });

  it('版本受支持但原生模块加载失败时报 native-module-* 错误', () => {
    const result = checkRuntimeEnvironment({
      nodeVersion: 'v22.16.0',
      loadNativeModule: () => {
        throw new Error('boom');
      },
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].key).toBe('native-module-load');
  });

  it('版本受支持且原生模块正常时没有 error', () => {
    const result = checkRuntimeEnvironment({
      nodeVersion: 'v22.16.0',
      loadNativeModule: () => undefined,
    });
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});

describe('Node 支持范围的口径一致性（漂了就红）', () => {
  it('package.json 的 engines.node 与守卫的受支持列表一致', () => {
    expect(PKG.engines.node).toBe('20.x || 22.x || 24.x');
    // engines 里的每个主版本都必须在守卫列表里，反之亦然。
    const majors = PKG.engines.node.split('||').map((part: string) => Number(part.trim().split('.')[0]));
    expect(majors.sort((a: number, b: number) => a - b)).toEqual([...SUPPORTED_NODE_MAJORS]);
  });

  it('preinstall 钩子指向守卫脚本（安装期硬闸）', () => {
    expect(PKG.scripts.preinstall).toBe('node scripts/assert-node-runtime.mjs');
  });

  it('守卫脚本被打进发布包（否则客户机上的 preinstall 会找不到文件）', () => {
    expect(PKG.files).toContain('scripts/assert-node-runtime.mjs');
  });

  it('.nvmrc / .node-version 与仓库钉住的主版本一致', () => {
    expect(readFileSync(path.join(ROOT, '.nvmrc'), 'utf8').trim()).toBe(String(PINNED_NODE_MAJOR));
    expect(readFileSync(path.join(ROOT, '.node-version'), 'utf8').trim()).toBe(String(PINNED_NODE_MAJOR));
  });

  it('Dockerfile 用的是同一个 Node 主版本', () => {
    const dockerfile = readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
    expect(dockerfile).toContain(`node:${PINNED_NODE_MAJOR}-alpine`);
  });

  it('README 徽章与安装指南不再宣称「>=20」这种无上限写法', () => {
    const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    const guide = readFileSync(path.join(ROOT, 'docs', 'getting-started', 'installation-guide.md'), 'utf8');
    expect(readme).not.toContain('Node-%3E%3D20');
    expect(guide).not.toContain('≥ 20.x');

    // 徽章行单独取出来断言：徽章的 URL 是百分号编码的，
    // 直接在整篇 README 里搜「Node-22」会因为编码而漏判。
    const badge = readme.split('\n').find((line: string) => line.includes('img.shields.io/badge/Node-')) ?? '';
    expect(badge, 'README 里应保留 Node 版本徽章').not.toBe('');
    for (const major of SUPPORTED_NODE_MAJORS) {
      expect(badge, `README 徽章应体现 Node ${major}.x`).toContain(`${major}.x`);
      expect(guide, `安装指南应体现 Node ${major}.x`).toContain(`${major}.x`);
    }
  });

  it('CI 里有 Node 版本矩阵 job，且覆盖全部受支持版本', () => {
    const ci = readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(ci).toContain('node-runtime-compat');
    expect(ci).toContain('assert-node-runtime.mjs');
    const matrix = /node-version:\s*\[([^\]]+)\]/.exec(ci);
    expect(matrix, 'CI 里应能找到 Node 版本矩阵定义').not.toBeNull();
    const majors = (matrix?.[1] ?? '')
      .split(',')
      .map((part: string) => Number(part.trim()))
      .sort((a: number, b: number) => a - b);
    expect(majors).toEqual([...SUPPORTED_NODE_MAJORS]);
  });

  it('CLI 入口接上了守卫，且只读诊断命令放行', () => {
    const cli = readFileSync(path.join(ROOT, 'cli.mjs'), 'utf8');
    expect(cli).toContain('assert-node-runtime.mjs');
    expect(cli).toContain('checkCliNodeRuntime');
    expect(cli).toContain('doctor');
  });

  it('doctor 的 Node 版本检查与守卫同源（此前独立写死「>= 20.0.0」，会与守卫打架）', () => {
    const doctor = readFileSync(path.join(ROOT, 'cli-doctor.mjs'), 'utf8');
    expect(doctor).toContain('assert-node-runtime.mjs');
    expect(doctor).toContain('checkNodeVersion');
    expect(doctor).not.toContain('>= 20.0.0');
  });

  it('守卫脚本文件确实存在（路径写错时上面所有断言都会是假阳性）', () => {
    expect(existsSync(path.join(ROOT, 'scripts', 'assert-node-runtime.mjs'))).toBe(true);
    expect(existsSync(path.join(ROOT, 'server', 'security', 'runtime-preflight.ts'))).toBe(true);
  });
});

describe('CLI 入口守卫：放行诊断命令、拦住会动数据的命令', () => {
  const UNSUPPORTED = 'v26.0.0';

  it('版本受支持时一律放行', () => {
    expect(checkCliNodeRuntime('backup', {}, 'v22.16.0')).toBe(true);
    expect(checkCliNodeRuntime('restore', {}, 'v20.19.0')).toBe(true);
  });

  it('版本不受支持时，非诊断类命令被拒绝（退出码 1）', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('__EXIT__');
    }) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(() => checkCliNodeRuntime('backup', {}, UNSUPPORTED)).toThrow('__EXIT__');
      expect(exitSpy).toHaveBeenCalledWith(1);
      const printed = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(printed).toContain('[NodeRuntime] FATAL');
      expect(printed).toContain('不受支持');
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('版本不受支持时，只读诊断命令仍然放行（客户最需要它们能跑）', () => {
    for (const command of ['doctor', 'compat-report', 'check-update']) {
      expect(checkCliNodeRuntime(command, {}, UNSUPPORTED)).toBe(true);
    }
  });

  it('--version / --help 在版本不受支持时也放行', () => {
    expect(checkCliNodeRuntime('', { version: true }, UNSUPPORTED)).toBe(true);
    expect(checkCliNodeRuntime('', { help: true }, UNSUPPORTED)).toBe(true);
  });
});
