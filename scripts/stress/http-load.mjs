#!/usr/bin/env node
/**
 * scripts/stress/http-load.mjs
 * OpenLearn V2 HTTP 端到端业务负载全链路压力测试引擎
 *
 * 走真实 Express 接口：
 *   健康轮询 -> 虚拟学生登录 -> 会话 Cookie 维护 ->
 *   拉课件列表 (50%) -> 课堂晴雨表 (25%) -> 作业提交 (10%) -> 心跳会话刷新 (10%) -> 聚合慢查 (5%)
 *
 * 用法：
 *   node scripts/stress/http-load.mjs --url http://127.0.0.1:9000 --concurrency 100 --duration 300
 *   node scripts/stress/http-load.mjs -c 50 -d 30
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MetricsCollector } from './lib/metrics.mjs';

const __filename = fileURLToPath(import.meta.url);

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    url: process.env.BASE_URL || 'http://127.0.0.1:9000',
    concurrency: 100,
    duration: 300,
    rampup: 30,
    thinkMin: 200,
    thinkMax: 800,
    profile: 'mixed',
    jsonOut: null,
    silent: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-u' || arg === '--url') {
      options.url = args[++i];
    } else if (arg === '-c' || arg === '--concurrency') {
      options.concurrency = parseInt(args[++i], 10);
    } else if (arg === '-d' || arg === '--duration') {
      options.duration = parseInt(args[++i], 10);
    } else if (arg === '-r' || arg === '--rampup') {
      options.rampup = parseInt(args[++i], 10);
    } else if (arg === '-p' || arg === '--profile') {
      options.profile = args[++i];
    } else if (arg === '--think-min') {
      options.thinkMin = parseInt(args[++i], 10);
    } else if (arg === '--think-max') {
      options.thinkMax = parseInt(args[++i], 10);
    } else if (arg === '--json-out') {
      options.jsonOut = path.resolve(args[++i]);
    } else if (arg === '--silent') {
      options.silent = true;
    } else if (arg === '-h' || arg === '--help') {
      console.log(`
OpenLearn V2 HTTP 端到端压力测试工具 (http-load.mjs)

参数选项:
  -u, --url <url>         目标服务根地址 (默认: http://127.0.0.1:9000)
  -c, --concurrency <n>   并发用户数 (默认: 100)
  -d, --duration <s>      压测时长 (秒, 默认: 300)
  -r, --rampup <s>        爬坡时间 (秒, 默认: 30)
  -p, --profile <name>    负载类型: 'mixed', 'read-only', 'write-only' (默认: mixed)
  --think-min <ms>        思考时间下限 (默认: 200)
  --think-max <ms>        思考时间上限 (默认: 800)
  --json-out <file>       JSON 报告输出路径
      `);
      process.exit(0);
    }
  }

  return options;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickAction(prof) {
  const rand = Math.random() * 100;
  if (prof === 'read-only') {
    if (rand < 90) return 'read_list';
    return 'read_agg';
  }
  if (prof === 'write-only') {
    if (rand < 55) return 'write_small';
    if (rand < 80) return 'write_medium';
    return 'write_heartbeat';
  }
  if (rand < 50) return 'read_list';
  if (rand < 75) return 'write_small';
  if (rand < 85) return 'write_medium';
  if (rand < 95) return 'write_heartbeat';
  return 'read_agg';
}

/**
 * 轮询检测服务器是否就绪 (/health/ready)
 */
async function waitForServerReady(baseUrl, maxWaitSec = 60) {
  const start = Date.now();
  const readyUrl = `${baseUrl.replace(/\/$/, '')}/health/ready`;
  const healthUrl = `${baseUrl.replace(/\/$/, '')}/health`;

  while ((Date.now() - start) / 1000 < maxWaitSec) {
    try {
      const res = await fetch(readyUrl, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      try {
        const hRes = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) });
        if (hRes.ok) return true;
      } catch {
        // 继续等待
      }
    }
    await sleep(1000);
  }
  throw new Error(`服务器未在 ${maxWaitSec}s 内就绪: ${baseUrl}`);
}

