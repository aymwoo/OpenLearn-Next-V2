import os from 'node:os';
import { spawn } from 'node:child_process';

/**
 * 获取本机所有非回环 IPv4 地址列表
 */
export function getNetworkIps(): string[] {
  const ips: string[] = [];
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('127.')) {
          ips.push(iface.address);
        }
      }
    }
  } catch (err) {
    console.warn('[HostNetwork] Failed to inspect network interfaces:', err);
  }
  return ips;
}

/**
 * 跨平台调起系统默认浏览器访问指定 URL
 */
export function openBrowser(targetUrl: string): void {
  try {
    const { platform } = process;
    if (platform === 'darwin') {
      spawn('open', [targetUrl], { stdio: 'ignore', detached: true }).unref();
    } else if (platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '""', targetUrl], { stdio: 'ignore', detached: true }).unref();
    } else {
      spawn('xdg-open', [targetUrl], { stdio: 'ignore', detached: true }).unref();
    }
  } catch {
    console.info('[HostNetwork] Auto-open browser skipped or unsupported in current environment.');
  }
}

/**
 * OSC 8 超链接终端格式化（仅在真实 TTY 终端下启用，避免日志文件或管道中残留转义序列）
 */
export function formatTerminalHyperlink(url: string): string {
  const isTty = Boolean(process.stdout?.isTTY) && process.env.TERM !== 'dumb';
  if (!isTty) return url;

  const OSC = '\x1b]8;;';
  const ST = '\x1b\\';
  return `${OSC}${url}${ST}${url}${OSC}${ST}`;
}
