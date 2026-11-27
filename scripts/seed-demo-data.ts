/**
 * scripts/seed-demo-data.ts — 演示与测试数据一键播种/清理脚本
 *
 * 用法：
 *   pnpm db:seed           # 播种演示数据（2 教师、3 班级、24 学生、2 机房、4 课程、8 课表及闭环）
 *   pnpm db:seed --reset   # 清理旧演示数据并重新播种
 *   pnpm db:clean-demo     # 清理全部演示数据，还原纯净环境
 */
import { db } from '../packages/core/db/index.js';
import { seedDemoData, cleanupDemoData, DEMO_TEACHER, DEMO_TEACHER_B } from '../server/services/demo-data.js';

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
  console.log(
    `• 演示教师:     ${DEMO_TEACHER.username}（主讲）/ ${DEMO_TEACHER_B.username}（协同） / 密码: ${DEMO_TEACHER.password}`,
  );
  console.log(`• 演示学生:     ${status.demo.studentIds.length} 名（DEMO-S01 ~ DEMO-S24，学号即登录名，同一密码）`);
  console.log(
    `• 机房 / 班级: ${status.demo.labIds.length} 间 6×4 机房 / ${status.demo.classIds.length} 个班（口令 1001/1002/1003）`,
  );
  console.log(`• 白板课 ×2:   ${status.demo.whiteboardLessonIds.join(', ')}（探秘二进制 / 玩转排序）`);
  console.log(`• 学案课 ×2:   ${status.demo.xueanLessonIds.join(', ')}（网络安全小卫士 / 智能红绿灯）`);
  console.log(`• 课表:        ${status.demo.scheduleIds.length} 节`);
  console.log(`• 演示记录:    ${status.total} 条（含教学环节 / Surface / 作业 / 测评 / 成绩 / 考勤 / 积分等闭环）`);
  console.log('───────────────────────────────────────────────────────');
  console.log('提示：测试完成后，可运行 pnpm db:clean-demo 快速恢复纯净环境。');
} catch (err: any) {
  console.error('[SeedDemoData] 操作失败:', err.message);
  process.exit(1);
}
