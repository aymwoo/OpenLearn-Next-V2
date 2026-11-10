#!/usr/bin/env node
/**
 * scripts/stress/sqlite-load.mjs
 * OpenLearn V2 SQLite 数据库容量与读写并发性能压力测试引擎
 *
 * 用法：
 *   node scripts/stress/sqlite-load.mjs --concurrency 100 --duration 300 --rampup 30
 *   node scripts/stress/sqlite-load.mjs -c 100 -d 30 -m workers -p mixed
 *   node scripts/stress/sqlite-load.mjs -c 50 -d 15 -m async
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { MetricsCollector } from './lib/metrics.mjs';
import { setupStressDatabase, seedStressFixture } from './lib/db-fixture.mjs';
import { runAsyncLoadTest } from './lib/async-runner.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    concurrency: 100,
    duration: 300,
    rampup: 30,
    mode: 'workers', // 'workers' | 'async'
    workers: Math.min(8, Math.max(2, os.cpus().length)),
    profile: 'mixed', // 'mixed' | 'read-only' | 'write-only'
    thinkMin: 200,
    thinkMax: 800,
    dbPath: null,
    cleanup: true,
    jsonOut: null,
    silent: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-c' || arg === '--concurrency') {
      options.concurrency = parseInt(args[++i], 10);
    } else if (arg === '-d' || arg === '--duration') {
      options.duration = parseInt(args[++i], 10);
    } else if (arg === '-r' || arg === '--rampup') {
      options.rampup = parseInt(args[++i], 10);
    } else if (arg === '-m' || arg === '--mode') {
      options.mode = args[++i];
    } else if (arg === '-w' || arg === '--workers') {
      options.workers = parseInt(args[++i], 10);
    } else if (arg === '-p' || arg === '--profile') {
      options.profile = args[++i];
    } else if (arg === '--think-min') {
      options.thinkMin = parseInt(args[++i], 10);
    } else if (arg === '--think-max') {
      options.thinkMax = parseInt(args[++i], 10);
    } else if (arg === '--db-path') {
      options.dbPath = path.resolve(args[++i]);
    } else if (arg === '--no-cleanup') {
      options.cleanup = false;
    } else if (arg === '--json-out') {
      options.jsonOut = path.resolve(args[++i]);
    } else if (arg === '--silent') {
      options.silent = true;
    } else if (arg === '-h' || arg === '--help') {
      console.log(`
OpenLearn V2 SQLite 压力测试工具 (sqlite-load.mjs)

参数选项:
  -c, --concurrency <n>   并发虚拟用户数 (默认: 100)
  -d, --duration <s>      测试总持续时间 (秒, 默认: 300)
  -r, --rampup <s>        并发爬坡时间 (秒, 默认: 30)
  -m, --mode <mode>       并发执行模型: 'workers' (多线程真实锁竞争) 或 'async' (单进程事件循环) (默认: workers)
  -w, --workers <n>       Worker 线程数 (默认: min(8, CPU核心数))
  -p, --profile <name>    负载类型: 'mixed' (50%读/45%写/5%慢查), 'read-only', 'write-only' (默认: mixed)
  --think-min <ms>        虚拟用户每步思考时间下限 (默认: 200)
  --think-max <ms>        虚拟用户每步思考时间上限 (默认: 800)
  --db-path <path>        自定义临时数据库路径 (默认: /tmp/openlearn_stress_<pid>/stress.db)
  --no-cleanup            测试完成后保留数据库文件供离线审查
  --json-out <file>       输出详细 JSON 结果报告
      `);
      process.exit(0);
    }
  }

  return options;
}

export async function runSqliteStressTest(options = {}) {
  const config = {
    concurrency: 100,
    duration: 300,
    rampup: 30,
    mode: 'workers',
    workers: Math.min(8, Math.max(2, os.cpus().length)),
    profile: 'mixed',
    thinkMin: 200,
    thinkMax: 800,
    dbPath: null,
    cleanup: true,
    jsonOut: null,
    silent: false,
    ...options,
  };

  const isTempDb = !config.dbPath;
  const tempDir = isTempDb
    ? path.join(os.tmpdir(), `openlearn_stress_${Date.now()}_${process.pid}`)
    : path.dirname(config.dbPath);
  const targetDbPath = config.dbPath || path.join(tempDir, 'stress_test.db');

  if (!config.silent) {
    console.log(
      `\n[StressDB] 初始化测试环境 (模式: ${config.mode}, 并发: ${config.concurrency}, 时长: ${config.duration}s)...`,
    );
    console.log(`[StressDB] 目标数据库路径: ${targetDbPath}`);
  }

  // 1. 初始化数据库与数据底座
  const initDb = setupStressDatabase(targetDbPath);
  seedStressFixture(initDb, {
    studentCount: Math.max(300, config.concurrency * 2),
    classCount: 10,
    lessonCount: 10,
  });
  initDb.close();

  // 2. 准备虚拟用户列表
  const virtualUsers = [];
  for (let i = 1; i <= config.concurrency; i++) {
    const studentId = `std_${String(i).padStart(3, '0')}`;
    virtualUsers.push({
      id: `user_${i}`,
      studentId,
      studentNumber: `S${String(i).padStart(4, '0')}`,
      name: `学生${String(i).padStart(3, '0')}`,
      classId: `cls_${String(((i - 1) % 10) + 1).padStart(2, '0')}`,
    });
  }

  const metrics = new MetricsCollector({
    name: `SQLite Load Test [${config.mode.toUpperCase()}] - ${config.concurrency} 并发 / ${config.profile}`,
    dbPath: targetDbPath,
  });

  const durationMs = config.duration * 1000;
  const rampupMs = config.rampup * 1000;

  metrics.start();

  let liveTicker = null;
  if (!config.silent) {
    const startTime = Date.now();
    liveTicker = setInterval(() => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const walPath = `${targetDbPath}-wal`;
      let walSize = '0 KB';
      try {
        if (fs.existsSync(walPath)) {
          walSize = `${(fs.statSync(walPath).size / 1024).toFixed(1)} KB`;
        }
      } catch {
        // ignore
      }
      process.stdout.write(
        `\r  > [Running] 压测进度: ${elapsed}s / ${config.duration}s | WAL大小: ${walSize} | 模式: ${config.mode} | 并发: ${config.concurrency} ...   `,
      );
    }, 2000);
    liveTicker.unref();
  }

  try {
    if (config.mode === 'async') {
      // 单进程主事件循环模型
      await runAsyncLoadTest({
        dbPath: targetDbPath,
        virtualUsers,
        durationMs,
        rampupMs,
        thinkMinMs: config.thinkMin,
        thinkMaxMs: config.thinkMax,
        profile: config.profile,
        metrics,
      });
    } else {
      // 多 Worker 线程真实连接竞争模型
      const workerCount = Math.min(config.workers, config.concurrency);
      const usersPerWorker = Math.ceil(config.concurrency / workerCount);
      const workerPromises = [];

      const workerScriptPath = path.resolve(__dirname, 'lib/worker-thread.mjs');

      for (let w = 0; w < workerCount; w++) {
        const sliceStart = w * usersPerWorker;
        const sliceEnd = Math.min(config.concurrency, sliceStart + usersPerWorker);
        const assignedUsers = virtualUsers.slice(sliceStart, sliceEnd);
        if (assignedUsers.length === 0) continue;

        const workerPromise = new Promise((resolve, reject) => {
          const worker = new Worker(workerScriptPath, {
            workerData: {
              dbPath: targetDbPath,
              workerId: w + 1,
              virtualUsers: assignedUsers,
              durationMs,
              rampupMs,
              thinkMinMs: config.thinkMin,
              thinkMaxMs: config.thinkMax,
              profile: config.profile,
            },
          });

          worker.on('message', (workerReport) => {
            metrics.mergeWorkerResults(workerReport);
          });

          worker.on('error', reject);
          worker.on('exit', (code) => {
            if (code !== 0) {
              reject(new Error(`Worker ${w + 1} exited with code ${code}`));
            } else {
              resolve();
            }
          });
        });

        workerPromises.push(workerPromise);
      }

      await Promise.all(workerPromises);
    }
  } finally {
    if (liveTicker) {
      clearInterval(liveTicker);
      process.stdout.write('\r                                                                                \r');
    }
    metrics.stop();
  }

  const report = metrics.getReport({
    concurrency: config.concurrency,
    duration: config.duration,
    rampup: config.rampup,
    mode: config.mode,
    workers: config.mode === 'workers' ? config.workers : 1,
    profile: config.profile,
  });

  if (!config.silent) {
    metrics.printConsoleSummary(report);
  }

  if (config.jsonOut) {
    fs.mkdirSync(path.dirname(config.jsonOut), { recursive: true });
    fs.writeFileSync(config.jsonOut, JSON.stringify(report, null, 2), 'utf8');
    if (!config.silent) {
      console.log(`[StressDB] JSON 报告已持久化至: ${config.jsonOut}`);
    }
  }

  // 清理临时文件
  if (config.cleanup && isTempDb) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  return report;
}

if (process.argv[1] === __filename) {
  const options = parseArgs();
  runSqliteStressTest(options).catch((err) => {
    console.error('Stress test fatal error:', err);
    process.exit(1);
  });
}
