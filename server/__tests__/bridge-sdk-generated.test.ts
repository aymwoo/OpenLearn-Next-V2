import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { BRIDGE_SOURCE_FILE, BRIDGE_TARGET_FILE, renderBridgeSdkTs } from '../../scripts/build-bridge-sdk.mjs';

/**
 * 生成物同步守卫。
 *
 * server/utils/bridge-sdk.ts 是 packages/bridge-sdk/src/bridge.js 的生成物，
 * 而构建（pnpm build）会先重新生成它再打包。因此一旦源码改了、生成物没跟着刷新，
 * 仓库里被单测校验的那份就与真正发布出去的那份**不是同一份代码** ——
 * 单测会对着陈旧产物绿灯，而线上跑的是新产物。
 *
 * 这条断言把「生成物 == 源码」钉死：任何时候源码变了而生成物没重新生成，这里就红。
 */
describe('bridge-sdk 生成物同步', () => {
  it('server/utils/bridge-sdk.ts 与 packages/bridge-sdk/src/bridge.js 一致', () => {
    const rawCode = fs.readFileSync(BRIDGE_SOURCE_FILE, 'utf8');
    const expected = renderBridgeSdkTs(rawCode);
    const actual = fs.readFileSync(BRIDGE_TARGET_FILE, 'utf8');

    expect(actual).toBe(expected);
  });

  it('生成物里确实带着 bridge 源码的全部 HOOK 上报点（防止生成器整体失灵）', () => {
    const rawCode = fs.readFileSync(BRIDGE_SOURCE_FILE, 'utf8');
    const expected = renderBridgeSdkTs(rawCode);
    const sourceHookSites = [...rawCode.matchAll(/type: ['"]HOOK_[A-Z]+['"]/g)].length;

    expect(sourceHookSites).toBeGreaterThan(0);
    expect([...expected.matchAll(/type: ['"]HOOK_[A-Z]+['"]/g)].length).toBe(sourceHookSites);
  });
});
