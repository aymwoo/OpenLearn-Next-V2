/**
 * scripts/sweep/report.ts —— 巡检报告渲染
 *
 * 输出两份：
 * - `report.md` —— 人读的（贴进 issue / PR 描述都能用）
 * - `report.json` —— 机器读的（后续可以接 CI 门禁或趋势对比）
 *
 * ## 全局问题 vs 视图问题
 *
 * 有些问题在**每个**视图里都会冒出来（典型：无课堂会话时前端仍去 POST
 * view-state，于是每次进系统都拿一个 404）。如果把它们算到每个视图头上，
 * 整份报告就失去了信噪比 —— 真正「这个视图坏了」的信号会被淹没。
 *
 * 因此报告阶段先做一次分类：
 * - **启动期探针**（`__boot__`）里抓到的问题 —— 每次进系统都会复现 → 全局；
 * - 在某个角色的 **≥70% 视图**里都出现的问题 —— 全局；
 * - 其余 → 视图自身的问题。
 *
 * 全局问题单独成节，且**不计入各视图的成败判定**。
 *
 * @module
 */

import fs from 'node:fs';
import path from 'node:path';
import type { SweepIssue, SweepScenarioResult, SweepViewResult } from './types.js';

export interface ReportMeta {
  startedAt: string;
  finishedAt: string;
  baseUrl: string;
  dataEnv: string;
}

const STATUS_ICON: Record<SweepViewResult['status'], string> = {
  ok: '✅',
  warn: '⚠️',
  error: '❌',
  missing: '⭕',
};

const STATUS_TEXT: Record<SweepViewResult['status'], string> = {
  ok: '正常',
  warn: '有告警',
  error: '有错误',
  missing: '未找到入口',
};

/** 判定问题是否「全局」时，某个角色至少要有这么多视图才作数。 */
const MIN_VIEWS_FOR_RATIO = 3;
/** 判定问题是否「全局」的出现比例阈值。 */
const GLOBAL_RATIO = 0.7;

/** 把 URL 归一化（去掉 origin 与一次性参数），用于问题签名比较。 */
function normalizeText(text: string): string {
  return text
    .replace(/https?:\/\/[^/\s'"]+/g, '')
    .replace(/sweep=\d+/g, 'sweep=N')
    .trim();
}

/** 问题签名：同一类问题在不同视图里应当得到同一个签名。 */
export function issueSignature(issue: SweepIssue): string {
  const location = issue.url ? normalizeText(issue.url) : '';
  return `${issue.kind}|${location}|${normalizeText(issue.message)}`;
}

/**
 * 分类全局问题并据此重算各视图的成败。
 *
 * 会就地修改传入的 results（给 issue 打 global 标记、重算 status）。
 */
export function classifyGlobalIssues(results: SweepViewResult[]): void {
  const globalSignatures = new Set<string>();

  // ① 启动期探针抓到的问题 = 每次进系统都会复现
  for (const result of results) {
    if (result.targetId !== '__boot__') continue;
    for (const issue of result.issues) {
      globalSignatures.add(issueSignature(issue));
    }
  }

  // ② 在某个角色的绝大多数视图里都出现的问题
  const roleIds = Array.from(new Set(results.map((r) => r.role)));
  for (const roleId of roleIds) {
    const roleResults = results.filter((r) => r.role === roleId && r.targetId !== '__login__');
    if (roleResults.length < MIN_VIEWS_FOR_RATIO) continue;

    const occurrences = new Map<string, number>();
    for (const result of roleResults) {
      const seen = new Set<string>();
      for (const issue of result.issues) {
        const signature = issueSignature(issue);
        if (seen.has(signature)) continue;
        seen.add(signature);
        occurrences.set(signature, (occurrences.get(signature) ?? 0) + 1);
      }
    }

    const threshold = Math.ceil(roleResults.length * GLOBAL_RATIO);
    for (const [signature, count] of occurrences) {
      if (count >= threshold) globalSignatures.add(signature);
    }
  }

  // ③ 打标记 + 重算状态（全局问题不计入视图成败）
  for (const result of results) {
    for (const issue of result.issues) {
      issue.global = globalSignatures.has(issueSignature(issue));
    }

    const local = result.issues.filter((issue) => !issue.global);
    if (result.status === 'missing') continue;
    if (local.some((issue) => issue.severity === 'error')) {
      result.status = 'error';
    } else if (local.length > 0) {
      result.status = 'warn';
    } else {
      result.status = 'ok';
    }
  }
}

/** 按问题类型分组计数。 */
function countByKind(issues: SweepIssue[]): Record<string, number> {
  const counts: Record<string, number> = { pageerror: 0, console: 0, requestfailed: 0, http: 0, nav: 0 };
  for (const issue of issues) {
    counts[issue.kind] = (counts[issue.kind] ?? 0) + 1;
  }
  return counts;
}

/** 把 URL 缩短成便于阅读的形式（保留 hash 路由）。 */
function shortenUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const search = parsed.search ? parsed.search.replace(/sweep=\d+/, 'sweep=N') : '';
    return `${parsed.pathname}${search}${parsed.hash}`;
  } catch {
    return url;
  }
}

