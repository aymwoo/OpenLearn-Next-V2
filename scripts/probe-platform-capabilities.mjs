/**
 * 平台能力探针 —— 把「在 Linux 上无法验证、但在 Windows 上可能不同」的几件事
 * 变成可执行检查。
 *
 * ## 为什么要它
 *
 * L-1（进程隔离）与 L-2（bootstrap/PluginHost 拆分）全部在 **Linux** 上开发与验证：
 * CI 的 6 个 job 无一例外是 `ubuntu-latest`，仓库里没有任何 Windows 平台分支。
 * 而产品的主要用户据称在 Windows 上。
 *
 * 于是有几件事处于「未知」状态，而其中任何一件为「否」都会让某个默认行为失效：
 *
 * | 待验证 | 若为「否」的后果 |
 * | --- | --- |
 * | `--permission` 可用 | L-1 P2 的权限收敛整个失效；我把它**默认开启**，插件会直接起不来 |
 * | `--disallow-code-generation-from-strings` 可用 | eval/new Function 禁令失效 |
 * | 子进程 IPC + `serialization:'advanced'` | L-1 P1 的子进程原语无法工作 |
 * | `createRequire('<cwd>/package.json')` 归一化路径可用 | `ctx.require` 共享模块全部解析失败 |
 * | 信号终止后 `exit` 的 `code` 为 null | 现有集成测试会在 Windows 上红 |
 *
 * 本脚本不修改任何状态，只报告。CI 里以 `continue-on-error` 运行 ——
 * 目的**不是**卡住合并，而是把上面这张表从「未知」变成「有据」。
 *
 * 用法：`node scripts/probe-platform-capabilities.mjs`
 */

import { spawn } from 'node:child_process';
import os from 'node:os';
import process from 'node:process';

const results = [];

function record(name, pass, detail) {
  results.push({ name, pass, detail });
}

/** 跑一段 node 代码，返回其 stdout（trim 后） */
function runNode(args, timeoutMs = 20_000) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    const child = spawn(process.execPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, out: out.trim(), err: err.trim() });
    });
  });
}

const PROBE_SRC = `
import fs from 'node:fs';
const r = (k, v) => process.stdout.write(k + '=' + v + '\\n');
try { fs.readFileSync('/etc/hostname', 'utf8'); r('fsReadOutside', 'UNRESTRICTED'); }
catch (e) { r('fsReadOutside', e.code || e.name); }
try { r('eval', eval('1+1')); } catch (e) { r('eval', 'DENIED:' + (e.name || '')); }
try { r('spawn', typeof require === 'function' ? 'cjs' : 'esm-no-require'); } catch (e) { r('spawn', 'ERR'); }
`;

// ── ① --permission 是否可用 ──
{
  const r = await runNode(['--permission', '--input-type=module', '--eval', PROBE_SRC]);
  const restricted = r.out.includes('ERR_ACCESS_DENIED');
  record(
    '--permission 生效（越界读被拒）',
    restricted,
    restricted ? r.out.replace(/\n/g, ' ') : `未受限或启动失败：${(r.err || r.out).slice(0, 120)}`,
  );
}

// ── ② --disallow-code-generation-from-strings 是否可用 ──
{
  const src =
    "try { process.stdout.write('eval=' + eval('1+1')) } catch (e) { process.stdout.write('eval=DENIED:' + e.name) }";
  const withFlag = await runNode(['--disallow-code-generation-from-strings', '--input-type=module', '--eval', src]);
  const denied = withFlag.out.includes('DENIED:EvalError');
  const without = await runNode(['--input-type=module', '--eval', src]);
  record(
    '--disallow-code-generation-from-strings 生效',
    denied && !without.out.includes('DENIED'),
    `带旗标=${withFlag.out}｜不带=${without.out}`,
  );
}

