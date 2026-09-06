import os from 'node:os';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 诊断指定端口是否可用
 * @param {number} port
 * @param {string} host
 * @returns {Promise<boolean>}
 */
export function checkPortAvailable(port, host = '0.0.0.0') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        resolve(false);
      }
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

/**
 * 获取本机所有局域网可用 IPv4 地址
 * @returns {string[]}
 */
export function getNetworkIps() {
  const ips = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('127.')) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

/**
 * 运行系统环境自检与健康诊断
 * @param {Object} [options]
 * @param {number} [options.port]
 * @param {string} [options.dbPath]
 * @param {boolean} [options.silent]
 * @returns {Promise<{ ok: boolean, checks: Array<{ name: string, status: 'ok'|'warn'|'err', message: string }> }>}
 */
export async function runDoctor(options = {}) {
  const checks = [];
  const silent = Boolean(options.silent);

  // 1. Node.js 版本检查 (>= 20.0.0)
  const nodeVersion = process.versions.node;
  const majorNodeVersion = parseInt(nodeVersion.split('.')[0], 10);
  if (majorNodeVersion >= 20) {
    checks.push({
      name: 'Node.js Runtime',
      status: 'ok',
      message: `v${nodeVersion} (满足 >= 20.0.0 要求)`,
    });
  } else {
    checks.push({
      name: 'Node.js Runtime',
      status: 'err',
      message: `v${nodeVersion} 过低！OpenLearn 核心需要 Node.js >= 20.0.0，请升级。`,
    });
  }

  // 2. 操作系统与硬件
  const cpus = os.cpus() || [];
  const totalMemGb = Math.round((os.totalmem() / 1024 / 1024 / 1024) * 10) / 10;
  const freeMemMb = Math.round(os.freemem() / 1024 / 1024);
  checks.push({
    name: 'Hardware & OS',
    status: 'ok',
    message: `${process.platform} (${process.arch}, ${cpus.length} CPU 核心, ${totalMemGb} GB 内存)`,
  });

  if (freeMemMb < 256) {
    checks.push({
      name: 'Memory Headroom',
      status: 'warn',
      message: `剩余可用内存偏低 (${freeMemMb} MB)，可能影响大课件解析`,
    });
  } else {
    checks.push({
      name: 'Memory Headroom',
      status: 'ok',
      message: `充足 (当前剩余 ${freeMemMb} MB 可用)`,
    });
  }

  // 3. 数据库目录与读写权限
  const dbPath = options.dbPath
    ? path.resolve(options.dbPath)
    : (process.env.OPENLEARN_DB_PATH
        ? path.resolve(process.env.OPENLEARN_DB_PATH)
        : path.join(os.homedir(), 'openlearn-next', 'data.db'));
  const dbDir = path.dirname(dbPath);

  try {
    fs.mkdirSync(dbDir, { recursive: true });
    // 测试临时写入
    const testFile = path.join(dbDir, `.doctor_write_test_${Date.now()}`);
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    checks.push({
      name: 'Database Storage',
      status: 'ok',
      message: `${dbPath} (目录正常且具备读写权限)`,
    });
  } catch (err) {
    checks.push({
      name: 'Database Storage',
      status: 'err',
      message: `目录 ${dbDir} 写入失败: ${err.message}`,
    });
  }

  // 4. 端口可用性检查
  const targetPort = options.port || parseInt(process.env.PORT || '9000', 10);
  const isPortAvailable = await checkPortAvailable(targetPort);
  if (isPortAvailable) {
    checks.push({
      name: `Port ${targetPort}`,
      status: 'ok',
      message: `可用 (未被其他进程占用)`,
    });
  } else {
    checks.push({
      name: `Port ${targetPort}`,
      status: 'warn',
      message: `已被占用！启动时会自动重试或可通过 -p <other_port> 更换端口`,
    });
  }

  // 5. 局域网接入点
  const netIps = getNetworkIps();
  if (netIps.length > 0) {
    checks.push({
      name: 'Network Access',
      status: 'ok',
      message: `检测到局域网 IP: ${netIps.join(', ')}`,
    });
  } else {
    checks.push({
      name: 'Network Access',
      status: 'warn',
      message: `未检测到外部局域网 IPv4 地址（仅可通过 localhost 本机访问）`,
    });
  }

  const allOk = checks.every((c) => c.status !== 'err');

  if (!silent) {
    const bold = '\x1b[1m';
    const green = '\x1b[32m';
    const yellow = '\x1b[33m';
    const red = '\x1b[31m';
    const cyan = '\x1b[36m';
    const reset = '\x1b[0m';

    console.log(`\n${bold}${cyan}╔═════════════════════════════════════════════════════════════╗${reset}`);
    console.log(`${bold}${cyan}║           OpenLearn V2 System Diagnostics (doctor)          ║${reset}`);
    console.log(`${bold}${cyan}╚═════════════════════════════════════════════════════════════╝${reset}\n`);

    for (const c of checks) {
      let icon = `${green}✓${reset}`;
      if (c.status === 'warn') icon = `${yellow}⚠${reset}`;
      if (c.status === 'err') icon = `${red}✗${reset}`;
      console.log(`  ${icon} ${bold}${c.name.padEnd(18)}${reset} : ${c.message}`);
    }

    console.log(`\n${cyan}───────────────────────────────────────────────────────────────${reset}`);
    if (allOk) {
      console.log(`  ${bold}${green}诊断通过！核心运行环境健康，已具备课堂部署就绪状态。${reset}\n`);
    } else {
      console.log(`  ${bold}${red}诊断发现阻断性问题，请根据上述提示处理后重试。${reset}\n`);
    }
  }

  return { ok: allOk, checks };
}
