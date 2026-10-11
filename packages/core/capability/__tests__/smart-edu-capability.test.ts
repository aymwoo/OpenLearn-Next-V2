import { describe, it, expect } from 'vitest';
import { CapabilityGuard } from '../index.js';

/**
 * smart_edu:* 能力授权回归钉（v0.6.0 审计 C-2）。
 *
 * 内核拦截器（kernel/index.ts）对注册了 capabilityRequired 的命令调用
 * `capabilityGuard.check(actorId, cap)`；actorId 形态由服务端
 * getActorId()（server/middleware/auth.ts）产出为 `user:<safeId>:<role>`。
 * 本测试用**真实 Guard + 真实 actorId 形态**钉住角色回退表中的
 * smart_edu 授权：任何人从角色表里删掉 smart_edu:*，教师端的
 * /api/external/smart-edu/* 四端点就会再次全体 Access Denied。
 */
describe('CapabilityGuard — smart_edu:* 角色授权（C-2 回归钉）', () => {
  const guard = new CapabilityGuard();

  it('教师可检索、导入与上报（smart_edu:read/write/export）', () => {
    const teacher = 'user:zhang_laoshi:teacher';
    expect(guard.check(teacher, 'smart_edu:read')).toBe(true);
    expect(guard.check(teacher, 'smart_edu:write')).toBe(true);
    expect(guard.check(teacher, 'smart_edu:export')).toBe(true);
  });

  it('学生仅有只读授权（目录检索/状态胶囊），不可导入或上报', () => {
    const student = 'user:xiao_ming:student';
    expect(guard.check(student, 'smart_edu:read')).toBe(true);
    expect(guard.check(student, 'smart_edu:write')).toBe(false);
    expect(guard.check(student, 'smart_edu:export')).toBe(false);
  });

  it('匿名用户无任何 smart_edu 授权', () => {
    expect(guard.check('anonymous', 'smart_edu:read')).toBe(false);
    expect(guard.check('anonymous', 'smart_edu:write')).toBe(false);
  });

  it('administrator 角色全量放行', () => {
    const admin = 'user:usr_admin:administrator';
    expect(guard.check(admin, 'smart_edu:read')).toBe(true);
    expect(guard.check(admin, 'smart_edu:write')).toBe(true);
    expect(guard.check(admin, 'smart_edu:export')).toBe(true);
  });

  it('角色解析只认白名单：非白名单角色尾段不获得任何角色回退能力', () => {
    // getActorId 只产出白名单角色尾段；伪造的 'superadmin' 尾段解析为 null，
    // 无角色回退 → 只剩 actor 级授权（空）→ 拒绝
    expect(guard.check('user:evil:superadmin', 'smart_edu:write')).toBe(false);
    expect(guard.check('user:evil:superadmin', 'smart_edu:read')).toBe(false);
  });
});
