#!/usr/bin/env node
/**
 * gen-table-inventory.mjs — 从 migrations/schema-golden.json 生成数据表完整清单（pnpm db:gen-tables）。
 *
 * 输出写入 docs/reference/platform-data-tables.md 中
 * `<!-- AUTO-GENERATED:table-inventory BEGIN -->` 与 `<!-- AUTO-GENERATED:table-inventory END -->`
 * 标记之间（只替换标记间内容，其余手写部分不动）。改迁移后跑
 * `pnpm db:gen-golden && pnpm db:gen-tables` 保持数据字典与金样一致。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const goldenPath = path.join(repoRoot, 'migrations', 'schema-golden.json');
const docPath = path.join(repoRoot, 'docs', 'reference', 'platform-data-tables.md');

const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
const tables = Object.keys(golden.tables).sort();

const lines = [
  `共 **${tables.length}** 张表（迁移 ${golden.migrationCount} 个，金样生成于 ${golden.generatedAt}）。列清单为列名（类型与约束见迁移 SQL）：`,
  '',
];
for (const t of tables) {
  lines.push(`- \`${t}\`: ${golden.tables[t].join(', ')}`);
}
const inventory = lines.join('\n');

const doc = fs.readFileSync(docPath, 'utf8');
const BEGIN = '<!-- AUTO-GENERATED:table-inventory BEGIN -->';
const END = '<!-- AUTO-GENERATED:table-inventory END -->';
const i = doc.indexOf(BEGIN);
const j = doc.indexOf(END);
if (i === -1 || j === -1) {
  console.error(`[gen-table-inventory] FATAL: ${docPath} 缺少 ${BEGIN}/${END} 标记。`);
  process.exit(1);
}
const next = doc.slice(0, i + BEGIN.length) + '\n\n' + inventory + '\n\n' + doc.slice(j);
fs.writeFileSync(docPath, next);
console.log(`[gen-table-inventory] OK: ${tables.length} 张表 → ${path.relative(repoRoot, docPath)}`);
