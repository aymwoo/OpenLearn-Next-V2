/**
 * P1 前置验证：跨进程 IPC 的序列化语义必须与 worker_threads 一致。
 *
 * ## 为什么这个测试是 P1 的前提，而不是 P1 的一部分
 *
 * bootstrap 里有 **25 处** `parentPort.postMessage(...)`。若子进程 transport 能提供
 * 同名方法，就不必「重写 transport」（提案的评估），只需在 bootstrap 顶部加一个
 * 几行的 shim（`parentPort` → `process.send`，`workerData` → env/argv）。
 *
 * 但这个前提成立与否，取决于**两边序列化语义是否一致**。不一致的后果不是报错，
 * 而是**静默降级**：下游拿到错误形状的数据，代码照跑，bug 出现在别处。
 *
 * ## 实测结论（Node 24 / Linux）
 *
 * `spawn(..., { serialization: 'json' })`（默认）：**13 个探针里 10 个不一致**
 *   Date → string、Map/Set/RegExp/Error → {}、undefined 字段被丢弃、
 *   NaN/Infinity → null、BigInt → `process.send` 直接抛、循环引用 → 直接抛
 *
 * `spawn(..., { serialization: 'advanced' })`（v8.serialize）：**13 个探针 0 个不一致**
 *
 * ⇒ P1 必须显式使用 `serialization: 'advanced'`。这个结论若哪天失效
 * （Node 改默认值、或有人图省事去掉该选项），本测试会立刻红 ——
 * 而失效的后果是运行期静默数据损坏，不会有人当场发现。
 *
 * ## 本测试自身的两次修正（留档）
 *
 * 初版在**发送侧**渲染后再比较，于是三列比较的是同一个东西，
 * 得出「0/13 不一致」的假象；改成在**接收侧**用 `instanceof` / `typeof`
 * 判定类型是否存活，才测出真实的 10/13。这是本会话第三次「测错了对象」。
 */

import { describe, it, expect } from 'vitest';
import { Worker } from 'node:worker_threads';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PROBE_NAMES = [
  '基础类型',
  '嵌套',
  'Date字段',
  'Date顶层',
  'Map',
  'Set',
  'RegExp',
  'undefined字段',
  'NaN_Infinity',
  'BigInt',
  '循环引用',
  'Error实例',
] as const;

/** 接收侧判定：只看「类型还活着吗」 */
function inspect(v: any): string {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  const t = typeof v;
  if (t === 'bigint') return `bigint(${v})`;
  if (v instanceof Date) return `Date(${v.toISOString()})`;
  if (v instanceof Map) return `Map{${JSON.stringify([...v])}}`;
  if (v instanceof Set) return `Set{${JSON.stringify([...v])}}`;
  if (v instanceof RegExp) return `RegExp(${v.source})`;
  if (v instanceof Error) return `Error(${v.message})`;
  if (t === 'object') {
    if (Array.isArray(v)) return 'Array' + JSON.stringify(v);
    return (
      '{' +
      Object.keys(v)
        .sort()
        .map((k) => `${k}:${inspect(v[k])}`)
        .join(',') +
      '}'
    );
  }
  if (t === 'number') {
    if (Number.isNaN(v)) return 'NaN';
    if (v === Infinity) return 'Infinity';
    if (v === -Infinity) return '-Infinity';
    return `num(${v})`;
  }
  return `${t}(${JSON.stringify(v)})`;
}

/** 被测值构造：worker 侧与子进程侧共用同一份源码 */
const MAKE_SRC = `
function __make(name) {
  switch (name) {
    case '基础类型': return { a: 1, b: 'x', c: true, d: null };
    case '嵌套': return { n: { deep: { deeper: [1, 2, 3] } } };
    case 'Date字段': return { d: new Date('2026-10-08T00:00:00Z') };
    case 'Date顶层': return new Date('2026-10-08T00:00:00Z');
    case 'Map': return { m: new Map([['k', 'v']]) };
    case 'Set': return { s: new Set([1, 2]) };
    case 'RegExp': return { r: /ab+c/gi };
    case 'undefined字段': return { u: undefined, keep: 1 };
    case 'NaN_Infinity': return { n: NaN, i: Infinity, ni: -Infinity };
    case 'BigInt': return { b: BigInt(10) };
    case '循环引用': { const o = { name: 'root' }; o.self = o; return o; }
    case 'Error实例': return { e: new Error('boom') };
    default: return null;
  }
}
const NAMES = ${JSON.stringify(PROBE_NAMES)};
function __collect(sendOne, sendDone) {
  const out = {};
  for (const name of NAMES) {
    let v;
    try { v = __make(name); } catch (e) { out[name] = 'MAKE_THROWS: ' + e.message; continue; }
    try { sendOne(name, v); } catch (e) { out[name] = 'SEND_THROWS: ' + e.message; }
  }
  sendDone(out);
}
`;

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'openlearn-ser-'));

