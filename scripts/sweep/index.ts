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
import { SWEEP_ROLES, SWEEP_SCENARIOS } from './manifest.js';
import { icon, runSweep } from './probe.js';
import { runScenarios } from './scenario.js';
import {
  classifyGlobalIssues,
  collectGlobalSummaries,
  hasBlockingIssue,
  issuesHaveBlocking,
  writeReport,
} from './report.js';
import { startDemoServer } from './server.js';
import { ensureCrossTenantTeacher } from './prepare.js';
import { parseArgs } from './cli-args.js';

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
  let scenarioResults: Awaited<ReturnType<typeof runScenarios>> = [];
  try {
    // ── 先铺「第二教师」这条世界线 ─────────────────────────────────
    //
    // 跨教师/跨班的对象级授权回归（#211 防的）在单教师世界里**结构上不可能触发** ——
    // 任何授权判定都必然放行，那条判定链在巡检里是盲区。
    //
    // 用产品自己的 `user.create` 命令建一个真实的第二教师账号（幂等）：
    // 已存在就跳过，绝不重复创建。
    const adminRole = SWEEP_ROLES.find((role) => role.id === 'admin');
    if (adminRole) {
      const fixture = await ensureCrossTenantTeacher(baseUrl, adminRole.login);
      log(`  ⓘ 前置数据 ${fixture.kind}：${fixture.detail}` + (fixture.error ? `（${fixture.error}）` : ''));
    }

    // ── 再跑写流程剧本 ──────────────────────────────────────────
    // 顺序有意为之：剧本要在**还没有进行中课堂会话**时跑 ——
    // 否则学生端会被锁进课中视图（“全班专注锁定”），根本看不到自己的作业列表，
    // 回看分数那一步就变成了截图里盖着弹窗的假象。
    if (!options.skipScenarios) {
      scenarioResults = await runScenarios({
        baseUrl,
        scenarios: SWEEP_SCENARIOS,
        roles,
        screenshotDir: path.join(options.outDir, 'screenshots'),
        onProgress: log,
      });
    }

    results = await runSweep({
      baseUrl,
      outDir: options.outDir,
      screenshotDir: path.join(options.outDir, 'screenshots'),
      // 只读巡检不带「第二教师」：它没有自己的视图要巡检，
      // 只作为剧本里的越权方出现 —— 它的登录失败不该让整场巡检红掉。
      roles: roles.filter((role) => role.id !== 'teacher-2'),
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
    console.log('全局问题（每次进系统都会复现，不计入各视图成败，但**仍然阻断**）：');
    for (const item of globals) {
      console.log(`  · ${item.message}  ×${item.occurrences}`);
    }
    console.log('');
  }

  // ── 阻断判定：与「全局/视图」分类正交 ─────────────────────────
  // 「每个页面都 403」这类回归在视图成败口径下是「全局、正常」，但它恰恰是
  // 最该拦住的 —— 所以门禁另起一套口径（见 report.ts 的 hasBlockingIssue）。
  const blocking = results.filter(hasBlockingIssue);
  if (blocking.length > 0) {
    console.log('阻断性问题：');
    for (const result of blocking) {
      const viewName = result.subTabLabel ? `${result.targetLabel} / ${result.subTabLabel}` : result.targetLabel;
      console.log(`  🚨 ${result.roleLabel} / ${viewName}`);
      for (const issue of result.issues) {
        if (issue.kind === 'console') continue;
        console.log(`      [${issue.kind}] ${issue.message}${issue.global ? '（全局）' : ''}`);
      }
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

  // ── 剧本结果 ──────────────────────────────────────────────────
  const scenarioBlocking = scenarioResults.flatMap((scenario) =>
    scenario.steps.filter((step) => issuesHaveBlocking(step.issues)).map((step) => ({ scenario, step })),
  );
  if (scenarioResults.length > 0) {
    console.log('写流程剧本：');
    for (const scenario of scenarioResults) {
      const icon2 = scenario.status === 'ok' ? '✅' : scenario.status === 'skipped' ? '⭕' : '❌';
      console.log(`  ${icon2} ${scenario.label}`);
      for (const step of scenario.steps) {
        if (step.status === 'ok' && !issuesHaveBlocking(step.issues)) continue;
        const stepIcon = step.status === 'ok' ? '🚨' : step.status === 'skipped' ? '⭕' : '❌';
        console.log(`      ${stepIcon} ${step.label}${step.detail ? ` —— ${step.detail}` : ''}`);
        for (const issue of step.issues) {
          if (issue.kind === 'console') continue;
          console.log(`           [${issue.kind}] ${issue.message}`);
        }
      }
    }
    console.log('');
  }

  const { markdown, json } = writeReport(results, scenarioResults, meta, options.outDir);

  const errorCount = results.filter((r) => r.status === 'error').length;
  const warnCount = results.filter((r) => r.status === 'warn').length;
  const missingCount = results.filter((r) => r.status === 'missing').length;

  console.log('');
  console.log('══════════════════════════════════════════════════════════');
  console.log(
    `  巡检完成：共 ${results.length} 个视图` + (scenarioResults.length ? ` + ${scenarioResults.length} 个剧本` : ''),
  );
  console.log(
    `  ❌ 错误 ${errorCount} · ⚠️ 告警 ${warnCount} · ⭕ 未找到 ${missingCount} · 🚨 阻断 ${blocking.length + scenarioBlocking.length}`,
  );
  console.log(`  报告：${markdown}`);
  console.log(`  机器可读：${json}`);
  console.log('══════════════════════════════════════════════════════════');

  // 门禁口径：只要存在阻断性问题就失败（全局问题也算 —— “每个页面都 403”
  // 正是最该被拦住的回归，不能因为它出现在每个视图而被“平均”掉）。
  if ((blocking.length > 0 || scenarioBlocking.length > 0) && options.failOnError) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[sweep] 执行失败：', err);
  process.exit(1);
});
