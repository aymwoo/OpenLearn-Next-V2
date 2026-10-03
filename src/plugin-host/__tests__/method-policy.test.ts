/**
 * Security Barrier 3（方法 / 路径级门禁）测试。
 *
 * 覆盖 `checkMethodPolicy` 的判定，以及它在 ServiceHost.handleInvoke 中
 * 与 Barrier 1（Token 白名单）、Barrier 2（manifest 声明）的**先后关系**。
 */
import { describe, it, expect } from 'vitest';
import {
  checkMethodPolicy,
  CAP_API_WRITE,
  CAP_API_ADMIN,
  CAP_GRADES_WRITE,
  HIGH_RISK_PATH_PREFIXES,
} from '../method-policy';
import { FRONTEND_API_TOKEN, SOCKET_SERVICE_TOKEN, SEMESTER_GRADE_SERVICE_TOKEN } from '../types';

const ok = (r: string | null) => expect(r).toBeNull();
const denied = (r: string | null) => expect(typeof r).toBe('string');

describe('Barrier 3 · IFrontendAPI 默认只读', () => {
  it('get 调用始终允许（无需任何 capability）', () => {
    ok(checkMethodPolicy(FRONTEND_API_TOKEN, 'get', ['/api/lessons'], []));
  });

  it('未声明 api:write 时 post 被拒', () => {
    denied(checkMethodPolicy(FRONTEND_API_TOKEN, 'post', ['/api/lessons', {}], []));
  });

  it('任意无关 capability 不能解锁写操作', () => {
    denied(checkMethodPolicy(FRONTEND_API_TOKEN, 'post', ['/api/lessons', {}], ['ui:fancy']));
  });

  it('声明 api:write 后，普通路径的 post 放行', () => {
    ok(checkMethodPolicy(FRONTEND_API_TOKEN, 'post', ['/api/lessons', {}], [CAP_API_WRITE]));
  });

  it('声明 api:write 后，非实体级 delete 放行', () => {
    // 注：`del('/api/lessons/<id>')` 属实体级删除，需 api:admin（见下方"不可逆操作"一组）
    ok(checkMethodPolicy(FRONTEND_API_TOKEN, 'del', ['/api/lessons/x/sub'], [CAP_API_WRITE]));
  });
});

describe('Barrier 3 · 高危路径需 api:admin', () => {
  it.each(HIGH_RISK_PATH_PREFIXES)('有 api:write 但无 api:admin 时，%s 仍被拒', (prefix) => {
    denied(checkMethodPolicy(FRONTEND_API_TOKEN, 'post', [`${prefix}/x`, {}], [CAP_API_WRITE]));
  });

  it.each(HIGH_RISK_PATH_PREFIXES)('有 api:admin 时，%s 放行', (prefix) => {
    ok(checkMethodPolicy(FRONTEND_API_TOKEN, 'post', [`${prefix}/x`, {}], [CAP_API_ADMIN]));
  });

  it('子路径同样命中（/api/plugins/x 视为 /api/plugins 高危）', () => {
    denied(checkMethodPolicy(FRONTEND_API_TOKEN, 'del', ['/api/plugins/abc'], [CAP_API_WRITE]));
  });

  it('查询串与末尾斜杠不影响判定', () => {
    denied(checkMethodPolicy(FRONTEND_API_TOKEN, 'post', ['/api/plugins/abc?force=1', {}], [CAP_API_WRITE]));
    denied(checkMethodPolicy(FRONTEND_API_TOKEN, 'post', ['/api/users/', {}], [CAP_API_WRITE]));
  });

  it('路径相似的非高危前缀不被误伤', () => {
    ok(checkMethodPolicy(FRONTEND_API_TOKEN, 'post', ['/api/lessons', {}], [CAP_API_WRITE]));
    ok(checkMethodPolicy(FRONTEND_API_TOKEN, 'post', ['/api/pluginsomething', {}], [CAP_API_WRITE]));
  });
});

describe('Barrier 3 · ISocketService 禁止断连', () => {
  it('disconnect 一律被拒（无论声明什么）', () => {
    denied(checkMethodPolicy(SOCKET_SERVICE_TOKEN, 'disconnect', [], []));
    denied(checkMethodPolicy(SOCKET_SERVICE_TOKEN, 'disconnect', [], [CAP_API_ADMIN]));
  });

  it('destroy 一律被拒', () => {
    denied(checkMethodPolicy(SOCKET_SERVICE_TOKEN, 'destroy', [], [CAP_API_ADMIN]));
  });

  it('其他 socket 方法不受影响', () => {
    ok(checkMethodPolicy(SOCKET_SERVICE_TOKEN, 'emit', ['a', {}], []));
  });
});