async function runWorker(): Promise<Record<string, string>> {
  const file = path.join(TMP, 'w.mjs');
  fs.writeFileSync(
    file,
    `import { parentPort } from 'node:worker_threads';\n${MAKE_SRC}\n` +
      `parentPort.on('message', (m) => { if (m === 'go') __collect(\n` +
      `  (n, v) => parentPort.postMessage({ probe: n, sent: v }),\n` +
      `  (e) => parentPort.postMessage({ done: true, errors: e })); });\n`,
    'utf-8',
  );
  return new Promise((resolve) => {
    const w = new Worker(new URL(`file://${file}`), { eval: false });
    const out: Record<string, string> = {};
    w.on('message', (m: any) => {
      if (m.probe) {
        try {
          out[m.probe] = inspect(m.sent);
        } catch (e) {
          out[m.probe] = 'INSPECT_THROWS: ' + (e as Error).message;
        }
      } else if (m.done) {
        void w.terminate();
        resolve({ ...out, ...m.errors });
      }
    });
    w.postMessage('go');
  });
}

async function runChild(serialization: 'json' | 'advanced'): Promise<Record<string, string>> {
  const file = path.join(TMP, `c-${serialization}.mjs`);
  fs.writeFileSync(
    file,
    `${MAKE_SRC}\nprocess.on('message', (m) => { if (m === 'go') __collect(\n` +
      `  (n, v) => process.send({ probe: n, sent: v }),\n` +
      `  (e) => process.send({ done: true, errors: e })); });\n`,
    'utf-8',
  );
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [file], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      serialization,
    });
    const out: Record<string, string> = {};
    c.on('message', (m: any) => {
      if (m.probe) {
        try {
          out[m.probe] = inspect(m.sent);
        } catch (e) {
          out[m.probe] = 'INSPECT_THROWS: ' + (e as Error).message;
        }
      } else if (m.done) {
        c.kill();
        resolve({ ...out, ...m.errors });
      }
    });
    c.send('go');
  });
}

describe('P1 前置验证 · 跨进程 IPC 序列化必须与 worker_threads 一致', () => {
  it('serialization: advanced 与 worker_threads 逐项一致（P1 的前提成立）', async () => {
    const base = await runWorker();
    const adv = await runChild('advanced');

    const diffs = PROBE_NAMES.filter((k) => (adv[k] ?? 'X') !== (base[k] ?? 'X'));
    expect(
      diffs,
      'serialization: advanced 与 worker_threads 的序列化结果不一致 —— ' +
        'bootstrap 的 postMessage shim 就不能省，P1 需要额外的自定义序列化层。' +
        '不一致项：' +
        diffs.map((k) => `${k}(基准=${base[k]} vs advanced=${adv[k]})`).join('; '),
    ).toEqual([]);
  }, 60_000);

  it('默认 JSON 序列化确实会静默降级（记录基线，防有人误以为它也行）', async () => {
    const base = await runWorker();
    const json = await runChild('json');

    const diffs = PROBE_NAMES.filter((k) => (json[k] ?? 'X') !== (base[k] ?? 'X'));
    expect(
      diffs.length,
      '默认 JSON 序列化实测会降级（Date/Map/Set/RegExp/Error/undefined/NaN/BigInt/循环引用）。' +
        '若此用例失败，说明 Node 改了默认行为 —— 那 P1 侧仍应显式写 serialization: advanced，' +
        '不要依赖默认值。',
    ).toBeGreaterThanOrEqual(8);
  }, 60_000);
});
