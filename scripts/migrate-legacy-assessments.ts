#!/usr/bin/env tsx
/**
 * 存量测评导入 CLI（Issue #185）。
 *
 * 用法：
 *   pnpm exec tsx scripts/migrate-legacy-assessments.ts [--dry-run]
 *
 * 幂等：重复执行只会计入 skipped(already_imported)；不修改旧表。
 */
import { kernelContainer } from '../packages/core/kernel/index.js';
import { importLegacyAssessments } from '../server/services/legacy-assessment-import.js';

const dryRun = process.argv.includes('--dry-run');
const report = importLegacyAssessments(kernelContainer.db as never, { dryRun });

console.log('[legacy-assessment-import]' + (dryRun ? ' (dry-run)' : ''));
console.log('  created:', JSON.stringify(report.created));
for (const item of report.skipped) {
  console.log('  skipped:', item.source, item.sourceId, '—', item.reason);
}
console.log('  合计：创建 ' + (report.created.assessments) + ' 份试卷，跳过 ' + report.skipped.length + ' 条来源。');
