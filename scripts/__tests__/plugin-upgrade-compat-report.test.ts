// @vitest-environment node
/**
 * 插件升级兼容性预检报告测试 (Issue #146)
 *
 * 覆盖：
 * 1. CI 中 3 个第三方插件 (attendance-record, class_manager, interactive-courseware) 兼容性评估
 * 2. 扩展点生命周期与弃用/移除流转 (since -> deprecated -> removedIn)
 * 3. CLI 参数解析与报告执行器集成 (cli.mjs + cli-doctor.mjs)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  generateUpgradeCompatibilityReport,
  runPluginCompatibilityReport,
  CORE_EXTENSION_POINTS,
} from '../../cli-doctor.mjs';
import { parseCliArgs } from '../../cli.mjs';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

// ── 3 个官方 CI 第三方插件标准 Manifest 样本 ──────────────────────────────
const CI_THIRD_PARTY_PLUGINS = [
  {
    id: '@ext/attendance-record',
    name: '考勤记录',
    version: '1.0.0',
    main: 'index.js',
    engines: { openlearn: '>=0.2.0' },
    contributes: {
      'teacher.tab': [{ id: 'attendance', label: '考勤', icon: 'Calendar', position: 2 }],
    },
    requires: ['@openlearn/core:IDatabase@^1.0.0', '@openlearn/core:ICommandBusService@^1.0.0'],
  },
  {
    id: '@ext/class-manager',
    name: '班级管理',
    version: '0.3.9',
    main: 'index.js',
    engines: { openlearn: '>=0.2.0' },
    contributes: {
      'teacher.tab': [{ id: 'class-mgmt', label: '班级', icon: 'Users', position: 1 }],
    },
    requires: ['@openlearn/core:IDatabase@^1.0.0', '@openlearn/core:ICommandBusService@^1.0.0'],
    pluginDependencies: ['@openlearn/plugin-management', '@openlearn/plugin-builtin'],
  },
  {
    id: 'openlearn-plugin-interactive-courseware',
    name: '互动课件',
    version: '1.1.0',
    main: 'index.js',
    engines: { openlearn: '>=0.2.5' },
    contributes: {
      'classroom.tool': [{ id: 'courseware-tool', name: '课件', commandType: 'courseware.launch' }],
    },
    requires: ['@openlearn/core:IStorageService@^1.0.0'],
  },
];

describe('插件升级兼容性分析 (Issue #146)', () => {
  describe('CI 第三方插件基准兼容性', () => {
    it('3 个第三方插件在目标版本 v0.6.1 下完全兼容且无弃用告警', () => {
      const report = generateUpgradeCompatibilityReport(CI_THIRD_PARTY_PLUGINS, '0.6.1');
      expect(report.targetVersion).toBe('0.6.1');
      expect(report.overallStatus).toBe('compatible');
      expect(report.summary.totalPlugins).toBe(3);
      expect(report.summary.compatibleCount).toBe(3);
      expect(report.summary.warningCount).toBe(0);
      expect(report.summary.incompatibleCount).toBe(0);

      for (const p of report.plugins) {
        expect(p.status).toBe('compatible');
        expect(p.issues.length).toBe(0);
      }
    });

    it('3 个第三方插件在未来次要版本 v0.7.0 下仍完全兼容', () => {
      const report = generateUpgradeCompatibilityReport(CI_THIRD_PARTY_PLUGINS, '0.7.0');
      expect(report.overallStatus).toBe('compatible');
      expect(report.summary.compatibleCount).toBe(3);
      expect(report.summary.incompatibleCount).toBe(0);
    });
  });

  describe('扩展点弃用与移除生命周期判定', () => {
    it('UI 插槽：在 deprecated 版本警告，在 removedIn 版本阻断', () => {
      const pluginWithLegacySlot = [
        {
          id: 'test-slot-plugin',
          version: '1.0.0',
          contributes: {
            'legacy.classroom.tab': [{ id: 'tab' }],
          },
        },
      ];

      // legacy.classroom.tab: deprecated: '0.5.0', removedIn: '0.7.0'
      const rep060 = generateUpgradeCompatibilityReport(pluginWithLegacySlot, '0.6.0');
      expect(rep060.overallStatus).toBe('has_warnings');
      expect(rep060.summary.warningCount).toBe(1);
      expect(rep060.summary.incompatibleCount).toBe(0);
      expect(rep060.plugins[0].issues[0].level).toBe('warn');
      expect(rep060.plugins[0].issues[0].message).toContain('deprecated since v0.5.0');

      const rep070 = generateUpgradeCompatibilityReport(pluginWithLegacySlot, '0.7.0');
      expect(rep070.overallStatus).toBe('incompatible');
      expect(rep070.summary.warningCount).toBe(0);
      expect(rep070.summary.incompatibleCount).toBe(1);
      expect(rep070.plugins[0].issues[0].level).toBe('error');
      expect(rep070.plugins[0].issues[0].message).toContain('removed in v0.7.0');
      expect(rep070.plugins[0].issues[0].replacement).toContain("Use 'teacher.tab' instead");
    });

    it('服务 Token：支持带 @version 后缀解析，并在 removedIn 阻断', () => {
      const pluginWithLegacyService = [
        {
          id: 'test-svc-plugin',
          version: '1.0.0',
          requires: ['@openlearn/core:ILegacyAuthService@^1.0.0'],
        },
      ];

      // ILegacyAuthService: deprecated: '0.5.0', removedIn: '0.7.0'
      const rep060 = generateUpgradeCompatibilityReport(pluginWithLegacyService, '0.6.0');
      expect(rep060.overallStatus).toBe('has_warnings');

      const rep070 = generateUpgradeCompatibilityReport(pluginWithLegacyService, '0.7.0');
      expect(rep070.overallStatus).toBe('incompatible');
      expect(rep070.plugins[0].issues[0].level).toBe('error');
      expect(rep070.plugins[0].issues[0].extensionPoint).toBe('@openlearn/core:ILegacyAuthService');
    });

    it('命令 Command：在 deprecated 版本警告，在 removedIn 版本阻断', () => {
      const pluginWithLegacyCommand = [
        {
          id: 'test-cmd-plugin',
          version: '1.0.0',
          commands: ['vfs.read_path'],
        },
      ];

      // vfs.read_path: deprecated: '0.6.0', removedIn: '0.7.0'
      const rep060 = generateUpgradeCompatibilityReport(pluginWithLegacyCommand, '0.6.0');
      expect(rep060.overallStatus).toBe('has_warnings');
      expect(rep060.plugins[0].issues[0].level).toBe('warn');

      const rep070 = generateUpgradeCompatibilityReport(pluginWithLegacyCommand, '0.7.0');
      expect(rep070.overallStatus).toBe('incompatible');
      expect(rep070.plugins[0].issues[0].level).toBe('error');
    });

    it('Engines 约束破坏性拦截', () => {
      const pluginStrictEngine = [
        {
          id: 'test-engine-plugin',
          version: '1.0.0',
          engines: { openlearn: '>=0.2.0 <0.6.0' },
        },
      ];

      const rep = generateUpgradeCompatibilityReport(pluginStrictEngine, '0.7.0');
      expect(rep.overallStatus).toBe('incompatible');
      expect(rep.plugins[0].issues[0].level).toBe('error');
      expect(rep.plugins[0].issues[0].message).toContain('is not satisfied by target version v0.7.0');
    });
  });

  describe('runPluginCompatibilityReport 数据库与文件系统扫描', () => {
    it('从 SQLite 数据库与插件目录扫描已安装插件并生成报告', async () => {
      const tempDir = makeTempDir('compat-test-');
      const dbPath = path.join(tempDir, 'data.db');
      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE plugins (
          id TEXT PRIMARY KEY,
          name TEXT,
          manifest TEXT
        );
      `);

      // 写入一个合规插件和一个含弃用插槽的插件
      const stmt = db.prepare('INSERT INTO plugins (id, name, manifest) VALUES (?, ?, ?)');
      stmt.run(CI_THIRD_PARTY_PLUGINS[0].id, CI_THIRD_PARTY_PLUGINS[0].name, JSON.stringify(CI_THIRD_PARTY_PLUGINS[0]));
      stmt.run(
        'deprecated-plugin',
        'Deprecated Plugin',
        JSON.stringify({
          id: 'deprecated-plugin',
          name: 'Deprecated Plugin',
          version: '1.0.0',
          contributes: { 'legacy.classroom.tab': [{ id: 'tab' }] },
        }),
      );
      db.close();

      const report = await runPluginCompatibilityReport({
        dbPath,
        pluginsDir: path.join(tempDir, 'non_existent_plugins'),
        targetVersion: '0.6.1',
        silent: true,
      });

      expect(report.summary.totalPlugins).toBe(2);
      expect(report.summary.compatibleCount).toBe(1);
      expect(report.summary.warningCount).toBe(1);
      expect(report.overallStatus).toBe('has_warnings');
    });
  });

  describe('CLI 参数解析 (cli.mjs parseCliArgs)', () => {
    it('正确解析 --compat-report 与 --target-version 选项', () => {
      const parsed1 = parseCliArgs(['doctor', '--compat-report']);
      expect(parsed1.command).toBe('doctor');
      expect(parsed1.flags.compatReport).toBe(true);

      const parsed2 = parseCliArgs(['compat-report', '--target-version', '0.7.0']);
      expect(parsed2.command).toBe('compat-report');
      expect(parsed2.flags.compatReport).toBe(true);
      expect(parsed2.flags.targetVersion).toBe('0.7.0');

      const parsed3 = parseCliArgs(['--compat-report', '--target-version=1.0.0']);
      expect(parsed3.command).toBe('compat-report');
      expect(parsed3.flags.compatReport).toBe(true);
      expect(parsed3.flags.targetVersion).toBe('1.0.0');
    });

    it('当 --target-version 缺少值时抛出友好错误', () => {
      expect(() => {
        parseCliArgs(['doctor', '--compat-report', '--target-version']);
      }).toThrow('选项 --target-version 必须指定有效的目标版本号');
    });
  });
});
