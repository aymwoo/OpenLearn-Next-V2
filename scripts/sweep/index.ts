#!/usr/bin/env tsx
/**
 * scripts/sweep/index.ts —— 全角色功能巡检 CLI
 *
 * ## 它解决什么问题
 *
 * 「把所有功能点一遍」这件事，手工做是：登录教师 → 逐个菜单点 → 逐个弹窗开 →
 * 退出 → 登录学生 → 再点一遍 → 退出。点漏一个不知道自己漏了，点到一个坏的也说不清坏在哪。
 *
 * 这个工具把这件事变成一条命令：自动登录（API，不碰登录页）、自动遍历所有
 * 导航项与页签、收集运行时错误、截图、出一份可以贴进 issue 的报告。
 *
 * ## 用法
 *
 * ```bash
 * pnpm sweep                    # 起一次性演示库 + 全角色巡检 + 出报告
 * pnpm sweep -- --roles teacher # 只巡检教师端
 * pnpm sweep -- --base-url http://localhost:9000   # 巡检已在跑的服务（不重建演示库）
 * pnpm sweep -- --no-fail       # 即使有错误也返回 0（本地探索用）
 * ```
 *
 * 产物：`artifacts/sweep/report.md`、`artifacts/sweep/report.json`、`artifacts/sweep/screenshots/*.png`
 *
 * @module
 */

import path from 'node:path';
import { SWEEP_ROLES } from './manifest.js';
import { icon, runSweep } from './probe.js';
import { classifyGlobalIssues, collectGlobalSummaries, writeReport } from './report.js';
import { startDemoServer } from './server.js';
import type { SweepRoleId } from './types.js';

interface CliOptions {
  port: number;
  baseUrl?: string;
  outDir: string;
  roles: SweepRoleId[];
  resetDb: boolean;
  failOnError: boolean;
}

/** 打印帮助。 */
function printHelp(): void {
  console.log(`
功能巡检（sweep）—— 自动遍历全部角色的所有视图，收集运行时错误并出报告

用法：
  pnpm sweep [选项]

选项：
  --port <n>          一次性演示服务器端口（默认 9300）
  --base-url <url>   巡检已在运行的服务（给出后不再启动演示服务器，也不重建演示库）
  --out <dir>        产物目录（默认 artifacts/sweep）
  --roles <list>     参与巡检的角色，逗号分隔：admin,teacher,student,student-live,teacher-live（默认全部）
  --keep-db          保留现有演示库，不重建（默认重建，保证数据干净）
  --no-fail          即使发现错误也返回退出码 0
  -h, --help         显示本帮助
`);
}

/** 解析命令行参数。 */
function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    port: 9300,
    outDir: path.resolve(process.cwd(), 'artifacts', 'sweep'),
    roles: SWEEP_ROLES.map((role) => role.id),
    resetDb: true,
    failOnError: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    switch (arg) {
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
        break;
      case '--port':
        options.port = Number(argv[++i]);
        break;
      case '--base-url':
        options.baseUrl = argv[++i];
        options.resetDb = false;
        break;
      case '--out':
        options.outDir = path.resolve(process.cwd(), argv[++i]!);
        break;
      case '--roles': {
        const raw = (argv[++i] ?? '').split(',').map((item) => item.trim()).filter(Boolean);
        const valid = raw.filter((item): item is SweepRoleId =>
          ['admin', 'teacher', 'student', 'student-live', 'teacher-live'].includes(item),
        );
        if (valid.length === 0) {
          throw new Error(
            `--roles 取值无效：「${raw.join(',')}」。可选：admin,teacher,student,student-live,teacher-live`,
          );
        }
        options.roles = valid;
        break;
      }
      case '--keep-db':
        options.resetDb = false;
        break;
      case '--no-fail':
        options.failOnError = false;
        break;
      default:
        if (arg.startsWith('--')) {
          console.warn(`[sweep] 忽略未知参数：${arg}`);
        }
    }
  }

  return options;
}

/** 主流程。 */
async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const log = (message: string) => console.log(`[sweep] ${message}`);

  const startedAt = new Date().toISOString();
  const roles = SWEEP_ROLES.filter((role) => options.roles.includes(role.id));

  let baseUrl = options.baseUrl;
  let stopServer: (() => Promise<void>) | null = null;
  let dataEnv = '外部服务';

  if (!baseUrl) {
    log(`启动一次性演示服务器（端口 ${options.port}，${options.resetDb ? '重建' : '保留'}演示库）…`);
    const server = await startDemoServer({
      port: options.port,
      logFile: path.join(options.outDir, 'server.log'),
      reset: options.resetDb,
    });
    baseUrl = server.baseUrl;
    stopServer = server.stop;
    dataEnv = `独立演示库（storage/demo.db${options.resetDb ? '，本次重建' : ''}）`;
    log(`演示服务器就绪：${baseUrl}`);
  }

  log(`开始巡检，角色：${roles.map((role) => role.label).join(' / ')}`);

  let results;
  try {
    results = await runSweep({
      baseUrl,
      outDir: options.outDir,
      screenshotDir: path.join(options.outDir, 'screenshots'),
      roles,
      onProgress: log,
    });
  } finally {
    if (stopServer) {
      log('停止演示服务器…');
      await stopServer();
    }
  }

  const meta = {
    startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl,
    dataEnv,
  };

  // 先把「全局问题」与「视图自身问题」分开，再出报告 —— 否则全局噪音会淹没真信号。
  classifyGlobalIssues(results);

  // ── 过程日志不判成败（全局/视图的区分要等分类之后才有意义），这里给最终结论 ──
  const globals = collectGlobalSummaries(results);
  console.log('');
  if (globals.length > 0) {
    console.log('全局问题（每次进系统都会复现，不计入各视图成败）：');
    for (const item of globals) {
      console.log(`  · ${item.message}  ×${item.occurrences}`);
    }
    console.log('');
  }

  const problems = results.filter((r) => r.status === 'error' || r.status === 'warn');
  if (problems.length > 0) {
    console.log('视图级问题：');
    for (const result of problems) {
      const viewName = result.subTabLabel ? `${result.targetLabel} / ${result.subTabLabel}` : result.targetLabel;
      console.log(`  ${icon(result.status)} ${result.roleLabel} / ${viewName}`);
      for (const issue of result.issues.filter((i) => !i.global)) {
        console.log(`      [${issue.kind}] ${issue.message}`);
      }
    }
    console.log('');
  }

  const missing = results.filter((r) => r.status === 'missing' && !r.expectedMissing);
  if (missing.length > 0) {
    console.log('未找到的入口（不计缺陷）：');
    for (const result of missing) {
      const viewName = result.subTabLabel ? `${result.targetLabel} / ${result.subTabLabel}` : result.targetLabel;
      console.log(`  ${icon('missing')} ${result.roleLabel} / ${viewName}`);
    }
    console.log('');
  }

  const { markdown, json } = writeReport(results, meta, options.outDir);

  const errorCount = results.filter((r) => r.status === 'error').length;
  const warnCount = results.filter((r) => r.status === 'warn').length;
  const missingCount = results.filter((r) => r.status === 'missing').length;

  console.log('');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  巡检完成：共 ${results.length} 个视图`);
  console.log(`  ❌ 错误 ${errorCount} · ⚠️ 告警 ${warnCount} · ⭕ 未找到 ${missingCount}`);
  console.log(`  报告：${markdown}`);
  console.log(`  机器可读：${json}`);
  console.log('══════════════════════════════════════════════════════════');

  if (errorCount > 0 && options.failOnError) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[sweep] 执行失败：', err);
  process.exit(1);
});