// ── ③ 子进程 IPC + serialization advanced ──
{
  const r = await runNode([
    '--input-type=module',
    '--eval',
    `process.on('message', (m) => process.send({ echo: m.v, d: new Date(0), m: new Map([['k', 1]]) }));
       process.send('ready');`,
  ]);
  // 直接检查 IPC 往返 + 复杂类型保真
  const roundTrip = await new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `process.on('message', (m) => process.send({ echo: m.v, d: new Date(0), m: new Map([['k', 1]]) }));
       process.send('ready');`,
      ],
      {
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        serialization: 'advanced',
        windowsHide: true,
      },
    );
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(null);
    }, 15_000);
    child.on('message', (m) => {
      if (m === 'ready') {
        child.send({ v: 'hi' });
        return;
      }
      clearTimeout(timer);
      child.kill('SIGKILL');
      resolve({
        dateSurvived: m.d instanceof Date,
        mapSurvived: m.m instanceof Map,
        echo: m.echo,
      });
    });
  });
  const ok = !!roundTrip && roundTrip.echo === 'hi' && roundTrip.dateSurvived && roundTrip.mapSurvived;
  record('子进程 IPC + serialization advanced（Date/Map 保真）', ok, ok ? 'OK' : JSON.stringify(roundTrip));
}

// ── ④ createRequire 用归一化路径作基址 ──
{
  const cwd = process.cwd();
  const normalized = cwd.replace(/\\/g, '/');
  const src = `
    import { createRequire } from 'node:module';
    try {
      const r = createRequire(${JSON.stringify(normalized + '/package.json')});
      process.stdout.write('uuid=' + typeof r('uuid'));
    } catch (e) { process.stdout.write('ERR=' + (e.code || e.message).slice(0, 60)); }
  `;
  const r = await runNode(['--input-type=module', '--eval', src]);
  const ok = r.out.includes('uuid=') && !r.out.includes('ERR=');
  record('createRequire(归一化 cwd/package.json) 能解析共享模块', ok, ok ? r.out : `${r.out} ${r.err.slice(0, 80)}`);
}

// ── ⑤ 信号终止后 exit 的 code 是否为 null（现有集成测试依赖这一点）──
{
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', 'while(true){}'], { stdio: 'ignore', windowsHide: true });
    child.on('exit', (c, s) => resolve({ c, s }));
    setTimeout(() => child.kill('SIGKILL'), 300);
    setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ c: 'TIMEOUT', s: null });
    }, 8000);
  });
  record(
    '被信号终止后 exit.code 为 null（现有集成测试依赖）',
    code.c === null,
    `code=${JSON.stringify(code.c)} signal=${JSON.stringify(code.s)}`,
  );
}

// ── ⑥ worker_threads 是否可用（P0 存活探活与 stage 1 隔离依赖）──
{
  // ⚠️ eval worker 在 Node 24 下按 **ESM** 求值（实测：写 require 会报
  //    'require is not defined in ES module scope'）。探针自己写错会给出
  //    假的「平台不支持」结论 —— 第一版就踩了这个坑。
  //    worker 源码用 JSON.stringify 嵌入：手写嵌套引号会被转义吃掉（实测）。
  const workerSrc = "import { parentPort } from 'node:worker_threads'; parentPort.postMessage('ok')";
  const main = `import { Worker } from 'node:worker_threads';
const w = new Worker(${JSON.stringify(workerSrc)}, { eval: true });
w.on('message', (m) => process.stdout.write('wt=' + m));
w.on('error', (e) => process.stdout.write('wt=ERR:' + (e.code || e.message)));`;
  const r = await runNode(['--input-type=module', '--eval', main]);
  record('worker_threads 可用', r.out.includes('wt=ok'), r.out || r.err.slice(0, 100));
}

// ── 报告 ──
const lines = [];
lines.push(`平台: ${os.platform()} ${os.release()} / Node ${process.version} / 核数 ${os.cpus().length}`);
lines.push('');
const w = Math.max(...results.map((r) => r.name.length)) + 2;
for (const r of results) {
  lines.push(`${r.pass ? '✅' : '❌'} ${r.name.padEnd(w)} ${r.detail}`);
}
const failed = results.filter((r) => !r.pass);
lines.push('');
lines.push(failed.length === 0 ? `全部 ${results.length} 项通过` : `${failed.length}/${results.length} 项失败`);
const report = lines.join('\n');
console.log(report);

// 供 CI 上传为 artifact
try {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync('dist', { recursive: true });
  writeFileSync('dist/platform-capability-report.txt', report + '\n');
} catch {
  /* 写文件失败不影响报告本身 */
}

process.exitCode = failed.length === 0 ? 0 : 1;