describe('Barrier 3 · 学期成绩写入需 grades:write', () => {
  it('grades:read 不足以解锁写入', () => {
    denied(checkMethodPolicy(SEMESTER_GRADE_SERVICE_TOKEN, 'saveSemesterGrade', [], ['grades:read']));
    denied(checkMethodPolicy(SEMESTER_GRADE_SERVICE_TOKEN, 'saveSemesterGrade', [], ['grades']));
  });

  it('grades:write 可解锁写入', () => {
    ok(checkMethodPolicy(SEMESTER_GRADE_SERVICE_TOKEN, 'saveSemesterGrade', [], [CAP_GRADES_WRITE]));
  });

  it('读方法不受影响', () => {
    ok(checkMethodPolicy(SEMESTER_GRADE_SERVICE_TOKEN, 'getLogs', [], []));
  });
});

describe('Barrier 3 · 未列入策略的 Token 不在此处裁决', () => {
  it('返回 null，交由 Barrier 1 负责', () => {
    ok(checkMethodPolicy('@openlearn/frontend:ISomethingElse', 'whatever', [], []));
  });
});

describe('Barrier 顺序 · Barrier 1 优先于 Barrier 3', () => {
  it('即使声明全部能力，未授权 Token 仍在 Barrier 1 被拒', async () => {
    const { ServiceHost } = await import('../service-host');
    const registry = {
      resolve: async () => ({ get: () => 'ok', post: () => 'ok' }),
    };
    // 传入空白名单 → Barrier 1 对任何 token 都拒绝
    const host = new ServiceHost(registry as never, 'plugin:test', ['*'], undefined, []);

    const msgs: unknown[] = [];
    await host.handleInvoke(
      {
        invokeId: '1',
        token: FRONTEND_API_TOKEN,
        method: 'post',
        args: ['/api/plugins/x'],
      } as never,
      { postMessage: (m: unknown) => msgs.push(m) } as never,
    );

    const err = msgs[0] as { type: string; code?: string; message?: string };
    expect(err.type).toBe('error');
    // 报的是 Barrier 1 的措辞，而不是 Barrier 3 的
    expect(err.message).toContain('not in worker allowedTokens');
  });
});

describe('Barrier 顺序 · Barrier 2 先于 Barrier 3', () => {
  it('未声明任何 capability 时，Barrier 2 先拦下写操作', async () => {
    const { ServiceHost } = await import('../service-host');
    const registry = { resolve: async () => ({ get: () => 'ok', post: () => 'ok' }) };
    const host = new ServiceHost(
      registry as never,
      'plugin:test',
      [], // 空 capabilities → Barrier 2 生效
      undefined,
      [FRONTEND_API_TOKEN],
    );

    const msgs: unknown[] = [];
    await host.handleInvoke(
      { invokeId: '1', token: FRONTEND_API_TOKEN, method: 'post', args: ['/api/lessons'] } as never,
      { postMessage: (m: unknown) => msgs.push(m) } as never,
    );

    const err = msgs[0] as { type: string; message?: string };
    expect(err.type).toBe('error');
    expect(err.message).toContain('empty manifestCapabilities');
  });
});

describe('Barrier 3 · 不可逆操作（形状规则）', () => {
  it('GDPR 数据抹除需 api:admin', () => {
    denied(checkMethodPolicy(FRONTEND_API_TOKEN, 'del', ['/api/students/u1/gdpr-delete'], [CAP_API_WRITE]));
    ok(checkMethodPolicy(FRONTEND_API_TOKEN, 'del', ['/api/students/u1/gdpr-delete'], [CAP_API_ADMIN]));
  });

  it('实体级删除（恰好三段 + del）需 api:admin', () => {
    for (const p of ['/api/students/u1', '/api/classes/c1', '/api/lessons/l1']) {
      denied(checkMethodPolicy(FRONTEND_API_TOKEN, 'del', [p], [CAP_API_WRITE]));
      ok(checkMethodPolicy(FRONTEND_API_TOKEN, 'del', [p], [CAP_API_ADMIN]));
    }
  });

  it('同命名空间的子资源删除不因形状被误伤', () => {
    ok(checkMethodPolicy(FRONTEND_API_TOKEN, 'del', ['/api/classes/c1/students/s1'], [CAP_API_WRITE]));
    ok(checkMethodPolicy(FRONTEND_API_TOKEN, 'del', ['/api/classes/c1/groups/g1'], [CAP_API_WRITE]));
  });

  it('创建（POST，无 id 段）仍属普通写入', () => {
    ok(checkMethodPolicy(FRONTEND_API_TOKEN, 'post', ['/api/lessons', {}], [CAP_API_WRITE]));
  });

  it('更新（PUT，非 del）不触发实体删除规则', () => {
    ok(checkMethodPolicy(FRONTEND_API_TOKEN, 'put', ['/api/students/u1', {}], [CAP_API_WRITE]));
  });
});
