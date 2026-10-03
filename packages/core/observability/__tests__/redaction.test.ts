/**
 * 脱敏兜底测试。
 *
 * 全部使用 `os.tmpdir()` 下的临时目录，**绝不写入仓库的 `logs/`**。
 * 用真实的 pino + 真实的 RotatingFileStream 组合，而非 mock，
 * 以保证验证的是平台实际生效的那份配置。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { buildRedactOptions, isRedactionEnabled, REDACTION_PLACEHOLDER } from '../redaction.js';
import { RotatingFileStream } from '../rotating-file-stream.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlearn-redact-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** 用真实配置构造一个写向临时文件的 logger，返回日志文件路径 */
function makeTestLogger(env: NodeJS.ProcessEnv = {} as NodeJS.ProcessEnv) {
  const filePath = path.join(tmpDir, 'test.log');
  const stream = new RotatingFileStream({ filePath, maxBytes: 1024 * 1024, maxFiles: 2 });
  const log = pino({ level: 'debug', redact: buildRedactOptions(env) as any }, stream as any);
  return { log, filePath, read: () => fs.readFileSync(filePath, 'utf8') };
}

describe('日志脱敏兜底', () => {
  it('敏感字段的原始值不出现在输出中', () => {
    const { log, read } = makeTestLogger();

    const API_KEY = 'sk-SUPERSECRET-abc123';
    const PASSWORD = 'P@ssw0rd-leaked';
    const HASH = 'sha256$deadbeefcafe';
    const COOKIE = 'edu_os_token=raw-session-token-xyz';
    const AUTH = 'Bearer sk-SUPERSECRET-abc123';
    const PASSCODE = 'JOIN-7788';
    const SESSION = 'session-token-999';

    log.info(
      {
        api_key: API_KEY,
        apiKey: API_KEY,
        password: PASSWORD,
        password_hash: HASH,
        cookie: COOKIE,
        Authorization: AUTH,
        class_passcode: PASSCODE,
        sessionToken: SESSION,
        requestPayload: 'PROMPT-SECRET-BODY',
        responsePayload: 'COMPLETION-SECRET-BODY',
      },
      'provider config',
    );

    const out = read();
    for (const secret of [
      API_KEY,
      PASSWORD,
      HASH,
      'raw-session-token-xyz',
      'Bearer sk-SUPERSECRET-abc123',
      PASSCODE,
      SESSION,
      'PROMPT-SECRET-BODY',
      'COMPLETION-SECRET-BODY',
    ]) {
      expect(out).not.toContain(secret);
    }
    // 字段仍在、值被替换 —— 排障时能看出「这里有值」
    expect(out).toContain(REDACTION_PLACEHOLDER);
  });

  it('递归脱敏深层嵌套的敏感字段', () => {
    const { log, read } = makeTestLogger();
    const SECRET = 'nested-api-key-7777';

    log.info({ meta: { level1: { level2: { level3: { apiKey: SECRET } } } } }, 'deep');

    const out = read();
    expect(out).not.toContain(SECRET);
    expect(out).toContain(REDACTION_PLACEHOLDER);
  });

  it('脱敏数组元素中的敏感字段', () => {
    const { log, read } = makeTestLogger();
    const SECRET = 'array-bearer-key-8888';

    log.info({ providers: [{ api_key: SECRET }] }, 'list');

    expect(read()).not.toContain(SECRET);
  });

  it('不误伤普通业务字段', () => {
    const { log, read } = makeTestLogger();

    log.info(
      {
        studentId: 'stu_001',
        lessonId: 'les_042',
        classId: 'cls_7',
        name: '张三',
        id: 'evt_123',
        score: 95,
        durationMs: 1200,
        status: 'active',
      },
      'normal fields',
    );

    const out = read();
    expect(out).toContain('stu_001');
    expect(out).toContain('les_042');
    expect(out).toContain('cls_7');
    expect(out).toContain('张三');
    expect(out).toContain('evt_123');
    expect(out).toContain('95');
    // 普通字段不应被占位符污染
    expect(out).not.toContain(REDACTION_PLACEHOLDER);
  });

  it('DI Token 语义的 token 字段不被脱敏（避免过度脱敏）', () => {
    const { log, read } = makeTestLogger();

    // token 在本仓库主要指依赖注入 Token，不是凭据
    log.info({ token: 'ICommandBusService', version: '1.0.0' }, 'di resolution');

    const out = read();
    expect(out).toContain('ICommandBusService');
  });

  it('LOG_REDACT=false 时确实关闭脱敏（紧急排障开关）', () => {
    const { log, read } = makeTestLogger({ LOG_REDACT: 'false' } as NodeJS.ProcessEnv);
    const API_KEY = 'sk-EXPOSED-ON-PURPOSE';

    log.info({ api_key: API_KEY }, 'redaction disabled');

    // 关闭后确实是明文 —— 这正是不建议在生产开启该开关的原因
    expect(read()).toContain(API_KEY);
    expect(read()).not.toContain(REDACTION_PLACEHOLDER);
  });

  it('isRedactionEnabled 解析各种开关写法', () => {
    expect(isRedactionEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(isRedactionEnabled({ LOG_REDACT: 'true' } as NodeJS.ProcessEnv)).toBe(true);
    for (const v of ['false', 'FALSE', '0', 'off', 'no']) {
      expect(isRedactionEnabled({ LOG_REDACT: v } as NodeJS.ProcessEnv)).toBe(false);
    }
  });

  it('【防回归】`**` 通配符在本版 fast-redact 中无效，路径必须逐层枚举', () => {
    // 本仓库 pino 10.x 的 fast-redact 不支持 `**`：`**.api_key` 静默匹配不到任何东西。
    // 若有人日后"简化"成 `**.${name}`，本测试会立刻变红。
    const secret = 'glob-star-should-not-be-trusted';
    const payload = { meta: { nested: { api_key: secret } } };

    const writeTo = (paths: string[]) => {
      const chunks: string[] = [];
      pino({ level: 'debug', redact: { paths, censor: 'X' } }, { write: (s: string) => chunks.push(s) } as any).info(
        payload,
        'm',
      );
      return chunks.join('');
    };

    // 断言前提：`**.api_key` 确实脱不掉（若未来 pino 升级支持了，这里会失败并提示更新实现）
    expect(writeTo(['**.api_key'])).toContain(secret);
    // 而平台实际使用的配置脱得掉
    const opts = buildRedactOptions({} as NodeJS.ProcessEnv);
    expect(opts).not.toBe(false);
    expect(writeTo((opts as { paths: string[] }).paths)).not.toContain(secret);
  });
});

describe('现有行为不回归', () => {
  it('createLogger(component) 仍产生带 component 字段的子 logger', async () => {
    // 用临时 LOG_DIR + production 分支，隔离仓库 logs/ 且避免 pino-pretty worker
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlearn-module-'));
    const prevNodeEnv = process.env.NODE_ENV;
    const prevLogDir = process.env.LOG_DIR;
    const prevLevel = process.env.LOG_LEVEL;

    process.env.NODE_ENV = 'production';
    process.env.LOG_DIR = logDir;
    process.env.LOG_LEVEL = 'debug';

    vi.resetModules();
    try {
      const mod = await import('../logger.js');
      const sub = mod.createLogger('Plugin:ext-demo');

      // 子 logger 必须是 logger 的子实例（行为不变）
      expect(typeof sub.info).toBe('function');
      sub.info({ lessonId: 'les_001' }, 'hello from child');

      // RotatingFileStream 是同步写盘，logger.info 返回后即可读到
      const content = fs.readFileSync(path.join(logDir, 'openlearn.log'), 'utf8');
      const record = JSON.parse(content.trim().split('\n').pop()!);
      expect(record.component).toBe('Plugin:ext-demo');
      expect(record.msg).toBe('hello from child');
      expect(record.lessonId).toBe('les_001');
    } finally {
      vi.resetModules();
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
      if (prevLogDir === undefined) delete process.env.LOG_DIR;
      else process.env.LOG_DIR = prevLogDir;
      if (prevLevel === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = prevLevel;
      fs.rmSync(logDir, { recursive: true, force: true });
    }
  });
});
