/**
 * 第三方插件的能力与出站域名必须由管理员写入批准表之后才生效。
 * 清单里的声明只是申请，不是授权。`*` / `*:*` / `*:*:*` 永远不能批准。
 */

export const PLUGIN_CAPABILITY_GRANTS_TABLE = 'plugin_capability_grants';
export const PLUGIN_NETWORK_GRANTS_TABLE = 'plugin_network_grants';

type SqlStatement = {
  all: (...args: any[]) => any;
  run: (...args: any[]) => any;
  get: (...args: any[]) => any;
};

type SqlDb = {
  exec: (sql: string) => unknown;
  prepare: (sql: string) => SqlStatement;
};

export function isBlockedPluginCapability(cap: string): boolean {
  const value = cap.trim();
  return value === '*' || value === '*:*' || value === '*:*:*';
}

const ensuredDbs = new WeakSet<object>();

export function ensurePluginGrantTables(db: SqlDb): void {
  if (typeof db === 'object' && db !== null) {
    if (ensuredDbs.has(db as object)) return;
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${PLUGIN_CAPABILITY_GRANTS_TABLE} (
      plugin_key TEXT NOT NULL,
      capability TEXT NOT NULL,
      approved_at INTEGER NOT NULL,
      PRIMARY KEY (plugin_key, capability)
    );
    CREATE TABLE IF NOT EXISTS ${PLUGIN_NETWORK_GRANTS_TABLE} (
      plugin_key TEXT NOT NULL,
      host TEXT NOT NULL,
      approved_at INTEGER NOT NULL,
      PRIMARY KEY (plugin_key, host)
    );
  `);
  if (typeof db === 'object' && db !== null) {
    ensuredDbs.add(db as object);
  }
}

export function approvePluginCapabilities(db: SqlDb, keys: string[], capabilities: string[]): string[] {
  ensurePluginGrantTables(db);
  const accepted: string[] = [];
  const stmt = db.prepare(
    `INSERT INTO ${PLUGIN_CAPABILITY_GRANTS_TABLE} (plugin_key, capability, approved_at)
     VALUES (?, ?, ?)
     ON CONFLICT(plugin_key, capability) DO UPDATE SET approved_at = excluded.approved_at`,
  );
  const now = Date.now();
  for (const key of keys) {
    if (!key) continue;
    for (const cap of capabilities) {
      if (typeof cap !== 'string' || isBlockedPluginCapability(cap)) continue;
      stmt.run(key, cap, now);
      if (!accepted.includes(cap)) accepted.push(cap);
    }
  }
  return accepted;
}

export function isCapabilityApproved(db: SqlDb, keys: string[], capability: string): boolean {
  if (isBlockedPluginCapability(capability)) return false;
  try {
    ensurePluginGrantTables(db);
  } catch {
    return false;
  }
  const stmt = db.prepare(
    `SELECT 1 AS ok FROM ${PLUGIN_CAPABILITY_GRANTS_TABLE} WHERE plugin_key = ? AND capability = ? LIMIT 1`,
  );
  return keys.some((key) => key && stmt.get(key, capability));
}

export function clearPluginGrants(db: SqlDb, keys: string[]): void {
  try {
    ensurePluginGrantTables(db);
  } catch {
    return;
  }
  const capStmt = db.prepare(`DELETE FROM ${PLUGIN_CAPABILITY_GRANTS_TABLE} WHERE plugin_key = ?`);
  const netStmt = db.prepare(`DELETE FROM ${PLUGIN_NETWORK_GRANTS_TABLE} WHERE plugin_key = ?`);
  for (const key of keys) {
    if (!key) continue;
    capStmt.run(key);
    netStmt.run(key);
  }
}

export function approvePluginNetHosts(db: SqlDb, keys: string[], hosts: string[]): string[] {
  ensurePluginGrantTables(db);
  const accepted: string[] = [];
  const stmt = db.prepare(
    `INSERT INTO ${PLUGIN_NETWORK_GRANTS_TABLE} (plugin_key, host, approved_at)
     VALUES (?, ?, ?)
     ON CONFLICT(plugin_key, host) DO UPDATE SET approved_at = excluded.approved_at`,
  );
  const now = Date.now();
  for (const key of keys) {
    if (!key) continue;
    for (const host of hosts) {
      const normalized = normalizeNetHost(host);
      if (!normalized) continue;
      stmt.run(key, normalized, now);
      if (!accepted.includes(normalized)) accepted.push(normalized);
    }
  }
  return accepted;
}

export function listApprovedNetHosts(db: SqlDb, keys: string[]): string[] {
  try {
    ensurePluginGrantTables(db);
  } catch {
    return [];
  }
  const stmt = db.prepare(`SELECT host FROM ${PLUGIN_NETWORK_GRANTS_TABLE} WHERE plugin_key = ?`);
  const hosts = new Set<string>();
  for (const key of keys) {
    if (!key) continue;
    const rows = stmt.all(key) as Array<{ host?: string }>;
    for (const row of rows) {
      const host = normalizeNetHost(row?.host);
      if (host) hosts.add(host);
    }
  }
  return [...hosts];
}

function isForbiddenIpv4Octets(octets: number[]): boolean {
  const [a, b, c] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function parseIpv4HostOctets(host: string): number[] | null {
  if (/^(0[xX][0-9a-fA-F]+|\d+)$/.test(host)) {
    let num: number;
    if (/^0[xX]/.test(host)) {
      num = parseInt(host.slice(2), 16);
    } else if (/^0\d+$/.test(host) && /^[0-7]+$/.test(host.slice(1))) {
      num = parseInt(host.slice(1), 8);
    } else {
      num = Number(host);
    }
    if (!Number.isSafeInteger(num) || num < 0 || num >= 2 ** 32) return null;
    return [(num >>> 24) & 0xff, (num >>> 16) & 0xff, (num >>> 8) & 0xff, num & 0xff];
  }
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const octetRe = /^(0[xX][0-9a-fA-F]+|0[0-7]*|\d+)$/;
  if (!parts.every((s) => octetRe.test(s))) return null;
  const octets = parts.map((s) => {
    let n: number;
    if (/^0[xX]/.test(s)) n = parseInt(s.slice(2), 16);
    else if (/^0\d/.test(s)) n = parseInt(s.slice(1), 8);
    else n = parseInt(s, 10);
    return Number.isSafeInteger(n) && n >= 0 && n <= 255 ? n : -1;
  });
  if (octets.some((o) => o < 0)) return null;
  return octets;
}

export function isPrivateOrReservedHost(rawHost: string): boolean {
  const host = rawHost.trim().toLowerCase().replace(/\.$/, '');
  if (!host) return true;
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === '0.0.0.0' ||
    host === '::' ||
    host === '::1' ||
    host === '[::]' ||
    host === '[::1]'
  ) {
    return true;
  }

  const unwrapped = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (unwrapped.includes(':')) {
    if (
      unwrapped === '::' ||
      unwrapped === '::1' ||
      /^0*:0*:0*:0*:0*:0*:0*:0*1$/i.test(unwrapped) ||
      /^0*:0*:0*:0*:0*:0*:0*:0*$/i.test(unwrapped) ||
      /^f[cd][0-9a-f]{2}:/i.test(unwrapped) ||
      /^fe[89ab][0-9a-f]:/i.test(unwrapped) ||
      /^ff[0-9a-f]{2}:/i.test(unwrapped)
    ) {
      return true;
    }
    const v4MappedMatch = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(unwrapped);
    if (v4MappedMatch) {
      const octets = parseIpv4HostOctets(v4MappedMatch[1]);
      return octets ? isForbiddenIpv4Octets(octets) : true;
    }
    return false;
  }

  const octets = parseIpv4HostOctets(unwrapped);
  if (octets) {
    return isForbiddenIpv4Octets(octets);
  }

  return false;
}

export function normalizeNetHost(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const host = raw.trim().toLowerCase().replace(/\.$/, '');
  if (!host || host.length > 253) return null;
  if (host.includes('/') || host.includes(':') || host.includes(' ') || host.includes('*')) return null;
  if (isPrivateOrReservedHost(host)) return null;

  // 若是四段数字但某段 > 255（非法 IPv4 字面量），直接拒绝
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) && !parseIpv4HostOctets(host)) {
    return null;
  }

  return host;
}
