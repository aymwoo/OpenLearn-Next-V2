/**
 * 会话桥 requires 精确匹配。
 *
 * 版本后缀语法必须与 packages/core/plugin-host/core.ts 调用的
 * parseRequiresEntry 一致，不能另写一套切分规则。
 */
import { describe, it, expect } from 'vitest';
import { manifestDeclaresAuthSessionBridge } from '../routes/plugin-api-gateway.js';

const TOKEN = '@openlearn/core:IAuthSessionBridgeService';

describe('manifestDeclaresAuthSessionBridge', () => {
  it('精确 Token 允许会话桥', () => {
    expect(manifestDeclaresAuthSessionBridge([TOKEN])).toBe(true);
  });

  it('宿主 requires 语法的版本后缀 @^1.0.0 仍然匹配', () => {
    expect(manifestDeclaresAuthSessionBridge([`${TOKEN}@^1.0.0`])).toBe(true);
  });

  it('同一解析器接受的其它版本范围仍然匹配', () => {
    expect(manifestDeclaresAuthSessionBridge([`${TOKEN}@~1.2.0`])).toBe(true);
    expect(manifestDeclaresAuthSessionBridge([`${TOKEN}@1.0.0`])).toBe(true);
    expect(manifestDeclaresAuthSessionBridge([`${TOKEN}@>=1.0.0 <2.0.0`])).toBe(true);
    expect(manifestDeclaresAuthSessionBridge([`${TOKEN}@^1.0.0-beta.1`])).toBe(true);
  });

  it('NotReallyIAuthSessionBridgeServiceX 不匹配', () => {
    expect(manifestDeclaresAuthSessionBridge(['NotReallyIAuthSessionBridgeServiceX'])).toBe(false);
    expect(manifestDeclaresAuthSessionBridge(['@openlearn/core:NotReallyIAuthSessionBridgeServiceX@^1.0.0'])).toBe(
      false,
    );
  });

  it('只写出接口名、或在真实 Token 后拼接多余字符，都不匹配', () => {
    expect(manifestDeclaresAuthSessionBridge(['IAuthSessionBridgeService'])).toBe(false);
    expect(manifestDeclaresAuthSessionBridge([`${TOKEN}Extra`])).toBe(false);
    expect(manifestDeclaresAuthSessionBridge(['@openlearn/other:IAuthSessionBridgeService'])).toBe(false);
  });

  it('同一 requires 列表里只要有一条精确 Token 即允许', () => {
    expect(manifestDeclaresAuthSessionBridge(['NotReallyIAuthSessionBridgeServiceX', `${TOKEN}@^1.0.0`])).toBe(true);
  });

  it('空列表、非数组和非字符串条目不匹配', () => {
    expect(manifestDeclaresAuthSessionBridge([])).toBe(false);
    expect(manifestDeclaresAuthSessionBridge(undefined)).toBe(false);
    expect(manifestDeclaresAuthSessionBridge(null)).toBe(false);
    expect(manifestDeclaresAuthSessionBridge([1, null, { token: TOKEN }])).toBe(false);
  });
});
