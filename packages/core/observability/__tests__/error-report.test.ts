/**
 * @vitest-environment node
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  buildSentryEnvelope,
  captureError,
  configuredErrorDsn,
  parseSentryDsn,
  postSentryEnvelope,
  sanitizeErrorReport,
  setErrorCaptureSinkForTests,
} from '../error-reporter.js';
import { sanitizeValue } from '../sanitize.js';
import { recordSecurityAudit, setAuditSinkForTests } from '../audit-log.js';

afterEach(() => {
  setErrorCaptureSinkForTests(null);
  setAuditSinkForTests(null);
});

describe('错误上报脱敏', () => {
  it('去掉口令、会话、班级口令和学生作答', () => {
    const report = sanitizeErrorReport({
      source: 'http',
      message: 'failed password=SuperSecret token_abcdef0123456789',
      stack: 'at login cookie=edu_os_token=token_abcdef0123456789 textContent=学生作答原文',
      path: '/api/assignments/submit?passcode=4321',
    });
    const packed = JSON.stringify(report);
    expect(packed).not.toContain('SuperSecret');
    expect(packed).not.toContain('学生作答原文');
    expect(packed).not.toContain('token_abcdef0123456789');
    expect(packed).not.toContain('4321');
    expect(packed).toContain('***REDACTED***');
    expect(report.path).toBe('/api/assignments/submit');

    const nested = JSON.stringify(
      sanitizeValue({
        password: 'pw',
        class_passcode: '9988',
        textContent: '学生作答原文',
        sessionToken: 'session-secret-xyz',
        studentId: 'stu_1',
      }),
    );
    expect(nested).not.toContain('pw');
    expect(nested).not.toContain('9988');
    expect(nested).not.toContain('学生作答原文');
    expect(nested).not.toContain('session-secret-xyz');
    expect(nested).toContain('stu_1');
  });

  it('未配置 DSN 时不发起网络请求', async () => {
    expect(configuredErrorDsn({})).toBeUndefined();
    expect(configuredErrorDsn({ SENTRY_DSN: '  ' })).toBeUndefined();
    const calls: string[] = [];
    await postSentryEnvelope('', sanitizeErrorReport({ source: 'http', message: 'x' }), (async (url: string) => {
      calls.push(url);
      return new Response(null, { status: 200 });
    }) as typeof fetch);
    expect(calls).toHaveLength(0);
  });

  it('Sentry 兼容 Envelope 不包含敏感字段', async () => {
    const dsn = 'https://publickey@glitchtip.example/1';
    expect(parseSentryDsn(dsn)?.envelopeUrl).toBe('https://glitchtip.example/api/1/envelope/');
    const report = sanitizeErrorReport({
      source: 'client',
      message: 'boom',
      stack: 'Error',
      path: '/classroom',
    });
    const body = buildSentryEnvelope(
      {
        ...report,
        message: 'password=SecretAnswer',
      },
      dsn,
    );
    expect(body).toBeTruthy();
    expect(body).not.toContain('SecretAnswer');
    expect(body).toContain('publickey');

    let posted = '';
    await postSentryEnvelope(dsn, sanitizeErrorReport({ source: 'uncaught', message: 'password=Nope' }), (async (
      _url: string,
      init?: RequestInit,
    ) => {
      posted = String(init?.body || '');
      return new Response(null, { status: 200 });
    }) as typeof fetch);
    expect(posted).not.toContain('Nope');
    expect(posted).toContain('application/json');
  });

  it('测试环境下 captureError 只进入注入的 sink', () => {
    const seen: string[] = [];
    setErrorCaptureSinkForTests((report) => seen.push(report.message));
    captureError({ source: 'http', message: 'password=hidden-value' });
    expect(seen[0]).not.toContain('hidden-value');
  });

  it('审计记录同样脱敏', () => {
    const seen: Array<Record<string, unknown>> = [];
    setAuditSinkForTests((record) => seen.push(record));
    const record = recordSecurityAudit('auth.login_failed', {
      account: 'teacher',
      password: 'do-not-log',
      textContent: 'answer',
    });
    expect(record.event).toBe('auth.login_failed');
    expect(JSON.stringify(seen[0])).not.toContain('do-not-log');
    expect(JSON.stringify(seen[0])).not.toContain('answer');
    expect(JSON.stringify(seen[0])).toContain('teacher');
  });
});