export async function runHttpStressTest(options = {}) {
  const config = {
    url: process.env.BASE_URL || 'http://127.0.0.1:9000',
    concurrency: 100,
    duration: 300,
    rampup: 30,
    thinkMin: 200,
    thinkMax: 800,
    profile: 'mixed',
    jsonOut: null,
    silent: false,
    ...options,
  };

  const baseUrl = config.url.replace(/\/$/, '');

  if (!config.silent) {
    console.log(`\n[StressHTTP] 等待服务就绪: ${baseUrl}...`);
  }
  await waitForServerReady(baseUrl, 45);
  if (!config.silent) {
    console.log(`[StressHTTP] 目标服务已就绪！开始登录与会话初始化 (${config.concurrency} 并发用户)...`);
  }

  // 1. 登录用户以获取会话 Cookie
  // 如果是演示模式下的默认学生（DEMO-S01 ~ DEMO-S12），或播种学生
  const users = [];
  const loginPromises = [];

  for (let i = 1; i <= config.concurrency; i++) {
    const studentNumber = i <= 12 ? `DEMO-S${String(i).padStart(2, '0')}` : `S${String(i).padStart(4, '0')}`;
    const studentId = studentNumber;

    loginPromises.push(
      (async () => {
        try {
          const res = await fetch(`${baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              entrance: 'student',
              studentId,
              password: '123456',
            }),
            signal: AbortSignal.timeout(5000),
          });

          let cookie = '';
          const setCookie = res.headers.get('set-cookie');
          if (setCookie) {
            const match = setCookie.match(/edu_os_token=([^;]+)/);
            if (match) {
              cookie = `edu_os_token=${match[1]}`;
            }
          }

          return {
            id: `user_${i}`,
            studentId,
            cookie,
            loggedIn: res.status === 200,
          };
        } catch {
          return {
            id: `user_${i}`,
            studentId,
            cookie: '',
            loggedIn: false,
          };
        }
      })(),
    );
  }

  const loginResults = await Promise.all(loginPromises);
  const loggedInCount = loginResults.filter((u) => u.loggedIn).length;

  if (!config.silent) {
    console.log(`[StressHTTP] 用户凭证准备就绪: ${loggedInCount}/${config.concurrency} 成功取得会话 Cookie`);
  }

  // 2. 探查可用的课件与会话列表
  let availableLessonId = 'lesson-1';
  let availableAssignId = 'asg_01';
  try {
    const teacherToken = 'token_usr_teacher';
    const lRes = await fetch(`${baseUrl}/api/lessons`, {
      headers: { Cookie: `edu_os_token=${teacherToken}` },
      signal: AbortSignal.timeout(3000),
    });
    if (lRes.ok) {
      const lessons = await lRes.json();
      if (Array.isArray(lessons) && lessons.length > 0) {
        availableLessonId = lessons[0].id || availableLessonId;
      }
    }
  } catch {
    // ignore
  }

  const metrics = new MetricsCollector({
    name: `HTTP End-to-End Load Test - ${config.concurrency} 并发 / ${config.profile}`,
  });

  const durationMs = config.duration * 1000;
  const rampupMs = config.rampup * 1000;
  const stopTime = Date.now() + durationMs;

  metrics.start();

  let liveTicker = null;
  if (!config.silent) {
    const startTime = Date.now();
    liveTicker = setInterval(() => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      process.stdout.write(
        `\r  > [Running HTTP] 压测进度: ${elapsed}s / ${config.duration}s | 并发: ${config.concurrency} ...   `,
      );
    }, 2000);
    liveTicker.unref();
  }

  const pacingSignals = ['too_fast', 'too_slow', 'got_it', 'confused'];

  async function runHttpVirtualUser(user, index, total) {
    if (rampupMs > 0 && total > 0) {
      const delay = (index / total) * rampupMs;
      await sleep(delay);
    }

    const headers = {
      'Content-Type': 'application/json',
      ...(user.cookie ? { Cookie: user.cookie } : {}),
    };

    let counter = 0;
    while (Date.now() < stopTime) {
      counter++;
      const action = pickAction(config.profile);
      const t0 = performance.now();

      try {
        let res;
        if (action === 'read_list') {
          res = await fetch(`${baseUrl}/api/lessons`, { headers, signal: AbortSignal.timeout(5000) });
          if (res.ok) {
            await fetch(`${baseUrl}/api/lessons/${availableLessonId}`, { headers, signal: AbortSignal.timeout(5000) });
          }
        } else if (action === 'read_agg') {
          res = await fetch(`${baseUrl}/api/classroom/top-performers`, { headers, signal: AbortSignal.timeout(5000) });
        } else if (action === 'write_small') {
          const sig = pacingSignals[counter % pacingSignals.length];
          res = await fetch(`${baseUrl}/api/classroom/sessions/${availableLessonId}/pacing`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ signal: sig, segmentId: 'seg-1' }),
            signal: AbortSignal.timeout(5000),
          });
        } else if (action === 'write_medium') {
          res = await fetch(`${baseUrl}/api/assignments/${availableAssignId}/submissions`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              studentId: user.studentId,
              content: 'HTTP 压测提交作答内容',
            }),
            signal: AbortSignal.timeout(5000),
          });
        } else if (action === 'write_heartbeat') {
          res = await fetch(`${baseUrl}/api/auth/session`, { headers, signal: AbortSignal.timeout(5000) });
        }

        const elapsed = performance.now() - t0;
        metrics.recordOperation(action, elapsed);
        if (res) {
          metrics.recordHttpStatus(res.status);
          if (res.status >= 500) {
            metrics.recordError('server_error_5xx');
          } else if (res.status === 429) {
            metrics.recordError('rate_limited_429');
          }
        }
      } catch (err) {
        const elapsed = performance.now() - t0;
        if (elapsed >= 4900) {
          metrics.recordError('busy_timeout');
        } else {
          metrics.recordError('other_error');
        }
      }

      const think = randomBetween(config.thinkMin, config.thinkMax);
      await sleep(think);
    }
  }

  try {
    const promises = loginResults.map((u, idx) => runHttpVirtualUser(u, idx, loginResults.length));
    await Promise.all(promises);
  } finally {
    if (liveTicker) {
      clearInterval(liveTicker);
      process.stdout.write('\r                                                                                \r');
    }
    metrics.stop();
  }

  const report = metrics.getReport({
    url: baseUrl,
    concurrency: config.concurrency,
    duration: config.duration,
    rampup: config.rampup,
    profile: config.profile,
  });

  if (!config.silent) {
    metrics.printConsoleSummary(report);
  }

  if (config.jsonOut) {
    fs.mkdirSync(path.dirname(config.jsonOut), { recursive: true });
    fs.writeFileSync(config.jsonOut, JSON.stringify(report, null, 2), 'utf8');
    if (!config.silent) {
      console.log(`[StressHTTP] JSON 报告已持久化至: ${config.jsonOut}`);
    }
  }

  return report;
}

if (process.argv[1] === __filename) {
  const options = parseArgs();
  runHttpStressTest(options).catch((err) => {
    console.error('HTTP Stress test fatal error:', err);
    process.exit(1);
  });
}
