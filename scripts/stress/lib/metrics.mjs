/**
 * scripts/stress/lib/metrics.mjs
 * 高精度指标收集与统计工具：延迟百分位数、吞吐率、错误分类、事件循环延迟、系统资源采样
 */
import os from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

/**
 * 获取硬件与环境规格信息
 */
export function getSystemInfo() {
  const cpus = os.cpus();
  const cpuModel = cpus.length > 0 ? cpus[0].model : 'Unknown CPU';
  const cpuCount = cpus.length;
  const totalRamGb = (os.totalmem() / (1024 * 1024 * 1024)).toFixed(1);

  let diskInfo = 'SSD / Fast Storage';
  try {
    if (process.platform === 'linux') {
      const output = execSync('lsblk -d -o name,rota,type,size,model 2>/dev/null', { encoding: 'utf8' });
      const lines = output.trim().split('\n').slice(1);
      const disks = lines
        .map((l) => l.trim().split(/\s+/))
        .filter((parts) => parts[1] === '0' || parts[1] === '1')
        .map((parts) =>
          `${parts[0]} (${parts[1] === '0' ? 'NVMe/SSD' : 'HDD'}, ${parts[3] || ''} ${parts.slice(4).join(' ')})`.trim(),
        );
      if (disks.length > 0) {
        diskInfo = disks.join('; ');
      }
    }
  } catch {
    // 忽略探测失败
  }

  return {
    os: `${os.type()} ${os.release()} (${os.arch()})`,
    nodeVersion: process.version,
    cpuModel,
    cpuCount,
    totalRamGb: `${totalRamGb} GB`,
    diskInfo,
  };
}

/**
 * 百分位数计算工具
 */