/** 统计某状态的视图数量。 */
function count(results: SweepViewResult[], status: SweepViewResult['status']): number {
  return results.filter((r) => r.status === status).length;
}

export function issuesHaveBlocking(issues: SweepIssue[]): boolean {
  return issues.some((issue) => {
    switch (issue.kind) {
      case 'pageerror':
        return true;
      case 'nav':
        return issue.severity === 'error';
      case 'http':
        return (issue.status ?? 0) >= 400;
      default:
        return false;
    }
  });
}

/**
 * 判定某个视图结果里是否存在**阻断性问题**。
 *
 * ## 为什么不直接看 status
 *
 * `classifyGlobalIssues` 会把「几乎每个视图都出现」的问题归为全局问题，并把视图
 * 状态重算为正常 —— 那是给**报告**用的可读性分层，**不是**严重性判断。
 * 但对 CI 门禁来说，「每个页面都 403」恰恰是最该拦住的回归。
 *
 * 所以阻断判定另起一套口径（与「全局/视图」分类正交）：
 *
 * - `pageerror`（未捕获异常）→ 阻断；
 * - `nav` 错误（导航/点击失败）→ 阻断；
 * - 任何 http 4xx/5xx 响应 → 阻断（接口失败）；
 * - **只有** console 错误 → **不**阻断：浏览器会给每个失败资源都打一条
 *   “Failed to load resource: … 404”，它多半是上面两类的**回声**，
 *   重复计一次只会让门禁变得吵闹。
 */
export function hasBlockingIssue(result: SweepViewResult): boolean {
  return issuesHaveBlocking(result.issues);
}

/** 收集全局问题（按签名去重，附出现次数）。 */
function collectGlobalIssues(results: SweepViewResult[]): {
  signature: string;
  issue: SweepIssue;
  occurrences: number;
}[] {
  const map = new Map<string, { issue: SweepIssue; occurrences: number }>();
  for (const result of results) {
    for (const issue of result.issues) {
      if (!issue.global) continue;
      const signature = issueSignature(issue);
      const existing = map.get(signature);
      if (existing) {
        existing.occurrences += 1;
      } else {
        map.set(signature, { issue, occurrences: 1 });
      }
    }
  }
  return Array.from(map.entries()).map(([signature, value]) => ({ signature, ...value }));
}

/** 收集全局问题（按签名去重，附出现次数）。 */
export function collectGlobalSummaries(results: SweepViewResult[]): {
  message: string;
  occurrences: number;
}[] {
  const map = new Map<string, { message: string; occurrences: number }>();
  for (const result of results) {
    for (const issue of result.issues) {
      if (!issue.global) continue;
      const signature = issueSignature(issue);
      const existing = map.get(signature);
      if (existing) {
        existing.occurrences += 1;
      } else {
        map.set(signature, { message: issue.message, occurrences: 1 });
      }
    }
  }
  return Array.from(map.values());
}

