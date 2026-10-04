/**
 * scripts/seed-demo-data.ts — 演示与测试数据一键播种/清理脚本
 *
 * 用法：
 *   pnpm db:seed           # 播种演示数据（教师、班级、12名学生、课程与课表）
 *   pnpm db:seed --reset   # 清理旧演示数据并重新播种
 *   pnpm db:clean-demo     # 清理全部演示数据，还原纯净环境
 */
import { db } from '../packages/core/db/index.js';
import {
  seedDemoData,
  cleanupDemoData,
  getDemoDataStatus,
  DEMO_TEACHER,
} from '../server/services/demo-data.js';

const args = process.argv.slice(2);
const isReset = args.includes('--reset');
const isClean = args.includes('--clean') || args.includes('clean');

try {
  if (isClean) {
    console.log('[SeedDemoData] 正在清理已播种的演示数据...');
    const report = cleanupDemoData(db);
    console.log(`✓ 清理完成！共清理 ${report.totalRemoved} 条演示数据。`);
    process.exit(0);
  }

  if (isReset) {
    console.log('[SeedDemoData] 检测到 --reset，正在清理旧演示数据...');
    cleanupDemoData(db);
  }

  console.log('[SeedDemoData] 正在注入演示测试数据...');
  const status = seedDemoData(db);

  console.log('✓ 演示测试数据注入成功！');
  console.log('───────────────────────────────────────────────────────');
  console.log(`• 演示教师账号: ${DEMO_TEACHER.username} / 密码: ${DEMO_TEACHER.password}`);
  console.log(`• 演示课程 ID:   ${status.demo.lessonId} (初中信息技术·第一单元)`);
  console.log(`• 演示班级数:   ${status.demo.classIds.length} 个 (口令: 1001, 1002)`);
  console.log(`• 演示学生数:   ${status.demo.studentIds.length} 名 (DEMO-S01 ~ DEMO-S12)`);
  console.log(`• 关联课表 ID:   ${status.demo.scheduleId}`);
  console.log('───────────────────────────────────────────────────────');
  console.log('提示：测试完成后，可运行 pnpm db:clean-demo 快速恢复纯净环境。');
} catch (err: any) {
  console.error('[SeedDemoData] 操作失败:', err.message);
  process.exit(1);
}
