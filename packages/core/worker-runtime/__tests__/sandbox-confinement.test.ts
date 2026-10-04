/**
 * Worker 沙箱收敛测试（2026-10-04，SEC-DB-03 / 白名单收敛）
 *
 * 覆盖三处修复：
 * 1. `IPluginHost` 移出基础白名单 —— 沙箱插件不应能安装/激活其他插件
 * 2. **DML 命名空间隔离** —— 此前命名空间校验只管 DDL，跨插件读写完全畅通
 * 3. 核心表黑名单扩充 —— 实测 97 张表中原名单只覆盖 28 张
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ServiceHost } from '../service-host.js';
import { BASE_WORKER_SERVICE_TOKENS } from '../worker-manager.js';
import type { IWorkerTransport, InvokeMessage } from '../types.js';

/** 自己的两个命名空间：DB UUID 与 manifestId。 */
const OWN_UUID = '019fa0d4-2e31-76d9-8322-ca08f60012a8';
const OWN_NS_UUID = `plugin_${OWN_UUID.replace(/-/g, '_')}_`;
const OWN_NS_MID = 'plugin__aymwoo_plugin_lab_seat_';
const OTHER_TABLE = 'plugin_01a0ba5b_9ece_7610_bbdd_7edb9c5839d1_attendance_logs';

class CaptureTransport implements IWorkerTransport {
  messages: any[] = [];
  readonly id = 'browser-worker:test';
  postMessage(m: unknown): void {
    this.messages.push(m);
  }
  onMessage(): void {
    /* 本用例只验证出向消息 */
  }
  async terminate(): Promise<void> {
    /* 无需真实终止 */
  }
}

const NO_SOCKET = undefined as never;

function makeHost(caps: string[] = ['storage:write'], tokens?: string[]) {
  const db = { exec: () => undefined, prepare: () => ({ run: () => ({ changes: 0 }), get: () => undefined, all: () => [] }) };
  const registry = { resolve: async () => db, resolveByName: async () => db };
  const host = new ServiceHost(
    registry as never,
    { check: () => true, require: () => undefined } as never, // capabilityGuard
    '@aymwoo/plugin-lab-seat',                                   // pluginActorId
    caps,                                                        // manifestCapabilities
    undefined,                                                   // eventBus
    undefined,                                                   // eventForwarder
    '@aymwoo/plugin-lab-seat',                                   // pluginId (manifestId)
    OWN_UUID,                                                    // dbPluginId (DB UUID)
    tokens,                                                      // allowedTokens
  );
  return { host, transport: new CaptureTransport() };
}

async function invokeSql(sql: string, tokens?: string[], caps?: string[]) {
  const { host, transport } = makeHost(caps, tokens);
  await host.handleInvoke(
    { invokeId: '1', token: '@openlearn/core:IDatabase', method: 'exec', args: [sql] } as unknown as InvokeMessage,
    transport as never,
  );
  return transport.messages[0] as { type: string; message?: string };
}

beforeEach(() => {
  /* 每个用例独立构造 host，无需共享状态 */
});

describe('白名单收敛', () => {
  it('IPluginHost 已不在基础白名单中', () => {
    expect(BASE_WORKER_SERVICE_TOKENS).not.toContain('@openlearn/core:IPluginHost');
  });

  it('基础白名单仍保留 IDatabase（靠语句守卫管控范围，而非移除句柄）', () => {
    expect(BASE_WORKER_SERVICE_TOKENS).toContain('@openlearn/core:IDatabase');
  });

  it('使用真实基础白名单时，插件无法 resolve 到 IPluginHost', async () => {
    const { host, transport } = makeHost(['storage:write'], [...BASE_WORKER_SERVICE_TOKENS]);
    await host.handleInvoke(
      {
        invokeId: '1',
        token: '@openlearn/core:IPluginHost',
        method: 'installPlugin',
        args: ['malicious source'],
      } as unknown as InvokeMessage,
      transport as never,
    );
    expect(transport.messages[0].type).toBe('error');
    expect(transport.messages[0].message).toContain('not in worker allowedTokens');
  });

  it('IPluginHost 在全量白名单常量中仍保留（供需要它的插件走条件授予）', () => {
    // ALL_SERVICE_TOKENS 是兼容性超集，不改它以免破坏外部引用
    expect(BASE_WORKER_SERVICE_TOKENS.length).toBe(8);
  });
});

