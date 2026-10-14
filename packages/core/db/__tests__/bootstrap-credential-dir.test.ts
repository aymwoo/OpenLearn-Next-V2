import { afterEach, describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { resolveBootstrapCredentialDir } from '../index.js';

describe('resolveBootstrapCredentialDir', () => {
  const prevData = process.env.OPENLEARN_DATA_DIR;
  const prevDb = process.env.OPENLEARN_DB_PATH;

  afterEach(() => {
    if (prevData === undefined) delete process.env.OPENLEARN_DATA_DIR;
    else process.env.OPENLEARN_DATA_DIR = prevData;
    if (prevDb === undefined) delete process.env.OPENLEARN_DB_PATH;
    else process.env.OPENLEARN_DB_PATH = prevDb;
  });

  it('优先使用 OPENLEARN_DATA_DIR/storage', () => {
    process.env.OPENLEARN_DATA_DIR = path.join(os.tmpdir(), 'openlearn-data');
    process.env.OPENLEARN_DB_PATH = '/elsewhere/educational_os.db';
    expect(resolveBootstrapCredentialDir()).toBe(path.join(path.resolve(process.env.OPENLEARN_DATA_DIR), 'storage'));
  });

  it('未设置数据目录时写到数据库文件的同级 storage', () => {
    delete process.env.OPENLEARN_DATA_DIR;
    process.env.OPENLEARN_DB_PATH = path.join(os.tmpdir(), 'db', 'educational_os.db');
    expect(resolveBootstrapCredentialDir()).toBe(path.join(os.tmpdir(), 'db', 'storage'));
  });
});
