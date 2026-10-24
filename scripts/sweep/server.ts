/**
 * scripts/sweep/server.ts —— 一次性演示服务器的启停
 *
 * ## 为什么复用 `pnpm dev:demo`
 *
 * `scripts/dev-demo.ts` 已经解决了两件事：起一个**独立的一次性数据库**
 * （`storage/demo.db`，不碰开发库 `packages/core/db/educational_os.db`），
 * 并在启动前播种演示数据（教师 / 2 个班级 / 12 名学生 / 1 门课程 / 1 条课表）。
 * 巡检需要的就是这样一个「有数据、但可随时重建」的环境，没必要再写一套播种逻辑。
 *
 * ## 为什么设 `PLAYWRIGHT_TEST=1`
 *
 * 1. `resolveSeedCredential()` 的 `allowWellKnown` 分支：种子口令等于用户名
 *    （admin/admin），且 `must_change_password = 0`，巡检不必去读随机口令文件。
 * 2. `enforcePasswordChanged()` 会整体放行，绕开改密门。
 * 3. 登录 / 写入限流放宽到 1000/10000，巡检不会把自己锁在门外。
 *
 * 该环境变量**仅用于本机的一次性演示库**；仓库已有
 * `packages/core/db/__tests__/playwright-test-production-guard.test.ts`
 * 断言 `NODE_ENV=production` 下必须拒绝启动，生产环境无风险。
 *
 * @module
 */

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';

export interface DemoServerHandle {
  /** 巡检用的服务地址。 */
  baseUrl: string;
  port: number;
  /** 服务端日志文件路径。 */
  logFile: string;
  /** 停止服务并等待进程退出。 */
  stop: () => Promise<void>;
}

/**
 * 轮询 /health 直到就绪的最长等待时间（毫秒）。
 *
 * 一次性演示服务器要跑迁移 + 起 Vite 中间件，冷启动在慢机器上可能到分钟级
 * （CI 容器尤甚）。给得宽一点：启动慢不是失败，等不到才是。
 */
const HEALTH_TIMEOUT_MS = 300_000;
/** 单次健康检查请求超时（毫秒）。 */
const HEALTH_PROBE_TIMEOUT_MS = 3_000;

/** 解析仓库根目录（scripts/sweep/server.ts → 上两级）。 */
function repoRoot(): string {
  return path.resolve(process.cwd());
}

/**
 * 找到本地 tsx 可执行文件。
 * 直接用 node_modules/.bin/tsx 而不是 pnpm，是为了少一层包管理器参数转发
 * （`pnpm dev:demo -- --reset` 的 `--` 转发在不同 pnpm 版本下行为不完全一致）。
 */
function resolveTsxBin(): string {
  const root = repoRoot();
  const candidates = [
    path.join(root, 'node_modules', '.bin', 'tsx'),
    path.join(root, 'node_modules', '.bin', 'tsx.cmd'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`找不到 tsx 可执行文件（已尝试：${candidates.join(', ')}）。请先执行 pnpm install。`);
}

/** 等待服务健康检查通过。 */
async function waitForHealth(baseUrl: string, logFile: string): Promise<void> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let lastError = '';

  while (Date.now() < deadline) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), HEALTH_PROBE_TIMEOUT_MS);
      const res = await fetch(`${baseUrl}/health`, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = (err as Error).message;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const tail = readLogTail(logFile, 40);
  throw new Error(
    `演示服务器在 ${HEALTH_TIMEOUT_MS / 1000}s 内没有就绪（最后一次：${lastError}）。\n` +
      `--- server.log 末尾 ---\n${tail}`,
  );
}

/** 读取日志文件末尾若干行，用于失败诊断。 */
function readLogTail(logFile: string, lines: number): string {
  try {
    if (!fs.existsSync(logFile)) return '(日志文件不存在)';
    return fs.readFileSync(logFile, 'utf8').split('\n').slice(-lines).join('\n');
  } catch (err) {
    return `(读取日志失败：${(err as Error).message})`;
  }
}