/** 渲染 Markdown 报告。 */
export function renderMarkdown(results: SweepViewResult[], scenarios: SweepScenarioResult[], meta: ReportMeta): string {
  const lines: string[] = [];

  lines.push('# 功能巡检报告');
  lines.push('');
  lines.push(`> 生成于 ${meta.startedAt} · 服务地址 \`${meta.baseUrl}\` · 数据环境：${meta.dataEnv}`);
  lines.push('');

  // ── 按角色汇总 ────────────────────────────────────────────────
  const roleIds = Array.from(new Set(results.map((r) => r.role)));
  lines.push('## 概要');
  lines.push('');
  lines.push('| 角色 | 视图数 | ✅ 正常 | ⚠️ 告警 | ❌ 错误 | ⭕ 未找到 | 🚨 阻断 |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const roleId of roleIds) {
    const roleResults = results.filter((r) => r.role === roleId);
    lines.push(
      `| ${roleResults[0]!.roleLabel} | ${roleResults.length} | ${count(roleResults, 'ok')} | ` +
        `${count(roleResults, 'warn')} | ${count(roleResults, 'error')} | ${count(roleResults, 'missing')} | ` +
        `${roleResults.filter(hasBlockingIssue).length} |`,
    );
  }
  lines.push(
    `| **合计** | **${results.length}** | **${count(results, 'ok')}** | **${count(results, 'warn')}** | ` +
      `**${count(results, 'error')}** | **${count(results, 'missing')}** | **${results.filter(hasBlockingIssue).length}** |`,
  );
  lines.push('');
  lines.push('> 🚨 阻断 = 存在未捕获异常 / 导航失败 / 任何 4xx·5xx 响应。');
  lines.push('> 它与「全局 / 视图」分类**正交**：全局问题也会阻断（“每个页面都 403” 正是最该拦住的回归）。');
  lines.push('');

  // ── 全局问题 ──────────────────────────────────────────────────
  const globals = collectGlobalIssues(results);
  if (globals.length > 0) {
    lines.push('## 全局问题');
    lines.push('');
    lines.push('这些问题在**几乎所有视图里都会复现**（每次进系统都会遇到），因此不计入各视图的成败判定：');
    lines.push('');
    lines.push('| 类型 | 出现次数 | 描述 |');
    lines.push('| --- | ---: | --- |');
    for (const item of globals) {
      const kind = item.issue.kind === 'http' ? `HTTP ${item.issue.status ?? ''}` : item.issue.kind;
      lines.push(`| ${kind} | ${item.occurrences} | ${escapeCell(item.issue.message)} |`);
    }
    lines.push('');
  }

  // ── 明细表 ────────────────────────────────────────────────────
  lines.push('## 明细');
  lines.push('');
  lines.push('| 角色 | 视图 | 状态 | 🚨 | 页面异常 | console | 请求失败 | 4xx/5xx | 全局 | 截图 |');
  lines.push('| --- | --- | :-: | :-: | ---: | ---: | ---: | ---: | ---: | --- |');
  for (const result of results) {
    const counts = countByKind(result.issues);
    const viewName = result.subTabLabel ? `${result.targetLabel} / ${result.subTabLabel}` : result.targetLabel;
    const shot = result.screenshot ? `![${viewName}](${result.screenshot})` : '—';
    const globalCount = result.issues.filter((issue) => issue.global).length;
    lines.push(
      `| ${result.roleLabel} | ${viewName} | ${STATUS_ICON[result.status]} ${STATUS_TEXT[result.status]} | ` +
        `${hasBlockingIssue(result) ? '🚨' : '—'} | ` +
        `${counts.pageerror ?? 0} | ${counts.console ?? 0} | ${counts.requestfailed ?? 0} | ${counts.http ?? 0} | ` +
        `${globalCount} | ${shot} |`,
    );
  }
  lines.push('');

  // ── 视图级问题详情 ────────────────────────────────────────────
  const broken = results.filter(
    (r) => (r.status === 'error' || r.status === 'warn') && r.issues.some((issue) => !issue.global),
  );
  const blocking = results.filter(hasBlockingIssue);

  if (blocking.length > 0) {
    lines.push('## 阻断性问题（CI 门禁口径）');
    lines.push('');
    lines.push('存在未捕获异常、导航失败或 4xx/5xx 响应的视图 —— **无论它是不是全局问题**。');
    lines.push('');
    for (const result of blocking) {
      const viewName = result.subTabLabel ? `${result.targetLabel} / ${result.subTabLabel}` : result.targetLabel;
      lines.push(`### 🚨 ${result.roleLabel} / ${viewName}`);
      lines.push('');
      lines.push(`- 落点 URL：\`${shortenUrl(result.url)}\``);
      for (const issue of result.issues) {
        if (issue.kind === 'console') continue;
        const tag = issue.kind === 'http' ? `http ${issue.status ?? ''}` : issue.kind;
        lines.push(`- **${tag}**：${issue.message}${issue.global ? '（全局）' : ''}`);
      }
      lines.push('');
    }
  }

  if (broken.length === 0) {
    lines.push('## 视图问题详情');
    lines.push('');
    lines.push('✅ 没有发现任何视图级错误或告警。');
    lines.push('');
  } else {
    lines.push('## 视图问题详情');
    lines.push('');
    for (const result of broken) {
      const viewName = result.subTabLabel ? `${result.targetLabel} / ${result.subTabLabel}` : result.targetLabel;
      lines.push(`### ${STATUS_ICON[result.status]} ${result.roleLabel} / ${viewName}`);
      lines.push('');
      lines.push(`- 落点 URL：\`${shortenUrl(result.url)}\``);
      for (const issue of result.issues) {
        if (issue.global) continue;
        const tag = issue.kind === 'http' ? `http ${issue.status ?? ''}` : issue.kind;
        lines.push(`- **${tag}**：${issue.message}`);
      }
      lines.push('');
    }
  }

  // ── 未找到的入口 ──────────────────────────────────────────────
  const missing = results.filter((r) => r.status === 'missing' && !r.expectedMissing);
  if (missing.length > 0) {
    lines.push('## 未找到的入口');
    lines.push('');
    lines.push('这些入口在本次运行中没有找到（可能是角色限制、数据前置条件或文案调整），**不计入缺陷**：');
    lines.push('');
    for (const result of missing) {
      const viewName = result.subTabLabel ? `${result.targetLabel} / ${result.subTabLabel}` : result.targetLabel;
      lines.push(`- ${result.roleLabel} / ${viewName}`);
    }
    lines.push('');
  }

  // ── 预期内不存在的入口 ────────────────────────────────────────
  const expectedMissing = results.filter((r) => r.status === 'missing' && r.expectedMissing);
  if (expectedMissing.length > 0) {
    lines.push('## 预期内不存在的入口');
    lines.push('');
    lines.push('这些入口在本轮的条件下本就不存在（缺少前置数据），**不计入缺陷**：');
    lines.push('');
    for (const result of expectedMissing) {
      const viewName = result.subTabLabel ? `${result.targetLabel} / ${result.subTabLabel}` : result.targetLabel;
      lines.push(`- ${result.roleLabel} / ${viewName}`);
    }
    lines.push('');
  }

  // ── 写流程剧本 ────────────────────────────────────────────────
  if (scenarios.length > 0) {
    lines.push('## 写流程剧本');
    lines.push('');
    lines.push('“做一笔真实业务之后，相关界面会不会报错” —— 只读巡检看不到这一层。');
    lines.push('');
    for (const scenario of scenarios) {
      const scenarioBlocking = scenario.steps.filter((step) => issuesHaveBlocking(step.issues));
      const icon = scenario.status === 'ok' ? '✅' : scenario.status === 'skipped' ? '⭕' : '❌';
      lines.push(`### ${icon} ${scenario.label}`);
      lines.push('');
      lines.push('| 步骤 | 角色 | 状态 | 🚨 | 说明 |');
      lines.push('| --- | --- | :-: | :-: | --- |');
      for (const step of scenario.steps) {
        const stepIcon = step.status === 'ok' ? '✅' : step.status === 'skipped' ? '⭕' : '❌';
        const detail = step.detail ?? '';
        lines.push(
          `| ${step.label} | ${step.roleLabel} | ${stepIcon} | ` +
            `${issuesHaveBlocking(step.issues) ? '🚨' : '—'} | ${detail.replace(/\|/g, '\\|')} |`,
        );
      }
      lines.push('');
      for (const step of scenarioBlocking) {
        for (const issue of step.issues) {
          if (issue.kind === 'console') continue;
          const tag = issue.kind === 'http' ? `http ${issue.status ?? ''}` : issue.kind;
          lines.push(`- 🚨 **${step.label}**（${tag}）：${issue.message}`);
        }
      }
      if (scenarioBlocking.length > 0) lines.push('');
    }
  }

  return lines.join('\n');
}

/** 转义 Markdown 表格里的竖线。 */
function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/**
 * 把报告写到产物目录。
 *
 * @returns 写入的文件绝对路径。
 */
export function writeReport(
  results: SweepViewResult[],
  scenarios: SweepScenarioResult[],
  meta: ReportMeta,
  outDir: string,
): { markdown: string; json: string } {
  fs.mkdirSync(outDir, { recursive: true });

  const markdownPath = path.join(outDir, 'report.md');
  const jsonPath = path.join(outDir, 'report.json');

  fs.writeFileSync(markdownPath, renderMarkdown(results, scenarios, meta), 'utf8');
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        ...meta,
        summary: {
          total: results.length,
          ok: count(results, 'ok'),
          warn: count(results, 'warn'),
          error: count(results, 'error'),
          missing: count(results, 'missing'),
          blocking: results.filter(hasBlockingIssue).length,
          scenarios: scenarios.length,
          scenarioBlocking: scenarios.reduce(
            (acc, scenario) => acc + scenario.steps.filter((step) => issuesHaveBlocking(step.issues)).length,
            0,
          ),
        },
        results,
        scenarios,
      },
      null,
      2,
    ),
    'utf8',
  );

  return { markdown: markdownPath, json: jsonPath };
}
