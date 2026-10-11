import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import {
  getDataDir,
  getUploadsDir,
  getStorageDir,
  getPluginsDir,
  getBackupsDir,
} from '../paths.js';

describe('Paths Utility (OPENLEARN_DATA_DIR SSOT)', () => {
  const originalDataDir = process.env.OPENLEARN_DATA_DIR;
  const originalDbPath = process.env.OPENLEARN_DB_PATH;
  const originalPluginsDir = process.env.OPENLEARN_PLUGINS_DIR;
  const originalBackupDir = process.env.BACKUP_DIR;

  beforeEach(() => {
    delete process.env.OPENLEARN_DATA_DIR;
    delete process.env.OPENLEARN_DB_PATH;
    delete process.env.OPENLEARN_PLUGINS_DIR;
    delete process.env.BACKUP_DIR;
  });

  afterEach(() => {
    if (originalDataDir !== undefined) process.env.OPENLEARN_DATA_DIR = originalDataDir;
    else delete process.env.OPENLEARN_DATA_DIR;

    if (originalDbPath !== undefined) process.env.OPENLEARN_DB_PATH = originalDbPath;
    else delete process.env.OPENLEARN_DB_PATH;

    if (originalPluginsDir !== undefined) process.env.OPENLEARN_PLUGINS_DIR = originalPluginsDir;
    else delete process.env.OPENLEARN_PLUGINS_DIR;

    if (originalBackupDir !== undefined) process.env.BACKUP_DIR = originalBackupDir;
    else delete process.env.BACKUP_DIR;
  });

  it('优先使用 OPENLEARN_DATA_DIR 环境变量', () => {
    const customDir = path.join(os.tmpdir(), 'custom_openlearn_data');
    process.env.OPENLEARN_DATA_DIR = customDir;
    process.env.OPENLEARN_DB_PATH = '/other/path/data.db';

    expect(getDataDir()).toBe(path.resolve(customDir));
    expect(getUploadsDir()).toBe(path.join(path.resolve(customDir), 'uploads'));
    expect(getStorageDir()).toBe(path.join(path.resolve(customDir), 'storage'));
    expect(getPluginsDir()).toBe(path.join(path.resolve(customDir), 'plugins'));
    expect(getBackupsDir()).toBe(path.join(path.resolve(customDir), 'backups'));
  });

  it('未设置 OPENLEARN_DATA_DIR 时回退到 OPENLEARN_DB_PATH 的父目录', () => {
    const customDbDir = path.join(os.tmpdir(), 'my_app_db');
    process.env.OPENLEARN_DB_PATH = path.join(customDbDir, 'test.db');

    expect(getDataDir()).toBe(path.resolve(customDbDir));
    expect(getUploadsDir()).toBe(path.join(path.resolve(customDbDir), 'uploads'));
  });

  it('均未设置时回退至 process.cwd()', () => {
    expect(getDataDir()).toBe(process.cwd());
    expect(getUploadsDir()).toBe(path.join(process.cwd(), 'uploads'));
    expect(getStorageDir()).toBe(path.join(process.cwd(), 'storage'));
  });

  it('OPENLEARN_PLUGINS_DIR 显式配置时优先级高于默认子目录', () => {
    const customPlugins = '/opt/custom/plugins';
    process.env.OPENLEARN_PLUGINS_DIR = customPlugins;
    expect(getPluginsDir()).toBe(path.resolve(customPlugins));
  });

  it('BACKUP_DIR 显式配置时优先级高于默认子目录', () => {
    const customBackups = '/mnt/nas/backups';
    process.env.BACKUP_DIR = customBackups;
    expect(getBackupsDir()).toBe(path.resolve(customBackups));
  });
});
