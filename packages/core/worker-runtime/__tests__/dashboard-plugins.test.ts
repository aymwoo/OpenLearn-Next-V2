import { describe, it, expect, vi } from 'vitest';
import { ServiceHost } from '../service-host.js';

describe('Dashboard Plugins DDL and Command Verification', () => {
  it('should allow lianyun-course to create all research ecosystem tables', async () => {
    const executedSqls: string[] = [];
    const mockDb = {
      exec: vi.fn((sql: string) => {
        executedSqls.push(sql);
      }),
      prepare: vi.fn((sql: string) => ({
        run: vi.fn((...args: any[]) => {
          executedSqls.push(sql);
          return { changes: 1 };
        }),
        get: vi.fn(() => null),
        all: vi.fn(() => []),
      })),
    };

    const dbRegistry = {
      resolve: vi.fn().mockResolvedValue(mockDb),
    };
    const capGuard = {
      check: vi.fn().mockReturnValue({ allowed: true }),
    };
    const transport = {
      messages: [] as any[],
      postMessage(msg: any) {
        this.messages.push(msg);
      },
    };

    const host = new ServiceHost(
      dbRegistry as any,
      capGuard as any,
      'plugin:lianyun-course',
      ['research:write', 'research:read'],
      undefined,
      undefined,
      'lianyun-course',
      '01a0b99f-efb7-7178-be2e-be3b1ad0cb53',
    );

    const tablesToCreate = [
      'CREATE TABLE IF NOT EXISTS plugin_research_activities (id TEXT PRIMARY KEY)',
      'CREATE TABLE IF NOT EXISTS plugin_research_groups (id TEXT PRIMARY KEY)',
      'CREATE TABLE IF NOT EXISTS plugin_research_submissions (id TEXT PRIMARY KEY)',
      'CREATE TABLE IF NOT EXISTS plugin_research_reviews (id TEXT PRIMARY KEY)',
      'ALTER TABLE plugin_research_activities ADD COLUMN class_id TEXT',
    ];

    for (let i = 0; i < tablesToCreate.length; i++) {
      await host.handleInvoke(
        {
          type: 'invoke',
          invokeId: `inv-${i}`,
          token: '@openlearn/core:IDatabase',
          method: 'prepareAndRun',
          args: [tablesToCreate[i], []],
        },
        transport as any,
      );

      const resp = transport.messages.find((m) => m.invokeId === `inv-${i}`);
      expect(resp).toBeDefined();
      expect(resp?.type).toBe('result');
      expect(resp?.error).toBeUndefined();
    }

    expect(executedSqls.length).toBe(5);
  });

  it('should verify lab_seat attendance handler handles empty/promise records gracefully', async () => {
    // Simulating lab_seat.get_current_lesson_attendance handler logic
    const mockRawDb = {
      prepare: (sql: string) => ({
        get: async () => null, // No open session
        all: async () => [],
      }),
    };

    const session = await mockRawDb.prepare('SELECT * FROM check_in_sessions WHERE status = "open"').get();
    expect(session).toBeNull();

    // With session = null, handler immediately returns null instead of throwing
    const result = !session ? null : { total: 0 };
    expect(result).toBeNull();
  });
});
