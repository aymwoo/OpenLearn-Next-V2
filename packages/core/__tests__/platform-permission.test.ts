import { describe, it, expect } from 'vitest';
import {
  PermissionManager,
  PermissionDescriptor,
  IPermissionProvider,
  PermissionPolicy,
} from '../bootstrap/permission/index.js';

describe('Kernel PI-012 Platform Permission Framework Test Suite', () => {
  const infraCapPerm: PermissionDescriptor = {
    id: 'perm_capability_execute',
    name: 'Capability Execute Permission',
    category: 'Capability',
    description: 'Allows infrastructure components to invoke platform capabilities',
    defaultPolicy: 'Allow',
  };

  const configWritePerm: PermissionDescriptor = {
    id: 'perm_config_write',
    name: 'Configuration Write Permission',
    category: 'Configuration',
    description: 'Allows writing platform configuration parameters',
    defaultPolicy: 'Deny',
  };

  it('should register and manage infrastructure permission descriptors', () => {
    const manager = new PermissionManager();
    manager.register(infraCapPerm);
    manager.register(configWritePerm);

    expect(manager.exists('perm_capability_execute')).toBe(true);
    expect(manager.list().length).toBe(2);
  });

  it('should throw collision error on duplicate permission descriptor registration', () => {
    const manager = new PermissionManager();
    manager.register(infraCapPerm);

    expect(() => manager.register(infraCapPerm)).toThrow('already registered');
  });

  it('should evaluate default descriptor policies correctly', async () => {
    const manager = new PermissionManager();
    manager.register(infraCapPerm);
    manager.register(configWritePerm);

    const checkAllowed = await manager.check('kernel_worker', 'cap_ai_service', 'perm_capability_execute');
    expect(checkAllowed.result?.allowed).toBe(true);
    expect(checkAllowed.result?.policy).toBe('Allow');

    const checkDenied = await manager.check('plugin_sandbox', 'config_system', 'perm_config_write');
    expect(checkDenied.result?.allowed).toBe(false);
    expect(checkDenied.result?.policy).toBe('Deny');
  });

  it('should respect explicit subject grants and revokes', async () => {
    const manager = new PermissionManager();
    manager.register(configWritePerm);

    // Default policy is Deny
    let context = await manager.check('infra_admin', 'config_system', 'perm_config_write');
    expect(context.result?.allowed).toBe(false);

    // Grant Allow policy to infra_admin
    manager.grant('infra_admin', 'perm_config_write', 'Allow');
    context = await manager.check('infra_admin', 'config_system', 'perm_config_write');
    expect(context.result?.allowed).toBe(true);
    expect(context.result?.policy).toBe('Allow');

    // Revoke grant
    manager.revoke('infra_admin', 'perm_config_write');
    context = await manager.check('infra_admin', 'config_system', 'perm_config_write');
    expect(context.result?.allowed).toBe(false);
  });

  it('should evaluate custom permission providers', async () => {
    const manager = new PermissionManager();
    manager.register(configWritePerm);

    const customProvider: IPermissionProvider = {
      id: 'provider_security_policy',
      getPolicy(subject: string, permission: string): PermissionPolicy | undefined {
        if (subject === 'trusted_system_service' && permission === 'perm_config_write') {
          return 'Allow';
        }
        return undefined;
      },
    };

    manager.addProvider(customProvider);

    const context = await manager.check('trusted_system_service', 'config_system', 'perm_config_write');
    expect(context.result?.allowed).toBe(true);
    expect(context.result?.reason).toContain('provider_security_policy');
  });

  it('should throw Infrastructure Permission Exception when require() fails', async () => {
    const manager = new PermissionManager();
    manager.register(configWritePerm);

    await expect(
      manager.require('untrusted_component', 'config_system', 'perm_config_write')
    ).rejects.toThrow('Infrastructure Permission Exception');
  });
});
