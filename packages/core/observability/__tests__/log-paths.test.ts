import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { LOG_FILE_NAME, resolveLogDir, resolveLogFilePath } from '../log-paths.js';

describe('log path resolution', () => {
  it('honours LOG_DIR for both the writer and the admin log reader', () => {
    const env = { LOG_DIR: path.join(path.sep, 'var', 'log', 'openlearn') } as NodeJS.ProcessEnv;
    expect(resolveLogDir(env, path.join(path.sep, 'srv', 'app'))).toBe(env.LOG_DIR);
    expect(resolveLogFilePath(env, path.join(path.sep, 'srv', 'app'))).toBe(
      path.join(env.LOG_DIR as string, LOG_FILE_NAME),
    );
  });

  it('defaults to <cwd>/logs when LOG_DIR is not set', () => {
    const cwd = path.join(path.sep, 'srv', 'app');
    expect(resolveLogDir({} as NodeJS.ProcessEnv, cwd)).toBe(path.join(cwd, 'logs'));
    expect(resolveLogFilePath({} as NodeJS.ProcessEnv, cwd)).toBe(path.join(cwd, 'logs', LOG_FILE_NAME));
  });
});
