/**
 * 班级临时口令的可逆加密。
 *
 * 登录按「学生所在班级」取出 class_passcode 再比较，不是按口令查班级，
 * 因此不另建 HMAC 查找列：解密后用 SHA-256 摘要做常量时间比较。
 * 教师界面要看到原文，所以用与 AI Provider API Key 相同的 AES-256-GCM。
 *
 * 密文带 `olenc1:` 前缀，迁移据此跳过已加密的行。前缀后面是
 * `iv:authTag:ciphertext`（各段为十六进制，iv 与 tag 均为 16 字节）。
 */
import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { decryptApiKey, encryptApiKey } from '../di/api-key-crypto.js';

export const CLASS_PASSCODE_PREFIX = 'olenc1:';

const REDACTED = '***REDACTED***';
const PASSCODE_KEYS = new Set(['class_passcode', 'classpasscode', 'passcode']);

export function isEncryptedClassPasscode(value: string | null | undefined): boolean {
  if (!value || !value.startsWith(CLASS_PASSCODE_PREFIX)) return false;
  const parts = value.slice(CLASS_PASSCODE_PREFIX.length).split(':');
  if (parts.length !== 3) return false;
  const [iv, tag, body] = parts;
  return (
    /^[0-9a-fA-F]{32}$/.test(iv) &&
    /^[0-9a-fA-F]{32}$/.test(tag) &&
    /^[0-9a-fA-F]+$/.test(body) &&
    body.length >= 2 &&
    body.length % 2 === 0
  );
}

/** 写入数据库前密封。null / 空串保持为 null。已经是密文则不再包一层。 */
export function sealClassPasscode(value: string | null | undefined): string | null {
  if (value == null || value === '') return null;
  if (isEncryptedClassPasscode(value)) return value;
  return CLASS_PASSCODE_PREFIX + encryptApiKey(value);
}

/**
 * 读出教师界面要展示的原文。
 * 旧明文原样返回，供迁移前的读取；密文解密失败时抛错，不把密文当口令展示。
 */
export function openClassPasscode(stored: string | null | undefined): string | null {
  if (stored == null || stored === '') return null;
  if (!isEncryptedClassPasscode(stored)) return stored;
  try {
    return decryptApiKey(stored.slice(CLASS_PASSCODE_PREFIX.length));
  } catch {
    const err = new Error('班级临时口令解密失败：ENCRYPTION_KEY 与加密时不一致或数据已损坏') as Error & {
      status?: number;
    };
    err.status = 500;
    throw err;
  }
}

function digest(value: string): Buffer {
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

/**
 * 解密后比较。摘要长度固定，timingSafeEqual 不因口令内容提前返回。
 * 解密失败视为不匹配，且不把密文或原文写进错误对象。
 */
export function classPasscodeMatches(stored: string | null | undefined, provided: unknown): boolean {
  if (typeof provided !== 'string' || provided.length === 0 || !stored) return false;
  let plain: string | null;
  try {
    plain = openClassPasscode(stored);
  } catch {
    console.error('[Auth] 班级临时口令解密失败（ENCRYPTION_KEY 不一致或数据损坏），已拒绝该次口令匹配');
    return false;
  }
  const left = plain?.trim() ?? '';
  if (!left) return false;
  return crypto.timingSafeEqual(digest(left), digest(provided));
}

export function encryptStoredClassPasscodes(db: Database.Database): { updated: number; skipped: number } {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'classes'").get() as
    | { name: string }
    | undefined;
  if (!table) return { updated: 0, skipped: 0 };

  const rows = db
    .prepare(
      `SELECT id, class_passcode FROM classes
       WHERE class_passcode IS NOT NULL AND class_passcode != ''`,
    )
    .all() as { id: string; class_passcode: string }[];

  const update = db.prepare('UPDATE classes SET class_passcode = ? WHERE id = ? AND class_passcode = ?');
  let updated = 0;
  let skipped = 0;
  const run = db.transaction(() => {
    for (const row of rows) {
      if (isEncryptedClassPasscode(row.class_passcode)) {
        skipped += 1;
        continue;
      }
      const sealed = sealClassPasscode(row.class_passcode);
      updated += update.run(sealed, row.id, row.class_passcode).changes;
    }
  });
  run();
  return { updated, skipped };
}

export function applyStartupDataMigrations(db: Database.Database): void {
  const result = encryptStoredClassPasscodes(db);
  if (result.updated > 0) {
    console.log(`[Migration] 已加密 ${result.updated} 条班级临时口令（跳过已加密 ${result.skipped} 条）`);
  }
}

/** 审计事件入库前去掉口令字段和 olenc1 密文，不改调用方拿到的原对象。 */
export function redactPasscodeMaterial(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return value.replace(/olenc1:[0-9a-fA-F:]+/g, REDACTED);
  if (value == null || typeof value !== 'object') return value;
  if (depth > 8) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => redactPasscodeMaterial(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (PASSCODE_KEYS.has(key.toLowerCase())) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = redactPasscodeMaterial(nested, depth + 1);
  }
  return out;
}
