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

export function normalizeNetHost(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const host = raw.trim().toLowerCase().replace(/\.$/, '');
  if (!host || host.length > 253) return null;
  if (host.includes('/') || host.includes(':') || host.includes(' ') || host.includes('*')) return null;
  if (host === 'localhost' || host.endsWith('.localhost')) return null;

  // 严格阻断 IPv4 私有网段、环回网段与链路本地元数据地址
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4Match) {
    const [, a, b, c, d] = ipv4Match.map(Number);
    if (a > 255 || b > 255 || c > 255 || d > 255) return null;
    if (a === 0 || a === 127 || a === 10) return null; // 0.0.0.0/8, 127.0.0.0/8, 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return null; // 172.16.0.0/12
    if (a === 192 && b === 168) return null; // 192.168.0.0/16
    if (a === 169 && b === 254) return null; // 169.254.0.0/16 (链路本地 & 云元数据)
  }

  return host;
}
