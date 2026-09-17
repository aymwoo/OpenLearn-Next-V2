import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { kernelContainer } from '../kernel/index.js';
import { IAuthSessionBridgeToken } from '../di/interfaces.js';
import { getValidSession } from '../../../server/middleware/auth.js';
import { activate, deactivate } from '../../../v2_plugins/plugin-lti-provider/src/index.js';
import {
  getOrCreateKeyPair,
  signJwtRs256,
  verifyJwtRs256,
} from '../../../v2_plugins/plugin-lti-provider/src/crypto.js';
import { LtiStateStore } from '../../../v2_plugins/plugin-lti-provider/src/state-store.js';
import { PluginHttpRouter } from '../plugin-host/http-router.js';

describe('LTI 1.3 Tool Provider Plugin Tests (@openlearn/plugin-lti-provider)', () => {
  let mockCtx: any;
  let httpRouter: PluginHttpRouter;

  beforeEach(async () => {
    await kernelContainer.ready;
    httpRouter = new PluginHttpRouter();

    // 组装真实的测试上下文（基于内核 DB 与统一会话服务）
    mockCtx = {
      pluginId: '@openlearn/plugin-lti-provider',
      manifest: {
        id: '@openlearn/plugin-lti-provider',
        name: 'LTI 1.3 Tool Provider',
        version: '1.0.0',
      },
      http: httpRouter,
      db: {
        async ensureTable(tableName: string, schema: string) {
          const fullName = `plugin_lti_${tableName}`;
          kernelContainer.db.exec(`CREATE TABLE IF NOT EXISTS ${fullName} (${schema})`);
        },
        table(tableName: string) {
          return `plugin_lti_${tableName}`;
        },
      },
      log: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
      services: {
        eventBus: kernelContainer.eventBus,
        db: kernelContainer.db,
      },
      resolve: async (token: any) => {
        return kernelContainer.serviceRegistry.resolve(token);
      },
    };

    await activate(mockCtx);
  });

  afterEach(async () => {
    await deactivate();
    try {
      kernelContainer.db.exec('DROP TABLE IF EXISTS plugin_lti_states');
      kernelContainer.db.exec('DROP TABLE IF EXISTS plugin_lti_keys');
      kernelContainer.db.exec('DROP TABLE IF EXISTS plugin_lti_platforms');
    } catch {}
  });

  // ── 1. 密码学与密钥对管理 ──────────────────────────────────────────────
  describe('Crypto & KeyPair Management', () => {
    it('应该能正确生成持久化 RSA 2048 密钥对并导出标准 JWKS', async () => {
      const kp = await getOrCreateKeyPair(mockCtx);
      expect(kp).toBeDefined();
      expect(kp.kid).toMatch(/^openlearn_lti_key_/);
      expect(kp.jwk.kty).toBe('RSA');
      expect(kp.jwk.alg).toBe('RS256');
      expect(kp.jwk.n).toBeDefined();
      expect(kp.jwk.e).toBe('AQAB');

      // 再次调用应该返回同一个持久化的密钥对
      const kp2 = await getOrCreateKeyPair(mockCtx);
      expect(kp2.kid).toBe(kp.kid);
    });

    it('能对 JWT 进行签发与 RS256 验签', async () => {
      const kp = await getOrCreateKeyPair(mockCtx);
      const payload = {
        iss: 'https://canvas.instructure.com',
        sub: 'user_12345',
        name: 'Jane Doe',
      };

      const token = signJwtRs256(payload, kp.privateKeyPem, kp.kid, 60);
      expect(token.split('.').length).toBe(3);

      const verified = verifyJwtRs256(token, kp.publicKeyPem);
      expect(verified.payload.sub).toBe('user_12345');
      expect(verified.payload.name).toBe('Jane Doe');
      expect(verified.header.alg).toBe('RS256');
      expect(verified.header.kid).toBe(kp.kid);
    });

    it('篡改 JWT 内容时验签失败', async () => {
      const kp = await getOrCreateKeyPair(mockCtx);
      const token = signJwtRs256({ sub: 'admin' }, kp.privateKeyPem, kp.kid, 60);
      const parts = token.split('.');
      // 篡改 payload
      parts[1] = Buffer.from(JSON.stringify({ sub: 'hacker' })).toString('base64url');
      const tampered = parts.join('.');

      expect(() => verifyJwtRs256(tampered, kp.publicKeyPem)).toThrow('JWT signature verification failed');
    });
  });

  // ── 2. OIDC 登录发起 (/login) ──────────────────────────────────────────
  describe('OIDC Login Initiation', () => {
    it('缺少必要参数 iss 或 login_hint 时返回 400', async () => {
      const match = httpRouter.match('GET', '/login');
      expect(match.handler).toBeDefined();

      const res = (await match.handler!({
        method: 'GET',
        path: '/login',
        params: {},
        query: {},
        headers: {},
        body: {},
        ip: '127.0.0.1',
        actor: { actorId: 'anonymous', role: 'anonymous' },
      })) as any;

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('iss and login_hint are mandatory');
    });

    it('合法请求时生成 state/nonce 并返回 302 重定向至 LMS 认证端点', async () => {
      const match = httpRouter.match('GET', '/login');
      const res = (await match.handler!({
        method: 'GET',
        path: '/login',
        params: {},
        query: {
          iss: 'https://canvas.instructure.com',
          login_hint: 'user_canvas_998',
          target_link_uri: '/#/lesson/lesson-ai-01',
          client_id: '10000000000001',
        },
        headers: {},
        body: {},
        ip: '127.0.0.1',
        actor: { actorId: 'anonymous', role: 'anonymous' },
      })) as any;

      expect(res.status).toBe(302);
      const location = res.headers?.Location;
      expect(location).toBeDefined();

      const redirectUrl = new URL(location);
      expect(redirectUrl.searchParams.get('response_type')).toBe('id_token');
      expect(redirectUrl.searchParams.get('scope')).toBe('openid');
      expect(redirectUrl.searchParams.get('login_hint')).toBe('user_canvas_998');
      expect(redirectUrl.searchParams.get('client_id')).toBe('10000000000001');

      const state = redirectUrl.searchParams.get('state');
      const nonce = redirectUrl.searchParams.get('nonce');
      expect(state).toMatch(/^state_/);
      expect(nonce).toMatch(/^nonce_/);
    });
  });

  // ── 3. LTI 1.3 Launch 核心单点登录 (/launch) ───────────────────────────
  describe('LTI 1.3 Launch Endpoint', () => {
    it('有效学生 id_token 应成功创建学生用户并注入会话 Cookie 凭证', async () => {
      // 1. 模拟 OIDC 第一步存储状态
      const store = new LtiStateStore(mockCtx);
      await store.init();
      const testState = 'state_test_valid_123';
      const testNonce = 'nonce_test_valid_456';

      await store.saveState({
        state: testState,
        nonce: testNonce,
        issuer: 'https://canvas.instructure.com',
        clientId: 'test_client_id',
        targetLinkUri: '/#/lesson/lesson-demo-1',
        createdAt: Date.now(),
      });

      // 2. 模拟 LMS 签发 id_token
      const lmsKeyPair = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });

      const studentSub = `canvas_stud_${Date.now()}`;
      const idToken = signJwtRs256(
        {
          iss: 'https://canvas.instructure.com',
          aud: 'test_client_id',
          sub: studentSub,
          nonce: testNonce,
          name: '张三同学',
          email: 'zhangsan@student.edu',
          'https://purl.imsglobal.org/spec/lti/claim/roles': [
            'http://purl.imsglobal.org/vocab/lis/v2/membership#Learner',
          ],
          'https://purl.imsglobal.org/spec/lti/claim/target_link_uri': '/#/lesson/lesson-demo-1',
        },
        lmsKeyPair.privateKey,
        'lms_key_1',
        300,
      );

      const match = httpRouter.match('POST', '/launch');
      const res = (await match.handler!({
        method: 'POST',
        path: '/launch',
        params: {},
        query: {},
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: {
          id_token: idToken,
          state: testState,
        },
        ip: '127.0.0.1',
        actor: { actorId: 'anonymous', role: 'anonymous' },
      })) as any;

      expect(res.status).toBe(302);
      expect(res.headers?.Location).toBe('/#/lesson/lesson-demo-1');
      expect(res.sessionToken).toMatch(/^token_[0-9a-f]{32}$/);

      // 验证 Session 在平台内完全有效
      const session = getValidSession(res.sessionToken);
      expect(session).toBeDefined();
      expect(session.role).toBe('student');
      expect(session.name).toBe('张三同学');
      expect(session.email).toBe('zhangsan@student.edu');

      // 验证 state 已被一次性消费，二次提交应被拒绝
      const secondRes = (await match.handler!({
        method: 'POST',
        path: '/launch',
        params: {},
        query: {},
        headers: {},
        body: {
          id_token: idToken,
          state: testState,
        },
        ip: '127.0.0.1',
        actor: { actorId: 'anonymous', role: 'anonymous' },
      })) as any;

      expect(secondRes.status).toBe(400);
      expect(secondRes.body.error).toContain('Invalid, duplicate or expired OIDC state');
    });

    it('有效教师 id_token 应映射为 teacher 角色并重定向', async () => {
      const store = new LtiStateStore(mockCtx);
      await store.init();
      const testState = 'state_teacher_' + Date.now();
      const testNonce = 'nonce_teacher_' + Date.now();

      await store.saveState({
        state: testState,
        nonce: testNonce,
        issuer: 'https://moodle.school.edu',
        clientId: 'moodle_client_id',
        targetLinkUri: '/#/teacher',
        createdAt: Date.now(),
      });

      const { privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });

      const teacherSub = `moodle_teach_${Date.now()}`;
      const idToken = signJwtRs256(
        {
          iss: 'https://moodle.school.edu',
          aud: 'moodle_client_id',
          sub: teacherSub,
          nonce: testNonce,
          name: '李老师',
          email: 'teacher_li@school.edu',
          'https://purl.imsglobal.org/spec/lti/claim/roles': [
            'http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor',
          ],
        },
        privateKey,
        'moodle_key_1',
        300,
      );

      const match = httpRouter.match('POST', '/launch');
      const res = (await match.handler!({
        method: 'POST',
        path: '/launch',
        params: {},
        query: {},
        headers: {},
        body: {
          id_token: idToken,
          state: testState,
        },
        ip: '127.0.0.1',
        actor: { actorId: 'anonymous', role: 'anonymous' },
      })) as any;

      expect(res.status).toBe(302);
      expect(res.sessionToken).toBeDefined();

      const session = getValidSession(res.sessionToken);
      expect(session).toBeDefined();
      expect(session.role).toBe('teacher');
      expect(session.name).toBe('李老师');
    });
  });

  // ── 4. 公钥端点 (/jwks) ────────────────────────────────────────────────
  describe('JWKS Endpoint', () => {
    it('返回符合 1EdTech 规范的标准 JWKS 格式', async () => {
      const match = httpRouter.match('GET', '/jwks');
      const res = (await match.handler!({
        method: 'GET',
        path: '/jwks',
        params: {},
        query: {},
        headers: {},
        body: {},
        ip: '127.0.0.1',
        actor: { actorId: 'anonymous', role: 'anonymous' },
      })) as any;

      expect(res.status).toBe(200);
      expect(res.body.keys).toBeDefined();
      expect(Array.isArray(res.body.keys)).toBe(true);
      expect(res.body.keys[0].kty).toBe('RSA');
      expect(res.body.keys[0].alg).toBe('RS256');
    });
  });
});
