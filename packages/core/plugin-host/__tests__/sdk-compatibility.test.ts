import { describe, it, expect } from 'vitest';
import {
  Token,
  ICommandBusServiceToken,
  IEventBusServiceToken,
  PluginRuntimeAdapter,
  PluginRuntimeComposition,
  PluginContextAdapter,
  PluginLifecycleManager,
  PluginCapabilityGateway,
  UnifiedExtensionRegistry,
} from '../../../plugin-sdk/index.js';

describe('Plugin SDK Compatibility Layer (P7-B6 EU-01)', () => {
  it('should export legacy DI tokens and Token class', () => {
    expect(Token).toBeDefined();
    expect(ICommandBusServiceToken).toBeDefined();
    expect(IEventBusServiceToken).toBeDefined();
    expect(ICommandBusServiceToken.name).toBe('@openlearn/core:ICommandBusService');
  });

  it('should export all unified foundation facades and classes via Plugin SDK', () => {
    expect(PluginRuntimeAdapter).toBeDefined();
    expect(PluginRuntimeComposition).toBeDefined();
    expect(PluginContextAdapter).toBeDefined();
    expect(PluginLifecycleManager).toBeDefined();
    expect(PluginCapabilityGateway).toBeDefined();
    expect(UnifiedExtensionRegistry).toBeDefined();
  });
});