export function calculatePercentile(sortedValues, p) {
  if (sortedValues.length === 0) return 0;
  if (p <= 0) return sortedValues[0];
  if (p >= 100) return sortedValues[sortedValues.length - 1];
  const index = (p / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

/**
 * 格式化数值为保留两位小数
 */
function num(val) {
  if (val === null || val === undefined || isNaN(val)) return '0.00';
  return Number(val).toFixed(2);
}

/**
 * 单项操作指标聚合计算
 */
export function summarizeLatencies(latencies) {
  if (!latencies || latencies.length === 0) {
    return {
      count: 0,
      p50: 0,
      p90: 0,
      p95: 0,
      p99: 0,
      p999: 0,
      min: 0,
      max: 0,
      avg: 0,
    };
  }

  // 升序排序
  const sorted = Array.from(latencies).sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((acc, v) => acc + v, 0);

  return {
    count,
    p50: calculatePercentile(sorted, 50),
    p90: calculatePercentile(sorted, 90),
    p95: calculatePercentile(sorted, 95),
    p99: calculatePercentile(sorted, 99),
    p999: calculatePercentile(sorted, 99.9),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: sum / count,
  };
}

/**
 * 压测指标收集器 (Metrics Collector)
 */
export class MetricsCollector {
  constructor(options = {}) {
    this.name = options.name || 'Benchmark';
    this.operationBuckets = {
      read_list: [],
      read_agg: [],
      write_small: [],
      write_medium: [],
      write_heartbeat: [],
    };
    this.errorCounts = {
      sqlite_busy: 0,
      busy_timeout: 0,
      sqlite_locked: 0,
      other_error: 0,
    };
    this.httpStatuses = {};

    this.resourceSamples = [];
    this.walSizeSamples = [];
    this.startTime = 0;
    this.endTime = 0;
    this.eventLoopHistogram = null;
    this.sampleInterval = null;
    this.dbPath = options.dbPath || null;
    this.lastCpuUsage = null;
    this.lastSampleTime = 0;
  }

  start() {
    this.startTime = performance.now();
    this.lastSampleTime = this.startTime;
    this.lastCpuUsage = process.cpuUsage();

    // 启动 Node 事件循环延迟监控（10ms 分辨率）
    try {
      this.eventLoopHistogram = monitorEventLoopDelay({ resolution: 10 });
      this.eventLoopHistogram.enable();
    } catch {
      this.eventLoopHistogram = null;
    }

    // 定期采样 CPU、内存及 WAL 大小（每秒一次）
    this.sampleInterval = setInterval(() => {
      this.sampleResources();
    }, 1000);
    this.sampleInterval.unref();
  }

  stop() {
    this.endTime = performance.now();
    if (this.sampleInterval) {
      clearInterval(this.sampleInterval);
      this.sampleInterval = null;
    }
    if (this.eventLoopHistogram) {
      try {
        this.eventLoopHistogram.disable();
      } catch {
        // ignore
      }
    }
    this.sampleResources();
  }

  recordOperation(opType, latencyMs) {
    if (!this.operationBuckets[opType]) {
      this.operationBuckets[opType] = [];
    }
    this.operationBuckets[opType].push(latencyMs);
  }

  recordError(errorType) {
    if (this.errorCounts[errorType] !== undefined) {
      this.errorCounts[errorType]++;
    } else {
      this.errorCounts.other_error++;
    }
  }

  recordHttpStatus(statusCode) {
    this.httpStatuses[statusCode] = (this.httpStatuses[statusCode] || 0) + 1;
  }

  mergeWorkerResults(workerReport) {
    if (!workerReport) return;
    if (workerReport.operationBuckets) {
      for (const [op, latencies] of Object.entries(workerReport.operationBuckets)) {
        if (!this.operationBuckets[op]) this.operationBuckets[op] = [];
        this.operationBuckets[op].push(...latencies);
      }
    }
    if (workerReport.errorCounts) {
      for (const [err, count] of Object.entries(workerReport.errorCounts)) {
        this.errorCounts[err] = (this.errorCounts[err] || 0) + count;
      }
    }
    if (workerReport.httpStatuses) {
      for (const [status, count] of Object.entries(workerReport.httpStatuses)) {
        this.httpStatuses[status] = (this.httpStatuses[status] || 0) + count;
      }
    }
  }

  sampleResources() {
    const now = performance.now();
    const elapsedMs = now - this.lastSampleTime;
    if (elapsedMs <= 0) return;

    let cpuPercent = 0;
    if (this.lastCpuUsage) {
      const currentCpu = process.cpuUsage();
      const userDiff = currentCpu.user - this.lastCpuUsage.user;
      const sysDiff = currentCpu.system - this.lastCpuUsage.system;
      const totalDiffUs = userDiff + sysDiff;
      // 微秒转为毫秒比率，并按多核容量折算百分比
      cpuPercent = Math.min(100 * os.cpus().length, (totalDiffUs / (elapsedMs * 1000)) * 100);
      this.lastCpuUsage = currentCpu;
    }
    this.lastSampleTime = now;

    const mem = process.memoryUsage();
    const rssMb = mem.rss / (1024 * 1024);

    let walSizeKb = 0;
    if (this.dbPath) {
      const walPath = `${this.dbPath}-wal`;
      try {
        if (fs.existsSync(walPath)) {
          const st = fs.statSync(walPath);
          walSizeKb = st.size / 1024;
        }
      } catch {
        // ignore
      }
    }

    this.resourceSamples.push({
      timestamp: Date.now(),
      cpuPercent,
      rssMb,
      walSizeKb,
    });
  }

  getReport(params = {}) {
    const durationSec = Math.max(0.001, (this.endTime - this.startTime) / 1000);

    // 聚合读与写操作
    const readLatencies = [...(this.operationBuckets.read_list || []), ...(this.operationBuckets.read_agg || [])];
    const writeLatencies = [
      ...(this.operationBuckets.write_small || []),
      ...(this.operationBuckets.write_medium || []),
      ...(this.operationBuckets.write_heartbeat || []),
    ];
    const allLatencies = [...readLatencies, ...writeLatencies];

    const stats = {
      read_list: summarizeLatencies(this.operationBuckets.read_list),
      read_agg: summarizeLatencies(this.operationBuckets.read_agg),
      write_small: summarizeLatencies(this.operationBuckets.write_small),
      write_medium: summarizeLatencies(this.operationBuckets.write_medium),
      write_heartbeat: summarizeLatencies(this.operationBuckets.write_heartbeat),
      all_read: summarizeLatencies(readLatencies),
      all_write: summarizeLatencies(writeLatencies),
      total: summarizeLatencies(allLatencies),
    };

    // 吞吐率
    const throughput = {
      totalOps: allLatencies.length,
      totalOpsSec: allLatencies.length / durationSec,
      readOps: readLatencies.length,
      readOpsSec: readLatencies.length / durationSec,
      writeOps: writeLatencies.length,
      writeOpsSec: writeLatencies.length / durationSec,
      durationSec,
    };

    // 事件循环延迟（从纳秒换算为毫秒）
    let eventLoop = { p50: 0, p90: 0, p95: 0, p99: 0, max: 0, mean: 0 };
    if (this.eventLoopHistogram) {
      eventLoop = {
        p50: this.eventLoopHistogram.percentile(50) / 1e6,
        p90: this.eventLoopHistogram.percentile(90) / 1e6,
        p95: this.eventLoopHistogram.percentile(95) / 1e6,
        p99: this.eventLoopHistogram.percentile(99) / 1e6,
        max: this.eventLoopHistogram.max / 1e6,
        mean: this.eventLoopHistogram.mean / 1e6,
      };
    }

    // 资源均值与峰值
    const cpuSamples = this.resourceSamples.map((s) => s.cpuPercent);
    const rssSamples = this.resourceSamples.map((s) => s.rssMb);
    const walSamples = this.resourceSamples.map((s) => s.walSizeKb);

    const resources = {
      avgCpuPercent: cpuSamples.length ? cpuSamples.reduce((a, b) => a + b, 0) / cpuSamples.length : 0,
      maxCpuPercent: cpuSamples.length ? Math.max(...cpuSamples) : 0,
      avgRssMb: rssSamples.length ? rssSamples.reduce((a, b) => a + b, 0) / rssSamples.length : 0,
      maxRssMb: rssSamples.length ? Math.max(...rssSamples) : 0,
      maxWalSizeKb: walSamples.length ? Math.max(...walSamples) : 0,
      latestWalSizeKb: walSamples.length ? walSamples[walSamples.length - 1] : 0,
    };

    const totalOps = allLatencies.length;
    const totalErrors =
      this.errorCounts.sqlite_busy +
      this.errorCounts.busy_timeout +
      this.errorCounts.sqlite_locked +
      this.errorCounts.other_error;
    const errorRate = totalOps > 0 ? (totalErrors / (totalOps + totalErrors)) * 100 : 0;

    // 验收标准判定（Issue #407）
    // 1. 无非预期的 SQLITE_BUSY / 超时 / 5xx
    // 2. 写操作 p95 < 100ms
    // 3. 读操作 p95 < 50ms
    // 4. 事件循环 p99 < 200ms
    const criteria = {
      noUnexpectedBusy: this.errorCounts.sqlite_busy === 0 && this.errorCounts.busy_timeout === 0,
      writeP95Ok: stats.all_write.count === 0 || stats.all_write.p95 < 100,
      readP95Ok: stats.all_read.count === 0 || stats.all_read.p95 < 50,
      eventLoopP99Ok: eventLoop.p99 < 200,
    };
    criteria.allPassed =
      criteria.noUnexpectedBusy && criteria.writeP95Ok && criteria.readP95Ok && criteria.eventLoopP99Ok;

    return {
      name: this.name,
      params,
      system: getSystemInfo(),
      throughput,
      stats,
      eventLoop,
      resources,
      errors: {
        ...this.errorCounts,
        totalErrors,
        errorRate,
      },
      httpStatuses: this.httpStatuses,
      criteria,
    };
  }

  printConsoleSummary(report) {
    console.log('\n================================================================================');
    console.log(`  OpenLearn V2 SQLite 压力测试报告: ${report.name}`);
    console.log('================================================================================');
    console.log(
      `• 系统规格:   ${report.system.cpuModel} (${report.system.cpuCount} 核) | 内存: ${report.system.totalRamGb}`,
    );
    console.log(`• 磁盘类型:   ${report.system.diskInfo}`);
    console.log(`• Node 版本:  ${report.system.nodeVersion} on ${report.system.os}`);
    console.log(`• 测试时长:   ${num(report.throughput.durationSec)}s | 总请求数: ${report.throughput.totalOps}`);
    console.log(
      `• 综合吞吐:   ${num(report.throughput.totalOpsSec)} ops/s (读: ${num(report.throughput.readOpsSec)} | 写: ${num(report.throughput.writeOpsSec)})`,
    );
    console.log(
      `• 错误统计:   总错误 ${report.errors.totalErrors} (SQLITE_BUSY: ${report.errors.sqlite_busy}, 超时: ${report.errors.busy_timeout}, 错误率: ${num(report.errors.errorRate)}%)`,
    );
    console.log(
      `• 事件循环:   p50: ${num(report.eventLoop.p50)}ms | p95: ${num(report.eventLoop.p95)}ms | p99: ${num(report.eventLoop.p99)}ms | Max: ${num(report.eventLoop.max)}ms`,
    );
    console.log(
      `• 资源占用:   CPU 均值: ${num(report.resources.avgCpuPercent)}% (峰值: ${num(report.resources.maxCpuPercent)}%) | RSS: ${num(report.resources.maxRssMb)} MB | WAL 峰值: ${(report.resources.maxWalSizeKb / 1024).toFixed(2)} MB`,
    );
    console.log('--------------------------------------------------------------------------------');
    console.log('操作类型                      请求数    占比    p50(ms)  p95(ms)  p99(ms)  Max(ms)   Ops/s');
    console.log('--------------------------------------------------------------------------------');

    const totalOps = Math.max(1, report.throughput.totalOps);
    const rows = [
      { name: '课件/作业列表 (读)', s: report.stats.read_list },
      { name: '报表/聚合统计 (读)', s: report.stats.read_agg },
      { name: '全部读操作汇总', s: report.stats.all_read, highlight: true },
      { name: '白板/互动状态 (写)', s: report.stats.write_small },
      { name: '成绩/作业提交 (写)', s: report.stats.write_medium },
      { name: '心跳/会话刷新 (写)', s: report.stats.write_heartbeat },
      { name: '全部写操作汇总', s: report.stats.all_write, highlight: true },
      { name: '总体负载汇总', s: report.stats.total, highlight: true },
    ];

    for (const r of rows) {
      const share = ((r.s.count / totalOps) * 100).toFixed(1) + '%';
      const ops = (r.s.count / report.throughput.durationSec).toFixed(1);
      const prefix = r.highlight ? '★ ' : '  ';
      const nameCol = (prefix + r.name).padEnd(28, ' ');
      const countCol = String(r.s.count).padStart(7, ' ');
      const shareCol = share.padStart(7, ' ');
      const p50Col = num(r.s.p50).padStart(8, ' ');
      const p95Col = num(r.s.p95).padStart(8, ' ');
      const p99Col = num(r.s.p99).padStart(8, ' ');
      const maxCol = num(r.s.max).padStart(8, ' ');
      const opsCol = ops.padStart(8, ' ');
      console.log(`${nameCol}${countCol}${shareCol}${p50Col}${p95Col}${p99Col}${maxCol}${opsCol}`);
    }

    console.log('--------------------------------------------------------------------------------');
    console.log('【Issue #407 验收标准核对】:');
    console.log(
      `  1. 无非预期 SQLITE_BUSY / 超时:     ${report.criteria.noUnexpectedBusy ? '✓ 通过' : '✗ 未通过'} (Busy: ${report.errors.sqlite_busy}, Timeout: ${report.errors.busy_timeout})`,
    );
    console.log(
      `  2. 写操作 p95 < 100ms:             ${report.criteria.writeP95Ok ? '✓ 通过' : '✗ 未通过'} (实测: ${num(report.stats.all_write.p95)}ms)`,
    );
    console.log(
      `  3. 读操作 p95 < 50ms:              ${report.criteria.readP95Ok ? '✓ 通过' : '✗ 未通过'} (实测: ${num(report.stats.all_read.p95)}ms)`,
    );
    console.log(
      `  4. 事件循环 p99 延迟 < 200ms:       ${report.criteria.eventLoopP99Ok ? '✓ 通过' : '✗ 未通过'} (实测: ${num(report.eventLoop.p99)}ms)`,
    );
    console.log(`  => 总体验收判定:                   ${report.criteria.allPassed ? '🟢 ALL PASSED' : '🔴 FAILED'}`);
    console.log('================================================================================\n');
  }
}
