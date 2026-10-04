/**
 * dev:demo —— 以「一次性演示库」启动开发服务器。
 *
 * ## 为什么需要它
 *
 * `pnpm dev` = `tsx server.ts`，直接进 server，**绕过 cli.mjs 的参数解析层**，
 * 因此 `--demo` / `--db-path` 之类的 CLI 选项在 dev 下无效。
 * （`cli.mjs` 的 `--demo` 依赖 CLI 进程在退出时清理临时目录，dev 没有这层。）
 *
 * 本脚本补上这个缺口：先在**独立的一次性数据库**里铺好演示数据，再复用
 * `startServer()` 起服务。开发库的 `educational_os.db` 完全不受影响。
 *
 * ## 用法
 *
 *   pnpm dev:demo              # 若演示库不存在则初始化，已有则直接复用
 *   pnpm dev:demo -- --reset   # 强制重建演示库（先删旧库再重新播种）
 *
 * 演示数据内容（课程 / 班级 / 学生 / 教师 / 课表）由
 * `server/services/demo-data.ts` 提供，清理是精确作用域的 ——
 * 只删该播种器登记过的行，不碰系统其它数据。
 *
 * @module
 */
import fs from 'node:fs';
import path from 'node:path';

const DEMO_DB_PATH = path.resolve(process.cwd(), 'storage/demo.db');

/** 解析 `pnpm dev:demo -- --reset` 透传进来的重置标记。 */
const wantsReset =
  process.argv.includes('--reset') || process.env.DEMO_RESET === '1';

function log(msg: string) {
  console.log(`[dev:demo] ${msg}`);
}

// ── 1. 决定数据库路径并交给后续所有模块 ────────────────────────────
// 必须在 import db 模块**之前**设置：packages/core/db/index.ts 在模块求值时
// 就会 `new Database(dbPath)` 打开默认库，晚设就来不及了。
process.env.OPENLEARN_DB_PATH = DEMO_DB_PATH;

if (wantsReset) {
  for (const f of [DEMO_DB_PATH, `${DEMO_DB_PATH}-wal`, `${DEMO_DB_PATH}-shm`]) {
    if (fs.existsSync(f)) {
      fs.rmSync(f);
      log(`已删除旧演示库：${path.basename(f)}`);
    }
  }
}

fs.mkdirSync(path.dirname(DEMO_DB_PATH), { recursive: true });

const isFresh = !fs.existsSync(DEMO_DB_PATH);
if (isFresh) {
  log(`创建新的演示库：${DEMO_DB_PATH}`);
} else {
  log(`复用已有演示库：${DEMO_DB_PATH}（加 --reset 可强制重建）`);
}

// ── 2. 打开库 + 跑迁移（SSOT）+ 播种演示数据 ───────────────────────
const { db, initializeDatabase } = await import('../packages/core/db/index.js');
initializeDatabase(db);

const { seedDemoData, getDemoDataStatus, DEMO_TEACHER, DEMO_IDS } = await import(
  '../server/services/demo-data.js'
);

const status = getDemoDataStatus(db);
if (!status.seeded) {
  const seeded = seedDemoData(db);
  log(
    `已播种演示数据：${seeded.total} 条 ` +
      `(课程 1 / 班级 2 / 学生 ${seeded.counts.student} / 课表 1)`,
  );
} else {
  log(`演示数据已就绪（${status.total} 条），跳过播种`);
}

log('');
log('演示教师账号：');
log(`  用户名 ${DEMO_TEACHER.username}   密码 ${DEMO_TEACHER.password}`);
log(`  演示课程 ${DEMO_IDS.lesson}   演示班级 ${DEMO_IDS.primaryClass}`);
log('');

// ── 3. 起服务（复用 server.ts 的 startServer，不 spawn 子进程）──────
const { startServer } = await import('../server.ts');
await startServer();
