import { describe, expect, it } from 'vitest';
import { resolveSeedCredential, resolveSeedPasswordMode } from '../index.js';

/**
 * 初始口令策略（`OPENLEARN_SEED_PASSWORD_MODE`）。
 *
 * 背景：默认策略从「随机生成 + 写 storage/bootstrap-credentials.txt」改为
 * 「口令 = 用户名」，因为自托管用户（NAS / 群晖 / 宝塔 / Docker 卷）几乎拿不到那个文件，
 * 装完进不去后台只能删库重来。安全性由登录后的强制改密门承担：
 * `mustChange = true` 时除改密 / 登出外的接口全部 403。
 *
 * 这组断言同时钉住「旧行为仍可显式要回」这条退路。
 */
describe('resolveSeedPasswordMode', () => {
  it('默认（未配置）是 default', () => {
    expect(resolveSeedPasswordMode({})).toBe('default');
  });

  it('只有 random 走随机口令，其余一律回落 default', () => {
    expect(resolveSeedPasswordMode({ OPENLEARN_SEED_PASSWORD_MODE: 'random' })).toBe('random');
    expect(resolveSeedPasswordMode({ OPENLEARN_SEED_PASSWORD_MODE: ' RANDOM ' })).toBe('random');
    expect(resolveSeedPasswordMode({ OPENLEARN_SEED_PASSWORD_MODE: 'default' })).toBe('default');
    // 拼错不回落到 random，而是回到默认分支（由 env 校验负责报错拦住）
    expect(resolveSeedPasswordMode({ OPENLEARN_SEED_PASSWORD_MODE: 'randmo' })).toBe('default');
  });
});

describe('resolveSeedCredential', () => {
  it('default 模式：口令 = 用户名，必须改密，不生成口令文件', () => {
    const admin = resolveSeedCredential('admin', { mode: 'default' });
    expect(admin).toMatchObject({ password: 'admin', mustChange: true, generated: false, source: 'default' });

    const teacher = resolveSeedCredential('teacher', { mode: 'default' });
    expect(teacher.password).toBe('teacher');
  });

  it('random 模式：随机口令，必须改密，写入口令文件', () => {
    const random = resolveSeedCredential('admin', { mode: 'random' });
    expect(random.password).not.toBe('admin');
    expect(random.password.length).toBeGreaterThanOrEqual(12);
    expect(random.mustChange).toBe(true);
    expect(random.generated).toBe(true);
    expect(random.source).toBe('random');
  });

  it('环境变量优先于两种模式（显式口令不该被模式覆盖）', () => {
    for (const mode of ['default', 'random'] as const) {
      const cred = resolveSeedCredential('admin', { envValue: 'My-Own-Pass9', mode });
      expect(cred.password, mode).toBe('My-Own-Pass9');
      expect(cred.mustChange, mode).toBe(false);
      expect(cred.generated, mode).toBe(false);
      expect(cred.source, mode).toBe('env');
    }
  });

  it('环境变量恰好等于用户名时仍然强制改密', () => {
    const cred = resolveSeedCredential('admin', { envValue: 'admin', mode: 'default' });
    expect(cred.password).toBe('admin');
    expect(cred.mustChange).toBe(true);
  });

  it('PLAYWRIGHT_TEST 的 allowWellKnown 分支保持免改密（端到端套件依赖它）', () => {
    const cred = resolveSeedCredential('admin', { allowWellKnown: true, mode: 'default' });
    expect(cred).toMatchObject({ password: 'admin', mustChange: false, source: 'playwright' });
  });

  it('vitest 兜底口令不是默认口令，避免单测污染默认口令断言', () => {
    const cred = resolveSeedCredential('admin', { vitestFallback: true, mode: 'default' });
    expect(cred.password).not.toBe('admin');
    expect(cred.mustChange).toBe(false);
    expect(cred.source).toBe('vitest');
  });
});
