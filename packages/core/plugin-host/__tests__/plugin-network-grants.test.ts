/**
 * 出站域名授权（R-02）：分类、批准、撤销的真实行为。
 *
 * 背景（`docs/trust-boundary-hardening-audit-2026-10-14.md` R-02）：
 * 清单的 `network.outbound` 只是申请，运行时唯一真相源是 `plugin_network_grants`。
 * 但 `approvePluginNetHosts` 此前**没有任何调用方** —— 也就是这条路根本走不通，
 * 管理员既无法授权也看不到插件想访问什么。
 *
 * 这里钉住三件事：
 * 1. 回环/私有/保留地址与通配符**永远不能**进入授权表（不依赖上层是否校验）；
 * 2. 被拒的项必须带回原因 —— 否则管理员只会以为「平台把数据丢了」；
 * 3. 撤销要能区分「撤掉了」与「本来就没有」，而不是一律报成功。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  approvePluginNetHosts,
  classifyNetHostProposals,
  listApprovedNetHosts,
  revokePluginNetHost,
} from '../plugin-grants.js';

const KEYS = ['plugin-uuid-1', 'ext-sample-plugin'];

describe('classifyNetHostProposals', () => {
  it('accepts public hostnames and lowercases them', () => {
    const verdicts = classifyNetHostProposals(['API.OpenAI.com', 'dashscope.aliyuncs.com']);
    expect(verdicts.every((v) => v.approvable)).toBe(true);
    expect(verdicts.map((v) => v.host)).toEqual(['api.openai.com', 'dashscope.aliyuncs.com']);
  });

  it('rejects loopback / private / link-local with a reason', () => {
    const verdicts = classifyNetHostProposals(['localhost', '127.0.0.1', '10.1.2.3', '169.254.169.254']);
    expect(verdicts.every((v) => !v.approvable)).toBe(true);
    for (const v of verdicts) {
      expect(v.host).toBeNull();
      expect(v.reason).toBeTruthy();
      // 必须是「被 SSRF 防线挡了」，而不是含糊的「非法」
      expect(v.reason).toContain('回环');
    }
  });

  it('rejects wildcards and URL-shaped entries with distinct reasons', () => {
    const [wildcard, withScheme, withPort] = classifyNetHostProposals([
      '*.example.com',
      'https://example.com/a',
      'example.com:443',
    ]);
    expect(wildcard.approvable).toBe(false);
    expect(wildcard.reason).toContain('通配符');
    expect(withScheme.approvable).toBe(false);
    expect(withScheme.reason).toContain('主机名');
    expect(withPort.approvable).toBe(false);
    expect(withPort.reason).toContain('主机名');
  });

  it('rejects non-string and empty entries instead of throwing', () => {
    const verdicts = classifyNetHostProposals([null, 42, '   ', '']);
    expect(verdicts).toHaveLength(4);
    expect(verdicts.every((v) => !v.approvable)).toBe(true);
  });

  it('keeps the raw value for display so admins can match it against the manifest', () => {
    const [v] = classifyNetHostProposals(['  LocalHost  ']);
    expect(v.raw).toBe('LocalHost');
    expect(v.approvable).toBe(false);
  });
});

describe('approve / list / revoke against a real SQLite database', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  it('never stores blocked hosts even if the caller passes them directly', () => {
    // 上层（路由）会先分类，但这里刻意直接传回环地址 ——
    // 授权表本身必须是最后一道闸门，不能依赖调用方守规矩。
    const accepted = approvePluginNetHosts(db, KEYS, ['api.openai.com', '127.0.0.1', 'localhost', '*.evil.com']);
    expect(accepted).toEqual(['api.openai.com']);
    expect(listApprovedNetHosts(db, KEYS)).toEqual(['api.openai.com']);
  });

  it('lists approved hosts across both keys without duplicates', () => {
    approvePluginNetHosts(db, ['plugin-uuid-1'], ['api.openai.com']);
    approvePluginNetHosts(db, ['ext-sample-plugin'], ['api.openai.com', 'example.org']);
    expect(listApprovedNetHosts(db, KEYS).sort()).toEqual(['api.openai.com', 'example.org']);
  });

  it('reports revocation of a non-existent host as not removed', () => {
    approvePluginNetHosts(db, KEYS, ['api.openai.com']);
    expect(revokePluginNetHost(db, KEYS, 'never-approved.example')).toBe(false);
    // 没撤掉 ≠ 授权表被动过：原有域名必须还在
    expect(listApprovedNetHosts(db, KEYS)).toEqual(['api.openai.com']);
  });

  it('really removes the host on revoke', () => {
    approvePluginNetHosts(db, KEYS, ['api.openai.com']);
    expect(revokePluginNetHost(db, KEYS, 'api.openai.com')).toBe(true);
    expect(listApprovedNetHosts(db, KEYS)).toEqual([]);
  });

  it('refuses to revoke a host that normalizes to a blocked entry', () => {
    // 撤销接口同样过归一化：`LOCALHOST` 不是「已批准的域名」，不能假装撤掉了什么
    expect(revokePluginNetHost(db, KEYS, 'LOCALHOST')).toBe(false);
  });
});
