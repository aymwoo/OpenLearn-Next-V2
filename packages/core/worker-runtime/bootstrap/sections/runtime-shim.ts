/**
 * Bootstrap section 1/5 · 运行时 shim（L-1 P1 阶段 2）。
 *
 * 同一份 bootstrap 同时支持 `worker_threads` 与 `child_process` 两种原语。
 * 判别方式刻意用「worker_threads 能不能拿到 parentPort」而不是 `isMainThread`
 * —— 主线程也拿得到 `isMainThread`（= true），用它当判据会反过来。
 *
 * 之所以要有 shim：实测两种原语在 `serialization:'advanced'` 下语义完全一致
 * （13 个探针 0 个不一致，`ipc-serialization-parity.test.ts` 守着），
 * 因此**不需要**自定义序列化层，只需把通道接口对齐成 `parentPort` 形状。
 */

export const RUNTIME_SHIM_SECTION = `
// ── 运行时 shim（P1 阶段 2）：同一份 bootstrap 同时支持 worker_threads 与子进程 ──
//
// 下面是本次唯一需要改的「通道接入」代码。实测过：worker_threads 与 child_process
// 在 serialization:'advanced' 下语义完全一致（ipc-serialization-parity.test.ts 守着，
// 13 个探针 0 个不一致），因此**不需要**自定义序列化层。
//
// 判别方式刻意用「worker_threads 能不能拿到 parentPort」而不是 isMainThread：
// 主线程也拿得到 isMainThread（= true），判据会反过来。
//
// ⚠️ 这段代码在模板字符串里，写注释时**不能出现反引号** —— 会提前终止模板。
const __wt = (() => {
  try {
    const wt = requireFn('node:worker_threads');
    return wt.parentPort ? wt : null;
  } catch {
    return null;
  }
})();

const parentPort = __wt
  ? __wt.parentPort
  : {
      // 子进程：child_process 的 ipc 通道。没有 parentPort，用 process.send。
      // 保持 postMessage / on / removeListener 三个方法同名，使下面**所有**调用点无需改动。
      postMessage: (m) => {
        if (process.send) process.send(m);
      },
      on: (ev, h) => process.on(ev, h),
      // ⚠️ 这一项是补上去的：初版 shim 只提供 postMessage / on，漏了 removeListener，
      // 而 bootstrap 的停用路径（handleDeactivate）会调用它。缺失时的表现是
      // **unhandledRejection**，被 bootstrap 自己的处理器吞掉 —— 于是测试照常全绿，
      // 只有 stderr 里一行警告。补 shim 时必须把 parentPort 的**全部**用到的方法对齐。
      removeListener: (ev, h) => process.removeListener(ev, h),
    };

// workerData 在 worker_threads 里是结构化克隆过来的对象；在子进程里只能走环境变量
// （跨进程只有字符串通道）。故用 JSON.parse 归一，两条路径拿到同一形状。
const workerData = __wt
  ? __wt.workerData
  : JSON.parse(process.env.__PLUGIN_WORKER_DATA || '{}');
`;