describe('DML 命名空间隔离（SEC-DB-03）', () => {
  it('允许读写自己 UUID 命名空间下的表', async () => {
    for (const sql of [
      `SELECT * FROM ${OWN_NS_UUID}seat_assignments`,
      `INSERT INTO ${OWN_NS_UUID}seat_assignments (id) VALUES ('x')`,
      `UPDATE ${OWN_NS_UUID}seat_assignments SET id = 'y'`,
      `DELETE FROM ${OWN_NS_UUID}seat_assignments WHERE id = 'x'`,
    ]) {
      const r = await invokeSql(sql, ['@openlearn/core:IDatabase']);
      expect(r.type, `应放行: ${sql}`).toBe('result');
    }
  });

  it('允许读写自己 manifestId 命名空间下的表', async () => {
    const r = await invokeSql(`SELECT * FROM ${OWN_NS_MID}attendance_records`, [
      '@openlearn/core:IDatabase',
    ]);
    expect(r.type).toBe('result');
  });

  it('拒绝 SELECT 其他插件的表', async () => {
    const r = await invokeSql(`SELECT * FROM ${OTHER_TABLE}`, ['@openlearn/core:IDatabase']);
    expect(r.type).toBe('error');
    expect(r.message).toContain("another plugin's table");
  });

  it('拒绝 UPDATE / DELETE / INSERT 其他插件的表', async () => {
    for (const sql of [
      `UPDATE ${OTHER_TABLE} SET x = 1`,
      `DELETE FROM ${OTHER_TABLE}`,
      `INSERT INTO ${OTHER_TABLE} (id) VALUES ('x')`,
    ]) {
      const r = await invokeSql(sql, ['@openlearn/core:IDatabase']);
      expect(r.type, `应拒绝: ${sql}`).toBe('error');
    }
  });

  it('拒绝跨插件 JOIN（FROM 与 JOIN 两侧都要检查）', async () => {
    const r = await invokeSql(
      `SELECT * FROM ${OWN_NS_UUID}seat_assignments a JOIN ${OTHER_TABLE} b ON a.id = b.id`,
      ['@openlearn/core:IDatabase'],
    );
    expect(r.type).toBe('error');
    expect(r.message).toContain('another plugin');
  });

  it('不把 plugin_id 这类列名误判为表名', async () => {
    // plugin_migrations 是插件共享表，其 plugin_id 列不应触发拦截
    const r = await invokeSql(
      `INSERT INTO plugin_migrations (plugin_id, name, applied_at) VALUES ('p1','m1',1)`,
      ['@openlearn/core:IDatabase'],
    );
    expect(r.type).toBe('result');
  });

  it('DDL 仍受原有命名空间规则约束（自有命名空间可建表）', async () => {
    const r = await invokeSql(`CREATE TABLE IF NOT EXISTS ${OWN_NS_UUID}new_table (id TEXT)`, [
      '@openlearn/core:IDatabase',
    ]);
    expect(r.type).toBe('result');
  });

  it('DDL 他人命名空间仍被拒绝（保持既有契约）', async () => {
    const r = await invokeSql(`CREATE TABLE ${OTHER_TABLE} (id TEXT)`, ['@openlearn/core:IDatabase']);
    expect(r.type).toBe('error');
    expect(r.message).toContain('not permitted to perform DDL');
  });
});

describe('核心表黑名单扩充', () => {
  it.each([
    'site_settings',
    'agent_conversations',
    'classroom_sessions',
    'lesson_quiz_submissions',
    'courseware_score_config',
    'demo_data_registry',
    'whiteboard_elements',
    'student_point_logs',
  ])('拒绝访问 %s（此前黑名单漏网）', async (table) => {
    const r = await invokeSql(`SELECT * FROM ${table}`, ['@openlearn/core:IDatabase']);
    expect(r.type, `应拒绝 ${table}`).toBe('error');
    expect(r.message).toContain('forbidden from accessing core security table');
  });

  it('既有的高危操作封禁未被破坏', async () => {
    for (const sql of ['ATTACH DATABASE \'x\' AS y', 'PRAGMA table_info(users)', 'VACUUM']) {
      const r = await invokeSql(sql, ['@openlearn/core:IDatabase']);
      expect(r.type, `应拒绝 ${sql}`).toBe('error');
    }
  });
});
