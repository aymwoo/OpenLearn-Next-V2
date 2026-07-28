// server/bootstrap-db.ts
//
// Startup DB migrations, default-plugin upgrade, and SEC-AUTH-03 session
// cleanup. Extracted VERBATIM from server.ts (the boot block inside
// startServer(), between ServerBootstrapAdapter.bootstrap and
// kernelContainer.ready). Behavior is unchanged: every kernelContainer.db
// reference became the injected `db` parameter, all try/catch blocks, log
// calls, and the totalDeleted counting logic are preserved.
//
// Characterization test: server/__tests__/bootstrap-db.test.ts

export interface MigrationDb {
  exec(sql: string): void;
  prepare(sql: string): {
    get: (...params: unknown[]) => unknown;
    run: (...params: unknown[]) => { changes?: number };
  };
}

export async function runStartupMigrations(db: MigrationDb): Promise<void> {
  try {

    const existingQuiz = db.prepare('SELECT id, manifest, source_code FROM plugins WHERE name = ?').get('Quiz Component Plugin') as any;
    if (existingQuiz && (!existingQuiz.manifest || !existingQuiz.manifest.includes('classroomTools') || !existingQuiz.source_code.includes('actorId:'))) {
      console.log('Upgrading old Quiz Component Plugin to add classroomTools and fix Actor...');
      db.prepare('DELETE FROM plugins WHERE id = ?').run(existingQuiz.id);
    }
    const existingRollCall = db.prepare('SELECT id, manifest FROM plugins WHERE name = ?').get('Random Student Picker (随机点名小工具)') as any;
    if (existingRollCall && (!existingRollCall.manifest || !existingRollCall.manifest.includes('classroomTools'))) {
      console.log('Upgrading old Random Student Picker Plugin to add classroomTools...');
      db.prepare('DELETE FROM plugins WHERE id = ?').run(existingRollCall.id);
    }
  } catch (e) {
    console.error('Error upgrading old default plugins:', e);
  }

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS student_rollcalls (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL,
        class_id TEXT,
        lesson_id TEXT,
        picked_time INTEGER NOT NULL
      );
    `);
    console.log('student_rollcalls table successfully ensured.');
  } catch (e) {
    console.error('Error creating student_rollcalls table:', e);
  }

  // 站点信息设置表（站点名称、口号、Logo）
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS site_settings (
        id TEXT PRIMARY KEY,
        site_name TEXT,
        slogan TEXT,
        logo_url TEXT
      );
    `);
    console.log('site_settings table successfully ensured.');
  } catch (e) {
    console.error('Error creating site_settings table:', e);
  }

  // 内核助手对话记忆表（按 用户+课程 维度持久化对话历史）
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_conversations (
        id TEXT PRIMARY KEY,
        conv_key TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_agent_conv_key ON agent_conversations(conv_key, created_at);`
    );
    console.log('agent_conversations table successfully ensured.');
  } catch (e) {
    console.error('Error creating agent_conversations table:', e);
  }

  // SEC-AUTH-03: client_sessions 添加 expires_at �?
  try {
    db.exec(`ALTER TABLE client_sessions ADD COLUMN expires_at INTEGER`);
    console.log('client_sessions.expires_at column ensured.');
  } catch { /* 列已存在 */ }

  // SEC-AUTH-03: 启动时清理过�? session
  try {
    const now = Date.now();
    const idleTimeout = 24 * 60 * 60 * 1000;
    const deletedExpired = db.prepare(
      'DELETE FROM client_sessions WHERE expires_at IS NOT NULL AND expires_at < ?'
    ).run(now);
    const deletedIdle = db.prepare(
      'DELETE FROM client_sessions WHERE updated_at IS NOT NULL AND (? - updated_at) > ?'
    ).run(now, idleTimeout);
    const totalDeleted = (deletedExpired.changes || 0) + (deletedIdle.changes || 0);
    if (totalDeleted > 0) {
      console.log(`[Session] Cleaned up ${totalDeleted} expired sessions on startup.`);
    }
  } catch (e) {
    console.warn('[Session] Could not clean up expired sessions:', e);
  }
}