/**
 * 确认端口没有被占用。
 *
 * ## 为什么必须先查
 *
 * 端口被占时，服务端会「打印端口占用 → 换端口重试」（见 server.ts 的端口重试逻辑），
 * 于是**巡检连到了一个完全不相干的旧服务**上：跑完一圈全绿，测的却不是刚建的
 * 演示库。这种静默错误比直接报错糟糕得多，所以这里先抢一下端口。
 */
async function assertPortFree(port: number): Promise<void> {
  const probe = net.createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(
          new Error(
            `端口 ${port} 已被占用。巡检必须跑在**自己启动的**服务上，` +
              `否则会连到一个不相干的旧服务上（测出来的结论不可信）。\n` +
              `请先停掉占用该端口的进程，或用 --port 指定其它端口。`,
          ),
        );
        return;
      }
      reject(err);
    });
    probe.once('listening', () => probe.close(() => resolve()));
    probe.listen(port, '127.0.0.1');
  });
}

export interface StartDemoServerOptions {
  /** 监听端口。默认 9300，避开开发服的 9000。 */
  port?: number;
  /** 服务端日志落盘路径。 */
  logFile: string;
  /** 是否重建演示库（删除旧的 storage/demo.db 再播种）。默认 true。 */
  reset?: boolean;
  /** 已存在服务时是否复用。默认 false（巡检要一个干净环境）。 */
  reuseExisting?: boolean;
}

/**
 * 启动一次性演示服务器。
 *
 * @returns 服务句柄；调用方负责在结束时 `stop()`。
 */
export async function startDemoServer(options: StartDemoServerOptions): Promise<DemoServerHandle> {
  const port = options.port ?? 9300;
  const reset = options.reset ?? true;
  const baseUrl = `http://127.0.0.1:${port}`;

  fs.mkdirSync(path.dirname(options.logFile), { recursive: true });
  const logStream = fs.createWriteStream(options.logFile, { flags: 'w' });

  // 已有服务在跑且允许复用时，直接拿来用。
  if (options.reuseExisting) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) {
        logStream.end();
        return { baseUrl, port, logFile: options.logFile, stop: async () => {} };
      }
    } catch {
      /* 没在跑，继续正常启动流程 */
    }
  }

  const tsxBin = resolveTsxBin();
  const args = [path.join(repoRoot(), 'scripts', 'dev-demo.ts')];
  if (reset) args.push('--reset');

  await assertPortFree(port);

  const child: ChildProcessByStdio<null, Readable, Readable> = spawn(tsxBin, args, {
    cwd: repoRoot(),
    env: {
      ...process.env,
      PORT: String(port),
      PLAYWRIGHT_TEST: '1',
      NODE_ENV: process.env.NODE_ENV || 'development',
      // 注意：**不要**改写 OPENLEARN_DATA_DIR。
      //
      // 加密密钥文件的位置是从它派生的（`getStorageDir() = join(dataDir, 'storage')`），
      // 改了就等于换了一把钥匙：已有密文（班级口令等）解不开，巡检会在
      // ENCRYPTION_KEY_MISMATCH 上直接死掉。演示库本来就是独立的
      // （storage/demo.db），数据隔离不靠这个变量。
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.pipe(logStream, { end: false });
  child.stderr.pipe(logStream, { end: false });

  let exited = false;
  child.on('exit', () => {
    exited = true;
  });

  const stop = async (): Promise<void> => {
    if (exited) {
      logStream.end();
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* 已经退出 */
        }
        resolve();
      }, 8000);

      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });

      try {
        child.kill('SIGTERM');
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
    logStream.end();
  };

  try {
    await waitForHealth(baseUrl, options.logFile);
  } catch (err) {
    await stop();
    throw err;
  }

  return { baseUrl, port, logFile: options.logFile, stop };
}
